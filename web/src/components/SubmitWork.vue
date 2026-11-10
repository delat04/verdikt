<!--
  SubmitWork — the freelancer delivers: live URL + repo + a note. The agent starts the moment it's sent.
  Pre-check first: a dry run of every signed check's deterministic probes against the URL — no verdict,
  no money, no model tokens — so failing checks are fixed before the money is on the line.
-->
<script setup>
import { ref, computed, watch } from 'vue'
import { Globe, Github, Send, ListChecks, Check, X, Minus, ShieldAlert } from 'lucide-vue-next'
import VButton from './ui/VButton.vue'
import VField from './ui/VField.vue'
import { api, isDemo } from '@/services'
import { toast } from '@/composables/useToast'
import { LAYER, probeLabel } from '@/domain/probes'

const props = defineProps({
  milestone: { type: Object, required: true },
  previous: { type: Object, default: null },
})
const emit = defineEmits(['submitted'])

const liveUrl = ref(props.previous?.liveUrl || '')
const repoUrl = ref(props.previous?.repoUrl || '')
const notes = ref('')
const busy = ref('')
const error = ref('')
const pre = ref(null)

const isUrl = (v) => /^https?:\/\/[^\s.]+\.[^\s]+/i.test(v.trim())
const valid = computed(() => isUrl(liveUrl.value) && (!repoUrl.value || isUrl(repoUrl.value)))
// a pre-check describes one URL: change it and the result no longer applies
watch([liveUrl, repoUrl], () => { if (pre.value && (pre.value.liveUrl !== liveUrl.value.trim() || (pre.value.repoUrl || '') !== repoUrl.value.trim())) pre.value = null })

// The sample pages are Northbrew's café landing page and coffee shop, so they stand in for a delivery only when every
// signed check is a standard one those pages can answer. Any other check (a QR code, a staff scan page) would pass
// on a page that has none, and its recording would show that.
const SAMPLE_CHECKS = /^(The live URL serves .* with no errors|Above the fold shows the headline|No horizontal scrolling at 375px|The signup form accepts a valid email|A product can be added to the cart|Largest Contentful Paint under|All copy from the brief is present|The repository has a README)/
const sampleFits = computed(() => !!props.milestone.criteria?.length && props.milestone.criteria.every((c) => SAMPLE_CHECKS.test(c.statement)))

function sample(kind) {
  const slug = props.milestone.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  // the demo's sample deliveries are real pages Verdikt serves, each with a recording made on Kernel (services/replays.json);
  // a milestone they can't answer gets made-up URLs instead, and its verdict says there's no recording
  liveUrl.value = isDemo && sampleFits.value
    ? `${location.origin}/samples/${{ complete: 'northbrew-shop-v2', tampered: 'northbrew-shop-tampered' }[kind] || 'northbrew-shop-v1'}.html`
    : { complete: `https://${slug}.vercel.app`, tampered: `https://${slug}-tampered.vercel.app` }[kind] || `https://${slug}-incomplete.vercel.app`
  repoUrl.value = `https://github.com/okafor-studio/${slug}`
  notes.value = {
    complete: 'Fixed the mobile layout and the signup endpoint.',
    tampered: 'All done! (This build hides a note for the AI reviewer in white-on-white text.)',
  }[kind] || 'First pass — mobile still in progress.'
}

async function precheck() {
  busy.value = 'pre'
  error.value = ''
  try {
    pre.value = await api.precheck(props.milestone.id, { liveUrl: liveUrl.value.trim(), repoUrl: repoUrl.value.trim() })
  } catch (e) {
    error.value = e.message
  } finally {
    busy.value = ''
  }
}

async function submit() {
  busy.value = 'submit'
  error.value = ''
  try {
    await api.submitWork(props.milestone.id, { liveUrl: liveUrl.value.trim(), repoUrl: repoUrl.value.trim(), notes: notes.value.trim() })
    toast('Delivered. The agent is checking it now.')
    emit('submitted')
  } catch (e) {
    error.value = e.message
  } finally {
    busy.value = ''
  }
}

