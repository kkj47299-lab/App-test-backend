import { FastifyInstance } from 'fastify'
import { sql } from '../db.js'

export async function searchRoutes(app: FastifyInstance) {
  // GET /v1/search/rides
  app.get('/rides', async (request) => {
    const { originLat, originLng, destLat, destLng, date, passengers, sort, page, limit } =
      request.query as Record<string, string>

    const pg = parseInt(page || '1')
    const lim = parseInt(limit || '20')
    const offset = (pg - 1) * lim
    const seats = parseInt(passengers || '1')
    const orderBy = sort === 'time' ? 'departure_at ASC' : 'price_per_seat ASC'

    // For now, use a simple query. In production, use PostGIS ST_DWithin
    const rides = await sql`
      SELECT r.*, p.full_name as driver_name, p.avatar_url as driver_avatar_url, p.avg_rating as driver_rating
      FROM rides.rides r
      LEFT JOIN users.profiles p ON p.user_id = r.driver_id
      WHERE r.status = 'active'
        AND r.seats_available >= ${seats}
        AND r.departure_at::date = ${date}::date
      ORDER BY ${sql.unsafe(orderBy)}
      LIMIT ${lim} OFFSET ${offset}
    `

    return {
      rides: rides.map(r => ({
        id: r.id, driverName: r.driver_name, driverAvatarUrl: r.driver_avatar_url, driverRating: r.driver_rating,
        originAddress: r.origin_address, originCity: r.origin_city || '', destinationAddress: r.destination_address, destinationCity: r.destination_city || '',
        departureAt: r.departure_at, durationMinutes: r.duration_minutes, distanceKm: r.distance_km,
        seatsAvailable: r.seats_available, pricePerSeat: r.price_per_seat, currency: 'INR',
        instantBooking: r.instant_booking, womenOnly: r.women_only, luggageAllowed: r.luggage_allowed,
        vehicleMake: null, vehicleModel: null, vehicleColor: null, vehicleIsAc: null
      })),
      total: rides.length, page: pg
    }
  })

  // GET /v1/search/places/autocomplete — proxy to Google Places
  app.get('/places/autocomplete', async (request) => {
    const { input, sessionToken } = request.query as { input: string; sessionToken: string }
    const apiKey = process.env.GOOGLE_MAPS_API_KEY
    const url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(input)}&components=country:in&key=${apiKey}&sessiontoken=${sessionToken}`
    const res = await fetch(url)
    const data = await res.json() as any
    return {
      predictions: (data.predictions || []).map((p: any) => ({
        placeId: p.place_id,
        description: p.description,
        mainText: p.structured_formatting?.main_text || p.description
      }))
    }
  })

  // GET /v1/search/places/detail
  app.get('/places/detail', async (request) => {
    const { placeId, sessionToken } = request.query as { placeId: string; sessionToken: string }
    const apiKey = process.env.GOOGLE_MAPS_API_KEY
    const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=geometry,formatted_address&key=${apiKey}&sessiontoken=${sessionToken}`
    const res = await fetch(url)
    const data = await res.json() as any
    const loc = data.result?.geometry?.location
    return { lat: loc?.lat || 0, lng: loc?.lng || 0, formattedAddress: data.result?.formatted_address || '' }
  })
}
