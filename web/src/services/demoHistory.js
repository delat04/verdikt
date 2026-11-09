/*  ============================================================================
    Demo only — a year of sample past contracts for the dashboard, so its charts have a shape to show.
    Seeded, so every visitor sees the same history; relative to today, so it never looks stale. The
    person playing the demo is the client or the freelancer on every one, as their role says, and the
    other side is one of a few sample people. The dashboard labels these rows as sample history.
    ============================================================================ */

const DAY = 864e5

function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const CLIENTS = ['Harbor Bakery', 'Lena Park Ceramics', 'Dev Malik Physio', 'Northbrew Coffee', 'Fieldnote Press']
const FREELANCERS = ['Sam Okafor', 'Ines Duarte', 'Tom Becker', 'Aiko Mori']
const PROJECTS = [
  ['Bakery website', ['Menu and opening hours live', 'Online pre-orders working']],
  ['Ceramics shop', ['Catalogue and product pages', 'Cart and PayPal checkout', 'Order emails']],
  ['Physio booking page', ['Booking form live', 'Reminder emails']],
  ['Coffee subscription page', ['Landing page', 'Subscription checkout']],
  ['Press catalogue', ['Book pages with covers', 'Search and filters']],
  ['Event registration', ['Registration form', 'Confirmation emails and badges']],
  ['Portfolio refresh', ['New home page', 'Case study pages']],
]
const CHECKS = {
  functional: [
    'The live URL loads with no errors on desktop and mobile',
    'The form accepts a valid email and shows a confirmation',
    'A product can be added to the cart and the total updates',
    'Links to the site’s own pages work',
  ],
  visual: ['Above the fold shows the headline, call to action and logo', 'Nothing wider than the screen at 375px'],
  performance: ['Main content paints in under 2.5 s on mobile'],
  code: ['Repository has a README with setup steps', 'No secrets or .env files committed'],
  content: ['Every image has alt text', 'Prices match the agreed price list'],
}
const LAYERS = { functional: ['probe', 'probe', 'probe', 'model'], visual: ['model', 'model', 'ocr'], performance: ['probe'], code: ['probe', 'probe', 'model'], content: ['probe', 'model'] }

export function sampleHistory(me) {
  const r = rng(20261109)
  const pick = (list) => list[Math.floor(r() * list.length)]
  const iso = (t) => new Date(t).toISOString()
  const now = Date.now()
  const asClient = me.intent !== 'freelancer'
  const others = asClient ? FREELANCERS : CLIENTS
  const contracts = []
  let n = 0

  for (let k = 0; k < 12; k += 1) {
    const [title, steps] = PROJECTS[k % PROJECTS.length]
    const other = { id: `hist-p${k % others.length}`, name: others[k % others.length], email: '' }
    const start = now - (340 - k * 27 - Math.floor(r() * 10)) * DAY
    const c = {
      id: `hist-c${k}`, title: `${title}${k >= PROJECTS.length ? ' — phase 2' : ''}`, currency: 'USD', status: 'completed',
      client: asClient ? { id: me.id, name: me.name } : other, freelancer: asClient ? other : { id: me.id, name: me.name },
      createdAt: iso(start), milestones: [],
    }
    let t = start + 2 * DAY
    steps.forEach((step, i) => {
      n += 1
      const amountCents = Math.round((300 + r() * 2200) / 50) * 5000
      const fundedAt = t
      const dueAt = fundedAt + (7 + Math.floor(r() * 14)) * DAY
      const kinds = ['functional', pick(['visual', 'content']), pick(['performance', 'code', 'functional'])]
      if (r() > 0.5) kinds.push(pick(Object.keys(CHECKS)))
      const criteria = kinds.map((kind, j) => ({ id: `hist-cr${n}-${j}`, position: j + 1, kind, statement: CHECKS[kind][Math.floor(r() * CHECKS[kind].length)] }))
      const tries = r() < 0.58 ? 1 : r() < 0.8 ? 2 : 3
      const live = k === 11 && i === steps.length - 1   // the newest milestone is still held
      const refunded = k === 4 && i === 1
      const submissions = []
      let at = fundedAt + (4 + Math.floor(r() * 12)) * DAY
      for (let a = 1; a <= tries; a += 1) {
        const last = a === tries && !refunded
        const results = criteria.map((cr) => ({
          criterionId: cr.id,
          passed: last ? true : r() > 0.45,
          confidence: 0.95,
          layer: pick(LAYERS[cr.kind]),
        }))
        if (!last && results.every((x) => x.passed)) results[Math.floor(r() * results.length)].passed = false
        const outcome = results.every((x) => x.passed) ? 'pass' : 'fail'
        submissions.push({ id: `hist-s${n}-${a}`, attempt: a, createdAt: iso(at), verdict: { id: `hist-v${n}-${a}`, outcome, confidence: 0.95, createdAt: iso(at + 3600e3), results } })
        at += (1 + Math.floor(r() * 4)) * DAY
      }
      const releasedAt = Math.min(at, now - DAY)
      const status = live ? 'funded' : refunded ? 'refunded' : 'released'
      const fee = Math.round(amountCents * 0.02)
      c.milestones.push({
        id: `hist-m${n}`, position: i + 1, title: step, amountCents, status,
        dueAt: iso(dueAt), fundedAt: iso(fundedAt), authorizedAt: iso(fundedAt),
        reauthorizedAt: releasedAt - fundedAt > 29 * DAY ? iso(fundedAt + 27 * DAY) : null,
        releasedAt: live ? null : iso(releasedAt),
        releasedCents: status === 'released' ? amountCents : 0,
        voidedCents: refunded ? amountCents : 0,
        feeCents: status === 'released' ? fee : 0,
        payoutCents: status === 'released' ? amountCents - fee : 0,
        payoutStatus: status === 'released' ? 'SUCCESS' : null,
        paidOutAt: status === 'released' ? iso(releasedAt + 3600e3) : null,
        tranches: [],
        paypal: {
          authorizationId: `SAMPLE-AUTH-${n}`, captureId: status === 'released' ? `SAMPLE-CAP-${n}` : null,
          payoutBatchId: status === 'released' ? `SAMPLE-PAYOUT-${n}` : null,
        },
        criteria,
        submissions: live ? submissions.slice(0, 1) : submissions,
        expenses: [],
      })
      t = live ? t : releasedAt + DAY
    })
    if (c.milestones.some((m) => m.status === 'funded')) c.status = 'active'
    contracts.push(c)
  }
  return contracts
}
