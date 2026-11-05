/*  ============================================================================
    Demo mediator — a rule-based stand-in for the Claude mediator (server/src/agent/mediator.js)
    so the contract room works without keys. It reads the newest message, keeps the terms sheet
    current and answers the way the real one is told to: testable wording for vague words, a
    concrete trade when money and scope don't meet, and the question that blocks agreement.
    ============================================================================ */

export const emptyTerms = () => ({ version: 0, summary: '', scope: [], out_of_scope: [], milestones: [], questions: [] })
export const blankState = () => ({ features: [], excluded: [], total: 0, days: 0, parts: 1, quality: [], pending: null, priceBy: null, splitOffered: false })

const FEATURES = [
  { key: 'menu', early: true, test: /\bmenu\b|price list/i, name: 'Menu with items and prices', short: 'a menu', done: 'The menu page lists every item from the agreed menu with its price' },
  { key: 'hours', early: true, test: /opening hours|\bhours\b|\baddress\b|\blocation\b/i, name: 'Opening hours and location', short: 'hours and location', done: 'Opening hours and the address are visible on the home page at 375px' },
  { key: 'gallery', early: true, test: /gallery|\bphotos?\b|portfolio/i, name: 'Photo gallery', short: 'a gallery', done: 'The gallery shows the agreed photos and each one opens larger on tap' },
  { key: 'blog', early: true, test: /\bblog\b|\bnews\b|articles?/i, name: 'Blog', short: 'a blog', done: 'The blog index lists posts and each post opens on its own URL' },
  { key: 'payments', test: /card payments?|checkout|pay online|online payments?|\bstripe\b|\bcart\b/i, name: 'Card payments at checkout', short: 'card payments', done: 'A sandbox card payment completes and the confirmation shows the paid total' },
  { key: 'orders', test: /pre-?orders?|ordering|order (?:\w+ )?(?:online|for pickup)|\bpickup\b|order (?:a |the )?cakes?/i, name: 'Order requests for pickup', short: 'pickup orders', done: 'A test order with name, items and pickup time shows a confirmation with the order total' },
  { key: 'booking', test: /\bbook(?:ing|ings)?\b|reserv|appointment/i, name: 'Bookings', short: 'bookings', done: 'A test booking for tomorrow shows a confirmation with the chosen time' },
  { key: 'form', test: /contact form|request form|\bform\b|enquir|inquir/i, name: 'Contact form', short: 'a contact form', done: 'Submitting the form shows a confirmation, and empty required fields show an error' },
  { key: 'newsletter', test: /newsletter|mailing list|subscribe/i, name: 'Newsletter signup', short: 'a newsletter signup', done: 'The newsletter form accepts a valid email and shows a confirmation' },
  { key: 'login', test: /log ?in|sign ?in|\baccounts?\b|dashboard/i, name: 'Accounts and sign-in', short: 'accounts', done: 'A new user can sign up, sign in and reach their account page' },
]
const byKey = (k) => FEATURES.find((f) => f.key === k)

const VAGUE = [
  { word: 'modern', test: /\b(modern|clean|sleek|beautiful|nice-looking|professional)\b/i, label: 'Make "modern" testable', text: 'By modern I mean: same header and type on every page, and no horizontal scrolling at 375px or 1440px.', done: 'Every page shares the same header and type, with no horizontal scrolling at 375px or 1440px' },
  { word: 'fast', test: /\b(fast|quick to load|speed|performance)\b/i, label: 'Make "fast" testable', text: "Let's define fast as: the main content shows in under 2.5 s on a mid-range phone.", done: 'Largest Contentful Paint under 2.5 s on a mid-range mobile profile' },
  { word: 'easy to use', test: /user[- ]friendly|easy to use|intuitive/i, label: 'Make "easy" testable', text: 'Easy to use means every main action is reachable within two taps on a 375px screen.', done: 'Every main action is reachable within two taps at 375px' },
  { word: 'mobile', test: /\b(responsive|mobile|phones?)\b/i, label: 'Pin down "mobile"', text: 'Working on phones means no horizontal scrolling and body text of at least 16px at 375px.', done: 'No horizontal scrolling and body text of at least 16px at 375px' },
]

