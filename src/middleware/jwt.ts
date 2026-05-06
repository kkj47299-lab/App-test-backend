import { FastifyRequest, FastifyReply } from 'fastify'
import { jwtVerify } from 'jose'

// All routes that DON'T require a JWT
const PUBLIC_ROUTES = [
  '/v1/auth/',       // all auth routes: otp/send, otp/verify, token/refresh, logout
  '/v1/search/rides',
  '/v1/search/places/',
  '/health',
]

// HS256 secret — matches what auth.ts uses for signing
function getJwtSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET || 'dev-secret-change-in-production'
  return new TextEncoder().encode(secret)
}

export async function jwtMiddleware(request: FastifyRequest, reply: FastifyReply) {
  // Skip public routes
  if (PUBLIC_ROUTES.some(r => request.url.startsWith(r))) return

  const authHeader = request.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    return reply.code(401).send({ error: 'Missing authorization header' })
  }

  const token = authHeader.slice(7)

  try {
    const secret = getJwtSecret()
    const { payload } = await jwtVerify(token, secret)
    request.headers['x-user-id'] = payload.sub as string
    request.headers['x-user-role'] = payload.role as string
  } catch (err) {
    return reply.code(401).send({ error: 'Invalid or expired token' })
  }
}
