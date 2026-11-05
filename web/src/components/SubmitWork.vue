<!-- SubmitWork — the freelancer delivers: live URL + repo + a note. The agent starts the moment it's sent. -->
<script setup>
import { ref, computed } from 'vue'
import { Globe, Github, Send } from 'lucide-vue-next'
import VButton from './ui/VButton.vue'
import VField from './ui/VField.vue'
import { api, isDemo } from '@/services'
import { toast } from '@/composables/useToast'

const props = defineProps({
  milestone: { type: Object, required: true },
  previous: { type: Object, default: null },
})
const emit = defineEmits(['submitted'])

const liveUrl = ref(props.previous?.liveUrl || '')
const repoUrl = ref(props.previous?.repoUrl || '')
const notes = ref('')
const busy = ref(false)
const error = ref('')

const isUrl = (v) => /^https?:\/\/[^\s.]+\.[^\s]+/i.test(v.trim())
const valid = computed(() => isUrl(liveUrl.value) && (!repoUrl.value || isUrl(repoUrl.value)))

function sample(kind) {
  const slug = props.milestone.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  liveUrl.value = { complete: `https://${slug}.vercel.app`, tampered: `https://${slug}-tampered.vercel.app` }[kind] || `https://${slug}-incomplete.vercel.app`
  repoUrl.value = `https://github.com/okafor-studio/${slug}`
  notes.value = {
    complete: 'Fixed the mobile layout and the signup endpoint.',
    tampered: 'All done! (This build hides a note for the AI reviewer in white-on-white text.)',
  }[kind] || 'First pass — mobile still in progress.'
}

async function submit() {
  busy.value = true
  error.value = ''
  try {
    await api.submitWork(props.milestone.id, { liveUrl: liveUrl.value.trim(), repoUrl: repoUrl.value.trim(), notes: notes.value.trim() })
    toast('Delivered. The agent is checking it now.')
    emit('submitted')
  } catch (e) {
    error.value = e.message
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <form class="submit" @submit.prevent="submit">
    <div class="submit__grid">
      <VField label="Live URL" for="live" hint="Where the agent opens the work. Must be public.">
        <div class="vk-affix"><Globe :size="15" /><input id="live" v-model="liveUrl" class="vk-input" type="url" required placeholder="https://your-build.vercel.app" /></div>
      </VField>
      <VField label="Repository" for="repo" optional hint="Public GitHub repo, so the code checks can run.">
        <div class="vk-affix"><Github :size="15" /><input id="repo" v-model="repoUrl" class="vk-input" type="url" placeholder="https://github.com/you/project" /></div>
      </VField>
    </div>
    <VField label="Note for the client" for="note" optional>
      <textarea id="note" v-model="notes" class="vk-textarea" rows="2" placeholder="What changed, anything to look at first" />
    </VField>
    <div class="submit__foot">
      <div v-if="isDemo" class="submit__samples">
        <span class="vk-faint">Demo deliveries:</span>
        <button type="button" class="link" @click="sample('incomplete')">incomplete build</button>
        <span class="vk-faint">·</span>
        <button type="button" class="link" @click="sample('complete')">complete build</button>
        <span class="vk-faint">·</span>
        <button type="button" class="link" @click="sample('tampered')">build that tries to fool the AI</button>
      </div>
      <VButton type="submit" :icon="Send" :disabled="!valid" :loading="busy">{{ previous ? 'Resubmit for checking' : 'Submit for checking' }}</VButton>
    </div>
    <p v-if="error" class="vk-field__error" role="alert">{{ error }}</p>
  </form>
</template>

<style scoped>
.submit { display: flex; flex-direction: column; gap: 16px; }
.submit__grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.submit__foot { display: flex; align-items: center; justify-content: flex-end; gap: 12px; flex-wrap: wrap; }
.submit__samples { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-right: auto; font: var(--vk-type-small); }
.link { padding: 0; border: 0; background: none; font: inherit; color: var(--vk-accent-text); cursor: pointer; }
.link:hover { text-decoration: underline; text-underline-offset: 3px; }
@media (max-width: 720px) { .submit__grid { grid-template-columns: 1fr; } }
</style>
