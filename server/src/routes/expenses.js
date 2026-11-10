/*  ============================================================================
    Expenses — a milestone's expense budget, reimbursed one receipt at a time.
    · PUT  /milestones/:id/expense-budget  how much, and what it covers — part of the terms (resets both signatures)
    · GET  /milestones/:id/expenses        the budget, what's spent or waiting, and every claim
    · POST /milestones/:id/expenses        freelancer (or their agent): a claim with its receipt. Deterministic
                                           checks read it; all pass → PayPal captures that amount from the hold and
                                           pays it out; one fails → rejected with the reason; unreadable → the client
    · POST /expenses/:id/approve|decline   client: settle a claim the checks couldn't
    · GET  /expenses/:id/receipt           either party: a short-lived link to the receipt
    · POST /expenses/:id/payout            either party: retry paying a reimbursed claim (e.g. after adding an email)
    · POST /milestones/:id/expenses/products        either party: live product listings (Channel3) within the room left
    · POST /milestones/:id/expenses/plan            either party: put a listing on the shopping list, re-read by id
    · POST /milestones/:id/expenses/plan/:pid/agree    client: agree to an item the freelancer proposed after signing
    · POST /milestones/:id/expenses/plan/:pid/decline  client: decline it (it leaves the list)
    · DELETE /milestones/:id/expenses/plan/:pid     take an item off the list (who may: expenseRules.canRemove)
    A refused list action answers { error, code } (+ retryAfterSec | retryAt | resetsOn), worded by expenseRules.listError.
    ============================================================================ */

import { db, audit } from '../lib/supabase.js'
import { requireUser, milestoneFor } from '../lib/auth.js'
import { HELD, reimburse, payoutExpense } from '../lib/flow.js'
import { RECEIPT_TYPES, MAX_RECEIPT_BYTES, sha256, readReceipt, parseReceipt, checkExpense, decide } from '../agent/receipts.js'
import {
  LIST_MAX, HOLDING, itemState, itemName, itemLifecycle, outstandingCents, receiptBand,
  statusFor, canRemove, canAgree, canDecline, listError,
} from '../agent/expenseRules.js'
import { money } from '../lib/money.js'
import { channel3, attributionId, Channel3Error } from '../lib/channel3.js'

const MAX_BUDGET = 1_000_000
// Claims that hold part of the budget, their receipt and the list items it bought (expenseRules.HOLDING):
// checking, waiting for the client, reimbursed, and a failed capture ('error') the client can still approve,
// so neither its money, its receipt nor its items can be claimed a second time meanwhile.
const WAITING = ['checking', 'needs_client', 'error']   // held but not captured yet
const SETTLED = ['released', 'refunded']
const HOUR = 3600e3

// ---- rate limits: key → the times of its calls in the last hour (one Render instance, so memory is enough)
const recent = new Map()
let sweptAt = 0
function within(key, now) {
  const list = (recent.get(key) || []).filter((t) => now - t < HOUR)
  if (list.length) recent.set(key, list)
  else recent.delete(key)
  return list
}
// keys nobody used for an hour leave the map, at most once a minute
function sweep(now) {
  if (now - sweptAt < 60e3) return
  sweptAt = now
  for (const key of [...recent.keys()]) within(key, now)
}
function allow(key, perHour) {
  return !limited([[key, perHour]])
}
/** Count one call against every [key, perHour] pair, or none when one is full: → null, or { key, perHour, retryAt }
 *  where retryAt is when that key's oldest call leaves the hour. */
function limited(limits) {
  const now = Date.now()
  sweep(now)
  for (const [key, perHour] of limits) {
    const list = within(key, now)
    if (list.length >= perHour) return { key, perHour, retryAt: new Date(list[0] + HOUR).toISOString() }
  }
  for (const [key] of limits) recent.set(key, [...(recent.get(key) || []), now])
  return null
}

// the file is what it says it is
const MAGIC = {
  'application/pdf': (b) => b.subarray(0, 4).toString('latin1') === '%PDF',
  'image/png': (b) => b[0] === 0x89 && b.subarray(1, 4).toString('latin1') === 'PNG',
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/webp': (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP',
}

