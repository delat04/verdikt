<script setup>
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Mail, ArrowRight } from 'lucide-vue-next'
import AuthLayout from '@/layouts/AuthLayout.vue'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const route = useRoute()
const router = useRouter()

if (auth.user) router.replace(route.query.next || '/contracts')

const email = ref('')
const sending = ref(false)
const sent = ref(false)
const error = ref('')

async function submit() {
  error.value = ''
  sending.value = true
  try {
    await auth.signInWithEmail(email.value.trim())
    sent.value = true
  } catch (e) {
    error.value = e.message
  } finally {
    sending.value = false
  }
}
</script>

<template>
  <AuthLayout>
    <template v-if="!sent">
      <h1 class="title">Get paid when the work is proven.</h1>
      <p class="sub">Sign in to create a contract or join one with an invite code.</p>

      <form class="form" @submit.prevent="submit">
        <label class="eyebrow" for="email">Email</label>
        <input id="email" v-model="email" class="input" type="email" required placeholder="you@studio.com" autocomplete="email" />
        <button class="btn btn-primary submit" :disabled="sending">
          {{ sending ? 'Sending link…' : 'Send magic link' }}
          <ArrowRight :size="16" />
        </button>
        <p v-if="error" class="error">{{ error }}</p>
      </form>
    </template>

    <div v-else class="sent">
      <span class="sent__icon"><Mail :size="20" /></span>
      <h1 class="title">Check your inbox</h1>
      <p class="sub">We sent a sign-in link to <span class="num">{{ email }}</span>.</p>
      <button class="btn btn-secondary" @click="sent = false">Use another email</button>
    </div>
  </AuthLayout>
</template>

<style scoped>
.title { margin: 0; font-size: 1.5rem; font-weight: 500; letter-spacing: -0.03em; line-height: 1.2; }
.sub { margin: 0.5rem 0 0; font-size: 0.875rem; color: var(--muted); line-height: 1.5; }
.form { display: flex; flex-direction: column; gap: 0.5rem; margin-top: 1.75rem; }
.submit { margin-top: 0.75rem; padding-block: 0.6875rem; }
.error { margin: 0.25rem 0 0; font-size: 0.8125rem; color: var(--danger); }
.sent { display: flex; flex-direction: column; align-items: flex-start; gap: 0.25rem; }
.sent .btn { margin-top: 1.25rem; }
.sent__icon {
  display: grid; place-items: center; width: 44px; height: 44px; margin-bottom: 0.75rem;
  border-radius: 50%; background: var(--accent-soft); color: var(--accent-2);
}
</style>
