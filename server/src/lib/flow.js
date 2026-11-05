/*  ============================================================================
    Money-moving transitions, in one place:
    release  — capture the hold (all of it, or part: the rest goes back to the client),
               then pay the freelancer through PayPal Payouts, minus Verdikt's fee
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
 * Capture the held authorization. `amountCents` below the milestone amount is a partial release:
 * PayPal captures that much and returns the rest of the hold to the client.
 */
export async function release(milestone, actor, { amountCents } = {}) {
  const full = milestone.amount_cents
  const cents = Math.min(full, Math.max(100, Math.round(amountCents ?? full)))
  const partial = cents < full
  const currency = milestone.contract?.currency || 'USD'

  const capture = await paypal.captureAuthorization(milestone.paypal_authorization_id, {
    requestId: `release-${milestone.id}`,
    amountCents: partial ? cents : undefined,
    currency,
    noteToPayer: partial
      ? `Verdikt: ${money(cents, currency)} of ${money(full, currency)} released for ${milestone.title}; the rest of the hold is returned to you`
      : `Verdikt: ${milestone.title} passed its checks`,
  })
  await db().from('milestones').update({
    status: 'released', paypal_capture_id: capture.id, released_at: new Date().toISOString(), progress: null,
    released_cents: cents, voided_cents: full - cents,
  }).eq('id', milestone.id)
  await audit({
    contractId: milestone.contract_id, milestoneId: milestone.id, actor: actor === 'agent' ? 'paypal' : actor,
    event: partial ? 'escrow.partially_released' : 'escrow.released',
    payload: { captureId: capture.id, status: capture.status, amountCents: cents, ofCents: full, returnedCents: full - cents, by: actor },
  })

  // Paying the freelancer is a second step: if it can't happen yet (no payout email), the release still stands
  await payout(milestone.id).catch((e) => audit({
    contractId: milestone.contract_id, milestoneId: milestone.id, actor: 'paypal', event: 'payout.failed', payload: { message: e.message },
  }))
  await advance(milestone.contract_id)
  return capture
}

const DONE_PAYOUT = ['SUCCESS']
const RETRYABLE_PAYOUT = ['FAILED', 'RETURNED', 'BLOCKED', 'DENIED', 'UNCLAIMED', 'NEEDS_EMAIL', 'ERROR']

/** Pay a released milestone out to the freelancer's PayPal (released amount minus Verdikt's fee). Safe to call again. */
export async function payout(milestoneId) {
  const { data: m } = await db().from('milestones')
    .select('*, contract:contracts(id, title, currency, freelancer:profiles!contracts_freelancer_id_fkey(id, display_name, paypal_email))')
    .eq('id', milestoneId).single()
  if (!m?.released_cents) return { skipped: 'not released' }
  if (DONE_PAYOUT.includes(m.payout_status)) return { skipped: 'already paid out' }
  if (m.paypal_payout_batch_id && !RETRYABLE_PAYOUT.includes(m.payout_status)) return { skipped: 'payout in flight' }

  const currency = m.contract.currency || 'USD'
  const fee = Math.round((m.released_cents * config.fees.percent) / 100)
  const net = m.released_cents - fee
  const email = m.contract.freelancer?.paypal_email
  if (!email) {
    await db().from('milestones').update({ payout_status: 'NEEDS_EMAIL', fee_cents: fee, payout_cents: net }).eq('id', m.id)
    await audit({ contractId: m.contract_id, milestoneId: m.id, actor: 'system', event: 'payout.needs_email', payload: { amountCents: net } })
    return { status: 'NEEDS_EMAIL' }
  }

  // first attempt is idempotent per milestone; a retry gets a fresh batch id
  const senderBatchId = m.paypal_payout_batch_id ? `vk-${m.id.slice(0, 18)}-${Date.now()}` : `vk-${m.id}`
  const batch = await paypal.createPayout({
    senderBatchId, email, amountCents: net, currency, itemId: m.id,
    subject: `You've been paid for ${m.title}`,
    note: `Verdikt released ${money(m.released_cents, currency)} for "${m.title}" (${m.contract.title})${fee ? ` and kept a ${config.fees.percent}% fee` : ''}.`,
  })
  const batchId = batch.batch_header?.payout_batch_id
  await db().from('milestones').update({
    paypal_payout_batch_id: batchId, payout_status: batch.batch_header?.batch_status || 'PENDING',
    payout_email: email, fee_cents: fee, payout_cents: net,
  }).eq('id', m.id)
  await audit({
    contractId: m.contract_id, milestoneId: m.id, actor: 'paypal', event: 'payout.sent',
    payload: { batchId, amountCents: net, feeCents: fee, email },
  })
  watchPayout(m.id, batchId)
  return { status: 'PENDING', batchId }
}

/** PayPal settles a payout a few seconds later; follow it until it lands (webhooks do the same once deployed). */
function watchPayout(milestoneId, batchId, tries = 0) {
  setTimeout(async () => {
    try {
      const b = await paypal.getPayout(batchId)
      const item = b.items?.[0]
      const status = item?.transaction_status || b.batch_header?.batch_status
      const { data: m } = await db().from('milestones').select('contract_id, payout_status, payout_cents, payout_email').eq('id', milestoneId).single()
      if (status && status !== m.payout_status) {
        await db().from('milestones').update({
          payout_status: status, paypal_payout_item_id: item?.payout_item_id || null,
          ...(status === 'SUCCESS' ? { paid_out_at: new Date().toISOString() } : {}),
        }).eq('id', milestoneId)
        if (status === 'SUCCESS') {
          await audit({ contractId: m.contract_id, milestoneId, actor: 'paypal', event: 'payout.completed', payload: { amountCents: m.payout_cents, email: m.payout_email, itemId: item?.payout_item_id } })
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

/** After a restart, keep following payouts PayPal hasn't settled yet. */
export async function resumePayouts() {
  const { data } = await db().from('milestones').select('id, paypal_payout_batch_id')
    .in('payout_status', ['PENDING', 'PROCESSING']).not('paypal_payout_batch_id', 'is', null)
  for (const m of data || []) watchPayout(m.id, m.paypal_payout_batch_id)
  return (data || []).length
}

/** Void the held authorization → the client is never charged. */
export async function refund(milestone, actor) {
  await paypal.voidAuthorization(milestone.paypal_authorization_id, { requestId: `refund-${milestone.id}` })
  await db().from('milestones').update({ status: 'refunded', progress: null, voided_cents: milestone.amount_cents }).eq('id', milestone.id)
  await audit({ contractId: milestone.contract_id, milestoneId: milestone.id, actor, event: 'escrow.refunded', payload: { amountCents: milestone.amount_cents } })
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
