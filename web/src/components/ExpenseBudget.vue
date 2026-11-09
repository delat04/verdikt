<!--
  ExpenseBudget — what the work may spend (a domain, hosting, fonts…), agreed with the terms and held in the
  same PayPal hold as the milestone. The freelancer (or their agent) claims against receipts; deterministic
  checks read each one and PayPal reimburses it at once when they all pass. The client decides only what the
  checks can't settle. Unused budget goes back to the client when the milestone settles.
-->
<script setup>
import { ref, computed, watch } from 'vue'
import { Receipt, Check, X, Minus, FileText, Upload, RefreshCw, Scale, Search } from 'lucide-vue-next'
import VButton from './ui/VButton.vue'
import VField from './ui/VField.vue'
import VPill from './ui/VPill.vue'
import VCopy from './ui/VCopy.vue'
import { api, isDemo } from '@/services'
import { toast } from '@/composables/useToast'
import { money, toCents, timeAgo, firstName, hostOf } from '@/domain/format'
import { HELD } from '@/domain/milestone'
import { COVER_SUGGESTIONS, EXPENSE_STATUS, RECEIPT_ACCEPT, MAX_RECEIPT_BYTES, expenseTotals, fileToBase64 } from '@/domain/expenses'

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

// ---- planned purchases: real products from live store listings (Channel3), pinned to the budget. A receipt from
// the same store at about the listed price is the plan and reimburses on its own; anything else waits for the client
const local = ref(null)       // the plan as the last pin/unpin returned it, until the milestone itself catches up
watch(() => JSON.stringify(props.milestone.expenseProducts || []), () => { local.value = null })
const planned = computed(() => local.value ?? props.milestone.expenseProducts ?? [])
const plannedTotal = computed(() => planned.value.reduce((s, p) => s + p.priceCents, 0))
const isPlanned = (id) => planned.value.some((p) => p.id === id)
const query = ref('')
const results = ref(null)
const plannedBy = (p) => (p.plannedBy === props.role ? 'you' : p.plannedBy === 'client' ? clientName.value : freelancerName.value)
async function findProducts() {
  busy.value = 'search'
  try {
    results.value = await api.searchBudgetProducts(props.milestone.id, query.value)
  } catch (e) {
    toast(e.message, { tone: 'danger' })
  } finally {
    busy.value = ''
  }
}
async function plan(p) {
  busy.value = `plan:${p.id}`
  try {
    local.value = (await api.planProduct(props.milestone.id, p.id)).planned
    toast(`Planned: ${p.title.length > 48 ? `${p.title.slice(0, 48)}…` : p.title}`)
  } catch (e) {
    toast(e.message, { tone: 'danger' })
  } finally {
    busy.value = ''
  }
}
async function unplan(p) {
  busy.value = `unplan:${p.id}`
  try {
    local.value = (await api.unplanProduct(props.milestone.id, p.id)).planned
  } catch (e) {
    toast(e.message, { tone: 'danger' })
  } finally {
    busy.value = ''
  }
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
const SAMPLES = isDemo ? [
  { key: 'domain', label: 'domain receipt', amount: '32.98', merchant: 'Domainly Registrar', purpose: 'northbrew.coffee for a year' },
  { key: 'inflated', label: 'hosting invoice, amount inflated', amount: '45.00', merchant: 'Stackhost', purpose: 'Hosting for the shop' },
  { key: 'lunch', label: 'lunch receipt', amount: '18.40', merchant: 'Corner Deli', purpose: 'Working lunch' },
  { key: 'blurry', label: 'blurry photo', amount: '12.00', merchant: 'Fontshop', purpose: 'Display font licence' },
  { key: 'scanner', label: 'scanner receipt (planned at Walmart)', amount: '37.02', merchant: 'Walmart', purpose: 'QR scanner for the counter' },
] : []
function useSample(s) {
  sample.value = s.key
  file.value = null
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
    file.value = null
  } catch (e) {
    toast(e.message, { tone: 'danger' })
  } finally {
    busy.value = ''
  }
}

