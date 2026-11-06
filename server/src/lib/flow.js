/*  ============================================================================
    Money-moving transitions, in one place:
    release  — capture the hold (all of it, or part: the rest goes back to the client) — or, check by
               check, several partial captures as more checks pass; each capture is a tranche paid out
               to the freelancer through PayPal Payouts, minus Verdikt's fee
    refund   — void the hold; the client is never charged
    renew    — reauthorize holds past PayPal's 3-day honor period, before they lapse
    and what happens to the contract after: the next milestone opens, or it completes.
    ============================================================================ */

import * as paypal from './paypal.js'
import { db, audit } from './supabase.js'
import { config } from '../config.js'
import { money } from './money.js'

export const HELD = ['funded', 'submitted', 'verifying', 'passed', 'failed', 'disputed']
const HONOR_MS = 3 * 864e5

/** Open the next milestone for funding, or complete the contract when none are left. */
export async function advance(contractId) {
  const { data: ms } = await db().from('milestones').select('id, status, position').eq('contract_id', contractId).order('position')
  const next = ms.find((m) => m.status === 'draft')
  if (next) {
    await db().from('milestones').update({ status: 'awaiting_funding' }).eq('id', next.id)
    return
  }
  if (ms.every((m) => ['released', 'refunded'].includes(m.status))) {
    await db().from('contracts').update({ status: 'completed' }).eq('id', contractId)
    await audit({ contractId, actor: 'system', event: 'contract.completed' })
  }
}

/**
 * Capture from the held authorization. Each capture is a tranche, paid out to the freelancer on its own.
 *  - whole milestone (default): one final capture of `amountCents` (all of it, or part — the rest of the hold
 *    goes back to the client)
 *  - check by check: while checks are still failing, partial captures with final_capture=false release the
 *    share the passing checks have earned; the last capture (final) releases what's left
 */
export async function release(milestone, actor, { amountCents, final = true, passed, total } = {}) {
  const full = milestone.amount_cents
  const already = milestone.released_cents || 0
  const remaining = full - already
  if (remaining < 100) throw new Error('Nothing left to release on this milestone')
  const cents = Math.min(remaining, Math.max(100, Math.round(amountCents ?? remaining)))
  const releasedNow = already + cents
  const currency = milestone.contract?.currency || 'USD'
  // read fresh: an expense reimbursed meanwhile is a capture on the same hold
  const { data: fresh } = await db().from('milestones').select('tranches, expense_budget_cents').eq('id', milestone.id).single()
  const tranches = fresh?.tranches ?? milestone.tranches ?? []
  const budget = fresh?.expense_budget_cents || 0
  const index = tranches.length

  const capture = await paypal.captureAuthorization(milestone.paypal_authorization_id, {
    requestId: `release-${milestone.id}-${index}`,
    // the hold also carries the expense budget: always name the amount, so the work never takes the budget with it
    amountCents: final && !already && cents === full && !budget ? undefined : cents,
    currency,
    finalCapture: final,
    noteToPayer: !final
      ? `Verdikt: ${money(cents, currency)} released for ${milestone.title} — ${passed} of ${total} checks passed; the rest stays on hold`
      : releasedNow < full
        ? `Verdikt: ${money(releasedNow, currency)} of ${money(full, currency)} released for ${milestone.title}; the rest of the hold is returned to you`
        : `Verdikt: ${milestone.title} passed its checks${budget ? '; any unused expense budget is returned to you' : ''}`,
  })
  // a final capture closes the authorization: what's left of the expense budget goes back with it
  const unspent = final && budget ? budget - await spentOn(milestone.id) : 0
  const tranche = { captureId: capture.id, cents, passed: passed ?? null, total: total ?? null, final, at: new Date().toISOString() }
  await db().from('milestones').update({
    ...(final
      ? { status: 'released', released_at: new Date().toISOString(), progress: null, voided_cents: full - releasedNow + unspent }
      : {}),
    paypal_capture_id: capture.id, released_cents: releasedNow,
    tranches: [...tranches, tranche],
  }).eq('id', milestone.id)
  await audit({
    contractId: milestone.contract_id, milestoneId: milestone.id, actor: actor === 'agent' ? 'paypal' : actor,
    event: !final ? 'escrow.check_released' : releasedNow < full ? 'escrow.partially_released' : 'escrow.released',
    payload: { captureId: capture.id, status: capture.status, amountCents: cents, releasedCents: releasedNow, ofCents: full, returnedCents: final ? full - releasedNow + unspent : 0, unspentExpensesCents: unspent || undefined, passed, total, by: actor },
  })
  if (final) await closeExpenses(milestone)

  // Paying the freelancer is a second step: if it can't happen yet (no payout email), the release still stands
  await payout(milestone.id).catch((e) => audit({
    contractId: milestone.contract_id, milestoneId: milestone.id, actor: 'paypal', event: 'payout.failed', payload: { message: e.message },
  }))
  if (final) await advance(milestone.contract_id)
  return capture
}

