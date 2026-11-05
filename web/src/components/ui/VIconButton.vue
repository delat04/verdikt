<!-- VIconButton — a round control. size: sm | md | lg (44px, the Workspace circle) · tone: default | ink | accent -->
<script setup>
defineProps({
  icon: { type: [Object, Function], required: true },
  label: { type: String, required: true },     // aria-label + tooltip: an icon button always says what it does
  size: { type: String, default: 'md' },
  tone: { type: String, default: 'default' },
  bare: { type: Boolean, default: false },
  disabled: { type: Boolean, default: false },
  tip: { type: String, default: '' },          // '' = native title · 'right' | 'top' = styled tooltip
})
</script>

<template>
  <button
    type="button"
    class="vk-icon-btn"
    :class="[size !== 'md' && `vk-icon-btn--${size}`, tone !== 'default' && `vk-icon-btn--${tone}`, { 'vk-icon-btn--bare': bare }]"
    :aria-label="label"
    :title="tip ? undefined : label"
    :data-tip="tip ? label : undefined"
    :data-tip-pos="tip === 'top' ? 'top' : undefined"
    :disabled="disabled"
  >
    <component :is="icon" :size="size === 'sm' ? 14 : size === 'lg' ? 18 : 17" :stroke-width="1.9" aria-hidden="true" />
  </button>
</template>
