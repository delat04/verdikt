/*  ============================================================================
    The Kernel session lifecycle (lib/kernel.js) against a fake client, a fake CDP connect and a sleep that
    doesn't wait: every way Kernel can fail mid-run, the order the session is wound down in, and the marks.
    No key, no network, no session: the "key" below is a stand-in that must never show up in an error.
    ============================================================================ */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'

// read when kernel.js loads, so it is set before the import below (a static import would run first)
const FAKE_KEY = 'test-kernel-key-61af'
process.env.KERNEL_API_KEY = FAKE_KEY
process.env.KERNEL_MAX_BROWSERS = '3'
const { cloudBrowser, KernelUnavailable, kernelOn, kernelSlotFree } = await import('../src/lib/kernel.js')
const { mp4Info } = await import('../src/lib/mp4.js')

// a real recording: the first one shipped with the web app
const REPLAYS = new URL('../../web/public/replays/', import.meta.url)
const SAMPLE = readFileSync(new URL(readdirSync(REPLAYS).filter((f) => f.endsWith('.mp4')).sort()[0], REPLAYS))
const SECONDS = mp4Info(SAMPLE).seconds
// what Kernel's download answers before the file is ready: an error page, big enough to pass the size check
const HTML = Buffer.from('<!doctype html><title>Not ready</title>'.padEnd(12_000, ' '))

/** A fake Kernel client and CDP connect that log every call in order. */
function fakes({ create, start, stop, downloads = [SAMPLE], del, connect } = {}) {
  const calls = []
  const sleeps = []
  let n = 0
  const client = {
    browsers: {
      create: async (params) => {
        calls.push(['create', params])
        if (create) return create(params)
        return { session_id: 'sess_abc123', cdp_ws_url: 'wss://proxy.example.test/cdp?jwt=secret', region: 'us-east', browser_live_view_url: 'https://live.example.test/x' }
      },
      deleteByID: async (id) => { calls.push(['deleteByID', id]); if (del) return del() },
      replays: {
        start: async (id, params) => { calls.push(['start', id, params]); if (start) return start(); return { replay_id: 'rep_1', started_at: '2026-11-09T12:00:00Z' } },
        stop: async (rid, params) => { calls.push(['stop', rid, params]); if (stop) return stop() },
        download: async (rid, params) => {
          calls.push(['download', rid, params])
          const body = downloads[Math.min(n++, downloads.length - 1)]
          if (body instanceof Error) throw body
          return new Response(body)
        },
      },
    },
  }
  const browser = { version: () => '141.0.0', close: async () => { calls.push(['close']) }, on: () => {}, isConnected: () => true }
  return {
    calls, sleeps, browser,
    names: () => calls.map((c) => c[0]),
    opts: {
      client,
      connect: async (url) => { calls.push(['connect', url]); if (connect) return connect(); return browser },
      sleep: async (ms) => { sleeps.push(ms) },
    },
  }
}

const count = (f, name) => f.names().filter((n) => n === name).length

// ---------------------------------------------------------------- no Kernel browser
test('create rejects: KernelUnavailable create_failed, and nothing to delete', async () => {
  const f = fakes({ create: () => { throw new Error(`401 Unauthorized: bad key ${FAKE_KEY}\nstack line`) } })
  await assert.rejects(cloudBrowser(f.opts), (e) => {
    assert.ok(e instanceof KernelUnavailable && e instanceof Error)
    assert.equal(e.reason, 'create_failed')
    assert.ok(!e.message.includes(FAKE_KEY), 'the key leaked into the error')
    assert.ok(!e.message.includes('stack line'))
    return true
  })
  assert.deepEqual(f.names(), ['create'])
  assert.equal(count(f, 'deleteByID'), 0)
})

test('create answers without a session id: create_failed', async () => {
  const f = fakes({ create: () => ({ cdp_ws_url: 'wss://proxy.example.test/cdp' }) })
  await assert.rejects(cloudBrowser(f.opts), (e) => e.reason === 'create_failed')
})

