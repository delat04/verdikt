/*  ============================================================================
    Channel3 — live listings for 100M+ products across thousands of stores, used to plan what an expense
    budget buys: a real product, its price and the store.
    · search   REST v1 first (POST /v1/search) with structured filters: the price cap in dollars, in stock,
               new, US/USD. If REST is down twice in a row, Channel3's MCP server (search_products) is the
               fallback, with the cap only as an "under $N" hint. Every listing is re-checked here either way.
    · product  GET /v1/products/:id — free per Channel3's pricing, so a pin re-reads the product by id and
               survives a restart, whoever searched last. With no key (MCP search only), a pin takes the
               listing a search returned in the last 15 minutes.
    · history  GET /v0/price-tracking/history/:id — up to 30 daily USD prices and Channel3's own verdict on
               the current one (low · typical · high). Built and tested; no route fetches it yet.
    Buy links are Channel3's attributed links, tagged per milestone with an opaque id (x-user-id: 'vk-' + a
    hash), so no raw id or email ever leaves the server; the page that shows them says they may earn a
    commission. Failures are typed (Channel3Error), searches are cached for 15 minutes in price_checks, and
    a monthly soft cap (CHANNEL3_MONTHLY_CAP, default 900 of the 1,000 free credits) keeps credits for live
    judging. Nothing here logs the key, the headers or what was searched for.
    ============================================================================ */

import { createHash } from 'node:crypto'
import { z } from 'zod'

const API_URL = 'https://api.trychannel3.com'
const MCP_URL = 'https://mcp.trychannel3.com/'
const TIMEOUT_MS = 10_000
const MCP_TIMEOUT_MS = 20_000
const MIN = 60_000
const TTL = { search: 15 * MIN, product: 10 * MIN, history: 6 * 60 * MIN }
const LIMIT = 9                                  // Channel3 allows up to 30; 9 fills the results grid
const BUCKET = 500                               // cache searches by the cap, rounded up to $5
const ID = /^[A-Za-z0-9_-]{3,64}$/
const ATTRIBUTION = /^vk-[0-9a-f]{20}$/
const STATUS = ['low', 'typical', 'high']

export class Channel3Error extends Error {
  /** code: quota | rate_limited | auth (key refused) | no_key (none set) | invalid | not_found | timeout | unavailable | bad_response;
   *  extra: retryAfterSec, resetsOn ('YYYY-MM-DD'), http */
  constructor(code, message, extra = {}) {
    super(message)
    this.name = 'Channel3Error'
    this.code = code
    Object.assign(this, extra)
  }
}

const sha256 = (s) => createHash('sha256').update(String(s)).digest('hex')

/** The opaque id Channel3 sees for a milestone's searches and clicks: only [a-z0-9-], never the raw id. */
export const attributionId = (milestoneId) => 'vk-' + sha256(String(milestoneId)).slice(0, 20)

// ---- what a listing is allowed to say -------------------------------------------------------------------

const CONTROL = /[\u0000-\u001F\u007F‪-‮⁦-⁩]/g
const clean = (s) => String(s ?? '').replace(CONTROL, '').replace(/\s+/g, ' ').trim()
const DOMAINISH = /\b[\w-]+\.(com|net|org|co\.uk|ca|us)\b/i

/** A store's title, minus the store's own name and the category it repeats, clipped to 90 characters. */
export function cleanTitle(title, category) {
  const parts = clean(title).split(/ - | \| /).map((s) => s.trim()).filter(Boolean)
  const same = new Set([category?.title, ...(category?.path || []).map((x) => (typeof x === 'string' ? x : x?.title))]
    .filter(Boolean).map((s) => clean(s).toLowerCase()))
  while (parts.length > 1 && (DOMAINISH.test(parts.at(-1)) || same.has(parts.at(-1).toLowerCase()))) parts.pop()
  const out = parts.join(' - ')
  if (out.length <= 90) return out
  const cut = out.slice(0, 89)
  const space = cut.lastIndexOf(' ')
  return (space > 45 ? cut.slice(0, space) : cut).replace(/[\s,;:|-]+$/, '') + '…'
}

const cents = (x) => (typeof x === 'number' && Number.isFinite(x) ? Math.round(x * 100) : null)

