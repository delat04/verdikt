<script setup>
import { computed } from 'vue'

const props = defineProps({ name: { type: String, default: '' }, size: { type: String, default: 'md' } })
const initials = computed(() =>
  (props.name || '?').split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?')
</script>

<template>
  <span class="vk-avatar" :class="size !== 'md' && `vk-avatar--${size}`" :title="name" aria-hidden="true">{{ initials }}</span>
</template>
