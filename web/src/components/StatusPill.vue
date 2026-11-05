<script setup>
import { computed } from 'vue'
import VPill from './ui/VPill.vue'
import { STATUS, CONTRACT_STATUS } from '@/domain/milestone'

const props = defineProps({
  status: { type: String, required: true },
  contract: { type: Boolean, default: false },
  size: { type: String, default: 'md' },
})
const meta = computed(() => (props.contract ? CONTRACT_STATUS : STATUS)[props.status] || { label: props.status, tone: 'neutral' })
</script>

<template>
  <VPill :tone="meta.tone" :live="!!meta.live" :size="size">{{ meta.label }}</VPill>
</template>
