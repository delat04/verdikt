/*  ============================================================================
    Precedent — Verdikt's case law, kept in Elasticsearch. The index is a projection of Postgres: one
    document per signed check (its _id is the criterion id) recording how that check was finally decided,
    by a probe, by Claude or on appeal, so it can always be rebuilt exactly and a second sync writes nothing.
    Before Claude judges a check the probes couldn't settle, Verdikt runs one hybrid search per check:
    semantic_text (pinned to Elastic's Jina embeddings) fused with BM25 through RRF, then Elastic's Jina
    reranker with a calibrated floor applied in Elastic (min_score), one case per contract and never from
    the same contract. Everything that could identify a contract (emails, links, quotes, amounts, phone
    numbers, IP addresses, handles, repositories, the parties' names and brand) is redacted before it is indexed or
    searched. Off without ELASTIC_URL and ELASTIC_API_KEY (or with ELASTIC_PRECEDENT=off); a slow or failing
    search never holds up a verdict, and nothing here is on the money path.
    The v2 index is created only by `npm run precedent:sync -- --rebuild --yes`, never at boot.
    ============================================================================ */

import { createHash } from 'node:crypto'
import { Client } from '@elastic/elasticsearch'
import { scanText } from '../agent/guard.js'
import { stanceOf } from '../agent/precedent.js'
import { db, audit } from './supabase.js'

export const INDEX = process.env.ELASTIC_INDEX || 'verdikt-precedent'   // an alias; v1's 'verdikt-checks' is left alone
export const EMBED = process.env.ELASTIC_EMBED || '.jina-embeddings-v5-text-small'
export const RERANKER = process.env.ELASTIC_RERANKER || '.jina-reranker-v3'
// the reranker's raw relevance (the retriever reports it + 1). Calibrated: real matches sit above, filler below
const floorEnv = Number(process.env.ELASTIC_PRECEDENT_MIN || 0.22)
export const FLOOR = Number.isFinite(floorEnv) ? floorEnv : 0.22
export const CLOSE_RAW = 0.35   // at or above: a close match; below: related
export const SCHEMA = 2
export const REDACTION = 2
const CAP = 4

let forced = false
export const precedentOn = () => forced || !!(process.env.ELASTIC_URL && process.env.ELASTIC_API_KEY && process.env.ELASTIC_PRECEDENT !== 'off')

let es = null
const client = () => (es ??= new Client({ node: process.env.ELASTIC_URL, auth: { apiKey: process.env.ELASTIC_API_KEY }, requestTimeout: 3000, maxRetries: 1 }))
// writes and admin calls happen off the verdict's clock: they get longer than a search
const SLOW = { requestTimeout: 60_000 }
/** The Elasticsearch client, for the precedent scripts. */
export const esClient = () => client()

/** Tests: a fake client (msearch, count, mget, bulk, indices…), and precedent counts as on. null resets. */
export function __setClient(fake) {
  es = fake || null
  forced = !!fake
  ready = null
  readyAt = 0
  status = { state: 'degraded', reason: 'not checked yet' }
  corpus = { n: null, at: 0 }
}

const sha = (s) => createHash('sha256').update(String(s)).digest('hex')
const sha16 = (s) => sha(s).slice(0, 16)
/** A contract as the index knows it: never its id. */
export const contractKey = (id) => sha16(id)
/** The two parties of a contract, in either order. */
export const partiesKey = (a, b) => sha16([a || '', b || ''].sort().join(':'))

// ---- redaction ---------------------------------------------------------------------------------------

// lower-case TLDs: every two-letter one (a country), less the file extensions and code words that look like one,
// and the generic ones a small business uses. README.md, package.json, console.log and "the button.It" stay
const GTLDS = `com net org info biz io app dev co ai site shop store xyz studio design agency page tech cafe coffee
  online website web blog art club world live life space fun guru ninja rocks land zone plus one top vip pro mobi name
  cloud digital media news email market works solutions services company center network systems social today group
  global link click codes tools software support help wiki academy school education training consulting marketing
  legal law money finance bank capital ventures boutique restaurant menu bar pizza bakery kitchen events photo
  photography gallery fashion beauty fitness health care house homes realty estate travel tours hotel tickets`
