/* Expense budgets: money held with a milestone for what the work needs (a domain, hosting, fonts…),
   reimbursed one receipt at a time. Shared by the Expenses tab, the payment panel and the demo. */

export const COVER_SUGGESTIONS = ['Domain', 'Hosting', 'Stock photos', 'Fonts', 'Icons & illustrations', 'API credits', 'Software licenses', 'Email']

export const EXPENSE_STATUS = {
  checking: { label: 'Checking', tone: 'warn', live: true },
  needs_client: { label: 'Client decides', tone: 'warn' },
  approved: { label: 'Reimbursed', tone: 'ok' },
  rejected: { label: 'Not reimbursed', tone: 'danger' },
  declined: { label: 'Declined', tone: 'neutral' },
  expired: { label: 'Closed', tone: 'neutral' },
  error: { label: 'PayPal error', tone: 'danger' },
}

export const RECEIPT_ACCEPT = 'application/pdf,image/png,image/jpeg,image/webp'
export const MAX_RECEIPT_BYTES = 5 * 1024 * 1024

/** What the budget has spent (captured), has waiting, and has left. */
export function expenseTotals(m) {
  const budget = m?.expenseBudgetCents || 0
  const list = m?.expenses || []
  const spent = list.filter((e) => e.captureId).reduce((s, e) => s + e.amountCents, 0)
  const waiting = list.filter((e) => ['checking', 'needs_client'].includes(e.status)).reduce((s, e) => s + e.amountCents, 0)
  return { budget, spent, waiting, left: Math.max(0, budget - spent - waiting) }
}

export const holdCents = (m) => (m?.amountCents || 0) + (m?.expenseBudgetCents || 0)

export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''))
    r.onerror = () => reject(new Error('The file could not be read'))
    r.readAsDataURL(file)
  })
}
