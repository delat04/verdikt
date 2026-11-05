<script setup>
import { computed } from 'vue'
import { stepIndex } from '@/utils/format'

/* Funded → Submitted → Verifying → Released — adapted from run-arrands' run steps */
const props = defineProps({ status: { type: String, required: true } })

const LABELS = ['Funded', 'Submitted', 'Verifying', 'Released']
const current = computed(() => stepIndex(props.status))
const blocked = computed(() => props.status === 'failed' || props.status === 'disputed')
</script>

<template>
  <ol class="steps" :class="{ 'is-blocked': blocked }">
    <li
      v-for="(label, i) in LABELS"
      :key="label"
      :class="{ 'is-done': i < current || status === 'released', 'is-now': i === current && status !== 'released' }"
    >
      <span class="steps__dot" />
      <span class="steps__label">{{ blocked && i === current ? 'Held' : label }}</span>
    </li>
  </ol>
</template>

<style scoped>
.steps { display: grid; grid-template-columns: repeat(4, 1fr); margin: 0; padding: 0; list-style: none; }
.steps li { position: relative; display: flex; flex-direction: column; align-items: center; gap: 0.5rem; }
.steps li::before {
  content: ''; position: absolute; top: 6px; right: 50%; width: 100%; height: 2px;
  background: var(--line);
}
.steps li:first-child::before { display: none; }
.steps li.is-done::before, .steps li.is-now::before { background: var(--accent); }

.steps__dot {
  position: relative; z-index: 1; width: 14px; height: 14px; border-radius: 50%;
  background: var(--bg); border: 2px solid var(--line);
}
.steps li.is-done .steps__dot { background: var(--accent); border-color: var(--accent); }
.steps li.is-now .steps__dot { border-color: var(--accent); box-shadow: 0 0 0 4px var(--accent-soft); }
.steps__label { font-size: 0.6875rem; color: var(--faint); }
.steps li.is-now .steps__label { color: var(--ink); font-weight: 500; }

/* Final step goes green once money is released */
.steps li:last-child.is-done .steps__dot { background: var(--ok); border-color: var(--ok); }
.steps li:last-child.is-done::before { background: var(--ok); }

.steps.is-blocked li.is-now .steps__dot { border-color: var(--danger); box-shadow: 0 0 0 4px var(--danger-soft); }
.steps.is-blocked li.is-now .steps__label { color: var(--danger); }
</style>
