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
    ============================================================================ */

import { db, audit } from '../lib/supabase.js'
import { requireUser, milestoneFor } from '../lib/auth.js'
import { HELD, reimburse, payoutExpense } from '../lib/flow.js'
import { RECEIPT_TYPES, MAX_RECEIPT_BYTES, sha256, readReceipt, parseReceipt, checkExpense, decide } from '../agent/receipts.js'
import { money } from '../lib/money.js'

const MAX_BUDGET = 1_000_000
const LIVE = ['checking', 'needs_client', 'approved']   // claims that hold part of the budget
const SETTLED = ['released', 'refunded']

const recent = new Map()
function allow(key, perHour) {
  const now = Date.now()
  const list = (recent.get(key) || []).filter((t) => now - t < 3600e3)
  if (list.length >= perHour) return false
  list.push(now)
  recent.set(key, list)
  return true
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
  created_at: e.created_at,
})

async function budgetOf(m) {
  const { data } = await db().from('expenses').select('*').eq('milestone_id', m.id).order('created_at')
  const claims = data || []
  const spent = claims.filter((e) => e.paypal_capture_id).reduce((s, e) => s + e.amount_cents, 0)
  const waiting = claims.filter((e) => ['checking', 'needs_client'].includes(e.status)).reduce((s, e) => s + e.amount_cents, 0)
  return { claims, spent, waiting, left: Math.max(0, (m.expense_budget_cents || 0) - spent - waiting) }
}

/** Read the receipt, run the checks, and reimburse at once when they all pass. Never throws. */
async function settleClaim(e, buf, type, m) {
  try {
    const read = await readReceipt(buf, type)
    const parsed = parseReceipt(read.text)
    const [{ data: contract }, { data: others }] = await Promise.all([
      db().from('contracts').select('created_at, currency').eq('id', m.contract.id).single(),
      db().from('expenses').select('amount_cents, status').eq('milestone_id', m.id).neq('id', e.id).in('status', LIVE),
    ])
    // the same file, or the same order number for the same total, already claimed (here or on any contract)
    let duplicate = null
    const { data: sameFile } = await db().from('expenses').select('created_at, contract_id').eq('receipt_sha256', e.receipt_sha256)
      .neq('id', e.id).in('status', LIVE).order('created_at').limit(1)
    if (sameFile?.[0]) duplicate = { why: `This exact receipt was already claimed on ${sameFile[0].created_at.slice(0, 10)}${sameFile[0].contract_id === m.contract.id ? '' : ' on another contract'}.` }
    for (const ref of duplicate ? [] : parsed.refs) {
      const { data: sameRef } = await db().from('expenses').select('created_at, contract_id, extracted').contains('extracted', { refs: [ref] })
        .neq('id', e.id).in('status', LIVE).limit(5)
      const hit = (sameRef || []).find((o) => o.extracted?.total == null || o.extracted.total === parsed.total)
      if (hit) { duplicate = { why: `Order ${ref} was already claimed on ${hit.created_at.slice(0, 10)}${hit.contract_id === m.contract.id ? '' : ' on another contract'}.` }; break }
    }

    const { checks, tokens } = await checkExpense({
      claim: { amountCents: e.amount_cents, merchant: e.merchant, purpose: e.purpose },
      receipt: { ...read, parsed },
      milestone: m, contract,
      committedCents: (others || []).reduce((s, o) => s + o.amount_cents, 0),
      duplicate,
    })
    const outcome = decide(checks)
    const by = checks.some((c) => c.by === 'claude' && c.status !== 'unknown') ? 'claude' : 'rules'
    await db().from('expenses').update({
      receipt_text: read.text.slice(0, 8000), extracted: { via: read.via, ...parsed }, checks, tokens,
      status: outcome === 'approved' ? 'checking' : outcome,
      ...(outcome === 'rejected' ? { decided_by: by, decided_at: new Date().toISOString() } : {}),
    }).eq('id', e.id)
    await audit({
      contractId: m.contract.id, milestoneId: m.id, actor: 'agent', event: 'expense.checked',
      payload: { expenseId: e.id, outcome, amountCents: e.amount_cents, merchant: e.merchant, failed: checks.filter((c) => c.status === 'fail').length, by, tokens },
    })
    if (outcome === 'approved') {
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
    const m = await milestoneFor(request, reply)
    if (!m) return
    if (m.contract.client_signed_at && m.contract.freelancer_signed_at) return reply.code(409).send({ error: 'Terms are signed by both parties and locked' })
    const budget = Math.round(Number(request.body?.budgetCents || 0))
    if (!(budget === 0 || (budget >= 100 && budget <= MAX_BUDGET))) return reply.code(400).send({ error: `An expense budget is between $1 and ${money(MAX_BUDGET, m.contract.currency)}, or none` })
    const covers = budget ? [...new Set((request.body?.covers || []).map((s) => String(s).trim().slice(0, 40)).filter(Boolean))].slice(0, 8) : []
    if (budget && !covers.length) return reply.code(400).send({ error: 'Say what the budget covers — a domain, hosting, fonts…' })
    if (budget === (m.expense_budget_cents || 0) && covers.join('|') === (m.expense_covers || []).join('|')) return { ok: true }
    await db().from('milestones').update({ expense_budget_cents: budget, expense_covers: covers }).eq('id', m.id)
    await db().from('contracts').update({ client_signed_at: null, freelancer_signed_at: null }).eq('id', m.contract.id)
    await audit({ contractId: m.contract.id, milestoneId: m.id, actor: m.role, event: 'terms.expense_budget', payload: { milestone: m.position, budgetCents: budget, covers } })
    return { ok: true }
  })

  app.get('/milestones/:id/expenses', async (request, reply) => {
    const m = await milestoneFor(request, reply)
    if (!m) return
    const cur = m.contract.currency
    const b = await budgetOf(m)
    return {
      milestone: { id: m.id, title: m.title, status: m.status },
      budget: money(m.expense_budget_cents || 0, cur), covers: m.expense_covers || [],
      spent: money(b.spent, cur), waiting: money(b.waiting, cur), left: money(b.left, cur), left_cents: b.left,
      open: !!m.expense_budget_cents && HELD.includes(m.status) && !!m.paypal_authorization_id,
      claims: b.claims.map((e) => viewClaim(e, cur)),
    }
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
    if (e.amount_cents > b.left + (['checking', 'needs_client'].includes(e.status) ? e.amount_cents : 0)) {
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
