/*  ============================================================================
    The demo's precedent (web/src/services/demoPrecedent.js) and the shared words both sides read it in
    (agent/precedent.js ↔ web/src/domain/precedent.js). The demo has no Elastic: it ranks a fixed set of
    sample cases by word overlap, so its answers are checked here exactly, and its stance has to come out of
    the same rule the verifier uses.
    ============================================================================ */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { stanceOf as liveStance } from '../src/lib/precedent.js'
import { stanceOf, decidedBy, bandLabel, firstSentence } from '../src/agent/precedent.js'

const { samplePrecedent, sampleTrackRecord, SAMPLE_CASES, FLOOR } = await import('../../web/src/services/demoPrecedent.js')

const FOLD = 'Above the fold shows the headline, primary call to action and brand mark described in the brief'
const CART = 'A product can be added to the cart and the cart total updates correctly'
const COPY = 'All copy from the brief is present and there is no placeholder text'
const withoutAt = (p) => p && { ...p, items: p.items.map(({ at, ...x }) => x) }

test('the verifier and the demo read stance by one rule', () => {
  assert.equal(liveStance, stanceOf)
  const cases = (...met) => met.map((m) => ({ met: !!m }))
  assert.deepEqual(stanceOf(cases(1, 1, 1, 0), true), { stance: 'follows', same: 3, n: 4, met: 3, notMet: 1 })
  assert.equal(stanceOf(cases(1, 0), true).stance, 'split')
  assert.equal(stanceOf(cases(1, 1, 1, 0), false).stance, 'departs')
  assert.equal(stanceOf(undefined, true).stance, 'none')
})

test('decidedBy: a second review outranks the layer that first decided', () => {
  assert.equal(decidedBy({ layer: 'probe' }), 'decided by a probe')
  assert.equal(decidedBy({ layer: 'ocr' }), 'read by OCR')
  assert.equal(decidedBy({ layer: 'model' }), 'judged by Claude')
  assert.equal(decidedBy({ layer: 'reused' }), 'unchanged since the last try')
  assert.equal(decidedBy({ layer: 'appeal', appeal: 'overturned' }), 'overturned on second review')
  assert.equal(decidedBy({ layer: 'model', appeal: 'upheld' }), 'held on second review')
  assert.equal(decidedBy({ layer: 'something' }), '')
  assert.equal(bandLabel('close'), 'close match')
  assert.equal(bandLabel('related'), 'related')
})

test('firstSentence stops at a sentence end, not inside a number or a file name', () => {
  assert.equal(firstSentence('Painted in 2.5 s at 375px. The rest was fine.'), 'Painted in 2.5 s at 375px.')
  assert.equal(firstSentence('No .env files. Nothing else.'), 'No .env files.')
  assert.equal(firstSentence('The page showed “Thanks.” Then it reloaded.'), 'The page showed “Thanks.”')
  assert.equal(firstSentence('  no end mark  '), 'no end mark')
  assert.equal(firstSentence(null), '')
})

test('above the fold, passed: follows 3 of 4, four contracts, marked sample', () => {
  const p = samplePrecedent(FOLD, 'visual', { contractId: 'c_x', passed: true })
  assert.equal(p.type, 'precedent')
  assert.equal(p.v, 2)
  assert.equal(p.sample, true)
  assert.deepEqual([p.stance, p.same, p.n], ['follows', 3, 4])
  assert.equal(new Set(p.items.map((x) => x.contract)).size, 4)
  assert.ok(p.items.every((x, i) => i === 0 || p.items[i - 1].score >= x.score))
})

test('the cart, failed: departs from 1 of 4, one case won on appeal; the reason travels with it', () => {
  const p = samplePrecedent(CART, 'functional', { contractId: 'c_x', passed: false, departsBecause: '  Here two cards show no price.  ' })
  assert.deepEqual([p.stance, p.same, p.n], ['departs', 1, 4])
  assert.equal(p.items.filter((x) => x.appeal === 'overturned' && x.layer === 'appeal' && x.met).length, 1)
  assert.equal(p.departsBecause, 'Here two cards show no price.')
})

test('the copy, passed: a 2–2 split', () => {
  const p = samplePrecedent(COPY, 'content', { contractId: 'c_x', passed: true })
  assert.deepEqual([p.stance, p.met, p.notMet], ['split', 2, 2])
})

test('the Northbrew story’s Claude-judged checks, passed: each in line with its own kind of case', () => {
  const story = [
    // demoMediator's PAD lines and the stamps feature, with the kinds demo.js roomCriteria gives them
    ['visual', 'The pages load at 1440px and 375px with no console errors', [3, 3], /console/i],
    ['functional', 'The site is live on the production domain over HTTPS', [2, 3], /HTTPS/],
    ['functional', 'Scanning a customer’s QR on the staff page adds a stamp, and the tenth stamp shows the free-coffee reward', [2, 3], /stamp/i],
  ]
  for (const [kind, statement, [same, n], about] of story) {
    const p = samplePrecedent(statement, kind, { contractId: 'c_x', passed: true })
    assert.deepEqual([p.stance, p.same, p.n], ['follows', same, n], statement)
    assert.ok(p.items.every((x) => about.test(x.statement)), statement)
  }
})

test('nothing above the floor gives null, and a contract never sees its own cases', () => {
  assert.equal(samplePrecedent('The booking calendar syncs with Google Calendar', 'functional', { passed: true }), null)
  const own = samplePrecedent(FOLD, 'visual', { contractId: 'sample-c1', passed: true })
  assert.ok(own.items.every((x) => x.contract !== 'sample-c1'))
  assert.ok(own.items.every((x) => x.score >= FLOOR))
})

test('the same question gives the same answer, apart from the dates', () => {
  const a = samplePrecedent(CART, 'functional', { contractId: 'c_x', passed: false })
  const b = samplePrecedent(CART, 'functional', { contractId: 'c_x', passed: false })
  assert.deepEqual(withoutAt(a), withoutAt(b))
})

test('every reason agrees with its outcome and reads as redacted', () => {
  assert.ok(SAMPLE_CASES.length >= 24 && SAMPLE_CASES.length <= 40)
  for (const c of SAMPLE_CASES) {
    if (c.met) assert.doesNotMatch(c.reason, /not |failed|404|cut off|missing/, c.id)
    else assert.doesNotMatch(c.reason, /^(All|Every|The page shows)/, c.id)
    assert.doesNotMatch(c.reason, /https?:|www\.|@|\$\d|"/, c.id)
  }
  assert.ok(SAMPLE_CASES.some((c) => c.met && c.metFirst === false))
  assert.equal(new Set(SAMPLE_CASES.map((c) => c.id)).size, SAMPLE_CASES.length)
})

test('each drafting template finds at least three cases', () => {
  const templates = [
    ['functional', 'The live URL serves "Online shop" with no errors on desktop (1440px) and mobile (375px)'],
    ['visual', FOLD],
    ['visual', 'No horizontal scrolling at 375px wide'],
    ['functional', 'The signup form accepts a valid email and shows a confirmation after submitting'],
    ['functional', CART],
    ['functional', 'A new user can sign up, sign in and reach the dashboard'],
    ['performance', 'Largest Contentful Paint under 2.5 s at 375px'],
    ['content', COPY],
    ['code', 'The repository has a README and a build script, and no committed secrets'],
  ]
  for (const [kind, statement] of templates) {
    const r = sampleTrackRecord(statement, kind)
    assert.ok(r.n >= 3, `${statement}: ${r.n}`)
    assert.equal(r.met + r.notMet, r.n)
    assert.ok(r.top.length <= 3)
  }
})
