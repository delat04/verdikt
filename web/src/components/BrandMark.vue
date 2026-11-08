<!-- BrandMark — the Verdikt mark: the work's stroke in ink (currentColor, so it turns white on dark), and the money's
     stroke that crosses it in accent. `tile` sets it on its own dark tile, as in the favicon. -->
<script setup>
import { MARK, ACCENT, TILE } from './markPaths'
defineProps({ size: { type: Number, default: 28 }, tile: { type: Boolean, default: false } })
</script>

<template>
  <svg :width="size" :height="size" viewBox="0 0 80 80" fill="none" aria-hidden="true">
    <rect v-if="tile" width="80" height="80" rx="18" :fill="TILE" />
    <path :d="MARK.work" :fill="tile ? '#FFFFFF' : 'currentColor'" />
    <path :d="MARK.pay" :fill="ACCENT" />
  </svg>
</template>
