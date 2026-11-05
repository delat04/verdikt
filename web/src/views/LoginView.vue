<script setup>
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Mail, ArrowRight, Briefcase, Code2 } from 'lucide-vue-next'
import AuthLayout from '@/layouts/AuthLayout.vue'
import VButton from '@/components/ui/VButton.vue'
import VField from '@/components/ui/VField.vue'
import { api, isDemo, canLeaveDemo, enterDemo, leaveDemo } from '@/services'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const route = useRoute()
const router = useRouter()
const next = typeof route.query.next === 'string' ? route.query.next : '/contracts'

const email = ref('')
const busy = ref('')
const sent = ref(false)
const error = ref('')

const personas = isDemo ? api.personas() : null

async function sendLink() {
  error.value = ''
  busy.value = 'email'
  try {
    await api.signInWithEmail(email.value.trim(), next)
    sent.value = true
  } catch (e) {
    error.value = e.message
  } finally {
    busy.value = ''
  }
}

async function demoAs(key) {
  busy.value = key
  await auth.signInAs(key)
  router.replace(auth.onboarded ? next : { path: '/onboarding', query: { next } })
}
</script>

<template>
  <AuthLayout>
    <!-- demo -->
    <template v-if="isDemo">
      <p class="vk-eyebrow">Demo</p>
      <h1 class="title">Pick a side to start</h1>
      <p class="sub">Two demo accounts share one browser, so you can play both parties of a contract. Switch any time from the top bar.</p>
      <div class="vk-choices people">
        <button v-for="(p, key) in personas" :key="key" type="button" class="vk-choice" :disabled="!!busy" @click="demoAs(key)">
          <span class="vk-choice__icon"><Briefcase v-if="key === 'client'" :size="18" /><Code2 v-else :size="18" /></span>
          <span>
            <p class="vk-choice__title">{{ p.name }}</p>
            <p class="vk-choice__sub">{{ key === 'client' ? 'Client' : 'Freelancer' }} · {{ p.org }}</p>
          </span>
          <span v-if="busy === key" class="vk-spin" style="margin-left: auto" />
          <ArrowRight v-else :size="16" class="go" />
        </button>
      </div>
      <div v-if="canLeaveDemo" class="other">
        <p class="vk-faint">Want a real account and real PayPal sandbox escrow?</p>
        <VButton variant="secondary" size="sm" @click="leaveDemo">Sign in for real</VButton>
      </div>
      <p v-else class="note vk-faint">Connect Supabase and PayPal (see the README) to switch to real accounts and real sandbox escrow.</p>
    </template>

    <!-- live -->
    <template v-else-if="!sent">
      <p class="vk-eyebrow">Sign in</p>
      <h1 class="title">Get paid when the work is proven.</h1>
      <p class="sub">We email you a sign-in link — no password to remember.</p>
      <form class="form" @submit.prevent="sendLink">
        <VField label="Work email" for="email" :error="error">
          <input id="email" v-model="email" class="vk-input vk-input--lg" type="email" required autocomplete="email" placeholder="you@studio.com" />
        </VField>
        <VButton type="submit" size="lg" block :loading="busy === 'email'" :icon-right="ArrowRight">Email me a link</VButton>
      </form>
      <div class="other">
        <p class="vk-faint">Just looking? Play both sides in a demo, no account needed.</p>
        <VButton variant="secondary" size="sm" @click="enterDemo">Try the demo</VButton>
      </div>
    </template>

    <div v-else class="sent">
      <span class="sent__icon"><Mail :size="20" /></span>
      <h1 class="title">Check your inbox</h1>
      <p class="sub">The link we sent to <span class="vk-num">{{ email }}</span> signs you in on this device.</p>
      <VButton variant="secondary" @click="sent = false">Use a different email</VButton>
    </div>
  </AuthLayout>
</template>

<style scoped>
.title { margin: 8px 0 0; font: 400 26px/32px var(--vk-font); letter-spacing: -.03em; }
.sub { margin: 8px 0 0; font: var(--vk-type-body); color: var(--vk-muted); }
.form { display: flex; flex-direction: column; gap: 16px; margin-top: 24px; }
.people { margin-top: 24px; }
.other { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-top: 24px; padding-top: 18px; border-top: 1px solid var(--vk-line-subtle); font: var(--vk-type-small); }
.other p { margin: 0; }
.people .vk-choice { align-items: center; }
.go { margin-left: auto; color: var(--vk-faint); }
.vk-choice:hover .go { color: var(--vk-ink); }
.note { margin: 20px 0 0; font: var(--vk-type-small); }
.sent { display: flex; flex-direction: column; align-items: flex-start; }
.sent .vk-btn { margin-top: 20px; }
.sent__icon { display: grid; place-items: center; width: 44px; height: 44px; border-radius: 50%; background: var(--vk-accent-soft); color: var(--vk-accent-text); border: 1px solid var(--vk-accent-line); }
</style>
