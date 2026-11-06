<!--
  ActivityFeed — the ledger: every signature, PayPal event and agent decision, newest first.
  Time on the left, a dot on the line, then what happened (after the Workspace summary timeline).
-->
<script setup>
import { computed } from 'vue'
import { timeAgo, money } from '@/domain/format'

const props = defineProps({
  items: { type: Array, required: true },
  contract: { type: Object, default: null },
  limit: { type: Number, default: 0 },
  showContract: { type: Boolean, default: false },   // cross-contract feeds name the contract
})

// "· 5 by probes, 1 by Claude" — what decided the verdict, when the engine recorded it
const decidedBy = (p) => {
  const d = p.decided
  if (!d) return ''
  const parts = [(d.probe || 0) + (d.ocr || 0) && `${(d.probe || 0) + (d.ocr || 0)} by probes`, d.reused && `${d.reused} unchanged`, d.model && `${d.model} by Claude`].filter(Boolean)
  return parts.length ? ` · ${parts.join(', ')}` : ''
}
const LABEL = {
  'contract.created': () => 'Contract created',
  'job.hired': (p) => `Hired ${p.name || 'a freelancer'} from the job post — ${money(p.priceCents)}${p.days ? ` in ${p.days} days` : ''}`,
  'room.opened': () => 'Opened the contract room',
  'change.requested': (p) => `Asked for a change: “${p.request || ''}”`,
  'change.in_scope': () => 'Agent: already covered by the signed terms — no extra charge',
  'change.proposed': (p) => `Agent drafted a change order: ${p.title} · ${money(p.amountCents)}`,
  'change.countered': (p) => `Countered the change order at ${money(p.amountCents)}`,
  'change.accepted': (p) => `Change accepted — M${p.position} ${p.title} added (${money(p.amountCents)})`,
  'change.declined': () => 'Declined the change order',
  'escrow.check_released': (p) => `${money(p.amountCents)} released — ${p.passed} of ${p.total} checks passed`,
  'terms.release_mode': (p) => (p.mode === 'per_check' ? 'Chose to release money check by check — signatures reset' : 'Chose to release each milestone whole — signatures reset'),
  'room.terms_updated': (p) => `Mediator updated the terms to v${p.version}${p.changes?.length ? ` · ${p.changes[0]}` : ''}`,
  'room.accepted': (p) => `${p.viaAgent ? 'Agent accepted' : 'Accepted'} terms v${p.version}`,
  'room.agent_on': () => 'Handed the room to a negotiating agent',
  'room.agent_off': () => 'Took the room back from the agent',
  'room.agent_spoke': () => 'Negotiating agent made a proposal',
  'room.agent_handed_back': () => 'Negotiating agent handed the room back',
  'room.locked': (p) => `Both accepted v${p.version} — terms locked into ${p.milestones} milestone${p.milestones === 1 ? '' : 's'}`,
  'contract.joined': (p) => `${p.name || 'Counterparty'} joined`,
  'contract.active': () => 'Both parties signed — contract active',
  'contract.completed': () => 'Final milestone paid — contract complete',
  'terms.drafted': () => 'Agent drafted the acceptance criteria',
  'checks.compiled': (p) => `Checks compiled into ${p.probes} deterministic probe${p.probes === 1 ? '' : 's'}`,
  'checks.compile_failed': () => 'Checks compiled by rules (the agent was unavailable)',
  'terms.edited': (p) => `Checks edited on M${p.milestone} — signatures reset`,
  'terms.signed': () => 'Signed the terms',
  'escrow.order_created': () => 'PayPal order created',
  'escrow.funds_held': (p) => `${p.amountCents ? money(p.amountCents) : 'Funds'} held by PayPal`,
  'escrow.released': (p) => `${p.amountCents ? money(p.amountCents) : 'Funds'} released${p.by === 'client' ? ' by the client' : ''}`,
  'escrow.refunded': () => 'Hold voided — client refunded',
  'escrow.partially_released': (p) => `${money(p.amountCents)} of ${money(p.ofCents)} released — ${money(p.returnedCents)} returned to the client`,
  'escrow.hold_renewed': () => 'PayPal hold renewed — the funds stay guaranteed',
  'escrow.renew_failed': () => 'PayPal would not renew the hold yet',
  'terms.expense_budget': (p) => (p.budgetCents ? `Expense budget on M${p.milestone}: up to ${money(p.budgetCents)} for ${(p.covers || []).join(', ')} — signatures reset` : `Expense budget removed from M${p.milestone} — signatures reset`),
  'expense.claimed': (p) => `${p.viaAgent ? 'Agent claimed' : 'Claimed'} ${money(p.amountCents)} for ${p.merchant || 'an expense'}`,
  'expense.checked': (p) => ({
    approved: `Receipt passed every check${p.by === 'claude' ? ' (coverage read by Claude)' : ' — decided by rules, no model'}`,
    rejected: `Receipt for ${money(p.amountCents)} failed ${p.failed} check${p.failed === 1 ? '' : 's'} — not reimbursed`,
    needs_client: `The checks couldn't settle the ${money(p.amountCents)} receipt — the client decides`,
  }[p.outcome] || 'Receipt checked'),
  'expense.reimbursed': (p) => `${money(p.amountCents)} reimbursed for ${p.merchant || 'an expense'} — PayPal captured it from the hold${p.by === 'client' ? ' (approved by the client)' : ''}`,
  'expense.declined': (p) => `Declined the ${money(p.amountCents)} claim for ${p.merchant || 'an expense'}`,
  'expense.expired': (p) => `${p.count} expense claim${p.count === 1 ? '' : 's'} closed — the milestone settled first`,
  'expense.capture_failed': () => 'PayPal did not capture an approved expense — the client can retry',
  'payout.sent': (p) => `${money(p.amountCents)} sent to the freelancer's PayPal${p.expenseId ? ' (reimbursement, no fee)' : p.feeCents ? ` (fee ${money(p.feeCents)})` : ''}`,
  'payout.completed': (p) => `${money(p.amountCents)} landed in the freelancer's PayPal`,
  'payout.failed': (p) => `Payout didn't go through${p.status ? ` (${p.status.toLowerCase()})` : ''}`,
  'payout.needs_email': () => 'Payout waiting for the freelancer\'s PayPal email',
  'verify.tamper': () => 'The delivery tried to influence the verifier — auto-release stopped',
  'appeal.decided': (p) => (p.recommendation === 'uphold' ? 'Second review upheld the verdict' : `Second review: release ${money(p.releaseCents)}`),
  'appeal.accepted': (p) => `Second review accepted — ${money(p.releaseCents)} released`,
  'appeal.declined': () => 'Second review declined — funds stay held',
  'appeal.error': () => 'The second review could not finish — funds stay held',
  'dispute.opened': () => 'PayPal dispute opened by the buyer',
  'dispute.answered': () => 'Agent answered the PayPal dispute with the evidence',
  'dispute.needs_review': () => 'Agent recommends accepting the PayPal dispute — needs a person',
  'dispute.error': () => 'The dispute answer could not be sent to PayPal',
  'work.submitted': (p) => `Work delivered · attempt ${p.attempt}`,
  'verify.started': () => 'Agent started checking',
  'verify.passed': (p) => `All ${p.total} checks passed${decidedBy(p)}`,
  'verify.failed': (p) => (p.tampered ? 'Verdict failed on integrity — funds held' : `${p.failed} of ${p.total} checks failed — funds held${decidedBy(p)}`),
  'verdict.appealed': () => 'Verdict appealed — funds stay held for review',
  'verify.error': () => 'The check could not finish — funds stay held',
  'escrow.capture_failed': () => 'PayPal capture failed — the client can release by hand',
  'terms.draft_failed': () => 'Agent was unavailable — standard checks were used',
}

