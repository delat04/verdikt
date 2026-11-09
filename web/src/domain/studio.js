/*  ============================================================================
    Studio data — the dashboard's three tables, built from the same contracts every other view reads:
      milestones  one row per milestone: what was held, released, returned and paid out, and when
      checks      one row per agreed check on each delivery attempt: met or not, and what decided it
      payments    one row per money movement PayPal made: holds, renewals, releases, refunds, payouts
    The three join on milestoneId, so a chart of checks can be cut by client and a chart of payments by
    contract. Money is in dollars and dates are Date objects, as AG Studio expects. The descriptions are
    what Claude reads when it builds a widget, so they say what each field means in Verdikt's terms.
    ============================================================================ */

import { STATUS, KIND, roleOf, counterparty } from './milestone'

const usd = (cents) => Math.round(cents || 0) / 100
const day = (iso) => (iso ? new Date(iso) : null)
const DECIDED = { probe: 'Probe', ocr: 'Screenshot text', reused: 'Earlier verdict', model: 'Claude' }

export function studioRows(contracts = [], userId) {
  const milestones = []
  const checks = []
  const payments = []
  const now = Date.now()

  for (const c of contracts) {
    const role = roleOf(c, userId)
    if (!role) continue
    const other = counterparty(c, role)
    const flow = role === 'freelancer' ? 'Money in' : 'Money out'
    const base = { contract: c.title, with: other?.name || 'Not joined yet', flow }

    for (const m of c.milestones || []) {
      const subs = m.submissions || []
      const verdicts = subs.map((s) => s.verdict).filter(Boolean)
      const last = verdicts.at(-1)
      const released = m.status === 'released' ? (m.releasedCents ?? m.amountCents) : (m.releasedCents || 0)
      const returned = m.voidedCents || (m.status === 'refunded' ? m.amountCents : 0)
      const held = ['funded', 'submitted', 'verifying', 'passed', 'failed', 'disputed'].includes(m.status) ? m.amountCents - (m.releasedCents || 0) : 0
      const deliveredAt = subs[0]?.createdAt || null
      const end = m.releasedAt || (m.status === 'refunded' ? m.releasedAt : null)
      milestones.push({
        ...base,
        milestoneId: m.id,
        milestone: `M${m.position} · ${m.title}`,
        milestoneFull: `${c.title} · M${m.position} ${m.title}`,
        status: STATUS[m.status]?.label || m.status,
        amount: usd(m.amountCents),
        held: usd(held),
        released: usd(released),
        returned: usd(returned),
        fee: usd(m.feeCents),
        paidOut: usd(m.payoutStatus === 'SUCCESS' ? m.payoutCents : 0),
        attempts: subs.length,
        checksMet: last ? last.results.filter((r) => r.passed).length : null,
        checksAgreed: (m.criteria || []).length,
        passedFirstTry: verdicts.length ? verdicts[0].outcome === 'pass' : null,
        firstTry: verdicts.length ? (verdicts[0].outcome === 'pass' ? 1 : 0) : null,
        fundedAt: day(m.fundedAt),
        dueAt: day(m.dueAt),
        deliveredAt: day(deliveredAt),
        releasedAt: day(m.releasedAt),
        daysHeld: m.fundedAt ? Math.max(0, Math.round(((end ? Date.parse(end) : now) - Date.parse(m.fundedAt)) / 864e5)) : null,
        deliveredOnTime: deliveredAt && m.dueAt ? Date.parse(deliveredAt) <= Date.parse(m.dueAt) : null,
      })

      const criteria = new Map((m.criteria || []).map((cr) => [cr.id, cr]))
      subs.forEach((s) => {
        for (const [i, r] of (s.verdict?.results || []).entries()) {
          const cr = criteria.get(r.criterionId)
          checks.push({
            ...base,
            checkId: `${s.id}:${r.criterionId || i}`,
            milestoneId: m.id,
            attempt: s.attempt,
            check: cr?.statement || 'Check',
            kind: KIND[cr?.kind]?.label || 'Other',
            decidedBy: DECIDED[r.layer] || 'Claude',
            result: r.passed ? 'Met' : 'Not met',
            met: r.passed ? 1 : 0,
            checkedAt: day(s.verdict.createdAt || s.createdAt),
          })
        }
      })

      const pay = (type, cents, at, paypalId) => {
        if (!cents || !at) return
        payments.push({ ...base, paymentId: `${m.id}:${type}:${payments.length}`, milestoneId: m.id, type, amount: usd(cents), at: day(at), paypalId: paypalId || '' })
      }
      pay('Held in escrow', m.amountCents, m.authorizedAt || m.fundedAt, m.paypal?.authorizationId || m.paypal?.orderId)
      pay('Hold renewed', m.amountCents - (m.releasedCents || 0), m.reauthorizedAt, m.paypal?.authorizationId)
      const tranches = m.tranches?.length ? m.tranches : (released ? [{ cents: released, at: m.releasedAt, captureId: m.paypal?.captureId }] : [])
      for (const t of tranches) pay('Released', t.cents, t.at, t.captureId)
      pay('Returned to client', returned, m.releasedAt || m.fundedAt, m.paypal?.authorizationId)
      pay('Paid out to freelancer', m.payoutStatus === 'SUCCESS' ? m.payoutCents : 0, m.paidOutAt, m.paypal?.payoutBatchId)
      pay('Verdikt fee', m.feeCents, m.releasedAt, '')
      for (const e of m.expenses || []) if (e.status === 'approved' || e.payoutStatus) pay('Expense reimbursed', e.amountCents, e.paidOutAt || e.decidedAt, e.captureId)
    }
  }
  return { milestones, checks, payments }
}

