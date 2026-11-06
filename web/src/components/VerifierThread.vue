<!--
  VerifierThread — talk to the verifier about a milestone's checks. Pre-checks land here, and either side
  (or their AI agent, over MCP) can ask how a check is tested or why it failed. The verifier explains and
  never decides: the one that judges deliveries doesn't read this thread, and both parties see all of it.
-->
<script setup>
import { ref, computed, nextTick } from 'vue'
import { ListChecks, ArrowUp } from 'lucide-vue-next'
import VAvatar from './ui/VAvatar.vue'
import BrandMark from './BrandMark.vue'
import { api } from '@/services'
import { toast } from '@/composables/useToast'
import { firstName, timeAgo } from '@/domain/format'

const props = defineProps({
  milestone: { type: Object, required: true },
  contract: { type: Object, required: true },
  role: { type: String, default: null },
})

const items = computed(() => props.milestone.thread || [])
const nameOf = (author) => (author === props.role ? 'You' : firstName((author === 'client' ? props.contract.client : props.contract.freelancer)?.name || author))
const statementOf = (id) => props.milestone.criteria.find((c) => c.id === id)?.statement

const question = ref('')
const asking = ref(false)
const pending = ref('')
const list = ref(null)
const SUGGEST = computed(() => {
  const failed = props.milestone.submissions?.at(-1)?.verdict?.results?.find((r) => !r.passed)
  const failedText = failed && statementOf(failed.criterionId)
  return [
    failedText ? `Why did “${failedText.slice(0, 60)}${failedText.length > 60 ? '…' : ''}” fail?` : null,
    'Which checks are decided by probes alone?',
    props.role === 'freelancer' ? 'What exactly do I need to show for each check?' : 'What does each check prove about the work?',
  ].filter(Boolean)
})

async function ask(text = question.value) {
  const q = text.trim()
  if (q.length < 4 || asking.value) return
  asking.value = true
  pending.value = q
  question.value = ''
  await nextTick()
  list.value?.lastElementChild?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  try {
    await api.askVerifier(props.milestone.id, q)
  } catch (e) {
    toast(e.message, { tone: 'danger' })
    question.value = q
  } finally {
    asking.value = false
    pending.value = ''
  }
}
</script>

