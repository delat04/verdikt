<script setup>
import { toasts } from '@/composables/useToast'
</script>

<template>
  <div class="vk-toasts" role="status" aria-live="polite">
    <TransitionGroup name="vk-fade">
      <div v-for="t in toasts" :key="t.id" class="vk-toast" :class="`vk-toast--${t.tone}`">
        <span class="vk-toast__dot" aria-hidden="true" />
        <span class="vk-toast__msg">{{ t.message }}</span>
      </div>
    </TransitionGroup>
  </div>
</template>
