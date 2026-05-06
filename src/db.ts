import postgres from 'postgres'

const rawUrl = process.env.DATABASE_URL

if (!rawUrl) {
  console.error('❌ DATABASE_URL not set in .env — get it from Supabase → Project Settings → Database')
  process.exit(1)
}

// URL-encode password to handle special chars like #, !, @ in Supabase passwords
function fixDbUrl(raw: string): string {
  try { new URL(raw); return raw } catch {}
  const match = raw.match(/^(postgresql:\/\/|postgres:\/\/)([^:]+):(.+)@(.+)$/)
  if (!match) throw new Error('Cannot parse DATABASE_URL')
  const [, proto, user, pass, rest] = match
  return `${proto}${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${rest}`
}

const DATABASE_URL = fixDbUrl(rawUrl)

export const sql = postgres(DATABASE_URL, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
  ssl: { rejectUnauthorized: false }
})

// Quick test
export async function testDbConnection() {
  try {
    const [row] = await sql`SELECT NOW() as time`
    console.log(`✅ Database connected: ${row.time}`)
    return true
  } catch (err) {
    console.error('❌ Database connection failed:', err)
    return false
  }
}
