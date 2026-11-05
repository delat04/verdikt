/*  ============================================================================
    Ask the ledger — the column schema the question is answered against, a rule-based reader for
    demo mode, and the translation of a view ({ side, filters, sort }) into AG Grid's filter model.
    Live mode asks Claude (server/src/routes/ledger.js) with the same schema and gets the same shape.
    ============================================================================ */

import { money } from './format'

const STATUS_VALUES = ['awaiting_funding', 'draft', 'funded', 'submitted', 'verifying', 'passed', 'failed', 'released', 'refunded', 'disputed']

export const LEDGER_SCHEMA = [
  { field: 'contract', type: 'text', label: 'contract title' },
  { field: 'milestone', type: 'text', label: 'milestone title' },
  { field: 'with', type: 'text', label: 'the other party’s name' },
  { field: 'status', type: 'text', label: 'milestone status (funded = held in escrow, failed = held because checks not met, disputed = in review)', values: STATUS_VALUES },
  { field: 'amount', type: 'money', label: 'milestone amount' },
  { field: 'held', type: 'money', label: 'amount held in PayPal escrow right now' },
  { field: 'released', type: 'money', label: 'amount released (captured) to the freelancer' },
  { field: 'returned', type: 'money', label: 'amount returned to the client (voided)' },
  { field: 'fee', type: 'money', label: 'Verdikt platform fee' },
  { field: 'paidOut', type: 'money', label: 'amount paid out to the freelancer by PayPal Payouts' },
  { field: 'payout', type: 'text', label: 'PayPal payout status', values: ['SUCCESS', 'PENDING', 'NEEDS_EMAIL', 'FAILED', 'UNCLAIMED'] },
  { field: 'attempts', type: 'number', label: 'delivery attempts' },
  { field: 'fundedAt', type: 'date', label: 'date the money was held (YYYY-MM-DD)' },
  { field: 'releasedAt', type: 'date', label: 'date the money was released (YYYY-MM-DD)' },
]
const BY_FIELD = Object.fromEntries(LEDGER_SCHEMA.map((c) => [c.field, c]))

/** { side, filters, sort } → AG Grid filter model + column state */
export function toGrid(view) {
  const model = {}
  for (const f of view.filters || []) {
    const col = BY_FIELD[f.field]
    if (!col) continue
    if (col.type === 'money' || col.type === 'number') {
      const n = (v) => Number(String(v).replace(/[^0-9.]/g, '')) * (col.type === 'money' ? 100 : 1)
      if (!['equals', 'notEqual', 'greaterThan', 'lessThan', 'inRange'].includes(f.op)) continue
      model[f.field] = { filterType: 'number', type: f.op, filter: n(f.value), ...(f.op === 'inRange' && { filterTo: n(f.value_to) }) }
    } else if (col.type === 'date') {
      if (!['equals', 'greaterThan', 'lessThan', 'inRange'].includes(f.op)) continue
      model[f.field] = { filterType: 'date', type: f.op, dateFrom: `${f.value} 00:00:00`, dateTo: f.value_to ? `${f.value_to} 00:00:00` : null }
    } else {
      model[f.field] = { filterType: 'text', type: f.op, filter: f.value }
    }
  }
  const state = (view.sort || []).map((s, i) => ({ colId: s.field, sort: s.dir, sortIndex: i }))
  return { model, state }
}

/** A filter as people read it: "Amount over $500" */
export function describe(f) {
  const col = BY_FIELD[f.field]
  if (!col) return ''
  const name = { contract: 'Contract', milestone: 'Milestone', with: 'With', status: 'Status', amount: 'Amount', held: 'Held', released: 'Released', returned: 'Returned', fee: 'Fee', paidOut: 'Paid out', payout: 'Payout', attempts: 'Attempts', fundedAt: 'Funded', releasedAt: 'Released on' }[f.field]
  const v = (x) => (col.type === 'money' ? money(Number(String(x).replace(/[^0-9.]/g, '')) * 100, 'USD', { whole: true }) : x)
  const op = {
    equals: col.type === 'date' ? 'on' : 'is', notEqual: 'is not', contains: 'has', greaterThan: col.type === 'date' ? 'after' : 'over',
    lessThan: col.type === 'date' ? 'before' : 'under', blank: 'is empty', notBlank: 'is set',
  }[f.op]
  if (f.op === 'inRange') return `${name} ${v(f.value)}–${v(f.value_to)}`
  if (f.op === 'blank' || f.op === 'notBlank') return `${name} ${op}`
  return `${name} ${op} ${v(f.value)}`
}

