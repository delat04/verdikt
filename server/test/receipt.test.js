/*  ============================================================================
    The receipt (agent/engine.js receiptOf): a hash of the specs, the evidence and the results, so anyone
    holding the same evidence gets the same receipt. Where the browser ran (env), the recording (replay)
    and its marks describe the run, not the site: adding them must leave the receipt unchanged.
    Pure, no keys, no browser. There is one receipt test file; later cases go here.
    ============================================================================ */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { receiptOf } from '../src/agent/engine.js'

const specs = new Map([
  ['c1', { v: 1, sufficient: true, probes: [{ type: 'loads', viewport: 'both' }] }],
  ['c2', { v: 1, sufficient: true, probes: [{ type: 'no_horizontal_scroll', viewport: 'mobile' }] }],
  ['c3', { v: 1, sufficient: true, probes: [{ type: 'repo_file', path: 'README*' }] }],
])
const facts = () => ({
  site: {
    url: 'https://northbrew.example.test/',
    views: {
      desktop: { status: 200, loadMs: 640, screenshot: Buffer.from('desktop png'), text: 'Northbrew coffee', layout: { scrollWidth: 1440, offenders: [] } },
      mobile: { status: 200, loadMs: 710, screenshot: Buffer.from('mobile png'), text: 'Northbrew coffee', layout: { scrollWidth: 412, offenders: ['section.pricing-card (412px)'] } },
    },
    form: { found: true, responses: ['POST /api/subscribe → 404'], newText: [], screenshot: Buffer.from('form png') },
    subpages: { '/pricing': { status: 200 } },
    links: null,
    axe: { violations: [{ id: 'color-contrast', impact: 'serious', nodes: 2 }] },
    error: null,
  },
  repo: { repo: 'northbrew/site', treeSha: 'b'.repeat(40) },
})
const results = [
  { criterion_id: 'c1', passed: true, layer: 'probe' },
  { criterion_id: 'c2', passed: false, layer: 'probe' },
  { criterion_id: 'c3', passed: true, layer: 'probe' },
]

test('the same specs, facts and results give the same receipt, twice', () => {
  const a = receiptOf(specs, facts(), results)
  const b = receiptOf(specs, facts(), results)
  assert.match(a, /^[0-9a-f]{64}$/)
  assert.equal(a, b)
})

test('env, replay and marks leave the receipt unchanged', () => {
  const plain = receiptOf(specs, facts(), results)
  const recorded = facts()
  recorded.site.browser = 'kernel'
  recorded.site.env = { kind: 'kernel', region: 'us-east', chrome: '141', fallback: null, retry: null }
  recorded.site.replay = {
    video: Buffer.from('mp4 bytes'), seconds: 27.36, bytes: 412000, sha256: 'a'.repeat(64), sessionId: 'sess_9f2c1e',
    replayId: 'rp_1', region: 'us-east', chrome: '141', recordedAt: '2026-11-09T18:00:00.000Z', truncated: false, reason: null,
    marks: [
      { t: 1.2, kind: 'view', label: 'Desktop · 1440px', view: 'desktop', inVideo: true },
      { t: 13.4, kind: 'measure', label: 'Measured at 375px: page is 412px wide, screen is 375px', view: 'mobile', inVideo: true },
    ],
    ms: { create: 900, connect: 600, stop: 200, download: 1100 },
  }
  assert.equal(receiptOf(specs, recorded, results), plain)
  // a local fallback, or a retry after a lost browser, is also a fact about the run
  recorded.site.env = { kind: 'local', region: null, chrome: '142', fallback: 'connect_failed', retry: { at: 'mobile', reason: 'browser_lost' } }
  recorded.site.replay = null
  assert.equal(receiptOf(specs, recorded, results), plain)
})

test('the evidence and the results do change it', () => {
  const plain = receiptOf(specs, facts(), results)
  const wider = facts()
  wider.site.views.mobile.layout.scrollWidth = 420
  assert.notEqual(receiptOf(specs, wider, results), plain)
  const shot = facts()
  shot.site.views.desktop.screenshot = Buffer.from('another png')
  assert.notEqual(receiptOf(specs, shot, results), plain)
  assert.notEqual(receiptOf(specs, facts(), results.map((r) => ({ ...r, passed: true }))), plain)
})

test('the form screenshot is not hashed, the form outcome is', () => {
  const plain = receiptOf(specs, facts(), results)
  const shot = facts()
  shot.site.form.screenshot = Buffer.from('a later frame')
  assert.equal(receiptOf(specs, shot, results), plain)
  const answered = facts()
  answered.site.form.responses = ['POST /api/subscribe → 200']
  assert.notEqual(receiptOf(specs, answered, results), plain)
})

// precedent (E2): the snapshot the model was shown joins the receipt only when there is one
test('without a precedent digest the receipt keeps the original formula', async () => {
  const { createHash } = await import('node:crypto')
  const { ENGINE } = await import('../src/agent/probes.js')
  const sha = (x) => createHash('sha256').update(x).digest('hex')
  const f = facts()
  const views = Object.fromEntries(Object.entries(f.site.views).map(([k, v]) => [k, {
    ...v, screenshot: v.screenshot ? sha(v.screenshot) : null, text: v.text ? sha(v.text) : null,
  }]))
  const digest = sha(JSON.stringify({
    views, form: f.site.form && { ...f.site.form, screenshot: null }, subpages: f.site.subpages, links: f.site.links, axe: f.site.axe,
    repo: f.repo?.treeSha || f.repo?.error || null, ocr: f.ocr ? sha(JSON.stringify(f.ocr)) : null,
  }))
  const legacy = sha(JSON.stringify({ engine: ENGINE, specs: [...specs.entries()], digest, results: results.map((r) => [r.criterion_id, r.passed, r.layer]) }))
  assert.equal(receiptOf(specs, facts(), results), legacy)
  assert.equal(receiptOf(specs, facts(), results, null), legacy)
})

test('a precedent digest changes the receipt, deterministically', () => {
  const plain = receiptOf(specs, facts(), results)
  const a = receiptOf(specs, facts(), results, 'a'.repeat(64))
  assert.match(a, /^[0-9a-f]{64}$/)
  assert.notEqual(a, plain)
  assert.equal(receiptOf(specs, facts(), results, 'a'.repeat(64)), a)
  assert.notEqual(receiptOf(specs, facts(), results, 'b'.repeat(64)), a)
})

// precedent (E3): the digest a verdict stores, end to end from what the search answered
test('the precedent the model saw moves the receipt; a search that timed out leaves it as before', async () => {
  const { precedentReport } = await import('../src/lib/precedent.js')
  const judged = [{ id: 'c1' }]
  const seen = (met) => ({ status: 'ok', ms: 40, corpus: 12, map: new Map([['c1', [{ id: 'case-1', met, score: 0.41 }]]]) })
  const digest = (pre) => precedentReport(pre, judged).report.digest
  const plain = receiptOf(specs, facts(), results)
  const withCases = receiptOf(specs, facts(), results, digest(seen(true)))
  assert.notEqual(withCases, plain)
  assert.equal(receiptOf(specs, facts(), results, digest(seen(true))), withCases)
  assert.notEqual(receiptOf(specs, facts(), results, digest(seen(false))), withCases)
  assert.equal(receiptOf(specs, facts(), results, digest({ status: 'timeout', ms: 4000, map: new Map(), corpus: null })), plain)
})
