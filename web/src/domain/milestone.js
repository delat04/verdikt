/*  ============================================================================
    The milestone journey — one place that knows what a status means and what
    each party should do next. Every screen asks this module instead of
    re-deriving it, so the UI always tells both sides the same story.
    ============================================================================ */

import { money, firstName } from './format'

export const STATUS = {
  draft:            { label: 'Not started',      tone: 'neutral' },
  awaiting_funding: { label: 'Awaiting funding', tone: 'neutral' },
  funded:           { label: 'Held in escrow',   tone: 'accent' },
  submitted:        { label: 'Submitted',        tone: 'accent' },
  verifying:        { label: 'Verifying',        tone: 'warn', live: true },
  passed:           { label: 'Passed',           tone: 'ok' },
  failed:           { label: 'Held — not yet',   tone: 'danger' },
  released:         { label: 'Released',         tone: 'ok' },
  refunded:         { label: 'Refunded',         tone: 'neutral' },
  disputed:         { label: 'In review',        tone: 'warn' },
}

export const CONTRACT_STATUS = {
  scoping:     { label: 'Contract room',  tone: 'accent' },
  drafting:    { label: 'Drafting terms', tone: 'warn', live: true },
  negotiating: { label: 'Signing terms',  tone: 'accent' },
  active:      { label: 'Active',         tone: 'accent' },
  completed:   { label: 'Completed',      tone: 'ok' },
  cancelled:   { label: 'Cancelled',      tone: 'neutral' },
}

export const KIND = {
  visual:      { label: 'Visual' },
  functional:  { label: 'Functional' },
  code:        { label: 'Code' },
  performance: { label: 'Performance' },
  content:     { label: 'Content' },
}

/* Where a milestone stands among the LANE stops (Held · Delivered · Verified · Paid) */
export function trackState(status) {
  // returns { index, mode } — mode: progress | ok | blocked | waiting
  switch (status) {
    case 'funded': return { index: 0, mode: 'progress' }
    case 'submitted': return { index: 1, mode: 'progress' }
    case 'verifying': return { index: 2, mode: 'waiting' }
    case 'passed': return { index: 3, mode: 'waiting' }
    case 'failed': return { index: 2, mode: 'blocked' }
    case 'disputed': return { index: 2, mode: 'waiting' }
    case 'released': return { index: 3, mode: 'ok' }
    default: return { index: -1, mode: 'progress' }
  }
}

export const HELD = ['funded', 'submitted', 'verifying', 'passed', 'failed', 'disputed']

/* Where the live milestone stands on the rail's lane: Held 0 · Delivered 33 · Verified 66 · Paid 100.
   While verifying, the needle travels from 33 to 66 as each check finishes. */
export const LANE = ['Held', 'Delivered', 'Verified', 'Paid']
export const STAGE = {
  draft:            { at: 0,  label: 'Fund to start',  tone: 'neutral' },
  awaiting_funding: { at: 0,  label: 'Fund to start',  tone: 'neutral' },
  funded:           { at: 16, label: 'Held · building', tone: 'accent' },
  submitted:        { at: 33, label: 'Delivered',      tone: 'accent' },
  verifying:        { at: 33, to: 66, label: 'Verifying', tone: 'warn', live: true },
  failed:           { at: 66, label: 'Not yet',        tone: 'danger' },
  disputed:         { at: 66, label: 'In review',      tone: 'warn' },
  passed:           { at: 88, label: 'Releasing',      tone: 'ok', live: true },
}

/* each check's state while the agent verifies; the '@' entry carries the stage and what decided each check */
export const checkStates = (progress) => Object.entries(progress || {}).filter(([k]) => k !== '@').map(([, v]) => v)

/* lane position (0–100) for a milestone, moving with the agent's progress while it verifies */
export function stageAt(m) {
  const s = STAGE[m?.status]
  if (!s) return 0
  if (!s.to || !m.progress) return s.at
  const states = checkStates(m.progress)
  const done = states.filter((x) => x === 'pass' || x === 'fail').length
  return s.at + (s.to - s.at) * (done / Math.max(1, states.length))
}

export function roleOf(contract, userId) {
  if (!contract || !userId) return null
  if (contract.client?.id === userId) return 'client'
  if (contract.freelancer?.id === userId) return 'freelancer'
  return null
}

export function counterparty(contract, role) {
  return role === 'client' ? contract.freelancer : contract.client
}

export function currentMilestone(contract) {
  const ms = contract?.milestones || []
  return ms.find((m) => !['released', 'refunded'].includes(m.status)) || null
}

export function termsSigned(contract) {
  return !!(contract.clientSignedAt && contract.freelancerSignedAt)
}

