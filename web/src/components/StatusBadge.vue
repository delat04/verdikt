<script setup>
import { computed } from 'vue'
import { MILESTONE_STATUS } from '@/utils/format'

const props = defineProps({ status: { type: String, required: true } })
const meta = computed(() => MILESTONE_STATUS[props.status] || { label: props.status, tone: 'faint' })
</script>

<template>
  <span class="badge" :data-tone="meta.tone">
    <span class="badge__dot" />
    {{ meta.label }}
  </span>
</template>

<style scoped>
.badge {
  display: inline-flex; align-items: center; gap: 0.375rem;
  padding: 0.1875rem 0.625rem; border-radius: 999px;
  font-size: 0.75rem; font-weight: 500; white-space: nowrap;
  color: var(--muted); background: var(--bg-3);
}
.badge__dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }

.badge[data-tone='accent'] { color: var(--accent-2); background: var(--accent-soft); }
.badge[data-tone='ok']     { color: var(--ok);       background: var(--ok-soft); }
.badge[data-tone='warn']   { color: var(--warn);     background: var(--warn-soft); }
.badge[data-tone='danger'] { color: var(--danger);   background: var(--danger-soft); }
.badge[data-tone='warn'] .badge__dot { animation: pulse 1.4s ease-in-out infinite; }

@keyframes pulse { 50% { opacity: 0.35; } }
</style>
