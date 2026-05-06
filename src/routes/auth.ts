import { FastifyInstance } from 'fastify'
import { sql } from '../db.js'
import { SignJWT, jwtVerify } from 'jose'
import admin from 'firebase-admin'

// Fix PEM keys from Railway env vars: literal backslash-n → real newline
const BACKSLASH_N = String.fromCharCode(92, 110)
function fixPemNewlines(raw: string): string {
  return raw.split(BACKSLASH_N).join('\n')
}

// ── JWT Secret ──────────────────────────────────────────────────
// We use HS256 (symmetric) instead of RS256 (asymmetric PEM keys)
// because Railway env vars corrupt PEM newlines. HS256 just needs
// a simple string — no PEM, no ASN1, no newline issues.
function getJwtSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET || 'dev-secret-change-in-production'
  return new TextEncoder().encode(secret)
}

// ── Firebase Admin ──────────────────────────────────────────────
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
  app.post('/otp/send', async (request, reply) => {
    const { phone, role } = request.body as { phone: string; role: string }
    return { message: `OTP flow initiated for ${phone} as ${role}` }
  })

  // POST /v1/auth/otp/verify
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
      })
    }

    // Step 3: Generate JWT tokens (HS256 — no PEM keys needed)
    try {
      const secret = getJwtSecret()

      const accessToken = await new SignJWT({ role: role || 'customer' })
        .setSubject(userId)
        .setIssuedAt()
        .setExpirationTime('1h')
        .setIssuer(process.env.JWT_ISSUER || 'rideshare')
        .setProtectedHeader({ alg: 'HS256' })
        .sign(secret)

      const refreshToken = await new SignJWT({ type: 'refresh' })
        .setSubject(userId)
        .setIssuedAt()
        .setExpirationTime('30d')
        .setIssuer(process.env.JWT_ISSUER || 'rideshare')
        .setProtectedHeader({ alg: 'HS256' })
        .sign(secret)

      return { accessToken, refreshToken, userId, isNewUser }
    } catch (err: any) {
      console.error('JWT generation error:', err.message)
      return reply.code(500).send({
        error: 'TOKEN_GENERATION_ERROR',
        message: 'Could not generate authentication tokens.',
      })
    }
  })

  // POST /v1/auth/token/refresh
  app.post('/token/refresh', async (request, reply) => {
    const { refreshToken } = request.body as { refreshToken: string }
    try {
      const secret = getJwtSecret()
      const { payload } = await jwtVerify(refreshToken, secret)
      // Issue a fresh access token
      const accessToken = await new SignJWT({ role: payload.role as string || 'customer' })
        .setSubject(payload.sub as string)
        .setIssuedAt()
        .setExpirationTime('1h')
        .setIssuer(process.env.JWT_ISSUER || 'rideshare')
        .setProtectedHeader({ alg: 'HS256' })
        .sign(secret)
      return { accessToken }
    } catch (err: any) {
      return reply.code(401).send({ error: 'Invalid refresh token' })
    }
  })

  // POST /v1/auth/logout
  app.post('/logout', async () => {
    return { message: 'Logged out' }
  })
}
