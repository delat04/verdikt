<!-- VCopy — a value with a copy button (invite codes, PayPal ids). -->
<script setup>
import { ref } from 'vue'
import { Copy, Check } from 'lucide-vue-next'

const props = defineProps({ value: { type: String, required: true }, label: { type: String, default: 'Copy' } })
const done = ref(false)

async function copy() {
  try {
    await navigator.clipboard.writeText(props.value)
    done.value = true
    setTimeout(() => (done.value = false), 1600)
  } catch {}
}
</script>

<template>
  <span class="copy">
    <span class="copy__val vk-num"><slot>{{ value }}</slot></span>
    <button type="button" class="copy__btn" :aria-label="done ? 'Copied' : label" :title="done ? 'Copied' : label" @click="copy">
      <Check v-if="done" :size="14" :stroke-width="2" />
      <Copy v-else :size="14" :stroke-width="1.9" />
    </button>
  </span>
</template>

<style scoped>
.copy { display: inline-flex; align-items: center; gap: 6px; min-width: 0; }
.copy__val { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.copy__btn {
  display: inline-grid; place-items: center; width: 26px; height: 26px; flex: none;
  border: 1px solid var(--vk-line); border-radius: var(--vk-r-full); background: var(--vk-surface);
  color: var(--vk-muted); cursor: pointer;
}
.copy__btn:hover { color: var(--vk-ink); border-color: var(--vk-line-strong); }
</style>