const NOT_TLDS = 'md js ts py rb go sh cs rs kt db gz pl pm ps hs mk id el fn ok vs mp gl lo'
const TLD = String.raw`(?:${GTLDS.trim().split(/\s+/).join('|')}|(?!(?:${NOT_TLDS.split(' ').join('|')})(?![a-z]))[a-z]{2})`
const NUM = String.raw`\d(?:[\d,.]*\d)?`
const CODES = 'USD|EUR|GBP|CAD|AUD|INR|JPY'
// a bare number right after a price word is an amount: "priced at 49.99", "Total 1,200 per month"
const PRICE_WORDS = String.raw`price[sd]?|costs?|total|subtotal|fees?|budget|paid|pays?|charged?|invoiced?`
const RE = {
  email: /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g,
  url: /\b[a-z][a-z0-9+.-]*:\/\/[^\s<>"“”‘’'`]+/gi,
  // the TLD ends the host: "next.config.js" is a file, not next.config + ".js"
  domain: new RegExp(String.raw`(?<![\w.@/-])(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.)+${TLD}(?![\w-]|\.[A-Za-z0-9])(?:/[^\s<>"“”‘’'` + '`' + String.raw`]*)?`, 'g'),
  ipv4: /(?<![\w.])(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)(?::\d{2,5})?(?![\w.]*\d)/g,
  bare: new RegExp(String.raw`(\b(?:${PRICE_WORDS})\b(?:\s+(?:is|was|of|as|at|to|the|now|only|just|shows?|showed|shown|reads?|=)){0,3}\s*[:=]?\s*)\d(?:\d{0,2}(?:,\d{3})+|\d*)(?:\.\d{1,2})?(?![\d.,]*\d|\s*(?:%|px|ms|items?|products?|cards?|pages?|checks?|of\b|out\b|seconds?|s\b))`, 'gi'),
  handle: /(^|[\s([,;:])@[A-Za-z0-9_](?:[\w.-]*\w)?/g,
  quotes: [
    /„[^„“”]{1,120}[“”]/g,
    /«[^«»]{1,120}»/g,
    /“[^“”]{1,120}”/g,
    /"[^"]{1,120}"/g,
    /`[^`]{1,120}`/g,
  ],
  // single quotes only when they open after the start, a space or "(": "the site's menu" is not a quote
  single: /(^|[\s(])['‘][^'‘’]{2,120}?['’](?![\p{L}\p{N}])/gu,
  amounts: [
    new RegExp(String.raw`(?:\b(?:US|CA|AU|NZ|HK|SG|A|C|S))?[$€£¥₹]\s?${NUM}(?:[kKmM]\b|bn\b|\s(?:thousand|million|billion)\b)?`, 'g'),
    new RegExp(String.raw`\b${NUM}\s?[€£¥₹]`, 'g'),
    new RegExp(String.raw`\b${NUM}\s?(?:${CODES})\b`, 'g'),
    new RegExp(String.raw`\b(?:${CODES})\s?${NUM}`, 'g'),
    new RegExp(String.raw`\b${NUM}\s?(?:dollars?|euros?|pounds?|bucks)\b`, 'gi'),
  ],
  phone: /(?<![\w+])\+?\(?\d[\d\s().-]{7,}\d(?!\w)/g,
}

// a link or path loses its trailing punctuation to the sentence, not to the replacement
const keepTail = (word) => (m) => { const tail = m.match(/[.,;:!?)\]]+$/)?.[0] || ''; return word + tail }

function phone(m) {
  const digits = m.replace(/\D/g, '')
  if (digits.length < 9 || digits.length > 15) return m
  if (/\d{4}-\d{2}-\d{2}/.test(m)) return m                                  // an ISO date, not a number to call
  if (!m.startsWith('+') && !m.includes('(') && !/\d{4}/.test(m)) return m   // "90 95 100 98" is a list of scores
  return 'a phone number'
}

function cap(s, max) {
  if (s.length <= max) return s
  const cut = s.slice(0, max - 1)
  const space = cut.lastIndexOf(' ')
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.—–-]+$/, '')}…`
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * What could identify a contract goes before anything is indexed or searched. Pure and idempotent:
 * redact(redact(s)) === redact(s). deny: denyListFor(…) for this contract's names and brand.
 */
export function redact(s = '', { deny = [], max = 400 } = {}) {
  let t = String(s ?? '').replace(/\s+/g, ' ')
  t = t.replace(RE.email, 'an email')                    // before domains: maria.lopez@the site must not happen
  t = t.replace(RE.url, keepTail('the site'))
  t = t.replace(RE.domain, keepTail('the site'))
  t = t.replace(RE.handle, '$1a handle')
  for (const re of RE.quotes) t = t.replace(re, '“…”')
  t = t.replace(RE.single, '$1“…”')
  t = t.replace(RE.ipv4, 'an IP address')               // before phones: 192.168.10.24 has the digits of one
  for (const re of RE.amounts) t = t.replace(re, 'an amount')
  t = t.replace(RE.bare, '$1an amount')
  t = t.replace(RE.phone, phone)
  const words = [...(deny || [])].filter((d) => d?.token).sort((a, b) => b.token.length - a.token.length || a.token.localeCompare(b.token))
  for (const d of words) {
    // a cased name (a short one, or one that is also a word: Grace, Will, Al) is replaced only capitalised
    const token = d.cased ? d.token[0].toUpperCase() + d.token.slice(1) : d.token
    t = t.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(token)}(?![\\p{L}\\p{N}])`, d.cased ? 'gu' : 'giu'), d.as === 'person' ? 'a name' : 'the business')
  }
  t = t
    .replace(/\b(a name|the business)(?:\s+\1\b)+/gi, '$1')           // "Harbor Bakery" → one "the business"
    .replace(/\b(?:the|a|an)\s+(the business|a name)\b/gi, '$1')     // "the Harbor Bakery" → "the business"
    .replace(/\s+/g, ' ')
    .trim()
  return cap(t, max)
}

// words that name the kind of work, never a client: they are never denied
const GENERIC = new Set(`
  shop store site page pages landing home online cafe coffee studio website portfolio booking menu launch phase app apps
  web blog docs main demo test sample new redesign design build project contract milestone delivery client freelancer
  mobile desktop form contact about product products order orders cart checkout pricing team business company agency
  services service brand name email handle amount phone number user users admin dashboard server frontend backend
  version update rebuild prototype vercel netlify github render onrender heroku herokuapp firebase pages surge glitch
  replit localhost http https html react next nuxt vue svelte astro official full stack final first second third
`.trim().split(/\s+/))
// first names that are also words: never a brand, but a party called Grace is still a name. Denied only capitalised,
// like every name under 3 letters (Al, Ng), so "it will load" and "each li" stay as they are
const WORDLIKE = new Set('will may mark rose grace hope joy bill art max ray sky dawn june april summer faith guy jack pat sue rob don'.split(' '))

const lettersOf = (s, min) => (String(s || '').match(/\p{L}+/gu) || []).filter((w) => w.length >= min).map((w) => w.toLowerCase())
const hostOf = (u) => { try { return new URL(/^[a-z]+:\/\//i.test(u) ? u : `https://${u}`).hostname.replace(/^www\./, '') } catch { return '' } }

/**
 * This contract's own names, to redact from its checks: the parties' display names ('a name') and its
 * brand ('the business') from the live host, the GitHub owner/repo and the title's capitalised words. Pure.
 */
export function denyListFor({ title = '', clientName = '', freelancerName = '', liveUrls = [], repoUrls = [] } = {}) {
  const people = new Set([...lettersOf(clientName, 2), ...lettersOf(freelancerName, 2)])
  const brands = new Set()
  for (const u of liveUrls || []) for (const w of lettersOf(hostOf(u).split('.')[0], 4)) brands.add(w)
  for (const u of repoUrls || []) {
    const m = String(u || '').match(/github\.com\/([^/\s]+)\/([^/\s#?]+)/i)
    if (m) for (const w of [...lettersOf(m[1], 4), ...lettersOf(m[2].replace(/\.git$/i, ''), 4)]) brands.add(w)
  }
  for (const w of String(title || '').match(/\p{Lu}\p{L}{3,}/gu) || []) brands.add(w.toLowerCase())
  const out = new Map()
  for (const w of brands) if (!GENERIC.has(w) && !WORDLIKE.has(w)) out.set(w, 'brand')
  for (const w of people) if (!GENERIC.has(w)) out.set(w, 'person')   // a name that is also the brand reads as a name
  const cased = (token, as) => as === 'person' && (token.length < 3 || WORDLIKE.has(token))
  return [...out].map(([token, as]) => (cased(token, as) ? { token, as, cased: true } : { token, as })).sort((a, b) => a.token.localeCompare(b.token))
}

// ---- the projection: one document per signed check ----------------------------------------------------

const time = (d) => new Date(d || 0).getTime()
const isTampered = (t) => !!t && t.detected !== false
const injected = (doc) => scanText(doc.statement_text).length > 0 || scanText(doc.reason).length > 0

/** Legacy evidence (v1) had no stance: work it out from its cases. */
function stanceIn(result) {
  const p = (result.evidence || []).find((e) => e?.type === 'precedent')
  if (p?.stance) return p.stance
  if (Array.isArray(p?.items)) return stanceOf(p.items, result.passed).stance
  return 'none'
}

/**
 * The second review's last word on this check, if it is final. An overturn is a recommendation until the
 * client accepts it; declined, the verdict stands. An upheld check needs nobody's click.
 */
function appealOn(criterionId, appeals, after) {
  const final = (a, f) => f.decision === 'uphold' ? ['decided', 'accepted', 'declined'].includes(a.status) : f.decision === 'overturn' && ['accepted', 'declined'].includes(a.status)
  const hit = (appeals || [])
    .filter((a) => time(a.created_at) > after)
    .map((a) => ({ a, f: (a.findings || []).find((f) => f?.criterion_id === criterionId) }))
    .filter((x) => x.f && final(x.a, x.f))
    .sort((x, y) => time(y.a.created_at) - time(x.a.created_at))[0]
  if (!hit) return null
  return hit.f.decision === 'overturn' && hit.a.status === 'accepted' ? { overturned: true, explanation: hit.f.explanation } : { overturned: false }
}

function project({ criterion: c, contract = {}, milestone = null, verdicts = [], appeals = [], deny = [] }) {
  const rows = (verdicts || [])
    .filter((v) => !isTampered(v.tamper))
    .map((v) => ({ v, r: v.result ?? (v.criterion_results || []).find((x) => x.criterion_id === c.id) }))
    .filter((x) => x.r)
    .sort((a, b) => time(a.v.created_at) - time(b.v.created_at) || String(a.v.id).localeCompare(String(b.v.id)))
  if (!rows.length) return null
  const first = rows[0].r
  const { v, r } = rows.at(-1)
  const spec = c.check_spec || {}
  const statement = redact(c.statement, { deny })
  const doc = {
    criterion: c.id,
    statement,
    statement_text: statement,
    contract: contractKey(contract.id),
    parties: partiesKey(contract.client_id, contract.freelancer_id),
    milestone,
    verdict: v.id,
    kind: c.kind,
    layer: r.layer || 'model',
    met: !!r.passed,
    met_first: !!first.passed,
    attempts: rows.length,
    failed_probe: (r.probes || []).find((p) => p?.status === 'fail' && p.hard)?.type || null,
    probes: (spec.probes || []).map((p) => p?.type).filter(Boolean),
    sufficient: !!spec.sufficient,
    reason: redact(r.explanation, { deny, max: 160 }),
    stance: stanceIn(r),
    appeal: null,
    source: 'verifier',
    redaction: REDACTION,
    at: v.created_at,
  }
  if (!r.passed) {
    const a = appealOn(c.id, appeals, time(v.created_at))
    if (a?.overturned) Object.assign(doc, { met: true, layer: 'appeal', appeal: 'overturned', reason: redact(a.explanation, { deny, max: 160 }) })
    else if (a) doc.appeal = 'upheld'
  }
  const { statement: _s, ...hashed } = doc
  doc.sig = sha(JSON.stringify(Object.keys(hashed).sort().map((k) => [k, hashed[k]])))
  return doc
}

/**
 * One check's document, or null: no result yet (or only tampered deliveries), or its text addresses the
 * verifier. Inputs: the criterion (id, statement, kind, check_spec), its contract (id, client_id,
 * freelancer_id), every verdict on the milestone (with tamper and criterion_results, or result), the
 * milestone's appeals (status, findings, created_at) and the contract's deny list. Pure.
 */
export function docFor(input) {
  const doc = project(input)
  return doc && !injected(doc) ? doc : null
}

export function mappingFor() {
  const kw = { type: 'keyword' }
  return {
    dynamic: 'strict',
    _meta: { schema: SCHEMA, embed: EMBED, reranker: RERANKER, redaction: REDACTION },
    properties: {
      statement: { type: 'semantic_text', inference_id: EMBED },
      statement_text: { type: 'text', fields: { raw: { type: 'keyword', ignore_above: 512 } } },
      ...Object.fromEntries(['criterion', 'contract', 'parties', 'milestone', 'verdict', 'kind', 'layer', 'appeal', 'stance', 'failed_probe', 'probes', 'source', 'sig'].map((k) => [k, kw])),
      met: { type: 'boolean' },
      met_first: { type: 'boolean' },
      sufficient: { type: 'boolean' },
      attempts: { type: 'integer' },
      redaction: { type: 'integer' },
      reason: { type: 'text' },
      at: { type: 'date' },
    },
  }
}

/** A new concrete v2 index (the scripts only; boot never creates one). */
export async function createIndex(name) {
  await client().indices.create({ index: name, mappings: mappingFor() }, SLOW)
}

// ---- ready? -------------------------------------------------------------------------------------------

let ready = null
let readyAt = 0
let status = { state: 'degraded', reason: 'not checked yet' }

async function check() {
  const c = client()
  // one round trip: the alias and its indices, or a 404 when there is no such alias
  const aliases = await c.indices.getAlias({ name: INDEX }).catch((e) => { if (e?.meta?.statusCode === 404) return null; throw e })
  if (aliases) {
    const names = Object.keys(aliases)
    const write = names.find((n) => aliases[n]?.aliases?.[INDEX]?.is_write_index) || (names.length === 1 ? names[0] : null)
    if (!write) return { state: 'degraded', reason: `the alias ${INDEX} has no write index` }
    const mappings = (await c.indices.getMapping({ index: write }))[write]?.mappings || {}
    if (mappings._meta?.schema !== SCHEMA) return { state: 'degraded', reason: `${write} is not a schema ${SCHEMA} index` }
    const embed = mappings.properties?.statement?.inference_id
    if (embed !== EMBED) return { state: 'degraded', reason: `${write} embeds with ${embed || 'no pinned model'}, not ${EMBED}` }
    return { state: 'on', alias: INDEX, index: write }
  }
  if (await c.indices.exists({ index: INDEX })) return { state: 'degraded', reason: `${INDEX} is an index, not an alias` }
  return { state: 'degraded', reason: `no alias ${INDEX} yet` }
}

const errorName = (e) => `${e?.name || 'Error'}${e?.meta?.statusCode ? ` ${e.meta.statusCode}` : ''}`

/** Is the alias there, on a schema-2 index that pins EMBED? Cached 5 minutes; an error is retried next call. */
export function ensureReady() {
  if (!precedentOn()) { status = { state: 'off' }; return Promise.resolve(status) }
  if (ready && Date.now() - readyAt < 5 * 60_000) return ready
  readyAt = Date.now()
  ready = check().then(
    (s) => (status = s),
    (e) => { ready = null; return (status = { state: 'degraded', reason: errorName(e) }) },
  )
  return ready
}

/** For /health: a state and the pinned models, never the URL or the key. No call to Elastic. */
export function health() {
  return { state: precedentOn() ? status.state : 'off', embed: EMBED, reranker: RERANKER, schema: SCHEMA }
}

/** After listen: one line in the log saying where precedent stands. */
export async function initPrecedent(log = console) {
  if (!precedentOn()) { log.info('precedent off'); return }
  const r = await ensureReady()
  if (r.state === 'on') log.info(`precedent on (${r.alias} → ${r.index} · ${EMBED} · ${RERANKER})`)
  else log.warn(`precedent degraded: ${r.reason}. Run npm run precedent:sync -- --rebuild --yes`)
}

// ---- sync: Postgres → the index -----------------------------------------------------------------------

const SELECT = `id,
  contract:contracts(id, title, client_id, freelancer_id, client:profiles!contracts_client_id_fkey(display_name), freelancer:profiles!contracts_freelancer_id_fkey(display_name)),
  criteria(id, statement, kind, check_spec),
  appeals(status, findings, created_at),
  submissions(live_url, repo_url, verdicts(id, created_at, tamper:report->tamper, criterion_results(criterion_id, passed, layer, explanation, probes, evidence)))`

const warned = new Set()
function failed(e) {
  const name = e?.name || 'Error'
  const code = e?.meta?.statusCode ?? null
  console.warn(`precedent: index failed (${name}${code ? ` ${code}` : ''})`)   // never the error's text: it can quote a document
  if (warned.has(name)) return
  warned.add(name)
  audit({ contractId: null, milestoneId: null, actor: 'system', event: 'precedent.index_failed', payload: { name, status: code } }).catch(() => {})
}

/** Every check's document for these milestones, read in one select per 100 milestones. */
async function collect(ids) {
  const out = { docs: [], flagged: 0, milestones: 0 }
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await db().from('milestones').select(SELECT).in('id', ids.slice(i, i + 100))
    if (error) throw Object.assign(new Error('select failed'), { name: 'SupabaseError', meta: { statusCode: error.code || null } })
    for (const m of data || []) {
      const subs = m.submissions || []
      const verdicts = subs.flatMap((s) => s.verdicts || [])
      if (!verdicts.length) continue
      const deny = denyListFor({
        title: m.contract?.title,
        clientName: m.contract?.client?.display_name,
        freelancerName: m.contract?.freelancer?.display_name,
        liveUrls: subs.map((s) => s.live_url).filter(Boolean),
        repoUrls: subs.map((s) => s.repo_url).filter(Boolean),
      })
      let n = 0
      for (const c of m.criteria || []) {
        const doc = project({ criterion: c, contract: m.contract || {}, milestone: m.id, verdicts, appeals: m.appeals, deny })
        if (!doc) continue
        if (injected(doc)) { out.flagged++; continue }   // text that addresses the verifier never becomes precedent
        out.docs.push(doc)
        n++
      }
      if (n) out.milestones++
    }
  }
  return out
}

const empty = () => ({ indexed: 0, unchanged: 0, flagged: 0, failed: 0, milestones: 0 })
const add = (t, r) => { for (const k of Object.keys(t)) t[k] += r[k] || 0; return t }

/**
 * Bring these milestones' checks up to date: build each document, compare its sig with the stored one
 * (one mget) and index only what changed. → { indexed, unchanged, flagged, failed, milestones }. Never throws.
 * index: the alias by default (writes need it to exist: require_alias), or a new concrete index from --rebuild.
 */
export async function syncMilestones(ids, { index = INDEX, refresh = false } = {}) {
  const res = empty()
  const list = [...new Set((ids || []).filter(Boolean))]
  if (!precedentOn() || !list.length) return res
  let docs = []
  try {
    if (index === INDEX && (await ensureReady()).state !== 'on') return res
    const got = await collect(list)
    Object.assign(res, { flagged: got.flagged, milestones: got.milestones })
    docs = got.docs
    if (!docs.length) return res
    const { docs: stored } = await client().mget({ index, ids: docs.map((d) => d.criterion), _source: ['sig'] }, SLOW)
    const sigs = new Map((stored || []).filter((d) => d.found).map((d) => [d._id, d._source?.sig]))
    const changed = docs.filter((d) => sigs.get(d.criterion) !== d.sig)
    res.unchanged = docs.length - changed.length
    if (!changed.length) return res
    const out = await client().bulk({
      index,
      // writing through the alias: a deleted index must never be auto-created with a plain-text mapping. A
      // --rebuild target is a concrete index the script has just created with the strict mapping
      require_alias: index === INDEX,
      refresh,
      operations: changed.flatMap((d) => [{ index: { _id: d.criterion } }, d]),
    }, SLOW)
    const errors = (out.items || []).filter((i) => i.index?.error)
    res.failed = errors.length
    res.indexed = changed.length - errors.length
    if (errors.length) failed({ name: `BulkItem${errors[0].index.error.type ? `:${errors[0].index.error.type}` : ''}`, meta: { statusCode: errors[0].index.status } })
  } catch (e) {
    res.failed = Math.max(docs.length - res.indexed - res.unchanged, 1)
    failed(e)
  }
  return res
}

/** Every milestone, a page at a time. Never throws. */
export async function syncAll({ index = INDEX, pageSize = 200, refresh = false } = {}) {
  const total = empty()
  if (!precedentOn()) return total
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await db().from('milestones').select('id').order('id').range(from, from + pageSize - 1)
    if (error) { total.failed++; failed({ name: 'SupabaseError', meta: { statusCode: error.code || null } }); break }
    if (!data?.length) break
    add(total, await syncMilestones(data.map((m) => m.id), { index, refresh }))
    if (data.length < pageSize) break
  }
  return total
}

/** The documents a rebuild would write, without writing anything (the dry run). Throws on a read error. */
export async function projectAll({ pageSize = 200 } = {}) {
  const all = { docs: [], flagged: 0, milestones: 0 }
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await db().from('milestones').select('id').order('id').range(from, from + pageSize - 1)
    if (error) throw new Error(`Supabase: ${error.message}`)
    if (!data?.length) break
    const got = await collect(data.map((m) => m.id))
    all.docs.push(...got.docs)
    all.flagged += got.flagged
    all.milestones += got.milestones
    if (data.length < pageSize) break
  }
  return all
}

/**
 * Outage recovery without an outbox: re-sync the milestones whose verdicts or appeals moved in the last
 * few days. Unchanged documents cost one mget. Never throws.
 */
export async function syncRecent({ days = 3 } = {}) {
  if (!precedentOn()) return empty()
  try {
    if ((await ensureReady()).state !== 'on') return empty()
    const since = new Date(Date.now() - days * 86_400_000).toISOString()
    const [v, a] = await Promise.all([
      db().from('verdicts').select('submission:submissions(milestone_id)').gte('created_at', since),
      db().from('appeals').select('milestone_id').or(`created_at.gte."${since}",decided_at.gte."${since}",closed_at.gte."${since}"`),
    ])
    const ids = [...(v.data || []).map((x) => x.submission?.milestone_id), ...(a.data || []).map((x) => x.milestone_id)]
    return await syncMilestones(ids)
  } catch (e) {
    failed(e)
    return empty()
  }
}

// ---- search -------------------------------------------------------------------------------------------

/** One check's msearch body: hybrid (semantic + BM25, RRF), reranked, floored in Elastic, one case per contract. Pure. */
export function buildSearch(c, ctx = {}) {
  const q = redact(c.statement, { deny: ctx.deny })
  const filter = [{ term: { redaction: REDACTION } }]
  const must_not = [
    ...(ctx.contract ? [{ term: { contract: ctx.contract } }] : []),
    { term: { criterion: String(c.id ?? '') } },
    // off by default: a solo tester's contracts all share the same two parties
    ...(process.env.ELASTIC_PRECEDENT_EXCLUDE_PARTIES === 'on' && ctx.parties ? [{ term: { parties: ctx.parties } }] : []),
  ]
  return {
    size: CAP,
    _source: ['statement_text', 'kind', 'met', 'met_first', 'layer', 'appeal', 'reason', 'at', 'contract', 'attempts'],
    collapse: { field: 'contract' },
    retriever: {
      text_similarity_reranker: {
        retriever: {
          rrf: {
            retrievers: [
              { standard: { query: { bool: { must: [{ semantic: { field: 'statement', query: q } }], filter, must_not } } } },
              { standard: { query: { bool: { must: [{ match: { statement_text: q } }], filter, must_not } } } },
            ],
            rank_window_size: 20,
          },
        },
        field: 'statement_text',
        inference_id: RERANKER,
        inference_text: q,
        rank_window_size: 20,
        min_score: FLOOR,
      },
    },
  }
}

const round3 = (n) => Math.round(n * 1000) / 1000

/**
 * Hits → at most 4 cases, best first, one per contract, nothing that addresses the verifier. Given the
 * check's kind, a related case (below CLOSE_RAW) of another kind is dropped: the reranker can score a
 * different check on the same page above the floor, and only a close match crosses kinds. Pure.
 */
export function pickPrecedent(hits = [], kind = null) {
  const seen = new Set()
  return (hits || [])
    .map((h) => ({ h, s: h._source || {}, raw: round3((h._score ?? 0) - 1) }))
    .filter(({ s, raw }) => raw >= FLOOR && (!kind || raw >= CLOSE_RAW || s.kind === kind) && !scanText(s.statement_text).length && !scanText(s.reason).length)
    .sort((a, b) => b.raw - a.raw || time(b.s.at) - time(a.s.at) || String(a.h._id).localeCompare(String(b.h._id)))
    .filter(({ s }) => !s.contract || (!seen.has(s.contract) && seen.add(s.contract)))
    .slice(0, CAP)
    .map(({ h, s, raw }) => ({
      id: h._id,
      statement: s.statement_text,
      kind: s.kind,
      met: !!s.met,
      metFirst: s.met_first ?? null,
      layer: s.layer,
      appeal: s.appeal ?? null,
      reason: s.reason || '',
      at: s.at,
      score: raw,
      band: raw >= CLOSE_RAW ? 'close' : 'related',
      contract: s.contract,   // kept in memory (the try script prints it); never stored with a verdict
    }))
}

let corpus = { n: null, at: 0 }
/** How many checks the index holds: cached 10 minutes, and never a reason to fail a search. */
async function corpusSize() {
  if (corpus.at && Date.now() - corpus.at < 10 * 60_000) return corpus.n
  try {
    const { count } = await client().count({ index: INDEX, query: { term: { redaction: REDACTION } } })
    corpus = { n: count, at: Date.now() }
  } catch {
    // keep the last known size
  }
  return corpus.n
}

/**
 * The most similar checks on other contracts, per criterion. ctx: { contract: contractKey(id),
 * parties: partiesKey(a, b), deny }. → { status: ok | off | degraded | error, ms, map: Map(criterionId →
 * cases), corpus }. A criterion with no case above the floor has no entry. Never throws.
 */
export async function precedentFor(criteria = [], ctx = {}) {
  const t0 = Date.now()
  const done = (s, map = new Map(), n = null) => ({ status: s, ms: Date.now() - t0, map, corpus: n })
  if (!precedentOn()) return done('off')
  if (!criteria?.length) return done('ok')
  try {
    if ((await ensureReady()).state !== 'on') return done('degraded')
    const [res, n] = await Promise.all([
      client().msearch({ searches: criteria.flatMap((c) => [{ index: INDEX }, buildSearch(c, ctx)]) }),
      corpusSize(),
    ])
    const map = new Map()
    let errors = 0
    criteria.forEach((c, i) => {
      const r = res.responses?.[i]
      if (!r || r.error) { errors++; return }
      const cases = pickPrecedent(r.hits?.hits, c.kind)
      if (cases.length) map.set(c.id, cases)
    })
    return done(errors === criteria.length ? 'error' : 'ok', map, n)
  } catch {
    return done('error')
  }
}

/** At most ms for precedent; past it the verdict goes ahead without it. */
export function withBudget(promise, ms) {
  const t0 = Date.now()
  let timer
  const late = new Promise((resolve) => { timer = setTimeout(() => resolve({ status: 'timeout', ms: Date.now() - t0, map: new Map(), corpus: null }), ms) })
  const work = Promise.resolve(promise).catch(() => ({ status: 'error', ms: Date.now() - t0, map: new Map(), corpus: null }))
  return Promise.race([work.finally(() => clearTimeout(timer)), late])
}

// ---- what both sides and the model see ----------------------------------------------------------------

// How this check's outcome sits with its cases: follows (most agree), split (half), departs, or none. The rule
// lives in the shared pure copy (agent/precedent.js ↔ web/src/domain/precedent.js), so the demo can't drift
export { stanceOf }

/** As evidence on a check's result (v2): the stance, the model's reason for a departure, and the cases. */
export function precedentEvidence(items, { passed, departsBecause = '' } = {}) {
  if (!items) return []
  const s = stanceOf(items, passed)
  return [{
    type: 'precedent',
    v: 2,
    label: `Similar checks · ${s.n}`,
    ...s,
    departsBecause: String(departsBecause || '').trim(),
    items: items.map((p) => ({ id: p.id, statement: p.statement, kind: p.kind, met: p.met, metFirst: p.metFirst ?? null, layer: p.layer, appeal: p.appeal ?? null, reason: p.reason || '', at: p.at, score: p.score, band: p.band })),
  }]
}

const unmark = (s) => String(s || '').replace(/<{3,}|>{3,}/g, '')

/** One criterion's cases, a line each, for the model. */
export function precedentLines(list) {
  if (!list?.length) return ''
  return list.map((p) => `  PRECEDENT · ${p.met ? 'met' : 'not met'} · [${p.kind}] ${unmark(p.statement)}${p.reason ? ` — ${unmark(p.reason)}` : ''}`).join('\n')
}

/** Every judged criterion's cases, inside untrusted markers; '' when there is nothing to show. Pure. */
export function precedentBlock(toJudge = [], map = new Map()) {
  const parts = (toJudge || []).filter((c) => map?.get(c.id)?.length).map((c) => `for id ${c.id}:\n${precedentLines(map.get(c.id))}`)
  if (!parts.length) return ''
  return ['<<<UNTRUSTED precedent START>>>', ...parts, '<<<UNTRUSTED precedent END>>>'].join('\n')
}

/**
 * The exact precedent a verdict saw, as one hash for its receipt: each case's id and score, and every field
 * precedentLines shows the model (met, kind, statement, reason) or the parties (layer, appeal). A later re-sync
 * that rewrites a case's text can't leave an earlier receipt still matching.
 */
export function snapshotDigest(map = new Map()) {
  const rows = [...(map || new Map())]
    .sort(([a], [b]) => String(a).localeCompare(String(b)))
    .map(([id, items]) => [id, (items || []).map((p) => [p.id, p.met, p.score, p.kind ?? null, p.statement ?? '', p.reason ?? '', p.layer ?? null, p.appeal ?? null])])
  return sha(JSON.stringify(rows))
}

/**
 * What a verdict keeps of a precedentFor result (or withBudget's timeout): the cases for the checks the model
 * judges, and report.precedent. The digest is set only when the search answered: after a timeout, an error or
 * with the index degraded the model was shown nothing, and the receipt keeps its formula without precedent.
 * → { map: Map(criterionId → cases) for toJudge only, report }. Pure (asOf aside).
 */
export function precedentReport(pre, toJudge = [], asOf = new Date()) {
  const ids = new Set((toJudge || []).map((c) => c.id))
  const map = new Map([...(pre?.map || new Map())].filter(([id]) => ids.has(id)))
  const cases = [...map.values()].reduce((s, items) => s + items.length, 0)
  return {
    map,
    report: {
      status: pre?.status || 'error',
      ms: pre?.ms ?? null,
      asked: [...ids],
      matched: map.size,
      cases,
      corpus: pre?.corpus ?? null,
      embed: EMBED,
      reranker: RERANKER,
      floor: FLOOR,
      asOf: new Date(asOf).toISOString(),
      digest: pre?.status === 'ok' ? snapshotDigest(map) : null,
    },
  }
}