// ---------------------------------------------------------------- the demo's reader (no model)
const iso = (d) => d.toISOString().slice(0, 10)
export function askLocal(question) {
  const t = question.toLowerCase()
  const filters = []
  const sort = []
  let side = 'all'
  const num = (s) => String(Number(s.replace(/[,$\s]/g, '').replace(/k$/, '')) * (/k$/.test(s) ? 1000 : 1))
  const moneyField = /\bfees?\b/.test(t) ? 'fee' : /paid out|payouts?/.test(t) ? 'paidOut' : /released/.test(t) ? 'released' : /\bheld\b|escrow/.test(t) ? 'held' : /returned|refund/.test(t) ? 'returned' : 'amount'
  let m
  if ((m = t.match(/between\s*\$?\s*([\d,.]+k?)\s*(?:and|-|to)\s*\$?\s*([\d,.]+k?)/))) filters.push({ field: moneyField, op: 'inRange', value: num(m[1]), value_to: num(m[2]) })
  else {
    if ((m = t.match(/(?:over|above|more than|greater than|at least|>)\s*\$?\s*([\d,.]+k?)/))) filters.push({ field: moneyField, op: 'greaterThan', value: num(m[1]), value_to: '' })
    if ((m = t.match(/(?:under|below|less than|at most|<)\s*\$?\s*([\d,.]+k?)/))) filters.push({ field: moneyField, op: 'lessThan', value: num(m[1]), value_to: '' })
  }
  const status = /disput|in review|appeal/.test(t) ? 'disputed' : /fail|didn.t pass|not pass|not yet/.test(t) ? 'failed' : /awaiting|to fund|not funded|unfunded/.test(t) ? 'awaiting_funding' : /verifying|being checked/.test(t) ? 'verifying' : null
  if (status) filters.push({ field: 'status', op: 'equals', value: status, value_to: '' })
  else if (/\bheld\b|in escrow/.test(t) && !filters.some((f) => f.field === 'held')) filters.push({ field: 'held', op: 'greaterThan', value: '0', value_to: '' })
  else if (/\breleased\b|\bpaid\b/.test(t) && !/paid out|payout/.test(t) && !filters.some((f) => f.field === 'released')) filters.push({ field: 'released', op: 'greaterThan', value: '0', value_to: '' })
  if (/returned|refund/.test(t) && !filters.some((f) => f.field === 'returned')) filters.push({ field: 'returned', op: 'greaterThan', value: '0', value_to: '' })
  if (/money in|earn|income|i received|i got paid/.test(t)) side = 'in'
  else if (/money out|spen[dt]|i paid|i owe|cost/.test(t)) side = 'out'
  if ((m = question.match(/\b(?:with|to|from|for|by)\s+([A-Z][a-z]+)/))) filters.push({ field: 'with', op: 'contains', value: m[1], value_to: '' })
  const now = new Date()
  const dateField = /released on|released this|released last/.test(t) ? 'releasedAt' : 'fundedAt'
  if (/this month/.test(t)) filters.push({ field: dateField, op: 'greaterThan', value: iso(new Date(now.getFullYear(), now.getMonth(), 0)), value_to: '' })
  else if (/this week|last 7 days/.test(t)) filters.push({ field: dateField, op: 'greaterThan', value: iso(new Date(now - 8 * 864e5)), value_to: '' })
  else if (/last 30 days|past month/.test(t)) filters.push({ field: dateField, op: 'greaterThan', value: iso(new Date(now - 31 * 864e5)), value_to: '' })
  if (/biggest|largest|most|top|highest/.test(t)) sort.push({ field: moneyField, dir: 'desc' })
  else if (/smallest|lowest|least/.test(t)) sort.push({ field: moneyField, dir: 'asc' })
  else if (/latest|recent|newest/.test(t)) sort.push({ field: dateField, dir: 'desc' })
  else if (/oldest|earliest/.test(t)) sort.push({ field: dateField, dir: 'asc' })
  const parts = [side === 'in' ? 'Money in' : side === 'out' ? 'Money out' : '', ...filters.map(describe)].filter(Boolean)
  return {
    answer: parts.length || sort.length
      ? `${parts.join(' · ') || 'Everything'}${sort.length ? `, ${sort[0].dir === 'desc' ? 'largest' : 'smallest'} first` : ''}`.replace(/, (largest|smallest) first$/, sort[0]?.field?.endsWith('At') ? `, ${sort[0].dir === 'desc' ? 'newest' : 'oldest'} first` : ', $1 first')
      : 'I couldn’t match that to the ledger — try “held over $500” or “disputes”.',
    side,
    filters,
    sort,
  }
}
