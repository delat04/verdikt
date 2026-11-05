<!--
  Onboarding — three short steps: name → how you'll use Verdikt → where freelancers get paid.
  Each step is one question; Back/Continue slide in the direction of travel.
-->
<script setup>
import { ref, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft, ArrowRight, Briefcase, Code2, Repeat } from 'lucide-vue-next'
import AuthLayout from '@/layouts/AuthLayout.vue'
import VButton from '@/components/ui/VButton.vue'
import VField from '@/components/ui/VField.vue'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const route = useRoute()
const router = useRouter()

const step = ref(0)
const dir = ref('wz-next')
const name = ref(auth.profile?.name || '')
const intent = ref(auth.profile?.intent || 'client')
const paypalEmail = ref(auth.profile?.paypalEmail || auth.user?.email || '')
const busy = ref(false)
const error = ref('')

const STEPS = ['You', 'Your side', 'Payouts']
const INTENTS = [
  { value: 'client', icon: Briefcase, title: 'I hire freelancers', sub: 'Fund milestones into escrow and pay only for work that passes.' },
  { value: 'freelancer', icon: Code2, title: 'I deliver work', sub: 'Know the money is held before you start, and get paid the moment checks pass.' },
  { value: 'both', icon: Repeat, title: 'Both', sub: 'Some contracts you pay, some you deliver.' },
]
const needsPayout = computed(() => intent.value !== 'client')
const last = computed(() => step.value === STEPS.length - 1)
const canNext = computed(() => (step.value === 0 ? name.value.trim().length >= 2 : step.value === 2 && needsPayout.value ? /.+@.+\..+/.test(paypalEmail.value) : true))

function go(delta) {
  dir.value = delta > 0 ? 'wz-next' : 'wz-back'
  step.value += delta
}

async function finish() {
  busy.value = true
  error.value = ''
  try {
    await auth.updateProfile({ name: name.value.trim(), intent: intent.value, paypalEmail: needsPayout.value ? paypalEmail.value.trim() : '', onboarded: true })
    const next = typeof route.query.next === 'string' && route.query.next !== '/onboarding' ? route.query.next : '/contracts'
    router.replace(next)
  } catch (e) {
    error.value = e.message
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <AuthLayout>
    <ol class="vk-steps" aria-label="Setup progress">
      <li v-for="(s, i) in STEPS" :key="s" class="vk-steps__item" :class="{ 'is-done': i < step, 'is-now': i === step }">
        <span class="vk-steps__bar" />
        <span class="vk-steps__label">{{ s }}</span>
      </li>
    </ol>

    <form class="ob" @submit.prevent="last ? finish() : canNext && go(1)">
      <Transition :name="dir" mode="out-in">
        <section v-if="step === 0" key="0" class="ob__step">
          <h1 class="ob__title">What should we call you?</h1>
          <p class="ob__sub">Shown to the other party on every contract and verdict.</p>
          <VField label="Full name" for="name">
            <input id="name" v-model="name" class="vk-input vk-input--lg" autocomplete="name" placeholder="Maya Chen" autofocus />
          </VField>
        </section>

        <section v-else-if="step === 1" key="1" class="ob__step">
          <h1 class="ob__title">Which side are you on?</h1>
          <p class="ob__sub">This sets your defaults. You can be either side on any contract.</p>
          <div class="vk-choices" role="radiogroup" aria-label="How you will use Verdikt">
            <button
              v-for="o in INTENTS" :key="o.value" type="button" role="radio" class="vk-choice"
              :class="{ 'is-active': intent === o.value }" :aria-checked="intent === o.value" @click="intent = o.value"
            >
              <span class="vk-choice__icon"><component :is="o.icon" :size="18" :stroke-width="1.9" /></span>
              <span>
                <p class="vk-choice__title">{{ o.title }}</p>
                <p class="vk-choice__sub">{{ o.sub }}</p>
              </span>
              <span class="vk-choice__radio" aria-hidden="true" />
            </button>
          </div>
        </section>

        <section v-else key="2" class="ob__step">
          <template v-if="needsPayout">
            <h1 class="ob__title">Where should payments land?</h1>
            <p class="ob__sub">Released milestones are paid to this PayPal account.</p>
            <VField label="PayPal email" for="pp" hint="While testing, use a sandbox Business account (…@business.example.com).">
              <input id="pp" v-model="paypalEmail" class="vk-input vk-input--lg" type="email" autocomplete="email" />
            </VField>
          </template>
          <template v-else>
            <h1 class="ob__title">You fund with PayPal</h1>
            <p class="ob__sub">When you fund a milestone, PayPal places a hold. You're only charged when the work passes the checks you signed — otherwise the hold is voided.</p>
            <div class="ob__fact vk-card vk-card--well">
              <p class="vk-eyebrow">Nothing to set up</p>
              <p>You'll approve each hold in PayPal's own window.</p>
            </div>
          </template>
        </section>
      </Transition>

      <p v-if="error" class="vk-field__error">{{ error }}</p>
      <div class="ob__foot">
        <VButton v-if="step > 0" variant="ghost" :icon="ArrowLeft" @click="go(-1)">Back</VButton>
        <span style="flex: 1" />
        <VButton type="submit" :disabled="!canNext" :loading="busy" :icon-right="last ? null : ArrowRight">
          {{ last ? 'Go to my contracts' : 'Continue' }}
        </VButton>
      </div>
    </form>
  </AuthLayout>
</template>

<style scoped>
.ob { display: flex; flex-direction: column; gap: 20px; margin-top: 28px; }
.ob__step { display: flex; flex-direction: column; gap: 16px; }
.ob__title { margin: 0; font: 400 24px/30px var(--vk-font); letter-spacing: -.025em; }
.ob__sub { margin: -8px 0 4px; font: var(--vk-type-body); color: var(--vk-muted); }
.ob__fact { padding: var(--vk-card-pad); }
.ob__fact p:last-child { margin: 6px 0 0; font: var(--vk-type-dense); color: var(--vk-ink-2); }
.ob__foot { display: flex; align-items: center; gap: 8px; padding-top: 4px; }
</style>
