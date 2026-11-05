<!-- VTabs — underline tabs; the ink glides under the active one. options [{ value, label, count? }] -->
<script setup>
import { vGlide } from '@/directives/glide'

defineProps({ options: { type: Array, required: true }, label: { type: String, default: '' } })
const model = defineModel({ type: [String, Number] })
</script>

<template>
  <nav v-glide class="vk-tabs" role="tablist" :aria-label="label || undefined">
    <button
      v-for="o in options"
      :key="o.value"
      type="button"
      role="tab"
      class="vk-tabs__btn"
      :class="{ 'is-active': model === o.value }"
      :aria-selected="model === o.value"
      @click="model = o.value"
    >
      {{ o.label }}
      <span v-if="o.count != null" class="vk-tabs__n">{{ o.count }}</span>
    </button>
  </nav>
</template>
