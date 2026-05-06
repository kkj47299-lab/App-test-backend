import { FastifyInstance } from 'fastify'
import { sql } from '../db.js'
import { SignJWT, importPKCS8 } from 'jose'
import admin from 'firebase-admin'

// Fix PEM keys from Railway env vars: literal backslash-n → real newline
const BACKSLASH_N = String.fromCharCode(92, 110)
function fixPemNewlines(raw: string): string {
  return raw.split(BACKSLASH_N).join('\n')
}

// Initialize Firebase Admin (lazy, once)
if (!admin.apps.length) {
  try {
    const rawKey = process.env.FIREBASE_PRIVATE_KEY || ''
    const privateKey = fixPemNewlines(rawKey)
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        privateKey,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      })
    })
    console.log('✅ Firebase Admin initialized')
  } catch (err) {
    console.error('⚠️ Firebase Admin init failed (auth routes will not work):', err)
  }
}

export async function authRoutes(app: FastifyInstance) {

  // POST /v1/auth/otp/send
  // This is a lightweight acknowledgement endpoint. Firebase handles the actual
  // OTP delivery client-side via PhoneAuthProvider.verifyPhoneNumber().
  app.post('/otp/send', async (request, reply) => {
    const { phone, role } = request.body as { phone: string; role: string }
    return { message: `OTP flow initiated for ${phone} as ${role}` }
  })

  // POST /v1/auth/otp/verify
  // The actual authentication endpoint:
  //   1. Verify the Firebase ID token (proves the user owns the phone number)
  //   2. Find or create the user in our database
  //   3. Issue our own JWT access + refresh tokens
  app.post('/otp/verify', async (request, reply) => {
    const { phone, role, firebaseIdToken } = request.body as {
      phone: string; role: string; firebaseIdToken: string
    }

    // Step 1: Verify Firebase token
    let decoded: admin.auth.DecodedIdToken
    try {
      decoded = await admin.auth().verifyIdToken(firebaseIdToken)
    } catch (err: any) {
      console.error('Firebase token verification failed:', err.message)
      return reply.code(401).send({
        error: 'INVALID_FIREBASE_TOKEN',
        message: 'The Firebase ID token is invalid or expired.',
        details: err.message
      })
    }

    // Step 2: Find or create user in database
    let userId: string
    let isNewUser = false
    try {
      const existing = await sql`
        SELECT id FROM app_auth.users
        WHERE phone = ${phone} AND role = ${role || 'customer'}
      `

      if (existing.length === 0) {
        const [user] = await sql`
          INSERT INTO app_auth.users (phone, role, firebase_uid, last_login_at)
          VALUES (${phone}, ${role || 'customer'}, ${decoded.uid}, NOW())
          RETURNING id
        `
        userId = user.id
        isNewUser = true
      } else {
        userId = existing[0].id
        // Update last login and firebase_uid (in case it changed)
        await sql`
          UPDATE app_auth.users
          SET last_login_at = NOW(), firebase_uid = ${decoded.uid}
          WHERE id = ${userId}
        `
      }
    } catch (err: any) {
      console.error('Database error during auth:', err.message)
      return reply.code(500).send({
        error: 'DATABASE_ERROR',
        message: 'Could not reach the database. Please try again later.',
        details: process.env.NODE_ENV === 'production' ? undefined : err.message
      })
    }

    // Step 3: Generate our own JWT tokens
    try {
      const accessToken = await generateAccessToken(userId, role || 'customer')
      const refreshToken = await generateRefreshToken(userId)
      return { accessToken, refreshToken, userId, isNewUser }
    } catch (err: any) {
      console.error('JWT generation error:', err.message)
      return reply.code(500).send({
        error: 'TOKEN_GENERATION_ERROR',
        message: 'Could not generate authentication tokens.'
      })
    }
  })

  // POST /v1/auth/token/refresh
  app.post('/token/refresh', async (request, reply) => {
    const { refreshToken } = request.body as { refreshToken: string }
    // TODO: In production, verify the refresh token signature and check revocation
    // For now, just echo back — acceptable for MVP/testing
    return { accessToken: refreshToken }
  })

  // POST /v1/auth/logout
  app.post('/logout', async (request) => {
    // TODO: In production, revoke the refresh token in DB
    return { message: 'Logged out' }
  })
}

// ── Token generators ──────────────────────────────────────────────

async function generateAccessToken(userId: string, role: string): Promise<string> {
  if (!process.env.JWT_PRIVATE_KEY) {
    // Dev mode: generate a simple unsigned token for testing
    const payload = Buffer.from(JSON.stringify({
      sub: userId, role, iat: Math.floor(Date.now() / 1000)
    })).toString('base64url')
    return `eyJ0eXAiOiJKV1QiLCJhbGciOiJub25lIn0.${payload}.dev`
  }
  const privateKey = await importPKCS8(fixPemNewlines(process.env.JWT_PRIVATE_KEY), 'RS256')
  return new SignJWT({ role })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime('1h')
    .setIssuer(process.env.JWT_ISSUER || 'rideshare')
    .setProtectedHeader({ alg: 'RS256' })
    .sign(privateKey)
}

async function generateRefreshToken(userId: string): Promise<string> {
  if (!process.env.JWT_PRIVATE_KEY) {
    const payload = Buffer.from(JSON.stringify({
      sub: userId, type: 'refresh', iat: Math.floor(Date.now() / 1000)
    })).toString('base64url')
    return `eyJ0eXAiOiJKV1QiLCJhbGciOiJub25lIn0.${payload}.dev`
  }
  const privateKey = await importPKCS8(fixPemNewlines(process.env.JWT_PRIVATE_KEY), 'RS256')
  return new SignJWT({ type: 'refresh' })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime('30d')
    .setIssuer(process.env.JWT_ISSUER || 'rideshare')
    .setProtectedHeader({ alg: 'RS256' })
    .sign(privateKey)
}
