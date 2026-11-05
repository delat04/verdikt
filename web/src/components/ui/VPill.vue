<!-- VPill — status / tag. tone: neutral | accent | ok | warn | danger. `live` pulses the dot (work in progress). -->
<script setup>
defineProps({
  tone: { type: String, default: 'neutral' },
  dot: { type: Boolean, default: true },
  live: { type: Boolean, default: false },
  size: { type: String, default: 'md' },
  outline: { type: Boolean, default: false },
})
</script>

<template>
  <span
    class="vk-pill"
    :class="[tone !== 'neutral' && `vk-pill--${tone}`, { 'vk-pill--live': live, 'vk-pill--sm': size === 'sm', 'vk-pill--outline': outline }]"
  >
    <span v-if="dot" class="vk-pill__dot" aria-hidden="true" />
    <slot />
  </span>
</template>
