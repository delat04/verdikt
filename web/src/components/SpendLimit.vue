<!--
  SpendLimit — the person approves one PayPal hold, once, so their AI agent can hire within it: a total, the
  most for any one job, and an end date. Each job's hold is earmarked from it without asking again; PayPal
  captures a job's share only when its checks pass, a failed job frees it, and what's never spent is voided
  when the limit ends. Live: PayPal JS SDK buttons. Demo: a simulated sandbox approval, clearly labelled.
-->
<script setup>
import { ref, computed, watch, nextTick, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { Wallet, ShieldCheck, Undo2, CalendarClock, Bot } from 'lucide-vue-next'
import VCard from '@/components/ui/VCard.vue'
import VButton from '@/components/ui/VButton.vue'
import VField from '@/components/ui/VField.vue'
import VSegmented from '@/components/ui/VSegmented.vue'
import VPill from '@/components/ui/VPill.vue'
import { useLive } from '@/composables/useLive'
import { useAuthStore } from '@/stores/auth'
import { api, isDemo } from '@/services'
import { toast } from '@/composables/useToast'
import { money, toCents, shortDate } from '@/domain/format'
import { loadPayPal } from '@/lib/paypalSdk'

const auth = useAuthStore()
const route = useRoute()
const { data, reload } = useLive(() => api.listSpendLimits())
const current = computed(() => data.value?.current || null)
const live = computed(() => ['active', 'closing'].includes(current.value?.status) ? current.value : null)
const past = computed(() => data.value?.past || [])

// ---- set one up
const form = ref({ cap: '1000', perJob: '600', days: 14, note: '' })
const DAYS = [{ value: 7, label: '7 days' }, { value: 14, label: '14 days' }, { value: 28, label: '28 days' }]
const capCents = computed(() => toCents(form.value.cap))
const perJobCents = computed(() => toCents(form.value.perJob))
const invalid = computed(() => {
  if (!(capCents.value >= 100)) return 'Set a total of at least $1'
  if (!(perJobCents.value >= 100)) return 'Set the most for one job'
  if (perJobCents.value > capCents.value) return 'The most for one job has to fit inside the total'
  return ''
})
const setting = ref(false)    // the PayPal step is showing
const busy = ref('')
const error = ref('')
const buttons = ref(null)
const body = () => ({ capCents: capCents.value, perJobCents: perJobCents.value, days: form.value.days, note: form.value.note.trim() })

async function start() {
  error.value = ''
  setting.value = true
  if (isDemo) return
  try {
    const paypal = await loadPayPal('USD')
    await nextTick()
    if (!buttons.value) return
    buttons.value.innerHTML = ''
    let id = null
    await paypal.Buttons({
      style: { layout: 'vertical', shape: 'pill', label: 'paypal', height: 44 },
      createOrder: async () => {
        const r = await api.createSpendLimit(body())
        id = r.id
        return r.orderId
      },
      onApprove: async () => {
        busy.value = 'approve'
        try {
          await api.authorizeSpendLimit(id)
          approved()
        } catch (e) {
          error.value = e.message
        } finally {
          busy.value = ''
        }
      },
      onError: (e) => { error.value = e?.message || 'PayPal could not place the hold.' },
    }).render(buttons.value)
  } catch (e) {
    error.value = e.message
  }
}
async function approveDemo() {
  busy.value = 'approve'
  error.value = ''
  try {
    const r = await api.createSpendLimit(body())
    await api.authorizeSpendLimit(r.id)
    approved()
  } catch (e) {
    error.value = e.message
  } finally {
    busy.value = ''
  }
}
function approved() {
  setting.value = false
  toast(`Your agent can now hire within ${money(capCents.value)} — PayPal holds it, nothing is charged yet`, { tone: 'ok' })
  reload()
}

// ---- the live limit
const share = (cents) => (live.value?.capCents ? `${Math.min(100, (cents / live.value.capCents) * 100)}%` : '0%')
const heldJobs = computed(() => (live.value?.holds || []).filter((h) => h.reservedCents > 0).length)
const STATUS = {
  funded: { label: 'Held', tone: 'accent' }, submitted: { label: 'Checking', tone: 'accent' }, verifying: { label: 'Checking', tone: 'accent' },
  passed: { label: 'Passed', tone: 'ok' }, failed: { label: 'Failed, still held', tone: 'warn' }, disputed: { label: 'Disputed', tone: 'warn' },
  released: { label: 'Paid', tone: 'ok' }, refunded: { label: 'Freed', tone: 'neutral' },
}
const confirming = ref(false)
async function end() {
  busy.value = 'end'
  try {
    const l = await api.endSpendLimit(live.value.id)
    toast(l.status === 'closed' ? `Limit closed — PayPal voided ${money(l.voidedCents || 0)} that was never spent` : 'No new holds from the limit. It closes once its jobs settle.')
    confirming.value = false
    reload()
  } catch (e) {
    toast(e.message, { tone: 'danger' })
  } finally {
    busy.value = ''
  }
}

// back from a PayPal redirect (popup blocked): say what happened
onMounted(() => { if (route.query.limit === 'cancelled') toast('PayPal approval cancelled — no limit was set') })
watch(current, (c) => { if (c?.status === 'awaiting_approval' && !setting.value) form.value = { ...form.value, cap: String(c.capCents / 100), perJob: String(c.perJobCents / 100), note: c.note } })
</script>

<template>
  <VCard id="spending-limit" title="Spending limit" sub="Approve one PayPal hold, once. Your AI agent hires within it, and you're charged only for work that passes its checks.">
    <!-- an active limit -->
    <div v-if="live" class="sl">
      <div class="sl__top">
        <div>
          <p class="sl__left vk-num">{{ money(live.availableCents, live.currency) }}</p>
          <p class="sl__of">left of {{ money(live.capCents, live.currency) }} · at most {{ money(live.perJobCents, live.currency) }} for one job · ends {{ shortDate(live.endsAt) }}</p>
        </div>
        <VPill :tone="live.status === 'active' ? 'accent' : 'neutral'" dot>{{ live.status === 'active' ? 'Active' : 'Ending' }}</VPill>
      </div>
      <div class="sl__bar" role="img" :aria-label="`${money(live.capturedCents)} paid, ${money(live.reservedCents)} held for jobs, ${money(live.availableCents)} left`">
        <span class="sl__paid" :style="{ width: share(live.capturedCents) }" />
        <span class="sl__held" :style="{ width: share(live.reservedCents) }" />
      </div>
      <ul class="sl__legend">
        <li><span class="sl__key sl__key--paid" /> Paid for passing work <span class="vk-num">{{ money(live.capturedCents, live.currency) }}</span></li>
        <li><span class="sl__key sl__key--held" /> Held for {{ heldJobs }} job{{ heldJobs === 1 ? '' : 's' }} <span class="vk-num">{{ money(live.reservedCents, live.currency) }}</span></li>
        <li><span class="sl__key" /> Left <span class="vk-num">{{ money(live.availableCents, live.currency) }}</span></li>
      </ul>
      <p v-if="live.note" class="sl__note"><Bot :size="14" aria-hidden="true" /> Your agent reads what it's for: “{{ live.note }}”</p>

      <ul v-if="live.holds.length" class="sl__jobs">
        <li v-for="h in live.holds" :key="h.milestoneId">
          <RouterLink :to="`/contracts/${h.contractId}`" class="sl__job">
            <span class="sl__job-name">{{ h.contract }}</span>
            <span class="sl__job-meta">{{ h.title }}{{ h.freelancer ? ` · ${h.freelancer}` : '' }}</span>
          </RouterLink>
          <VPill :tone="STATUS[h.status]?.tone || 'neutral'">{{ STATUS[h.status]?.label || h.status }}</VPill>
          <span class="sl__amt vk-num">{{ money(h.capturedCents || h.holdCents, live.currency) }}</span>
        </li>
      </ul>
      <p v-else class="sl__empty">Nothing held yet. When your agent funds a milestone, it's held from here without asking you again.</p>

      <p v-if="live.status === 'closing'" class="sl__note">Ending: no new holds. It closes, and PayPal voids what was never spent, once {{ heldJobs }} held job{{ heldJobs === 1 ? '' : 's' }} settle{{ heldJobs === 1 ? 's' : '' }}.</p>
      <div v-else-if="confirming" class="sl__confirm">
        <p>Your agent can't hold anything new. Jobs already held finish as signed; then PayPal voids the rest.</p>
        <div class="sl__actions">
          <VButton variant="secondary" :loading="busy === 'end'" @click="end">End the limit</VButton>
          <VButton variant="ghost" @click="confirming = false">Keep it</VButton>
        </div>
      </div>
      <div v-else><VButton variant="secondary" size="sm" @click="confirming = true">End the limit</VButton></div>
    </div>

    <!-- set one up -->
    <div v-else class="sl">
      <ul class="sl__facts">
        <li><ShieldCheck :size="15" aria-hidden="true" /> Your agent can fund a milestone only within these limits. It can't raise them, or set up a limit itself.</li>
        <li><Undo2 :size="15" aria-hidden="true" /> PayPal is charged for a job only when its checks pass. A failed job's share goes back into the limit.</li>
        <li><CalendarClock :size="15" aria-hidden="true" /> When it ends, PayPal voids whatever was never spent. The whole amount is held on your PayPal until then.</li>
      </ul>
      <div class="sl__grid">
        <VField label="Total" for="sl-cap"><div class="vk-affix"><span class="vk-affix__pre">$</span><input id="sl-cap" v-model="form.cap" class="vk-input vk-num" inputmode="decimal" :disabled="setting" /></div></VField>
        <VField label="Most for one job" for="sl-job"><div class="vk-affix"><span class="vk-affix__pre">$</span><input id="sl-job" v-model="form.perJob" class="vk-input vk-num" inputmode="decimal" :disabled="setting" /></div></VField>
      </div>
      <VField label="Lasts"><VSegmented v-model="form.days" :options="DAYS" label="How long the limit lasts" /></VField>
      <VField label="What it's for" for="sl-note" hint="Your agent reads this before it hires." optional>
        <input id="sl-note" v-model="form.note" class="vk-input" maxlength="280" placeholder="Small website jobs for Northbrew" :disabled="setting" />
      </VField>
      <p v-if="invalid && (form.cap || form.perJob)" class="vk-field__error">{{ invalid }}</p>

      <div v-if="!setting"><VButton :icon="Wallet" :disabled="!!invalid" @click="start">Approve {{ money(capCents || 0) }} on PayPal</VButton></div>
      <template v-else>
        <!-- demo: simulated PayPal sandbox -->
        <div v-if="isDemo" class="pp">
          <div class="pp__head">
            <span class="pp__logo">PayPal</span>
            <span class="vk-eyebrow">Sandbox · simulated in demo</span>
          </div>
          <div class="pp__row"><span class="vk-muted">Pay with</span><span class="vk-num">{{ auth.user?.email || 'sandbox-buyer@personal.example' }}</span></div>
          <div class="pp__row"><span class="vk-muted">Authorize, up to</span><span class="vk-num">{{ money(capCents) }}</span></div>
          <VButton block size="lg" :loading="busy === 'approve'" @click="approveDemo">Approve the limit</VButton>
        </div>
        <div v-else>
          <div ref="buttons" class="pp-live" />
          <p v-if="busy === 'approve'" class="vk-faint sl__busy"><span class="vk-spin" /> Placing the hold…</p>
        </div>
        <div><VButton variant="ghost" size="sm" :disabled="!!busy" @click="setting = false">Change the limits</VButton></div>
      </template>
      <p v-if="error" class="vk-field__error" role="alert">{{ error }}</p>
    </div>

    <ul v-if="past.length" class="sl__past" aria-label="Past limits">
      <li v-for="l in past" :key="l.id">
        <span>{{ money(l.capCents, l.currency) }} · {{ shortDate(l.createdAt) }}</span>
        <span class="vk-faint">{{ l.status === 'closed' && l.paypal.authorizationId ? `charged ${money(l.capturedCents || 0, l.currency)} · voided ${money(l.voidedCents || 0, l.currency)}` : l.closedReason || 'Ended' }}</span>
      </li>
    </ul>
  </VCard>
</template>

<style scoped>
.sl { display: flex; flex-direction: column; gap: 16px; }
.sl__facts { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 8px; }
.sl__facts li { display: flex; gap: 10px; font: var(--vk-type-dense); color: var(--vk-ink-2); }
.sl__facts svg { flex: none; margin-top: 2px; color: var(--vk-accent-text); }
.sl__grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.sl__top { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.sl__left { margin: 0; font: var(--vk-num-40); letter-spacing: -.02em; color: var(--vk-ink); }
.sl__of { margin: 4px 0 0; font: var(--vk-type-small); color: var(--vk-muted); }
.sl__bar { display: flex; height: 8px; border-radius: var(--vk-r-full); background: var(--vk-surface-2); border: 1px solid var(--vk-line-subtle); overflow: hidden; }
.sl__paid { background: var(--vk-ok); }
.sl__held { background: var(--vk-accent); }
.sl__legend { margin: 0; padding: 0; list-style: none; display: flex; flex-wrap: wrap; gap: 6px 18px; font: var(--vk-type-small); color: var(--vk-ink-2); }
.sl__legend li { display: inline-flex; align-items: center; gap: 6px; }
.sl__legend .vk-num { color: var(--vk-ink); }
.sl__key { width: 8px; height: 8px; border-radius: 50%; background: var(--vk-surface-2); border: 1px solid var(--vk-line-strong); }
.sl__key--paid { background: var(--vk-ok); border-color: var(--vk-ok); }
.sl__key--held { background: var(--vk-accent); border-color: var(--vk-accent); }
.sl__note { display: flex; align-items: flex-start; gap: 8px; margin: 0; font: var(--vk-type-small); color: var(--vk-ink-2); }
.sl__note svg { flex: none; margin-top: 2px; color: var(--vk-accent-text); }
.sl__jobs { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; }
.sl__jobs li { display: flex; align-items: center; gap: 12px; padding: 10px 0; border-top: 1px solid var(--vk-line-subtle); }
.sl__job { flex: 1; min-width: 0; display: flex; flex-direction: column; text-decoration: none; }
.sl__job-name { font: var(--vk-type-dense); color: var(--vk-ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sl__job:hover .sl__job-name { text-decoration: underline; }
.sl__job-meta { font: var(--vk-type-small); color: var(--vk-muted); }
.sl__amt { font: var(--vk-type-dense); color: var(--vk-ink); }
.sl__empty { margin: 0; font: var(--vk-type-small); color: var(--vk-muted); }
.sl__confirm { display: flex; flex-direction: column; gap: 10px; padding: 14px 16px; border: 1px solid var(--vk-line); border-radius: var(--vk-r-md); background: var(--vk-surface-2); }
.sl__confirm p { margin: 0; font: var(--vk-type-dense); color: var(--vk-ink-2); }
.sl__actions { display: flex; gap: 8px; }
.sl__past { margin: 16px 0 0; padding: 12px 0 0; list-style: none; display: flex; flex-direction: column; gap: 6px; border-top: 1px solid var(--vk-line-subtle); font: var(--vk-type-small); color: var(--vk-ink-2); }
.sl__past li { display: flex; justify-content: space-between; gap: 12px; }
.pp { display: flex; flex-direction: column; gap: 10px; padding: 16px; border: 1px solid var(--vk-line); border-radius: var(--vk-r-md); background: var(--vk-surface-2); }
.pp__head { display: flex; align-items: center; justify-content: space-between; }
.pp__logo { font: italic 400 18px/1 var(--vk-font); color: color-mix(in srgb, #003087 55%, var(--vk-ink)); letter-spacing: -.02em; }
.pp__row { display: flex; justify-content: space-between; gap: 12px; font: var(--vk-type-dense); }
.pp-live { min-height: 52px; }
.sl__busy { display: flex; align-items: center; gap: 8px; font: var(--vk-type-small); }
@media (max-width: 560px) { .sl__grid { grid-template-columns: 1fr; } }
</style>
