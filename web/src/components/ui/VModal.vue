<!-- VModal — centred dialog. Esc and the scrim close it unless `persistent`. Slots: default · foot -->
<script setup>
import { watch, onBeforeUnmount } from 'vue'
import { X } from 'lucide-vue-next'
import VIconButton from './VIconButton.vue'

const props = defineProps({
  open: { type: Boolean, default: false },
  title: { type: String, default: '' },
  sub: { type: String, default: '' },
  wide: { type: Boolean, default: false },
  persistent: { type: Boolean, default: false },
})
const emit = defineEmits(['close'])

function onKey(e) {
  if (e.key === 'Escape' && !props.persistent) emit('close')
}
watch(() => props.open, (o) => {
  if (o) window.addEventListener('keydown', onKey)
  else window.removeEventListener('keydown', onKey)
}, { immediate: true })
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <Teleport to="body">
    <Transition name="vk-fade">
      <div v-if="open" class="vk-scrim" @mousedown.self="!persistent && emit('close')">
        <div class="vk-modal" :class="{ 'vk-modal--wide': wide }" role="dialog" aria-modal="true" :aria-label="title">
          <header v-if="title" class="vk-modal__head">
            <div style="flex: 1">
              <h2 class="vk-modal__title">{{ title }}</h2>
              <p v-if="sub" class="vk-modal__sub">{{ sub }}</p>
            </div>
            <VIconButton v-if="!persistent" :icon="X" label="Close" size="sm" bare @click="emit('close')" />
          </header>
          <div class="vk-modal__body"><slot /></div>
          <footer v-if="$slots.foot" class="vk-modal__foot"><slot name="foot" /></footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
