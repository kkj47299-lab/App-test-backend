import { FastifyInstance } from 'fastify'
import { sql } from '../db.js'

export async function bookingRoutes(app: FastifyInstance) {
  // POST /v1/bookings
  app.post('/', async (request) => {
    const userId = request.headers['x-user-id'] as string
    const { rideId, seatsBooked } = request.body as any

    // Get ride price
    const [ride] = await sql`SELECT price_per_seat, seats_available FROM rides.rides WHERE id = ${rideId}`
    if (!ride) return { error: 'Ride not found' }
    if (ride.seats_available < seatsBooked) return { error: 'Not enough seats' }

    const totalAmountPaise = ride.price_per_seat * seatsBooked

    const [booking] = await sql`
      INSERT INTO bookings.bookings (ride_id, customer_id, seats_booked, total_amount_paise, status)
      VALUES (${rideId}, ${userId}, ${seatsBooked}, ${totalAmountPaise}, 'pending')
      RETURNING *
    `

    // Decrement available seats
    await sql`UPDATE rides.rides SET seats_available = seats_available - ${seatsBooked} WHERE id = ${rideId}`

    return booking
  })

  // GET /v1/bookings/customer/my
  app.get('/customer/my', async (request) => {
    const userId = request.headers['x-user-id'] as string
    const { status, page } = request.query as { status?: string; page?: string }
    const offset = ((parseInt(page || '1') - 1) * 20)

    if (status) {
      const bookings = await sql`
        SELECT b.*, r.origin_city, r.destination_city, r.departure_at, p.full_name as driver_name
        FROM bookings.bookings b
        LEFT JOIN rides.rides r ON r.id = b.ride_id
        LEFT JOIN users.profiles p ON p.user_id = r.driver_id
        WHERE b.customer_id = ${userId} AND b.status = ${status}
        ORDER BY b.created_at DESC LIMIT 20 OFFSET ${offset}
      `
      return { bookings, total: bookings.length, page: parseInt(page || '1') }
    }

    const bookings = await sql`
      SELECT b.*, r.origin_city, r.destination_city, r.departure_at, p.full_name as driver_name
      FROM bookings.bookings b
      LEFT JOIN rides.rides r ON r.id = b.ride_id
      LEFT JOIN users.profiles p ON p.user_id = r.driver_id
      WHERE b.customer_id = ${userId}
      ORDER BY b.created_at DESC LIMIT 20 OFFSET ${offset}
    `
    return { bookings, total: bookings.length, page: parseInt(page || '1') }
  })

  // GET /v1/bookings/:bookingId
  app.get('/:bookingId', async (request) => {
    const { bookingId } = request.params as { bookingId: string }
    const [booking] = await sql`SELECT * FROM bookings.bookings WHERE id = ${bookingId}`
    return booking || { error: 'Not found' }
  })

  // PATCH /v1/bookings/:bookingId/cancel
  app.patch('/:bookingId/cancel', async (request) => {
    const { bookingId } = request.params as { bookingId: string }
    const [booking] = await sql`
      UPDATE bookings.bookings SET status = 'cancelled', updated_at = NOW() WHERE id = ${bookingId} RETURNING *
    `
    // Restore seats
    if (booking) await sql`UPDATE rides.rides SET seats_available = seats_available + ${booking.seats_booked} WHERE id = ${booking.ride_id}`
    return booking
  })
}
