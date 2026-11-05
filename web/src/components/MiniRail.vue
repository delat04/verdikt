<!-- MiniRail — the escrow rail at card size: one bar per milestone, sized by amount. Green = paid. -->
<script setup>
import { computed } from 'vue'

const props = defineProps({ milestones: { type: Array, required: true }, signed: { type: Boolean, default: true } })

const TONE = { failed: 'danger', verifying: 'warn', submitted: 'warn', disputed: 'warn', passed: 'ok' }
const total = computed(() => props.milestones.reduce((s, m) => s + m.amountCents, 0) || 1)
const live = computed(() => (props.signed ? props.milestones.find((m) => !['released', 'refunded'].includes(m.status))?.id : null))
const bars = computed(() => props.milestones.map((m) => ({
  id: m.id,
  grow: (0.3 + m.amountCents / total.value).toFixed(3),
  state: m.status === 'released' ? 'paid' : m.status === 'refunded' ? 'void' : m.id === live.value ? TONE[m.status] || 'live' : 'next',
})))
const paid = computed(() => props.milestones.filter((m) => m.status === 'released').length)
</script>

<template>
  <div class="mini" role="img" :aria-label="`${paid} of ${milestones.length} milestones paid`">
    <span v-for="b in bars" :key="b.id" class="mini__bar" :data-state="b.state" :style="{ flexGrow: b.grow }" />
  </div>
</template>

<style scoped>
.mini { display: flex; gap: 3px; }
.mini__bar { flex-basis: 0; height: 8px; border-radius: var(--vk-r-full); background: var(--vk-surface-2); box-shadow: inset 0 0 0 1px var(--vk-line); }
.mini__bar[data-state='paid'] { background: var(--vk-ok); box-shadow: none; }
.mini__bar[data-state='live'] { background: var(--vk-accent); box-shadow: none; }
.mini__bar[data-state='warn'] { background: var(--vk-warn); box-shadow: none; }
.mini__bar[data-state='danger'] { background: var(--vk-danger); box-shadow: none; }
.mini__bar[data-state='ok'] { background: var(--vk-ok); box-shadow: none; }
.mini__bar[data-state='void'] { background: repeating-linear-gradient(135deg, var(--vk-line) 0 3px, transparent 3px 6px); }
</style>
