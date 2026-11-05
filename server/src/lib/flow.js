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
  const index = (milestone.tranches || []).length

  const capture = await paypal.captureAuthorization(milestone.paypal_authorization_id, {
    requestId: `release-${milestone.id}-${index}`,
    amountCents: final && !already && cents === full ? undefined : cents,
    currency,
    finalCapture: final,
    noteToPayer: !final
      ? `Verdikt: ${money(cents, currency)} released for ${milestone.title} — ${passed} of ${total} checks passed; the rest stays on hold`
      : releasedNow < full
        ? `Verdikt: ${money(releasedNow, currency)} of ${money(full, currency)} released for ${milestone.title}; the rest of the hold is returned to you`
        : `Verdikt: ${milestone.title} passed its checks`,
  })
  const tranche = { captureId: capture.id, cents, passed: passed ?? null, total: total ?? null, final, at: new Date().toISOString() }
  await db().from('milestones').update({
    ...(final
      ? { status: 'released', released_at: new Date().toISOString(), progress: null, voided_cents: full - releasedNow }
      : {}),
    paypal_capture_id: capture.id, released_cents: releasedNow,
    tranches: [...(milestone.tranches || []), tranche],
  }).eq('id', milestone.id)
  await audit({
    contractId: milestone.contract_id, milestoneId: milestone.id, actor: actor === 'agent' ? 'paypal' : actor,
    event: !final ? 'escrow.check_released' : releasedNow < full ? 'escrow.partially_released' : 'escrow.released',
    payload: { captureId: capture.id, status: capture.status, amountCents: cents, releasedCents: releasedNow, ofCents: full, returnedCents: final ? full - releasedNow : 0, passed, total, by: actor },
  })

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
  if (!m) return false
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
  return n
}

/**
 * Void the held authorization → the client isn't charged for what's still held. On a check-by-check
 * milestone that already released some tranches, the freelancer keeps those and the rest is returned.
 */
export async function refund(milestone, actor) {
  await paypal.voidAuthorization(milestone.paypal_authorization_id, { requestId: `refund-${milestone.id}` })
  const kept = milestone.released_cents || 0
  const returned = milestone.amount_cents - kept
  await db().from('milestones').update({
    status: kept ? 'released' : 'refunded', progress: null, voided_cents: returned, ...(kept ? { released_at: new Date().toISOString() } : {}),
  }).eq('id', milestone.id)
  await audit({ contractId: milestone.contract_id, milestoneId: milestone.id, actor, event: 'escrow.refunded', payload: { amountCents: returned, keptCents: kept } })
  await advance(milestone.contract_id)
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