export const viewClaim = (e, currency = 'USD') => ({
  id: e.id, status: e.status, amount: money(e.amount_cents, currency), amount_cents: e.amount_cents,
  merchant: e.merchant, purpose: e.purpose, receipt: e.receipt_name, via_agent: e.via_agent,
  decided_by: e.decided_by, note: e.note || undefined, model_tokens: e.tokens,
  checks: (e.checks || []).map((c) => ({ check: c.label, status: c.status, observed: c.observed, fix: c.fix || undefined, by: c.by })),
  paypal: e.paypal_capture_id ? { capture_id: e.paypal_capture_id, payout: (e.payout_status || 'pending').toLowerCase() } : undefined,
  shopping_list: (e.extracted?.planned || []).map((p) => p.title),
  created_at: e.created_at,
})

async function budgetOf(m) {
  const { data } = await db().from('expenses').select('*').eq('milestone_id', m.id).order('created_at')
  const claims = data || []
  const spent = claims.filter((e) => e.paypal_capture_id).reduce((s, e) => s + e.amount_cents, 0)
  const waiting = claims.filter((e) => WAITING.includes(e.status) && !e.paypal_capture_id).reduce((s, e) => s + e.amount_cents, 0)
  return { claims, spent, waiting, left: Math.max(0, (m.expense_budget_cents || 0) - spent - waiting) }
}

// ---- the shopping list: real Channel3 listings in milestones.expense_products (jsonb, no migration). Each item is
// a listing plus { plannedBy, viaAgent, at, asOf, status: 'terms' | 'proposed' | 'agreed', agreedBy?, agreedAt? }.

// one read-modify-write per milestone at a time: a promise chain per id (one Render instance makes this enough)
const locks = new Map()
function withLock(milestoneId, fn) {
  const run = (locks.get(milestoneId) || Promise.resolve()).then(fn)
  const tail = run.catch(() => {})
  locks.set(milestoneId, tail)
  tail.then(() => { if (locks.get(milestoneId) === tail) locks.delete(milestoneId) })
  return run
}

/** The milestone as the database holds it now (list, budget, status, signatures): read inside the lock. */
async function reread(m) {
  const { data, error } = await db().from('milestones')
    .select('expense_products, expense_budget_cents, expense_covers, status, contract:contracts(currency, client_signed_at, freelancer_signed_at)')
    .eq('id', m.id).single()
  if (error) throw error
  return { ...m, ...data, contract: { ...m.contract, ...data.contract } }
}

const signedBoth = (c) => !!(c.client_signed_at && c.freelancer_signed_at)

/** The list is part of the terms until both sign: changing it clears a signature. → true when it cleared one. */
async function resetSignatures(contract) {
  if (!contract.client_signed_at && !contract.freelancer_signed_at) return false
  await db().from('contracts').update({ client_signed_at: null, freelancer_signed_at: null }).eq('id', contract.id)
  contract.client_signed_at = contract.freelancer_signed_at = null
  return true
}

/** What the list may still add: the budget left after claims, minus every item no claim has bought yet. */
const roomOf = (m, b) => b.left - outstandingCents(m.expense_products || [], b.claims)

/** Why the list is closed here, or null: no budget, settled, or a contract not in US dollars. */
function listClosed(m) {
  if (SETTLED.includes(m.status)) return 'settled'
  if (!m.expense_budget_cents) return 'no_budget'
  if ((m.contract.currency || 'USD') !== 'USD') return 'currency'
  return null
}

/** Send a refused list action: { error, code } plus retryAfterSec, retryAt or resetsOn where they apply. */
function refuse(reply, code, o = {}) {
  const { http, ...body } = listError(code, { $: (c) => money(c, 'USD'), ...o })
  return reply.code(http).send(body)
}

/** A failed Channel3 call, as the person reads it. Channel3's own text never reaches them. */
function storeFailure(request, reply, e) {
  const code = e instanceof Channel3Error ? e.code : 'unexpected'
  if (code === 'auth') request.log.error({ code, http: e.http }, 'Channel3 refused the API key')
  else if (code === 'no_key') request.log.warn({ code }, 'No CHANNEL3_API_KEY: a pin needs a listing from a search in the last 15 minutes')
  else request.log.warn({ code, http: e?.http, err: code === 'unexpected' ? e : undefined }, 'Channel3 call failed')
  if (code === 'quota') return refuse(reply, 'quota', { resetsOn: e.resetsOn })
  if (code === 'rate_limited') return refuse(reply, 'rate_limited', { retryAfterSec: e.retryAfterSec ?? 5 })
  if (code === 'invalid') return refuse(reply, 'invalid')
  if (code === 'not_found') return refuse(reply, 'gone')
  if (code === 'no_key') return refuse(reply, 'stale')   // keyless: the listing has to come from a recent search
  return refuse(reply, 'unavailable')   // timeout, unavailable, bad_response, auth, anything else
}

