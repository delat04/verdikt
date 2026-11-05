<!--
  CheckMeter — a milestone paid check by check: one slice of the payment per signed check. A slice turns
  green when its check passes, and the money it earned is captured from the PayPal hold and paid out.
  Reads the latest verdict for which checks passed, and the milestone's tranches for what was released.
-->
<script setup>
import { computed } from 'vue'
import { money } from '@/domain/format'

const props = defineProps({
  milestone: { type: Object, required: true },
  currency: { type: String, default: 'USD' },
})
const verdict = computed(() => [...(props.milestone.submissions || [])].sort((a, b) => b.attempt - a.attempt)[0]?.verdict || null)
const slices = computed(() => {
  const list = props.milestone.criteria || []
  const per = list.length ? props.milestone.amountCents / list.length : 0
  return list.map((c) => {
    const r = verdict.value?.results?.find((x) => x.criterionId === c.id)
    return { id: c.id, statement: c.statement, passed: !!r?.passed, failed: r && !r.passed, cents: per }
  })
})
const passed = computed(() => slices.value.filter((s) => s.passed).length)
const released = computed(() => props.milestone.releasedCents || 0)
const tranches = computed(() => props.milestone.tranches || [])
</script>

<template>
  <div class="cm" :aria-label="`${passed} of ${slices.length} checks passed, ${money(released, currency)} released`">
    <div class="cm__bar">
      <span
        v-for="(s, i) in slices" :key="s.id" class="cm__slice"
        :class="{ 'is-passed': s.passed, 'is-failed': s.failed }"
        :data-tip="`${s.passed ? 'Passed' : s.failed ? 'Not yet' : 'Not checked yet'} · ${money(s.cents, currency, { whole: true })} · ${s.statement}`"
        :style="{ animationDelay: `${i * 60}ms` }"
      />
    </div>
    <p class="cm__text">
      <span class="cm__money vk-num">{{ money(released, currency, { whole: true }) }}</span>
      <span class="vk-faint"> of {{ money(milestone.amountCents, currency, { whole: true }) }} released · {{ passed }} of {{ slices.length }} checks</span>
      <span v-if="tranches.length" class="vk-faint"> · {{ tranches.length }} PayPal capture{{ tranches.length > 1 ? 's' : '' }}</span>
    </p>
  </div>
</template>

<style scoped>
.cm { display: flex; flex-direction: column; gap: 8px; }
.cm__bar { display: flex; gap: 4px; }
.cm__slice {
  position: relative; flex: 1; height: 10px; border-radius: var(--vk-r-full);
  background: var(--vk-surface-2); border: 1px solid var(--vk-line);
  transition: background var(--vk-dur-4) var(--vk-ease-out), border-color var(--vk-dur-4);
}
.cm__slice.is-passed { background: var(--vk-ok); border-color: var(--vk-ok); animation: cm-in var(--vk-dur-4) var(--vk-ease-out) both; }
.cm__slice.is-failed { border-color: color-mix(in srgb, var(--vk-danger) 45%, var(--vk-line)); }
@keyframes cm-in { from { transform: scaleX(.4); opacity: .4; } to { transform: none; opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .cm__slice.is-passed { animation: none; } }
.cm__text { margin: 0; font: var(--vk-type-small); }
.cm__money { color: var(--vk-ok-ink); }
</style>
