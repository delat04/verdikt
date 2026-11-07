/*  ============================================================================
    Spending limits — a person approves one PayPal hold, once; their AI agent hires within it.
    The hold is a single AUTHORIZE order for the whole limit. Funding a milestone from it places no new hold:
    the milestone points at the same authorization and its share (work + expense budget) is earmarked.
      pass   → flow.release captures that share with final_capture=false, so the hold stays open for the next job
      fail   → flow.refund frees the share for the agent's next job; nothing is voided yet
      ends   → whatever was never captured is voided: the person pays only for work that passed its checks
    The rules every hold is checked against: the total, the most for any one job, and the date it ends.
    ============================================================================ */

import * as paypal from './paypal.js'
import { db, audit } from './supabase.js'
import { money } from './money.js'

export const OPEN = ['awaiting_approval', 'active', 'closing']
const HELD = ['funded', 'submitted', 'verifying', 'passed', 'failed', 'disputed']
const DAY = 864e5

export const openLimit = async (userId) =>
  (await db().from('spend_limits').select('*').eq('client_id', userId).in('status', OPEN).maybeSingle()).data

/** What a limit has captured (paid for passing work and receipts), still earmarks (held jobs) and has left. */
export async function usage(limit) {
  const { data: ms } = await db().from('milestones')
    .select('id, position, title, status, amount_cents, expense_budget_cents, released_cents, funded_at, contract:contracts(id, title, freelancer:profiles!contracts_freelancer_id_fkey(display_name))')
    .eq('spend_limit_id', limit.id).order('funded_at', { ascending: false })
  const ids = (ms || []).map((m) => m.id)
  const { data: ex } = ids.length
    ? await db().from('expenses').select('milestone_id, amount_cents').in('milestone_id', ids).not('paypal_capture_id', 'is', null)
    : { data: [] }
  const spent = (id) => (ex || []).filter((e) => e.milestone_id === id).reduce((s, e) => s + e.amount_cents, 0)
  const holds = (ms || []).map((m) => {
    const captured = (m.released_cents || 0) + spent(m.id)
    const held = HELD.includes(m.status)
    return {
      milestoneId: m.id, contractId: m.contract?.id, contract: m.contract?.title, freelancer: m.contract?.freelancer?.display_name || null,
      title: `M${m.position} · ${m.title}`, status: m.status, fundedAt: m.funded_at,
      holdCents: m.amount_cents + (m.expense_budget_cents || 0), capturedCents: captured,
      reservedCents: held ? m.amount_cents + (m.expense_budget_cents || 0) - captured : 0,
    }
  })
  const capturedCents = holds.reduce((s, h) => s + h.capturedCents, 0)
  const reservedCents = holds.reduce((s, h) => s + h.reservedCents, 0)
  const live = limit.status === 'active' && new Date(limit.ends_at).getTime() > Date.now()
  return { capturedCents, reservedCents, availableCents: live ? Math.max(0, limit.cap_cents - capturedCents - reservedCents) : 0, holds }
}

export const view = (l, u) => ({
  id: l.id, status: l.status, capCents: l.cap_cents, perJobCents: l.per_job_cents, currency: l.currency, note: l.note,
  endsAt: l.ends_at, holdExpiresAt: l.hold_expires_at, authorizedAt: l.authorized_at, createdAt: l.created_at,
  closedAt: l.closed_at, closedReason: l.closed_reason, voidedCents: l.voided_cents,
  paypal: { orderId: l.paypal_order_id, authorizationId: l.paypal_authorization_id },
  ...(u && { capturedCents: u.capturedCents, reservedCents: u.reservedCents, availableCents: u.availableCents, holds: u.holds }),
})

/** Why this milestone can't be held from the limit right now, or null when it can. */
export async function whyNot(limit, m, u) {
  if (!limit) return 'No spending limit is set up'
  if (limit.status !== 'active') return limit.status === 'awaiting_approval' ? 'The spending limit is waiting for its PayPal approval' : 'The spending limit has ended'
  const cur = m.contract.currency || 'USD'
  if (cur !== limit.currency) return `The spending limit is in ${limit.currency}; this contract is in ${cur}`
  const hold = m.amount_cents + (m.expense_budget_cents || 0)
  // the most for any one job is checked against the whole contract, not one milestone at a time
  const { data: all } = await db().from('milestones').select('amount_cents, expense_budget_cents').eq('contract_id', m.contract.id)
  const job = (all || []).reduce((s, x) => s + x.amount_cents + (x.expense_budget_cents || 0), 0)
  if (job > limit.per_job_cents) return `This job comes to ${money(job, cur)}; the limit allows at most ${money(limit.per_job_cents, cur)} for one job`
  if (hold > u.availableCents) return `This hold is ${money(hold, cur)}; the limit has ${money(u.availableCents, cur)} left`
  // the work has to be checked before PayPal's hold lapses, with a couple of days to spare
  const lapses = new Date(limit.hold_expires_at || limit.ends_at).getTime()
  const needed = Math.max(Date.now() + 3 * DAY, m.due_at ? new Date(m.due_at).getTime() + 2 * DAY : 0)
  if (needed > lapses) return `The limit's PayPal hold ends ${new Date(lapses).toDateString().slice(4, 10)}, too soon for this milestone — fund it with its own hold`
  return null
}

