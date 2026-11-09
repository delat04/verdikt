/*  ============================================================================
    PayPal check — every money number Verdikt shows, read back from PayPal itself. For each milestone:
      the hold      GET /v2/payments/authorizations/{id}   amount, and a status that fits ours
      each release  GET /v2/payments/captures/{id}         amount captured, still COMPLETED (not refunded)
      each payout   GET /v1/payments/payouts/{batch}       amount sent, and how the item settled
    and the same for each reimbursed expense. A check is met, not met (Verdikt and PayPal disagree: a
    refund made in PayPal, a chargeback, a returned payout…), or waiting (PayPal is still settling it).
    Read-only: nothing here moves money.
    ============================================================================ */

import { getAuthorization, getCapture, getPayout } from './paypal.js'

const cents = (v) => Math.round(Number(v || 0) * 100)
const usd = (c) => `$${(c / 100).toFixed(2)}`
const HELD = ['funded', 'submitted', 'verifying', 'passed', 'failed', 'disputed']
const IN_FLIGHT = ['PENDING', 'PROCESSING', 'UNCLAIMED', 'ONHOLD']

// what PayPal's authorization status should be, given ours
function holdFits(status, paypal, partly) {
  if (HELD.includes(status)) return partly ? paypal === 'PARTIALLY_CAPTURED' : ['CREATED', 'PENDING'].includes(paypal)
  if (status === 'released') return ['CAPTURED', 'PARTIALLY_CAPTURED'].includes(paypal)
  // returned to the client: the hold was voided, or (after a partial release) closed by its final capture
  if (status === 'refunded') return ['VOIDED', 'EXPIRED'].includes(paypal) || (partly && ['CAPTURED', 'PARTIALLY_CAPTURED'].includes(paypal))
  return true
}

async function look(fn, id) {
  try {
    return { ok: true, body: await fn(id) }
  } catch (e) {
    return { ok: false, error: e.status === 404 ? 'PayPal has no record of this id' : e.message }
  }
}

/** Checks one milestone row (snake_case, with its expenses) against PayPal. */
export async function checkMilestone(m) {
  const checks = []
  const add = (what, id, verdikt, paypal, met, note = '') => checks.push({ what, id, verdikt, paypal, met, note })

  if (m.paypal_authorization_id && m.spend_limit_id) {
    // funded from a spending limit: one larger PayPal hold covers many jobs, so it only has to cover this one
    const r = await look(getAuthorization, m.paypal_authorization_id)
    if (!r.ok) add('Spending-limit hold', m.paypal_authorization_id, `${usd(m.amount_cents)} of the limit`, r.error, false)
    else {
      const amount = cents(r.body.amount?.value)
      add('Spending-limit hold', m.paypal_authorization_id, `${usd(m.amount_cents)} of the limit · ${m.status}`, `${usd(amount)} · ${r.body.status}`,
        amount >= m.amount_cents, amount >= m.amount_cents ? '' : 'The limit’s hold is smaller than this job.')
    }
  } else if (m.paypal_authorization_id) {
    // the hold covers the milestone and its expense budget
    const held = m.amount_cents + (m.expense_budget_cents || 0)
    const ours = `${usd(held)} · ${m.status}${m.expense_budget_cents ? ' (with expenses)' : ''}`
    const r = await look(getAuthorization, m.paypal_authorization_id)
    if (!r.ok) add('Hold', m.paypal_authorization_id, ours, r.error, false)
    else {
      const amount = cents(r.body.amount?.value)
      const st = r.body.status
      const fits = holdFits(m.status, st, (m.released_cents || 0) > 0)
      add('Hold', m.paypal_authorization_id, ours, `${usd(amount)} · ${st}`,
        amount === held && fits,
        amount !== held ? 'The amounts differ.' : fits ? '' : `PayPal shows the hold ${st.toLowerCase().replace('_', ' ')}.`)
    }
  }

  const tranches = m.tranches?.length ? m.tranches : m.paypal_capture_id ? [{
    captureId: m.paypal_capture_id, cents: m.released_cents, netCents: m.payout_cents, payoutBatchId: m.paypal_payout_batch_id, payoutStatus: m.payout_status,
  }] : []
  for (const [i, t] of tranches.entries()) {
    const label = tranches.length > 1 ? `Release ${i + 1}` : 'Release'
    if (t.captureId) {
      const r = await look(getCapture, t.captureId)
      if (!r.ok) add(label, t.captureId, usd(t.cents), r.error, false)
      else {
        const amount = cents(r.body.amount?.value)
        const st = r.body.status
        add(label, t.captureId, `${usd(t.cents)} · released`, `${usd(amount)} · ${st}`,
          st === 'PENDING' ? null : amount === t.cents && st === 'COMPLETED',
          st === 'PENDING' ? 'PayPal is still settling the capture.'
            : st.includes('REFUNDED') ? 'Refunded in PayPal after Verdikt released it.'
              : amount !== t.cents ? 'The amounts differ.' : '')
      }
    }
    if (t.payoutBatchId) {
      const r = await look(getPayout, t.payoutBatchId)
      if (!r.ok) add(`${label} payout`, t.payoutBatchId, usd(t.netCents || 0), r.error, false)
      else {
        const item = r.body.items?.[0]
        const amount = cents(item?.payout_item?.amount?.value)
        const st = item?.transaction_status || r.body.batch_header?.batch_status
        const ours = t.payoutStatus || m.payout_status || ''
        const settled = st === 'SUCCESS'
        add(`${label} payout`, t.payoutBatchId, `${usd(t.netCents || 0)} · ${ours.toLowerCase() || 'sent'}`, `${usd(amount)} · ${st}`,
          IN_FLIGHT.includes(st) ? null : amount === (t.netCents || 0) && (settled ? ours === 'SUCCESS' || !ours : ours === st),
          IN_FLIGHT.includes(st) ? 'PayPal is still sending it.'
            : amount !== (t.netCents || 0) ? 'The amounts differ.'
              : settled && ours && ours !== 'SUCCESS' ? 'PayPal paid it; Verdikt hasn’t marked it paid yet.'
                : !settled && ours === 'SUCCESS' ? `Verdikt shows it paid; PayPal says ${st.toLowerCase()}.` : '')
      }
    }
  }

  for (const e of m.expenses || []) {
    if (!e.paypal_capture_id) continue
    const r = await look(getCapture, e.paypal_capture_id)
    if (!r.ok) { add('Expense', e.paypal_capture_id, usd(e.amount_cents), r.error, false); continue }
    const amount = cents(r.body.amount?.value)
    add('Expense', e.paypal_capture_id, `${usd(e.amount_cents)} · ${e.merchant || 'receipt'}`, `${usd(amount)} · ${r.body.status}`,
      r.body.status === 'PENDING' ? null : amount === e.amount_cents && r.body.status === 'COMPLETED',
      r.body.status.includes('REFUNDED') ? 'Refunded in PayPal after Verdikt reimbursed it.' : amount !== e.amount_cents ? 'The amounts differ.' : '')
  }

  const state = !checks.length ? 'none' : checks.some((c) => c.met === false) ? 'differs' : checks.some((c) => c.met === null) ? 'waiting' : 'matches'
  return { milestoneId: m.id, state, checks }
}

/** Runs the checks a few at a time, so a long ledger doesn't hammer PayPal. */
export async function checkMany(milestones, { at = 4 } = {}) {
  const out = []
  let next = 0
  await Promise.all(Array.from({ length: Math.min(at, milestones.length) }, async () => {
    while (next < milestones.length) {
      const m = milestones[next++]
      out.push(await checkMilestone(m))
    }
  }))
  return out
}
