/*  Key setup — a local form for the keys Verdikt needs.

    npm run setup            (from server/) → opens http://127.0.0.1:4199 in your browser
    npm run setup -- --no-open

    Paste the PayPal sandbox keys (and, when you have them, Supabase and Anthropic). Each one is
    checked with its own service, then merged into server/.env and web/.env. Keys never leave this
    computer except to the service that checks them; the page only ever learns whether a key is set.
    The server listens on 127.0.0.1 only and every request must carry this run's random token.
*/

import http from 'node:http'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..')
const FILES = {
  server: { path: join(root, 'server', '.env'), example: join(root, 'server', '.env.example'), label: 'server/.env' },
  web: { path: join(root, 'web', '.env'), example: join(root, 'web', '.env.example'), label: 'web/.env' },
}
const TOKEN = randomBytes(16).toString('hex')
const PORT = 4199

// ---------------------------------------------------------------- .env files
const read = (f) => (existsSync(f.path) ? readFileSync(f.path, 'utf8') : existsSync(f.example) ? readFileSync(f.example, 'utf8') : '')
function parse(text) {
  const out = {}
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
    if (m) out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2')
  }
  return out
}
// replace values in place (comments and order survive), append keys the file doesn't have yet
function merge(text, updates) {
  const seen = new Set()
  const lines = text.split(/\r?\n/).map((line) => {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=/)
    if (!m || !(m[1] in updates)) return line
    seen.add(m[1])
    return `${m[1]}=${updates[m[1]]}`
  })
  for (const [k, v] of Object.entries(updates)) if (!seen.has(k)) lines.push(`${k}=${v}`)
  return `${lines.join('\n').replace(/\n+$/, '')}\n`
}
// what's actually saved lives only in the real .env files — the examples are templates
const savedIn = (f) => (existsSync(f.path) ? parse(readFileSync(f.path, 'utf8')) : {})
const env = () => ({ server: savedIn(FILES.server), web: savedIn(FILES.web) })

// the examples are committed to git: a secret pasted there would be published with the code
const SECRET_KEYS = ['PAYPAL_CLIENT_SECRET', 'SUPABASE_SERVICE_ROLE_KEY', 'ANTHROPIC_API_KEY', 'GITHUB_TOKEN']
function leaks() {
  return Object.values(FILES)
    .filter((f) => existsSync(f.example) && SECRET_KEYS.some((k) => parse(readFileSync(f.example, 'utf8'))[k]))
    .map((f) => `${f.label}.example`)
}

// ---------------------------------------------------------------- checks (each talks only to its own service)
const timeout = () => AbortSignal.timeout(12000)
const unreachable = (who, e) => ({ ok: false, sure: false, message: `Couldn't reach ${who} (${e.cause?.code || e.message}), so it wasn't checked. Saved anyway.` })

async function checkPayPal(id, secret) {
  if (id === secret) return { ok: false, sure: true, message: 'The Client ID and the Secret are the same text — the Secret is the second, longer value.' }
  try {
    const r = await fetch('https://api-m.sandbox.paypal.com/v1/oauth2/token', {
      method: 'POST',
      headers: { Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials',
      signal: timeout(),
    })
    if (r.ok) return { ok: true, message: 'PayPal sandbox accepted the Client ID and Secret.' }
    const j = await r.json().catch(() => ({}))
    if (r.status === 401) return { ok: false, sure: true, message: 'PayPal rejected this pair. Make sure both come from the same app with the switch on Sandbox, and that the Secret was copied whole.' }
    return { ok: false, sure: true, message: `PayPal answered ${r.status}${j.error_description ? `: ${j.error_description}` : ''}.` }
  } catch (e) {
    return unreachable('PayPal', e)
  }
}

// which Supabase key is this? legacy keys are JWTs with a role claim; new ones carry a prefix
function supabaseRole(key) {
  if (key.startsWith('sb_publishable_')) return 'anon'
  if (key.startsWith('sb_secret_')) return 'service_role'
  try { return JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()).role || '' } catch { return '' }
}
async function checkSupabase(url, anon, service) {
  if (!/^https:\/\/[^/]+$/.test(url)) return { ok: false, sure: true, message: 'The project URL should look like https://abcd1234.supabase.co (no path at the end).' }
  if (supabaseRole(anon) === 'service_role') return { ok: false, sure: true, message: 'The anon field holds the service_role key. That key must never reach the browser — paste the anon (public) key there.' }
  if (supabaseRole(service) === 'anon') return { ok: false, sure: true, message: 'The service_role field holds the anon key. Use the service_role key (Project Settings → API, the secret one).' }
  try {
    const a = await fetch(`${url}/auth/v1/settings`, { headers: { apikey: anon }, signal: timeout() })
    if (a.status === 401 || a.status === 403) return { ok: false, sure: true, message: 'Supabase rejected the anon key for this project URL.' }
    const s = await fetch(`${url}/rest/v1/profiles?select=id&limit=1`, { headers: { apikey: service }, signal: timeout() })
    if (s.status === 401 || s.status === 403) return { ok: false, sure: true, message: 'Supabase rejected the service_role key for this project URL.' }
    if (s.ok) return { ok: true, message: 'Supabase accepted both keys and the Verdikt tables are there.' }
    return { ok: true, message: 'Supabase accepted both keys, but the Verdikt tables are missing — run supabase/migrations/0001_init.sql then 0002_flow.sql in the SQL editor.' }
  } catch (e) {
    return unreachable('Supabase', e)
  }
}

