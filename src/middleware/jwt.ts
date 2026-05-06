import { FastifyRequest, FastifyReply } from 'fastify'
import { jwtVerify, importSPKI, type KeyLike } from 'jose'

// All routes that DON'T require a JWT — auth endpoints and public search
const PUBLIC_ROUTES = [
  '/v1/auth/',       // all auth routes: otp/send, otp/verify, token/refresh, logout
  '/v1/search/rides',
  '/v1/search/places/',
  '/health',
]

let publicKey: KeyLike | null = null

// Fix PEM keys from Railway env vars: literal backslash-n → real newline
// Using String.fromCharCode to avoid any escape interpretation issues
const BACKSLASH_N = String.fromCharCode(92, 110) // literally: \n (two chars)
function fixPemNewlines(raw: string): string {
  return raw.split(BACKSLASH_N).join('\n')
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
    // For dev/testing: if JWT_PUBLIC_KEY is not set, do a simple base64 decode (no verification)
    if (!process.env.JWT_PUBLIC_KEY) {
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
      publicKey = await importSPKI(fixPemNewlines(process.env.JWT_PUBLIC_KEY), 'RS256')
    }

    const { payload } = await jwtVerify(token, publicKey!)
    request.headers['x-user-id'] = payload.sub as string
    request.headers['x-user-role'] = payload.role as string
  } catch (err) {
    return reply.code(401).send({ error: 'Invalid or expired token' })
  }
}