const DONE_PAYOUT = ['SUCCESS']
const IN_FLIGHT = ['PENDING', 'PROCESSING', 'UNCLAIMED_PENDING', 'ONHOLD']
const RETRYABLE_PAYOUT = ['FAILED', 'RETURNED', 'BLOCKED', 'DENIED', 'UNCLAIMED', 'NEEDS_EMAIL', 'ERROR']

// a milestone released before tranches existed counts as one tranche
const tranchesOf = (m) => (m.tranches?.length ? m.tranches : m.released_cents ? [{
  captureId: m.paypal_capture_id, cents: m.released_cents, final: true,
  feeCents: m.fee_cents, netCents: m.payout_cents, payoutBatchId: m.paypal_payout_batch_id, payoutStatus: m.payout_status,
}] : [])

/** One status for the milestone: paid when every tranche is, failing when any is, otherwise in flight. */
function rollUp(list) {
  const st = list.map((t) => t.payoutStatus).filter(Boolean)
  if (!st.length) return null
  if (st.every((s) => s === 'SUCCESS')) return 'SUCCESS'
  return st.find((s) => RETRYABLE_PAYOUT.includes(s)) || st.find((s) => s !== 'SUCCESS') || 'PENDING'
}
async function saveTranches(id, list, extra = {}) {
  await db().from('milestones').update({
    tranches: list, payout_status: rollUp(list),
    fee_cents: list.reduce((s, t) => s + (t.feeCents || 0), 0), payout_cents: list.reduce((s, t) => s + (t.netCents || 0), 0),
    ...extra,
  }).eq('id', id)
}

/** Pay every released tranche out to the freelancer's PayPal (minus Verdikt's fee) that isn't paid or in flight. Safe to call again. */
export async function payout(milestoneId) {
  const { data: m } = await db().from('milestones')
    .select('*, contract:contracts(id, title, currency, freelancer:profiles!contracts_freelancer_id_fkey(id, display_name, paypal_email))')
    .eq('id', milestoneId).single()
  const list = tranchesOf(m)
  if (!list.length) return { skipped: 'not released' }
  const due = list.map((t, i) => [t, i]).filter(([t]) => !DONE_PAYOUT.includes(t.payoutStatus) && !(t.payoutBatchId && IN_FLIGHT.includes(t.payoutStatus)))
  if (!due.length) return { skipped: 'already paid out' }

  const currency = m.contract.currency || 'USD'
  const email = m.contract.freelancer?.paypal_email
  for (const [t] of due) {
    t.feeCents = Math.round((t.cents * config.fees.percent) / 100)
    t.netCents = t.cents - t.feeCents
  }
  if (!email) {
    for (const [t] of due) t.payoutStatus = 'NEEDS_EMAIL'
    await saveTranches(m.id, list)
    await audit({ contractId: m.contract_id, milestoneId: m.id, actor: 'system', event: 'payout.needs_email', payload: { amountCents: due.reduce((s, [t]) => s + t.netCents, 0) } })
    return { status: 'NEEDS_EMAIL' }
  }

  let lastBatch = null
  for (const [t, i] of due) {
    // first attempt is idempotent per tranche; a retry gets a fresh batch id
    const senderBatchId = t.payoutBatchId ? `vk-${m.id.slice(0, 18)}-${i}-${Date.now()}` : i === 0 ? `vk-${m.id}` : `vk-${m.id}-${i}`
    const batch = await paypal.createPayout({
      senderBatchId, email, amountCents: t.netCents, currency, itemId: `${m.id.slice(0, 24)}-${i}`,
      subject: t.final === false ? `${money(t.netCents, currency)} for ${m.title} — ${t.passed} of ${t.total} checks passed` : `You've been paid for ${m.title}`,
      note: `Verdikt released ${money(t.cents, currency)} for "${m.title}" (${m.contract.title})${t.feeCents ? ` and kept a ${config.fees.percent}% fee` : ''}.`,
    })
    t.payoutBatchId = batch.batch_header?.payout_batch_id
    t.payoutStatus = batch.batch_header?.batch_status || 'PENDING'
    lastBatch = t.payoutBatchId
    await audit({
      contractId: m.contract_id, milestoneId: m.id, actor: 'paypal', event: 'payout.sent',
      payload: { batchId: t.payoutBatchId, amountCents: t.netCents, feeCents: t.feeCents, email, tranche: i + 1 },
    })
    watchPayout(m.id, t.payoutBatchId)
  }
  await saveTranches(m.id, list, { paypal_payout_batch_id: lastBatch, payout_email: email })
  return { status: 'PENDING', batchId: lastBatch }
}