async function checkAnthropic(key) {
  try {
    const r = await fetch('https://api.anthropic.com/v1/models?limit=1', {
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      signal: timeout(),
    })
    if (r.ok) return { ok: true, message: 'Anthropic accepted the API key.' }
    if (r.status === 401 || r.status === 403) return { ok: false, sure: true, message: 'Anthropic rejected this API key.' }
    return { ok: false, sure: true, message: `Anthropic answered ${r.status}.` }
  } catch (e) {
    return unreachable('Anthropic', e)
  }
}

// ---------------------------------------------------------------- save
async function save(body) {
  const cur = env()
  const s = { ...cur.server }
  const val = (k) => (typeof body[k] === 'string' ? body[k].trim() : '')
  const results = []
  const server = {}
  const web = {}
  const saved = []

  // PayPal: a new value, or the one already saved
  const ppId = val('paypalClientId') || s.PAYPAL_CLIENT_ID || ''
  const ppSecret = val('paypalSecret') || s.PAYPAL_CLIENT_SECRET || ''
  if (val('paypalClientId') || val('paypalSecret')) {
    if (!ppId || !ppSecret) {
      results.push({ service: 'PayPal sandbox', ok: false, message: 'Both the Client ID and the Secret are needed — paste the missing one.' })
    } else {
      const c = await checkPayPal(ppId, ppSecret)
      const keep = c.ok || !c.sure
      if (keep) {
        Object.assign(server, { PAYPAL_ENV: 'sandbox', PAYPAL_CLIENT_ID: ppId, PAYPAL_CLIENT_SECRET: ppSecret })
        web.VITE_PAYPAL_CLIENT_ID = ppId
        saved.push('paypalClientId', 'paypalSecret')
      }
      results.push({ service: 'PayPal sandbox', ok: c.ok, saved: keep, message: keep ? c.message : `${c.message} Nothing was saved for PayPal.` })
    }
  }

  // Supabase: all three, mixing new and saved
  const sbUrl = (val('supabaseUrl') || s.SUPABASE_URL || '').replace(/\/+$/, '')
  const sbAnon = val('supabaseAnonKey') || cur.web.VITE_SUPABASE_ANON_KEY || ''
  const sbService = val('supabaseServiceKey') || s.SUPABASE_SERVICE_ROLE_KEY || ''
  if (val('supabaseUrl') || val('supabaseAnonKey') || val('supabaseServiceKey')) {
    if (!sbUrl || !sbAnon || !sbService) {
      results.push({ service: 'Supabase', ok: false, message: 'Supabase needs all three: the project URL, the anon key and the service_role key.' })
    } else {
      const c = await checkSupabase(sbUrl, sbAnon, sbService)
      const keep = c.ok || !c.sure
      if (keep) {
        Object.assign(server, { SUPABASE_URL: sbUrl, SUPABASE_SERVICE_ROLE_KEY: sbService })
        Object.assign(web, { VITE_SUPABASE_URL: sbUrl, VITE_SUPABASE_ANON_KEY: sbAnon })
        saved.push('supabaseUrl', 'supabaseAnonKey', 'supabaseServiceKey')
      }
      results.push({ service: 'Supabase', ok: c.ok, saved: keep, message: keep ? `${c.message} The web app now runs live — restart it to switch from demo.` : `${c.message} Nothing was saved for Supabase.` })
    }
  }

  // Anthropic
  if (val('anthropicKey')) {
    const c = await checkAnthropic(val('anthropicKey'))
    const keep = c.ok || !c.sure
    if (keep) {
      server.ANTHROPIC_API_KEY = val('anthropicKey')
      saved.push('anthropicKey')
    }
    results.push({ service: 'Claude (Anthropic)', ok: c.ok, saved: keep, message: keep ? c.message : `${c.message} Nothing was saved for Anthropic.` })
  }

  const written = []
  if (Object.keys(server).length) {
    writeFileSync(FILES.server.path, merge(read(FILES.server), server))
    written.push(FILES.server.label)
  }
  if (Object.keys(web).length) {
    writeFileSync(FILES.web.path, merge(read(FILES.web), web))
    written.push(FILES.web.label)
  }
  return { results, written, saved }
}