const text = (id, name, description) => ({ id, name, format: 'textFormat', description })
const USD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
const USD0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
const ONE = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 })
const PCT = new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 0 })
const dollars = (id, name, description) => ({ id, name, format: 'currencyFormat', formatOptions: { format: USD }, description })
const count = (id, name, description) => ({ id, name, format: 'integerFormat', description })
const date = (id, name, description) => ({ id, name, format: 'dateFormat', description })
const yes = (id, name, description) => ({ id, name, format: 'booleanFormat', description })
const shared = () => [
  text('contract', 'Contract', 'The contract’s title.'),
  text('with', 'With', 'The other party: the freelancer when the person pays, the client when they earn.'),
  text('flow', 'Flow', '“Money in” when the person is the freelancer, “Money out” when they are the client.'),
]

/** AG Studio's data definition for the three tables. */
export function studioData({ milestones, checks, payments }) {
  return {
    description: 'Verdikt escrow: freelance work paid per milestone. Each milestone’s money is held by PayPal and released only when the agreed checks pass on a delivery. All money is in US dollars.',
    sources: [
      {
        id: 'milestones', name: 'Milestones', primaryKeyField: 'milestoneId', data: milestones,
        description: 'One row per milestone across every contract: the money held, released and returned, the dates, and how the checks went.',
        fields: [
          { ...text('milestoneId', 'Milestone id', 'Joins to checks and payments.'), hide: true },
          ...shared(),
          text('milestone', 'Milestone', 'Position and title, e.g. “M2 · Online shop”. Titles repeat across contracts.'),
          text('milestoneFull', 'Contract and milestone', 'The contract and milestone together, unique per milestone: use it to chart milestones one by one.'),
          text('status', 'Status', 'Where it stands: Held in escrow, Submitted, Verifying, Passed, Held — not yet (checks failed), Released, Refunded, In review.'),
          dollars('amount', 'Amount', 'The milestone’s agreed price.'),
          dollars('held', 'Held now', 'Money PayPal holds for it right now.'),
          dollars('released', 'Released', 'Money released to the freelancer.'),
          dollars('returned', 'Returned', 'Money returned to the client.'),
          dollars('fee', 'Fee', 'Verdikt’s fee, taken from the payout.'),
          dollars('paidOut', 'Paid out', 'Money that reached the freelancer’s PayPal account.'),
          count('attempts', 'Deliveries', 'How many times work was submitted for verification.'),
          count('checksMet', 'Checks met', 'Checks met on the latest delivery.'),
          count('checksAgreed', 'Checks agreed', 'Checks both sides signed for this milestone.'),
          yes('passedFirstTry', 'Passed first try', 'Whether the first delivery met every check.'),
          { ...count('firstTry', 'Passed first try (1 or 0)', '1 when the first delivery met every check, 0 when not, blank before any delivery: average it for a rate.'), hide: true },
          date('fundedAt', 'Funded', 'When the money went into escrow.'),
          date('dueAt', 'Due', 'The agreed due date.'),
          date('deliveredAt', 'Delivered', 'When the first delivery was submitted.'),
          date('releasedAt', 'Released on', 'When the money was released or returned.'),
          count('daysHeld', 'Days held', 'Days the money sat in escrow, until release or until today.'),
          yes('deliveredOnTime', 'Delivered on time', 'Whether the first delivery came before the due date.'),
        ],
      },
      {
        id: 'checks', name: 'Checks', primaryKeyField: 'checkId', data: checks,
        description: 'One row per agreed check on each delivery: whether it was met and what decided it (deterministic probes, the text in a screenshot, or Claude).',
        fields: [
          { ...text('checkId', 'Check id', 'Unique per delivery and check.'), hide: true },
          { ...text('milestoneId', 'Milestone id', 'Joins to milestones.'), hide: true },
          ...shared(),
          count('attempt', 'Delivery', 'Which delivery attempt: 1 is the first.'),
          text('check', 'Check', 'What was agreed, in plain words.'),
          text('kind', 'Kind', 'Visual, Functional, Code, Performance or Content.'),
          text('decidedBy', 'Decided by', 'Probe (a deterministic browser or repository test, no model), Screenshot text, Earlier verdict, or Claude.'),
          text('result', 'Result', 'Met or Not met.'),
          count('met', 'Met (1 or 0)', '1 when met, 0 when not: average it for a pass rate.'),
          date('checkedAt', 'Checked', 'When the verdict was given.'),
        ],
      },
      {
        id: 'payments', name: 'Payments', primaryKeyField: 'paymentId', data: payments,
        description: 'One row per money movement PayPal made for a milestone: held in escrow, hold renewed, released, returned to client, paid out, Verdikt fee, expense reimbursed.',
        fields: [
          { ...text('paymentId', 'Payment id', 'Unique per movement.'), hide: true },
          { ...text('milestoneId', 'Milestone id', 'Joins to milestones.'), hide: true },
          ...shared(),
          text('type', 'Type', 'Held in escrow, Hold renewed, Released, Returned to client, Paid out to freelancer, Verdikt fee, Expense reimbursed.'),
          dollars('amount', 'Amount', 'How much moved.'),
          date('at', 'Date', 'When PayPal moved it.'),
          text('paypalId', 'PayPal id', 'The PayPal authorization, capture or payout batch behind it.'),
        ],
      },
    ],
    relationships: [
      { id: 'checks-milestone', type: 'many-to-one', source: 'checks.milestoneId', target: 'milestones.milestoneId' },
      { id: 'payments-milestone', type: 'many-to-one', source: 'payments.milestoneId', target: 'milestones.milestoneId' },
      // money over time: payments group by year, quarter or month through the calendar
      { id: 'payments-calendar', source: 'payments.at', target: { calendarId: 'calendar' } },
    ],
    calendars: [{
      id: 'calendar', label: 'Calendar', fragments: ['year', 'quarter', 'month', 'monthOfYear', 'dayOfWeek'],
      range: span(payments),
    }],
    expressions: MEASURES,
  }
}

