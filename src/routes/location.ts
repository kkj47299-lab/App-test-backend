import { FastifyInstance } from 'fastify'
import { sql } from '../db.js'

export async function locationRoutes(app: FastifyInstance) {
  // POST /v1/location/update
  app.post('/update', async (request) => {
    const userId = request.headers['x-user-id'] as string
    const { rideId, lat, lng, heading, speed } = request.body as any
    await sql`
      INSERT INTO locations.driver_positions (driver_id, ride_id, lat, lng, heading, speed, updated_at)
      VALUES (${userId}, ${rideId}, ${lat}, ${lng}, ${heading || 0}, ${speed || 0}, NOW())
      ON CONFLICT (driver_id) DO UPDATE SET lat = ${lat}, lng = ${lng}, heading = ${heading || 0}, speed = ${speed || 0}, ride_id = ${rideId}, updated_at = NOW()
    `
    return { status: 'ok' }
  })

  // GET /v1/location/ride/:rideId/driver
  app.get('/ride/:rideId/driver', async (request) => {
    const { rideId } = request.params as { rideId: string }
    const [pos] = await sql`SELECT * FROM locations.driver_positions WHERE ride_id = ${rideId} ORDER BY updated_at DESC LIMIT 1`
    if (!pos) return { lat: 0, lng: 0, heading: null, speedKmh: null, updatedAt: new Date().toISOString() }
    return { lat: pos.lat, lng: pos.lng, heading: pos.heading, speedKmh: pos.speed, updatedAt: pos.updated_at }
  })
}