test('connect rejects: the session is deleted, then KernelUnavailable connect_failed without the CDP token', async () => {
  const f = fakes({ connect: () => { throw new Error('browserType.connectOverCDP: WebSocket error: wss://proxy.example.test/cdp?jwt=secret 403') } })
  await assert.rejects(cloudBrowser(f.opts), (e) => {
    assert.ok(e instanceof KernelUnavailable)
    assert.equal(e.reason, 'connect_failed')
    assert.ok(!e.message.includes('jwt') && !e.message.includes('secret'), e.message)
    assert.match(e.message, /wss:\/\/proxy\.example\.test/)
    return true
  })
  assert.deepEqual(f.names(), ['create', 'connect', 'deleteByID'])
})

// ---------------------------------------------------------------- the session itself
test('create is named and tagged; the live view and CDP URLs stay out of the result', async () => {
  const f = fakes()
  const cloud = await cloudBrowser({ ...f.opts, kind: 'smoke', ref: '7f3c2a10-1111-2222-3333-444455556666-extra' })
  const params = f.calls[0][1]
  assert.equal(params.timeout_seconds, 90)
  assert.deepEqual(params.viewport, { width: 1440, height: 900 })
  assert.equal(params.start_url, 'about:blank')
  assert.match(params.name, /^verdikt-smoke-7f3c2a10-[0-9a-z]+$/)
  assert.deepEqual(params.tags, { app: 'verdikt', env: process.env.NODE_ENV || 'dev', kind: 'smoke', ref: '7f3c2a10-1111-2222-3333-444455556666' })
  assert.equal(cloud.sessionId, 'sess_abc123')
  assert.equal(cloud.region, 'us-east')
  assert.equal(cloud.chrome, '141')
  assert.equal(cloud.recording, true)
  const out = await cloud.finish()
  const json = JSON.stringify({ ...out, video: null }) + JSON.stringify({ ...cloud, browser: null })
  assert.ok(!json.includes('live.example.test') && !json.includes('jwt='), 'a session URL leaked')
  // an empty ref is left out of the tags rather than sent as ''
  const g = fakes()
  await (await cloudBrowser(g.opts)).finish()
  assert.deepEqual(g.calls[0][1].tags, { app: 'verdikt', env: process.env.NODE_ENV || 'dev', kind: 'verify' })
})

test('replays.start rejects: the check runs unrecorded, finish() says no_recording and deletes', async (t) => {
  const warn = t.mock.method(console, 'warn', () => {})
  const f = fakes({ start: () => { throw new Error('replays not enabled') } })
  const cloud = await cloudBrowser(f.opts)
  assert.equal(cloud.recording, false)
  cloud.mark('view', 'Desktop · 1440px', { view: 'desktop' })
  const out = await cloud.finish()
  assert.equal(out.video, null)
  assert.equal(out.reason, 'no_recording')
  assert.deepEqual(out.marks, [])
  assert.equal(out.replayId, null)
  assert.equal(out.recordedAt, null)
  assert.deepEqual(f.names(), ['create', 'connect', 'start', 'close', 'deleteByID'])
  assert.deepEqual(warn.mock.calls[0].arguments.slice(0, 2), ['kernel: replay did not start', 'sess_abc123'])
})

test('record false: no recorder, no reason, still deleted', async () => {
  const f = fakes()
  const out = await (await cloudBrowser({ ...f.opts, record: false })).finish()
  assert.equal(out.reason, null)
  assert.deepEqual(f.names(), ['create', 'connect', 'close', 'deleteByID'])
})