function offerOf(o) {
  if (!o || o.price?.price == null || (o.price.currency || 'USD') !== 'USD') return null
  if (o.condition != null && o.condition !== 'new') return null
  const domain = String(o.domain || '').toLowerCase().replace(/^www\./, '')
  if (domain.length < 4 || !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain)) return null
  let url
  try { url = new URL(String(o.url || '')) } catch { return null }
  const host = url.hostname.toLowerCase()
  if (url.protocol !== 'https:') return null
  if (!(host === 'buy.trychannel3.com' || host.endsWith('.trychannel3.com') || host === domain || host.endsWith('.' + domain))) return null
  const priceCents = cents(o.price.price)
  if (!(priceCents >= 1)) return null
  const compare = cents(o.price.compare_at_price)
  const rate = Number(o.max_commission_rate)
  return {
    domain, priceCents, compareAtCents: compare > priceCents ? compare : null, url: url.href,
    inStock: o.availability === 'InStock', commissionRate: Number.isFinite(rate) ? Math.min(1, Math.max(0, rate)) : 0,
  }
}

/** Channel3's product → the listing Verdikt shows, pins and matches receipts against; null if no offer holds up. */
export function listing(p, { keepOutOfStock = false } = {}) {
  if (!p || !ID.test(String(p.id ?? ''))) return null
  const offers = (Array.isArray(p.offers) ? p.offers : []).map(offerOf).filter(Boolean)
    .sort((a, b) => (b.inStock - a.inStock) || (a.priceCents - b.priceCents)).slice(0, 4)
  if (!offers.length || (!keepOutOfStock && !offers[0].inStock)) return null
  const best = offers[0]
  const images = Array.isArray(p.images) ? p.images : []
  const img = images.find((i) => i?.is_main_image) || images[0]
  let image = ''
  try {
    const u = new URL(img?.cleaned_url || img?.url || '')
    if (u.protocol === 'https:' && u.hostname === 'cdn.trychannel3.com') image = u.href
  } catch { /* no usable image */ }
  const c = p.category
  return {
    id: p.id, title: cleanTitle(p.title, c), storeTitle: clean(p.title).slice(0, 200),
    brand: clean(p.brands?.[0]?.name).slice(0, 60), image, imageAlt: image ? clean(img?.alt_text).slice(0, 160) : '',
    priceCents: best.priceCents, compareAtCents: best.compareAtCents, currency: 'USD', domain: best.domain, url: best.url,
    inStock: best.inStock, commissionRate: Math.max(...offers.map((o) => o.commissionRate)), offers,
    category: c ? {
      slug: clean(c.slug).slice(0, 80), title: clean(c.title).slice(0, 80),
      path: (Array.isArray(c.path) ? c.path : []).map((x) => clean(typeof x === 'string' ? x : x?.title)).filter(Boolean).slice(-4),
    } : null,
  }
}

// a cached listing was found for someone else: its buy links carry that milestone's tag, so swap in this one
function reattribute(p, uid) {
  const fix = (href) => {
    try {
      const u = new URL(href)
      if (!u.hostname.endsWith('trychannel3.com') || !u.searchParams.has('user_id')) return href
      if (uid) u.searchParams.set('user_id', uid)
      else u.searchParams.delete('user_id')
      return u.href
    } catch { return href }
  }
  return { ...p, url: fix(p.url), offers: (p.offers || []).map((o) => ({ ...o, url: fix(o.url) })) }
}

// only product words leave the server: no emails, links or long numbers (phones, orders, cards)
function normalize(query) {
  return String(query ?? '')
    .replace(/\S+@\S+\.\S+/g, ' ')
    .replace(/\b(?:https?:\/\/|www\.)\S+/gi, ' ')
    .replace(/\d{7,}/g, ' ')
    .replace(/\s+/g, ' ').trim().slice(0, 120).trim()
}

const SearchBody = z.object({
  products: z.array(z.object({ id: z.string(), title: z.string() }).passthrough()),
  next_page_token: z.string().nullish(),
})
const ProductBody = z.object({ id: z.string(), title: z.string() }).passthrough()
const HistoryBody = z.object({
  product_title: z.string().nullish(),
  history: z.array(z.object({ timestamp: z.string(), price: z.number().nullish(), currency: z.string().nullish() }).passthrough()).nullish(),
  statistics: z.object({
    min_price: z.number().nullish(), max_price: z.number().nullish(), mean: z.number().nullish(),
    current_price: z.number().nullish(), current_status: z.string().nullish(), currency: z.string().nullish(),
  }).passthrough().nullish(),
}).passthrough()

// ---- the cache: a Map (tests, scripts) or { get(key, ttlMs) → { value, at } | null, put(key, value) } ----

