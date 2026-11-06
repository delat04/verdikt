<!--
  FundModal — the client puts a milestone into escrow.
  Live: PayPal JS SDK buttons (intent=authorize) → our API creates the order, then authorizes it (a hold).
  Demo: a simulated PayPal sandbox approval, clearly labelled.
-->
<script setup>
import { ref, watch, nextTick } from 'vue'
import { ShieldCheck, Undo2, CalendarClock, Banknote, Receipt } from 'lucide-vue-next'
import VModal from './ui/VModal.vue'
import VButton from './ui/VButton.vue'
import { api, isDemo } from '@/services'
import { money, split, FEE_PERCENT } from '@/domain/format'
import { toast } from '@/composables/useToast'
import { holdCents } from '@/domain/expenses'

const props = defineProps({
  open: { type: Boolean, default: false },
  milestone: { type: Object, default: null },
  currency: { type: String, default: 'USD' },
  payerEmail: { type: String, default: '' },
})
const emit = defineEmits(['close', 'funded'])

const busy = ref(false)
const error = ref('')
const sdkError = ref('')
const buttons = ref(null)
const message = ref(null)
const dark = () => document.documentElement.dataset.theme === 'dark' || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches)

function loadSdk() {
  if (window.paypal) return Promise.resolve(window.paypal)
  const clientId = import.meta.env.VITE_PAYPAL_CLIENT_ID
  if (!clientId) return Promise.reject(new Error('VITE_PAYPAL_CLIENT_ID is not set'))
  return new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&intent=authorize&currency=${props.currency}&components=buttons,messages&enable-funding=paylater`
    s.onload = () => resolve(window.paypal)
    s.onerror = () => reject(new Error('Could not load PayPal'))
    document.head.appendChild(s)
  })
}

async function renderButtons() {
  sdkError.value = ''
  try {
    const paypal = await loadSdk()
    await nextTick()
    if (!buttons.value) return
    buttons.value.innerHTML = ''
    await paypal.Buttons({
      style: { layout: 'vertical', shape: 'pill', label: 'paypal', height: 44 },
      createOrder: async () => (await api.createOrder(props.milestone.id)).orderId,
      onApprove: async () => {
        busy.value = true
        try {
          await api.authorizeOrder(props.milestone.id)
          done()
        } catch (e) {
          error.value = e.message
        } finally {
          busy.value = false
        }
      },
      onError: (e) => { error.value = e?.message || 'PayPal could not complete the hold.' },
    }).render(buttons.value)
    // Pay Later: PayPal decides eligibility (buyer, country, amount) and shows the offer only when it applies
    if (message.value && paypal.Messages) {
      message.value.innerHTML = ''
      paypal.Messages({
        amount: holdCents(props.milestone) / 100,
        placement: 'payment',
        style: { layout: 'text', logo: { type: 'inline' }, text: { size: 12, color: dark() ? 'white' : 'black' } },
      }).render(message.value).catch(() => {})
    }
  } catch (e) {
    sdkError.value = e.message
  }
}

watch(() => props.open, (o) => {
  error.value = ''
  if (o && !isDemo) renderButtons()
})

async function approveDemo() {
  busy.value = true
  error.value = ''
  try {
    await api.createOrder(props.milestone.id)
    await api.authorizeOrder(props.milestone.id)
    done()
  } catch (e) {
    error.value = e.message
  } finally {
    busy.value = false
  }
}

function done() {
  toast(`${money(holdCents(props.milestone), props.currency)} is held in escrow`, { tone: 'ok' })
  emit('funded')
  emit('close')
}
</script>

<template>
  <VModal :open="open" :title="milestone ? `Fund M${milestone.position} · ${milestone.title}` : ''" sub="A hold, not a payment." @close="!busy && emit('close')">
    <div v-if="milestone" class="fund">
      <p class="fund__amount vk-num">{{ money(holdCents(milestone), currency) }}</p>
      <p v-if="milestone.expenseBudgetCents" class="fund__split vk-num">{{ money(milestone.amountCents, currency) }} for the work + up to {{ money(milestone.expenseBudgetCents, currency) }} expense budget</p>
      <ul class="fund__facts">
        <li><ShieldCheck :size="16" :stroke-width="1.9" /> PayPal holds the money. Nobody can touch it until the checks you signed pass.</li>
        <li><Undo2 :size="16" :stroke-width="1.9" /> If the work never passes, the hold is voided and you are not charged.</li>
        <li><CalendarClock :size="16" :stroke-width="1.9" /> PayPal keeps a hold valid for up to 29 days, and Verdikt renews it after the first 3 so it stays guaranteed while the work is built.</li>
        <li v-if="milestone.expenseBudgetCents"><Receipt :size="16" :stroke-width="1.9" /> The expense budget ({{ (milestone.expenseCovers || []).join(', ') }}) is paid out only against receipts that pass the checks. You're never charged for what isn't spent.</li>
        <li v-if="FEE_PERCENT"><Banknote :size="16" :stroke-width="1.9" /> When it's released, the freelancer receives <span class="vk-num">{{ money(split(milestone.amountCents).net, currency) }}</span> in their PayPal — Verdikt keeps {{ FEE_PERCENT }}%. You pay nothing extra.</li>
      </ul>

      <!-- demo: simulated PayPal sandbox -->
      <div v-if="isDemo" class="pp">
        <div class="pp__head">
          <span class="pp__logo">PayPal</span>
          <span class="vk-eyebrow">Sandbox · simulated in demo</span>
        </div>
        <div class="pp__row"><span class="vk-muted">Pay with</span><span class="vk-num">{{ payerEmail || 'sandbox-buyer@personal.example' }}</span></div>
        <div class="pp__row"><span class="vk-muted">Authorize</span><span class="vk-num">{{ money(holdCents(milestone), currency) }}</span></div>
        <VButton block size="lg" :loading="busy" @click="approveDemo">Approve hold</VButton>
      </div>

      <!-- live: PayPal smart buttons -->
      <div v-else>
        <div ref="buttons" class="pp-live" />
        <div ref="message" class="pp-msg" aria-label="PayPal Pay Later offer" />
        <p v-if="sdkError" class="vk-field__error">{{ sdkError }}</p>
        <p v-if="busy" class="vk-faint fund__busy"><span class="vk-spin" /> Placing the hold…</p>
      </div>
      <p v-if="error" class="vk-field__error" role="alert">{{ error }}</p>
    </div>
  </VModal>
</template>

<style scoped>
.fund__split { margin: -8px 0 0; font-size: 12px; color: var(--vk-muted); }
.fund__amount { margin: 0; font: var(--vk-num-40); letter-spacing: -.02em; }
.fund__facts { margin: 16px 0 20px; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 10px; }
.fund__facts li { display: flex; gap: 10px; font: var(--vk-type-dense); color: var(--vk-ink-2); }
.fund__facts svg { flex: none; margin-top: 1px; color: var(--vk-accent-text); }
.pp { display: flex; flex-direction: column; gap: 10px; padding: 16px; border: 1px solid var(--vk-line); border-radius: var(--vk-r-md); background: var(--vk-surface-2); }
.pp__head { display: flex; align-items: center; justify-content: space-between; }
.pp__logo { font: italic 400 18px/1 var(--vk-font); color: color-mix(in srgb, #003087 55%, var(--vk-ink)); letter-spacing: -.02em; }
.pp__row { display: flex; justify-content: space-between; gap: 12px; font: var(--vk-type-dense); }
.pp-live { min-height: 52px; }
.pp-msg:not(:empty) { margin-top: 10px; }
.fund__busy { display: flex; align-items: center; gap: 8px; font: var(--vk-type-small); }
</style>