// ---- the claims
const claims = computed(() => [...(props.milestone.expenses || [])].reverse())
const who = (e) => (e.viaAgent ? `${freelancerName.value}'s agent` : props.role === 'freelancer' ? 'You' : freelancerName.value)
const decided = (e) => ({
  rules: 'decided by rules, no model',
  claude: 'coverage read by Claude',
  client: e.status === 'declined' ? `declined by ${props.role === 'client' ? 'you' : clientName.value}` : `approved by ${props.role === 'client' ? 'you' : clientName.value}`,
}[e.decidedBy] || '')
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

    <!-- planned purchases, from live store listings -->
    <section v-if="t.budget && !editing && (planned.length || (!settled && role))" class="xp__plan">
      <div class="xp__plan-head">
        <h3 class="xp__h3">Planned purchases</h3>
        <span v-if="planned.length" class="xp__plan-sum vk-num">{{ $(plannedTotal) }} planned of {{ $(t.budget) }}</span>
      </div>
      <p class="xp__plan-sub">Pin real products from live store listings. A receipt from the same store at about the listed price is reimbursed on its own; anything off the plan waits for {{ clientName }}.</p>
      <ul v-if="planned.length" class="xp__planned">
        <li v-for="p in planned" :key="p.id">
          <img v-if="p.image" :src="p.image" alt="" />
          <div class="xp__p-body">
            <a :href="p.url" target="_blank" rel="noopener sponsored" class="xp__p-title">{{ p.title }}</a>
            <span class="xp__p-meta">{{ p.domain }} · listed at <span class="vk-num">{{ $(p.priceCents) }}</span> · planned by {{ plannedBy(p) }}{{ p.viaAgent ? ' (agent)' : '' }}</span>
          </div>
          <VButton v-if="!settled && role" size="sm" variant="ghost" :loading="busy === `unplan:${p.id}`" :disabled="!!busy" @click="unplan(p)">Remove</VButton>
        </li>
      </ul>
      <form v-if="!settled && role" class="xp__shop" @submit.prevent="findProducts">
        <input v-model="query" class="vk-input" maxlength="120" placeholder="What does the work need to buy? e.g. 2D barcode scanner" aria-label="Product to look for" />
        <VButton type="submit" variant="secondary" :icon="Search" :loading="busy === 'search'" :disabled="query.trim().length < 3 || (!!busy && busy !== 'search')">Find in stores</VButton>
      </form>
      <template v-if="results">
        <p v-if="!results.products.length" class="xp__plan-sub">Nothing in stock under {{ $(results.leftCents) }} for “{{ results.query }}”.</p>
        <ul v-else class="xp__results">
          <li v-for="p in results.products" :key="p.id">
            <img v-if="p.image" :src="p.image" alt="" />
            <a :href="p.url" target="_blank" rel="noopener sponsored" class="xp__p-title">{{ p.title }}</a>
            <span class="xp__p-meta"><span class="vk-num xp__price">{{ $(p.priceCents) }}</span> · {{ p.domain }}</span>
            <VButton size="sm" :variant="isPlanned(p.id) ? 'ghost' : 'secondary'" :disabled="isPlanned(p.id) || !!busy" :loading="busy === `plan:${p.id}`" @click="plan(p)">{{ isPlanned(p.id) ? 'Planned' : 'Plan this' }}</VButton>
          </li>
        </ul>
      </template>
      <p v-if="results || planned.length" class="xp__disclose">Listings from Channel3{{ results?.savedOn ? `, saved on ${results.savedOn} for the demo` : '' }}, in stock and within what's left of the budget. Links go through Channel3 and may earn a commission.</p>
    </section>

    <!-- a claim -->
    <section v-if="canClaim" class="xp__claim">
      <h3 class="xp__h3">Claim an expense</h3>
      <form class="xp__claim-form" @submit.prevent="claim">
        <div class="xp__grid">
          <VField label="Amount" for="xp-amount" :hint="`${$(t.left)} left`">
            <div class="vk-affix"><span class="vk-affix__pre">$</span><input id="xp-amount" v-model="amount" class="vk-input vk-num" inputmode="decimal" placeholder="0.00" /></div>
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
        <p class="xp__hint vk-faint">The receipt is read on the server — the PDF's text, or OCR for a photo — and checked by rules: the amount is on it, it fits the budget, it's dated during this contract, it wasn't claimed before, and it's something the budget covers. All pass → PayPal reimburses you now. {{ clientName }} sees every receipt.</p>
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

        <p v-if="e.status === 'checking' && !e.checks.length" class="xp__note"><span class="vk-spin" /> Reading the receipt and running the checks…</p>
        <details v-if="e.checks.length" class="xp__checks" :open="e.status !== 'approved'">
          <summary>{{ e.checks.filter((c) => c.status === 'pass').length }} of {{ e.checks.length }} checks passed</summary>
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

.xp__plan { display: flex; flex-direction: column; gap: 12px; padding-top: 18px; border-top: 1px solid var(--vk-line-subtle); }
.xp__plan-head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; flex-wrap: wrap; }
.xp__plan-head .xp__h3 { margin: 0; }
.xp__plan-sum { font: var(--vk-type-small); color: var(--vk-muted); }
.xp__plan-sub { margin: 0; font: var(--vk-type-small); color: var(--vk-muted); max-width: 70ch; }
.xp__planned { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 8px; }
.xp__planned li { display: flex; align-items: center; gap: 12px; padding: 10px 12px; border: 1px solid var(--vk-line); border-radius: var(--vk-r-md); background: var(--vk-surface); }
.xp__planned img, .xp__results img { width: 52px; height: 52px; flex: none; object-fit: contain; border-radius: 8px; background: #fff; border: 1px solid var(--vk-line-subtle); }
.xp__p-body { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
.xp__p-title { font: var(--vk-type-dense); color: var(--vk-ink); text-decoration: none; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.xp__p-title:hover { color: var(--vk-accent-text); text-decoration: underline; }
.xp__p-meta { font: var(--vk-type-small); color: var(--vk-muted); }
.xp__shop { display: flex; gap: 8px; flex-wrap: wrap; }
.xp__shop .vk-input { flex: 1; min-width: 220px; }
.xp__results { margin: 0; padding: 0; list-style: none; display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 10px; }
.xp__results li { display: flex; flex-direction: column; gap: 6px; padding: 12px; border: 1px solid var(--vk-line); border-radius: var(--vk-r-md); background: var(--vk-surface); }
.xp__results li > :last-child { align-self: flex-start; margin-top: auto; }
.xp__price { color: var(--vk-ink); }
.xp__disclose { margin: 0; font: var(--vk-type-small); color: var(--vk-faint); }
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
</style>
