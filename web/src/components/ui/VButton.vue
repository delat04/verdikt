<!--
  VButton — pill button. variant: primary | ink | secondary | ghost | ok | danger.
  `ok` (green) is reserved for actions that move money to the freelancer.
  <VButton variant="primary" :icon="Plus" @click="…">New contract</VButton>
  <VButton to="/contracts" variant="secondary">Back</VButton>
-->
<script setup>
import { computed } from 'vue'
import { RouterLink } from 'vue-router'

const props = defineProps({
  variant: { type: String, default: 'primary' },
  size: { type: String, default: 'md' },        // sm | md | lg
  icon: { type: [Object, Function], default: null },
  iconRight: { type: [Object, Function], default: null },
  loading: { type: Boolean, default: false },
  block: { type: Boolean, default: false },
  disabled: { type: Boolean, default: false },
  to: { type: [String, Object], default: null },
  type: { type: String, default: 'button' },
  orb: { type: Boolean, default: false },       // the leading icon sits in its own circle: "(+) New contract"
})

const tag = computed(() => (props.to ? RouterLink : 'button'))
const iconSize = computed(() => (props.size === 'sm' ? 14 : props.size === 'lg' ? 18 : 16))
</script>

<template>
  <component
    :is="tag"
    :to="to || undefined"
    :type="to ? undefined : type"
    class="vk-btn"
    :class="[`vk-btn--${variant}`, size !== 'md' && `vk-btn--${size}`, { 'vk-btn--block': block, 'vk-btn--orb': orb && icon, 'is-loading': loading }]"
    :disabled="to ? undefined : disabled || loading"
    :aria-busy="loading || undefined"
  >
    <span v-if="icon && orb" class="vk-btn__orb"><component :is="icon" :size="iconSize" :stroke-width="2" aria-hidden="true" /></span>
    <component :is="icon" v-else-if="icon" :size="iconSize" :stroke-width="1.9" aria-hidden="true" />
    <slot />
    <component :is="iconRight" v-if="iconRight" :size="iconSize" :stroke-width="1.9" aria-hidden="true" />
  </component>
</template>

<style scoped>
a.vk-btn { text-decoration: none; }
</style>