async function freelancerName(m) {
  if (!m.contract.freelancer_id) return ''
  const { data } = await db().from('profiles').select('display_name').eq('id', m.contract.freelancer_id).maybeSingle()
  return String(data?.display_name || '').trim().split(/\s+/)[0] || ''
}

const writeList = (m, items) => db().from('milestones').update({ expense_products: items }).eq('id', m.id).then(({ error }) => { if (error) throw error })

// how MCP reads an item's consent
const STATUS_WORDS = { terms: 'on the terms', proposed: 'proposed, waiting for the client' }
function statusWords(item, signed) {
  const s = itemState(item, { signed })
  if (s !== 'agreed') return STATUS_WORDS[s]
  return item.status === 'terms' ? 'signed by both' : 'agreed by the client'
}

/** Read the receipt, run the checks, and reimburse at once when they all pass. Never throws. */
async function settleClaim(e, buf, type, m) {
  try {
    const read = await readReceipt(buf, type)
    const parsed = parseReceipt(read.text)
    // From reading the other claims to storing this one's match, one claim per milestone at a time (and never
    // while the list changes): two claims checked at once would each miss the item the other bought.
    const { outcome, by, extracted } = await withLock(m.id, async () => {
      const now = await reread(m)   // the list as it is now, not as it was when the claim came in
      const [{ data: contract }, { data: others }] = await Promise.all([
        db().from('contracts').select('created_at, currency, client:profiles!contracts_client_id_fkey(display_name)').eq('id', m.contract.id).single(),
        db().from('expenses').select('amount_cents, status, extracted').eq('milestone_id', m.id).neq('id', e.id).in('status', HOLDING),
      ])
      // list items another claim holds (live, or a failed capture the client can still approve): each is reimbursed once
      const usedIds = (others || []).flatMap((o) => (o.extracted?.planned || []).map((p) => p.id))
      // the same file, or the same order number for the same total, already claimed (here or on any contract)
      let duplicate = null
      const { data: sameFile } = await db().from('expenses').select('created_at, contract_id').eq('receipt_sha256', e.receipt_sha256)
        .neq('id', e.id).in('status', HOLDING).order('created_at').limit(1)
      if (sameFile?.[0]) duplicate = { why: `This exact receipt was already claimed on ${sameFile[0].created_at.slice(0, 10)}${sameFile[0].contract_id === m.contract.id ? '' : ' on another contract'}.` }
      for (const ref of duplicate ? [] : parsed.refs) {
        const { data: sameRef } = await db().from('expenses').select('created_at, contract_id, extracted').contains('extracted', { refs: [ref] })
          .neq('id', e.id).in('status', HOLDING).limit(5)
        const hit = (sameRef || []).find((o) => o.extracted?.total == null || o.extracted.total === parsed.total)
        if (hit) { duplicate = { why: `Order ${ref} was already claimed on ${hit.created_at.slice(0, 10)}${hit.contract_id === m.contract.id ? '' : ' on another contract'}.` }; break }
      }

      const { checks, tokens, planned } = await checkExpense({
        claim: { amountCents: e.amount_cents, merchant: e.merchant, purpose: e.purpose },
        receipt: { ...read, parsed },
        milestone: now, contract,
        committedCents: (others || []).reduce((s, o) => s + o.amount_cents, 0),
        duplicate, usedIds,
        clientName: String(contract?.client?.display_name || '').trim().split(/\s+/)[0] || 'The client',
      })
      const outcome = decide(checks)
      const by = checks.some((c) => c.by === 'claude' && c.status !== 'unknown') ? 'claude' : 'rules'
      const extracted = { via: read.via, ...parsed, planned }   // planned: the list items this receipt bought
      const { error } = await db().from('expenses').update({
        receipt_text: read.text.slice(0, 8000), extracted, checks, tokens,
        status: outcome === 'approved' ? 'checking' : outcome,
        ...(outcome === 'rejected' ? { decided_by: by, decided_at: new Date().toISOString() } : {}),
      }).eq('id', e.id)
      if (error) throw new Error(error.message)   // a match not stored holds no items: the client decides instead
      await audit({
        contractId: m.contract.id, milestoneId: m.id, actor: 'agent', event: 'expense.checked',
        payload: { expenseId: e.id, outcome, amountCents: e.amount_cents, merchant: e.merchant, failed: checks.filter((c) => c.status === 'fail').length, by, tokens, planned: planned.map((p) => p.title) },
      })
      return { outcome, by, extracted }
    })
    if (outcome === 'approved') {
      e.extracted = extracted   // the PayPal note names the list item
      try {
        await reimburse(e, by)
      } catch (err) {
        await db().from('expenses').update({ status: 'error', note: `The checks passed but PayPal didn't capture it: ${err.message}` }).eq('id', e.id)
        await audit({ contractId: m.contract.id, milestoneId: m.id, actor: 'paypal', event: 'expense.capture_failed', payload: { expenseId: e.id, message: err.message } })
      }
    }
  } catch (err) {
    console.error('expense check failed', err)
    await db().from('expenses').update({ status: 'needs_client', note: `The automatic checks couldn't finish (${err.message}); the client decides.` }).eq('id', e.id)
  }
  const { data } = await db().from('expenses').select('*').eq('id', e.id).single()
  return data
}