// get: a failed read is a miss. read: a failed read throws, for what must never be guessed (the month's usage).
function store(cache, now) {
  if (cache && typeof cache.put === 'function') {
    return {
      async get(key, ttl) { try { return (await cache.get(key, ttl)) || null } catch { return null } },
      async read(key) { return (await cache.get(key, Infinity)) || null },
      async put(key, value) { try { await cache.put(key, value) } catch { /* a cache that can't write is a miss next time */ } },
    }
  }
  const map = cache instanceof Map ? cache : new Map()
  return {
    async read(key) { return this.get(key, Infinity) },
    async get(key, ttl) {
      const e = map.get(key)
      if (e === undefined) return null
      // a row a test seeded by hand is a bare value, as fresh as now
      if (!(e && typeof e === 'object' && 'value' in e && 'at' in e)) return { value: e, at: new Date(now()).toISOString() }
      return now() - Date.parse(e.at) < ttl ? e : null
    },
    async put(key, value) { map.set(key, { value, at: new Date(now()).toISOString() }) },
  }
}

/** Search results and listings, cached in the existing price_checks table (no migration). */
export const priceChecksCache = {
  async get(key, ttlMs) {
    const { db } = await import('./supabase.js')   // lazily: importing this module never touches Supabase
    const { data, error } = await db().from('price_checks').select('result, created_at').eq('key', rowKey(key)).maybeSingle()
    if (error) throw new Error(error.message)
    if (!data || Date.now() - new Date(data.created_at).getTime() >= ttlMs) return null
    return { value: data.result, at: new Date(data.created_at).toISOString() }
  },
  async put(key, value) {
    const { db } = await import('./supabase.js')
    const { error } = await db().from('price_checks').upsert({ key: rowKey(key), result: value, tokens: 0, created_at: new Date().toISOString() })
    if (error) throw new Error(error.message)
  },
}
const rowKey = (key) => 'c3:' + sha256(key).slice(0, 40)
const productKey = (id) => `product|v1|USD|${id}`

// ---- the MCP fallback: one client per call, the cap only as a hint in the words -------------------------

export function mcpSearchVia({ url = MCP_URL, apiKey } = {}) {
  return async function mcpSearch(query, maxCents) {
    const [{ Client }, { StreamableHTTPClientTransport }] = await Promise.all([
      import('@modelcontextprotocol/sdk/client/index.js'),
      import('@modelcontextprotocol/sdk/client/streamableHttp.js'),
    ])
    const client = new Client({ name: 'verdikt', version: '1.0.0' })
    const headers = apiKey ? { 'X-API-Key': apiKey } : {}
    let timer
    const run = (async () => {
      await client.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers } }))
      const q = maxCents ? `${query} under $${Math.floor(maxCents / 100)}` : query
      const r = await client.callTool({ name: 'search_products', arguments: { query: q } }, undefined, { timeout: MCP_TIMEOUT_MS })
      if (r.isError) throw new Error('Channel3 MCP search failed')
      return { products: r.structuredContent?.products ?? [] }
    })()
    try {
      return await Promise.race([run, new Promise((_, no) => { timer = setTimeout(() => no(new Error('Channel3 MCP timed out')), MCP_TIMEOUT_MS) })])
    } finally {
      clearTimeout(timer)
      run.catch(() => {})
      await client.close().catch(() => {})
    }
  }
}

// ---- the client ------------------------------------------------------------------------------------------

const month = (ms) => new Date(ms).toISOString().slice(0, 7)
const nextMonth = (ms) => { const d = new Date(ms); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString().slice(0, 10) }
const realSleep = (ms) => new Promise((r) => setTimeout(r, ms))
const jitter = () => 300 + Math.floor(Math.random() * 401)
const logLine = (o) => console.info(JSON.stringify({ sponsor: 'channel3', ...o }))

function retryAfter(header, now) {
  if (header == null || header === '') return 5
  const n = Number(header)
  if (Number.isFinite(n) && n >= 0) return Math.ceil(n)
  const at = Date.parse(header)
  return Number.isFinite(at) ? Math.max(0, Math.ceil((at - now) / 1000)) : 5
}

