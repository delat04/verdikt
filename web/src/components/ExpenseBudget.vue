<!--
  ExpenseBudget — what the work may spend (a domain, hosting, fonts…), agreed with the terms and held in the
  same PayPal hold as the milestone. The freelancer (or their agent) claims against receipts; deterministic
  checks read each one and PayPal reimburses it at once when they all pass. The client decides only what the
  checks can't settle. Unused budget goes back to the client when the milestone settles.
-->
<script setup>
import { ref, reactive, computed, watch, nextTick, onBeforeUnmount } from 'vue'
import { Receipt, Check, X, Minus, FileText, Upload, RefreshCw, Scale, Search, Package } from 'lucide-vue-next'
import VButton from './ui/VButton.vue'
import VField from './ui/VField.vue'
import VPill from './ui/VPill.vue'
import VCopy from './ui/VCopy.vue'
import { api, isDemo } from '@/services'
import { toast } from '@/composables/useToast'
import { money, toCents, timeAgo, firstName, hostOf, shortDate } from '@/domain/format'
import { HELD, termsSigned } from '@/domain/milestone'
import { COVER_SUGGESTIONS, EXPENSE_STATUS, RECEIPT_ACCEPT, MAX_RECEIPT_BYTES, expenseTotals, fileToBase64 } from '@/domain/expenses'
import { itemState, itemLifecycle, outstandingCents, receiptBand, canRemove, canAgree, canDecline } from '@/domain/expenseRules'
import { SAMPLE_CLAIMS } from '@/services/demoReceipts'

const props = defineProps({
  milestone: { type: Object, required: true },
  contract: { type: Object, required: true },
  role: { type: String, default: null },
  editable: { type: Boolean, default: false },
})

const cur = computed(() => props.contract.currency)
const $ = (c) => money(c, cur.value)
const t = computed(() => expenseTotals(props.milestone))
const pct = (c) => `${t.value.budget ? Math.min(100, (c / t.value.budget) * 100) : 0}%`
const funded = computed(() => HELD.includes(props.milestone.status) && !!props.milestone.paypal?.authorizationId)
const settled = computed(() => ['released', 'refunded'].includes(props.milestone.status))
const clientName = computed(() => (props.role === 'client' ? 'you' : firstName(props.contract.client?.name || 'the client')))
const freelancerName = computed(() => firstName(props.contract.freelancer?.name || 'the freelancer'))
const busy = ref('')

// ---- the budget, part of the terms
const editing = ref(false)
const budgetInput = ref('')
const covers = ref([])
const custom = ref('')
function resetBudget() {
  budgetInput.value = props.milestone.expenseBudgetCents ? (props.milestone.expenseBudgetCents / 100).toFixed(2) : ''
  covers.value = [...(props.milestone.expenseCovers || [])]
  editing.value = false
}
watch(() => [props.milestone.id, props.milestone.expenseBudgetCents, (props.milestone.expenseCovers || []).join('|')], resetBudget, { immediate: true })
const options = computed(() => [...new Set([...COVER_SUGGESTIONS, ...covers.value])])
const toggle = (c) => { covers.value = covers.value.includes(c) ? covers.value.filter((x) => x !== c) : [...covers.value, c] }
function addCustom() {
  const c = custom.value.trim().slice(0, 40)
  if (c && !covers.value.includes(c)) covers.value = [...covers.value, c]
  custom.value = ''
}
// a price check of the contract's brief: what it typically costs online, with sources
const estimate = ref(null)
async function estimateCosts() {
  busy.value = 'estimate'
  try {
    estimate.value = await api.priceCheck({ title: props.contract.title, brief: props.contract.brief, currency: cur.value })
  } catch (e) {
    toast(e.message, { tone: 'danger' })
  } finally {
    busy.value = ''
  }
}
function useEstimate() {
  budgetInput.value = (estimate.value.plan.expenseBudgetCents / 100).toFixed(2)
  covers.value = [...new Set([...covers.value, ...estimate.value.plan.covers])]
}
const budgetCents = computed(() => toCents(budgetInput.value))
const budgetValid = computed(() => budgetCents.value >= 100 && budgetCents.value <= 1_000_000 && covers.value.length > 0)
async function saveBudget(remove = false) {
  busy.value = remove ? 'remove' : 'budget'
  try {
    await api.setExpenseBudget(props.milestone.id, remove ? { budgetCents: 0, covers: [] } : { budgetCents: budgetCents.value, covers: covers.value })
    toast(remove ? 'Expense budget removed — both of you sign again' : 'Expense budget saved — both of you sign again')
    editing.value = false
  } catch (e) {
    toast(e.message, { tone: 'danger' })
  } finally {
    busy.value = ''
  }
}

