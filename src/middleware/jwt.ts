import { FastifyRequest, FastifyReply } from 'fastify'
import { jwtVerify, importSPKI, type KeyLike } from 'jose'

const PUBLIC_ROUTES = [
  '/v1/auth/otp/',
  '/v1/auth/token/refresh',
  '/v1/search/rides',
  '/v1/search/places/',
  '/health',
]

let publicKey: KeyLike | null = null

export async function jwtMiddleware(request: FastifyRequest, reply: FastifyReply) {
  // Skip public routes
  if (PUBLIC_ROUTES.some(r => request.url.startsWith(r))) return

  const authHeader = request.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    return reply.code(401).send({ error: 'Missing authorization header' })
  }

  const token = authHeader.slice(7)

  try {
    // For local dev: if JWT_PUBLIC_KEY is not set, use a simple decode (dev mode only)
    if (!process.env.JWT_PUBLIC_KEY) {
      // In dev mode without JWT keys, we'll just trust the token and decode it
      // This is ONLY for local development convenience
      const parts = token.split('.')
      if (parts.length === 3) {
        const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString())
        request.headers['x-user-id'] = payload.sub || payload.userId || 'dev-user'
        request.headers['x-user-role'] = payload.role || 'customer'
        return
      }
      return reply.code(401).send({ error: 'Invalid token format' })
    }

    if (!publicKey) {
      // Railway stores literal \n in env vars — convert to real newlines
      const rawKey = process.env.JWT_PUBLIC_KEY.replace(/\\n/g, '\n')
      publicKey = await importSPKI(rawKey, 'RS256')
    }

    const { payload } = await jwtVerify(token, publicKey!)
    request.headers['x-user-id'] = payload.sub as string
    request.headers['x-user-role'] = payload.role as string
  } catch (err) {
    return reply.code(401).send({ error: 'Invalid or expired token' })
  }
}
