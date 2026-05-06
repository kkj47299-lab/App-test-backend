import { FastifyInstance } from 'fastify'
import { sql } from '../db.js'

export async function userRoutes(app: FastifyInstance) {
  // POST /v1/users/profile
  app.post('/profile', async (request, reply) => {
    const userId = request.headers['x-user-id'] as string
    const { fullName, email, dateOfBirth, gender } = request.body as any
    const [profile] = await sql`
      INSERT INTO users.profiles (user_id, full_name, email, date_of_birth, gender)
      VALUES (${userId}, ${fullName}, ${email || null}, ${dateOfBirth || null}, ${gender || null})
      ON CONFLICT (user_id) DO UPDATE SET full_name = ${fullName}, email = ${email || null}
      RETURNING *
    `
    return profile
  })

  // GET /v1/users/profile
  app.get('/profile', async (request, reply) => {
    const userId = request.headers['x-user-id'] as string
    const [profile] = await sql`SELECT * FROM users.profiles WHERE user_id = ${userId}`
    if (!profile) return reply.code(404).send({ error: 'Profile not found' })
    return profile
  })

  // PATCH /v1/users/profile
  app.patch('/profile', async (request, reply) => {
    const userId = request.headers['x-user-id'] as string
    const updates = request.body as Record<string, any>
    const [profile] = await sql`
      UPDATE users.profiles SET ${sql(updates)} WHERE user_id = ${userId} RETURNING *
    `
    return profile
  })
}