// ---- the shopping list: real products from Channel3 store listings, part of the terms. Before both sign either
// side edits it and every edit resets the signatures; after, the client's additions are agreed at once and the
// freelancer's wait for the client to agree. A receipt from a list store with a line naming an agreed item at
// about its price is reimbursed by rules alone (domain/expenseRules.js, the live checker's copy); anything else
// is checked against the budget lines. Who may do what comes from the same module, so no button offers what
// the API would refuse.
const usd = (c) => money(c, 'USD')                     // listings are always US dollars
const listable = computed(() => (cur.value || 'USD') === 'USD')
const signed = computed(() => termsSigned(props.contract))
const local = ref(null)       // the list as the last add/agree/decline/remove returned it, until the milestone catches up
watch(() => JSON.stringify(props.milestone.expenseProducts || []), () => { local.value = null })
const planned = computed(() => local.value ?? props.milestone.expenseProducts ?? [])
const listTotal = computed(() => planned.value.reduce((s, p) => s + (p.priceCents || 0), 0))
// what the list still holds for (items no live claim bought) against what's left of the budget
const outstanding = computed(() => outstandingCents(planned.value, props.milestone.expenses || []))
const roomLeft = computed(() => Math.max(0, t.value.left - outstanding.value))
const overBy = computed(() => Math.max(0, outstanding.value - t.value.left))
const isPlanned = (id) => planned.value.some((p) => p.id === id)
const broken = reactive(new Set())                  // images that failed to load show the Package tile
const listSub = computed(() => {
  if (!signed.value) return 'Real products from Channel3 store listings, part of the terms. A receipt that names one of these, from a store that sells it, at about this price, is reimbursed at once by rules. Changing the list asks both of you to sign again.'
  if (props.role === 'freelancer') return `Receipts for items on this list are reimbursed at once by rules. To add something, propose it. ${clientName.value} agrees or declines.`
  return `Receipts for items on this list are reimbursed at once by rules. Anything else ${freelancerName.value} buys is checked against the budget lines, and ${props.role === 'client' ? 'you decide' : `${clientName.value} decides`} what the rules can't.`
})
// 'a', 'a or b', 'a, b or c'
const orList = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} or ${xs.at(-1)}`)

// each row's pill: a claim on the item first (bought, then checking or reimbursed), else where its consent stands
function pillOf(p, life, state) {
  if (life.state === 'reimbursed') return { tone: 'ok', text: `Reimbursed ${$(life.expense.amountCents)}` }
  if (life.state === 'checking') return { tone: 'warn', live: true, text: 'Bought · checking' }
  if (life.state === 'needs_client') return { tone: 'warn', text: `Bought · ${props.role === 'client' ? 'you decide' : `${clientName.value} decides`}` }
  if (state === 'terms') return { tone: 'neutral', text: 'On the terms' }
  // agreed after signing: the client's own addition, or the freelancer's proposal the client said yes to
  if (state === 'agreed') return { tone: 'neutral', text: p.status === 'terms' ? 'Signed by both' : p.plannedBy === 'freelancer' ? 'Agreed by both' : `Added by ${clientName.value}` }
  if (props.role === 'freelancer') return { tone: 'warn', text: `Waiting for ${clientName.value}` }
  return { tone: 'neutral', text: `${freelancerName.value}${p.viaAgent ? "'s agent" : ''} proposed this` }
}
const rows = computed(() => planned.value.map((p) => {
  const life = itemLifecycle(p, props.milestone.expenses || [])
  const state = itemState(p, { signed: signed.value })
  const may = { role: props.role, signedBoth: signed.value, lifecycle: life }
  const open = life.state === 'open' && !settled.value && !!props.role
  const band = state === 'agreed' && life.state === 'open' ? receiptBand(p) : null
  return {
    p, pill: pillOf(p, life, state),
    // 'Netum · walmart.com · $34.20 · listed Nov 9' (the demo's listings were saved, not read live)
    meta: { lead: [p.brand, p.domain].filter(Boolean).join(' · '), when: (isDemo ? 'saved listing, ' : 'listed ') + shortDate(p.asOf || p.at) },
    band: band && `Reimbursed at once: a receipt from ${orList(band.stores)} that names it, up to ${usd(band.claimMaxCents)} with tax and shipping.`,
    agree: open && canAgree(p, may).ok,
    decline: open && canDecline(p, may).ok,
    // a proposed item the client may decline: Decline says it (and tells the freelancer); no second way off the list
    remove: open && canRemove(p, may).ok && !canDecline(p, may).ok,
    buy: canClaim.value && state === 'agreed' && life.state === 'open',
  }
}))

// the store search: idle | loading | results | empty | error. Errors stay inline with their next step (no toasts)
const query = ref('')
const phase = ref('idle')
const results = ref(null)
const searchErr = ref(null)
const announce = ref('')      // the polite live region: that a search is running (an add is said by its toast)
const qKey = () => `vk-sl-q:${props.milestone.id}`   // the last query, per milestone, for this tab
let retryTimer = null
let searchSeq = 0
function resetSearch() {
  clearTimeout(retryTimer)
  searchSeq++
  phase.value = 'idle'
  results.value = searchErr.value = null
  announce.value = ''
}
watch(() => props.milestone.id, () => {
  resetSearch()
  try { query.value = sessionStorage.getItem(qKey()) || '' } catch { query.value = '' }
}, { immediate: true })
onBeforeUnmount(() => clearTimeout(retryTimer))
// a time today as people read it: '9:41 pm'
const clockOf = (iso) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).replace(/\s+/g, ' ').toLowerCase()
function searchError(e, retried) {
  const code = e?.code || 'unavailable'
  if (code === 'rate_limited' && !retried && e.retryAfterSec != null && e.retryAfterSec <= 10) {
    return { code, text: `Store search is busy. Trying again in ${Math.max(1, Math.ceil(e.retryAfterSec))} s.`, retryIn: Math.max(1, e.retryAfterSec) * 1000 }
  }
  if (code === 'unavailable' || !e?.code) return { code, text: "Store search isn't answering. Try again in a minute.", again: true }
  if (code === 'rate_limited') return { code, text: e.message, again: true }
  // the API says "in 12 minutes"; a clock time is what people can plan around
  if (code === 'search_limit' && e.retryAt) return { code, text: String(e.message).replace(/Try again\b.*$/, `Try again after ${clockOf(e.retryAt)}.`) }
  return { code, text: e.message }   // quota names the day it resets; no_room, query, settled say what to do
}
async function findProducts({ retried = false } = {}) {
  const q = query.value.trim()
  if (q.length < 3) return
  clearTimeout(retryTimer)
  const mine = ++searchSeq
  phase.value = 'loading'
  results.value = searchErr.value = null
  announce.value = 'Searching stores…'
  try { sessionStorage.setItem(qKey(), q) } catch { /* private window: nothing to remember */ }
  try {
    const r = await api.searchBudgetProducts(props.milestone.id, q)
    if (mine !== searchSeq) return
    results.value = { ...r, products: (r.products || []).slice(0, 9) }
    phase.value = results.value.products.length ? 'results' : 'empty'
    announce.value = ''
  } catch (e) {
    if (mine !== searchSeq) return
    searchErr.value = searchError(e, retried)
    phase.value = 'error'
    announce.value = ''
    if (searchErr.value.retryIn) retryTimer = setTimeout(() => findProducts({ retried: true }), searchErr.value.retryIn)
  }
}
// Clear removes the results (and the button with them): focus goes back to the search box, not to the page
function clearSearch() {
  resetSearch()
  nextTick(() => document.getElementById('sl-q')?.focus())
}
function suggest(s) {
  query.value = s
  findProducts()
}
// the footer under the results: when the prices were read
const resultsWhen = computed(() => {
  const r = results.value
  if (!r) return ''
  if (r.saved) return r.savedNote || ''
  if (!r.asOf) return ''
  return r.cached ? `Reused from ${clockOf(r.asOf)}, no new search` : `Prices as of ${clockOf(r.asOf)}`
})
// the commission stores may pay Channel3: the highest rate on what's shown
const commission = computed(() => {
  const shown = [...(phase.value === 'results' ? results.value.products : []), ...planned.value]
  return Math.round(Math.max(0, ...shown.map((p) => Number(p.commissionRate) || 0)) * 100)
})
const addLabel = computed(() => (signed.value && props.role === 'freelancer' ? 'Propose adding' : 'Add to the list'))
const cardName = (p) => `${p.title}, ${usd(p.priceCents)} at ${p.domain}`
// results read against the room left now, not when the search ran: after an add, the header counts what still
// fits and each card that no longer does says so (the API would refuse it)
const shrunk = computed(() => !!results.value && roomLeft.value < results.value.capCents)
const stillFit = computed(() => (results.value?.products || []).filter((p) => !isPlanned(p.id) && p.priceCents <= roomLeft.value).length)
const cardAction = (p) => (isPlanned(p.id) ? 'On the list' : p.priceCents > roomLeft.value ? 'Over the room left' : addLabel.value)

async function focusRow(id) {
  await nextTick()
  ;(document.getElementById(`sl-${id}`) || document.getElementById('sl-head'))?.focus()
}
async function plan(p) {
  busy.value = `plan:${p.id}`
  try {
    const r = await api.planProduct(props.milestone.id, p.id)
    local.value = r.planned
    const status = (r.item || r.planned.find((x) => x.id === p.id))?.status
    if (!r.unchanged) {
      toast(status === 'proposed' ? `Proposed to ${clientName.value}.`
        : status === 'agreed' ? 'Added to the signed shopping list.'
        : r.resetSignatures ? 'Added to the shopping list. Both of you sign again.'
        : "Added to the shopping list. It's part of the terms you'll sign.")
    }
    // the toast (a polite status region) says what happened; the results header recounts what still fits
    focusRow(p.id)
  } catch (e) {
    toast(e.message, { tone: 'danger' })
  } finally {
    busy.value = ''
  }
}
async function agree(p) {
  busy.value = `agree:${p.id}`
  try {
    local.value = (await api.agreePlanItem(props.milestone.id, p.id)).planned
    toast('Agreed. A matching receipt is reimbursed at once.')
    focusRow(p.id)
  } catch (e) {
    toast(e.message, { tone: 'danger' })
  } finally {
    busy.value = ''
  }
}
async function decline(p) {
  busy.value = `decline:${p.id}`
  try {
    local.value = (await api.declinePlanItem(props.milestone.id, p.id)).planned
    toast("Declined. It's off the list.")
    focusRow(null)
  } catch (e) {
    toast(e.message, { tone: 'danger' })
  } finally {
    busy.value = ''
  }
}
async function unplan(p) {
  busy.value = `unplan:${p.id}`
  try {
    const r = await api.unplanProduct(props.milestone.id, p.id)
    local.value = r.planned
    toast(r.resetSignatures ? 'Removed from the shopping list. Both of you sign again.' : 'Removed from the shopping list.')
    focusRow(null)
  } catch (e) {
    toast(e.message, { tone: 'danger' })
  } finally {
    busy.value = ''
  }
}
// "I bought this": the claim form, filled from the item; the amount stays the receipt's to say
const claimEl = ref(null)
const fromList = ref(null)    // the list item the claim form was filled from
async function bought(p) {
  fromList.value = p
  merchant.value = p.domain
  purpose.value = p.title
  amount.value = sample.value = ''
  await nextTick()
  const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  claimEl.value?.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'start' })
  document.getElementById('xp-amount')?.focus({ preventScroll: true })
}

// ---- a claim, with its receipt
const amount = ref('')
const merchant = ref('')
const purpose = ref('')
const file = ref(null)
const sample = ref('')
const fileError = ref('')
const claimCents = computed(() => toCents(amount.value))
const canClaim = computed(() => props.role === 'freelancer' && funded.value && t.value.budget > 0)
const claimValid = computed(() => claimCents.value >= 100 && claimCents.value <= t.value.left && purpose.value.trim() && (file.value || sample.value))
function pick(ev) {
  const f = ev.target.files?.[0]
  fileError.value = ''
  sample.value = ''
  if (!f) return
  if (!RECEIPT_ACCEPT.split(',').includes(f.type)) { fileError.value = 'Receipts are PDF, PNG, JPG or WebP'; return }
  if (f.size > MAX_RECEIPT_BYTES) { fileError.value = 'Receipts can be up to 5 MB'; return }
  file.value = f
}
// the demo's sample receipts (demoReceipts.js): the same claims server/test/parity.test.js checks against the live rules
const SAMPLES = isDemo ? SAMPLE_CLAIMS.map((s) => ({ ...s, amount: (s.amountCents / 100).toFixed(2) })) : []
function useSample(s) {
  sample.value = s.key
  file.value = null
  fromList.value = null
  amount.value = s.amount
  merchant.value = s.merchant
  purpose.value = s.purpose
}
async function claim() {
  busy.value = 'claim'
  try {
    const receipt = sample.value
      ? { sample: sample.value, name: `${sample.value}-receipt.pdf`, type: 'application/pdf' }
      : { name: file.value.name, type: file.value.type, data: await fileToBase64(file.value), ...(isDemo ? { file: file.value } : {}) }
    const r = await api.claimExpense(props.milestone.id, { amountCents: claimCents.value, merchant: merchant.value.trim(), purpose: purpose.value.trim(), receipt })
    toast({
      approved: `${$(claimCents.value)} reimbursed — PayPal is paying it out now`,
      rejected: 'Not reimbursed — see the check that failed',
      needs_client: `The checks couldn't settle it — ${clientName.value} decides`,
    }[r.status] || 'Claim sent', { tone: r.status === 'approved' ? 'ok' : r.status === 'rejected' ? 'danger' : 'info' })
    amount.value = merchant.value = purpose.value = sample.value = ''
    file.value = fromList.value = null
  } catch (e) {
    toast(e.message, { tone: 'danger' })
  } finally {
    busy.value = ''
  }
}

