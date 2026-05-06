import { FastifyInstance } from 'fastify'
import { sql } from '../db.js'

export async function driverRoutes(app: FastifyInstance) {
  // POST /v1/driver/vehicles
  app.post('/vehicles', async (request, reply) => {
    const userId = request.headers['x-user-id'] as string
    const { make, model, year, color, registrationNo, seatsTotal, isAc } = request.body as any
    const [vehicle] = await sql`
      INSERT INTO drivers.vehicles (driver_id, make, model, year, color, registration_no, seats_total, is_ac)
      VALUES (${userId}, ${make}, ${model}, ${year}, ${color}, ${registrationNo}, ${seatsTotal}, ${isAc})
      RETURNING *
    `
    return vehicle
  })

  // GET /v1/driver/vehicles
  app.get('/vehicles', async (request) => {
    const userId = request.headers['x-user-id'] as string
    return await sql`SELECT * FROM drivers.vehicles WHERE driver_id = ${userId} ORDER BY created_at DESC`
  })

  // POST /v1/driver/documents
  app.post('/documents', async (request, reply) => {
    const userId = request.headers['x-user-id'] as string
    const { docType, vehicleId, expiryDate } = request.body as any
    // In production: handle file upload to Cloudinary
    const [doc] = await sql`
      INSERT INTO drivers.documents (driver_id, doc_type, vehicle_id, expiry_date, status, file_url)
      VALUES (${userId}, ${docType}, ${vehicleId || null}, ${expiryDate || null}, 'pending', 'local-placeholder')
      RETURNING *
    `
    return doc
  })

  // GET /v1/driver/documents
  app.get('/documents', async (request) => {
    const userId = request.headers['x-user-id'] as string
    return await sql`SELECT * FROM drivers.documents WHERE driver_id = ${userId}`
  })

  // GET /v1/driver/profile
  app.get('/profile', async (request) => {
    const userId = request.headers['x-user-id'] as string
    const [profile] = await sql`SELECT * FROM users.profiles WHERE user_id = ${userId}`
    return profile || { error: 'Not found' }
  })
}
