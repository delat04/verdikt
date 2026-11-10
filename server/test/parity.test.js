/*  ============================================================================
    Shared pure modules. A few rules have to give the same answer in the verifier, in the browser and in
    the demo, so the server and the web app each keep a byte-identical copy of the same file instead of a
    hand-written twin: no imports and no globals, so either runtime loads it as is. This test is `cmp` on
    every pair. Change one copy, copy it over the other, and list the pair here when you add a module.
    ============================================================================ */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// [server copy, web copy], paths from the repo root
const PAIRS = [
  ['server/src/agent/replay.js', 'web/src/domain/replay.js'],
  ['server/src/agent/precedent.js', 'web/src/domain/precedent.js'],
  ['server/src/agent/expenseRules.js', 'web/src/domain/expenseRules.js'],
]

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const read = (path) => readFileSync(ROOT + path)

/** Where two copies part: null when byte-identical, else the 1-based line and both versions of it. */
function firstDifference(a, b) {
  if (a.equals(b)) return null
  const la = a.toString('utf8').split('\n')
  const lb = b.toString('utf8').split('\n')
  const eolOnly = la.length === lb.length && la.every((line, i) => line.replace(/\r$/, '') === lb[i].replace(/\r$/, ''))
  let i = 0
  while (i < la.length && i < lb.length && la[i] === lb[i]) i++
  return { line: i + 1, a: la[i] ?? '(end of file)', b: lb[i] ?? '(end of file)', eolOnly }
}

// What would tie a copy to one runtime: a module it loads, or a global of the server (process) or the browser
const IMPORT = /^\s*import\b|^\s*export\s+(?:\*|\{[^}]*\})\s*from\b|\bimport\s*\(|\brequire\s*\(/m
const GLOBAL = /\b(?:process|window|document|globalThis|navigator|localStorage|sessionStorage)\s*[.[]/
function runtimeTie(src) {
  // comments and plain strings may say anything: a rough cut that can miss a tie but won't flag prose or a URL
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:\\])\/\/.*$/gm, '$1')
    .replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"/g, "''")
  return code.match(IMPORT)?.[0].trim() || code.match(GLOBAL)?.[0] || null
}

test('the comparison names the first line where two copies part', () => {
  const same = Buffer.from('export const a = 1\nexport const b = 2\n')
  assert.equal(firstDifference(same, Buffer.from(same)), null)
  assert.deepEqual(firstDifference(same, Buffer.from('export const a = 1\nexport const b = 3\n')),
    { line: 2, a: 'export const b = 2', b: 'export const b = 3', eolOnly: false })
  assert.equal(firstDifference(same, Buffer.from('export const a = 1\r\nexport const b = 2\r\n')).eolOnly, true)
  assert.equal(firstDifference(same, Buffer.from('export const a = 1')).b, '(end of file)')
})

test('the runtime check catches imports and globals, not words in comments or URLs', () => {
  assert.equal(runtimeTie("import { money } from './format.js'\n"), 'import')
  assert.equal(runtimeTie("export { clock } from './replay.js'\n"), "export { clock } from")
  assert.equal(runtimeTie('const load = () => import(\'./x.js\')\n'), 'import(')
  assert.equal(runtimeTie('const mode = process.env.MODE\n'), 'process.')
  assert.equal(runtimeTie('export const wide = () => window.innerWidth > 768\n'), 'window.')
  assert.equal(runtimeTie('// the document. A process. Not import() here\nexport const ok = 1\n'), null)
  assert.equal(runtimeTie('/* window.open() is the caller\'s job */\nexport const url = \'https://x.dev/window.html\'\n'), null)
})

for (const [server, web] of PAIRS) {
  test(`${server} and ${web} are byte-identical`, () => {
    for (const path of [server, web]) assert.ok(existsSync(ROOT + path), `${path} is missing`)
    const diff = firstDifference(read(server), read(web))
    assert.equal(diff, null, diff && (diff.eolOnly
      ? `${server} and ${web} differ only in line endings: copy one over the other`
      : `${server} and ${web} differ at line ${diff.line}:\n  server: ${diff.a}\n  web:    ${diff.b}\nCopy the changed one over the other.`))
  })

  test(`${server} stands alone in both runtimes`, () => {
    const tie = runtimeTie(read(server).toString('utf8'))
    assert.equal(tie, null, `${server} uses \`${tie}\`: a shared copy has no imports and no globals`)
  })
}

