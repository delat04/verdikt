/*  Record the demo's sample deliveries on Kernel: the videos and facts the demo plays back
    The demo's four Northbrew deliveries (web/public/samples/*.html) are checked by the verifier's real browser
    code (inspectSite) in Kernel's cloud, recorded and narrated exactly like an official check, at the address
    Verdikt publishes them at. For each one it writes
      web/public/replays/<name>.mp4, <name>-desktop.png, <name>-mobile.png (and <name>-form.png after a form test)
    and merges an entry into web/src/services/replays.json: the video's length, size, sha-256, Kernel session,
    region and Chrome version, its chapters and measure marks, and the measured facts the demo's report quotes.
    Then it checks those facts say what the demo claims (the parity table) and exits 1 if any don't.

    npm run replays:record                          all four, on Kernel (needs KERNEL_API_KEY; about 45 s each)
    npm run replays:record -- --only northbrew-shop-v1
    npm run replays:record -- --base https://…      the origin the pages are published at (https only)
    npm run replays:record -- --live                fetch the pages from --base instead of this checkout
    npm run replays:record -- --dry                 local Chrome, no recording, nothing written: parity only

    Without --live, the pages come from this checkout: every browser context answers GET <base>/samples/<name>.html
    with the file, and POST <base>/api/subscribe with the 404 Verdikt's not-found handler gives, so the recording
    shows the published address before a deploy. Everything else goes to the network as usual.
    Imports only inspect.js, mp4.js and replay.js: no database, no verify(), no PayPal. Each Kernel session is
    tagged app=verdikt, kind=sample, and any left running at the end is deleted. Idempotent: re-run to refresh.
*/

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { inspectSite } from '../src/agent/inspect.js'
import { mp4Info } from '../src/lib/mp4.js'
import { chaptersOf } from '../src/agent/replay.js'

const SAMPLES = ['northbrew', 'northbrew-shop-v1', 'northbrew-shop-v2', 'northbrew-shop-tampered']
const PLAN = { queries: ['h1', 'a, button', '[class*=cart i]'], paths: [], axe: true, form: true, links: false }
const PAGES = new URL('../../web/public/samples/', import.meta.url)
const REPLAYS = new URL('../../web/public/replays/', import.meta.url)
const INDEX = new URL('../../web/src/services/replays.json', import.meta.url)
const MAX_VIDEO = 5 * 1024 * 1024   // shipped in the web build: a sample clip that big means something went wrong
const TAGS = { app: 'verdikt', kind: 'sample' }
// what Verdikt's own not-found handler answers a POST to an unknown /api/ route (server/src/index.js)
const NOT_FOUND = { status: 404, contentType: 'application/json; charset=utf-8', body: JSON.stringify({ error: 'Not found' }) }

const firstLine = (e) => String(e?.message || e).split('\n')[0].slice(0, 200)
const fail = (msg) => {
  console.error(`replays:record: ${msg}`)
  process.exit(1)
}

let args
try {
  ({ values: args } = parseArgs({
    options: {
      base: { type: 'string', default: 'https://verdikt-leg2.onrender.com' },
      only: { type: 'string' },
      live: { type: 'boolean', default: false },
      dry: { type: 'boolean', default: false },
    },
  }))
} catch (e) {
  fail(firstLine(e))
}
let base
try {
  base = new URL(args.base)
} catch {
  fail(`--base is not a URL: ${args.base}`)
}
if (base.protocol !== 'https:') fail('--base must be an https:// origin')
base = base.origin
if (args.only && !SAMPLES.includes(args.only)) fail(`--only must be one of ${SAMPLES.join(', ')}`)
const names = args.only ? [args.only] : SAMPLES
if (!args.dry && !process.env.KERNEL_API_KEY) fail('needs KERNEL_API_KEY (server/.env) to record on Kernel. Nothing was run. (--dry checks parity locally.)')

const pageUrl = (name) => `${base}/samples/${name}.html`
const serve = args.live ? null : new Map([
  ...SAMPLES.map((name) => [pageUrl(name), { status: 200, contentType: 'text/html; charset=utf-8', body: readFileSync(new URL(`${name}.html`, PAGES)) }]),
  [`POST ${base}/api/subscribe`, NOT_FOUND],
])