// ---- the claims
const claims = computed(() => [...(props.milestone.expenses || [])].reverse())
const who = (e) => (e.viaAgent ? `${freelancerName.value}'s agent` : props.role === 'freelancer' ? 'You' : freelancerName.value)
// a receipt the list settled says so: an agreed item was named on it
const onList = (e) => (e.checks || []).some((c) => c.key === 'list_item' && c.status === 'pass')
const decided = (e) => ({
  rules: onList(e) ? 'on the shopping list, decided by rules, no model' : 'decided by rules, no model',
  claude: 'coverage read by Claude',
  client: e.status === 'declined' ? `declined by ${props.role === 'client' ? 'you' : clientName.value}` : `approved by ${props.role === 'client' ? 'you' : clientName.value}`,
}[e.decidedBy] || '')
// the list items a receipt bought, as the list shows them now (the claim keeps its own copy for items since removed)
const boughtOf = (e) => (Array.isArray(e.extracted?.planned) ? e.extracted.planned : []).map((x) => {
  const item = planned.value.find((p) => String(p.id) === String(x.id))
  return { id: x.id, title: item?.title || x.title, image: item?.image || x.image || '' }
})
// 'info' rows explain the list and never decide, so the count leaves them out
const scored = (e) => e.checks.filter((c) => c.status !== 'info')
const readVia = (e) => (e.extracted?.via === 'pdf' ? 'read from the PDF' : e.extracted?.via === 'ocr' ? 'read with OCR' : '')
async function openReceipt(e) {
  try {
    const r = await api.expenseReceipt(e.id)
    window.open(r.url, '_blank', 'noopener')
  } catch (err) {
    toast(err.message, { tone: 'danger' })
  }
}
async function act(e, kind) {
  busy.value = `${kind}-${e.id}`
  try {
    if (kind === 'approve') { await api.approveExpense(e.id); toast(`${$(e.amountCents)} reimbursed`, { tone: 'ok' }) }
    else if (kind === 'decline') { await api.declineExpense(e.id); toast('Claim declined') }
    else { await api.retryExpensePayout(e.id); toast('Payout sent again') }
  } catch (err) {
    toast(err.message, { tone: 'danger' })
  } finally {
    busy.value = ''
  }
}
</script>