<template>
  <section class="vt">
    <div class="vt__head">
      <h3 class="vt__title">Ask the verifier</h3>
      <p class="vt__sub">How a check is tested, or why one failed. It explains; it never decides — the verifier that judges deliveries doesn’t read this, and both of you see every message.</p>
    </div>

    <ol v-if="items.length || pending" ref="list" class="vt__list">
      <li v-for="t in items" :key="t.id" class="vt__item" :class="`is-${t.kind}`">
        <!-- a pre-check: one line with the counts -->
        <template v-if="t.kind === 'precheck'">
          <span class="vt__glyph" aria-hidden="true"><ListChecks :size="14" :stroke-width="1.9" /></span>
          <div class="vt__body">
            <p class="vt__line">
              <span class="vt__who">{{ nameOf(t.author) }}</span><span v-if="t.viaAgent" class="vt__agent">agent</span>
              <span class="vk-faint">pre-checked · {{ timeAgo(t.createdAt) }}</span>
            </p>
            <p class="vt__pre vk-num">
              <span class="is-pass">{{ t.data.counts?.pass ?? 0 }} met</span> · <span :class="{ 'is-fail': t.data.counts?.fail }">{{ t.data.counts?.fail ?? 0 }} not met</span> · {{ t.data.counts?.judge ?? 0 }} for the verifier
              <span class="vk-faint"> · {{ (t.data.liveUrl || '').replace(/^https?:\/\//, '') }}</span>
            </p>
          </div>
        </template>

        <template v-else>
          <span class="vt__glyph" aria-hidden="true">
            <BrandMark v-if="t.author === 'verifier'" :size="18" />
            <VAvatar v-else :name="nameOf(t.author) === 'You' ? (role === 'client' ? contract.client?.name : contract.freelancer?.name) || 'You' : nameOf(t.author)" size="sm" />
          </span>
          <div class="vt__body">
            <p class="vt__line">
              <span class="vt__who">{{ t.author === 'verifier' ? 'Verifier' : nameOf(t.author) }}</span><span v-if="t.viaAgent" class="vt__agent">agent</span>
              <span class="vk-faint">{{ timeAgo(t.createdAt) }}</span>
            </p>
            <p class="vt__text">{{ t.body }}</p>
            <ul v-if="t.data?.nextSteps?.length" class="vt__steps">
              <li v-for="(s, i) in t.data.nextSteps" :key="i">{{ s }}</li>
            </ul>
          </div>
        </template>
      </li>
      <li v-if="pending" class="vt__item is-question">
        <span class="vt__glyph" aria-hidden="true"><VAvatar :name="(role === 'client' ? contract.client?.name : contract.freelancer?.name) || 'You'" size="sm" /></span>
        <div class="vt__body"><p class="vt__line"><span class="vt__who">You</span></p><p class="vt__text">{{ pending }}</p></div>
      </li>
      <li v-if="pending" class="vt__item is-answer">
        <span class="vt__glyph" aria-hidden="true"><BrandMark :size="18" /></span>
        <div class="vt__body"><p class="vt__line"><span class="vt__who">Verifier</span></p><p class="vt__text vk-faint"><span class="vk-spin" /> Reading the signed checks and the latest results…</p></div>
      </li>
    </ol>

    <div class="vt__suggest">
      <button v-for="s in SUGGEST" :key="s" type="button" class="vt__chip" :disabled="asking" @click="ask(s)">{{ s }}</button>
    </div>
    <form class="vt__form" @submit.prevent="ask()">
      <input v-model="question" class="vk-input" maxlength="800" placeholder="Ask about a check…" aria-label="Ask the verifier about a check" :disabled="asking" />
      <button type="submit" class="vt__send" :disabled="question.trim().length < 4 || asking" aria-label="Ask"><ArrowUp :size="16" :stroke-width="2" /></button>
    </form>
  </section>
</template>

<style scoped>
.vt { display: flex; flex-direction: column; gap: 12px; padding-top: 20px; border-top: 1px solid var(--vk-line-subtle); }
.vt__title { margin: 0; font: 400 16px/22px var(--vk-font); color: var(--vk-ink); }
.vt__sub { margin: 4px 0 0; font: var(--vk-type-small); color: var(--vk-muted); max-width: 640px; }
.vt__list { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 14px; }
.vt__item { display: flex; gap: 10px; }
.vt__glyph { display: grid; place-items: center; flex: none; width: 24px; height: 24px; color: var(--vk-muted); }
.is-precheck .vt__glyph { border: 1px solid var(--vk-line); border-radius: 50%; background: var(--vk-surface); }
.vt__body { flex: 1; min-width: 0; }
.vt__line { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; margin: 0; font: var(--vk-type-small); }
.vt__who { color: var(--vk-ink); }
.vt__agent { padding: 0 6px; border: 1px solid var(--vk-line); border-radius: var(--vk-r-full); font: 400 11px/16px var(--vk-mono); color: var(--vk-muted); }
.vt__text { margin: 3px 0 0; font: var(--vk-type-dense); color: var(--vk-ink-2); white-space: pre-wrap; }
.vt__text .vk-spin { margin-right: 6px; }
.is-answer .vt__text { color: var(--vk-ink); }
.vt__steps { margin: 6px 0 0; padding-left: 18px; display: flex; flex-direction: column; gap: 3px; font: var(--vk-type-small); color: var(--vk-ink-2); }
.vt__pre { margin: 3px 0 0; font-size: 12px; color: var(--vk-ink-2); }
.vt__pre .is-pass { color: var(--vk-ok-ink); }
.vt__pre .is-fail { color: var(--vk-danger-ink); }
.vt__suggest { display: flex; gap: 6px; flex-wrap: wrap; }
.vt__chip {
  padding: 4px 10px; border: 1px solid var(--vk-line); border-radius: var(--vk-r-full); background: var(--vk-surface);
  font: var(--vk-type-small); color: var(--vk-ink-2); cursor: pointer; text-align: left;
}
.vt__chip:hover:not(:disabled) { border-color: var(--vk-line-strong); color: var(--vk-ink); }
.vt__chip:disabled { opacity: .6; cursor: default; }
.vt__form { position: relative; }
.vt__form .vk-input { padding-right: 44px; }
.vt__send {
  position: absolute; right: 5px; top: 50%; transform: translateY(-50%); display: grid; place-items: center;
  width: 30px; height: 30px; border: 0; border-radius: 50%; background: var(--vk-accent); color: var(--vk-on-accent); cursor: pointer;
}
.vt__send:disabled { background: var(--vk-surface-2); color: var(--vk-faint); cursor: default; }
</style>