/** PayPal settles a payout a few seconds later; follow it until it lands (webhooks do the same once deployed). */
function watchPayout(milestoneId, batchId, tries = 0) {
  setTimeout(async () => {
    try {
      const b = await paypal.getPayout(batchId)
      const item = b.items?.[0]
      const status = item?.transaction_status || b.batch_header?.batch_status
      const { data: m } = await db().from('milestones').select('*').eq('id', milestoneId).single()
      const list = tranchesOf(m)
      const t = list.find((x) => x.payoutBatchId === batchId)
      if (t && status && status !== t.payoutStatus) {
        t.payoutStatus = status
        if (status === 'SUCCESS') t.paidOutAt = new Date().toISOString()
        await saveTranches(milestoneId, list, {
          paypal_payout_item_id: item?.payout_item_id || m.paypal_payout_item_id,
          ...(rollUp(list) === 'SUCCESS' ? { paid_out_at: new Date().toISOString() } : {}),
        })
        if (status === 'SUCCESS') {
          await audit({ contractId: m.contract_id, milestoneId, actor: 'paypal', event: 'payout.completed', payload: { amountCents: t.netCents, email: m.payout_email, itemId: item?.payout_item_id } })
        } else if (RETRYABLE_PAYOUT.includes(status)) {
          await audit({ contractId: m.contract_id, milestoneId, actor: 'paypal', event: 'payout.failed', payload: { status, message: item?.errors?.message || '' } })
        }
      }
      if (!['SUCCESS', ...RETRYABLE_PAYOUT].includes(status) && tries < 20) watchPayout(milestoneId, batchId, tries + 1)
    } catch (e) {
      if (tries < 20) watchPayout(milestoneId, batchId, tries + 1)
    }
  }, tries < 5 ? 3000 : 15000)
}

/** A payout webhook: settle the tranche it belongs to (found by its PayPal batch id). */
export async function settlePayout(batchId, status, itemId) {
  const { data: rows } = await db().from('milestones').select('*').contains('tranches', [{ payoutBatchId: batchId }]).limit(1)
  let m = rows?.[0]
  if (!m) ({ data: m } = await db().from('milestones').select('*').eq('paypal_payout_batch_id', batchId).maybeSingle())
  if (!m) {
    // a reimbursed expense is paid out on its own batch
    const { data: e } = await db().from('expenses').select('*').eq('payout_batch_id', batchId).maybeSingle()
    if (!e) return false
    await settleExpense(e, status, itemId)
    return true
  }
  const list = tranchesOf(m)
  const t = list.find((x) => x.payoutBatchId === batchId)
  if (!t || t.payoutStatus === status) return true
  t.payoutStatus = status
  if (status === 'SUCCESS') t.paidOutAt = new Date().toISOString()
  await saveTranches(m.id, list, { paypal_payout_item_id: itemId || m.paypal_payout_item_id, ...(rollUp(list) === 'SUCCESS' ? { paid_out_at: new Date().toISOString() } : {}) })
  return true
}

/** After a restart, keep following payouts PayPal hasn't settled yet. */
export async function resumePayouts() {
  const { data } = await db().from('milestones').select('*').in('payout_status', IN_FLIGHT)
  let n = 0
  for (const m of data || []) {
    for (const t of tranchesOf(m)) if (t.payoutBatchId && IN_FLIGHT.includes(t.payoutStatus)) { watchPayout(m.id, t.payoutBatchId); n++ }
  }
  const { data: claims } = await db().from('expenses').select('id, payout_batch_id').in('payout_status', IN_FLIGHT).not('payout_batch_id', 'is', null)
  for (const e of claims || []) { watchExpensePayout(e.id, e.payout_batch_id); n++ }
  return n
}

/**
 * Void the held authorization → the client isn't charged for what's still held. On a check-by-check
 * milestone that already released some tranches, the freelancer keeps those and the rest is returned.
 */
