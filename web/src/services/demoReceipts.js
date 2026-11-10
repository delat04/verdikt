/*  ============================================================================
    Demo receipts — the sample receipts demo mode can claim, the shopping list the sample contract carries,
    and the checks the demo runs on a claim. The live server reads a real receipt (a PDF's text, or OCR) and
    runs agent/receipts.js; the demo carries the text each sample reads as and runs the same rules in the same
    order: the shopping list and the budget lines come from domain/expenseRules.js, the live checker's
    byte-identical copy. Nothing here hard-codes an outcome: `expect` is what server/test/parity.test.js
    asserts the demo and the live checker both reach.
    Plain ESM with relative imports only (no '@/'), so the server's tests load this file as it is.
    ============================================================================ */

import { coveredByRules, matchList, listChecks } from '../domain/expenseRules.js'
import { SAMPLE_PRODUCTS } from './demoProducts.js'

// ---------------------------------------------------------------- the sample receipts
// lines: the text the receipt reads as. expect: what the checks decide on the sample contract's M2 (budget
// $250 for Domain, Hosting and Fonts; $20 of hosting already reimbursed; the list below, before anyone agrees
// to the printer). expectAfterAgree: the same once Maya agrees to the printer.
export const RECEIPTS = {
  domain: { via: 'pdf', merchant: 'Domainly Registrar', total: 3298, ref: 'DL-48213', lines: ['Domain registration — northbrew.coffee (1 year)  $32.98', 'DNS hosting  $0.00', 'Total paid  $32.98'], expect: 'approved' },
  inflated: { via: 'pdf', merchant: 'Stackhost', total: 2000, ref: 'SH-20412', lines: ['Starter hosting plan — 1 project  $20.00', 'Total due  $20.00'], expect: 'rejected' },
  lunch: { via: 'ocr', merchant: 'Corner Deli', total: 1840, ref: '', lines: ['Turkey sandwich  $11.50', 'Flat white  $4.40', 'Brownie  $2.50', 'Total  $18.40'], expect: 'rejected' },
  blurry: { via: 'ocr', merchant: '', total: null, ref: '', lines: ['F0nt sh0p ... l1cen5e', '... :: ...'], expect: 'needs_client' },
  hosting: { via: 'pdf', merchant: 'Stackhost', total: 2000, ref: 'SH-19876', lines: ['Starter hosting plan — 1 project  $20.00', 'Total paid  $20.00'], expect: 'approved' },
  scanner: { via: 'pdf', merchant: 'Walmart', total: 3702, ref: 'WM-77310', lines: ['walmart.com order WM-77310', 'Netum 2D Barcode Scanner  $34.20', 'Sales tax  $2.82', 'Order total  $37.02'], expect: 'approved' },
  twoitems: { via: 'pdf', merchant: 'Walmart', total: 6808, ref: 'WM-77342', lines: ['walmart.com order WM-77342', 'Netum 2D Barcode Scanner  $34.20', 'Anself Mini Thermal Receipt Printer  $28.69', 'Sales tax  $5.19', 'Order total  $68.08'], expect: 'needs_client', expectAfterAgree: 'approved' },
  wrongitem: { via: 'pdf', merchant: 'Walmart', total: 3767, ref: 'WM-77388', lines: ['walmart.com order WM-77388', 'Bluetooth Speaker  $34.88', 'Sales tax  $2.79', 'Order total  $37.67'], expect: 'needs_client' },
}

// what the demo's sample chips claim, in the order they show (hosting is only the seeded claim)
export const SAMPLE_CLAIMS = [
  { key: 'domain', label: 'domain receipt', amountCents: 3298, merchant: 'Domainly Registrar', purpose: 'northbrew.coffee for a year' },
  { key: 'scanner', label: 'scanner from the list', amountCents: 3702, merchant: 'Walmart', purpose: 'Barcode scanner for packing orders' },
  { key: 'twoitems', label: 'scanner and printer', amountCents: 6808, merchant: 'Walmart', purpose: 'Scanner and slip printer for packing' },
  { key: 'wrongitem', label: 'same store, other item', amountCents: 3767, merchant: 'Walmart', purpose: 'Speaker for the packing table' },
  { key: 'lunch', label: 'lunch receipt', amountCents: 1840, merchant: 'Corner Deli', purpose: 'Working lunch' },
  { key: 'blurry', label: 'blurry photo', amountCents: 1200, merchant: 'Fontshop', purpose: 'Display font licence' },
  { key: 'inflated', label: 'hosting, amount inflated', amountCents: 4500, merchant: 'Stackhost', purpose: 'Hosting for the shop' },
]