const WHO = { client: 'Client', freelancer: 'Freelancer', agent: 'Agent', paypal: 'PayPal', system: 'Verdikt' }
// the dot says who acted; green only when money moved
const TONE = {
  'escrow.released': 'ok', 'escrow.partially_released': 'ok', 'payout.completed': 'ok', 'verify.passed': 'ok', 'expense.reimbursed': 'ok',
  'expense.capture_failed': 'danger',
  'verify.failed': 'danger', 'verify.tamper': 'danger', 'payout.failed': 'danger', 'dispute.opened': 'danger', 'escrow.refunded': 'neutral',
}

const rows = computed(() => {
  const list = props.limit ? props.items.slice(0, props.limit) : props.items
  return list.map((a) => {
    const c = props.contract || a._c
    const m = c?.milestones.find((x) => x.id === a.milestoneId)
    const who = a.actor === 'client' ? c?.client?.name : a.actor === 'freelancer' ? c?.freelancer?.name : null
    return {
      ...a,
      text: (LABEL[a.event] || (() => a.event))(a.payload || {}),
      who: who || WHO[a.actor] || a.actor,
      tag: m ? `M${m.position}` : '',
      where: props.showContract ? c?.title : '',
      tone: TONE[a.event] || a.actor,
    }
  })
})
</script>

<template>
  <ol class="feed">
    <li v-for="a in rows" :key="a.id" class="feed__row">
      <span class="feed__time vk-num">{{ timeAgo(a.createdAt).replace(' ago', '') }}</span>
      <span class="feed__dot" :data-tone="a.tone" aria-hidden="true" />
      <div class="feed__text">
        <p>{{ a.text }}</p>
        <p class="feed__meta">
          <span>{{ a.who }}</span>
          <span v-if="a.tag" class="vk-num">{{ a.tag }}</span>
          <span v-if="a.where" class="feed__where">{{ a.where }}</span>
        </p>
      </div>
    </li>
  </ol>
</template>

<style scoped>
.feed { margin: 0; padding: 0; list-style: none; }
.feed__row { position: relative; display: grid; grid-template-columns: 52px 10px minmax(0, 1fr); gap: 12px; padding-bottom: 18px; }
.feed__row:not(:last-child)::after { content: ''; position: absolute; left: 68px; top: 16px; bottom: 2px; width: 1px; background: var(--vk-line); }
.feed__time { padding-top: 3px; font: var(--vk-num-11); color: var(--vk-faint); text-align: right; white-space: nowrap; }
.feed__dot { width: 10px; height: 10px; margin-top: 5px; border-radius: 50%; box-sizing: border-box; border: 2px solid var(--vk-line-strong); background: var(--vk-surface); }
.feed__dot[data-tone='agent'] { border-color: var(--vk-warn); }
.feed__dot[data-tone='paypal'] { border-color: var(--vk-accent); }
.feed__dot[data-tone='ok'] { border-color: var(--vk-ok); background: var(--vk-ok); }
.feed__dot[data-tone='danger'] { border-color: var(--vk-danger); }
.feed__text { min-width: 0; }
.feed__text p { margin: 0; font: var(--vk-type-dense); color: var(--vk-ink-2); }
.feed__meta { display: flex; gap: 8px; margin-top: 3px !important; font: var(--vk-type-small) !important; color: var(--vk-faint) !important; min-width: 0; }
.feed__meta > span { flex: none; white-space: nowrap; }
.feed__meta > .feed__where { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
</style>
