<!--
  ProofSettings — publish (or hide) your proof-of-work page and get its badge for a README or portfolio.
-->
<script setup>
import { ref, computed } from 'vue'
import { ExternalLink } from 'lucide-vue-next'
import VCard from '@/components/ui/VCard.vue'
import VField from '@/components/ui/VField.vue'
import VButton from '@/components/ui/VButton.vue'
import VCopy from '@/components/ui/VCopy.vue'
import { api, isDemo } from '@/services'
import { useAuthStore } from '@/stores/auth'
import { toast } from '@/composables/useToast'

const auth = useAuthStore()
const slug = (s) => (s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30)
const handle = ref(auth.profile?.handle || slug(auth.name))
const headline = ref(auth.profile?.headline || '')
const on = ref(!!auth.profile?.publicProof)
const busy = ref(false)

const origin = location.origin
const apiOrigin = import.meta.env.VITE_API_URL || (import.meta.env.PROD ? location.origin : 'http://localhost:4100')
const pageUrl = computed(() => `${origin}/u/${handle.value}`)
const badgeUrl = computed(() => `${apiOrigin}/badge/${handle.value}.svg`)
const markdown = computed(() => `[![Verified by Verdikt](${badgeUrl.value})](${pageUrl.value})`)

async function save(next = on.value) {
  busy.value = true
  try {
    await api.setProofSettings({ handle: handle.value, headline: headline.value, publicProof: next })
    on.value = next
    await auth.refresh()
    toast(next ? 'Your proof page is public' : 'Your proof page is hidden')
  } catch (e) {
    toast(e.message, { tone: 'danger' })
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <VCard title="Public proof page" sub="A record of work that passed its checks and was paid through PayPal. Clients stay anonymous.">
    <form class="ps" @submit.prevent="save()">
      <div class="ps__row">
        <VField label="Handle" for="phandle" :hint="`${origin}/u/${handle || '…'}`">
          <input id="phandle" v-model="handle" class="vk-input" maxlength="30" @input="handle = slug(handle)" />
        </VField>
        <VField label="Headline" for="pheadline" optional>
          <input id="pheadline" v-model="headline" class="vk-input" maxlength="120" placeholder="Front-end developer · Vue, Supabase" />
        </VField>
      </div>
      <div class="ps__actions">
        <VButton v-if="!on" :loading="busy" @click="save(true)">Make it public</VButton>
        <template v-else>
          <VButton type="submit" variant="secondary" :loading="busy">Save</VButton>
          <VButton variant="ghost" :icon-right="ExternalLink" :to="`/u/${handle}`">Open my page</VButton>
          <VButton variant="ghost" @click="save(false)">Hide it</VButton>
        </template>
      </div>
      <div v-if="on" class="ps__badge">
        <p class="vk-eyebrow">Badge for your README or portfolio</p>
        <img v-if="!isDemo" :src="badgeUrl" alt="Verified by Verdikt badge" height="22" />
        <p v-else class="vk-faint ps__note">The badge image is served by the API — it appears with a real account.</p>
        <VCopy :value="markdown" label="Copy Markdown" />
      </div>
    </form>
  </VCard>
</template>

<style scoped>
.ps { display: flex; flex-direction: column; gap: 14px; }
.ps__row { display: grid; grid-template-columns: 1fr 1.4fr; gap: 12px; }
.ps__actions { display: flex; gap: 8px; flex-wrap: wrap; }
.ps__badge { display: flex; flex-direction: column; gap: 10px; align-items: flex-start; padding-top: 14px; border-top: 1px solid var(--vk-line-subtle); }
.ps__note { margin: 0; font: var(--vk-type-small); }
@media (max-width: 640px) { .ps__row { grid-template-columns: 1fr; } }
</style>
