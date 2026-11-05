<!--
  Contract workspace — a split page. What stays on screen (the head):
  1. The title, who it's with, and the money in three numbers (tightens once you scroll)
  2. The escrow rail — every milestone on one line; it's how you move between milestones, so it never leaves
  Then two columns that scroll on their own:
  main — Next step (cobalt when it's your move), then the milestone: its stops, and tabs that stick
         while you read checks (terms), delivery (the verdict report) or payment (PayPal receipts)
  side — the parties and their signatures, the full ledger
  `?act=fund|sign|submit|…` (from the queue, ⌘K or Home) opens that action as soon as it applies.
-->
<script setup>
import { ref, computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { PenLine, Wallet, FileWarning, Undo2, Scale, Check, X, ArrowLeft, Clock3, RefreshCw, Settings, CalendarClock } from 'lucide-vue-next'
import VSegmented from '@/components/ui/VSegmented.vue'
import AppShell from '@/layouts/AppShell.vue'
import VButton from '@/components/ui/VButton.vue'
import VCard from '@/components/ui/VCard.vue'
import VTabs from '@/components/ui/VTabs.vue'
import VModal from '@/components/ui/VModal.vue'
import VAvatar from '@/components/ui/VAvatar.vue'
import VCopy from '@/components/ui/VCopy.vue'
import VPill from '@/components/ui/VPill.vue'
import VEmptyState from '@/components/ui/VEmptyState.vue'
import StatusPill from '@/components/StatusPill.vue'
import NextStepCard from '@/components/NextStepCard.vue'
import EscrowRail from '@/components/EscrowRail.vue'
import StageTrack from '@/components/StageTrack.vue'
import CriteriaEditor from '@/components/CriteriaEditor.vue'
import VerdictReport from '@/components/VerdictReport.vue'
import SubmitWork from '@/components/SubmitWork.vue'
import FundModal from '@/components/FundModal.vue'
import ActivityFeed from '@/components/ActivityFeed.vue'
import { ACTION } from '@/components/actionMeta'
import { useLive } from '@/composables/useLive'
import { useSplitScroll } from '@/composables/useSplitScroll'
import { useAuthStore } from '@/stores/auth'
import { api, isDemo } from '@/services'
import { toast } from '@/composables/useToast'
import { money, dueLabel, shortDate, timeAgo, firstName, toCents, split, FEE_PERCENT } from '@/domain/format'
import {
  nextStep, roleOf, counterparty, currentMilestone, contractTotals, termsSigned, latestSubmission, latestAppeal, holdHealth, PAYOUT,
} from '@/domain/milestone'

const props = defineProps({ id: { type: String, required: true } })
const auth = useAuthStore()
const route = useRoute()
const router = useRouter()

const { data: contract, loading, error } = useLive(() => api.getContract(props.id), { watch: () => props.id })

const role = computed(() => roleOf(contract.value, auth.user?.id))
const other = computed(() => contract.value && counterparty(contract.value, role.value))
const step = computed(() => contract.value && nextStep(contract.value, role.value))
const totals = computed(() => contract.value ? contractTotals(contract.value) : { total: 0, held: 0, released: 0 })
const signed = computed(() => contract.value && termsSigned(contract.value))
const current = computed(() => contract.value && currentMilestone(contract.value))
const drafting = computed(() => contract.value?.status === 'drafting')

// ---- the split page: fixed head, columns that scroll on their own
const { root, scrolled, condensed, reveal } = useSplitScroll()
const msCard = ref(null)

// ---- selected milestone + tab
const selectedId = ref(null)
watch(contract, (c) => {
  if (!c) return
  if (!selectedId.value || !c.milestones.some((m) => m.id === selectedId.value)) {
    selectedId.value = (currentMilestone(c) || c.milestones[c.milestones.length - 1]).id
  }
}, { immediate: true })
const ms = computed(() => contract.value?.milestones.find((m) => m.id === selectedId.value))
const isFinal = computed(() => ms.value && contract.value.milestones.length > 1 && ms.value.position === contract.value.milestones.length)
const sub = computed(() => latestSubmission(ms.value))
const previousAttempts = computed(() => (ms.value?.submissions || []).slice(0, -1).reverse())

const tab = ref('checks')
function suggestedTab(m) {
  if (!m || !signed.value) return 'checks'
  if (m.submissions.length || ['funded', 'failed', 'submitted', 'verifying', 'disputed'].includes(m.status)) return 'delivery'
  if (m.status === 'released' || m.status === 'refunded') return 'delivery'
  return 'checks'
}
watch(selectedId, (id, prev) => {
  tab.value = suggestedTab(ms.value)
  // picking another milestone on the rail brings its card back into view if you'd scrolled past it
  if (prev) setTimeout(() => reveal(msCard.value?.$el), 30)
})
watch(() => ms.value?.status, (s, prev) => {
  if (prev && s !== prev && ['submitted', 'verifying', 'funded', 'released', 'failed'].includes(s)) tab.value = suggestedTab(ms.value)
})
watch(signed, (s, was) => { if (s && !was) tab.value = suggestedTab(ms.value) })
const tabs = computed(() => [
  { value: 'checks', label: 'Checks', count: ms.value?.criteria.length || null },
  { value: 'delivery', label: 'Delivery', count: ms.value?.submissions.length || null },
  { value: 'payment', label: 'Payment' },
])

// ---- actions
const modal = ref('')            // invite | sign | fund | release | refund | appeal
const busy = ref('')
const appealReason = ref('')
const deliveryEl = ref(null)

async function run(key, fn, success) {
  busy.value = key
  try {
    await fn()
    if (success) toast(success.text, { tone: success.tone || 'info' })
    modal.value = ''
  } catch (e) {
    toast(e.message, { tone: 'danger' })
  } finally {
    busy.value = ''
  }
}

function act(action) {
  if (action === 'invite') modal.value = 'invite'
  else if (action === 'sign') { selectedId.value = current.value?.id || selectedId.value; modal.value = 'sign' }
  else if (action === 'fund') { selectedId.value = step.value.milestoneId; modal.value = 'fund' }
  else if (action === 'submit' || action === 'resubmit' || action === 'review') {
    selectedId.value = step.value.milestoneId
    tab.value = 'delivery'
    // land below the sticky tabs, not under them
    setTimeout(() => reveal(deliveryEl.value, { force: true, offset: 72 }), 80)
  }
}

// arriving with ?act=… (the queue, ⌘K, Home's "Up next"): open that action once it applies, then drop the query
watch([step, () => route.query.act], ([s, want]) => {
  if (!s || !want) return
  if (s.action === want) act(want)
  router.replace({ query: { ...route.query, act: undefined } })
}, { immediate: true })

const saveCriteria = (list) => run('criteria', () => api.updateCriteria(ms.value.id, list), { text: 'Checks saved — both of you sign again' })
const sign = () => run('sign', () => api.signTerms(contract.value.id), { text: 'Terms signed' })
const refund = () => run('refund', () => api.refund(ms.value.id), { text: 'Hold voided — you were not charged' })
const appeal = () => run('appeal', () => api.appeal(ms.value.id, appealReason.value), { text: 'Appeal filed — a second review starts now' })

// ---- releasing: all of it, or part (the rest of the hold goes back to the client)
const verdictNow = computed(() => sub.value?.verdict)
const met = computed(() => verdictNow.value?.results.filter((r) => r.passed).length ?? 0)
const suggestedCents = computed(() => (ms.value && verdictNow.value?.results.length
  ? Math.max(100, Math.round((ms.value.amountCents * met.value) / verdictNow.value.results.length)) : ms.value?.amountCents || 0))
const releaseMode = ref('full')
const releaseInput = ref('')
const releaseCents = computed(() => (releaseMode.value === 'full' ? ms.value?.amountCents || 0 : toCents(releaseInput.value)))
const releaseValid = computed(() => releaseCents.value >= 100 && releaseCents.value <= (ms.value?.amountCents || 0))
function openRelease() {
  releaseMode.value = 'full'
  releaseInput.value = (suggestedCents.value / 100).toFixed(2)
  modal.value = 'release'
}
const release = () => run('release', () => api.release(ms.value.id, releaseMode.value === 'part' ? { amountCents: releaseCents.value } : {}),
  { text: `${money(releaseCents.value, contract.value.currency)} released`, tone: 'ok' })

// ---- the second review, payouts, PayPal disputes
const appealNow = computed(() => latestAppeal(ms.value))
const appealOpen = computed(() => appealNow.value?.status === 'decided' && ms.value?.status === 'disputed' && ['release', 'partial'].includes(appealNow.value.recommendation))
const acceptAppeal = () => run('appeal-accept', () => api.acceptAppeal(appealNow.value.id), { text: `${money(appealNow.value.releaseCents, contract.value.currency)} released`, tone: 'ok' })
const declineAppeal = () => run('appeal-decline', () => api.declineAppeal(appealNow.value.id), { text: 'Kept held — the verdict stands' })
const criterionText = (id) => ms.value?.criteria.find((c) => c.id === id)?.statement || 'A signed check'

const hold = computed(() => holdHealth(ms.value))
const payoutMeta = computed(() => PAYOUT[ms.value?.payoutStatus] || null)
const retryPayout = () => run('payout', () => api.retryPayout(ms.value.id), { text: 'Payout sent again' })
const disputes = computed(() => ms.value?.disputes || [])
const checkDisputes = () => run('disputes', async () => {
  const r = isDemo ? await api.simulateDispute(contract.value.id) : await api.syncDisputes()
  if (!isDemo && !r.added) toast('No new PayPal disputes on this account')
}, isDemo ? { text: 'A buyer dispute was opened in the PayPal sandbox' } : null)
const DISPUTE_REASON = {
  MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED: 'Not as described',
  MERCHANDISE_OR_SERVICE_NOT_RECEIVED: 'Not received',
  UNAUTHORISED: 'Unauthorized payment',
  CREDIT_NOT_PROCESSED: 'Credit not processed',
  DUPLICATE_TRANSACTION: 'Duplicate charge',
  INCORRECT_AMOUNT: 'Incorrect amount',
  CANCELED_RECURRING_BILLING: 'Canceled billing',
  PAYMENT_BY_OTHER_MEANS: 'Paid another way',
  PROBLEM_WITH_REMITTANCE: 'Problem with remittance',
  OTHER: 'Other',
}
const DISPUTE_STATE = {
  new: { label: 'Received', tone: 'neutral' },
  drafting: { label: 'Agent drafting', tone: 'warn', live: true },
  submitted: { label: 'Answered with evidence', tone: 'ok' },
  needs_review: { label: 'Needs a person', tone: 'warn' },
  error: { label: 'Not sent', tone: 'danger' },
}

const inviteLink = computed(() => contract.value ? `${window.location.origin}/join/${contract.value.inviteCode}` : '')
const criteriaCount = computed(() => contract.value?.milestones.reduce((s, m) => s + m.criteria.length, 0) || 0)
const mySignature = computed(() => contract.value && (role.value === 'client' ? contract.value.clientSignedAt : contract.value.freelancerSignedAt))
const canEditTerms = computed(() => !!contract.value && !signed.value && !drafting.value && !!role.value)
const canSubmit = computed(() => role.value === 'freelancer' && ms.value && current.value?.id === ms.value.id && ['funded', 'failed'].includes(ms.value.status))
</script>

<template>
  <AppShell back="/contracts">
    <template #crumbs>
      <RouterLink to="/contracts">Contracts</RouterLink>
      <span class="vk-faint">/</span>
      <span class="crumb">{{ contract?.title || '…' }}</span>
    </template>

    <!-- loading / errors -->
    <div v-if="loading && !contract" class="vk-page">
      <div class="vk-skel" style="height: 40px; width: 50%" />
      <div class="vk-skel" style="height: 140px; margin-top: 24px; border-radius: var(--vk-r-lg)" />
      <div class="vk-skel" style="height: 360px; margin-top: 24px; border-radius: var(--vk-r-lg)" />
    </div>
    <div v-else-if="error && !contract" class="vk-page vk-page--narrow">
      <VCard>
        <VEmptyState :icon="FileWarning" title="You're not on this contract" :sub="`${error}. If you switched accounts, this contract belongs to someone else.`">
          <VButton :icon="ArrowLeft" variant="secondary" to="/contracts">Back to contracts</VButton>
        </VEmptyState>
      </VCard>
    </div>

    <div v-else-if="contract" ref="root" class="vk-split" :class="{ 'is-scrolled': scrolled, 'is-condensed': condensed }">
      <header class="vk-split__head">
      <!-- 1 · title, people, money -->
      <div class="head">
        <div class="head__main">
          <div class="head__meta">
            <StatusPill :status="contract.status" contract />
            <span class="vk-faint">You're the {{ role }}<template v-if="other"> · with {{ other.name }}</template></span>
          </div>
          <h1 class="head__title">{{ contract.title }}</h1>
        </div>
        <div class="vk-stats head__stats">
          <div class="vk-stat"><span class="vk-stat__n">{{ money(totals.total, contract.currency, { whole: true }) }}</span><span class="vk-stat__l">total</span></div>
          <div class="vk-stat">
            <span class="vk-stat__n">{{ money(totals.released, contract.currency, { whole: true }) }}</span><span class="vk-stat__l">paid</span>
            <span v-if="totals.releasedCount" class="vk-stat__d vk-stat__d--ok">{{ totals.releasedCount }}/{{ contract.milestones.length }}</span>
          </div>
          <div class="vk-stat"><span class="vk-stat__n">{{ money(totals.held, contract.currency, { whole: true }) }}</span><span class="vk-stat__l">held</span></div>
        </div>
      </div>

      <!-- 2 · the rail — the way between milestones, so it stays -->
      <EscrowRail v-model="selectedId" :milestones="contract.milestones" :currency="contract.currency" :signed="!!signed" :drafting="drafting" />
      </header>

      <div class="vk-split__cols">
        <div class="vk-split__col ws__main">
          <!-- 3 · next step -->
          <NextStepCard v-if="step" :step="step" :you="auth.name" :them="other?.name" class="vk-rise">
            <VButton
              v-if="step.action && ACTION[step.action]"
              :icon="ACTION[step.action].icon"
              :variant="step.actor === 'you' ? 'primary' : 'secondary'"
              size="lg"
              @click="act(step.action)"
            >{{ ACTION[step.action].label }}</VButton>
            <VButton v-if="step.key === 'invite' && criteriaCount" variant="secondary" size="lg" @click="tab = 'checks'">Review checks</VButton>
          </NextStepCard>

          <!-- 4 · the milestone -->
          <VCard v-if="ms" ref="msCard" size="lg" class="ms">
            <template #head>
              <div class="ms__head">
                <div class="ms__titles">
                  <p class="vk-eyebrow">{{ isFinal ? 'Final milestone' : `Milestone ${ms.position}` }}<template v-if="ms.dueAt"> · {{ dueLabel(ms.dueAt) }}</template></p>
                  <h2 class="ms__title">{{ ms.title }}</h2>
                  <p v-if="ms.description" class="ms__desc">{{ ms.description }}</p>
                </div>
                <div class="ms__right">
                  <p class="ms__amount vk-num">{{ money(ms.amountCents, contract.currency) }}</p>
                  <StatusPill v-if="signed || ms.status !== 'draft'" :status="ms.status" />
                  <VPill v-else size="md" outline>{{ drafting ? 'Drafting checks' : 'Awaiting signatures' }}</VPill>
                </div>
              </div>
            </template>

            <StageTrack v-if="signed && !['draft', 'awaiting_funding'].includes(ms.status)" :milestone="ms" class="ms__track" />

            <VTabs v-model="tab" :options="tabs" label="Milestone sections" class="ms__tabs" />

            <!-- checks -->
            <div v-if="tab === 'checks'" class="panel">
              <div v-if="drafting" class="drafting">
                <p class="drafting__line"><span class="vk-spin" /> Reading the brief and drafting checks the agent can actually test…</p>
                <div v-for="i in 4" :key="i" class="vk-skel" :style="{ height: '18px', width: `${90 - i * 12}%`, marginTop: '14px' }" />
              </div>
              <template v-else>
                <p class="panel__intro">
                  {{ signed ? `Signed by both parties. The agent checks exactly these ${ms.criteria.length} things — nothing more.` : 'These are the exact checks the agent will run on the delivery. Edit anything that isn\'t right, then sign.' }}
                </p>
                <CriteriaEditor :criteria="ms.criteria" :editable="canEditTerms" :saving="busy === 'criteria'" @save="saveCriteria" />
              </template>
            </div>

            <!-- delivery -->
            <div v-else-if="tab === 'delivery'" ref="deliveryEl" class="panel">
              <template v-if="sub">
                <!-- paid: what was released, and what reached the freelancer -->
                <VCard v-if="ms.status === 'released'" variant="pill" tone="ok" class="paid">
                  <div class="paid__row">
                    <p class="paid__text">
                      <b class="vk-num">{{ money(ms.releasedCents || ms.amountCents, contract.currency) }}</b>
                      <template v-if="ms.releasedCents && ms.releasedCents < ms.amountCents"> of {{ money(ms.amountCents, contract.currency) }}</template>
                      released · {{ shortDate(ms.releasedAt) }}
                      <template v-if="ms.voidedCents"> · <span class="vk-num">{{ money(ms.voidedCents, contract.currency) }}</span> returned to {{ firstName(contract.client?.name || 'the client') }}</template>
                    </p>
                    <VCopy v-if="ms.paypal?.captureId" :value="ms.paypal.captureId" label="Copy PayPal capture id" />
                  </div>
                  <div v-if="payoutMeta" class="paid__payout">
                    <VPill :tone="payoutMeta.tone" :live="!!payoutMeta.live" size="sm">{{ payoutMeta.label }}</VPill>
                    <span v-if="ms.payoutStatus === 'NEEDS_EMAIL'" class="paid__line">
                      {{ role === 'freelancer' ? `Add your PayPal email to receive ${money(ms.payoutCents, contract.currency)}.` : `Waiting for ${firstName(other?.name || 'the freelancer')} to add a PayPal email.` }}
                    </span>
                    <span v-else class="paid__line">
                      <span class="vk-num">{{ money(ms.payoutCents, contract.currency) }}</span> to {{ ms.payoutEmail }}
                      <template v-if="ms.feeCents"> · Verdikt fee <span class="vk-num">{{ money(ms.feeCents, contract.currency) }}</span></template>
                    </span>
                    <VButton v-if="ms.payoutStatus === 'NEEDS_EMAIL' && role === 'freelancer'" size="sm" variant="secondary" :icon="Settings" to="/settings">Add PayPal email</VButton>
                    <VButton v-if="['NEEDS_EMAIL', 'FAILED', 'UNCLAIMED', 'RETURNED', 'BLOCKED', 'DENIED'].includes(ms.payoutStatus)" size="sm" variant="ghost" :icon="RefreshCw" :loading="busy === 'payout'" @click="retryPayout">Try the payout again</VButton>
                  </div>
                </VCard>

                <!-- PayPal disputes on this payment, answered by the agent -->
                <section v-for="d in disputes" :key="d.id" class="vk-card vk-card--pill dispute" :class="`vk-card--tone-${{ submitted: 'ok', error: 'danger' }[d.state] || 'warn'}`">
                  <div class="dispute__body">
                    <div class="dispute__head">
                      <p class="dispute__title">PayPal dispute · {{ DISPUTE_REASON[d.reason] || d.reason || 'Opened by the buyer' }}</p>
                      <VPill :tone="(DISPUTE_STATE[d.state] || {}).tone" :live="!!(DISPUTE_STATE[d.state] || {}).live" size="sm">{{ (DISPUTE_STATE[d.state] || {}).label || d.state }}</VPill>
                    </div>
                    <p class="dispute__meta vk-faint">
                      <span class="vk-num">{{ d.paypalDisputeId }}</span><template v-if="d.amountCents"> · <span class="vk-num">{{ money(d.amountCents, contract.currency) }}</span></template> · opened {{ timeAgo(d.createdAt) }}
                      <template v-if="d.trace?.length"> · read with PayPal MCP <span class="vk-num">{{ [...new Set(d.trace.map((t) => t.tool))].join(', ') }}</span></template>
                    </p>
                    <p v-if="d.state === 'drafting'" class="dispute__text"><span class="vk-spin" /> The agent is reading the dispute and matching it against the signed checks and the evidence.</p>
                    <template v-else-if="d.response">
                      <ul v-if="d.keyPoints?.length" class="dispute__points">
                        <li v-for="k in d.keyPoints" :key="k">{{ k }}</li>
                      </ul>
                      <details class="dispute__answer">
                        <summary>{{ d.stance === 'contest' ? 'The answer sent to PayPal' : 'The agent\'s recommendation' }}</summary>
                        <p>{{ d.response }}</p>
                      </details>
                    </template>
                    <p v-if="d.error" class="vk-field__error">{{ d.error }}</p>
                  </div>
                </section>

                <!-- the second review of an appeal -->
                <section v-if="appealNow" class="review" :class="`is-${appealNow.status}`">
                  <div class="review__head">
                    <p class="review__title"><Scale :size="16" :stroke-width="1.9" /> Second review</p>
                    <VPill v-if="appealNow.status === 'reviewing'" tone="warn" live size="sm">Re-checking</VPill>
                    <VPill v-else-if="appealNow.status === 'error'" tone="danger" size="sm">Couldn't finish</VPill>
                    <VPill v-else-if="appealNow.recommendation === 'uphold'" tone="danger" size="sm">Verdict upheld</VPill>
                    <VPill v-else :tone="appealNow.status === 'declined' ? 'neutral' : 'ok'" size="sm">
                      {{ appealNow.status === 'accepted' ? 'Released' : appealNow.status === 'declined' ? 'Kept held' : appealNow.recommendation === 'release' ? 'Release in full' : 'Partial release' }}
                    </VPill>
                  </div>
                  <p class="review__appeal">Appeal by {{ appealNow.filedBy === role ? 'you' : firstName(other?.name || `the ${appealNow.filedBy}`) }}: “{{ appealNow.reason }}”</p>
                  <p v-if="appealNow.status === 'reviewing'" class="review__text"><span class="vk-spin" /> An independent reviewer is re-reading the evidence for each failed check, with the appeal in hand.</p>
                  <template v-else>
                    <ul v-if="appealNow.findings?.length" class="review__findings">
                      <li v-for="f in appealNow.findings" :key="f.criterion_id" :class="f.decision === 'overturn' ? 'is-overturn' : 'is-uphold'">
                        <span class="review__icon"><Check v-if="f.decision === 'overturn'" :size="12" :stroke-width="2.6" /><X v-else :size="12" :stroke-width="2.6" /></span>
                        <div>
                          <p class="review__check">{{ criterionText(f.criterion_id) }}</p>
                          <p class="review__why"><b>{{ f.decision === 'overturn' ? 'Met on a second look.' : 'Still not met.' }}</b> {{ f.explanation }}</p>
                        </div>
                      </li>
                    </ul>
                    <p class="review__text">{{ appealNow.summary }}</p>
                    <div v-if="appealOpen && role === 'client'" class="review__actions">
                      <VButton variant="ok" :icon="Check" :loading="busy === 'appeal-accept'" @click="acceptAppeal">Release {{ money(appealNow.releaseCents, contract.currency) }}</VButton>
                      <VButton variant="secondary" :loading="busy === 'appeal-decline'" @click="declineAppeal">Keep it held</VButton>
                    </div>
                    <p v-else-if="appealOpen" class="review__text vk-faint">Waiting for {{ firstName(other?.name || 'the client') }} to release {{ money(appealNow.releaseCents, contract.currency) }} or keep it held.</p>
                  </template>
                </section>

                <VerdictReport :criteria="ms.criteria" :submission="sub" :progress="ms.progress" />

                <!-- held: what each side can do -->
                <div v-if="ms.status === 'failed'" class="held">
                  <template v-if="role === 'client'">
                    <p class="held__text">{{ firstName(other?.name || 'The freelancer') }} sees this report and can fix and resubmit. You can also decide yourself: release all of it or the share that's met, or void the hold.</p>
                    <div class="held__actions">
                      <VButton variant="secondary" :icon="Check" @click="openRelease">Release payment…</VButton>
                      <VButton variant="danger" :icon="Undo2" @click="modal = 'refund'">Void hold & refund</VButton>
                    </div>
                  </template>
                  <template v-else-if="role === 'freelancer' && !verdictNow?.integrity">
                    <p class="held__text">Disagree with a check? An appeal sends the failed checks to an independent second review. The money stays held meanwhile.</p>
                    <div class="held__actions"><VButton variant="ghost" :icon="Scale" @click="modal = 'appeal'">Appeal the verdict</VButton></div>
                  </template>
                </div>
              </template>

              <div v-if="canSubmit" class="deliver">
                <h3 class="deliver__title">{{ sub ? 'Fix and resubmit' : 'Deliver the work' }}</h3>
                <p class="deliver__sub">{{ money(ms.amountCents, contract.currency) }} is held for you. The agent runs the {{ ms.criteria.length }} signed checks as soon as you submit.</p>
                <SubmitWork :milestone="ms" :previous="sub" />
              </div>

              <VEmptyState
                v-else-if="!sub"
                :icon="Clock3"
                title="Nothing delivered yet"
                :sub="ms.status === 'funded' ? `${money(ms.amountCents, contract.currency)} is held. ${role === 'client' ? 'The verdict appears here the moment work is submitted.' : ''}` : 'Delivery opens once this milestone is funded.'"
              />

              <details v-if="previousAttempts.length" class="attempts">
                <summary>{{ previousAttempts.length }} earlier attempt{{ previousAttempts.length > 1 ? 's' : '' }}</summary>
                <div v-for="s in previousAttempts" :key="s.id" class="attempts__item">
                  <VerdictReport :criteria="ms.criteria" :submission="s" />
                </div>
              </details>
            </div>

            <!-- payment -->
            <div v-else class="panel">
              <p class="panel__intro">
                {{ ms.status === 'released' ? 'Captured by PayPal and paid to the freelancer.' : ['funded', 'submitted', 'verifying', 'passed', 'failed', 'disputed'].includes(ms.status) ? 'Authorized and held by PayPal. Captured only when the checks pass or the client releases it.' : ms.status === 'refunded' ? 'The hold was voided. The client was never charged.' : 'Not funded yet.' }}
              </p>
              <!-- the hold's life: honored 3 days, renewed once, valid up to 29 -->
              <div v-if="hold" class="hold">
                <div class="hold__top">
                  <span class="hold__label"><CalendarClock :size="15" :stroke-width="1.9" /> Hold guaranteed for <b class="vk-num">{{ hold.daysLeft }}</b> more day{{ hold.daysLeft === 1 ? '' : 's' }}</span>
                  <span class="vk-faint hold__until">until {{ shortDate(hold.expiresAt) }}</span>
                </div>
                <div class="hold__bar" role="img" :aria-label="`${Math.round(hold.pct)}% of the hold's life used`"><span :style="{ width: `${hold.pct}%` }" /></div>
                <p class="hold__note vk-faint">{{ hold.renewedAt ? `Renewed with PayPal on ${shortDate(hold.renewedAt)}.` : `Verdikt renews it with PayPal automatically after ${shortDate(hold.renewsAt)}, when the 3-day honor period ends.` }}</p>
              </div>

              <dl class="vk-kv pay">
                <div class="vk-kv__row"><dt class="vk-kv__k">Amount</dt><dd class="vk-kv__v">{{ money(ms.amountCents, contract.currency) }}</dd></div>
                <div class="vk-kv__row"><dt class="vk-kv__k">Status</dt><dd class="vk-kv__v"><StatusPill :status="ms.status" size="sm" /></dd></div>
                <div v-if="ms.fundedAt" class="vk-kv__row"><dt class="vk-kv__k">Held since</dt><dd class="vk-kv__v">{{ shortDate(ms.fundedAt) }} · {{ timeAgo(ms.fundedAt) }}</dd></div>
                <div v-if="ms.releasedAt" class="vk-kv__row"><dt class="vk-kv__k">Released</dt><dd class="vk-kv__v">{{ money(ms.releasedCents || ms.amountCents, contract.currency) }} · {{ shortDate(ms.releasedAt) }}</dd></div>
                <div v-if="ms.voidedCents" class="vk-kv__row"><dt class="vk-kv__k">Returned to the client</dt><dd class="vk-kv__v">{{ money(ms.voidedCents, contract.currency) }}</dd></div>
                <div v-if="ms.status === 'released' && ms.feeCents != null" class="vk-kv__row"><dt class="vk-kv__k">Verdikt fee ({{ FEE_PERCENT }}%)</dt><dd class="vk-kv__v">{{ money(ms.feeCents, contract.currency) }}</dd></div>
                <div v-if="ms.status === 'released' && ms.payoutCents != null" class="vk-kv__row">
                  <dt class="vk-kv__k">Paid to the freelancer</dt>
                  <dd class="vk-kv__v">{{ money(ms.payoutCents, contract.currency) }}<template v-if="payoutMeta"> · {{ payoutMeta.label.toLowerCase() }}</template></dd>
                </div>
                <div v-if="ms.payoutEmail" class="vk-kv__row"><dt class="vk-kv__k">Payout to</dt><dd class="vk-kv__v">{{ ms.payoutEmail }}</dd></div>
                <div v-if="ms.paypal?.orderId" class="vk-kv__row"><dt class="vk-kv__k">PayPal order</dt><dd class="vk-kv__v"><VCopy :value="ms.paypal.orderId" /></dd></div>
                <div v-if="ms.paypal?.authorizationId" class="vk-kv__row"><dt class="vk-kv__k">Authorization</dt><dd class="vk-kv__v"><VCopy :value="ms.paypal.authorizationId" /></dd></div>
                <div v-if="ms.paypal?.captureId" class="vk-kv__row"><dt class="vk-kv__k">Capture</dt><dd class="vk-kv__v"><VCopy :value="ms.paypal.captureId" /></dd></div>
                <div v-if="ms.paypal?.payoutBatchId" class="vk-kv__row"><dt class="vk-kv__k">Payout batch</dt><dd class="vk-kv__v"><VCopy :value="ms.paypal.payoutBatchId" /></dd></div>
                <div v-if="ms.paypal?.payoutItemId" class="vk-kv__row"><dt class="vk-kv__k">Payout item</dt><dd class="vk-kv__v"><VCopy :value="ms.paypal.payoutItemId" /></dd></div>
              </dl>
              <div v-if="role === 'client' && current?.id === ms.id && ['awaiting_funding', 'draft'].includes(ms.status) && signed" class="pay__cta">
                <VButton :icon="Wallet" @click="modal = 'fund'">Fund {{ money(ms.amountCents, contract.currency) }} with PayPal</VButton>
              </div>
              <div v-if="ms.status === 'released'" class="pay__disputes">
                <p class="vk-faint">If the buyer opens a PayPal dispute on this payment, the agent answers it with the signed checks and the evidence.</p>
                <VButton size="sm" variant="secondary" :icon="RefreshCw" :loading="busy === 'disputes'" @click="checkDisputes">{{ isDemo ? 'Simulate a buyer dispute' : 'Check PayPal for disputes' }}</VButton>
              </div>
            </div>
          </VCard>
        </div>

        <!-- side -->
        <aside class="vk-split__col ws__side">
          <VCard title="Parties">
            <ul class="parties">
              <li v-for="p in [{ key: 'client', person: contract.client, at: contract.clientSignedAt }, { key: 'freelancer', person: contract.freelancer, at: contract.freelancerSignedAt }]" :key="p.key">
                <VAvatar :name="p.person?.name || '?'" />
                <div class="parties__who">
                  <span class="parties__name">{{ p.person?.name || 'Not joined yet' }}<span v-if="p.person?.id === auth.user?.id" class="vk-faint"> (you)</span></span>
                  <span class="parties__role">{{ p.key === 'client' ? 'Client · funds' : 'Freelancer · delivers' }}</span>
                </div>
                <VPill v-if="p.at" tone="ok" size="sm">Signed</VPill>
                <VPill v-else-if="p.person" size="sm" outline>Not signed</VPill>
                <VButton v-else size="sm" variant="secondary" @click="modal = 'invite'">Invite</VButton>
              </li>
            </ul>
          </VCard>

          <VCard title="Ledger" sub="Every signature, PayPal event and agent decision.">
            <ActivityFeed :items="contract.activity" :contract="contract" />
          </VCard>
        </aside>
      </div>

      <!-- ===== modals ===== -->
      <VModal :open="modal === 'invite'" title="Invite to this contract" :sub="`They join as the ${role === 'client' ? 'freelancer' : 'client'} and see the same terms.`" @close="modal = ''">
        <div class="invite">
          <p class="vk-eyebrow">Invite code</p>
          <p class="invite__code vk-num"><VCopy :value="contract.inviteCode" label="Copy code" /></p>
          <p class="vk-eyebrow" style="margin-top: 16px">Or send the link</p>
          <VCopy :value="inviteLink" label="Copy link" />
          <p v-if="contract.inviteEmail" class="vk-faint invite__note">{{ contract.inviteEmail }} also sees it as an invitation when they sign in.</p>
        </div>
      </VModal>

      <VModal :open="modal === 'sign'" title="Sign the terms" sub="Your signature covers every milestone below." @close="modal = ''">
        <ul class="sign">
          <li v-for="m in contract.milestones" :key="m.id">
            <span>{{ m.position === contract.milestones.length && contract.milestones.length > 1 ? 'Final' : `M${m.position}` }} · {{ m.title }}</span>
            <span class="vk-faint">{{ m.criteria.length }} checks</span>
            <span class="vk-num">{{ money(m.amountCents, contract.currency) }}</span>
          </li>
        </ul>
        <p class="sign__note">When every check on a milestone passes, its held payment is released automatically. If any check fails, the money stays held and both of you see exactly why.</p>
        <template #foot>
          <VButton variant="secondary" @click="modal = ''; tab = 'checks'">Review checks first</VButton>
          <VButton :icon="PenLine" :loading="busy === 'sign'" :disabled="!!mySignature" @click="sign">Sign as {{ firstName(auth.name) }}</VButton>
        </template>
      </VModal>

      <FundModal :open="modal === 'fund'" :milestone="ms" :currency="contract.currency" :payer-email="auth.user?.email" @close="modal = ''" />

      <VModal :open="modal === 'release'" title="Release payment" :sub="`The verdict said not yet. Release all of it, or the part that's earned — the rest of the hold goes back to you.`" @close="modal = ''">
        <div v-if="ms" class="rel">
          <VSegmented
            v-model="releaseMode" block label="How much"
            :options="[{ value: 'full', label: `Everything · ${money(ms.amountCents, contract.currency, { whole: true })}` }, { value: 'part', label: 'Part of it' }]"
          />
          <div v-if="releaseMode === 'part'" class="vk-field rel__amount">
            <label class="vk-field__label" for="rel-amount">Amount to release</label>
            <div class="vk-affix">
              <span class="vk-affix__pre">$</span>
              <input id="rel-amount" v-model="releaseInput" class="vk-input vk-input--lg vk-num" inputmode="decimal" :aria-invalid="!releaseValid" />
              <span class="vk-affix__post">of {{ money(ms.amountCents, contract.currency, { whole: true }) }}</span>
            </div>
            <span class="vk-field__hint">Suggested <button type="button" class="rel__suggest vk-num" @click="releaseInput = (suggestedCents / 100).toFixed(2)">{{ money(suggestedCents, contract.currency) }}</button> — the share of checks met ({{ met }} of {{ verdictNow?.results.length || ms.criteria.length }}).</span>
          </div>
          <dl class="vk-kv rel__split">
            <div class="vk-kv__row"><dt class="vk-kv__k">PayPal captures from the hold</dt><dd class="vk-kv__v">{{ money(releaseValid ? releaseCents : 0, contract.currency) }}</dd></div>
            <div class="vk-kv__row"><dt class="vk-kv__k">{{ firstName(other?.name || 'The freelancer') }} receives</dt><dd class="vk-kv__v">{{ money(split(releaseValid ? releaseCents : 0).net, contract.currency) }}</dd></div>
            <div v-if="releaseValid && releaseCents < ms.amountCents" class="vk-kv__row"><dt class="vk-kv__k">Returned to you</dt><dd class="vk-kv__v">{{ money(ms.amountCents - releaseCents, contract.currency) }}</dd></div>
          </dl>
        </div>
        <template #foot>
          <VButton variant="secondary" @click="modal = ''">Keep it held</VButton>
          <VButton variant="ok" :loading="busy === 'release'" :disabled="!releaseValid" @click="release">Release {{ money(releaseValid ? releaseCents : 0, contract.currency) }}</VButton>
        </template>
      </VModal>

      <VModal :open="modal === 'refund'" title="Void the hold?" sub="You won't be charged, and this milestone closes unpaid." @close="modal = ''">
        <p class="vk-muted" style="margin: 0">{{ firstName(other?.name || 'The freelancer') }} can no longer resubmit for this milestone. Consider giving them a chance to fix the failed checks first.</p>
        <template #foot>
          <VButton variant="secondary" @click="modal = ''">Cancel</VButton>
          <VButton variant="danger" :loading="busy === 'refund'" @click="refund">Void hold & refund</VButton>
        </template>
      </VModal>

      <VModal :open="modal === 'appeal'" title="Appeal the verdict" sub="An independent second review re-checks the failed checks against the evidence. Funds stay held meanwhile." @close="modal = ''">
        <label class="vk-field">
          <span class="vk-field__label">What did the agent get wrong?</span>
          <textarea v-model="appealReason" class="vk-textarea" rows="4" placeholder="Point to the check and explain why the delivery meets it." />
        </label>
        <template #foot>
          <VButton variant="secondary" @click="modal = ''">Cancel</VButton>
          <VButton :loading="busy === 'appeal'" :disabled="appealReason.trim().length < 10" @click="appeal">File appeal</VButton>
        </template>
      </VModal>
    </div>
  </AppShell>
</template>

<style scoped>
.crumb { color: var(--vk-ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 40ch; }
/* head — tightens once the main column is well into its content: the meta line folds away, the title
   drops to one line, the numbers shrink and the rail's needle tag tucks in */
.head { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px 40px; flex-wrap: wrap; padding-top: 4px; }
.head__main { min-width: 0; flex: 1 1 420px; }
.head__meta {
  display: flex; align-items: center; gap: 12px; flex-wrap: wrap; font: var(--vk-type-dense);
  max-height: 32px; overflow: hidden; transition: max-height var(--vk-dur-4) var(--vk-ease-out), opacity var(--vk-dur-3);
}
.head__title { margin: 14px 0 0; font: var(--vk-type-title); letter-spacing: -.035em; transition: font-size var(--vk-dur-4) var(--vk-ease-out), margin var(--vk-dur-4) var(--vk-ease-out); }
.head__stats { padding-bottom: 4px; }
.head__stats .vk-stat__n { font: var(--vk-num-28); transition: font-size var(--vk-dur-4) var(--vk-ease-out); }
.vk-split__head :deep(.rail) { transition: margin-top var(--vk-dur-4) var(--vk-ease-out); }
.vk-split__head :deep(.rail__tag) { transition: opacity var(--vk-dur-3); }
.vk-split__head :deep(.rail__needle) { transition: left .7s var(--vk-ease-out), height var(--vk-dur-4) var(--vk-ease-out); }

.is-condensed .head__meta { max-height: 0; opacity: 0; }
.is-condensed .head__title { margin-top: 0; font-size: 24px; line-height: 30px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.is-condensed .head__stats .vk-stat__n { font-size: 20px; line-height: 24px; }
.is-condensed .head__stats .vk-stat__d { top: -12px; }
.is-condensed :deep(.rail) { margin-top: 14px; }
.is-condensed :deep(.rail__tag) { opacity: 0; }
.is-condensed :deep(.rail__needle) { height: 14px; }

.ws__main { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
.ws__side { display: flex; flex-direction: column; gap: 16px; }

.ms__head { display: flex; justify-content: space-between; gap: 20px; width: 100%; flex-wrap: wrap; }
.ms__titles { min-width: 0; flex: 1 1 260px; }
.ms__title { margin: 6px 0 0; font: 400 20px/26px var(--vk-font); letter-spacing: -.02em; }
.ms__desc { margin: 4px 0 0; font: var(--vk-type-dense); color: var(--vk-muted); }
.ms__right { display: flex; flex-direction: column; align-items: flex-end; gap: 8px; }
.ms__amount { margin: 0; font: var(--vk-num-18); }
.ms__track { margin: 6px 0 26px; }
/* the tabs stick to the top of the column while you read a long report; they span the card edge to edge */
.ms__tabs {
  position: sticky; top: -20px; z-index: 2; margin: 0 calc(var(--vk-card-pad) * -1) 4px; padding: 8px var(--vk-card-pad) 0;
  background: var(--vk-surface); border-radius: var(--vk-r-md) var(--vk-r-md) 0 0;
}

.panel { padding-top: 20px; }
.panel__intro { margin: 0 0 18px; font: var(--vk-type-dense); color: var(--vk-muted); }
.drafting__line { display: flex; align-items: center; gap: 10px; margin: 0; font: var(--vk-type-dense); color: var(--vk-ink-2); }

.paid { margin-bottom: 20px; }
.paid :deep(.vk-card__body) { padding: 12px 16px; }
.paid__row { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.paid__text { margin: 0; font: var(--vk-type-dense); color: var(--vk-ink-2); }
.paid__text b { font-weight: 400; color: var(--vk-ok-ink); }
.paid__payout { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--vk-line-subtle); }
.paid__line { flex: 1 1 220px; min-width: 0; font: var(--vk-type-dense); color: var(--vk-ink-2); overflow-wrap: anywhere; }

.dispute { margin-bottom: 20px; }
.dispute__body { padding: 14px 16px 14px 18px; display: flex; flex-direction: column; gap: 8px; }
.dispute__head { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
.dispute__title { margin: 0; font: 400 15px/20px var(--vk-font); color: var(--vk-ink); }
.dispute__meta { margin: 0; font: var(--vk-type-small); overflow-wrap: anywhere; }
.dispute__text { display: flex; align-items: center; gap: 8px; margin: 0; font: var(--vk-type-dense); color: var(--vk-ink-2); }
.dispute__points { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 4px; font: var(--vk-type-dense); color: var(--vk-ink-2); }
.dispute__answer summary { font: var(--vk-type-small); color: var(--vk-muted); cursor: pointer; width: max-content; }
.dispute__answer p { margin: 8px 0 0; padding: 10px 12px; border: 1px solid var(--vk-line); border-radius: var(--vk-r-sm); background: var(--vk-surface); font: var(--vk-type-dense); color: var(--vk-ink-2); }

.review { margin-bottom: 20px; padding: 16px 18px; border: 1px solid var(--vk-line); border-radius: var(--vk-r-md); background: var(--vk-surface-2); display: flex; flex-direction: column; gap: 10px; }
.review__head { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
.review__title { display: flex; align-items: center; gap: 8px; margin: 0; font: 400 15px/20px var(--vk-font); color: var(--vk-ink); }
.review__appeal { margin: 0; font: var(--vk-type-dense); color: var(--vk-muted); }
.review__text { display: flex; align-items: center; gap: 8px; margin: 0; font: var(--vk-type-dense); color: var(--vk-ink-2); }
.review__findings { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 10px; }
.review__findings li { display: flex; gap: 10px; }
.review__icon { display: grid; place-items: center; flex: none; width: 20px; height: 20px; margin-top: 1px; border-radius: 50%; border: 1px solid var(--vk-line); }
.is-overturn .review__icon { background: var(--vk-ok-soft); color: var(--vk-ok-ink); border-color: color-mix(in srgb, var(--vk-ok) 35%, transparent); }
.is-uphold .review__icon { background: var(--vk-danger-soft); color: var(--vk-danger-ink); border-color: color-mix(in srgb, var(--vk-danger) 35%, transparent); }
.review__check { margin: 0; font: var(--vk-type-dense); color: var(--vk-ink); }
.review__why { margin: 2px 0 0; font: var(--vk-type-small); color: var(--vk-muted); }
.review__why b { color: var(--vk-ink-2); }
.review__actions { display: flex; gap: 8px; flex-wrap: wrap; }

.hold { margin-bottom: 18px; padding: 14px 16px; border: 1px solid var(--vk-line); border-radius: var(--vk-r-md); background: var(--vk-surface-2); }
.hold__top { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
.hold__label { display: inline-flex; align-items: center; gap: 8px; font: var(--vk-type-dense); color: var(--vk-ink); }
.hold__label b { color: var(--vk-accent-text); }
.hold__until { font: var(--vk-type-small); }
.hold__bar { height: 6px; margin-top: 10px; border-radius: var(--vk-r-full); background: var(--vk-surface); border: 1px solid var(--vk-line); overflow: hidden; }
.hold__bar span { display: block; height: 100%; border-radius: inherit; background: var(--vk-accent); }
.hold__note { margin: 8px 0 0; font: var(--vk-type-small); }

.pay__disputes { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-top: 20px; padding-top: 16px; border-top: 1px solid var(--vk-line-subtle); }
.pay__disputes p { margin: 0; flex: 1 1 260px; font: var(--vk-type-small); }

.rel { display: flex; flex-direction: column; gap: 16px; }
.rel__amount { gap: 8px; }
.rel__suggest { padding: 0; border: 0; background: none; font: inherit; color: var(--vk-accent-text); cursor: pointer; text-decoration: underline; text-underline-offset: 3px; }
.rel__split { padding: 12px 14px; border: 1px solid var(--vk-line-subtle); border-radius: var(--vk-r-sm); background: var(--vk-surface-2); }
.held { margin-top: 20px; padding: 16px; border: 1px solid var(--vk-line); border-radius: var(--vk-r-md); background: var(--vk-surface-2); }
.held__text { margin: 0; font: var(--vk-type-dense); color: var(--vk-ink-2); }
.held__actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 12px; }

.deliver { margin-top: 24px; padding-top: 24px; border-top: 1px solid var(--vk-line); }
.panel > .deliver:first-child { margin-top: 0; padding-top: 0; border-top: 0; }
.deliver__title { margin: 0; font: var(--vk-type-section); }
.deliver__sub { margin: 4px 0 18px; font: var(--vk-type-dense); color: var(--vk-muted); }

.attempts { margin-top: 24px; padding-top: 16px; border-top: 1px solid var(--vk-line-subtle); }
.attempts summary { font: var(--vk-type-dense); color: var(--vk-muted); cursor: pointer; width: max-content; }
.attempts__item { margin-top: 20px; padding: 20px; border: 1px solid var(--vk-line-subtle); border-radius: var(--vk-r-md); background: var(--vk-surface-2); }

.pay { max-width: 520px; }
.pay__cta { margin-top: 20px; }

.parties { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 14px; }
.parties li { display: flex; align-items: center; gap: 10px; }
.parties__who { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.parties__name { font: 400 13px/18px var(--vk-font); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.parties__role { font: var(--vk-type-small); color: var(--vk-faint); }

.invite__code { margin: 6px 0 0; font-size: 26px; letter-spacing: .14em; }
.invite__note { margin: 16px 0 0; font: var(--vk-type-small); }
.sign { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 10px; }
.sign li { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: 14px; font: var(--vk-type-dense); }
.sign__note { margin: 18px 0 0; padding: 12px 14px; border-radius: var(--vk-r-sm); background: var(--vk-surface-2); border: 1px solid var(--vk-line-subtle); font: var(--vk-type-dense); color: var(--vk-ink-2); }

@media (max-width: 1100px) {
  .ms__tabs { top: 0; }
}
@media (max-width: 760px) {
  .head__title { font-size: 28px; line-height: 34px; }
  .head__stats { gap: 18px; }
  .head__stats .vk-stat__n { font-size: 20px; line-height: 24px; }
  .head__stats .vk-stat__l { font-size: 13px; }
  .head { margin-bottom: 16px; }
}
</style>