export function createChannel3({
  apiKey, apiUrl = API_URL, mcpUrl, fetch = globalThis.fetch, cache, sleep = realSleep, now = Date.now,
  monthlyCap = 900, mcpSearch = mcpUrl ? mcpSearchVia({ url: mcpUrl, apiKey }) : undefined, log = logLine,
} = {}) {
  const base = String(apiUrl || API_URL).replace(/\/+$/, '')
  const kv = store(cache, now)
  const uidOf = (userId) => (!userId ? null : ATTRIBUTION.test(String(userId)) ? String(userId) : attributionId(userId))

  // ---- the monthly soft cap: 'usage|YYYY-MM' (UTC) holds { count, latched }. A read that fails is never
  // taken as zero: the cap check fails closed, and a bump skips rather than write a count it couldn't read.
  // Bumps run one at a time (one server instance), so parallel searches all count.
  const usageKey = () => `usage|${month(now())}`
  async function usage() {
    let row
    try { row = await kv.read(usageKey()) } catch { throw new Channel3Error('unavailable', 'Channel3 usage could not be read') }
    return { count: Math.max(0, Number(row?.value?.count) || 0), latched: !!row?.value?.latched }
  }
  let bumps = Promise.resolve()
  function bump({ latch = false, count = 1 } = {}) {
    const run = bumps.then(async () => {
      let u
      try { u = await usage() } catch {
        log({ op: 'usage', via: 'cache', ms: 0, http: null, code: 'unavailable', results: null, cached: false })
        return
      }
      await kv.put(usageKey(), { count: u.count + count, latched: u.latched || latch })
    })
    bumps = run.catch(() => {})
    return run
  }
  const quota = (msg) => new Channel3Error('quota', msg, { resetsOn: nextMonth(now()) })

  /** One REST call with one retry: a short 429 waits it out, a 5xx or a network failure retries after jitter.
   *  Returns { status, ok, ms, json } for a 2xx/4xx answer; throws rate_limited, timeout or unavailable. */
  async function call(op, path, { method = 'GET', body, uid } = {}) {
    const headers = { 'x-api-key': apiKey }
    if (body) headers['content-type'] = 'application/json'
    if (uid) headers['x-user-id'] = uid
    for (let attempt = 0; ; attempt++) {
      const t0 = performance.now()
      let res, err
      try {
        res = await fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(TIMEOUT_MS) })
      } catch (e) { err = e }
      const ms = Math.round(performance.now() - t0)
      if (err || res.status >= 500) {
        const code = err ? (err.name === 'TimeoutError' || err.name === 'AbortError' ? 'timeout' : 'unavailable') : 'unavailable'
        log({ op, via: 'rest', ms, http: res?.status ?? null, code, results: null, cached: false })
        if (attempt === 0) { await sleep(jitter()); continue }
        throw new Channel3Error(code, code === 'timeout' ? 'Channel3 took too long to answer' : 'Channel3 is unavailable', { http: res?.status ?? null })
      }
      if (res.status === 429) {
        const h = res.headers
        const wait = retryAfter(typeof h?.get === 'function' ? h.get('retry-after') : h?.['retry-after'], now())
        log({ op, via: 'rest', ms, http: 429, code: 'rate_limited', results: null, cached: false })
        if (attempt === 0 && wait <= 3) { await sleep(wait * 1000); continue }
        throw new Channel3Error('rate_limited', 'Channel3 asked to slow down', { retryAfterSec: wait, http: 429 })
      }
      const ok = res.status >= 200 && res.status < 300
      if (!ok) log({ op, via: 'rest', ms, http: res.status, code: codeOf(res.status, op), results: null, cached: false })
      return { status: res.status, ok, ms, json: () => res.json() }
    }
  }
  const codeOf = (http, op) => (http === 401 || http === 403 ? 'auth' : http === 402 ? 'quota'
    : http === 404 && op !== 'search' ? 'not_found' : http === 400 || http === 422 ? 'invalid' : 'unavailable')

  async function fail(res, op) {
    const code = codeOf(res.status, op)
    if (code === 'quota') { await bump({ latch: true, count: 0 }); throw quota('Channel3 credits are used up for this month') }
    const msg = { auth: 'Channel3 refused the API key', invalid: 'Channel3 rejected the request', not_found: 'Channel3 has no such product' }[code]
    throw new Channel3Error(code, msg || 'Channel3 is unavailable', { http: res.status })
  }

  async function json(res, schema, op) {
    let data
    try { data = schema.parse(await res.json()) } catch {
      log({ op, via: 'rest', ms: res.ms, http: res.status, code: 'bad_response', results: null, cached: false })
      throw new Channel3Error('bad_response', 'Channel3 answered in a shape Verdikt doesn’t know', { http: res.status })
    }
    return data
  }

  /** Listings in stock, new, in USD, at or under maxCents: { products, asOf, cached, via: 'rest' | 'mcp' | 'cache' }. */
  async function search(query, { maxCents, userId } = {}) {
    const q = normalize(query)
    if (q.length < 2) throw new Channel3Error('invalid', 'Say what to look for')
    const cap = maxCents == null ? null : Math.floor(Number(maxCents))
    if (cap != null && !(cap >= 1)) throw new Channel3Error('invalid', 'There is no room left to search within')
    const uid = uidOf(userId)
    const within = (list) => list.filter((p) => p.inStock && (cap == null || p.priceCents <= cap))

    const key = `search|v1|USD|${q.toLowerCase()}|${cap == null ? 'any' : Math.ceil(cap / BUCKET) * BUCKET}`
    const hit = await kv.get(key, TTL.search)
    // a hit searched with a cap at least this high, so nothing under this cap is missing from it
    if (hit && Array.isArray(hit.value?.products) && (hit.value.capCents === null ? true : cap != null && hit.value.capCents >= cap)) {
      const products = within(hit.value.products).map((p) => reattribute(p, uid))
      log({ op: 'search', via: 'cache', ms: 0, http: null, code: null, results: products.length, cached: true })
      return { products, asOf: hit.value.asOf || hit.at, cached: true, via: 'cache' }
    }

    const u = await usage()
    if (u.latched || u.count >= monthlyCap) throw quota('Verdikt has used this month’s Channel3 searches')

    let data, via = 'rest', ms = 0, http = null
    if (!apiKey) {
      if (!mcpSearch) throw new Channel3Error('no_key', 'No Channel3 API key is set')
    } else {
      try {
        const body = {
          query: q, limit: LIMIT,
          filters: { ...(cap != null && { price: { max_price: cap / 100 } }), availability: ['InStock'], conditions: ['new'] },
          config: { country: 'US', currency: 'USD', mode: 'default' },
        }
        const res = await call('search', '/v1/search', { method: 'POST', body, uid })
        await bump()
        if (!res.ok) await fail(res, 'search')
        data = await json(res, SearchBody, 'search')
        ms = res.ms
        http = res.status
      } catch (e) {
        if (!(e instanceof Channel3Error && ['timeout', 'unavailable'].includes(e.code) && mcpSearch)) throw e
      }
    }
    if (!data) {
      via = 'mcp'
      const t0 = performance.now()
      try {
        const raw = await mcpSearch(q, cap)
        data = SearchBody.parse(Array.isArray(raw) ? { products: raw } : raw)
      } catch (e) {
        log({ op: 'search', via, ms: Math.round(performance.now() - t0), http: null, code: e instanceof z.ZodError ? 'bad_response' : 'unavailable', results: null, cached: false })
        if (e instanceof z.ZodError) throw new Channel3Error('bad_response', 'Channel3 answered in a shape Verdikt doesn’t know')
        throw new Channel3Error('unavailable', 'Channel3 is unavailable')
      } finally {
        await bump()
      }
      ms = Math.round(performance.now() - t0)
    }

    const products = within(data.products.map((p) => listing(p)).filter(Boolean))
    log({ op: 'search', via, ms, http, code: null, results: products.length, cached: false })
    const asOf = new Date(now()).toISOString()
    await kv.put(key, { products, capCents: cap, via, asOf })
    // with no key there is no product lookup: a pin reads the listing this search just returned
    if (!apiKey) await Promise.all(products.map((p) => kv.put(productKey(p.id), p)))
    return { products: products.map((p) => reattribute(p, uid)), asOf, cached: false, via }
  }

  /** One product by id, re-read from Channel3 (free): its listing with out-of-stock offers kept. With no API
   *  key, the listing a search returned in the last 15 minutes stands in (MCP has no lookup by id); older
   *  than that, or never searched here: Channel3Error 'no_key'. */
  async function product(id, { userId, fresh = false } = {}) {
    if (!ID.test(String(id ?? ''))) throw new Channel3Error('invalid', 'That isn’t a Channel3 product id')
    const uid = uidOf(userId)
    const key = productKey(id)
    if (!apiKey) {
      const seen = await kv.get(key, TTL.search)
      if (seen?.value?.id) {
        log({ op: 'product', via: 'cache', ms: 0, http: null, code: null, results: 1, cached: true })
        return reattribute(seen.value, uid)
      }
      throw new Channel3Error('no_key', 'No Channel3 API key is set, and no recent search returned this product')
    }
    if (!fresh) {
      const hit = await kv.get(key, TTL.product)
      if (hit?.value?.id) {
        log({ op: 'product', via: 'cache', ms: 0, http: null, code: null, results: 1, cached: true })
        return reattribute(hit.value, uid)
      }
    }
    const res = await call('product', `/v1/products/${encodeURIComponent(id)}?country=US&currency=USD`, { uid })
    if (!res.ok) await fail(res, 'product')
    const p = listing(await json(res, ProductBody, 'product'), { keepOutOfStock: true })
    log({ op: 'product', via: 'rest', ms: res.ms, http: res.status, code: p ? null : 'not_found', results: p ? 1 : 0, cached: false })
    if (!p) throw new Channel3Error('not_found', 'Channel3 has no valid offer for this product', { http: res.status })
    await kv.put(key, p)
    return reattribute(p, uid)
  }

  /** Up to 30 daily USD prices and Channel3's statistics, or null when it doesn't track the product. */
  async function history(id, { days = 30 } = {}) {
    if (!ID.test(String(id ?? ''))) throw new Channel3Error('invalid', 'That isn’t a Channel3 product id')
    if (!apiKey) throw new Channel3Error('no_key', 'No Channel3 API key is set')
    const n =Math.min(90, Math.max(1, Math.floor(Number(days)) || 30))
    const key = `history|v0|${id}|${n}`
    const hit = await kv.get(key, TTL.history)
    if (hit && hit.value && 'history' in hit.value) {
      log({ op: 'history', via: 'cache', ms: 0, http: null, code: null, results: hit.value.history?.points.length ?? 0, cached: true })
      return hit.value.history
    }
    const res = await call('history', `/v0/price-tracking/history/${encodeURIComponent(id)}?days=${n}`)
    if (res.status === 404) {
      await kv.put(key, { history: null })
      return null
    }
    if (!res.ok) await fail(res, 'history')
    const h = await json(res, HistoryBody, 'history')
    const byDay = new Map()
    for (const x of h.history || []) {
      const d = String(x.timestamp).slice(0, 10)
      const c = cents(x.price)
      if ((x.currency || 'USD') === 'USD' && /^\d{4}-\d{2}-\d{2}$/.test(d) && c >= 1) byDay.set(d, c)
    }
    const points = [...byDay].sort(([a], [b]) => (a < b ? -1 : 1)).slice(-30).map(([d, c]) => ({ d, cents: c }))
    const s = h.statistics
    const stats = s && (s.currency || 'USD') === 'USD' ? {
      minCents: cents(s.min_price), maxCents: cents(s.max_price), meanCents: cents(s.mean), currentCents: cents(s.current_price),
      status: STATUS.includes(String(s.current_status || '').toLowerCase()) ? String(s.current_status).toLowerCase() : 'typical',
    } : null
    const out = { storeTitle: clean(h.product_title).slice(0, 200), points, stats }
    log({ op: 'history', via: 'rest', ms: res.ms, http: res.status, code: null, results: points.length, cached: false })
    await kv.put(key, { history: out })
    return out
  }

  return { search, product, history }
}