// ---------------------------------------------------------------- winding down
test('finish order is stop < close < download < deleteByID, once, and the result is audited', async () => {
  const f = fakes()
  const cloud = await cloudBrowser(f.opts)
  const out = await cloud.finish()
  const at = (name) => f.names().indexOf(name)
  assert.ok(at('stop') < at('close') && at('close') < at('download') && at('download') < at('deleteByID'), f.names().join(' < '))
  assert.deepEqual(f.names(), ['create', 'connect', 'start', 'stop', 'close', 'download', 'deleteByID'])
  assert.deepEqual(f.calls[2].slice(1), ['sess_abc123', { framerate: 12, max_duration_in_seconds: 240 }])
  assert.deepEqual(f.calls[3].slice(1), ['rep_1', { id_or_name: 'sess_abc123' }])
  assert.deepEqual(f.calls[5].slice(1), ['rep_1', { id_or_name: 'sess_abc123' }])
  assert.ok(out.video.equals(SAMPLE))
  assert.equal(out.seconds, SECONDS)
  assert.equal(out.bytes, SAMPLE.length)
  assert.match(out.sha256, /^[0-9a-f]{64}$/)
  assert.equal(out.sessionId, 'sess_abc123')
  assert.equal(out.replayId, 'rep_1')
  assert.equal(out.region, 'us-east')
  assert.equal(out.chrome, '141')
  assert.equal(out.recordedAt, '2026-11-09T12:00:00Z')
  assert.equal(out.reason, null)
  assert.deepEqual(Object.keys(out.ms), ['create', 'connect', 'stop', 'download'])
  assert.ok(Object.values(out.ms).every((v) => Number.isFinite(v) && v >= 0))
  // a second finish() returns the same result and touches nothing
  assert.equal(await cloud.finish(), out)
  assert.equal(f.names().length, 7)
})

test('stop rejects: the download is still attempted', async (t) => {
  t.mock.method(console, 'warn', () => {})
  const f = fakes({ stop: () => { throw new Error('replay already stopped') } })
  const out = await (await cloudBrowser(f.opts)).finish()
  assert.deepEqual(f.names(), ['create', 'connect', 'start', 'stop', 'close', 'download', 'deleteByID'])
  assert.ok(out.video)
})

test('close rejects: download and delete still run', async (t) => {
  t.mock.method(console, 'warn', () => {})
  const f = fakes()
  f.browser.close = async () => { f.calls.push(['close']); throw new Error('Target closed') }
  const out = await (await cloudBrowser(f.opts)).finish()
  assert.deepEqual(f.names(), ['create', 'connect', 'start', 'stop', 'close', 'download', 'deleteByID'])
  assert.ok(out.video)
})

test('download returns HTML twice, then the MP4: video set on the third attempt', async () => {
  const f = fakes({ downloads: [HTML, HTML, SAMPLE] })
  const out = await (await cloudBrowser(f.opts)).finish()
  assert.equal(count(f, 'download'), 3)
  assert.deepEqual(f.sleeps, [500, 1500, 4000])
  assert.ok(out.video.equals(SAMPLE))
  assert.equal(out.reason, null)
})

test('a thrown download counts as an attempt and is retried', async () => {
  const f = fakes({ downloads: [new Error('404 replay not found'), SAMPLE] })
  const out = await (await cloudBrowser(f.opts)).finish()
  assert.equal(count(f, 'download'), 2)
  assert.ok(out.video)
})

test('every download invalid: no_video after 3 attempts, still deleted', async (t) => {
  const warn = t.mock.method(console, 'warn', () => {})
  const f = fakes({ downloads: [HTML] })
  const cloud = await cloudBrowser(f.opts)
  cloud.mark('view', 'Desktop · 1440px', { view: 'desktop' })
  const out = await cloud.finish()
  assert.equal(count(f, 'download'), 3)
  assert.equal(f.names().at(-1), 'deleteByID')
  assert.equal(out.video, null)
  assert.equal(out.seconds, null)
  assert.equal(out.sha256, null)
  assert.equal(out.reason, 'no_video')
  assert.equal(out.marks[0].inVideo, false)
  assert.equal(out.truncated, true)
  assert.deepEqual(warn.mock.calls.at(-1).arguments, ['kernel: no valid video', 'sess_abc123', 'not_mp4'])
})

