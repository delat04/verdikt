/*  ============================================================================
    The Channel3 client (lib/channel3.js), offline. The fixtures in fixtures/channel3/ are answers recorded
    from the live API (search, product detail, price history for the Netum scanner Rcq3ctM) with the
    tracking query params removed, plus hand-made bad products in the search answer. Every client here
    gets a fake fetch, a Map cache, a fake sleep and a fixed clock; the real fetch throws, so a test that
    reaches the network fails instead of spending a credit. No keys, no Supabase, no money.
    ============================================================================ */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// before anything loads: an accidental model call or network call fails loudly
process.env.ANTHROPIC_API_KEY = ''
process.env.OPENROUTER_API_KEY = ''
globalThis.fetch = () => { throw new Error('network used') }
const { createChannel3, Channel3Error, listing, cleanTitle, attributionId, channel3 } = await import('../src/lib/channel3.js')

const fx = (name) => JSON.parse(readFileSync(new URL(`./fixtures/channel3/${name}`, import.meta.url), 'utf8'))
const SEARCH = fx('search-barcode-scanner.json')
const PRODUCT = fx('product-Rcq3ctM.json')
const HISTORY = fx('history-Rcq3ctM.json')

/** A fetch Response, as far as the client reads one. A string body is parsed as JSON, like the wire. */
const reply = (status, body, headers = {}) => ({ status, headers: new Headers(headers), json: async () => (typeof body === 'string' ? JSON.parse(body) : body) })

/** A fake fetch that answers in order (the last answer repeats) and records each call. */
function fake(...answers) {
  const calls = []
  const fetch = async (url, init) => {
    calls.push({ url, init })
    const a = answers[Math.min(calls.length - 1, answers.length - 1)]
    if (a instanceof Error) throw a
    return typeof a === 'function' ? a(url, init) : a
  }
  return { fetch, calls }
}

const sleeps = []
const NOW = Date.parse('2026-11-10T12:00:00Z')
const client = (fetch, o = {}) => createChannel3({ apiKey: 'test-key', fetch, cache: new Map(), sleep: async (ms) => { sleeps.push(ms) }, now: () => NOW, log: () => {}, ...o })

