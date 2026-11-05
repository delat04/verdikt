<!-- ScoreRing — verdict confidence / checks passed. Green only when it passes the threshold. -->
<script setup>
import { computed } from 'vue'

const props = defineProps({
  value: { type: Number, default: 0 },      // 0–100
  size: { type: Number, default: 88 },
  stroke: { type: Number, default: 6 },
  pass: { type: Boolean, default: null },   // force the tone; default: value >= threshold
  threshold: { type: Number, default: 100 },
  label: { type: String, default: '' },     // replaces the % in the middle
  pending: { type: Boolean, default: false }, // still running: accent, not a verdict colour
})

const r = computed(() => (props.size - props.stroke - 2) / 2)
const c = computed(() => 2 * Math.PI * r.value)
const offset = computed(() => c.value - (Math.min(100, Math.max(0, props.value)) / 100) * c.value)
const ok = computed(() => (props.pass ?? props.value >= props.threshold))
</script>

<template>
  <div class="score" :class="{ 'is-ok': ok && !pending, 'is-pending': pending }" :style="{ width: `${size}px`, height: `${size}px` }">
    <svg :width="size" :height="size" :viewBox="`0 0 ${size} ${size}`" aria-hidden="true">
      <circle :cx="size / 2" :cy="size / 2" :r="r" fill="none" class="score__track" :stroke-width="stroke" />
      <circle
        :cx="size / 2" :cy="size / 2" :r="r" fill="none" class="score__bar" :stroke-width="stroke"
        stroke-linecap="round" :stroke-dasharray="c" :stroke-dashoffset="offset"
      />
    </svg>
    <span class="score__label vk-num">{{ label || `${Math.round(value)}%` }}</span>
  </div>
</template>

<style scoped>
.score { position: relative; display: inline-grid; place-items: center; flex: none; }
.score svg { position: absolute; inset: 0; }
.score__track { stroke: var(--vk-line); }
.score__bar { stroke: var(--vk-danger); transform: rotate(-90deg); transform-origin: 50% 50%; transition: stroke-dashoffset .7s var(--vk-ease-out), stroke .3s; }
.score.is-ok .score__bar { stroke: var(--vk-ok); }
.score.is-pending .score__bar { stroke: var(--vk-accent); }
.score__label { position: relative; font-size: 15px; font-weight: 400; color: var(--vk-ink); }
</style>
