import { FastifyInstance } from 'fastify'

export async function paymentRoutes(app: FastifyInstance) {
  app.post('/order', async (req) => {
    const { bookingId, amountPaise } = req.body as any
    // In production: call Razorpay API to create order
    return { razorpayOrderId: `order_local_${Date.now()}`, amountPaise, currency: 'INR' }
  })
  app.post('/verify', async (req) => {
    const { razorpayOrderId } = req.body as any
    // In production: verify signature with Razorpay
    return { verified: true, bookingId: 'local' }
  })
}
