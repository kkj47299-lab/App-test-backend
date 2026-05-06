import { FastifyInstance } from 'fastify'
import { sql } from '../db.js'
import { SignJWT, importPKCS8 } from 'jose'
import admin from 'firebase-admin'

// Fix PEM keys from Railway env vars: literal backslash-n → real newline
// Using String.fromCharCode to avoid any escape interpretation issues
const BACKSLASH_N = String.fromCharCode(92, 110) // literally: \n (two chars)
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
  app.post('/otp/send', async (request, reply) => {
    const { phone, role } = request.body as { phone: string; role: string }
    return { message: `OTP flow initiated for ${phone} as ${role}` }
  })

  // POST /v1/auth/otp/verify
  app.post('/otp/verify', async (request, reply) => {
    const { phone, role, firebaseIdToken } = request.body as { phone: string; role: string; firebaseIdToken: string }

    try {
      const decoded = await admin.auth().verifyIdToken(firebaseIdToken)

      const existing = await sql`
        SELECT id FROM app_auth.users WHERE phone = ${phone} AND role = ${role}
      `

      let userId: string
      let isNewUser = false

      if (existing.length === 0) {
        const [user] = await sql`
          INSERT INTO app_auth.users (phone, role, firebase_uid)
          VALUES (${phone}, ${role}, ${decoded.uid})
          RETURNING id
        `
        userId = user.id
        isNewUser = true
      } else {
        userId = existing[0].id
      }

      const accessToken = await generateAccessToken(userId, role)
      const refreshToken = await generateRefreshToken(userId)

      return { accessToken, refreshToken, userId, isNewUser }
    } catch (err: any) {
      console.error('OTP verify error:', err.message)
      return reply.code(401).send({ error: 'Invalid Firebase token', details: err.message })
    }
  })

  // POST /v1/auth/token/refresh
  app.post('/token/refresh', async (request, reply) => {
    const { refreshToken } = request.body as { refreshToken: string }
    return { accessToken: refreshToken }
  })

  // POST /v1/auth/logout
  app.post('/logout', async (request) => {
    return { message: 'Logged out' }
  })
}

async function generateAccessToken(userId: string, role: string): Promise<string> {
  if (!process.env.JWT_PRIVATE_KEY) {
    const payload = Buffer.from(JSON.stringify({ sub: userId, role, iat: Math.floor(Date.now() / 1000) })).toString('base64url')
    return `eyJ0eXAiOiJKV1QiLCJhbGciOiJub25lIn0.${payload}.dev`
  }
  const privateKey = await importPKCS8(fixPemNewlines(process.env.JWT_PRIVATE_KEY), 'RS256')
  return new SignJWT({ role })
    .setSubject(userId).setIssuedAt().setExpirationTime('1h')
    .setIssuer(process.env.JWT_ISSUER || 'rideshare')
    .setProtectedHeader({ alg: 'RS256' }).sign(privateKey)
}

async function generateRefreshToken(userId: string): Promise<string> {
  if (!process.env.JWT_PRIVATE_KEY) {
    const payload = Buffer.from(JSON.stringify({ sub: userId, type: 'refresh', iat: Math.floor(Date.now() / 1000) })).toString('base64url')
    return `eyJ0eXAiOiJKV1QiLCJhbGciOiJub25lIn0.${payload}.dev`
  }
  const privateKey = await importPKCS8(fixPemNewlines(process.env.JWT_PRIVATE_KEY), 'RS256')
  return new SignJWT({ type: 'refresh' })
    .setSubject(userId).setIssuedAt().setExpirationTime('30d')
    .setIssuer(process.env.JWT_ISSUER || 'rideshare')
    .setProtectedHeader({ alg: 'RS256' }).sign(privateKey)
}