/** The text a sample receipt reads as, with the purchase date the live reader would find on it. */
export const receiptText = (r, day) => [...(r?.lines || []), `Date: ${day}`].join('\n')

// ---------------------------------------------------------------- the sample contract's M2
export const SAMPLE_BUDGET = { expenseBudgetCents: 25000, expenseCovers: ['Domain', 'Hosting', 'Fonts'] }
export const SAVED_AS_OF = '2026-11-09T12:00:00Z'   // when the saved listings were read from Channel3

const saved = (id) => Object.values(SAMPLE_PRODUCTS).flat().find((p) => p.id === id)
const walmart = (p) => ({ currency: 'USD', inStock: true, offers: [{ domain: 'walmart.com', priceCents: p.priceCents, url: p.url, inStock: true }] })

/**
 * The shopping list M2 starts with: Maya pinned the Netum scanner before both signed (so signing agreed to it),
 * and Sam's agent proposed the Anself printer after signing (it waits for Maya).
 * @param {(days: number) => string} ago  days before now → ISO time
 */
export function sampleShoppingList(ago) {
  const netum = saved('Rcq3ctM')
  const anself = saved('yWFPHs9')
  return [
    { ...netum, title: '2D Barcode Scanner', brand: 'Netum', ...walmart(netum), plannedBy: 'client', viaAgent: false, status: 'terms', at: ago(8.6), asOf: SAVED_AS_OF },
    { ...anself, title: 'Portable Mini Thermal Receipt Printer', brand: 'Anself', ...walmart(anself), plannedBy: 'freelancer', viaAgent: true, status: 'proposed', at: ago(0.6), asOf: SAVED_AS_OF },
  ]
}

// ---------------------------------------------------------------- the checks, in the live checker's order
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
// 'Nov 9', as agent/receipts.js writes a listing date
const dateOf = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : `${MON[d.getUTCMonth()]} ${d.getUTCDate()}` }
// the dollar amounts printed on the lines
const amountsOf = (lines) => lines.flatMap((l) => [...l.matchAll(/\$\s?(\d{1,3}(?:,\d{3})*\.\d{2}|\d+\.\d{2})/g)].map((m) => Math.round(Number(m[1].replace(/,/g, '')) * 100)))
const COVERED = 'Something the budget covers'

/**
 * Check a demo claim the way agent/receipts.js checkExpense checks a live one.
 * @param {object} p
 * @param {string} p.key            a RECEIPTS key, or anything else for an uploaded file (the demo can't read it)
 * @param {object} p.claim          { amountCents }
 * @param {object} p.milestone      { expenseBudgetCents, expenseCovers, expenseProducts }
 * @param {object} p.contract       { createdAt, currency }
 * @param {number} p.committedCents other claims reimbursed or waiting
 * @param {object|null} p.duplicate { why } an earlier live claim of the same receipt
 * @param {string[]} [p.usedIds]    list items another live claim already bought
 * @param {string} [p.clientName]   who decides what the rules can't, e.g. 'Maya'
 * @param {(cents: number) => string} p.$  money in the contract's currency
 * @param {string} [p.day]          the receipt's date (today)
 * @returns {{ checks: Array, tokens: number, via: string, planned: Array<{ id, title, domain, image }> }}
 */
