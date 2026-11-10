/*  ============================================================================
    The verdict over MCP (agent/verdictView.js): the recording, and seen_at on each failed check. Pure: the
    rows get_verdict and wait_for_verdict load, no Supabase.
    ============================================================================ */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { verdictView, recordingOf, seenAt, RECORDING_NOTE } from '../src/agent/verdictView.js'

const MILESTONE = {
  status: 'failed', amount_cents: 120000, released_cents: 0, tranches: [],
  criteria: [
    { id: 'c2', statement: 'Nothing scrolls sideways at 375px.', position: 2 },
    { id: 'c1', statement: 'The page loads.', position: 1 },
  ],
}
const REPLAY = {
  url: 'https://example.supabase.co/storage/v1/object/public/evidence/m/s/replay-0123456789abcdef.mp4',
  sha256: 'a'.repeat(64), bytes: 412000, seconds: 27.36, session: 'sess_9f2c1e', replayId: 'rp_1',
  recordedAt: '2026-11-09T18:00:00.000Z', region: 'us-east', truncated: false, by: 'kernel',
  chapters: [
    { t: 1.2, label: 'Desktop · 1440px', kind: 'view', view: 'desktop', inVideo: true },
    { t: 11.5, label: 'Phone · 375px', kind: 'view', view: 'mobile', inVideo: true },
  ],
  marks: [],
}
const verdict = (report) => ({
  outcome: 'fail', summary: '1 of 2 checks not met yet.',
  report: { ...report, engine: { decided: { probe: 2 }, tokens: { input: 0, output: 0 }, ms: { total: 31000 }, receipt: 'r'.repeat(64) } },
  criterion_results: [
    { criterion_id: 'c1', passed: true, layer: 'probe', explanation: 'Met.', evidence: [{ type: 'moment', t: 4.8, label: 'Desktop · 1440px', view: 'desktop' }] },
    { criterion_id: 'c2', passed: false, layer: 'probe', explanation: 'At 375px the page is 412px wide.', evidence: [{ type: 'moment', t: 13.4, label: 'Phone · 375px', view: 'mobile' }, { type: 'screenshot', label: 'Mobile · 375px', url: 'x' }] },
  ],
})

test('wait_for_verdict: the recording, and seen_at on the failed check only', () => {
  const out = verdictView(MILESTONE, verdict({ site: { recording: 'recorded' }, replay: REPLAY }), { full: true })
  assert.deepEqual(out.recording, {
    video: REPLAY.url, length: '0:27', sha256: REPLAY.sha256, kernel_session: 'sess_9f2c1e', recorded_at: REPLAY.recordedAt,
    chapters: ['0:01 Desktop · 1440px', '0:11 Phone · 375px'], note: RECORDING_NOTE,
  })
  assert.match(out.recording.length, /^\d+:\d\d$/)
  assert.deepEqual(out.checks.map((c) => c.id), ['c1', 'c2'])
  assert.equal(out.checks[0].seen_at, undefined)
  assert.equal(out.checks[1].seen_at, '0:13 · Phone · 375px')
  assert.equal(out.checks[1].decided_by, 'probe')
  assert.equal(out.money.held, '$1,200.00')
  assert.equal(out.engine.took_ms, 31000)
  assert.equal('replay_video' in out, false)
})

test('get_verdict: the same recording and seen_at, without engine or money', () => {
  const out = verdictView(MILESTONE, verdict({ site: { recording: 'recorded' }, replay: REPLAY }))
  assert.equal(out.recording.length, '0:27')
  assert.equal(out.checks[1].seen_at, '0:13 · Phone · 375px')
  assert.equal('engine' in out || 'money' in out, false)
  assert.equal('id' in out.checks[0], false)
})

test('an older report ({ url, seconds }) gives a recording without chapters and does not throw', () => {
  const old = verdict({ site: { url: 'https://x.dev', error: null, browser: 'kernel' }, replay: { url: 'https://x/replay.mp4', seconds: 26.58, by: 'kernel' } })
  old.criterion_results = old.criterion_results.map(({ evidence, ...r }) => r)
  const out = verdictView(MILESTONE, old, { full: true })
  assert.deepEqual(out.recording, { video: 'https://x/replay.mp4', length: '0:26', note: RECORDING_NOTE })
  assert.equal(out.checks[1].seen_at, undefined)
})

test('no video says why: Kernel without a recording, a fallback to this server, or nothing for a local run', () => {
  assert.match(recordingOf({ site: { browser: 'kernel', region: 'us-east', recording: 'no_video' } }).unavailable,
    /^Checked in Kernel’s cloud browser · us-east\. The recording couldn’t be saved, so there’s no video this time\./)
  assert.match(recordingOf({ site: { browser: 'local', fallback: 'create_failed', recording: null } }).unavailable,
    /^Checked on Verdikt’s server: Kernel didn’t start a browser, so there’s no recording this time\./)
  assert.match(recordingOf({ site: { recording: 'upload_failed' } }).unavailable, /couldn’t be stored/)
  assert.equal(recordingOf({ site: { browser: 'local', recording: null } }), null)
  assert.equal(recordingOf(null), null)
  const out = verdictView(MILESTONE, verdict({ site: { browser: 'local', recording: null } }))
  assert.equal('recording' in out, false)
})

test('seenAt reads the moment evidence', () => {
  assert.equal(seenAt([{ type: 'screenshot' }, { type: 'moment', t: 73.4, label: 'Form test' }]), '1:13 · Form test')
  assert.equal(seenAt([]), undefined)
  assert.equal(seenAt(null), undefined)
})