export function contractTotals(contract) {
  const ms = contract?.milestones || []
  const sum = (list) => list.reduce((s, m) => s + m.amountCents, 0)
  return {
    total: sum(ms),
    // check by check, part of a held milestone may already be released: held is what's left
    // …plus what's left of its expense budget, which sits in the same PayPal hold
    held: ms.filter((m) => HELD.includes(m.status)).reduce((s, m) => s + m.amountCents - (m.releasedCents || 0) + (m.expenseBudgetCents || 0)
      - (m.expenses || []).filter((e) => e.captureId).reduce((t, e) => t + e.amountCents, 0), 0),
    // a partial release counts what was actually captured, not the milestone amount
    released: ms.reduce((s, m) => s + (m.status === 'released' ? (m.releasedCents ?? m.amountCents) : (m.releasedCents || 0)), 0),
    releasedCount: ms.filter((m) => m.status === 'released').length,
  }
}

export function latestSubmission(m) {
  return m?.submissions?.length ? m.submissions[m.submissions.length - 1] : null
}

export function latestAppeal(m) {
  return m?.appeals?.length ? m.appeals[m.appeals.length - 1] : null
}

/* The life of a PayPal hold: honored 3 days, valid up to 29, renewed once by Verdikt after the honor period */
export function holdHealth(m, now = Date.now()) {
  if (!m?.authorizedAt || !HELD.includes(m.status)) return null
  const start = new Date(m.authorizedAt).getTime()
  const end = m.holdExpiresAt ? new Date(m.holdExpiresAt).getTime() : start + 29 * 864e5
  const daysLeft = Math.max(0, Math.ceil((end - now) / 864e5))
  return {
    daysLeft,
    pct: Math.min(100, Math.max(0, ((now - start) / (end - start)) * 100)),
    expiresAt: new Date(end).toISOString(),
    renewedAt: m.reauthorizedAt || null,
    renewsAt: m.reauthorizedAt ? null : new Date(start + 3 * 864e5).toISOString(),
  }
}

/* What the freelancer actually received for a released milestone */
export const PAYOUT = {
  SUCCESS: { label: 'Paid out', tone: 'ok' },
  PENDING: { label: 'Sending', tone: 'accent', live: true },
  PROCESSING: { label: 'Sending', tone: 'accent', live: true },
  NEEDS_EMAIL: { label: 'Needs a PayPal email', tone: 'warn' },
  UNCLAIMED: { label: 'Unclaimed', tone: 'warn' },
  FAILED: { label: 'Payout failed', tone: 'danger' },
  RETURNED: { label: 'Returned', tone: 'danger' },
  BLOCKED: { label: 'Blocked', tone: 'danger' },
  DENIED: { label: 'Denied', tone: 'danger' },
}

/**
 * What should `role` do next on this contract?
 * → { key, tone, eyebrow, short, title, sub, action, actor, milestoneId }
 *   short:  a two-to-four word label for tight places (the queue capsule, ⌘K)
 *   action: a verb the view maps to a button ('sign' | 'fund' | 'submit' | 'resubmit' | 'invite' | 'review' | null)
 *   actor:  'you' | 'them' | 'agent' | 'none' — who the contract is waiting on
 */
export function nextStep(contract, role) {
  const step = baseStep(contract, role)
  // an expense claim the checks couldn't settle waits on the client — asked only when nothing bigger is
  if (role !== 'client' || !step || step.actor === 'you') return step
  const ms = contract.milestones.find((x) => x.expenses?.some((e) => e.status === 'needs_client'))
  const e = ms?.expenses.find((x) => x.status === 'needs_client')
  if (!e) return step
  const other = counterparty(contract, role)
  return {
    key: 'expense', tone: 'accent', eyebrow: `M${ms.position} · Expenses`, actor: 'you', action: 'expenses', milestoneId: ms.id,
    short: `Decide a ${money(e.amountCents, contract.currency)} expense`,
    title: `${other ? firstName(other.name) : 'The freelancer'} claimed ${money(e.amountCents, contract.currency)} the checks couldn't settle`,
    sub: `${e.merchant || 'A receipt'}${e.purpose ? ` — ${e.purpose}` : ''}. Look at the receipt and reimburse or decline it; it's within the expense budget you agreed.`,
  }
}

