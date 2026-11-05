<!--
  NextStepCard — "what happens now", always first on a contract. A notch card whose corner holds
  who it's waiting on: your initials, theirs, or the agent's mark (turning while it works).
  Cobalt fill means it's your move — the only filled card on the page. Otherwise surface + a tone pill.
-->
<script setup>
import { computed } from 'vue'
import { Check } from 'lucide-vue-next'
import VNotchCard from './ui/VNotchCard.vue'
import VPill from './ui/VPill.vue'
import BrandMark from './BrandMark.vue'

const props = defineProps({
  step: { type: Object, required: true },
  you: { type: String, default: '' },     // names for the corner
  them: { type: String, default: '' },
})

const ACTOR = { you: 'Your move', them: 'Waiting on them', agent: 'Agent working', none: '' }
const mine = computed(() => props.step.actor === 'you')
const initials = (name) => (name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('')
const who = computed(() => ({
  you: { text: initials(props.you), tip: 'Waiting on you' },
  them: { text: initials(props.them), tip: `Waiting on ${props.them || 'them'}` },
  agent: { tip: 'The agent is working' },
  none: { tip: props.step.tone === 'ok' ? 'Done' : 'Nothing to do' },
}[props.step.actor] || { tip: '' }))
</script>

<template>
  <VNotchCard :tone="mine ? 'accent' : 'default'" class="next">
    <template #corner>
      <span class="vk-notch__corner next__who" :class="`is-${step.actor}`" :data-tip="who.tip" data-tip-pos="left" role="img" :aria-label="who.tip">
        <BrandMark v-if="step.actor === 'agent'" :size="20" />
        <Check v-else-if="step.actor === 'none'" :size="16" :stroke-width="2.2" />
        <template v-else>{{ who.text }}</template>
      </span>
    </template>

    <div class="next__row">
      <div class="next__text vk-notch__head">
        <div class="next__meta">
          <p class="vk-eyebrow">{{ step.eyebrow }}</p>
          <VPill v-if="ACTOR[step.actor]" size="sm" :tone="mine ? 'accent' : step.actor === 'agent' ? 'warn' : step.tone" :live="step.actor === 'agent'">
            {{ ACTOR[step.actor] }}
          </VPill>
        </div>
        <h2 class="next__title">{{ step.title }}</h2>
        <p class="next__sub">{{ step.sub }}</p>
      </div>
      <div v-if="$slots.default" class="next__actions"><slot /></div>
    </div>
  </VNotchCard>
</template>

<style scoped>
.next :deep(.vk-notch__body) { padding: 24px 26px 26px; }
.next__row { display: flex; align-items: flex-end; gap: var(--vk-sp-6); flex-wrap: wrap; }
.next__text { flex: 1 1 340px; min-width: 0; }
.next__meta { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.next__title { margin: 14px 0 0; font: 400 26px/32px var(--vk-font); letter-spacing: -.025em; }
.next__sub { margin: 8px 0 0; max-width: 620px; font: var(--vk-type-body); color: var(--vk-muted); }
.next__actions { display: flex; gap: var(--vk-sp-2); flex-wrap: wrap; }
.vk-notch--accent .next__sub { color: var(--vk-on-accent); }

.next__who { font: 400 12px/1 var(--vk-font); letter-spacing: .02em; }
.next__who.is-agent { color: var(--vk-ink); }
.next__who.is-agent::before {
  content: ''; position: absolute; inset: -4px; border-radius: 50%;
  border: 1.5px solid transparent; border-top-color: var(--vk-warn); animation: vk-spin 1.4s linear infinite;
}
.next__who.is-none { color: var(--vk-ok-ink); }

@media (max-width: 640px) {
  .next__title { font-size: 21px; line-height: 27px; }
  .next__actions { width: 100%; }
}
</style>