/** Earmark a milestone's hold from the person's limit. No PayPal call: the money is already held. */
export async function fundFromLimit(m, { viaAgent = false } = {}) {
  const limit = await openLimit(m.contract.client_id)
  const u = limit && await usage(limit)
  const why = await whyNot(limit, m, u)
  if (why) { const e = new Error(why); e.statusCode = 409; throw e }
  const now = new Date().toISOString()
  const hold = m.amount_cents + (m.expense_budget_cents || 0)
  // only a milestone still waiting for money moves: two calls at once can't both spend the same room
  const { data: moved } = await db().from('milestones').update({
    status: 'funded', spend_limit_id: limit.id, paypal_order_id: limit.paypal_order_id, paypal_authorization_id: limit.paypal_authorization_id,
    funded_at: now, authorized_at: now, hold_expires_at: limit.hold_expires_at,
  }).eq('id', m.id).eq('status', 'awaiting_funding').select('id')
  if (!moved?.length) { const e = new Error('This milestone is no longer waiting for money'); e.statusCode = 409; throw e }
  const left = u.availableCents - hold
  await audit({
    contractId: m.contract.id, milestoneId: m.id, actor: 'paypal', event: 'escrow.funds_held',
    payload: { authorizationId: limit.paypal_authorization_id, amountCents: hold, expenseBudgetCents: m.expense_budget_cents || undefined, expiresAt: limit.hold_expires_at, fromLimit: true, limitId: limit.id, leftCents: left, viaAgent },
  })
  return { status: 'funded', fromLimit: true, holdCents: hold, leftCents: left, authorizationId: limit.paypal_authorization_id }
}

/**
 * Close a limit that is ending once nothing it backs is still held: void what was never captured.
 * Called after every release or refund on a limit's milestone, when the person ends it, and on a timer.
 */
export async function settleLimit(limitId) {
  const { data: l } = await db().from('spend_limits').select('*').eq('id', limitId).maybeSingle()
  if (!l || l.status !== 'closing') return l
  const u = await usage(l)
  if (u.holds.some((h) => HELD.includes(h.status))) return l
  const rest = l.cap_cents - u.capturedCents
  let reason = l.closed_reason || 'Ended'
  if (rest > 0 && l.paypal_authorization_id) {
    try {
      await paypal.voidAuthorization(l.paypal_authorization_id, { requestId: `limit-void-${l.id}` })
    } catch (e) {
      // an authorization PayPal already let lapse can't be voided — and can't be charged either
      const st = await paypal.getAuthorization(l.paypal_authorization_id).then((a) => a.status).catch(() => null)
      if (!['VOIDED', 'EXPIRED'].includes(st)) throw e
      if (st === 'EXPIRED') reason = `${reason}; PayPal's hold had already lapsed`
    }
  }
  const { data: closed } = await db().from('spend_limits').update({
    status: 'closed', closed_at: new Date().toISOString(), closed_reason: reason, voided_cents: l.paypal_authorization_id ? Math.max(0, rest) : 0,
  }).eq('id', l.id).select('*').single()
  await auditLimit(l, 'limit.closed', { capturedCents: u.capturedCents, voidedCents: Math.max(0, rest), reason })
  return closed
}

/** The person ends the limit: no new holds from now; it closes (voiding the rest) once its jobs settle. */
export async function endLimit(l, reason) {
  if (l.status === 'awaiting_approval') {
    await db().from('spend_limits').update({ status: 'closed', closed_at: new Date().toISOString(), closed_reason: 'Never approved on PayPal', voided_cents: 0 }).eq('id', l.id)
    return
  }
  if (l.status === 'active') await db().from('spend_limits').update({ status: 'closing', closed_reason: reason }).eq('id', l.id)
  await settleLimit(l.id)
}

/** Timer: limits past their end date stop funding, and close once their jobs settle. */
export async function closeEndedLimits() {
  const now = new Date().toISOString()
  const { data: due } = await db().from('spend_limits').select('*').eq('status', 'active').lt('ends_at', now)
  for (const l of due || []) await endLimit(l, 'Reached its end date').catch(() => {})
  const { data: closing } = await db().from('spend_limits').select('id').eq('status', 'closing')
  for (const l of closing || []) await settleLimit(l.id).catch(() => {})
}

// a limit belongs to no contract: its events go in the ledger of every contract it backs
async function auditLimit(l, event, payload) {
  const { data: ms } = await db().from('milestones').select('id, contract_id').eq('spend_limit_id', l.id)
  const seen = new Set()
  for (const m of ms || []) {
    if (seen.has(m.contract_id)) continue
    seen.add(m.contract_id)
    await audit({ contractId: m.contract_id, milestoneId: m.id, actor: 'paypal', event, payload: { limitId: l.id, ...payload } })
  }
}