function baseStep(contract, role) {
  if (!contract) return null
  const other = counterparty(contract, role)
  const otherName = other ? firstName(other.name) : role === 'client' ? 'the freelancer' : 'the client'
  const m = currentMilestone(contract)
  const mLabel = m ? `M${m.position} · ${m.title}` : ''
  const amount = m ? money(m.amountCents, contract.currency) : ''
  const whole = m ? money(m.amountCents, contract.currency, { whole: true }) : ''
  // the client funds the work and its expense budget in one hold
  const hold = m ? money(m.amountCents + (m.expenseBudgetCents || 0), contract.currency) : ''
  const holdWhole = m ? money(m.amountCents + (m.expenseBudgetCents || 0), contract.currency, { whole: true }) : ''
  const mTag = m ? `M${m.position}` : ''

  if (contract.status === 'cancelled') {
    return { key: 'cancelled', tone: 'neutral', eyebrow: 'Closed', short: 'Cancelled', title: 'This contract was cancelled', sub: 'No money is held.', actor: 'none' }
  }
  if (contract.status === 'scoping') {
    const r = contract.room || {}
    const v = r.terms?.version || 0
    const mine = role === 'client' ? r.clientV : r.freelancerV
    const theirs = role === 'client' ? r.freelancerV : r.clientV
    const room = { eyebrow: 'Contract room', milestoneId: null }
    if (!other) {
      return { ...room, key: 'room-invite', tone: 'accent', actor: 'you', action: 'invite',
        short: `Invite your ${role === 'client' ? 'freelancer' : 'client'}`,
        title: `Invite ${role === 'client' ? 'your freelancer' : 'your client'} to the room`,
        sub: 'Shape the terms together. The mediator keeps the sheet current as you talk.' }
    }
    if (r.mandate?.active && mine !== v) {
      return { ...room, key: 'room-my-agent', tone: 'accent', actor: 'agent', short: 'Your agent is negotiating',
        title: 'Your agent is negotiating for you', sub: 'It stays within your private limits and accepts only terms that fit.' }
    }
    if (r.busy) {
      return { ...room, key: 'room-agent', tone: 'warn', actor: 'agent', short: 'Mediator updating',
        title: 'The mediator is updating the terms', sub: 'It rereads the conversation and keeps the sheet current.' }
    }
    if (!r.terms?.milestones?.length) {
      return { ...room, key: 'room-shape', tone: 'accent', actor: 'you', action: 'room', short: 'Shape the terms',
        title: 'Agree scope, price and dates', sub: 'Talk it through — the terms sheet fills in as you agree.' }
    }
    if (mine === v) {
      return { ...room, key: 'room-wait', tone: 'neutral', actor: 'them', short: `${otherName} to accept v${v}`,
        title: `Waiting for ${otherName} to accept version ${v}`, sub: 'When you both accept the same version, the terms lock and the checks are drafted.' }
    }
    return theirs === v
      ? { ...room, key: 'room-accept', tone: 'accent', actor: 'you', action: 'room', short: `Accept v${v} to lock`,
          title: `${otherName} accepted version ${v}`, sub: 'Accept it too and the terms lock into milestones.' }
      : { ...room, key: 'room-review', tone: 'accent', actor: 'you', action: 'room', short: `Review terms v${v}`,
          title: `Terms version ${v} is ready`, sub: 'Accept it, or say what should change.' }
  }
  if (contract.status === 'drafting') {
    return {
      key: 'drafting', tone: 'warn', eyebrow: 'Agent at work', actor: 'agent', short: 'Drafting terms',
      title: 'Turning the brief into checkable terms',
      sub: 'Each milestone gets acceptance criteria the agent can test. Takes a few seconds.',
    }
  }
  if (!other) {
    return {
      key: 'invite', tone: 'accent', eyebrow: 'Step 1 · Invite', actor: 'you', action: 'invite',
      short: `Invite your ${role === 'client' ? 'freelancer' : 'client'}`,
      title: `Invite ${role === 'client' ? 'your freelancer' : 'your client'}`,
      sub: 'Share the invite code. They review the same terms before anyone signs.',
    }
  }
  if (!termsSigned(contract)) {
    const mine = role === 'client' ? contract.clientSignedAt : contract.freelancerSignedAt
    return mine
      ? { key: 'terms-wait', tone: 'neutral', eyebrow: 'Terms', actor: 'them', short: `${otherName} to sign`,
          title: `Waiting for ${otherName} to sign the terms`, sub: 'You signed. Nothing is charged until terms are signed by both.' }
      : { key: 'terms', tone: 'accent', eyebrow: 'Step 2 · Terms', actor: 'you', action: 'sign', short: 'Sign the terms',
          title: 'Review and sign the acceptance criteria',
          sub: 'These are the exact checks the agent will run. Edit anything unclear before you sign.' }
  }
  if (!m) {
    return { key: 'done', tone: 'ok', eyebrow: 'Complete', actor: 'none', short: 'Paid in full', title: 'Every milestone is paid',
      sub: `${money(contractTotals(contract).released, contract.currency)} released through PayPal.` }
  }

  switch (m.status) {
    case 'draft':
    case 'awaiting_funding':
      return role === 'client'
        ? { key: 'fund', tone: 'accent', eyebrow: mLabel, actor: 'you', action: 'fund', milestoneId: m.id, short: `Fund ${holdWhole}`,
            title: `Fund ${hold} into escrow`, sub: `PayPal holds it. You are charged only when the work passes the checks you signed${m.expenseBudgetCents ? ', and for expenses only against receipts' : ''}.` }
        : { key: 'fund-wait', tone: 'neutral', eyebrow: mLabel, actor: 'them', milestoneId: m.id, short: `${otherName} to fund ${mTag}`,
            title: `Waiting for ${otherName} to fund ${amount}`, sub: 'Start once the money is held — it shows here the moment it is.' }
    case 'funded':
      return role === 'freelancer'
        ? { key: 'submit', tone: 'accent', eyebrow: mLabel, actor: 'you', action: 'submit', milestoneId: m.id, short: `Deliver ${mTag}`,
            title: 'Deliver the work', sub: `${amount} is held for you. Submit the live URL and repo when it meets the criteria.` }
        : { key: 'submit-wait', tone: 'neutral', eyebrow: mLabel, actor: 'them', milestoneId: m.id, short: `${otherName} delivering ${mTag}`,
            title: `${amount} held — waiting for delivery`, sub: `${otherName} has been notified that the money is in escrow.` }
    case 'submitted':
    case 'verifying':
      return { key: 'verifying', tone: 'warn', eyebrow: mLabel, actor: 'agent', action: 'review', milestoneId: m.id, short: `Checking ${mTag}`,
        title: 'The agent is checking the delivery', sub: 'Opening the site, testing each criterion and reading the code.' }
    case 'passed':
      return { key: 'releasing', tone: 'ok', eyebrow: mLabel, actor: 'agent', milestoneId: m.id, short: `Releasing ${mTag}`,
        title: 'Every check passed — releasing funds', sub: 'PayPal is capturing the held payment.' }
    case 'failed': {
      // text aimed at the verifier is its own kind of "not yet": nothing else is worth fixing until it's gone
      if (latestSubmission(m)?.verdict?.integrity) {
        return role === 'freelancer'
          ? { key: 'resubmit', tone: 'danger', eyebrow: mLabel, actor: 'you', action: 'resubmit', milestoneId: m.id, short: `Fix ${mTag}`,
              title: 'Remove the text aimed at the verifier, then resubmit', sub: 'The delivery contains a note written to influence the agent, so nothing is released automatically. The report quotes it.' }
          : { key: 'held', tone: 'danger', eyebrow: mLabel, actor: 'them', action: 'review', milestoneId: m.id, short: `${mTag} held · flagged`,
              title: `${amount} stays held — the delivery tried to influence the verifier`, sub: `The agent found a hidden note asking it to pass every check. ${otherName} has to remove it and resubmit.` }
      }
      return role === 'freelancer'
        ? { key: 'resubmit', tone: 'danger', eyebrow: mLabel, actor: 'you', action: 'resubmit', milestoneId: m.id, short: `Fix ${mTag}`,
            title: 'Not yet — fix what failed and resubmit', sub: 'The report shows exactly which checks failed and why. The money stays held for you.' }
        : { key: 'held', tone: 'danger', eyebrow: mLabel, actor: 'them', action: 'review', milestoneId: m.id, short: `${mTag} held · not yet`,
            title: `${amount} stays held — the work isn't there yet`, sub: `${otherName} sees the same report and can fix and resubmit.` }
    }
    case 'disputed': {
      const a = latestAppeal(m)
      if (a?.status === 'decided' && ['release', 'partial'].includes(a.recommendation)) {
        const amt = money(a.releaseCents, contract.currency)
        return role === 'client'
          ? { key: 'appeal-decided', tone: 'accent', eyebrow: mLabel, actor: 'you', action: 'review', milestoneId: m.id, short: `Review ${mTag} appeal`,
              title: a.recommendation === 'release' ? `Second review: release ${amt}` : `Second review: release ${amt} of ${amount}`,
              sub: 'An independent second review re-checked the failed checks. Release what it recommends, or keep the money held.' }
          : { key: 'appeal-wait', tone: 'neutral', eyebrow: mLabel, actor: 'them', action: 'review', milestoneId: m.id, short: `${otherName} to decide`,
              title: `Waiting for ${otherName} to accept the second review`, sub: `It recommends releasing ${amt}. The money stays held until ${otherName} decides.` }
      }
      return { key: 'appeal', tone: 'warn', eyebrow: mLabel, actor: 'agent', action: 'review', milestoneId: m.id, short: `${mTag} second review`,
        title: 'A second reviewer is re-checking the failed checks', sub: 'It reads the evidence again, independently, with the appeal in hand. Funds stay held until it decides.' }
    }
    default:
      return null
  }
}
