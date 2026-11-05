<!-- VChips — filter chips on the canvas; the white thumb glides to the active one. options [{ value, label, count? }] -->
<script setup>
import { vGlide } from '@/directives/glide'

defineProps({ options: { type: Array, required: true }, label: { type: String, default: '' } })
const model = defineModel({ type: [String, Number] })
</script>

<template>
  <div v-glide class="vk-chips" role="radiogroup" :aria-label="label || undefined">
    <button
      v-for="o in options"
      :key="o.value"
      type="button"
      role="radio"
      class="vk-chip"
      :class="{ 'is-active': model === o.value }"
      :aria-checked="model === o.value"
      @click="model = o.value"
    >
      {{ o.label }}
      <span v-if="o.count != null" class="vk-chip__n">{{ o.count }}</span>
    </button>
  </div>
</template>