const EXCLUDE = /\bleave\b[^.]*\bout\b|out of scope|\bnot now\b|\blater\b|\bskip\b|\bdrop\b|\bwithout\b|\bno need\b|\bdon'?t need\b|\bremove\b/i
const ADDON = /\banother\b|\bextra\b|\badditional\b|\bon top\b|\bplus\b|\bmore\b/i
const AGREE = /\b(works for me|agreed|deal|sounds good|fine by me|happy with|let'?s do|go with|ok(?:ay)?|yes)\b/i
const NUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12 }
const usd = (cents) => `$${(cents / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}`
const list = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`)
const lower = (s) => s.charAt(0).toLowerCase() + s.slice(1)

const clauses = (text) => text.split(/[.;!?]+(?!\d)|,(?!\d)|\bbut\b/i).map((s) => s.trim()).filter(Boolean)
function amounts(text) {
  const out = []
  for (const m of text.matchAll(/\$\s?(\d[\d,]*(?:\.\d+)?)\s*(k\b)?|(\d[\d,]*)\s*(?:dollars|usd)\b/gi)) {
    const n = parseFloat((m[1] || m[3]).replace(/,/g, '')) * (m[2] ? 1000 : 1)
    if (n >= 1) out.push(Math.round(n * 100))
  }
  return out
}
function daysIn(text) {
  const m = text.match(/\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten|twelve)\s*(day|week|month)s?\b/i)
  if (!m) return 0
  return (NUM[m[1].toLowerCase()] ?? Number(m[1])) * { day: 1, week: 7, month: 30 }[m[2].toLowerCase()]
}
function partsIn(text) {
  const m = text.match(/\b(two|three|2|3)\s+(?:payments|milestones|parts|stages|instal+ments)\b|\bsplit (?:it |this )?in(?:to)? (two|three|2|3)\b/i)
  return m ? NUM[(m[1] || m[2]).toLowerCase()] ?? Number(m[1] || m[2]) : 0
}

// ---- the sheet, rebuilt from what has been agreed so far
const PLAN = {
  1: { titles: ['Site live'], shares: [1], due: [1] },
  2: { titles: ['Design and first pages', 'Features and launch'], shares: [0.4, 0.6], due: [0.45, 1] },
  3: { titles: ['Design and first pages', 'Core features', 'Launch'], shares: [0.3, 0.4, 0.3], due: [0.3, 0.7, 1] },
}
const PAD = ['The pages load at 1440px and 375px with no console errors', 'The site is live on the production domain over HTTPS']

function build(s, names) {
  const inc = s.features.map(byKey)
  const milestones = []
  if (s.total) {
    const plan = PLAN[Math.min(Math.max(s.parts, 1), 3)]
    const n = plan.titles.length
    const early = inc.filter((f) => f.early)
    const late = inc.filter((f) => !f.early)
    let left = s.total
    plan.titles.forEach((title, i) => {
      const amount = i === n - 1 ? left : Math.round((s.total * plan.shares[i]) / 1000) * 1000
      left -= amount
      const feats = n === 1 ? inc : i === 0 ? early : i === 1 ? late : []
      const done = feats.map((f) => f.done)
      if (i === 0) done.push(PAD[0])
      if (i === n - 1) done.push(...s.quality, PAD[1])
      for (const p of PAD) if (done.length < 2 && !done.includes(p)) done.push(p)
      milestones.push({ title, amount_cents: amount, due_days: Math.round((s.days || 0) * plan.due[i]), done_means: [...new Set(done)].slice(0, 5) })
    })
  }
  const what = inc.length ? list(inc.map((f) => f.short)) : 'the site'
  const summary = s.total
    ? `${names.client || 'The client'}'s site with ${what} for ${usd(s.total)}${s.days ? `, live in ${s.days} days` : ''}.${s.excluded.length ? ` ${list(s.excluded.map((k) => byKey(k).name))} ${s.excluded.length > 1 ? 'are' : 'is'} left out for now.` : ''}`
    : inc.length ? `A site with ${what}. Budget and dates still to agree.` : ''
  return { summary, scope: inc.map((f) => f.name), out_of_scope: s.excluded.map((k) => byKey(k).name), milestones }
}

const comparable = (t) => JSON.stringify({ ...t, version: undefined, questions: undefined })

/**
 * One mediator pass. Reads room.messages and room.demo (mutated), returns the new terms
 * (version bumped when they changed) and what to say. Same shape as the server's update_room.
 */
