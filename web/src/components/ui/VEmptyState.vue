<script setup>
defineProps({
  icon: { type: [Object, Function], default: null },
  title: { type: String, required: true },
  sub: { type: String, default: '' },
})
</script>

<template>
  <div class="vk-empty">
    <span v-if="icon" class="vk-empty__icon"><component :is="icon" :size="20" :stroke-width="1.75" /></span>
    <h3 class="vk-empty__title">{{ title }}</h3>
    <p v-if="sub" class="vk-empty__sub">{{ sub }}</p>
    <div v-if="$slots.default" class="vk-empty__actions"><slot /></div>
  </div>
</template>