/** What the demo's report quotes from one run: the inputs to the server's probe templates, nothing else. */
function factsOf(site) {
  const d = site.views.desktop || {}
  const m = site.views.mobile || {}
  const view = (v) => ({ status: v.status ?? null, loadMs: v.loadMs ?? null, lcpMs: v.lcpMs == null ? null : Math.round(v.lcpMs), consoleErrors: (v.consoleErrors || []).slice(0, 2) })
  return {
    desktop: { ...view(d), failedRequests: (d.failedRequests || []).slice(0, 3), queries: d.queries || {} },
    mobile: { ...view(m), layout: m.layout ? { viewport: m.layout.viewport, scrollWidth: m.layout.scrollWidth, offenders: m.layout.offenders.slice(0, 2) } : null },
    form: site.form && !site.form.error ? { responses: site.form.responses, newText: site.form.newText.slice(0, 2) } : null,
    concealed: (d.concealed || m.concealed || []).slice(0, 1),
    axe: (site.axe?.violations || []).map((v) => v.id),
  }
}

/** The demo's claims about each sample, against what was measured: [what, ok, measured]. */
function parity(name, f) {
  const rows = []
  const row = (what, ok, measured) => rows.push([what, !!ok, measured])
  const sw = f.mobile.layout?.scrollWidth
  const bad = (f.form?.responses || []).filter((r) => Number(/→ (\d{3})/.exec(r)?.[1]) >= 400)
  row('both views answered 200', f.desktop.status === 200 && f.mobile.status === 200, `${f.desktop.status} · ${f.mobile.status}`)
  row('no console errors', !f.desktop.consoleErrors.length && !f.mobile.consoleErrors.length, f.desktop.consoleErrors[0] || f.mobile.consoleErrors[0] || 'none')
  if (name === 'northbrew-shop-v1') {
    row('scrollWidth 412 at 375px', sw === 412, sw)
    row('first offender is div.pricing-card', f.mobile.layout?.offenders[0]?.startsWith('div.pricing-card'), f.mobile.layout?.offenders[0] || 'none')
    row('form posts to a 404', f.form?.responses.includes('POST /api/subscribe → 404'), f.form?.responses.join(' | ') || 'no form test')
  } else {
    row('scrollWidth 375 at 375px', sw === 375, sw)
    row('no form response ≥ 400', f.form && !bad.length, f.form ? bad.join(' | ') || f.form.newText[0] || 'no response' : 'no form test')
  }
  if (name === 'northbrew-shop-tampered') row('hidden text found', f.concealed.length >= 1, f.concealed[0] || 'none')
  else row('no hidden text', !f.concealed.length, f.concealed[0] || 'none')
  return rows
}

/** The checks on the recording itself: [what, ok, measured]. */
function recordingRows(site, info) {
  const marks = site.replay?.marks || []
  const chapters = chaptersOf(marks)
  return [
    ['ran on Kernel', site.env.kind === 'kernel', `${site.env.kind}${site.env.fallback ? ` (fallback ${site.env.fallback})` : ''}`],
    ['a whole MP4', info.ok, info.ok ? `${info.seconds} s` : info.reason],
    ['under 5 MB', (site.replay?.bytes || Infinity) < MAX_VIDEO, site.replay?.bytes ?? 'none'],
    ['at least 2 chapters', chapters.length >= 2, chapters.map((c) => c.label).join(' · ')],
    ['at least 2 measure marks, in the video', marks.filter((m) => m.kind === 'measure' && m.inVideo).length >= 2, marks.filter((m) => m.kind === 'measure').length],
  ]
}

function table(name, rows) {
  console.log(`\n  ${name}`)
  for (const [what, ok, measured] of rows) console.log(`    ${ok ? 'ok  ' : 'FAIL'} ${what.padEnd(38)} ${String(measured).slice(0, 110)}`)
}