export function mediateDemo(room, { names, joined }) {
  const s = room.demo
  const N = (r) => names[r] || (r === 'client' ? 'the client' : 'the freelancer')
  const other = (r) => (r === 'client' ? 'freelancer' : 'client')
  const lastAny = room.messages[room.messages.length - 1]
  const last = [...room.messages].reverse().find((m) => m.author === 'client' || m.author === 'freelancer')
  const isJoin = lastAny?.author === 'system' && /joined/.test(lastAny.body)
  const isOpening = room.messages.filter((m) => m.author === 'client' || m.author === 'freelancer').length === 1 && !isJoin
  const changes = []
  const say = []
  const suggestions = []
  let vague = []
  let fresh = null // a proposal that arrived in this message

  const include = (f) => {
    if (!f || s.features.includes(f.key)) return
    s.features.push(f.key)
    s.excluded = s.excluded.filter((k) => k !== f.key)
    changes.push(`Scope: + ${lower(f.name)}`)
  }
  const exclude = (f) => {
    if (s.excluded.includes(f.key)) return
    s.features = s.features.filter((k) => k !== f.key)
    s.excluded.push(f.key)
    changes.push(`${f.name} → out of scope`)
  }

  if (last && !isJoin) {
    const author = last.author
    const text = last.body
    const usedSuggestion = VAGUE.find((v) => text.includes(v.text.slice(0, 36)))
    if (usedSuggestion && !s.quality.includes(usedSuggestion.done)) {
      s.quality.push(usedSuggestion.done)
      changes.push(`Check added: "${usedSuggestion.word}" made testable`)
    }
    if (!usedSuggestion) vague = VAGUE.filter((v) => v.test.test(text) && !s.quality.includes(v.done))

    for (const cl of usedSuggestion ? [] : clauses(text)) {
      const feats = FEATURES.filter((f) => f.test.test(cl))
      const amts = amounts(cl)
      if (EXCLUDE.test(cl)) {
        feats.forEach(exclude)
        if (s.pending?.kind === 'addon' && feats.some((f) => f.key === s.pending.feature)) s.pending = null
        continue
      }
      if (amts.length && ADDON.test(cl)) {
        const f = feats.find((x) => !s.features.includes(x.key)) || feats[0] || (s.pending?.kind === 'addon' ? byKey(s.pending.feature) : null)
        if (!f) continue
        if (s.pending?.kind === 'addon' && s.pending.feature === f.key && s.pending.by !== author) {
          include(f); s.total += s.pending.amount; changes.push(`Total: + ${usd(s.pending.amount)} for ${lower(f.name)}`); s.pending = null
        } else if (!s.features.includes(f.key)) {
          s.pending = fresh = { kind: 'addon', feature: f.key, amount: amts[0], by: author }
        }
        continue
      }
      feats.forEach(include)
      if (amts.length) {
        const a = amts[0]
        if (s.pending?.kind === 'price' && s.pending.amount === a && s.pending.by !== author) {
          changes.push(`Total: ${usd(s.total)} → ${usd(a)}`); s.total = a; s.priceBy = author; s.pending = null
        } else if (!s.total || s.priceBy === author) {
          if (a !== s.total) { changes.push(s.total ? `Total: ${usd(s.total)} → ${usd(a)}` : `Total: ${usd(a)}`); s.total = a; s.priceBy = author }
        } else if (a !== s.total) {
          s.pending = fresh = { kind: 'price', amount: a, by: author }
        }
      }
    }

    // a plain "yes / works for me" settles whatever the other side proposed
    if (AGREE.test(text) && s.pending && s.pending.by !== author && !fresh) {
      const p = s.pending
      if (p.kind === 'price') { changes.push(`Total: ${usd(s.total)} → ${usd(p.amount)}`); s.total = p.amount; s.priceBy = author }
      if (p.kind === 'addon') { include(byKey(p.feature)); s.total += p.amount; changes.push(`Total: + ${usd(p.amount)}`) }
      s.pending = null
    }
    const d = daysIn(text)
    if (d && d !== s.days) { changes.push(s.days ? `Due: ${s.days} → ${d} days` : `Due: ${d} days`); s.days = d }
    const p = partsIn(text)
    if (p && p !== s.parts) { s.parts = p; changes.push(`Split into ${p} payments`) }

    // ---- what to say
    if (isOpening) say.push(`Thanks ${N(author)}, I've started the terms from your note.`)
    else if (changes.length) say.push(`Updated the sheet: ${changes.slice(0, 2).map(lower).join('; ')}.`)
    if (fresh?.kind === 'addon') {
      const f = byKey(fresh.feature)
      say.push(`The gap is ${lower(f.name)}, not the site. ${N(other(author))}, a fair trade: keep ${usd(s.total)} and leave it for a later contract, or add it for ${usd(fresh.amount)} more.`)
      suggestions.push(
        { label: 'Leave it out for now', text: `Let's leave ${lower(f.name)} out for now and keep ${usd(s.total)}.`, for: other(author) },
        { label: `Add it for ${usd(fresh.amount)}`, text: `Let's add ${lower(f.name)} for ${usd(fresh.amount)} more.`, for: other(author) },
      )
    }
    if (fresh?.kind === 'price') {
      const mid = Math.round((s.total + fresh.amount) / 2 / 5000) * 5000
      say.push(`${N(author)} proposes ${usd(fresh.amount)}; the sheet says ${usd(s.total)}. ${N(other(author))}, you can agree, meet at ${usd(mid)}, or trim the scope to fit.`)
      suggestions.push(
        { label: `Agree to ${usd(fresh.amount)}`, text: `${usd(fresh.amount)} works for me.`, for: other(author) },
        { label: `Meet at ${usd(mid)}`, text: `Could we meet at ${usd(mid)}?`, for: other(author) },
      )
    }
    if (vague.length) {
      say.push(`"${vague[0].word}" can't be checked as written, so I've suggested a testable version.`)
      for (const v of vague.slice(0, 2)) suggestions.push({ label: v.label, text: v.text, for: author })
    }
    if (!fresh && !vague.length && joined.client && joined.freelancer && s.total && AGREE.test(text)) {
      say.push('You look aligned. If the sheet reads right, accept it — when you both accept the same version, the terms lock.')
    }
  }

  if (isJoin) {
    const who = /^(\S+)/.exec(lastAny.body)?.[1] || 'there'
    say.push(`Welcome ${who}. So far: ${build(s, names).summary || 'the client has described the project.'}`)
    if (s.total) {
      say.push(`Does ${usd(s.total)}${s.days ? ` in ${s.days} days` : ''} work for this scope?`)
      suggestions.push({ label: 'Price and dates work', text: `The scope, ${usd(s.total)}${s.days ? ` and ${s.days} days` : ''} work for me.`, for: 'freelancer' })
    } else say.push('What would you charge for this scope, and how long would it take?')
  }

  if (s.parts === 1 && s.total >= 80000 && !s.splitOffered && suggestions.length < 3) {
    suggestions.push({ label: 'Split into two payments', text: 'Can we split this into two payments: first pages, then the rest at launch?', for: 'client' })
    s.splitOffered = true
  }

  // ---- the sheet
  const next = { ...build(s, names), version: room.terms.version }
  const changed = comparable(next) !== comparable(room.terms)
  if (changed) next.version = room.terms.version + 1
  const q = []
  if (!joined.freelancer) q.push({ text: 'Invite the freelancer so they can confirm scope, price and dates.', for: 'client' })
  if (!joined.client) q.push({ text: 'Invite the client so they can confirm scope, budget and dates.', for: 'freelancer' })
  if (s.pending?.kind === 'addon') q.push({ text: `Add ${lower(byKey(s.pending.feature).name)} for ${usd(s.pending.amount)} more, or leave it out?`, for: other(s.pending.by) })
  if (s.pending?.kind === 'price') q.push({ text: `Does ${usd(s.pending.amount)} work instead of ${usd(s.total)}?`, for: other(s.pending.by) })
  if (!s.features.length) q.push({ text: 'What must the site do — which pages and features?', for: 'client' })
  if (!s.total) q.push({ text: 'What is the budget?', for: 'client' })
  if (!s.days) q.push({ text: 'When does it need to be live?', for: 'client' })
  next.questions = q.slice(0, 2)
  if (!say.length && changed && next.questions[0]) say.push(`Open: ${next.questions[0].text}`)

  return { reply: say.join(' '), suggestions: suggestions.slice(0, 3), changes: changed ? changes.slice(0, 6) : [], terms: next }
}