test('listing of the recorded Netum product', () => {
  const l = listing(PRODUCT)
  assert.deepEqual(
    { id: l.id, title: l.title, brand: l.brand, priceCents: l.priceCents, compareAtCents: l.compareAtCents, currency: l.currency, domain: l.domain, inStock: l.inStock, commissionRate: l.commissionRate },
    { id: 'Rcq3ctM', title: '2D Barcode Scanner', brand: 'Netum', priceCents: 3420, compareAtCents: 3800, currency: 'USD', domain: 'walmart.com', inStock: true, commissionRate: 0.07 })
  assert.equal(l.category.slug, 'handheld-barcode-scanners')
  assert.deepEqual(l.category.path, ['Computer Components', 'Input Devices', 'Barcode Scanners', 'Handheld Barcode Scanners'])
  assert.match(l.imageAlt, /^Black handheld barcode scanner/)
  assert.match(l.image, /^https:\/\/cdn\.trychannel3\.com\//)
})

test('listing drops bad offers and keeps out of stock only when asked', () => {
  const oos = SEARCH.products.find((p) => p.id === 'BadOos01')
  assert.equal(listing(oos), null)
  assert.equal(listing(oos, { keepOutOfStock: true }).inStock, false)
  assert.equal(listing({ ...PRODUCT, id: 'a b' }), null)
  assert.equal(listing({ ...PRODUCT, images: [{ cleaned_url: 'https://evil.example/x.png', is_main_image: true }] }).image, '')
  assert.equal(listing({ ...PRODUCT, offers: [{ ...PRODUCT.offers[0], url: 'https://evil.example/buy' }] }), null)
  assert.equal(listing({ ...PRODUCT, offers: [{ ...PRODUCT.offers[0], url: 'https://www.walmart.com/ip/1' }] }).url, 'https://www.walmart.com/ip/1')
  assert.equal(listing({ ...PRODUCT, offers: [{ ...PRODUCT.offers[0], condition: 'used' }] }), null)
})

test('cleanTitle drops the store and the category it repeats', () => {
  const t = cleanTitle('Zebra DS9308-SR - 1D/2D - Handsfree Presentation Scanner - DS9308-SR4U2100AZW - Barcode Scanners - CDW.com', { title: 'Barcode Scanners', path: [] })
  assert.ok(!t.includes('CDW.com'), t)
  assert.ok(!t.endsWith('Barcode Scanners'), t)
  assert.equal(cleanTitle('A‮b\u0007c | Shop.com', null), 'Abc')
  const long = cleanTitle('word '.repeat(40), null)
  assert.ok(long.length <= 90 && long.endsWith('…'), long)
})

test('search sends exactly the documented body and an opaque x-user-id', async () => {
  const f = fake(reply(200, SEARCH))
  const r = await client(f.fetch).search('2D barcode scanner', { maxCents: 6580, userId: attributionId('m1') })
  assert.equal(f.calls.length, 1)
  assert.equal(f.calls[0].url, 'https://api.trychannel3.com/v1/search')
  assert.equal(f.calls[0].init.method, 'POST')
  assert.deepEqual(JSON.parse(f.calls[0].init.body), {
    query: '2D barcode scanner', limit: 9,
    filters: { price: { max_price: 65.8 }, availability: ['InStock'], conditions: ['new'] },
    config: { country: 'US', currency: 'USD', mode: 'default' },
  })
  assert.match(f.calls[0].init.headers['x-user-id'], /^vk-[0-9a-f]{20}$/)
  assert.equal(f.calls[0].init.headers['x-api-key'], 'test-key')
  assert.equal(f.calls[0].init.headers['content-type'], 'application/json')
  assert.deepEqual(r.products.map((p) => p.id), ['Rcq3ctM'])   // javascript:, http://, EUR, empty domain, OutOfStock: gone
  assert.equal(r.via, 'rest')
  assert.equal(r.cached, false)
})

test('a raw id never leaves the server, and emails, links and long numbers are stripped', async () => {
  const f = fake(reply(200, SEARCH))
  await client(f.fetch).search('scanner for sam@example.com https://x.io/a 5551234567 now', { maxCents: 6000, userId: 'b6c1-raw-milestone-uuid' })
  assert.equal(JSON.parse(f.calls[0].init.body).query, 'scanner for now')
  assert.equal(f.calls[0].init.headers['x-user-id'], attributionId('b6c1-raw-milestone-uuid'))
})

test('the log line carries the outcome, never the key or the query', async () => {
  const lines = []
  const log = (o) => lines.push(JSON.stringify(o))
  await client(fake(reply(200, SEARCH)).fetch, { log }).search('2D barcode scanner', { maxCents: 6000 })
  await assert.rejects(client(fake(reply(401, {})).fetch, { log }).search('label printer', { maxCents: 6000 }), { code: 'auth' })
  assert.ok(lines.length >= 2)
  for (const l of lines) {
    assert.ok(!l.includes('test-key') && !/barcode|label printer/i.test(l), l)
    assert.deepEqual(Object.keys(JSON.parse(l)).sort(), ['cached', 'code', 'http', 'ms', 'op', 'results', 'via'])
  }
})

test('402 is quota and latches: the next search never calls fetch', async () => {
  const f = fake(reply(402, { detail: 'out of credits' }))
  const c = client(f.fetch)
  await assert.rejects(c.search('2D barcode scanner', { maxCents: 6000 }), (e) => e instanceof Channel3Error && e.code === 'quota' && e.resetsOn === '2026-12-01')
  await assert.rejects(c.search('label printer', { maxCents: 6000 }), { code: 'quota' })
  assert.equal(f.calls.length, 1)
})

test('429 waits out a short Retry-After once, and reports a long one', async () => {
  const short = fake(reply(429, {}, { 'retry-after': '2' }), reply(200, SEARCH))
  const r = await client(short.fetch).search('2D barcode scanner', { maxCents: 6000 })
  assert.equal(short.calls.length, 2)
  assert.equal(r.products.length, 1)
  assert.ok(sleeps.includes(2000))
  const long = fake(reply(429, {}, { 'retry-after': '30' }))
  await assert.rejects(client(long.fetch).search('2D barcode scanner', { maxCents: 6000 }), (e) => e.code === 'rate_limited' && e.retryAfterSec === 30)
  assert.equal(long.calls.length, 1)
})

test('500 twice: unavailable, or the MCP fallback when there is one', async () => {
  const f = fake(reply(500, {}), reply(503, {}))
  await assert.rejects(client(f.fetch).search('2D barcode scanner', { maxCents: 6000 }), { code: 'unavailable' })
  assert.equal(f.calls.length, 2)
  const g = fake(reply(500, {}), new TypeError('fetch failed'))
  let asked
  const r = await client(g.fetch, { mcpSearch: async (q, cap) => { asked = [q, cap]; return SEARCH } }).search('2D barcode scanner', { maxCents: 6000 })
  assert.equal(r.via, 'mcp')
  assert.deepEqual(asked, ['2D barcode scanner', 6000])
  assert.deepEqual(r.products.map((p) => p.id), ['Rcq3ctM'])
  const t = fake(Object.assign(new Error('timed out'), { name: 'TimeoutError' }))
  await assert.rejects(client(t.fetch).search('2D barcode scanner', { maxCents: 6000 }), { code: 'timeout' })
})

test('a body in the wrong shape is bad_response, never an empty list', async () => {
  const f = fake(reply(200, '{"foo":1}'))
  await assert.rejects(client(f.fetch).search('2D barcode scanner', { maxCents: 6000 }), { code: 'bad_response' })
  await assert.rejects(client(fake(reply(401, {})).fetch).search('2D barcode scanner', { maxCents: 6000 }), { code: 'auth' })
  await assert.rejects(client(fake(reply(422, {})).fetch).search('2D barcode scanner', { maxCents: 6000 }), { code: 'invalid' })
})

test('the same search within 15 minutes is served from the cache', async () => {
  const f = fake(reply(200, SEARCH))
  let t = NOW
  const cache = new Map()
  const c = client(f.fetch, { cache, now: () => t })
  const a = await c.search('2D barcode scanner', { maxCents: 6580, userId: attributionId('m1') })
  t += 5 * 60e3
  const b = await c.search('  2d   BARCODE scanner ', { maxCents: 6550, userId: attributionId('m2') })
  assert.equal(f.calls.length, 1)
  assert.equal(b.cached, true)
  assert.equal(b.via, 'cache')
  assert.equal(b.asOf, a.asOf)
  assert.equal(b.products.length, 1)
  // the cached links were tagged for m1: they now carry m2's tag (only when Channel3 put one there)
  const tagged = { ...SEARCH, products: SEARCH.products.map((p) => ({ ...p, offers: p.offers.map((o) => ({ ...o, url: o.url + '?user_id=' + attributionId('m1') })) })) }
  const g = fake(reply(200, tagged))
  const d = client(g.fetch)
  await d.search('label printer', { maxCents: 6000, userId: attributionId('m1') })
  const e = await d.search('label printer', { maxCents: 6000, userId: attributionId('m2') })
  assert.equal(new URL(e.products[0].url).searchParams.get('user_id'), attributionId('m2'))
  assert.equal(g.calls.length, 1)
  // a higher cap than the cached search used can't trust it: something under the new cap may be missing
  await c.search('2D barcode scanner', { maxCents: 6900 })
  assert.equal(f.calls.length, 2)
  t += 16 * 60e3
  await c.search('2D barcode scanner', { maxCents: 6580 })
  assert.equal(f.calls.length, 3)
  assert.equal(cache.get('usage|2026-11').value.count, 3)
})

test('the monthly cap: quota until the first of next month, without a call', async () => {
  const f = fake(reply(200, SEARCH))
  const cache = new Map([['usage|2026-11', { count: 900 }]])
  const c = client(f.fetch, { cache, now: () => Date.parse('2026-11-20T08:00:00Z') })
  await assert.rejects(c.search('2D barcode scanner', { maxCents: 6000 }), (e) => e.code === 'quota' && e.resetsOn === '2026-12-01')
  assert.equal(f.calls.length, 0)
})

test('the month’s count: a failed read never resets it, and parallel searches all count', async () => {
  // a cache whose usage read fails: the cap check fails closed, with no call and no write
  const rows = new Map([['usage|2026-11', { value: { count: 850, latched: false }, at: new Date(NOW).toISOString() }]])
  let failReads = true
  const flaky = {
    async get(key) { if (failReads && key.startsWith('usage|')) throw new Error('db down'); return rows.get(key) || null },
    async put(key, value) { rows.set(key, { value, at: new Date(NOW).toISOString() }) },
  }
  const f = fake(reply(200, SEARCH))
  const c = client(f.fetch, { cache: flaky })
  await assert.rejects(c.search('2D barcode scanner', { maxCents: 6000 }), { code: 'unavailable' })
  assert.equal(f.calls.length, 0)
  assert.deepEqual(rows.get('usage|2026-11').value, { count: 850, latched: false })
  // the read works for the cap check and fails for the bump: the search answers, the count is left alone
  let reads = 0
  const once = { ...flaky, async get(key) { if (key.startsWith('usage|') && reads++ > 0) throw new Error('db down'); return rows.get(key) || null } }
  const g = fake(reply(200, SEARCH))
  assert.equal((await client(g.fetch, { cache: once }).search('label printer', { maxCents: 6000 })).via, 'rest')
  assert.equal(g.calls.length, 1)
  assert.deepEqual(rows.get('usage|2026-11').value, { count: 850, latched: false })
  // five searches at once: five more
  failReads = false
  const h = fake(reply(200, SEARCH))
  const d = client(h.fetch, { cache: flaky })
  await Promise.all(['a1', 'b2', 'c3', 'd4', 'e5'].map((w) => d.search(`scanner ${w}`, { maxCents: 6000 })))
  assert.equal(h.calls.length, 5)
  assert.equal(rows.get('usage|2026-11').value.count, 855)
})

test('no key: search goes to MCP, and a pin takes a listing that search returned', async () => {
  const f = fake(reply(200, PRODUCT))
  let t = NOW
  const c = client(f.fetch, { apiKey: '', now: () => t, mcpSearch: async () => SEARCH })
  await assert.rejects(c.product('Rcq3ctM', { fresh: true }), { code: 'no_key' })
  const r = await c.search('2D barcode scanner', { maxCents: 6000 })
  assert.equal(r.via, 'mcp')
  const p = await c.product('Rcq3ctM', { fresh: true, userId: attributionId('m1') })
  assert.equal(p.priceCents, 3420)
  assert.equal(f.calls.length, 0)   // REST is never called without a key
  t += 16 * 60e3
  await assert.rejects(c.product('Rcq3ctM', { fresh: true }), { code: 'no_key' })
  await assert.rejects(client(f.fetch, { apiKey: '' }).search('2D barcode scanner', { maxCents: 6000 }), { code: 'no_key' })
})

test('channel3Status: from env alone, never the key', async () => {
  const { channel3Status } = await import('../src/lib/channel3.js')
  assert.deepEqual(channel3Status({ CHANNEL3_API_KEY: 'k-secret' }), { on: true, search: 'rest', cap: 900 })
  assert.deepEqual(channel3Status({ CHANNEL3_MONTHLY_CAP: '50' }), { on: false, search: 'mcp', cap: 50 })
  assert.ok(!JSON.stringify(channel3Status({ CHANNEL3_API_KEY: 'k-secret' })).includes('k-secret'))
})

test('product: by id, cached 10 minutes unless fresh, 404 is not_found, bad ids never leave', async () => {
  const f = fake(reply(200, PRODUCT))
  const c = client(f.fetch)
  const p = await c.product('Rcq3ctM', { userId: attributionId('m1') })
  assert.equal(f.calls[0].url, 'https://api.trychannel3.com/v1/products/Rcq3ctM?country=US&currency=USD')
  assert.match(f.calls[0].init.headers['x-user-id'], /^vk-[0-9a-f]{20}$/)
  assert.equal(p.priceCents, 3420)
  await c.product('Rcq3ctM')
  assert.equal(f.calls.length, 1)
  await c.product('Rcq3ctM', { fresh: true })
  assert.equal(f.calls.length, 2)
  await assert.rejects(c.product('../etc'), { code: 'invalid' })
  await assert.rejects(client(fake(reply(404, {})).fetch).product('Zz9zz9z'), { code: 'not_found' })
  await assert.rejects(client(fake(reply(200, { ...PRODUCT, offers: [] })).fetch).product('Rcq3ctM'), { code: 'not_found' })
})

test('history: daily USD points and the statistics, 404 is null', async () => {
  const f = fake(reply(200, HISTORY))
  const c = client(f.fetch)
  const h = await c.history('Rcq3ctM')
  assert.equal(f.calls[0].url, 'https://api.trychannel3.com/v0/price-tracking/history/Rcq3ctM?days=30')
  assert.ok(h.points.length >= 16 && h.points.every((x) => /^\d{4}-\d{2}-\d{2}$/.test(x.d) && x.cents === 3420))
  assert.equal(h.points[0].d, '2026-10-25')
  assert.deepEqual(h.stats, { minCents: 3420, maxCents: 3420, meanCents: 3420, currentCents: 3420, status: 'typical' })
  assert.match(h.storeTitle, /-m5s$/)
  await c.history('Rcq3ctM')
  assert.equal(f.calls.length, 1)
  assert.equal(await client(fake(reply(404, {})).fetch).history('Zz9zz9z'), null)
})

test('importing the module touches nothing: the shared client is lazy', () => {
  assert.equal(typeof channel3.search, 'function')
})
