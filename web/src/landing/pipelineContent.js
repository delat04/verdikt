// One job on Verdikt, from the brief to the payout: the words beside each stage of the landing's
// pipeline section, and what the product window shows in its bar (`page`).

export const PIPELINE = [
  {
    name: 'Post', page: 'Jobs / Post a job',
    title: 'Describe the job. Get a fair price.',
    body: 'Write the brief in your own words. A price check reads live web prices for similar work and suggests a range, with the sources it used.',
  },
  {
    name: 'Hire', page: 'Jobs / Applications',
    title: 'Applications arrive already reviewed.',
    body: 'Each one is read against your brief and checked for paid work on Verdikt and for red flags, like asking to move off the platform. You compare people, not paragraphs.',
  },
  {
    name: 'Agree', page: 'Contract room',
    title: 'A mediator turns wishes into checks.',
    body: 'Talk it through in the contract room. The mediator keeps a versioned terms sheet and rewrites each wish so it can be tested. You both sign the same version.',
  },
  {
    name: 'Fund', page: 'Contract / Funding',
    title: 'Your agent funds it from your limit.',
    body: 'Approve one spending limit on PayPal and your agent can hold money for jobs inside it, with no PayPal step each time. It can’t raise the limit or approve a hold by itself.',
  },
  {
    name: 'Check', page: 'Contract / Delivery',
    title: 'The work is checked before anyone argues.',
    body: 'Sam’s coding agent runs the signed checks before it delivers. Once it’s in, probes in a real browser settle most checks, and Claude judges the rest from the evidence.',
  },
  {
    name: 'Paid', page: 'Ledger / Timeline',
    title: 'Paid, and you can see where every dollar is.',
    body: 'PayPal captures the hold and pays Sam, less a 2% fee. The timeline puts every milestone on one clock: what’s held, what’s paid, and when each hold lapses.',
  },
]

export const POST = {
  title: 'Loyalty card page for Northbrew',
  brief: 'A sign-up page for our coffee loyalty card. Customers enter their email and get a QR code; staff scan it to add a stamp, and the tenth stamp is a free coffee. It must work on phones.',
  sources: ['A similar listing: loyalty sign-up page, $520', 'A studio’s price page: small web builds from $700', 'A freelance rate card: about 10 hours at $55'],
}

export const APPLICANTS = [
  { name: 'Sam Okafor', meta: '11 paid jobs on Verdikt', fit: 92, flag: 'No red flags', tone: 'ok', price: '$600' },
  { name: 'Priya Nair', meta: '2 paid jobs on Verdikt', fit: 74, flag: 'Asks to talk off the platform', tone: 'danger', price: '$520' },
  { name: 'Leo Marsh', meta: 'New to Verdikt', fit: 58, flag: 'Price over your budget', tone: 'warn', price: '$900' },
]

export const ROOM = [
  { who: 'Maya', text: 'It has to work on phones, and customers should see their own QR code.' },
  { who: 'Mediator', text: 'Made both testable: the sign-up works at 375px wide, and the QR code encodes the customer’s email.' },
  { who: 'Sam', text: 'Agreed. $600, live in 7 days.' },
]
export const TERMS = [
  { text: 'The sign-up form accepts an email' },
  { text: 'Scanning a QR code on the staff page adds a stamp' },
  { text: 'The tenth stamp shows the free-coffee reward' },
  { text: 'Works at 375px wide with no sideways scroll', added: true },
  { text: 'The QR code encodes the customer’s email', added: true },
]

export const CHECKS = [
  { text: 'The sign-up form accepts an email', by: 'Probe' },
  { text: 'Works at 375px wide with no sideways scroll', by: 'Probe' },
  { text: 'The QR code encodes the customer’s email', by: 'Probe' },
  { text: 'Scanning on the staff page adds a stamp', by: 'Probe' },
  { text: 'The reward copy matches the brief', by: 'Claude' },
]
