import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import dotenv from 'dotenv'

// Load .env manually
dotenv.config()

const __dir = dirname(fileURLToPath(import.meta.url))

// URL-encode the password to handle special chars like #, !, @
function fixDbUrl(raw) {
  try {
    new URL(raw)
    return raw  // already valid
  } catch {
    // Parse manually and encode password
    const match = raw.match(/^(postgresql:\/\/)([^:]+):(.+)@(.+)$/)
    if (!match) throw new Error('Cannot parse DATABASE_URL: ' + raw)
    const [, proto, user, pass, rest] = match
    return `${proto}${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${rest}`
  }
}

const rawUrl = process.env.DATABASE_URL
if (!rawUrl) {
  console.error('❌ DATABASE_URL not set in .env')
  process.exit(1)
}

const safeUrl = fixDbUrl(rawUrl)
const postgres = (await import('postgres')).default
const sql = postgres(safeUrl, { ssl: { rejectUnauthorized: false }, max: 1 })

// Test connection first
try {
  const [row] = await sql`SELECT NOW() as time`
  console.log(`✅ Connected to Supabase: ${row.time}`)
} catch (e) {
  console.error('❌ Connection failed:', e.message)
  process.exit(1)
}

const migrationPath = join(__dir, 'migrations', '001_initial.sql')
const migration = readFileSync(migrationPath, 'utf8')

// Split into statements — handle $$ dollar-quoted blocks
function splitStatements(sql) {
  const stmts = []
  let current = ''
  let inDollar = false

  for (const line of sql.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.startsWith('--')) { current += line + '\n'; continue }
    if (trimmed.includes('$$')) inDollar = !inDollar
    current += line + '\n'
    if (!inDollar && trimmed.endsWith(';')) {
      const s = current.trim()
      if (s && s !== ';') stmts.push(s)
      current = ''
    }
  }
  return stmts
}

const statements = splitStatements(migration)
console.log(`\n📋 Running ${statements.length} statements...\n`)

let ok = 0, skipped = 0, errors = 0

for (let i = 0; i < statements.length; i++) {
  const stmt = statements[i]
  const preview = stmt.replace(/\s+/g, ' ').substring(0, 70)

  try {
    await sql.unsafe(stmt)
    ok++
    process.stdout.write('✓')
    if ((i + 1) % 20 === 0) console.log(` (${i+1}/${statements.length})`)
  } catch (e) {
    const msg = e.message
    if (msg.includes('already exists') || msg.includes('duplicate key')) {
      skipped++
      process.stdout.write('·')
    } else {
      errors++
      console.error(`\n❌ [${i+1}] ${msg}`)
      console.error(`   → ${preview}`)
    }
  }
}

console.log(`\n\n${'═'.repeat(50)}`)
console.log(`✅  Migration complete!`)
console.log(`   Executed:  ${ok} statements`)
console.log(`   Skipped:   ${skipped} (already existed)`)
console.log(`   Errors:    ${errors}`)
console.log(`${'═'.repeat(50)}\n`)

await sql.end()