const sorted = computed(() => [...(pre.value?.checks || [])].sort((a, b) => ({ fail: 0, judge: 1, pass: 2 }[a.status] - { fail: 0, judge: 1, pass: 2 }[b.status]) || a.position - b.position))
const probeCount = computed(() => props.milestone.criteria.reduce((s, c) => s + (c.spec?.probes?.length || 0), 0))
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

    <!-- the dry run -->
    <section v-if="busy === 'pre'" class="pre" aria-live="polite">
      <p class="pre__head"><span class="vk-spin" /> Running {{ probeCount || 'the' }} probes against {{ liveUrl.replace(/^https?:\/\//, '') }} at 1440px and 375px…</p>
    </section>
    <section v-else-if="pre" class="pre" aria-live="polite">
      <div class="pre__head">
        <p class="pre__title"><ListChecks :size="15" :stroke-width="1.9" /> Pre-check · nothing was submitted</p>
        <p class="pre__counts vk-num">
          <span class="is-pass">{{ pre.counts.pass }} met</span> ·
          <span :class="{ 'is-fail': pre.counts.fail }">{{ pre.counts.fail }} not met</span> ·
          <span>{{ pre.counts.judge }} for the verifier</span> ·
          <span class="vk-faint">{{ (pre.ms / 1000).toFixed(1) }} s · no model tokens</span>
        </p>
      </div>
      <p v-if="pre.integrity" class="pre__integrity"><ShieldAlert :size="15" :stroke-width="1.9" /> Hidden text on the page addresses the verifier: “{{ pre.integrity.quotes[0] }}”. Remove it, or the verdict fails.</p>
      <ol class="pre__list">
        <li v-for="c in sorted" :key="c.id" class="pre__row" :class="`is-${c.status}`">
          <span class="pre__icon" aria-hidden="true"><Check v-if="c.status === 'pass'" :size="12" :stroke-width="2.6" /><X v-else-if="c.status === 'fail'" :size="12" :stroke-width="2.6" /><Minus v-else :size="12" :stroke-width="2.6" /></span>
          <div class="pre__body">
            <p class="pre__statement">{{ c.statement }}</p>
            <p v-if="c.status === 'fail'" class="pre__why">{{ c.observed }}<b v-if="c.fix" class="pre__fix">{{ c.fix }}</b></p>
            <p v-else-if="c.status === 'judge'" class="pre__note vk-faint">
              {{ c.probes.length ? `Probes pass (${c.probes.filter((p) => p.status === 'pass').length}/${c.probes.length}); ` : 'No probe measures this; ' }}the verifier judges the rest when you submit.
            </p>
            <p v-else class="pre__note vk-faint">{{ c.by ? LAYER[c.by].short : 'Probe' }} · {{ c.probes.map((p) => probeLabel(p)).join(' · ') }}</p>
          </div>
        </li>
      </ol>
    </section>

    <div class="submit__foot">
      <div v-if="isDemo" class="submit__samples">
        <span class="vk-faint">Demo deliveries:</span>
        <button type="button" class="link" @click="sample('incomplete')">incomplete build</button>
        <span class="vk-faint">·</span>
        <button type="button" class="link" @click="sample('complete')">complete build</button>
        <span class="vk-faint">·</span>
        <button type="button" class="link" @click="sample('tampered')">build that tries to fool the AI</button>
      </div>
      <div class="submit__actions">
        <VButton variant="secondary" :icon="ListChecks" :disabled="!valid || !!busy" :loading="busy === 'pre'" @click="precheck">Pre-check</VButton>
        <VButton type="submit" :icon="Send" :disabled="!valid || busy === 'pre'" :loading="busy === 'submit'" :variant="pre && !pre.ready ? 'secondary' : 'primary'">{{ previous ? 'Resubmit for checking' : 'Submit for checking' }}</VButton>
      </div>
    </div>
    <p class="submit__hint vk-faint">Pre-check runs the signed checks’ probes on your URL for free — nothing is submitted and no money moves. Both of you see that it ran.</p>
    <p v-if="error" class="vk-field__error" role="alert">{{ error }}</p>
  </form>
</template>

<style scoped>
.submit { display: flex; flex-direction: column; gap: 16px; }
.submit__grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.submit__foot { display: flex; align-items: center; justify-content: flex-end; gap: 10px; flex-wrap: wrap; }
.submit__actions { display: flex; gap: 10px; margin-left: auto; flex-wrap: wrap; justify-content: flex-end; }
.submit__samples { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-right: auto; font: var(--vk-type-small); }
.submit__hint { margin: -6px 0 0; font: var(--vk-type-small); text-align: right; }
.link { padding: 0; border: 0; background: none; font: inherit; color: var(--vk-accent-text); cursor: pointer; }
.link:hover { text-decoration: underline; text-underline-offset: 3px; }

.pre { display: flex; flex-direction: column; gap: 12px; padding: 14px 16px; border: 1px solid var(--vk-line); border-radius: var(--vk-r-md); background: var(--vk-surface-2); }
.pre__head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin: 0; font: var(--vk-type-small); color: var(--vk-muted); }
.pre__head .vk-spin { margin-right: 6px; }
.pre__title { display: inline-flex; align-items: center; gap: 6px; margin: 0; font: var(--vk-type-dense); color: var(--vk-ink); }
.pre__counts { margin: 0; font-size: 12px; color: var(--vk-ink-2); }
.pre__counts .is-pass { color: var(--vk-ok-ink); }
.pre__counts .is-fail { color: var(--vk-danger-ink); }
.pre__integrity { display: flex; gap: 8px; align-items: flex-start; margin: 0; font: var(--vk-type-small); color: var(--vk-danger-ink); }
.pre__integrity svg { flex: none; margin-top: 2px; }
.pre__list { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; }
.pre__row { display: flex; gap: 10px; padding: 10px 0; border-top: 1px solid var(--vk-line-subtle); }
.pre__icon { display: grid; place-items: center; flex: none; width: 20px; height: 20px; border-radius: 50%; border: 1px solid var(--vk-line); background: var(--vk-surface); color: var(--vk-faint); }
.is-pass .pre__icon { color: var(--vk-ok-ink); border-color: color-mix(in srgb, var(--vk-ok) 35%, transparent); background: var(--vk-ok-soft); }
.is-fail .pre__icon { color: var(--vk-danger-ink); border-color: color-mix(in srgb, var(--vk-danger) 35%, transparent); background: var(--vk-danger-soft); }
.pre__body { flex: 1; min-width: 0; }
.pre__statement { margin: 0; font: var(--vk-type-dense); color: var(--vk-ink); }
.pre__why { margin: 4px 0 0; font: var(--vk-type-small); color: var(--vk-ink-2); }
.pre__fix { margin-left: .3em; font-weight: 400; color: var(--vk-ink); }
.pre__note { margin: 4px 0 0; font: var(--vk-type-small); }
@media (max-width: 720px) { .submit__grid { grid-template-columns: 1fr; } .submit__hint { text-align: left; } }
</style>