export async function refund(milestone, actor) {
  await paypal.voidAuthorization(milestone.paypal_authorization_id, { requestId: `refund-${milestone.id}` })
  const kept = milestone.released_cents || 0
  // reimbursed expenses stand; the rest of the budget is voided with the work
  const unspent = (milestone.expense_budget_cents || 0) - await spentOn(milestone.id)
  const returned = milestone.amount_cents - kept + unspent
  await db().from('milestones').update({
    status: kept ? 'released' : 'refunded', progress: null, voided_cents: returned, ...(kept ? { released_at: new Date().toISOString() } : {}),
  }).eq('id', milestone.id)
  await audit({ contractId: milestone.contract_id, milestoneId: milestone.id, actor, event: 'escrow.refunded', payload: { amountCents: returned, keptCents: kept } })
  await closeExpenses(milestone)
  await advance(milestone.contract_id)
}

/* ---------------------------------------------------------------- expenses
   A milestone's expense budget sits in the same PayPal authorization as the work. Each receipt that passes
   its checks is one partial capture (final_capture=false) and one payout to the freelancer, with no Verdikt
   fee: it's the client's money for the client's project, passed through. */

const LIVE_CLAIM = ['checking', 'needs_client']

/** What's been captured from this milestone's hold for expenses. */
export async function spentOn(milestoneId) {
  const { data } = await db().from('expenses').select('amount_cents').eq('milestone_id', milestoneId).not('paypal_capture_id', 'is', null)
  return (data || []).reduce((s, e) => s + e.amount_cents, 0)
}

/** The hold closed (released or voided): claims still waiting can't be paid from it any more. */
async function closeExpenses(milestone) {
  const { data } = await db().from('expenses').update({ status: 'expired', note: 'The milestone settled before this claim was decided, so its PayPal hold is closed.', decided_at: new Date().toISOString() })
    .eq('milestone_id', milestone.id).in('status', LIVE_CLAIM).select('id')
  if (data?.length) await audit({ contractId: milestone.contract_id, milestoneId: milestone.id, actor: 'system', event: 'expense.expired', payload: { count: data.length } })
}

/** Capture one claim from the milestone's hold, then pay it out. Throws if PayPal refuses; the caller records it. */
export async function reimburse(expense, by) {
  const { data: m } = await db().from('milestones').select('id, contract_id, title, status, paypal_authorization_id, contract:contracts(currency)').eq('id', expense.milestone_id).single()
  if (!m.paypal_authorization_id || !HELD.includes(m.status)) throw new Error('This milestone has settled, so its PayPal hold is closed')
  const currency = m.contract?.currency || 'USD'
  const capture = await paypal.captureAuthorization(m.paypal_authorization_id, {
    requestId: `expense-${expense.id}`,
    amountCents: expense.amount_cents,
    currency,
    finalCapture: false,   // the work and the rest of the budget stay held
    noteToPayer: `Verdikt: ${money(expense.amount_cents, currency)} reimbursed from the expense budget for ${expense.merchant || 'a project expense'} (${m.title})`,
  })
  await db().from('expenses').update({
    status: 'approved', decided_by: by, decided_at: new Date().toISOString(), paypal_capture_id: capture.id, note: '',
  }).eq('id', expense.id)
  await audit({
    contractId: m.contract_id, milestoneId: m.id, actor: 'paypal', event: 'expense.reimbursed',
    payload: { expenseId: expense.id, captureId: capture.id, amountCents: expense.amount_cents, merchant: expense.merchant, by },
  })
  await payoutExpense(expense.id).catch((e) => audit({
    contractId: m.contract_id, milestoneId: m.id, actor: 'paypal', event: 'payout.failed', payload: { message: e.message, expenseId: expense.id },
  }))
  return capture
}