/** Objects with their keys in order, recursively (arrays keep theirs): the same recording gives the same file. */
const sorted = (x) => Array.isArray(x) ? x.map(sorted)
  : x && typeof x === 'object' ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, sorted(x[k])]))
    : x

/** Active Kernel sessions with the sample tags: whatever this run (or an earlier one) left running. */
async function leftover() {
  const { default: Kernel } = await import('@onkernel/sdk')
  const client = new Kernel({ apiKey: process.env.KERNEL_API_KEY, timeout: 20_000, maxRetries: 1 })
  const found = []
  for await (const s of client.browsers.list({ tags: TAGS, status: 'active' })) {
    found.push(s)
    if (found.length >= 50) break
  }
  for (const s of found) await client.browsers.deleteByID(s.session_id).catch((e) => console.warn(`    could not delete ${s.session_id}: ${firstLine(e)}`))
  return found.length
}

console.log(`replays:record · ${args.dry ? 'dry run, local Chrome, nothing written' : 'recording on Kernel'} · ${base}/samples/ · pages from ${args.live ? 'the network' : 'this checkout'}`)
const index = existsSync(INDEX) ? JSON.parse(readFileSync(INDEX, 'utf8') || '{}') : {}
const failed = []
for (const name of names) {
  const url = pageUrl(name)
  const t0 = Date.now()
  let site
  try {
    site = await inspectSite(url, PLAN, { record: !args.dry, kind: 'sample', ref: name, serve })
  } catch (e) {
    console.log(`\n  ${name}\n    FAIL the run threw: ${firstLine(e)}`)
    failed.push(name)
    continue
  }
  const facts = factsOf(site)
  const rows = parity(name, facts)
  const info = site.replay?.video ? mp4Info(site.replay.video) : { ok: false, reason: site.replay?.reason || 'no recording' }
  if (!args.dry) rows.push(...recordingRows(site, info))
  table(`${name} · ${((Date.now() - t0) / 1000).toFixed(1)} s`, rows)
  if (rows.some(([, ok]) => !ok)) {
    failed.push(name)
    continue
  }
  if (args.dry) continue

  const r = site.replay
  const file = (suffix) => `/replays/${name}${suffix}`
  writeFileSync(new URL(`${name}.mp4`, REPLAYS), r.video)
  writeFileSync(new URL(`${name}-desktop.png`, REPLAYS), site.views.desktop.screenshot)
  writeFileSync(new URL(`${name}-mobile.png`, REPLAYS), site.views.mobile.screenshot)
  if (site.form?.screenshot) writeFileSync(new URL(`${name}-form.png`, REPLAYS), site.form.screenshot)
  index[name] = {
    url: file('.mp4'),
    poster: file('-desktop.png'),
    shots: { desktop: file('-desktop.png'), mobile: file('-mobile.png'), ...(site.form?.screenshot ? { form: file('-form.png') } : {}) },
    seconds: info.seconds,
    bytes: r.bytes,
    sha256: r.sha256,
    session: r.sessionId,
    region: r.region,
    chrome: r.chrome,
    recordedAt: r.recordedAt,
    chapters: chaptersOf(r.marks),
    marks: r.marks.filter((m) => m.kind === 'measure'),
    facts,
    delivered: url,
  }
  writeFileSync(INDEX, `${JSON.stringify(sorted(index), null, 2)}\n`)
  console.log(`    wrote ${name}.mp4 (${(r.bytes / 1e6).toFixed(2)} MB, ${info.seconds} s), screenshots and replays.json`)
}

if (!args.dry) {
  try {
    const n = await leftover()
    console.log(`\n  Kernel sessions left running with kind=sample: ${n}${n ? ' (deleted)' : ''}`)
  } catch (e) {
    console.log(`\n  could not list Kernel sessions: ${firstLine(e)}`)
  }
}
if (failed.length) {
  console.log(`\nparity FAILED for ${failed.length} of ${names.length} sample(s): ${failed.join(', ')}`)
  process.exit(1)
}
console.log(`\nparity ok for ${names.length} sample${names.length > 1 ? 's' : ''}`)
process.exit(0)
