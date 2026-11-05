<script setup>
import { ref } from 'vue'
import { Sun, Moon, Monitor } from 'lucide-vue-next'
import AppShell from '@/layouts/AppShell.vue'
import VCard from '@/components/ui/VCard.vue'
import VField from '@/components/ui/VField.vue'
import VButton from '@/components/ui/VButton.vue'
import VSegmented from '@/components/ui/VSegmented.vue'
import { useAuthStore } from '@/stores/auth'
import { useTheme } from '@/composables/useTheme'
import { toast } from '@/composables/useToast'
import { isDemo } from '@/services'
import AgentAccess from '@/components/AgentAccess.vue'
import ProofSettings from '@/components/ProofSettings.vue'

const auth = useAuthStore()
const { theme, setTheme } = useTheme()

const name = ref(auth.profile?.name || '')
const paypalEmail = ref(auth.profile?.paypalEmail || '')
const intent = ref(auth.profile?.intent || 'client')
const busy = ref(false)

const themeModel = ref(theme.value)
function pickTheme(t) { themeModel.value = t; setTheme(t) }

async function save() {
  busy.value = true
  try {
    await auth.updateProfile({ name: name.value.trim(), paypalEmail: paypalEmail.value.trim(), intent: intent.value })
    toast('Settings saved', { tone: 'ok' })
  } catch (e) {
    toast(e.message, { tone: 'danger' })
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <AppShell>
    <template #crumbs><span>Settings</span></template>
    <div class="vk-page vk-page--narrow">
      <header class="vk-page__head">
        <div>
          <p class="vk-eyebrow">Account</p>
          <h1 class="vk-page__title">Settings</h1>
        </div>
      </header>

      <div class="stack">
        <VCard title="Profile" sub="Shown to the other party on contracts and verdicts.">
          <form class="form" @submit.prevent="save">
            <VField label="Full name" for="n"><input id="n" v-model="name" class="vk-input" required /></VField>
            <VField label="Email" for="e" hint="Your sign-in email."><input id="e" :value="auth.user?.email" class="vk-input" disabled /></VField>
            <VField label="Default side">
              <VSegmented v-model="intent" :options="[{ value: 'client', label: 'Client' }, { value: 'freelancer', label: 'Freelancer' }, { value: 'both', label: 'Both' }]" label="Default side" />
            </VField>
            <VField label="PayPal payout email" for="pp" hint="Released milestones are paid here when you're the freelancer." optional>
              <input id="pp" v-model="paypalEmail" class="vk-input" type="email" />
            </VField>
            <div><VButton type="submit" :loading="busy">Save changes</VButton></div>
          </form>
        </VCard>

        <ProofSettings />

        <AgentAccess />

        <VCard title="Appearance">
          <VSegmented
            :model-value="themeModel"
            :options="[{ value: 'light', label: 'Light', icon: Sun }, { value: 'dark', label: 'Dark', icon: Moon }, { value: 'system', label: 'System', icon: Monitor }]"
            label="Theme"
            @update:model-value="pickTheme"
          />
        </VCard>

        <VCard v-if="isDemo" variant="pill" tone="neutral" title="Demo mode" sub="Data lives in this browser. Connect Supabase and PayPal (README → Run it for real) to use real accounts and sandbox escrow." />
      </div>
    </div>
  </AppShell>
</template>

<style scoped>
.stack { display: flex; flex-direction: column; gap: 16px; }
.form { display: flex; flex-direction: column; gap: 18px; }
.vk-input:disabled { background: var(--vk-surface-2); color: var(--vk-muted); }
</style>