// the calendar runs from the month of the first money movement to the end of this month
function span(payments) {
  const ymd = (d) => d.toISOString().slice(0, 10)
  const now = new Date()
  const first = payments.reduce((min, p) => (p.at && p.at < min ? p.at : min), new Date(now.getFullYear(), now.getMonth() - 2, 1))
  return {
    from: { type: 'date', value: ymd(new Date(Date.UTC(first.getFullYear(), first.getMonth(), 1))) },
    to: { type: 'date', value: ymd(new Date(Date.UTC(now.getFullYear(), now.getMonth() + 1, 0))) },
  }
}
const sumOf = (id) => ({ id, aggregation: 'sum' })
const avgOf = (id) => ({ id, aggregation: 'avg' })
// a payment's amount when it is of one type, else 0: summed, money of that type over time
const paidAs = (id, type) => ({
  id, isMeasure: false, hide: true, format: 'currencyFormat', formatOptions: { format: USD },
  expression: { operator: 'if', inputs: [{ operator: 'equals', inputs: [{ id: 'payments.type' }, { type: 'string', value: type }] }, { id: 'payments.amount' }, { type: 'number', value: 0 }] },
})
const SHOWN = { currencyFormat: USD0, decimalFormat: ONE, percentageFormat: PCT }
const measure = (id, name, format, expression, description) => ({
  id, name, description, isMeasure: true, format, expression, ...(SHOWN[format] ? { formatOptions: { format: SHOWN[format] } } : {}),
})

/** The measures the report and Claude build on. */
export const MEASURES = [
  paidAs('heldMove', 'Held in escrow'),
  paidAs('releasedMove', 'Released'),
  measure('heldNow', 'Held now', 'currencyFormat', sumOf('milestones.held'), 'Money PayPal holds in escrow right now.'),
  measure('releasedTotal', 'Released', 'currencyFormat', sumOf('milestones.released'), 'Money released to freelancers.'),
  measure('returnedTotal', 'Returned', 'currencyFormat', sumOf('milestones.returned'), 'Money returned to clients.'),
  measure('paidOutTotal', 'Paid out', 'currencyFormat', sumOf('milestones.paidOut'), 'Money that reached freelancers’ PayPal accounts.'),
  measure('avgDaysHeld', 'Average days held', 'decimalFormat', avgOf('milestones.daysHeld'), 'Average days money sat in escrow.'),
  measure('firstTryRate', 'Passed first try', 'percentageFormat', avgOf('milestones.firstTry'), 'Share of delivered milestones whose first delivery met every check.'),
  measure('avgDeliveries', 'Deliveries per milestone', 'decimalFormat', avgOf('milestones.attempts'), 'Average number of deliveries before a verdict settled it.'),
  measure('checkRate', 'Checks met', 'percentageFormat', avgOf('checks.met'), 'Share of checks met, across every delivery.'),
  measure('checksRun', 'Checks run', 'integerFormat', { id: 'checks.checkId', aggregation: 'count' }, 'How many checks were run, across every delivery.'),
  measure('heldIn', 'Put in escrow', 'currencyFormat', sumOf('heldMove'), 'Money PayPal put on hold for a milestone.'),
  measure('releasedOut', 'Released by PayPal', 'currencyFormat', sumOf('releasedMove'), 'Money PayPal captured and released from escrow.'),
]