/** After a restart: claims cut off mid-check are checked again from the stored receipt. */
export async function resumeExpenses() {
  const { data: stuck } = await db().from('expenses').select('*').eq('status', 'checking').is('paypal_capture_id', null)
  for (const e of stuck || []) {
    const { data: m } = await db().from('milestones').select('*, contract:contracts(id, currency)').eq('id', e.milestone_id).single()
    const { data: blob } = await db().storage.from('receipts').download(e.receipt_path)
    if (!m || !blob) {
      await db().from('expenses').update({ status: 'needs_client', note: "The automatic checks were interrupted and the receipt couldn't be re-read; the client decides." }).eq('id', e.id)
      continue
    }
    await settleClaim(e, Buffer.from(await blob.arrayBuffer()), e.receipt_type, m)
  }
  return stuck?.length || 0
}

export default async function expenseRoutes(app) {
  app.addHook('preHandler', requireUser)

  // ---- the budget, agreed with the terms
  app.put('/milestones/:id/expense-budget', async (request, reply) => {
    const m0 = await milestoneFor(request, reply)
    if (!m0) return
    if (signedBoth(m0.contract)) return reply.code(409).send({ error: 'Terms are signed by both parties and locked', code: 'locked' })
    const budget = Math.round(Number(request.body?.budgetCents || 0))
    if (!(budget === 0 || (budget >= 100 && budget <= MAX_BUDGET))) return reply.code(400).send({ error: `An expense budget is between $1 and ${money(MAX_BUDGET, m0.contract.currency)}, or none`, code: 'budget_range' })
    const covers = budget ? [...new Set((request.body?.covers || []).map((s) => String(s).trim().slice(0, 40)).filter(Boolean))].slice(0, 8) : []
    if (budget && !covers.length) return reply.code(400).send({ error: 'Say what the budget covers — a domain, hosting, fonts…', code: 'covers' })
    return withLock(m0.id, async () => {
      const m = await reread(m0)
      if (signedBoth(m.contract)) return reply.code(409).send({ error: 'Terms are signed by both parties and locked', code: 'locked' })
      const items = m.expense_products || []
      if (budget === (m.expense_budget_cents || 0) && covers.join('|') === (m.expense_covers || []).join('|')) return { ok: true }
      // the budget has to hold the list it pays for; no budget, no list
      const listCents = items.length ? outstandingCents(items, (await budgetOf(m)).claims) : 0
      if (budget && budget < listCents) return refuse(reply, 'below_list', { listCents })
      await db().from('milestones').update({ expense_budget_cents: budget, expense_covers: covers, ...(budget ? {} : { expense_products: [] }) }).eq('id', m.id)
      await resetSignatures(m.contract)
      await audit({ contractId: m.contract.id, milestoneId: m.id, actor: m.role, event: 'terms.expense_budget', payload: { milestone: m.position, budgetCents: budget, covers, ...(!budget && items.length ? { listCleared: items.length } : {}) } })
      return { ok: true }
    })
  })

  // the budget and every claim; the list as an agent reads it (MCP get_expenses)
  app.get('/milestones/:id/expenses', async (request, reply) => {
    const m = await milestoneFor(request, reply)
    if (!m) return
    const cur = m.contract.currency
    const b = await budgetOf(m)
    const signed = signedBoth(m.contract)
    const items = m.expense_products || []
    return {
      milestone: { id: m.id, title: m.title, status: m.status },
      budget: money(m.expense_budget_cents || 0, cur), covers: m.expense_covers || [],
      spent: money(b.spent, cur), waiting: money(b.waiting, cur), left: money(b.left, cur), left_cents: b.left,
      open: !!m.expense_budget_cents && HELD.includes(m.status) && !!m.paypal_authorization_id,
      claims: b.claims.map((e) => viewClaim(e, cur)),
      planned: items.map((p) => {
        const life = itemLifecycle(p, b.claims)
        const state = itemState(p, { signed })
        const band = receiptBand(p)
        const when = state === 'terms' ? 'once both sign: ' : state === 'proposed' ? 'once the client agrees: ' : ''
        return {
          product_id: p.id, title: itemName(p), brand: p.brand || '', store: p.domain,
          listed: money(p.priceCents, 'USD'), listed_cents: p.priceCents,
          status: statusWords(p, signed),
          bought: life.state === 'open' ? null : { state: life.state, claim_id: life.expense.id },
          reimbursed_at_once_if: life.state !== 'open' ? null
            : `${when}a receipt from ${band.stores.join(' or ')} with a line naming it at up to ${money(band.lineMaxCents, 'USD')}, claimed for up to ${money(band.claimMaxCents, 'USD')} with tax and shipping`,
        }
      }),
      planned_total: money(items.reduce((s, p) => s + (p.priceCents || 0), 0), 'USD'),
      room_left: money(Math.max(0, roomOf(m, b)), 'USD'),
    }
  })

  // ---- the shopping list: real listings from Channel3. A receipt from a list store with a line naming an agreed
  // item near its price reimburses on its own (expenseRules.js); anything else waits for the client.
  app.post('/milestones/:id/expenses/products', async (request, reply) => {
    const m = await milestoneFor(request, reply)
    if (!m) return
    const closed = listClosed(m)
    if (closed) return refuse(reply, closed, { currency: m.contract.currency })
    const query = String(request.body?.query || '').trim()
    if (query.length < 3 || query.length > 120) return refuse(reply, 'query')
    // 30 an hour per person on a milestone, 60 per person in all: Channel3 credits are shared
    const me = request.user.id
    const full = limited([[`c3:${m.id}:${me}`, 30], [`c3u:${me}`, 60]])
    if (full) {
      const min = Math.max(1, Math.ceil((Date.parse(full.retryAt) - Date.now()) / 60e3))
      return refuse(reply, 'search_limit', {
        limit: full.perHour, scope: full.key.startsWith('c3u:') ? 'user' : 'milestone',
        after: `in ${min} minute${min === 1 ? '' : 's'}`, retryAt: full.retryAt,
      })
    }
    const b = await budgetOf(m)
    const cap = roomOf(m, b)
    if (cap < 100) return refuse(reply, 'no_room')
    let r
    try {
      r = await channel3.search(query, { maxCents: cap, userId: attributionId(m.id) })
    } catch (e) {
      return storeFailure(request, reply, e)
    }
    return { query, leftCents: b.left, capCents: cap, products: r.products, asOf: r.asOf, cached: r.cached, via: r.via }
  })

  // put a listing on the list: re-read from Channel3 by id (free), so it works after a restart and whoever searched
  app.post('/milestones/:id/expenses/plan', async (request, reply) => {
    const m0 = await milestoneFor(request, reply)
    if (!m0) return
    const pid = String(request.body?.productId || request.body?.plan_product_id || '').trim()
    if (!/^[A-Za-z0-9_-]{3,64}$/.test(pid)) return refuse(reply, 'no_product')
    const viaAgent = !!request.user.viaToken
    return withLock(m0.id, async () => {
      const m = await reread(m0)
      const closed = listClosed(m)
      if (closed) return refuse(reply, closed, { currency: m.contract.currency })
      const items = m.expense_products || []
      if (items.some((x) => x.id === pid)) return { planned: items, unchanged: true }
      if (items.length >= LIST_MAX) return refuse(reply, 'list_full')
      // each add reads Channel3 on the shared key: 20 an hour per person on a milestone, and within the 60 an
      // hour a person gets for searches and adds together (an agent looping over bad ids stops here)
      const me = request.user.id
      const full = limited([[`c3p:${m.id}:${me}`, 20], [`c3u:${me}`, 60]])
      if (full) {
        const min = Math.max(1, Math.ceil((Date.parse(full.retryAt) - Date.now()) / 60e3))
        return refuse(reply, 'search_limit', {
          limit: full.perHour, scope: full.key.startsWith('c3u:') ? 'user' : 'milestone', what: full.key.startsWith('c3u:') ? 'store searches and adds' : 'store lookups',
          after: `in ${min} minute${min === 1 ? '' : 's'}`, retryAt: full.retryAt,
        })
      }
      let p
      try {
        p = await channel3.product(pid, { userId: attributionId(m.id), fresh: true })
      } catch (e) {
        return storeFailure(request, reply, e)
      }
      if (!p.inStock) return refuse(reply, 'out_of_stock', { domain: p.domain })
      const room = roomOf(m, await budgetOf(m))
      if (p.priceCents > room) return refuse(reply, 'over_budget', { priceCents: p.priceCents, roomCents: room })

      const signed = signedBoth(m.contract)
      const status = statusFor({ signedBoth: signed, role: m.role })
      const now = new Date().toISOString()
      const item = {
        ...p, plannedBy: m.role, viaAgent, at: now, asOf: now, status,
        ...(status === 'agreed' ? { agreedBy: 'client', agreedAt: now } : {}),
      }
      const next = [...items, item]
      await writeList(m, next)
      const reset = signed ? false : await resetSignatures(m.contract)
      await audit({
        contractId: m.contract.id, milestoneId: m.id, actor: m.role, event: 'expense.product_planned',
        payload: { productId: p.id, title: p.title, brand: p.brand, domain: p.domain, priceCents: p.priceCents, status, viaAgent, resetSignatures: reset },
      })
      return { planned: next, item, resetSignatures: reset }
    })
  })

  // the client agrees to an item the freelancer proposed after signing
  app.post('/milestones/:id/expenses/plan/:pid/agree', async (request, reply) => {
    const m0 = await milestoneFor(request, reply)
    if (!m0) return
    return withLock(m0.id, async () => {
      const m = await reread(m0)
      if (SETTLED.includes(m.status)) return refuse(reply, 'settled')
      const items = m.expense_products || []
      const item = items.find((x) => x.id === request.params.pid)
      if (!item) return refuse(reply, 'not_on_list')
      const b = await budgetOf(m)
      const verdict = canAgree(item, { role: m.role, signedBoth: signedBoth(m.contract), lifecycle: itemLifecycle(item, b.claims) })
      if (!verdict.ok) return refuse(reply, verdict.code)
      // the item already counts in what the list holds for: the list as a whole has to fit what's left
      const outstanding = outstandingCents(items, b.claims)
      if (outstanding > b.left) return refuse(reply, 'over_budget', { priceCents: item.priceCents, roomCents: b.left - (outstanding - item.priceCents) })
      const now = new Date().toISOString()
      const agreed = { ...item, status: 'agreed', agreedBy: 'client', agreedAt: now }
      const next = items.map((x) => (x.id === item.id ? agreed : x))
      await writeList(m, next)
      await audit({
        contractId: m.contract.id, milestoneId: m.id, actor: 'client', event: 'expense.product_agreed',
        payload: { productId: item.id, title: item.title, domain: item.domain, priceCents: item.priceCents, viaAgent: !!request.user.viaToken },
      })
      return { planned: next, item: agreed }
    })
  })

  // the client declines it: it leaves the list
  app.post('/milestones/:id/expenses/plan/:pid/decline', async (request, reply) => {
    const m0 = await milestoneFor(request, reply)
    if (!m0) return
    const reason = String(request.body?.reason || '').trim().slice(0, 200)
    return withLock(m0.id, async () => {
      const m = await reread(m0)
      if (SETTLED.includes(m.status)) return refuse(reply, 'settled')
      const items = m.expense_products || []
      const item = items.find((x) => x.id === request.params.pid)
      if (!item) return refuse(reply, 'not_on_list')
      const b = await budgetOf(m)
      const verdict = canDecline(item, { role: m.role, signedBoth: signedBoth(m.contract), lifecycle: itemLifecycle(item, b.claims) })
      if (!verdict.ok) return refuse(reply, verdict.code)
      const next = items.filter((x) => x.id !== item.id)
      await writeList(m, next)
      await audit({
        contractId: m.contract.id, milestoneId: m.id, actor: 'client', event: 'expense.product_declined',
        payload: { productId: item.id, title: item.title, domain: item.domain, priceCents: item.priceCents, reason },
      })
      return { planned: next }
    })
  })

  // take an item off: either side before signing (the signatures reset); after, the freelancer any open item and
  // the client only one still proposed; never one a claim bought
  app.delete('/milestones/:id/expenses/plan/:pid', async (request, reply) => {
    const m0 = await milestoneFor(request, reply)
    if (!m0) return
    return withLock(m0.id, async () => {
      const m = await reread(m0)
      if (SETTLED.includes(m.status)) return refuse(reply, 'settled')
      const items = m.expense_products || []
      const item = items.find((x) => x.id === request.params.pid)
      if (!item) return refuse(reply, 'not_on_list')
      const signed = signedBoth(m.contract)
      const b = await budgetOf(m)
      const verdict = canRemove(item, { role: m.role, signedBoth: signed, lifecycle: itemLifecycle(item, b.claims) })
      if (!verdict.ok) return refuse(reply, verdict.code, { freelancerName: verdict.code === 'signed' ? await freelancerName(m) : '' })
      const next = items.filter((x) => x.id !== item.id)
      await writeList(m, next)
      const reset = signed ? false : await resetSignatures(m.contract)
      await audit({
        contractId: m.contract.id, milestoneId: m.id, actor: m.role, event: 'expense.product_unplanned',
        payload: { productId: item.id, title: item.title, domain: item.domain, priceCents: item.priceCents },
      })
      return { planned: next, resetSignatures: reset }
    })
  })

  // ---- a claim: the receipt rides along as base64 (≤ 5 MB)
  app.post('/milestones/:id/expenses', { bodyLimit: 8 * 1024 * 1024 }, async (request, reply) => {
    const m = await milestoneFor(request, reply, { role: 'freelancer' })
    if (!m) return
    const cur = m.contract.currency
    if (!m.expense_budget_cents) return reply.code(409).send({ error: 'This milestone has no expense budget' })
    if (SETTLED.includes(m.status)) return reply.code(409).send({ error: 'This milestone has settled, so its PayPal hold is closed' })
    if (!HELD.includes(m.status) || !m.paypal_authorization_id) return reply.code(409).send({ error: 'Expenses can be claimed once the milestone is funded' })

    const { amountCents, merchant = '', purpose = '', receipt } = request.body || {}
    const cents = Math.round(Number(amountCents))
    if (!Number.isInteger(cents) || cents < 100) return reply.code(400).send({ error: 'Claim at least $1.00' })
    if (!String(purpose).trim()) return reply.code(400).send({ error: 'Say what it was for' })
    if (!receipt?.data || !RECEIPT_TYPES[receipt.type]) return reply.code(400).send({ error: 'Attach the receipt as a PDF, PNG, JPG or WebP' })
    const buf = Buffer.from(String(receipt.data).replace(/^data:[^,]*,/, ''), 'base64')
    if (!buf.length || buf.length > MAX_RECEIPT_BYTES) return reply.code(400).send({ error: 'Receipts can be up to 5 MB' })
    if (!MAGIC[receipt.type](buf)) return reply.code(400).send({ error: `That file isn't a ${RECEIPT_TYPES[receipt.type].toUpperCase()}` })
    const { left } = await budgetOf(m)
    if (cents > left) return reply.code(409).send({ error: `Only ${money(left, cur)} of the ${money(m.expense_budget_cents, cur)} budget is left` })
    if (!allow(m.id, 20)) return reply.code(429).send({ error: 'Twenty claims an hour on one milestone — try again later' })

    const hash = sha256(buf)
    const path = `${m.contract.id}/${m.id}/${hash}.${RECEIPT_TYPES[receipt.type]}`
    const { error: upErr } = await db().storage.from('receipts').upload(path, buf, { contentType: receipt.type, upsert: true })
    if (upErr) return reply.code(502).send({ error: `The receipt couldn't be stored (${upErr.message})` })
    const { data: e, error } = await db().from('expenses').insert({
      milestone_id: m.id, contract_id: m.contract.id, via_agent: !!request.user.viaToken,
      amount_cents: cents, merchant: String(merchant).trim().slice(0, 80), purpose: String(purpose).trim().slice(0, 200),
      receipt_path: path, receipt_name: String(receipt.name || `receipt.${RECEIPT_TYPES[receipt.type]}`).slice(0, 120),
      receipt_type: receipt.type, receipt_sha256: hash,
    }).select().single()
    if (error) throw error
    await audit({ contractId: m.contract.id, milestoneId: m.id, actor: 'freelancer', event: 'expense.claimed', payload: { expenseId: e.id, amountCents: cents, merchant: e.merchant, viaAgent: !!request.user.viaToken } })

    // checked now: a person waits a few seconds, an agent gets the outcome in the same call
    return viewClaim(await settleClaim(e, buf, receipt.type, m), cur)
  })

  // ---- the client settles what the checks couldn't
  async function claimFor(request, reply, role) {
    const { data: e } = await db().from('expenses').select('*').eq('id', request.params.id).maybeSingle()
    if (!e) { reply.code(404).send({ error: 'Expense not found' }); return null }
    request.params.id = e.milestone_id
    const m = await milestoneFor(request, reply, role ? { role } : {})
    if (!m) return null
    return { e, m }
  }

  app.post('/expenses/:id/approve', async (request, reply) => {
    const found = await claimFor(request, reply, 'client')
    if (!found) return
    const { e, m } = found
    if (!['needs_client', 'error'].includes(e.status)) return reply.code(409).send({ error: 'This claim is already settled' })
    if (SETTLED.includes(m.status)) return reply.code(409).send({ error: 'This milestone has settled, so its PayPal hold is closed' })
    const b = await budgetOf(m)
    if (e.amount_cents > b.left + (WAITING.includes(e.status) ? e.amount_cents : 0)) {
      return reply.code(409).send({ error: `Only ${money(b.left, m.contract.currency)} of the budget is left` })
    }
    try {
      await reimburse(e, 'client')
    } catch (err) {
      await db().from('expenses').update({ status: 'error', note: `PayPal didn't capture it: ${err.message}` }).eq('id', e.id)
      return reply.code(502).send({ error: `PayPal didn't capture it: ${err.message}` })
    }
    return { status: 'approved' }
  })

  app.post('/expenses/:id/decline', async (request, reply) => {
    const found = await claimFor(request, reply, 'client')
    if (!found) return
    const { e, m } = found
    if (!['needs_client', 'error'].includes(e.status)) return reply.code(409).send({ error: 'This claim is already settled' })
    const why = String(request.body?.reason || '').trim().slice(0, 200)
    await db().from('expenses').update({ status: 'declined', decided_by: 'client', decided_at: new Date().toISOString(), note: why }).eq('id', e.id)
    await audit({ contractId: m.contract.id, milestoneId: m.id, actor: 'client', event: 'expense.declined', payload: { expenseId: e.id, amountCents: e.amount_cents, merchant: e.merchant, reason: why } })
    return { status: 'declined' }
  })

  app.get('/expenses/:id/receipt', async (request, reply) => {
    const found = await claimFor(request, reply)
    if (!found) return
    const { data, error } = await db().storage.from('receipts').createSignedUrl(found.e.receipt_path, 300)
    if (error) return reply.code(404).send({ error: 'Receipt not found' })
    return { url: data.signedUrl, name: found.e.receipt_name, type: found.e.receipt_type }
  })

  app.post('/expenses/:id/payout', async (request, reply) => {
    const found = await claimFor(request, reply)
    if (!found) return
    if (!found.e.paypal_capture_id) return reply.code(409).send({ error: 'Only a reimbursed claim can be paid out' })
    return payoutExpense(found.e.id)
  })
}
