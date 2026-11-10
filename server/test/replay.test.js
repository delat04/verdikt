/*  ============================================================================
    The recording bound to the verdict (agent/replay.js): clock, chapters, and the second in the video each
    check is placed at. Pure, no keys, no browser.
    ============================================================================ */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { clock, chaptersOf, momentFor } from '../src/agent/replay.js'

// one recorded run, as kernel.js finish() returns its marks: desktop, its form test, phone, one sub-page
const MARKS = [
  { t: 1.2, kind: 'view', label: 'Desktop · 1440px', view: 'desktop', inVideo: true },
  { t: 4.8, kind: 'measure', label: 'Measured at 1440px: HTTP 200 in 0.6 s', view: 'desktop', inVideo: true },
  { t: 7.9, kind: 'form', label: 'Form test', view: 'desktop', inVideo: true },
  { t: 11.5, kind: 'view', label: 'Phone · 375px', view: 'mobile', inVideo: true },
  { t: 13.4, kind: 'measure', label: 'Measured at 375px: page is 412px wide, screen is 375px', view: 'mobile', inVideo: true },
  { t: 17.0, kind: 'page', label: '/pricing', path: '/pricing', inVideo: true },
]
const probe = (type, status, extra = {}) => ({ type, status, observed: '', ...extra })

test('clock reads m:ss', () => {
  assert.equal(clock(0), '0:00')
  assert.equal(clock(73.4), '1:13')
  assert.equal(clock(9.99), '0:09')
  assert.equal(clock(600), '10:00')
  assert.equal(clock(null), '0:00')
  assert.equal(clock(-3), '0:00')
})

test('chaptersOf keeps views, the form test and sub-pages, never measure marks', () => {
  const ch = chaptersOf(MARKS)
  assert.deepEqual(ch.map((c) => c.label), ['Desktop · 1440px', 'Form test', 'Phone · 375px', '/pricing'])
  assert.ok(ch.every((c) => c.kind !== 'measure'))
  assert.deepEqual(ch[3], { t: 17.0, label: '/pricing', kind: 'page', path: '/pricing', inVideo: true })
  assert.deepEqual(ch[0], { t: 1.2, label: 'Desktop · 1440px', kind: 'view', view: 'desktop', inVideo: true })
  assert.deepEqual(chaptersOf(undefined), [])
})

test('a failed no_horizontal_scroll is the phone measurement', () => {
  const m = momentFor({ probes: [probe('no_horizontal_scroll', 'fail')], evidence: ['mobile', 'layout'] }, MARKS)
  assert.deepEqual(m, { type: 'moment', t: 13.4, label: 'Phone · 375px', view: 'mobile' })
})

test('page probes follow their viewport, then 375px in what they observed', () => {
  assert.equal(momentFor({ probes: [probe('loads', 'pass', { viewport: 'mobile' })] }, MARKS).t, 13.4)
  assert.equal(momentFor({ probes: [probe('text_present', 'pass', { viewport: 'desktop' })] }, MARKS).t, 4.8)
  assert.equal(momentFor({ probes: [probe('loads', 'fail', { viewport: 'both', observed: 'At 375px the page did not load: timeout.' })] }, MARKS).view, 'mobile')
  assert.equal(momentFor({ probes: [probe('lcp_under', 'pass', { observed: 'LCP 1.2 s at 1440px.' })] }, MARKS).view, 'desktop')
  assert.equal(momentFor({ probes: [probe('accessibility', 'fail')] }, MARKS).t, 4.8)
  assert.equal(momentFor({ probes: [probe('no_failed_requests', 'fail')] }, MARKS).t, 4.8)
})

test('form_submits is the form test, page_exists its sub-page', () => {
  assert.deepEqual(momentFor({ probes: [probe('form_submits', 'fail')] }, MARKS), { type: 'moment', t: 7.9, label: 'Form test', view: 'desktop' })
  assert.deepEqual(momentFor({ probes: [probe('page_exists', 'pass', { path: '/pricing' })] }, MARKS), { type: 'moment', t: 17.0, label: '/pricing', view: 'desktop' })
  assert.equal(momentFor({ probes: [probe('page_exists', 'fail', { path: '/about' })] }, MARKS), null)
})

test('links and the repository are not in the video', () => {
  assert.equal(momentFor({ probes: [probe('links_work', 'fail')], evidence: ['links'] }, MARKS), null)
  assert.equal(momentFor({ probes: [probe('repo_file', 'fail'), probe('repo_no_secrets', 'pass')], evidence: ['repo'] }, MARKS), null)
})

test('the failing probe wins over a passing one, then unknown, whatever their order', () => {
  const probes = [probe('text_present', 'pass', { viewport: 'desktop' }), probe('loads', 'unknown', { viewport: 'desktop' }), probe('form_submits', 'fail')]
  assert.equal(momentFor({ probes }, MARKS).label, 'Form test')
  assert.equal(momentFor({ probes: probes.slice(0, 2).concat(probe('no_horizontal_scroll', 'unknown')).reverse() }, MARKS).view, 'mobile')
})

test('a model check with only evidence keys follows them: form, then phone, then desktop', () => {
  assert.equal(momentFor({ probes: [], evidence: ['desktop'] }, MARKS).t, 4.8)
  assert.equal(momentFor({ probes: [], evidence: ['desktop', 'layout'] }, MARKS).t, 13.4)
  assert.equal(momentFor({ probes: [], evidence: ['text', 'mobile', 'form'] }, MARKS).t, 7.9)
  assert.equal(momentFor({ probes: [probe('links_work', 'fail')], evidence: ['links', 'console'] }, MARKS).t, 4.8)
  assert.equal(momentFor({ probes: [], evidence: ['repo'] }, MARKS), null)
  assert.equal(momentFor({}, MARKS), null)
})

test('a mark the video ends before is skipped', () => {
  const cut = MARKS.map((m) => (m.view === 'mobile' && m.kind === 'measure' ? { ...m, inVideo: false } : m))
  assert.equal(momentFor({ probes: [probe('no_horizontal_scroll', 'fail')] }, cut), null)
  // the evidence fallback skips it too, and lands on the next place it can
  assert.equal(momentFor({ probes: [], evidence: ['mobile', 'desktop'] }, cut).t, 4.8)
})

test('the same result and marks always give the same moment', () => {
  const r = { probes: [probe('element', 'fail', { viewport: 'both', observed: 'At 375px 0 visible .cart.' }), probe('loads', 'pass')], evidence: ['desktop'] }
  assert.deepEqual(momentFor(r, MARKS), momentFor(structuredClone(r), structuredClone(MARKS)))
})
