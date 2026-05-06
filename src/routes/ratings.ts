import { FastifyInstance } from 'fastify'
import { sql } from '../db.js'

export async function ratingRoutes(app: FastifyInstance) {
  app.get('/pending', async (request) => {
    const userId = request.headers['x-user-id'] as string
    return await sql`SELECT * FROM ratings.review_prompts WHERE reviewer_id = ${userId} AND submitted = false AND expires_at > NOW()`
  })

  app.post('/submit', async (request) => {
    const userId = request.headers['x-user-id'] as string
    const { promptId, rating, comment } = request.body as any
    const [review] = await sql`
      INSERT INTO ratings.reviews (prompt_id, reviewer_id, rating, comment)
      VALUES (${promptId}, ${userId}, ${rating}, ${comment || null})
      RETURNING *
    `
    await sql`UPDATE ratings.review_prompts SET submitted = true WHERE id = ${promptId}`
    return review
  })
}
