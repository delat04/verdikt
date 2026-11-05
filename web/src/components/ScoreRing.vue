<script setup>
import { computed } from 'vue'

/* Verdict confidence ring — adapted from run-arrands' AiScoreRing */
const props = defineProps({
  score: { type: Number, default: 0 },      // 0–100
  size: { type: Number, default: 80 },
  threshold: { type: Number, default: 85 },
})

const radius = computed(() => (props.size - 8) / 2)
const circumference = computed(() => 2 * Math.PI * radius.value)
const offset = computed(() => circumference.value - (props.score / 100) * circumference.value)
const color = computed(() => (props.score >= props.threshold ? 'var(--ok)' : 'var(--warn)'))
</script>

<template>
  <div class="ring" :style="{ width: size + 'px', height: size + 'px' }">
    <svg :width="size" :height="size" :viewBox="`0 0 ${size} ${size}`">
      <circle :cx="size / 2" :cy="size / 2" :r="radius" fill="none" stroke="var(--line)" stroke-width="6" />
      <circle
        :cx="size / 2" :cy="size / 2" :r="radius"
        fill="none" :stroke="color" stroke-width="6" stroke-linecap="round"
        :stroke-dasharray="circumference" :stroke-dashoffset="offset"
        class="ring__bar"
      />
    </svg>
    <span class="ring__label num" :style="{ color }">{{ score }}%</span>
  </div>
</template>

<style scoped>
.ring { position: relative; display: inline-flex; align-items: center; justify-content: center; }
.ring__bar { transform: rotate(-90deg); transform-origin: 50% 50%; transition: stroke-dashoffset 0.6s ease; }
.ring__label { position: absolute; font-weight: 600; font-size: 0.9375rem; }
</style>
