<!-- StageTrack — one milestone's stops, Held → Delivered → Verified → Paid, with when each one happened. -->
<script setup>
import { computed } from 'vue'
import { LANE, trackState, latestSubmission } from '@/domain/milestone'
import { shortDate } from '@/domain/format'

const props = defineProps({ milestone: { type: Object, required: true } })
const s = computed(() => trackState(props.milestone.status))

function cls(i) {
  const { index, mode } = s.value
  if (mode === 'ok') return { 'is-done': true, 'is-ok': i === LANE.length - 1 }
  if (i < index) return { 'is-done': true }
  if (i === index) return { 'is-now': true, 'is-blocked': mode === 'blocked', 'is-waiting': mode === 'waiting' }
  return {}
}
function label(i, text) {
  const { index, mode } = s.value
  if (i !== index) return text
  if (mode === 'blocked') return 'Not yet'
  if (mode === 'waiting' && i === 2) return props.milestone.status === 'disputed' ? 'In review' : 'Verifying'
  if (mode === 'waiting' && i === 3) return 'Releasing'
  return text
}
const meta = computed(() => {
  const m = props.milestone
  const sub = latestSubmission(m)
  const v = sub?.verdict
  const failed = v ? v.results.filter((r) => !r.passed).length : 0
  return [
    m.fundedAt ? shortDate(m.fundedAt) : '—',
    sub ? (sub.attempt > 1 ? `Try ${sub.attempt} · ${shortDate(sub.createdAt)}` : shortDate(sub.createdAt)) : '—',
    m.status === 'verifying' ? 'now' : v?.integrity ? 'flagged' : v ? (failed ? `${failed} failed` : `${v.results.length}/${v.results.length} passed`) : '—',
    m.releasedAt ? shortDate(m.releasedAt) : '—',
  ]
})
</script>

<template>
  <ol class="vk-track" :aria-label="`Milestone progress: ${milestone.status}`">
    <li v-for="(t, i) in LANE" :key="t" class="vk-track__step" :class="cls(i)">
      <span class="vk-track__dot" />
      <span class="vk-track__label">{{ label(i, t) }}</span>
      <span class="vk-track__meta">{{ meta[i] }}</span>
    </li>
  </ol>
</template>