/** Pay a reimbursed claim out to the freelancer's PayPal — the whole amount, no fee. Safe to call again. */
export async function payoutExpense(id) {
  const { data: e } = await db().from('expenses')
    .select('*, milestone:milestones(title), contract:contracts(title, currency, freelancer:profiles!contracts_freelancer_id_fkey(paypal_email))')
    .eq('id', id).single()
  if (!e.paypal_capture_id) return { skipped: 'not reimbursed' }
  if (DONE_PAYOUT.includes(e.payout_status) || (e.payout_batch_id && IN_FLIGHT.includes(e.payout_status))) return { skipped: 'already paid out' }
  const currency = e.contract.currency || 'USD'
  const email = e.contract.freelancer?.paypal_email
  if (!email) {
    await db().from('expenses').update({ payout_status: 'NEEDS_EMAIL' }).eq('id', id)
    await audit({ contractId: e.contract_id, milestoneId: e.milestone_id, actor: 'system', event: 'payout.needs_email', payload: { amountCents: e.amount_cents, expenseId: id } })
    return { status: 'NEEDS_EMAIL' }
  }
  const what = e.merchant || 'a project expense'
  const batch = await paypal.createPayout({
    senderBatchId: e.payout_batch_id ? `vkx-${id.slice(0, 18)}-${Date.now()}` : `vkx-${id}`,
    email, amountCents: e.amount_cents, currency, itemId: `x-${id.slice(0, 24)}`,
    subject: `Reimbursed: ${money(e.amount_cents, currency)} for ${what}`,
    note: `Verdikt reimbursed ${money(e.amount_cents, currency)} for ${what} from the expense budget of "${e.milestone.title}" (${e.contract.title}). Expenses carry no Verdikt fee.`,
  })
  const batchId = batch.batch_header?.payout_batch_id
  await db().from('expenses').update({ payout_batch_id: batchId, payout_status: batch.batch_header?.batch_status || 'PENDING', payout_email: email }).eq('id', id)
  await audit({ contractId: e.contract_id, milestoneId: e.milestone_id, actor: 'paypal', event: 'payout.sent', payload: { batchId, amountCents: e.amount_cents, feeCents: 0, email, expenseId: id } })
  watchExpensePayout(id, batchId)
  return { status: 'PENDING', batchId }
}

async function settleExpense(e, status, itemId) {
  if (!e || e.payout_status === status) return
  await db().from('expenses').update({ payout_status: status, ...(status === 'SUCCESS' ? { paid_out_at: new Date().toISOString() } : {}) }).eq('id', e.id)
  if (status === 'SUCCESS') {
    await audit({ contractId: e.contract_id, milestoneId: e.milestone_id, actor: 'paypal', event: 'payout.completed', payload: { amountCents: e.amount_cents, email: e.payout_email, itemId, expenseId: e.id } })
  } else if (RETRYABLE_PAYOUT.includes(status)) {
    await audit({ contractId: e.contract_id, milestoneId: e.milestone_id, actor: 'paypal', event: 'payout.failed', payload: { status, expenseId: e.id } })
  }
}

function watchExpensePayout(id, batchId, tries = 0) {
  setTimeout(async () => {
    let status
    try {
      const b = await paypal.getPayout(batchId)
      const item = b.items?.[0]
      status = item?.transaction_status || b.batch_header?.batch_status
      const { data: e } = await db().from('expenses').select('*').eq('id', id).single()
      if (status) await settleExpense(e, status, item?.payout_item_id)
    } catch {}
    if (!['SUCCESS', ...RETRYABLE_PAYOUT].includes(status) && tries < 20) watchExpensePayout(id, batchId, tries + 1)
  }, tries < 5 ? 3000 : 15000)
}

/**
 * PayPal honors a hold for 3 days and keeps it valid up to 29. Past the honor period, reauthorize once so the
 * funds stay guaranteed while the work is still being built or checked. Runs on a timer (index.js).
 */
export async function renewHolds() {
  const { data: list } = await db().from('milestones')
    .select('id, contract_id, title, status, amount_cents, paypal_authorization_id, authorized_at, hold_expires_at, reauthorized_at, contract:contracts(currency)')
    .in('status', HELD).not('paypal_authorization_id', 'is', null).is('reauthorized_at', null)
  const now = Date.now()
  for (const m of list || []) {
    if (!m.authorized_at || now - new Date(m.authorized_at).getTime() < HONOR_MS) continue
    if (m.hold_expires_at && new Date(m.hold_expires_at).getTime() < now) continue
    try {
      const auth = await paypal.reauthorize(m.paypal_authorization_id, { requestId: `reauth-${m.id}` })
      await db().from('milestones').update({
        paypal_authorization_id: auth.id, reauthorized_at: new Date().toISOString(),
        hold_expires_at: auth.expiration_time || m.hold_expires_at,
      }).eq('id', m.id)
      await audit({ contractId: m.contract_id, milestoneId: m.id, actor: 'paypal', event: 'escrow.hold_renewed', payload: { authorizationId: auth.id, expiresAt: auth.expiration_time } })
    } catch (e) {
      // logged once a day at most, so a hold PayPal won't renew doesn't flood the ledger
      const { data: last } = await db().from('audit_log').select('created_at').eq('milestone_id', m.id).eq('event', 'escrow.renew_failed')
        .order('created_at', { ascending: false }).limit(1).maybeSingle()
      if (!last || now - new Date(last.created_at).getTime() > 864e5) {
        await audit({ contractId: m.contract_id, milestoneId: m.id, actor: 'paypal', event: 'escrow.renew_failed', payload: { message: e.message } })
      }
    }
  }
}