<template>
  <div class="xp">
    <!-- the budget -->
    <section class="xp__budget">
      <div class="xp__head">
        <div class="xp__titles">
          <p class="xp__title">Expense budget</p>
          <p class="xp__sub">
            <template v-if="t.budget">Held in the same PayPal hold as this milestone. A receipt that passes every check is reimbursed at once — a partial capture and a payout, no Verdikt fee. {{ settled ? `What wasn't spent went back to ${clientName}.` : `What isn't spent goes back to ${clientName} when the milestone settles.` }}</template>
            <template v-else-if="editable">Money the freelancer may spend on what the work needs — a domain, hosting, fonts. It's held with this milestone and paid out only against receipts; what isn't spent is never charged.</template>
            <template v-else>No expense budget on this milestone. One can be agreed only before both of you sign.</template>
          </p>
        </div>
        <p v-if="t.budget && !editing" class="xp__cap vk-num">up to {{ $(t.budget) }}</p>
      </div>

      <template v-if="t.budget && !editing">
        <div class="xp__bar" role="img" :aria-label="`${$(t.spent)} reimbursed, ${$(t.waiting)} waiting, ${$(t.left)} left of ${$(t.budget)}`">
          <span class="xp__bar-spent" :style="{ width: pct(t.spent) }" />
          <span class="xp__bar-wait" :style="{ width: pct(t.waiting) }" />
        </div>
        <div class="xp__row">
          <p class="xp__nums vk-num">
            <span :class="{ 'is-spent': t.spent }">{{ $(t.spent) }} reimbursed</span> · {{ $(t.waiting) }} waiting · {{ $(t.left) }} left
          </p>
          <p class="xp__covers">
            <span class="vk-faint">Covers</span>
            <span v-for="c in milestone.expenseCovers" :key="c" class="xp__tag">{{ c }}</span>
            <VButton v-if="editable" size="sm" variant="ghost" @click="editing = true">Edit</VButton>
          </p>
        </div>
      </template>

      <form v-if="editable && (editing || !t.budget)" class="xp__form" @submit.prevent="saveBudget()">
        <VField label="Up to" for="xp-budget" hint="Added to the PayPal hold; only receipts are paid from it.">
          <div class="vk-affix"><span class="vk-affix__pre">$</span><input id="xp-budget" v-model="budgetInput" class="vk-input vk-num" inputmode="decimal" placeholder="60.00" /></div>
        </VField>
        <div class="xp__pick">
          <p class="xp__pick-label">What it covers</p>
          <div class="xp__chips">
            <button v-for="c in options" :key="c" type="button" class="xp__chip" :class="{ 'is-on': covers.includes(c) }" :aria-pressed="covers.includes(c)" @click="toggle(c)">
              <Check v-if="covers.includes(c)" :size="12" :stroke-width="2.4" /> {{ c }}
            </button>
            <input v-model="custom" class="xp__custom" maxlength="40" placeholder="Something else…" aria-label="Add what else the budget covers" @keydown.enter.prevent="addCustom" @blur="addCustom" />
          </div>
        </div>
        <!-- what this project typically costs online, from current public prices -->
        <div v-if="estimate" class="xp__est">
          <p class="xp__est-h">Typical costs for this project</p>
          <ul>
            <li v-for="c in estimate.costs.filter((x) => !x.optional)" :key="c.item">
              <span>{{ c.item }}</span>
              <a v-if="c.source" :href="c.source" target="_blank" rel="noopener noreferrer" class="xp__est-src">{{ hostOf(c.source) }}</a>
              <span class="vk-num">{{ c.cents ? `${$(c.cents)}${c.period === 'once' ? '' : c.period === 'month' ? '/mo' : '/yr'}` : 'free' }}</span>
            </li>
          </ul>
          <div class="xp__est-foot">
            <span class="vk-faint">{{ estimate.demo ? 'Sample figures in demo mode.' : `From ${estimate.sources.length} page${estimate.sources.length === 1 ? '' : 's'} Claude searched${estimate.cached ? ' · reused' : ''}.` }}</span>
            <VButton v-if="estimate.plan.expenseBudgetCents" size="sm" variant="secondary" @click="useEstimate">Use {{ $(estimate.plan.expenseBudgetCents) }} for {{ estimate.plan.covers.join(', ') }}</VButton>
          </div>
        </div>
        <div class="xp__actions">
          <VButton variant="ghost" :icon="Scale" :loading="busy === 'estimate'" :disabled="!!busy" class="xp__est-btn" @click="estimateCosts">{{ estimate ? 'Estimate again' : 'Estimate typical costs' }}</VButton>
          <VButton v-if="editing" variant="ghost" @click="resetBudget">Cancel</VButton>
          <VButton v-if="t.budget" variant="secondary" :loading="busy === 'remove'" @click="saveBudget(true)">Remove budget</VButton>
          <VButton type="submit" :disabled="!budgetValid || !!busy" :loading="busy === 'budget'">{{ t.budget ? 'Save budget' : 'Add expense budget' }}</VButton>
        </div>
      </form>
    </section>

    <!-- the shopping list: real products from Channel3 store listings, part of the terms -->
    <section v-if="t.budget && !editing && (planned.length || (!settled && role))" class="xp__plan sl" aria-labelledby="sl-head">
      <div class="sl__head">
        <h3 id="sl-head" class="xp__h3" tabindex="-1">Shopping list</h3>
        <p v-if="listable" class="sl__sum vk-num">{{ usd(listTotal) }} on the list · {{ usd(roomLeft) }} room left</p>
      </div>

      <p v-if="!listable" class="sl__sub">Store listings are in US dollars and this contract pays in {{ cur }}, so the shopping list isn't available here.</p>
      <template v-else>
        <p class="sl__sub">{{ listSub }}</p>
        <p v-if="overBy" class="sl__warn">The list is {{ usd(overBy) }} over what's left.</p>

        <ul v-if="rows.length" class="xp__planned sl__list">
          <li v-for="r in rows" :id="`sl-${r.p.id}`" :key="r.p.id" class="sl__row" tabindex="-1">
            <img
              v-if="r.p.image && !broken.has(r.p.image)" class="sl__img" :src="r.p.image" width="48" height="48" loading="lazy" decoding="async"
              referrerpolicy="no-referrer" alt="" @error="broken.add(r.p.image)"
            />
            <span v-else class="sl__img sl__img--none" aria-hidden="true"><Package :size="20" :stroke-width="1.6" /></span>
            <div class="sl__body">
              <a :href="r.p.url" target="_blank" rel="noopener noreferrer sponsored" class="sl__title">{{ r.p.title }}<span class="vk-sr-only"> (opens the store, sponsored link)</span></a>
              <p class="sl__meta">{{ r.meta.lead }} · <span class="vk-num">{{ usd(r.p.priceCents) }}</span> · {{ r.meta.when }}</p>
              <p v-if="r.band" class="sl__band">{{ r.band }}</p>
            </div>
            <div class="sl__side">
              <VPill :tone="r.pill.tone" :live="!!r.pill.live" size="sm">{{ r.pill.text }}</VPill>
              <div v-if="r.agree || r.decline || r.buy || r.remove" class="sl__acts">
                <VButton v-if="r.agree" size="sm" variant="secondary" :aria-label="`Agree to ${r.p.title}`" :loading="busy === `agree:${r.p.id}`" :disabled="!!busy" @click="agree(r.p)">Agree</VButton>
                <VButton v-if="r.decline" size="sm" variant="ghost" :aria-label="`Decline ${r.p.title}`" :loading="busy === `decline:${r.p.id}`" :disabled="!!busy" @click="decline(r.p)">Decline</VButton>
                <VButton v-if="r.buy" size="sm" variant="secondary" :icon="Receipt" :aria-label="`I bought this: ${r.p.title}`" :disabled="!!busy" @click="bought(r.p)">I bought this</VButton>
                <VButton v-if="r.remove" size="sm" variant="ghost" :aria-label="`Remove ${r.p.title} from the list`" :loading="busy === `unplan:${r.p.id}`" :disabled="!!busy" @click="unplan(r.p)">Remove</VButton>
              </div>
            </div>
          </li>
        </ul>

        <!-- the store search -->
        <form v-if="!settled && role" class="sl__search" role="search" @submit.prevent="findProducts()">
          <VField label="Find it in Channel3 store listings" for="sl-q" class="sl__field">
            <input id="sl-q" v-model="query" class="vk-input" maxlength="120" placeholder="e.g. 2D barcode scanner" autocomplete="off" />
          </VField>
          <VButton type="submit" variant="secondary" :icon="Search" :loading="phase === 'loading'" :disabled="query.trim().length < 3 || phase === 'loading'">Search stores</VButton>
        </form>
        <p class="vk-sr-only" aria-live="polite">{{ announce }}</p>

        <div v-if="phase === 'loading'" class="sl__loading">
          <p class="sl__note">Searching stores…</p>
          <ul class="sl__grid" aria-hidden="true">
            <li v-for="i in 3" :key="i" class="sl__card is-skel">
              <span class="vk-skel sl__tile" />
              <div class="sl__card-body"><span class="vk-skel sl__skel sl__skel--s" /><span class="vk-skel sl__skel" /><span class="vk-skel sl__skel sl__skel--m" /></div>
              <span class="vk-skel sl__skel sl__skel--btn" />
            </li>
          </ul>
        </div>

        <!-- one polite region that is always there (visually hidden while empty, never display:none), so each outcome is
             read out once: the count, nothing found, or an error -->
        <div class="sl__live" aria-live="polite">
          <div v-if="phase === 'results'" class="sl__rhead">
            <p v-if="shrunk" class="sl__count">{{ stillFit }} of {{ results.products.length }} still fit the <span class="vk-num">{{ usd(roomLeft) }}</span> room left, for “{{ results.query }}”</p>
            <p v-else class="sl__count">{{ results.products.length }} in stock under <span class="vk-num">{{ usd(results.capCents) }}</span> from Channel3 for “{{ results.query }}”</p>
            <button type="button" class="link" @click="clearSearch">Clear</button>
          </div>
          <p v-else-if="phase === 'empty'" class="sl__sub">Nothing in stock under <span class="vk-num">{{ usd(results.capCents) }}</span> for “{{ results.query }}”. {{ results.emptyNote || 'Try fewer words or a brand.' }}</p>
          <p v-else-if="phase === 'error'" class="sl__error">{{ searchErr.text }}</p>
        </div>

        <template v-if="phase === 'results'">
          <ul class="sl__grid">
            <li v-for="p in results.products" :key="p.id" class="sl__card">
              <span class="sl__tile">
                <img
                  v-if="p.image && !broken.has(p.image)" :src="p.image" width="88" height="88" loading="lazy" decoding="async" referrerpolicy="no-referrer"
                  alt="" @error="broken.add(p.image)"
                />
                <Package v-else :size="24" :stroke-width="1.6" aria-hidden="true" />
              </span>
              <div class="sl__card-body">
                <p v-if="p.brand" class="sl__brand">{{ p.brand }}</p>
                <a :href="p.url" target="_blank" rel="noopener noreferrer sponsored" class="sl__title sl__title--clamp">{{ p.title }}<span class="vk-sr-only"> (opens the store, sponsored link)</span></a>
                <p class="sl__price vk-num">{{ usd(p.priceCents) }}<s v-if="p.compareAtCents > p.priceCents" class="sl__was"><span class="vk-sr-only">was </span>{{ usd(p.compareAtCents) }}</s></p>
                <p class="sl__store">{{ p.domain }}<template v-if="p.offers?.length > 1"> · {{ p.offers.length }} stores</template></p>
                <p class="sl__stock">In stock</p>
              </div>
              <VButton
                class="sl__add" size="sm" block :variant="cardAction(p) === addLabel ? 'secondary' : 'ghost'" :disabled="cardAction(p) !== addLabel || !!busy" :loading="busy === `plan:${p.id}`"
                :aria-label="`${cardAction(p)}: ${cardName(p)}`"
                @click="plan(p)"
              >{{ cardAction(p) }}</VButton>
            </li>
          </ul>
          <p v-if="resultsWhen" class="sl__note vk-num">{{ resultsWhen }}</p>
        </template>

        <div v-else-if="phase === 'empty' && results.suggestions?.length" class="xp__chips sl__chips" role="group" aria-label="Searches the demo has listings for">
          <button v-for="s in results.suggestions" :key="s" type="button" class="xp__chip" @click="suggest(s)"><Search :size="12" :stroke-width="2" aria-hidden="true" /> {{ s }}</button>
        </div>
        <VButton v-else-if="phase === 'error' && searchErr.again" class="sl__again" size="sm" variant="secondary" :icon="RefreshCw" @click="findProducts()">Try again</VButton>

        <p v-if="phase === 'results' || planned.length" class="xp__disclose">Listings from Channel3. Store links go through Channel3, and stores may pay it a commission{{ commission ? ` (up to ${commission}% on these)` : '' }}. Verdikt charges no fee on expenses.</p>
      </template>
    </section>

    <!-- a claim -->
    <section v-if="canClaim" ref="claimEl" class="xp__claim">
      <h3 class="xp__h3">Claim an expense</h3>
      <form class="xp__claim-form" @submit.prevent="claim">
        <div class="xp__grid">
          <VField label="Amount" for="xp-amount" :hint="fromList ? 'Use the total on your receipt' : `${$(t.left)} left`">
            <div class="vk-affix"><span class="vk-affix__pre">$</span><input id="xp-amount" v-model="amount" class="vk-input vk-num" inputmode="decimal" :placeholder="fromList ? (fromList.priceCents / 100).toFixed(2) : '0.00'" /></div>
          </VField>
          <VField label="Paid to" for="xp-merchant" optional>
            <input id="xp-merchant" v-model="merchant" class="vk-input" maxlength="80" placeholder="Who you paid" />
          </VField>
          <VField label="What for" for="xp-purpose">
            <input id="xp-purpose" v-model="purpose" class="vk-input" maxlength="200" placeholder="The domain for the site" />
          </VField>
        </div>
        <label class="xp__drop" :class="{ 'has-file': file || sample }">
          <input type="file" :accept="RECEIPT_ACCEPT" class="xp__file" @change="pick" />
          <Upload :size="16" :stroke-width="1.9" aria-hidden="true" />
          <span v-if="file">{{ file.name }} · <span class="vk-num">{{ Math.max(1, Math.round(file.size / 1024)) }} KB</span></span>
          <span v-else-if="sample">Sample: {{ SAMPLES.find((s) => s.key === sample)?.label }}</span>
          <span v-else>Attach the receipt — PDF, PNG, JPG or WebP, up to 5 MB</span>
        </label>
        <p v-if="fileError" class="vk-field__error" role="alert">{{ fileError }}</p>
        <div class="xp__claim-foot">
          <div v-if="SAMPLES.length" class="xp__samples">
            <span class="vk-faint">Demo receipts:</span>
            <template v-for="(s, i) in SAMPLES" :key="s.key">
              <span v-if="i" class="vk-faint">·</span>
              <button type="button" class="link" @click="useSample(s)">{{ s.label }}</button>
            </template>
          </div>
          <VButton type="submit" :icon="Receipt" :disabled="!claimValid || !!busy" :loading="busy === 'claim'">Claim {{ claimCents ? $(claimCents) : '' }}</VButton>
        </div>
        <p class="xp__hint vk-faint">The receipt is read on the server — the PDF's text, or OCR for a photo — and checked by rules: the amount is on it, it fits the budget, it's dated during this contract, it wasn't claimed before, and it's on the shopping list or something the budget covers. All pass and PayPal reimburses you now. {{ clientName }} sees every receipt.</p>
      </form>
    </section>
    <p v-else-if="role === 'freelancer' && t.budget && !funded && !settled" class="xp__wait vk-faint">Claims open once {{ clientName }} funds this milestone.</p>

    <!-- the claims -->
    <ol v-if="claims.length" class="xp__list">
      <li v-for="e in claims" :key="e.id" class="xp__item" :class="`is-${e.status}`">
        <div class="xp__item-head">
          <span class="xp__icon" aria-hidden="true"><Receipt :size="14" :stroke-width="1.9" /></span>
          <div class="xp__what">
            <p class="xp__merchant">{{ e.merchant || 'Expense' }}<span class="vk-faint"> · {{ e.purpose }}</span></p>
            <p class="xp__meta vk-faint">
              {{ who(e) }} · {{ timeAgo(e.createdAt) }}<template v-if="readVia(e)"> · {{ readVia(e) }}</template><template v-if="decided(e)"> · {{ decided(e) }}</template>
            </p>
          </div>
          <span class="xp__amt vk-num">{{ $(e.amountCents) }}</span>
          <VPill :tone="EXPENSE_STATUS[e.status]?.tone" :live="!!EXPENSE_STATUS[e.status]?.live" size="sm">{{ EXPENSE_STATUS[e.status]?.label || e.status }}</VPill>
        </div>

        <!-- what the receipt bought from the shopping list -->
        <p v-if="boughtOf(e).length" class="xp__from">
          <template v-for="b in boughtOf(e)" :key="b.id">
            <img v-if="b.image && !broken.has(b.image)" class="xp__from-img" :src="b.image" width="32" height="32" loading="lazy" decoding="async" referrerpolicy="no-referrer" alt="" @error="broken.add(b.image)" />
            <span v-else class="xp__from-img sl__img--none" aria-hidden="true"><Package :size="14" :stroke-width="1.6" /></span>
          </template>
          <span>From the shopping list: {{ boughtOf(e).map((b) => b.title).join(', ') }}</span>
        </p>
        <p v-if="e.status === 'checking' && !e.checks.length" class="xp__note"><span class="vk-spin" /> Reading the receipt and running the checks…</p>
        <details v-if="e.checks.length" class="xp__checks" :open="e.status !== 'approved'">
          <summary>{{ scored(e).filter((c) => c.status === 'pass').length }} of {{ scored(e).length }} checks passed</summary>
          <ol>
            <li v-for="c in e.checks" :key="c.key" :class="`is-${c.status}`">
              <span class="xp__ck" aria-hidden="true"><Check v-if="c.status === 'pass'" :size="11" :stroke-width="2.6" /><X v-else-if="c.status === 'fail'" :size="11" :stroke-width="2.6" /><Minus v-else :size="11" :stroke-width="2.6" /></span>
              <div>
                <p class="xp__ck-label">{{ c.label }}<span v-if="c.by === 'claude'" class="xp__by">Claude</span></p>
                <p class="xp__ck-obs">{{ c.observed }}<b v-if="c.fix && c.status !== 'pass'" class="xp__fix">{{ c.fix }}</b></p>
              </div>
            </li>
          </ol>
        </details>
        <p v-if="e.note" class="xp__note">{{ e.note }}</p>

        <div class="xp__foot">
          <button type="button" class="link xp__receipt" @click="openReceipt(e)"><FileText :size="14" :stroke-width="1.9" /> {{ e.receiptName || 'Receipt' }}</button>
          <span v-if="e.captureId" class="xp__pp vk-faint">PayPal capture <VCopy :value="e.captureId" /></span>
          <span v-if="e.payoutStatus" class="xp__pp" :class="{ 'is-paid': e.payoutStatus === 'SUCCESS' }">
            {{ e.payoutStatus === 'SUCCESS' ? `Paid ${$(e.amountCents)} to ${e.payoutEmail || freelancerName}` : e.payoutStatus === 'NEEDS_EMAIL' ? 'Payout waiting for a PayPal email' : `Payout ${e.payoutStatus.toLowerCase().replace('_', ' ')}` }}
          </span>
          <div v-if="role === 'client' && ['needs_client', 'error'].includes(e.status) && !settled" class="xp__decide">
            <VButton size="sm" variant="secondary" :loading="busy === `decline-${e.id}`" :disabled="!!busy" @click="act(e, 'decline')">Decline</VButton>
            <VButton size="sm" variant="ok" :icon="Check" :loading="busy === `approve-${e.id}`" :disabled="!!busy" @click="act(e, 'approve')">Reimburse {{ $(e.amountCents) }}</VButton>
          </div>
          <VButton v-if="['NEEDS_EMAIL', 'FAILED', 'RETURNED', 'UNCLAIMED', 'BLOCKED', 'DENIED'].includes(e.payoutStatus)" size="sm" variant="ghost" :icon="RefreshCw" :loading="busy === `payout-${e.id}`" @click="act(e, 'payout')">Try the payout again</VButton>
        </div>
      </li>
    </ol>
  </div>
