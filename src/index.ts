import 'dotenv/config'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import { authRoutes } from './routes/auth.js'
import { userRoutes } from './routes/users.js'
import { driverRoutes } from './routes/drivers.js'
import { rideRoutes } from './routes/rides.js'
import { bookingRoutes } from './routes/bookings.js'
import { searchRoutes } from './routes/search.js'
import { locationRoutes } from './routes/location.js'
import { ratingRoutes } from './routes/ratings.js'
import { notificationRoutes } from './routes/notifications.js'
import { paymentRoutes } from './routes/payments.js'
import { jwtMiddleware } from './middleware/jwt.js'

const app = Fastify({ logger: true })

// CORS — allow Android emulators and physical devices
await app.register(cors, { origin: true })

// JWT verification middleware (skips public routes)
app.addHook('onRequest', jwtMiddleware)

// Register all route modules
app.register(authRoutes,         { prefix: '/v1/auth' })
app.register(userRoutes,         { prefix: '/v1/users' })
app.register(driverRoutes,       { prefix: '/v1/driver' })
app.register(rideRoutes,         { prefix: '/v1/rides' })
app.register(bookingRoutes,      { prefix: '/v1/bookings' })
app.register(searchRoutes,       { prefix: '/v1/search' })
app.register(locationRoutes,     { prefix: '/v1/location' })
app.register(ratingRoutes,       { prefix: '/v1/ratings' })
app.register(notificationRoutes, { prefix: '/v1/notifications' })
app.register(paymentRoutes,      { prefix: '/v1/payments' })

// Health check
app.get('/health', async () => ({ status: 'ok', mode: 'local', timestamp: new Date().toISOString() }))

const PORT = parseInt(process.env.PORT || '3000')

try {
  // Listen on 0.0.0.0 so Android emulator (10.0.2.2) and physical devices on same WiFi can reach it
  await app.listen({ port: PORT, host: '0.0.0.0' })
  console.log(`\n🚀 RideShare API Gateway running locally on http://0.0.0.0:${PORT}`)
  console.log(`   Android emulator:  http://10.0.2.2:${PORT}`)
  console.log(`   Physical device:   http://<your-wifi-ip>:${PORT}`)
  console.log(`   Health check:      http://localhost:${PORT}/health\n`)
} catch (err) {
  app.log.error(err)
  process.exit(1)
}