// ---------------------------------------------------------------- the demo's sample receipts
// Demo mode checks a sample claim with web/src/services/demoReceipts.js; the live server checks a real one with
// agent/receipts.js. On the sample contract's M2 (a $250 budget for Domain, Hosting and Fonts, $20 of hosting
// already reimbursed, the seeded shopping list) every sample must come out the same both ways, and as the sample
// says it does. The model keys are blanked and fetch throws: a sample the rules leave to Claude must reach the
// model step live too, and the demo plays back that one answer.
process.env.ANTHROPIC_API_KEY = ''
process.env.OPENROUTER_API_KEY = ''
globalThis.fetch = () => { throw new Error('network used') }
const { checkExpense, parseReceipt, decide } = await import('../src/agent/receipts.js')
const { money } = await import('../src/lib/money.js')
const demo = await import('../../web/src/services/demoReceipts.js')

const day = new Date().toISOString().slice(0, 10)
const ago = (d) => new Date(Date.now() - d * 864e5).toISOString()
const CONTRACT = { createdAt: ago(9), currency: 'USD' }
const COMMITTED = 2000   // the seeded hosting claim, reimbursed
const PRINTER = 'yWFPHs9'
const $ = (c) => money(c, 'USD')
const seeded = () => demo.sampleShoppingList(ago)
const withPrinterAgreed = (items) => items.map((x) => (x.id === PRINTER ? { ...x, status: 'agreed', agreedBy: 'client', agreedAt: ago(0.1) } : x))

/** One sample claim through both checkers: the amount its chip claims, the receipt's lines plus today's date. */
async function both(key, items) {
  const r = demo.RECEIPTS[key]
  const amountCents = demo.SAMPLE_CLAIMS.find((s) => s.key === key)?.amountCents ?? r.total
  const d = demo.sampleChecks({
    key, claim: { amountCents }, milestone: { ...demo.SAMPLE_BUDGET, expenseProducts: items }, contract: CONTRACT,
    committedCents: COMMITTED, duplicate: null, usedIds: [], clientName: 'Maya', $, day,
  })
  const text = [...r.lines, `Date: ${day}`].join('\n')
  const live = await checkExpense({
    claim: { amountCents, merchant: r.merchant, purpose: 'a demo sample' },
    receipt: { text, via: r.via, parsed: parseReceipt(text) },
    milestone: { expense_budget_cents: demo.SAMPLE_BUDGET.expenseBudgetCents, expense_covers: demo.SAMPLE_BUDGET.expenseCovers, expense_products: items },
    contract: { created_at: CONTRACT.createdAt, currency: 'USD' },
    committedCents: COMMITTED, duplicate: null, usedIds: [], clientName: 'Maya',
  })
  return { d, live, readable: r.total != null }
}

/** The demo and the live checker agree on a sample: the same rows in the same order, the same list rows word for
 *  word, the same items bought, and the same outcome, which is `expected`. */
function assertSame({ d, live, readable }, expected, key) {
  const row = (checks, k) => checks.find((c) => c.key === k)
  assert.equal(demo.decide(d.checks), expected, `${key}: the demo decides ${demo.decide(d.checks)}`)
  assert.deepEqual(d.checks.map((c) => c.key), live.checks.map((c) => c.key), `${key}: the same checks in the same order`)
  // the demo reads no date off an unreadable receipt; the live parser still finds the date line
  const skip = new Set(readable ? [] : ['date'])
  if (row(d.checks, 'covered').by === 'claude') {
    // the rules leave coverage to the model both ways; the demo plays back its answer
    skip.add('covered')
    assert.equal(row(live.checks, 'covered').observed, 'The receipt names none of the budget lines, and the model was unavailable.', `${key}: live reaches the model`)
    const answered = live.checks.map((c) => (c.key === 'covered' ? row(d.checks, 'covered') : c))
    assert.equal(decide(answered), expected, `${key}: live with the same model answer`)
  } else {
    assert.equal(live.tokens, 0, `${key}: no model live`)
    assert.equal(d.tokens, 0, `${key}: no model in the demo`)
    assert.equal(decide(live.checks), expected, `${key}: live decides ${decide(live.checks)}`)
    assert.deepEqual(row(d.checks, 'covered'), row(live.checks, 'covered'), `${key}: the same coverage row`)
  }
  for (const c of d.checks) if (!skip.has(c.key)) assert.equal(c.status, row(live.checks, c.key).status, `${key}: ${c.key} is ${c.status} in the demo, ${row(live.checks, c.key).status} live`)
  const list = (checks) => checks.filter((c) => c.key.startsWith('list'))
  assert.deepEqual(list(d.checks), list(live.checks), `${key}: the list rows read the same`)
  assert.deepEqual(d.planned, live.planned, `${key}: the same list items bought`)
}

