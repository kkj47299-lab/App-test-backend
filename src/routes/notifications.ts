import { FastifyInstance } from 'fastify'
import { sql } from '../db.js'

export async function notificationRoutes(app: FastifyInstance) {
  app.post('/token', async (req) => {
    const uid = req.headers['x-user-id'] as string
    const { fcmToken, deviceId, appType } = req.body as any
    await sql`INSERT INTO notifications.fcm_tokens (user_id, fcm_token, device_id, app_type) VALUES (${uid}, ${fcmToken}, ${deviceId}, ${appType}) ON CONFLICT (user_id, device_id) DO UPDATE SET fcm_token = ${fcmToken}`
    return { message: 'ok' }
  })
  app.get('/inbox', async (req) => {
    const uid = req.headers['x-user-id'] as string
    const n = await sql`SELECT * FROM notifications.inbox WHERE user_id = ${uid} ORDER BY created_at DESC LIMIT 20`
    const [{ count }] = await sql`SELECT COUNT(*) as count FROM notifications.inbox WHERE user_id = ${uid} AND is_read = false`
    return { unreadCount: parseInt(count), notifications: n }
  })
  app.patch('/inbox/read', async (req) => {
    const uid = req.headers['x-user-id'] as string
    const { markAllRead } = req.body as any
    if (markAllRead) { await sql`UPDATE notifications.inbox SET is_read = true WHERE user_id = ${uid}`; return { updated: 1 } }
    return { updated: 0 }
  })
}
