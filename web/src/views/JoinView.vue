<!-- Join — what you'd be agreeing to, before you join: who invited you, the brief, the milestones, the total. -->
<script setup>
import { ref, computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowRight, KeyRound, ShieldCheck } from 'lucide-vue-next'
import AuthLayout from '@/layouts/AuthLayout.vue'
import VButton from '@/components/ui/VButton.vue'
import VAvatar from '@/components/ui/VAvatar.vue'
import VField from '@/components/ui/VField.vue'
import { api } from '@/services'
import { useAuthStore } from '@/stores/auth'
import { money } from '@/domain/format'

const auth = useAuthStore()
const route = useRoute()
const router = useRouter()

const code = computed(() => String(route.params.code || '').toUpperCase())
const input = ref('')
const invite = ref(null)
const error = ref('')
const loading = ref(false)
const joining = ref(false)

async function load() {
  invite.value = null
  error.value = ''
  if (!code.value) return
  loading.value = true
  try {
    invite.value = await api.previewInvite(code.value)
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}
watch(code, load, { immediate: true })

const total = computed(() => invite.value?.milestones.reduce((s, m) => s + m.amountCents, 0) || 0)

async function join() {
  if (!auth.user) return router.push({ path: '/login', query: { next: route.fullPath } })
  joining.value = true
  try {
    const { id } = await api.joinContract(code.value)
    router.push(`/contracts/${id}`)
  } catch (e) {
    error.value = e.message
    joining.value = false
  }
}
</script>

<template>
  <AuthLayout :wide="!!invite">
    <!-- no code yet -->
    <form v-if="!code" class="ask" @submit.prevent="router.push(`/join/${input.trim()}`)">
      <p class="vk-eyebrow">Join a contract</p>
      <h1 class="title">Enter your invite code</h1>
      <VField label="Invite code" for="code">
        <div class="vk-affix"><KeyRound :size="15" /><input id="code" v-model="input" class="vk-input vk-input--lg vk-num" required placeholder="NB4X2Q" /></div>
      </VField>
      <VButton type="submit" size="lg" block :icon-right="ArrowRight">Continue</VButton>
    </form>

    <div v-else-if="loading" class="wait"><span class="vk-spin" /> Opening the invitation…</div>

    <div v-else-if="error && !invite" class="ask">
      <p class="vk-eyebrow">Invite {{ code }}</p>
      <h1 class="title">We couldn't open this invite</h1>
      <p class="sub">{{ error }}</p>
      <VButton variant="secondary" to="/join">Try another code</VButton>
    </div>

    <div v-else-if="invite" class="inv">
      <div class="inv__from">
        <VAvatar :name="invite.inviter?.name" size="lg" />
        <div>
          <p class="vk-eyebrow">Invitation · {{ code }}</p>
          <p class="inv__who"><b>{{ invite.inviter?.name }}</b> invited you to be the <b>{{ invite.seat || 'other party' }}</b></p>
        </div>
      </div>
      <h1 class="title">{{ invite.title }}</h1>
      <p class="sub brief">{{ invite.brief }}</p>

      <dl class="vk-kv inv__ms">
        <div v-for="(m, i) in invite.milestones" :key="i" class="vk-kv__row">
          <dt class="vk-kv__k">{{ i === invite.milestones.length - 1 && invite.milestones.length > 1 ? 'Final' : `M${i + 1}` }} · {{ m.title }}</dt>
          <dd class="vk-kv__v">{{ money(m.amountCents, invite.currency) }}</dd>
        </div>
        <div class="vk-kv__row inv__total"><dt class="vk-kv__k">Total</dt><dd class="vk-kv__v">{{ money(total, invite.currency) }}</dd></div>
      </dl>

      <p class="inv__note"><ShieldCheck :size="16" :stroke-width="1.9" /> Joining doesn't commit you. You'll review the checks the agent drafted, and nothing moves until you both sign.</p>

      <p v-if="error" class="vk-field__error">{{ error }}</p>
      <VButton v-if="invite.seat" size="lg" block :loading="joining" :icon-right="ArrowRight" @click="join">
        {{ auth.user ? `Join as the ${invite.seat}` : 'Sign in to join' }}
      </VButton>
      <p v-else class="sub">This contract already has both parties.</p>
    </div>
  </AuthLayout>
</template>

<style scoped>
.ask { display: flex; flex-direction: column; gap: 16px; }
.title { margin: 4px 0 0; font: 400 24px/30px var(--vk-font); letter-spacing: -.025em; }
.sub { margin: 0; font: var(--vk-type-body); color: var(--vk-muted); }
.wait { display: flex; align-items: center; gap: 10px; color: var(--vk-muted); }
.inv { display: flex; flex-direction: column; gap: 16px; }
.inv__from { display: flex; align-items: center; gap: 14px; padding-bottom: 16px; border-bottom: 1px solid var(--vk-line-subtle); }
.inv__who { margin: 4px 0 0; font: var(--vk-type-body); color: var(--vk-ink-2); }
.inv__who b { font-weight: 400; color: var(--vk-ink); }
.brief { white-space: pre-line; }
.inv__ms { padding: 14px 16px; border: 1px solid var(--vk-line-subtle); border-radius: var(--vk-r-md); background: var(--vk-surface-2); }
.inv__total { padding-top: 10px; border-top: 1px solid var(--vk-line); }
.inv__note { display: flex; gap: 10px; margin: 0; font: var(--vk-type-dense); color: var(--vk-ink-2); }
.inv__note svg { flex: none; margin-top: 1px; color: var(--vk-accent-text); }
</style>
