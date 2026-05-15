import { FastifyInstance } from 'fastify'
import { sql } from '../db.js'

export async function rideRoutes(app: FastifyInstance) {
  // POST /v1/rides
  app.post('/', async (request) => {
    const userId = request.headers['x-user-id'] as string
    const {
      vehicleId, originAddress, originLat, originLng,
      destinationAddress, destLat, destLng,
      departureAt, seatsTotal, pricePerSeat,
      luggageAllowed, womenOnly, instantBooking, notes,
    } = request.body as any
    const [ride] = await sql`
      INSERT INTO rides.rides (
        driver_id, vehicle_id,
        origin_address, origin_lat, origin_lng,
        destination_address, dest_lat, dest_lng,
        departure_at, seats_total, seats_available, price_per_seat,
        luggage_allowed, women_only, instant_booking, notes, status
      )
      VALUES (
        ${userId}, ${vehicleId},
        ${originAddress}, ${originLat ?? 0}, ${originLng ?? 0},
        ${destinationAddress}, ${destLat ?? 0}, ${destLng ?? 0},
        ${departureAt}, ${seatsTotal}, ${seatsTotal}, ${pricePerSeat},
        ${luggageAllowed ?? true}, ${womenOnly ?? false}, ${instantBooking ?? true},
        ${notes || null}, 'active'
      )
      RETURNING *
    `
    return projectRide(ride)
  })

  // GET /v1/rides/:rideId
  app.get('/:rideId', async (request) => {
    const { rideId } = request.params as { rideId: string }
    const [r] = await sql`
      SELECT r.*, p.full_name AS driver_name, p.avatar_url AS driver_avatar_url, p.avg_rating AS driver_rating,
             v.make AS vehicle_make, v.model AS vehicle_model, v.color AS vehicle_color, v.is_ac AS vehicle_is_ac
      FROM rides.rides r
      LEFT JOIN users.profiles p ON p.user_id = r.driver_id
      LEFT JOIN drivers.vehicles v ON v.id = r.vehicle_id
      WHERE r.id = ${rideId}
    `
    if (!r) return { error: 'Not found' }
    return projectRide(r)
  })

  // GET /v1/rides/driver/my
  app.get('/driver/my', async (request) => {
    const userId = request.headers['x-user-id'] as string
    const { status, page } = request.query as { status?: string; page?: string }
    const pg = parseInt(page || '1')
    const limit = 50
    const offset = (pg - 1) * limit

    const rows = status
      ? await sql`
          SELECT r.*, p.full_name AS driver_name, p.avatar_url AS driver_avatar_url, p.avg_rating AS driver_rating,
                 v.make AS vehicle_make, v.model AS vehicle_model, v.color AS vehicle_color, v.is_ac AS vehicle_is_ac
          FROM rides.rides r
          LEFT JOIN users.profiles p ON p.user_id = r.driver_id
          LEFT JOIN drivers.vehicles v ON v.id = r.vehicle_id
          WHERE r.driver_id = ${userId} AND r.status = ${status}
          ORDER BY r.departure_at DESC
          LIMIT ${limit} OFFSET ${offset}
        `
      : await sql`
          SELECT r.*, p.full_name AS driver_name, p.avatar_url AS driver_avatar_url, p.avg_rating AS driver_rating,
                 v.make AS vehicle_make, v.model AS vehicle_model, v.color AS vehicle_color, v.is_ac AS vehicle_is_ac
          FROM rides.rides r
          LEFT JOIN users.profiles p ON p.user_id = r.driver_id
          LEFT JOIN drivers.vehicles v ON v.id = r.vehicle_id
          WHERE r.driver_id = ${userId}
          ORDER BY r.departure_at DESC
          LIMIT ${limit} OFFSET ${offset}
        `
    return {
      rides: rows.map(projectRide),
      total: rows.length,
      page: pg,
    }
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
    const rows = await sql`
      SELECT b.id AS booking_id, b.seats_booked, b.total_amount_paise, b.status,
             p.full_name, p.avatar_url, p.avg_rating
      FROM bookings.bookings b
      JOIN users.profiles p ON p.user_id = b.customer_id
      WHERE b.ride_id = ${rideId} AND b.status IN ('confirmed', 'completed', 'pending')
      ORDER BY b.created_at ASC
    `
    return {
      passengers: rows.map((r: any) => ({
        bookingId: r.booking_id,
        seatsBooked: r.seats_booked,
        totalAmountPaise: r.total_amount_paise ?? 0,
        status: r.status,
        customer: {
          fullName: r.full_name ?? 'Passenger',
          avatarUrl: r.avatar_url ?? null,
          avgRating: r.avg_rating ?? null,
        },
      })),
    }
  })
}

// Map a `rides.rides` row + joined fields to the API contract expected by the
// mobile clients. Database columns are snake_case + ints (paise); some are
// rewritten/renamed here for the wire format.
function projectRide(r: any) {
  const seatsTotal = r.seats_total ?? 0
  const seatsAvailable = r.seats_available ?? 0
  return {
    id: r.id,
    driver: r.driver_name
      ? {
          id: r.driver_id,
          fullName: r.driver_name,
          avatarUrl: r.driver_avatar_url ?? null,
          avgRating: r.driver_rating != null ? Number(r.driver_rating) : null,
        }
      : null,
    vehicle: r.vehicle_make
      ? {
          make: r.vehicle_make,
          model: r.vehicle_model ?? '',
          color: r.vehicle_color ?? '',
          isAc: r.vehicle_is_ac ?? null,
        }
      : null,
    origin_address: r.origin_address ?? '',
    origin_city: r.origin_city ?? '',
    origin_lat: r.origin_lat ?? 0,
    origin_lng: r.origin_lng ?? 0,
    destination_address: r.destination_address ?? r.dest_address ?? '',
    destination_city: r.destination_city ?? r.dest_city ?? '',
    dest_lat: r.dest_lat ?? 0,
    dest_lng: r.dest_lng ?? 0,
    departure_at: r.departure_at,
    duration_minutes: r.duration_minutes ?? null,
    distance_km: r.distance_km != null ? Number(r.distance_km) : null,
    route_polyline: r.route_polyline ?? null,
    seats_available: seatsAvailable,
    seats_total: seatsTotal,
    price_per_seat: r.price_per_seat ?? 0,
    currency: r.currency ?? 'INR',
    instant_booking: r.instant_booking ?? true,
    women_only: r.women_only ?? false,
    luggage_allowed: r.luggage_allowed ?? true,
    status: r.status ?? 'active',
    notes: r.notes ?? null,
  }
}
