<!-- BrandMark — the V: outer stroke in ink (currentColor), inner chevron in accent. -->
<script setup>
defineProps({ size: { type: Number, default: 28 } })
</script>

<template>
  <svg :width="size" :height="size" viewBox="0 0 64 64" fill="none" aria-hidden="true">
    <path d="M10 14 L32 54 L54 14" stroke="currentColor" stroke-width="4.5" stroke-linejoin="round" stroke-linecap="round" />
    <path d="M21 14 L32 34 L43 14" stroke="var(--vk-accent)" stroke-width="3.5" stroke-linejoin="round" stroke-linecap="round" />
  </svg>
</template>
