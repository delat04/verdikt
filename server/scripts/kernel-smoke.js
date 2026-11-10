/*  Kernel smoke run: one real, recorded session, opt-in (it uses a Kernel browser; the tests never do)
    1. runs the verifier's browser on Kernel against https://example.com, exactly as an official check does
       (recorded, narrated, desktop then phone, accessibility scan, no form test)
    2. prints where it ran, how long each Kernel call took, the video and its marks
    3. checks the run was on Kernel, the video is a whole MP4, and the marks are in order and inside the video
    4. lists the sessions still running with this run's tags, deletes any it finds, and prints 'sessions left: N'

    npm run kernel:smoke            (needs KERNEL_API_KEY in server/.env; exits 1 on any failure)

    Each session is tagged app=verdikt, kind=smoke in Kernel's dashboard. Nothing is stored: the video stays
    in memory and only its length, size and hash are printed.
*/

import { randomUUID } from 'node:crypto'
import { inspectSite } from '../src/agent/inspect.js'
import { kernelOn } from '../src/lib/kernel.js'
import { mp4Info } from '../src/lib/mp4.js'

const URL_UNDER_TEST = 'https://example.com'
const TAGS = { app: 'verdikt', kind: 'smoke' }
// the marks a recorded run leaves for the two views, in the order they must appear
const ORDER = [['view', 'desktop'], ['measure', 'desktop'], ['view', 'mobile'], ['measure', 'mobile']]

const failures = []
const check = (ok, what) => {
  console.log(`    ${ok ? 'ok  ' : 'FAIL'} ${what}`)
  if (!ok) failures.push(what)
}
const step = (n, msg) => console.log(`\n[${n}] ${msg}`)
const firstLine = (e) => String(e?.message || e).split('\n')[0].slice(0, 200)

/** Active sessions carrying the smoke tags, from Kernel itself: whatever this run (or an earlier one) left running. */
async function smokeSessions(client) {
  const found = []
  for await (const s of client.browsers.list({ tags: TAGS, status: 'active' })) {
    found.push(s)
    if (found.length >= 100) break
  }
  return found
}

if (!kernelOn()) {
  console.error('kernel:smoke needs KERNEL_API_KEY (server/.env). Nothing was run.')
  process.exit(1)
}

const { default: Kernel } = await import('@onkernel/sdk')
const client = new Kernel({ apiKey: process.env.KERNEL_API_KEY, timeout: 20_000, maxRetries: 1 })
const ref = `smoke-${randomUUID().slice(0, 8)}`

try {
  step(1, `Checking ${URL_UNDER_TEST} on Kernel, recorded (ref ${ref})…`)
  const t0 = Date.now()
  const steps = []
  const out = await inspectSite(URL_UNDER_TEST, { axe: true, form: false }, {
    record: true, kind: 'smoke', ref, onStep: (d) => steps.push(d.step === 'page' ? `page ${d.path}` : d.step),
  })
  console.log(`    done in ${((Date.now() - t0) / 1000).toFixed(1)} s · steps ${steps.join(' → ')}`)

  step(2, 'What came back')
  const { env, replay } = out
  console.log(`    env      kind ${env.kind} · region ${env.region ?? '-'} · Chrome ${env.chrome ?? '-'} · fallback ${env.fallback ?? 'none'} · retry ${env.retry ? `at ${env.retry.at}` : 'none'}`)
  for (const name of ['desktop', 'mobile']) {
    const v = out.views[name] || {}
    console.log(`    ${name.padEnd(8)} ${v.error ? `error: ${v.error}` : `HTTP ${v.status} in ${v.loadMs} ms`}`)
  }
  console.log(`    axe      ${out.axe ? `${out.axe.violations?.length ?? 0} violation(s)` : 'not run'}`)
  if (replay) {
    const ms = Object.entries(replay.ms || {}).map(([k, v]) => `${k} ${v ?? '-'}`).join(' · ')
    console.log(`    ms       ${ms}`)
    console.log(`    video    ${replay.seconds ?? '-'} s · ${replay.bytes ?? '-'} bytes · sha256 ${replay.sha256 ? replay.sha256.slice(0, 16) : '-'} · reason ${replay.reason ?? 'none'}`)
    console.log(`    session  ${String(replay.sessionId).slice(0, 8)} · replay ${replay.replayId ?? '-'} · recorded at ${replay.recordedAt ?? '-'}`)
    console.log('    marks')
    for (const m of replay.marks) {
      console.log(`      ${m.t.toFixed(1).padStart(6)} s  ${m.kind.padEnd(7)} ${m.inVideo ? '' : '(past the end) '}${m.label}`)
    }
  } else {
    console.log('    replay   none')
  }

  step(3, 'Checks')
  check(env.kind === 'kernel', `ran on Kernel (env.kind ${env.kind}${env.fallback ? `, fallback ${env.fallback}` : ''})`)
  check(!out.error && !out.views.desktop?.error && !out.views.mobile?.error, 'both views loaded')
  const info = replay?.video ? mp4Info(replay.video) : { ok: false, reason: replay?.reason || 'no replay' }
  check(info.ok, info.ok ? 'video ok' : `video: ${info.reason}`)
  if (info.ok) check(Math.abs(info.seconds - replay.seconds) < 0.01, `the stated length is the file's own (${info.seconds} s)`)
  const marks = replay?.marks || []
  check(marks.length > 0 && marks.every((m, i) => i === 0 || m.t >= marks[i - 1].t), `${marks.length} marks, in time order`)
  check(marks.length > 0 && marks.every((m) => m.inVideo), 'every mark is inside the video')
  const at = ORDER.map(([kind, view]) => marks.findIndex((m) => m.kind === kind && m.view === view))
  check(at.every((i) => i >= 0) && at.every((i, n) => n === 0 || i > at[n - 1]),
    `marks in order: ${ORDER.map(([kind, view]) => `${kind} ${view}`).join(' < ')}`)
  // the region isn't requested, so any is fine, as long as Kernel says which one ran the check
  check(!!env.region && env.region === replay?.region, `region stated: ${env.region ?? 'none'}`)
} catch (e) {
  check(false, `the run threw: ${firstLine(e)}`)
} finally {
  // inspectSite deletes its session itself; this is the proof, and the cleanup when something went wrong
  step(4, 'Sessions still running with app=verdikt, kind=smoke')
  try {
    let left = await smokeSessions(client)
    // a delete can take a moment to show: look again before calling anything a leak
    for (let i = 0; i < 3 && left.length; i++) {
      await new Promise((resolve) => setTimeout(resolve, 2000))
      left = await smokeSessions(client)
    }
    if (left.length) {
      check(false, `${left.length} session(s) were left running: ${left.map((s) => s.session_id).join(', ')}`)
      for (const s of left) {
        await client.browsers.deleteByID(s.session_id).then(
          () => console.log(`    deleted ${s.session_id}`),
          (e) => console.log(`    could not delete ${s.session_id}: ${firstLine(e)}`),
        )
      }
      left = await smokeSessions(client)
    }
    console.log(`    sessions left: ${left.length}`)
    if (left.length) failures.push('sessions left running')
  } catch (e) {
    check(false, `could not list sessions: ${firstLine(e)}`)
  }
}

if (failures.length) {
  console.log(`\nkernel:smoke failed: ${failures.length} check(s)`)
  process.exit(1)
}
console.log('\nkernel:smoke passed')
process.exit(0)