export function sampleChecks({ key, claim, milestone, contract, committedCents = 0, duplicate = null, usedIds = [], clientName = 'The client', $, day = new Date().toISOString().slice(0, 10) }) {
  const r = RECEIPTS[key]
  const checks = []
  const add = (k, label, status, observed, fix = '', by = 'rules') => checks.push({ key: k, label, status, observed, fix, by })
  const readable = !!r && r.total != null
  const amounts = readable ? amountsOf(r.lines) : []
  const claimed = claim.amountCents

  add('readable', 'The receipt can be read', readable ? 'pass' : 'unknown', !r ? 'Demo mode does not read uploaded files; the live app reads the PDF text or runs OCR on the image.'
    : readable ? `Read ${r.via === 'pdf' ? "from the PDF's text" : 'with OCR from the image'}: ${r.lines.length} lines, 1 date.` : 'No amounts could be read from the image.', readable ? '' : 'Upload the PDF receipt, or a sharper photo of the whole receipt.')

  if (!readable) add('amount', 'The amount is on the receipt', 'unknown', 'The receipt could not be read, so the amount was not compared.')
  else if (claimed === r.total) add('amount', 'The amount is on the receipt', 'pass', `Total on the receipt: ${$(r.total)}.`)
  else if (claimed > r.total) add('amount', 'The amount is on the receipt', 'fail', `You claimed ${$(claimed)}; the receipt's total is ${$(r.total)}.`, `Claim ${$(r.total)} or less.`)
  else if (amounts.includes(claimed)) add('amount', 'The amount is on the receipt', 'pass', `${$(claimed)} is a line on the receipt (total ${$(r.total)}).`)
  else add('amount', 'The amount is on the receipt', 'unknown', `${$(claimed)} is less than the total (${$(r.total)}) but isn't a line on the receipt.`, 'Claim the total, or one line of it.')

  add('date', 'Bought during the contract', readable ? 'pass' : 'unknown', readable ? `Dated ${day}; the contract started ${String(contract.createdAt).slice(0, 10)}.` : 'The receipt could not be read, so the date was not checked.')

  if (duplicate) add('unique', 'Not claimed before', 'fail', duplicate.why, 'Each receipt is reimbursed once.')
  else add('unique', 'Not claimed before', 'pass', r?.ref ? `No earlier claim has this file, or order ${r.ref} for this total.` : 'No earlier claim has this file.')

  const budget = milestone.expenseBudgetCents || 0
  const left = Math.max(0, budget - committedCents)
  if (claimed <= left) add('budget', 'Fits the expense budget', 'pass', `${$(claimed)} of the ${$(left)} left (budget ${$(budget)}).`)
  else add('budget', 'Fits the expense budget', 'fail', `You claimed ${$(claimed)}; ${$(left)} of the ${$(budget)} budget is left.`, left >= 100 ? `Claim ${$(left)} or less, or agree a bigger budget with a change order.` : 'The budget is used up.')

  // the shopping list, read from the receipt only (never from what the claimant typed); claims exist only on
  // funded milestones, and those are signed. Listings are in US dollars.
  const text = r ? receiptText(r, day) : ''
  const list = (contract.currency || 'USD') === 'USD'
    ? matchList({ items: milestone.expenseProducts || [], text, claimedCents: claimed, signed: true, usedIds })
    : { kind: 'none', matches: [] }
  checks.push(...listChecks(list, { $, dateOf, clientName }))
  // (the live checker also fails a receipt that talks to the AI; no sample does)

  // covered, as live: no lines → anything; an agreed list item; a budget line the receipt names; then unknown
  // when unreadable or something else failed; a list store with no agreed item goes to the client, no model
  let tokens = 0
  const covers = milestone.expenseCovers || []
  const ruled = readable ? coveredByRules(covers, text) : null
  if (!covers.length) add('covered', COVERED, 'pass', 'The budget is for any project expense.')
  else if (list.kind === 'match') add('covered', COVERED, 'pass', `On the shopping list both of you agreed: ${list.matches.map((m) => m.title).join(', ')}.`)
  else if (ruled) add('covered', COVERED, 'pass', `The receipt mentions “${ruled.word}” — covered as ${ruled.cover}.`)
  else if (!readable) add('covered', COVERED, 'unknown', 'The receipt could not be read, so coverage was not checked.')
  else if (checks.some((c) => c.status === 'fail')) add('covered', COVERED, 'unknown', 'Not checked: another check already failed.')
  else if (list.kind === 'store_only') add('covered', COVERED, 'unknown', 'Not an item on the list, and the receipt names none of the budget lines.', `${clientName} decides.`)
  else if (key === 'lunch') {
    // the one sample whose model answer the demo plays back: live, Claude reads it (text only, low effort)
    tokens = 640
    add('covered', COVERED, 'fail', 'A sandwich, coffee and a brownie from a deli are a meal, not a domain, hosting or a font.', `The budget covers ${covers.join(', ')}.`, 'claude')
  } else add('covered', COVERED, 'unknown', 'The live app asks Claude about this receipt; in demo mode the client decides.', `${clientName} decides.`)

  return { checks, tokens, via: r?.via || '', planned: list.matches.map((m) => ({ id: m.id, title: m.title, domain: m.domain, image: m.image })) }
}

/** All pass → reimburse; one fails → rejected; otherwise the client decides. 'info' rows explain, never decide. */
export function decide(checks) {
  const rows = checks.filter((c) => c.status !== 'info')
  if (rows.some((c) => c.status === 'fail')) return 'rejected'
  if (rows.every((c) => c.status === 'pass')) return 'approved'
  return 'needs_client'
}
