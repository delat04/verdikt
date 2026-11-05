/*  Database migrations — runs supabase/migrations/*.sql against your Supabase Postgres, in order.

    npm run db:migrate          (from server/, reads SUPABASE_DB_URL from server/.env)

    · Each file runs in one transaction: it applies fully or not at all.
    · Applied files are recorded in public._verdikt_migrations, so running it again only applies new ones.
    · Supabase's direct address (db.<ref>.supabase.co) is IPv6-only. On a network without IPv6 this
      falls back to the session pooler (same password, IPv4), trying the regions until one answers.
*/

import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'supabase', 'migrations')
const REGIONS = [
  'eu-central-1', 'eu-west-1', 'eu-west-2', 'eu-west-3', 'eu-central-2', 'eu-north-1',
  'us-east-1', 'us-east-2', 'us-west-1', 'us-west-2', 'ca-central-1', 'sa-east-1',
  'ap-south-1', 'ap-southeast-1', 'ap-southeast-2', 'ap-northeast-1', 'ap-northeast-2',
]

const raw = process.env.SUPABASE_DB_URL
if (!raw) {
  console.error('\n✗ SUPABASE_DB_URL is not set in server/.env — Supabase → Connect → "Direct connection" or "Session pooler".\n')
  process.exit(1)
}
const url = new URL(raw)
const masked = (u) => `${u.protocol}//${u.username}:***@${u.host}${u.pathname}`

// connection candidates: the address as given, then (for a direct Supabase host) the session pooler per region
function candidates() {
  const list = [url]
  const ref = url.hostname.match(/^db\.([a-z0-9]+)\.supabase\.co$/)?.[1]
  if (ref) {
    for (const prefix of ['aws-1', 'aws-0']) {
      for (const region of REGIONS) {
        const u = new URL(url)
        u.hostname = `${prefix}-${region}.pooler.supabase.com`
        u.port = '5432'
        u.username = `postgres.${ref}`
        list.push(u)
      }
    }
  }
  return list
}

async function connect() {
  for (const u of candidates()) {
    const client = new pg.Client({ connectionString: u.toString(), ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 8000 })
    try {
      await client.connect()
      return { client, used: u }
    } catch (e) {
      await client.end().catch(() => {})
      const msg = String(e.message || e.code)
      if (/password authentication failed/i.test(msg)) throw new Error('The database password in SUPABASE_DB_URL is wrong (Supabase → Project Settings → Database → reset it).')
      // unreachable host or wrong pooler region: try the next one
    }
  }
  throw new Error('Could not reach the database. In Supabase → Connect, copy the "Session pooler" string into SUPABASE_DB_URL and run this again.')
}

try {
  const { client, used } = await connect()
  console.log(`\n  Connected · ${masked(used)}${used.hostname !== url.hostname ? '  (session pooler — put this host in SUPABASE_DB_URL to skip the search next time)' : ''}`)

  await client.query('create table if not exists public._verdikt_migrations (name text primary key, applied_at timestamptz not null default now())')
  const done = new Set((await client.query('select name from public._verdikt_migrations')).rows.map((r) => r.name))
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()

  let applied = 0
  for (const f of files) {
    if (done.has(f)) { console.log(`  · ${f} — already applied`); continue }
    const sql = readFileSync(join(dir, f), 'utf8')
    try {
      await client.query('begin')
      await client.query(sql)
      await client.query('insert into public._verdikt_migrations (name) values ($1)', [f])
      await client.query('commit')
      console.log(`  ✓ ${f}`)
      applied += 1
    } catch (e) {
      await client.query('rollback').catch(() => {})
      console.error(`  ✗ ${f} — ${e.message}${e.position ? ` (at character ${e.position})` : ''}\n    Nothing from this file was kept.`)
      await client.end()
      process.exit(1)
    }
  }
  await client.end()
  console.log(`\n✓ Database is up to date${applied ? ` — applied ${applied} file${applied > 1 ? 's' : ''}` : ''}.\n`)
} catch (e) {
  console.error(`\n✗ ${e.message}\n`)
  process.exit(1)
}