test('delete fails once: retried after 1 s; fails twice: a warning with the id, finish still resolves', async (t) => {
  const warn = t.mock.method(console, 'warn', () => {})
  let fails = 1
  const f = fakes({ del: () => { if (fails-- > 0) throw new Error('503') } })
  await (await cloudBrowser(f.opts)).finish()
  assert.equal(count(f, 'deleteByID'), 2)
  assert.ok(f.sleeps.includes(1000))
  assert.equal(warn.mock.calls.length, 0)
  const g = fakes({ del: () => { throw new Error(`503 ${FAKE_KEY}`) } })
  const out = await (await cloudBrowser(g.opts)).finish()
  assert.ok(out.video)
  assert.equal(count(g, 'deleteByID'), 2)
  const last = warn.mock.calls.at(-1).arguments
  assert.deepEqual(last.slice(0, 2), ['kernel: session not deleted', 'sess_abc123'])
  assert.ok(!last.join(' ').includes(FAKE_KEY))
})

// ---------------------------------------------------------------- marks
test('marks: tenths of a second from the recorder start, non-decreasing, capped at 40, inVideo against the real length', async (t) => {
  let now = 1_000_000
  t.mock.method(Date, 'now', () => now)
  const f = fakes()
  const cloud = await cloudBrowser(f.opts)          // t0 = 1_000_000
  now += 1234; cloud.mark('view', 'Desktop · 1440px', { view: 'desktop' })
  now += 4000; cloud.mark('measure', 'Measured at 1440px: HTTP 200 in 1.2 s', { view: 'desktop' })
  now += 3000; cloud.mark('view', 'Phone · 375px', { view: 'mobile' })
  // within the last 0.2 s of the video: past what can be watched
  now = 1_000_000 + Math.round((SECONDS - 0.1) * 1000); cloud.mark('measure', 'Measured at 375px: nothing wider than the screen', { view: 'mobile' })
  for (let i = 0; i < 50; i++) cloud.mark('page', `/p${i}`, { path: `/p${i}` })
  const out = await cloud.finish()
  cloud.mark('page', '/late')                       // after finish: ignored
  assert.equal(out.marks.length, 40)
  assert.deepEqual(out.marks[0], { t: 1.2, kind: 'view', label: 'Desktop · 1440px', view: 'desktop', inVideo: true })
  assert.deepEqual(out.marks.slice(0, 3).map((m) => m.t), [1.2, 5.2, 8.2])
  for (let i = 1; i < out.marks.length; i++) assert.ok(out.marks[i].t >= out.marks[i - 1].t, `mark ${i} goes back in time`)
  for (const m of out.marks) assert.equal(m.inVideo, m.t <= SECONDS - 0.2, `${m.label} at ${m.t} s`)
  assert.equal(out.marks[2].inVideo, true)
  assert.equal(out.marks[3].inVideo, false)
  assert.equal(out.truncated, true)
})

test('kernelOn reads the key once, at load', () => {
  assert.equal(kernelOn(), true)
})

// ---------------------------------------------------------------- the session cap (KERNEL_MAX_BROWSERS)

test('with max 3 the 4th session is kernel_busy, and starts once a finish() frees a slot', async () => {
  const open = await Promise.all([1, 2, 3].map(() => cloudBrowser(fakes().opts)))
  assert.equal(kernelSlotFree(), false)
  const f = fakes()
  await assert.rejects(cloudBrowser({ ...f.opts, wait: 50 }), (e) => {
    assert.ok(e instanceof KernelUnavailable)
    assert.equal(e.reason, 'kernel_busy')
    return true
  })
  assert.equal(count(f, 'create'), 0, 'no session is created above the cap')
  // a waiting run gets the slot the moment one finishes
  const waiting = cloudBrowser({ ...fakes().opts, wait: 5_000 })
  await open[0].finish()
  const fourth = await waiting
  await Promise.all([fourth, ...open.slice(1)].map((c) => c.finish()))
  assert.equal(kernelSlotFree(), true)
})

test('a failed create or connect gives its slot back', async () => {
  for (let i = 0; i < 4; i++) {
    await assert.rejects(cloudBrowser(fakes({ create: () => { throw new Error('quota') } }).opts), (e) => e.reason === 'create_failed')
    await assert.rejects(cloudBrowser(fakes({ connect: () => { throw new Error('refused') } }).opts), (e) => e.reason === 'connect_failed')
  }
  assert.equal(kernelSlotFree(), true)
  await (await cloudBrowser(fakes().opts)).finish()
})
