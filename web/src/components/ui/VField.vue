<!-- VField — label + control + hint/error. The control goes in the default slot; `for` ties the label to it. -->
<script setup>
defineProps({
  label: { type: String, default: '' },
  for: { type: String, default: undefined },
  hint: { type: String, default: '' },
  error: { type: String, default: '' },
  optional: { type: Boolean, default: false },
})
</script>

<template>
  <div class="vk-field">
    <label v-if="label" class="vk-field__label" :for="$props.for">
      {{ label }}<small v-if="optional">Optional</small>
    </label>
    <slot />
    <p v-if="error" class="vk-field__error" role="alert">{{ error }}</p>
    <p v-else-if="hint" class="vk-field__hint">{{ hint }}</p>
  </div>
</template>

<style scoped>
.vk-field__hint, .vk-field__error { margin: 0; }
</style>