test('every demo sample names its outcome, and none hard-codes its coverage', () => {
  for (const [key, r] of Object.entries(demo.RECEIPTS)) {
    assert.ok(['approved', 'needs_client', 'rejected'].includes(r.expect), `${key} has no expect`)
    assert.equal('covered' in r, false, `${key} carries a hard-coded covered field`)
  }
  for (const s of demo.SAMPLE_CLAIMS) assert.ok(demo.RECEIPTS[s.key], `chip ${s.key} has no receipt`)
  assert.deepEqual(demo.SAMPLE_CLAIMS.map((s) => s.label),
    ['domain receipt', 'scanner from the list', 'scanner and printer', 'same store, other item', 'lunch receipt', 'blurry photo', 'hosting, amount inflated'])
})

test('the seeded list: the scanner on the signed terms, the printer proposed by Sam’s agent, $167.11 of room', () => {
  const [netum, anself, ...rest] = seeded()
  assert.equal(rest.length, 0)
  assert.deepEqual([netum.id, netum.brand, netum.title, netum.domain, netum.priceCents, netum.plannedBy, netum.status], ['Rcq3ctM', 'Netum', '2D Barcode Scanner', 'walmart.com', 3420, 'client', 'terms'])
  assert.deepEqual([anself.id, anself.brand, anself.title, anself.domain, anself.priceCents, anself.plannedBy, anself.viaAgent, anself.status], [PRINTER, 'Anself', 'Portable Mini Thermal Receipt Printer', 'walmart.com', 2869, 'freelancer', true, 'proposed'])
  for (const x of [netum, anself]) assert.deepEqual([x.currency, x.inStock, x.offers.map((o) => o.domain)], ['USD', true, ['walmart.com']])
  assert.equal(demo.SAMPLE_BUDGET.expenseBudgetCents - COMMITTED - netum.priceCents - anself.priceCents, 16711)
})

test('the demo decides like the live checker, info rows included', () => {
  for (const checks of [[{ status: 'pass' }, { status: 'info' }], [{ status: 'pass' }, { status: 'unknown' }], [{ status: 'info' }, { status: 'fail' }], [{ status: 'pass' }]]) {
    assert.equal(demo.decide(checks), decide(checks))
  }
})

for (const key of Object.keys(demo.RECEIPTS)) {
  test(`demo sample "${key}": the demo and the live checker decide ${demo.RECEIPTS[key].expect}`, async () => {
    assertSame(await both(key, seeded()), demo.RECEIPTS[key].expect, key)
  })
}

test('demo sample "twoitems" once Maya agrees to the printer: both items match, reimbursed', async () => {
  const r = await both('twoitems', withPrinterAgreed(seeded()))
  assertSame(r, demo.RECEIPTS.twoitems.expectAfterAgree, 'twoitems after agree')
  assert.deepEqual(r.live.planned.map((p) => p.id), ['Rcq3ctM', PRINTER])
})

test('a domain receipt beside the list: no list rows, and still reimbursed (the old "planned" row sent it to the client)', async () => {
  const { d, live } = await both('domain', seeded())
  for (const checks of [d.checks, live.checks]) {
    assert.equal(checks.filter((c) => c.key.startsWith('list') || c.key === 'planned').length, 0)
    assert.equal(decide(checks), 'approved')
  }
})

test('the scanner from the list: three list rows passed, covered by the list, no Claude row', async () => {
  const { d } = await both('scanner', seeded())
  assert.deepEqual(d.checks.filter((c) => c.key.startsWith('list')).map((c) => [c.label, c.status]),
    [['Bought at a store on the list', 'pass'], ['The item on the list', 'pass'], ['At the agreed price', 'pass']])
  assert.match(d.checks.find((c) => c.key === 'covered').observed, /^On the shopping list/)
  assert.equal(d.checks.some((c) => c.by === 'claude'), false)
})

test('another item from the same store: the client decides, and the list row says why', async () => {
  const { d } = await both('wrongitem', seeded())
  assert.match(d.checks.find((c) => c.key === 'list').observed, /^walmart\.com sells items on the list, but no line names Netum 2D Barcode Scanner\./)
  assert.equal(d.checks.some((c) => c.by === 'claude'), false)
})
