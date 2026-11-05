<!-- VSegmented — options [{ value, label, icon?, aria? }] with a gliding thumb (v-glide). Icon-only options name themselves with `aria`. -->
<script setup>
import { vGlide } from '@/directives/glide'

defineProps({
  options: { type: Array, required: true },
  block: { type: Boolean, default: false },
  label: { type: String, default: '' },
})
const model = defineModel({ type: [String, Number, Boolean] })
</script>

<template>
  <div v-glide class="vk-seg" :class="{ 'vk-seg--block': block }" role="radiogroup" :aria-label="label || undefined">
    <button
      v-for="o in options"
      :key="String(o.value)"
      type="button"
      role="radio"
      class="vk-seg__btn"
      :class="{ 'is-active': model === o.value }"
      :aria-checked="model === o.value"
      :aria-label="o.label ? undefined : o.aria"
      :title="o.label ? undefined : o.aria"
      @click="model = o.value"
    >
      <component :is="o.icon" v-if="o.icon" :size="14" :stroke-width="1.9" aria-hidden="true" />
      {{ o.label }}
    </button>
  </div>
</template>