// what the page may know: whether each key is set — never the secret itself
function state() {
  const { server: s, web: w } = env()
  return {
    paypal: { clientId: s.PAYPAL_CLIENT_ID ? s.PAYPAL_CLIENT_ID.slice(-4) : '', secret: !!s.PAYPAL_CLIENT_SECRET },
    supabase: { url: s.SUPABASE_URL || '', anon: !!w.VITE_SUPABASE_ANON_KEY, service: !!s.SUPABASE_SERVICE_ROLE_KEY },
    anthropic: !!s.ANTHROPIC_API_KEY,
    leaks: leaks(),
  }
}

// ---------------------------------------------------------------- the local server
const page = readFileSync(join(here, 'setup.html'), 'utf8').replace('__TOKEN__', TOKEN)

function send(res, status, body, type = 'application/json') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' })
  res.end(type === 'application/json' ? JSON.stringify(body) : body)
}

const server = http.createServer(async (req, res) => {
  const { port } = server.address()
  const url = new URL(req.url, `http://127.0.0.1:${port}`)
  // only this machine, by its own name (stops DNS-rebinding tricks), and only with this run's token
  if (req.headers.host !== `127.0.0.1:${port}`) return send(res, 403, { error: 'Open the link printed in the terminal.' })
  if (req.method === 'GET' && url.pathname === '/') {
    if (url.searchParams.get('t') !== TOKEN) return send(res, 403, 'Open the exact link printed in the terminal.', 'text/plain; charset=utf-8')
    return send(res, 200, page, 'text/html; charset=utf-8')
  }
  if (req.headers['x-setup-token'] !== TOKEN) return send(res, 403, { error: 'Missing setup token' })
  try {
    if (req.method === 'GET' && url.pathname === '/state') return send(res, 200, state())
    if (req.method === 'POST' && (url.pathname === '/save' || url.pathname === '/done')) {
      let raw = ''
      for await (const chunk of req) {
        raw += chunk
        if (raw.length > 64 * 1024) return send(res, 413, { error: 'Too much data' })
      }
      if (url.pathname === '/done') {
        send(res, 200, { ok: true })
        console.log('\n  Done. Restart `npm run dev` in server and web to use the new keys.\n')
        setTimeout(() => process.exit(0), 200)
        return
      }
      const out = await save(JSON.parse(raw || '{}'))
      for (const r of out.results) console.log(`  ${r.ok ? '✓' : r.saved ? '!' : '✗'} ${r.service}: ${r.message}`)
      if (out.written.length) console.log(`  → wrote ${out.written.join(' and ')}`)
      return send(res, 200, out)
    }
    send(res, 404, { error: 'Not found' })
  } catch (e) {
    send(res, 500, { error: e.message })
  }
})

function open(link) {
  const [cmd, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', link]]
    : process.platform === 'darwin' ? ['open', [link]] : ['xdg-open', [link]]
  try { spawn(cmd, args, { stdio: 'ignore', detached: true }).unref() } catch {}
}

function listen(port) {
  server.once('error', (e) => {
    if (e.code === 'EADDRINUSE' || e.code === 'EACCES') return listen(0)   // taken or reserved: any free port
    throw e
  })
  server.listen(port, '127.0.0.1', () => {
    const link = `http://127.0.0.1:${server.address().port}/?t=${TOKEN}`
    console.log(`\n  Verdikt key setup — open this link (it only works on this computer):\n\n  ${link}\n\n  Press Ctrl+C to stop.\n`)
    for (const f of leaks()) console.log(`  ! ${f} contains a secret. That file is committed to git — move the key into the .env file and leave the example blank.\n`)
    if (!process.argv.includes('--no-open')) open(link)
  })
}
listen(PORT)
