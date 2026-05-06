import { FastifyInstance } from 'fastify'
import { sql } from '../db.js'

export async function rideRoutes(app: FastifyInstance) {
  // POST /v1/rides
  app.post('/', async (request) => {
    const userId = request.headers['x-user-id'] as string
    const { vehicleId, originAddress, destinationAddress, departureAt, seatsTotal, pricePerSeat, luggageAllowed, womenOnly, instantBooking, notes } = request.body as any
    const [ride] = await sql`
      INSERT INTO rides.rides (driver_id, vehicle_id, origin_address, destination_address, departure_at, seats_total, seats_available, price_per_seat, luggage_allowed, women_only, instant_booking, notes, status)
      VALUES (${userId}, ${vehicleId}, ${originAddress}, ${destinationAddress}, ${departureAt}, ${seatsTotal}, ${seatsTotal}, ${pricePerSeat}, ${luggageAllowed ?? true}, ${womenOnly ?? false}, ${instantBooking ?? true}, ${notes || null}, 'active')
      RETURNING *
    `
    return ride
  })

  // GET /v1/rides/:rideId
  app.get('/:rideId', async (request) => {
    const { rideId } = request.params as { rideId: string }
    const [ride] = await sql`SELECT * FROM rides.rides WHERE id = ${rideId}`
    return ride || { error: 'Not found' }
  })

  // GET /v1/rides/driver/my
  app.get('/driver/my', async (request) => {
    const userId = request.headers['x-user-id'] as string
    const { status } = request.query as { status?: string }
    if (status) return await sql`SELECT * FROM rides.rides WHERE driver_id = ${userId} AND status = ${status} ORDER BY departure_at DESC`
    return await sql`SELECT * FROM rides.rides WHERE driver_id = ${userId} ORDER BY departure_at DESC`
  })

  // PATCH /v1/rides/:rideId/status
  app.patch('/:rideId/status', async (request) => {
    const { rideId } = request.params as { rideId: string }
    const { status } = request.body as { status: string }
    const [ride] = await sql`UPDATE rides.rides SET status = ${status}, updated_at = NOW() WHERE id = ${rideId} RETURNING *`
    return ride
  })

  // GET /v1/rides/:rideId/passengers
  app.get('/:rideId/passengers', async (request) => {
    const { rideId } = request.params as { rideId: string }
    return await sql`
      SELECT b.*, p.full_name, p.avatar_url, p.avg_rating
      FROM bookings.bookings b
      JOIN users.profiles p ON p.user_id = b.customer_id
      WHERE b.ride_id = ${rideId} AND b.status IN ('confirmed', 'completed')
    `
  })
}