// ---- the server's client, built from env on first use -----------------------------------------------------

let shared = null
const monthlyCapOf = (env) => {
  const cap = Number(env.CHANNEL3_MONTHLY_CAP)
  return env.CHANNEL3_MONTHLY_CAP && Number.isFinite(cap) && cap >= 0 ? cap : 900
}
function client() {
  return (shared ??= createChannel3({
    apiKey: process.env.CHANNEL3_API_KEY || '',
    apiUrl: process.env.CHANNEL3_API_URL || API_URL,
    mcpUrl: process.env.CHANNEL3_MCP_URL || MCP_URL,
    monthlyCap: monthlyCapOf(process.env),
    cache: priceChecksCache,
  }))
}

/** How the server is set up for Channel3, from env alone (no call, no count): for /health and the boot log.
 *  on: the key is set (REST search and product lookups); search: 'rest', or 'mcp' (anonymous, keyless);
 *  cap: searches a month before Verdikt stops itself. */
export function channel3Status(env = process.env) {
  const on = !!env.CHANNEL3_API_KEY
  return { on, search: on ? 'rest' : 'mcp', cap: monthlyCapOf(env) }
}

export const channel3 = {
  search: (query, opts) => client().search(query, opts),
  product: (id, opts) => client().product(id, opts),
  history: (id, opts) => client().history(id, opts),
}