</template>

<style scoped>
.xp { display: flex; flex-direction: column; gap: 22px; }
.xp__budget { display: flex; flex-direction: column; gap: 12px; }
.xp__head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.xp__title { margin: 0; font: 400 16px/22px var(--vk-font); color: var(--vk-ink); }
.xp__sub { margin: 4px 0 0; font: var(--vk-type-small); color: var(--vk-muted); max-width: 620px; }
.xp__cap { margin: 0; font: var(--vk-num-18); color: var(--vk-ink); white-space: nowrap; }
.xp__bar { position: relative; display: flex; height: 8px; border-radius: var(--vk-r-full); background: var(--vk-surface-2); border: 1px solid var(--vk-line); overflow: hidden; }
.xp__bar span { display: block; height: 100%; transition: width var(--vk-dur-3) var(--vk-ease-out); }
.xp__bar-spent { background: var(--vk-ok); }
.xp__bar-wait { background: var(--vk-warn); opacity: .7; }
.xp__row { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.xp__nums { margin: 0; font-size: 12px; color: var(--vk-ink-2); }
.xp__nums .is-spent { color: var(--vk-ok-ink); }
.xp__covers { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin: 0; font: var(--vk-type-small); }
.xp__tag { padding: 1px 8px; border: 1px solid var(--vk-line); border-radius: var(--vk-r-full); color: var(--vk-ink-2); }

.xp__form { display: flex; flex-direction: column; gap: 14px; padding: 16px; border: 1px solid var(--vk-line); border-radius: var(--vk-r-md); background: var(--vk-surface-2); }
.xp__form :deep(.vk-field) { max-width: 220px; }
.xp__pick-label { margin: 0 0 8px; font: var(--vk-type-small); color: var(--vk-ink); }
.xp__chips { display: flex; flex-wrap: wrap; gap: 6px; }
.xp__chip {
  display: inline-flex; align-items: center; gap: 4px; padding: 4px 10px; border: 1px solid var(--vk-line); border-radius: var(--vk-r-full);
  background: var(--vk-surface); font: var(--vk-type-small); color: var(--vk-ink-2); cursor: pointer;
}
.xp__chip:hover { border-color: var(--vk-line-strong); color: var(--vk-ink); }
.xp__chip.is-on { border-color: var(--vk-accent-line); background: var(--vk-accent-soft); color: var(--vk-accent-text); }
.xp__custom { min-width: 140px; padding: 4px 10px; border: 1px dashed var(--vk-line-strong); border-radius: var(--vk-r-full); background: transparent; font: var(--vk-type-small); color: var(--vk-ink); }
.xp__custom:focus { outline: none; border-style: solid; border-color: var(--vk-accent); }
.xp__actions { display: flex; justify-content: flex-end; gap: 8px; flex-wrap: wrap; }
.xp__est-btn { margin-right: auto; }
.xp__est { padding: 12px 14px; border: 1px solid var(--vk-line); border-radius: var(--vk-r-sm); background: var(--vk-surface); }
.xp__est-h { margin: 0 0 6px; font: var(--vk-type-small); color: var(--vk-ink); }
.xp__est ul { margin: 0; padding: 0; list-style: none; }
.xp__est li { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: 10px; padding: 5px 0; border-top: 1px solid var(--vk-line-subtle); font: var(--vk-type-small); color: var(--vk-ink-2); }
.xp__est-src { color: var(--vk-accent-text); text-decoration: none; }
.xp__est-src:hover { text-decoration: underline; }
.xp__est-foot { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; margin-top: 8px; font: var(--vk-type-small); }

/* the shopping list. Product images sit on --vk-media-bg (white in light, a light grey in dark) so packshots
   made for white pages keep their edges; every tile has the 1px line */
.xp__plan { display: flex; flex-direction: column; gap: 12px; padding-top: 18px; border-top: 1px solid var(--vk-line-subtle); }
.sl__head { display: flex; justify-content: space-between; align-items: baseline; gap: 6px 12px; flex-wrap: wrap; }
.sl__head .xp__h3 { margin: 0; }
.sl__head .xp__h3:focus { outline: none; }
.sl__sum { margin: 0; font: 400 12px/17px var(--vk-mono); color: var(--vk-muted); }
.sl__sub { margin: 0; font: var(--vk-type-small); color: var(--vk-muted); max-width: 70ch; }
.sl__warn { margin: 0; font: var(--vk-type-small); color: var(--vk-warn-ink); }
.sl__list { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 8px; }
.sl__row {
  display: grid; grid-template-columns: 48px minmax(0, 1fr) auto; align-items: center; gap: 12px; padding: 10px 12px;
  border: 1px solid var(--vk-line); border-radius: var(--vk-r-md); background: var(--vk-surface);
}
.sl__row:focus-visible { outline: 2px solid var(--vk-accent); outline-offset: 2px; }
.sl__img { display: grid; place-items: center; width: 48px; height: 48px; object-fit: contain; border-radius: 8px; background: var(--vk-media-bg); border: 1px solid var(--vk-line); }
.sl__img--none { color: var(--vk-faint); background: var(--vk-surface-2); }
.sl__body { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.sl__title { font: var(--vk-type-dense); color: var(--vk-ink); text-decoration: none; overflow-wrap: anywhere; }
.sl__title:hover { color: var(--vk-accent-text); text-decoration: underline; text-underline-offset: 3px; }
.sl__title--clamp { overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.sl__meta { margin: 0; font: var(--vk-type-small); color: var(--vk-muted); overflow-wrap: anywhere; }
.sl__band { margin: 0; font: var(--vk-type-small); color: var(--vk-faint); }
.sl__side { display: flex; flex-direction: column; align-items: flex-end; gap: 8px; }
.sl__acts { display: flex; gap: 6px; flex-wrap: wrap; justify-content: flex-end; }

.sl__search { display: flex; align-items: flex-end; gap: 8px; flex-wrap: wrap; }
.sl__field { flex: 1; min-width: 220px; }
.sl__note { margin: 0; font: var(--vk-type-small); color: var(--vk-faint); }
.sl__note.vk-num { font-size: 12px; }
/* empty, the live region leaves the layout but stays in the accessibility tree, so its next text is announced */
.sl__live:empty { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
.sl__rhead { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
.sl__count { margin: 0; font: var(--vk-type-small); color: var(--vk-ink-2); }
.sl__error { margin: 0; font: var(--vk-type-small); color: var(--vk-ink-2); }
.sl__again { align-self: flex-start; }
.sl__chips { margin-top: -4px; }
.sl__loading { display: flex; flex-direction: column; gap: 10px; }
.sl__grid { margin: 0; padding: 0; list-style: none; display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 10px; }
.sl__card { display: flex; flex-direction: column; gap: 10px; padding: 12px; border: 1px solid var(--vk-line); border-radius: var(--vk-r-md); background: var(--vk-surface); }
.sl__tile { position: relative; display: grid; place-items: center; height: 88px; border-radius: var(--vk-r-sm); background: var(--vk-media-bg); border: 1px solid var(--vk-line); color: var(--vk-faint); overflow: hidden; }
/* a definite box: the whole packshot fits the tile, never a slice of it */
.sl__tile img { position: absolute; inset: 4px; width: calc(100% - 8px); height: calc(100% - 8px); object-fit: contain; }
.sl__card-body { display: flex; flex-direction: column; gap: 3px; min-width: 0; flex: 1; }
.sl__card-body p { margin: 0; }
.sl__brand { font: 400 12px/16px var(--vk-font); color: var(--vk-faint); }
.sl__price { font: var(--vk-num-13); color: var(--vk-ink); }
.sl__was { margin-left: 6px; font-size: 12px; color: var(--vk-faint); }
.sl__store, .sl__stock { font: var(--vk-type-small); color: var(--vk-muted); overflow-wrap: anywhere; }
.sl__add { margin-top: auto; }
/* the tile's own media background would hide the shimmer (a white or bright slab): the skeleton's wins here */
.is-skel .sl__tile {
  border-color: transparent;
  background: linear-gradient(90deg, var(--vk-surface-2) 0%, var(--vk-hover) 40%, var(--vk-surface-2) 80%) var(--vk-surface-2);
  background-size: 200% 100%;
}
.sl__skel { display: block; height: 12px; }
.sl__skel--s { width: 40%; }
.sl__skel--m { width: 60%; }
.sl__skel--btn { height: var(--vk-h-sm); border-radius: var(--vk-r-full); }
.xp__disclose { margin: 0; font: var(--vk-type-small); color: var(--vk-faint); }

/* a claim that bought list items */
.xp__from { display: flex; align-items: center; gap: 8px; margin: 0; font: var(--vk-type-small); color: var(--vk-faint); }
.xp__from-img { display: grid; place-items: center; flex: none; width: 32px; height: 32px; object-fit: contain; border-radius: 6px; background: var(--vk-media-bg); border: 1px solid var(--vk-line); }
.xp__claim { padding-top: 18px; border-top: 1px solid var(--vk-line-subtle); }
.xp__h3 { margin: 0 0 12px; font: 400 16px/22px var(--vk-font); color: var(--vk-ink); }
.xp__claim-form { display: flex; flex-direction: column; gap: 12px; }
.xp__grid { display: grid; grid-template-columns: 140px 1fr 1.4fr; gap: 12px; }
.xp__drop {
  position: relative; display: flex; align-items: center; gap: 8px; padding: 14px 16px; border: 1px dashed var(--vk-line-strong);
  border-radius: var(--vk-r-md); font: var(--vk-type-small); color: var(--vk-muted); cursor: pointer;
}
.xp__drop:hover, .xp__drop:focus-within { border-color: var(--vk-accent); color: var(--vk-ink); }
.xp__drop.has-file { border-style: solid; color: var(--vk-ink); }
.xp__file { position: absolute; inset: 0; opacity: 0; cursor: pointer; }
.xp__claim-foot { display: flex; align-items: center; justify-content: flex-end; gap: 10px; flex-wrap: wrap; }
.xp__samples { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-right: auto; font: var(--vk-type-small); }
.xp__hint { margin: 0; font: var(--vk-type-small); }
.xp__wait { margin: 0; font: var(--vk-type-small); }
.link { padding: 0; border: 0; background: none; font: inherit; color: var(--vk-accent-text); cursor: pointer; }
.link:hover { text-decoration: underline; text-underline-offset: 3px; }

.xp__list { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 10px; }
.xp__item { display: flex; flex-direction: column; gap: 10px; padding: 14px 16px; border: 1px solid var(--vk-line); border-radius: var(--vk-r-md); }
.xp__item-head { display: grid; grid-template-columns: 26px minmax(0, 1fr) auto auto; align-items: center; gap: 10px; }
.xp__icon { display: grid; place-items: center; width: 26px; height: 26px; border-radius: 50%; border: 1px solid var(--vk-line); color: var(--vk-muted); }
.is-approved .xp__icon { color: var(--vk-ok-ink); background: var(--vk-ok-soft); border-color: color-mix(in srgb, var(--vk-ok) 35%, transparent); }
.is-rejected .xp__icon, .is-error .xp__icon { color: var(--vk-danger-ink); background: var(--vk-danger-soft); border-color: color-mix(in srgb, var(--vk-danger) 35%, transparent); }
.xp__what { min-width: 0; }
.xp__merchant { margin: 0; font: var(--vk-type-dense); color: var(--vk-ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.xp__meta { margin: 2px 0 0; font: var(--vk-type-small); }
.xp__amt { font: var(--vk-num-13); color: var(--vk-ink); }
.is-approved .xp__amt { color: var(--vk-ok-ink); }

.xp__checks summary { cursor: pointer; font: var(--vk-type-small); color: var(--vk-muted); }
.xp__checks ol { margin: 8px 0 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 8px; }
.xp__checks li { display: flex; gap: 10px; }
.xp__ck { display: grid; place-items: center; flex: none; width: 18px; height: 18px; margin-top: 1px; border-radius: 50%; border: 1px solid var(--vk-line); color: var(--vk-faint); }
.xp__checks li.is-pass .xp__ck { color: var(--vk-ok-ink); background: var(--vk-ok-soft); border-color: color-mix(in srgb, var(--vk-ok) 35%, transparent); }
.xp__checks li.is-fail .xp__ck { color: var(--vk-danger-ink); background: var(--vk-danger-soft); border-color: color-mix(in srgb, var(--vk-danger) 35%, transparent); }
/* an 'info' row explains (which list items the store sells) and never decides */
.xp__checks li.is-info .xp__ck { border-style: dashed; color: var(--vk-faint); }
.xp__checks li.is-info .xp__ck-label { color: var(--vk-muted); }
.xp__ck-label { margin: 0; font: var(--vk-type-small); color: var(--vk-ink); }
.xp__ck-obs { margin: 1px 0 0; font: var(--vk-type-small); color: var(--vk-ink-2); }
.xp__fix { margin-left: .3em; font-weight: 400; color: var(--vk-ink); }
.xp__by { margin-left: 6px; padding: 0 6px; border: 1px solid var(--vk-line); border-radius: var(--vk-r-full); font: 400 11px/16px var(--vk-mono); color: var(--vk-muted); }
.xp__note { margin: 0; font: var(--vk-type-small); color: var(--vk-ink-2); }
.xp__note .vk-spin { margin-right: 6px; }

.xp__foot { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; padding-top: 10px; border-top: 1px solid var(--vk-line-subtle); font: var(--vk-type-small); }
.xp__receipt { display: inline-flex; align-items: center; gap: 5px; }
.xp__pp { display: inline-flex; align-items: center; gap: 6px; color: var(--vk-muted); }
.xp__pp.is-paid { color: var(--vk-ok-ink); }
.xp__decide { display: flex; gap: 8px; margin-left: auto; }

@media (max-width: 720px) {
  .xp__grid { grid-template-columns: 1fr; }
  .xp__item-head { grid-template-columns: 26px minmax(0, 1fr) auto; }
  .xp__item-head > :last-child { grid-column: 2 / -1; justify-self: start; }
  .xp__decide { margin-left: 0; }
}
/* phone: list actions wrap under the row, result cards become rows (image left, button below) */
@media (max-width: 560px) {
  .xp__head { flex-direction: column; gap: 4px; }
  .sl__row { grid-template-columns: 48px minmax(0, 1fr); }
  .sl__side { grid-column: 1 / -1; flex-direction: row; flex-wrap: wrap; align-items: center; justify-content: space-between; }
  .sl__acts { justify-content: flex-start; }
  .sl__grid { grid-template-columns: minmax(0, 1fr); }
  .sl__card { display: grid; grid-template-columns: 72px minmax(0, 1fr); align-items: start; gap: 8px 12px; }
  .sl__tile { width: 72px; height: 72px; }
  .sl__add { grid-column: 1 / -1; }
  .sl__rhead { flex-wrap: wrap; }
}
</style>
