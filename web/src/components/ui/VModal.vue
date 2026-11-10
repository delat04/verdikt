<!--
  VModal — centred dialog. Esc and the scrim close it unless `persistent`. Slots: default · foot
  size 'theater' is the wide video stage (full screen on a phone).
  data-lenis-prevent: on a page with smooth scrolling (the landing), the dialog scrolls natively.
  Focus: on open it goes to the first [data-autofocus] inside, else the Close button, else the dialog itself —
  never to the first focusable, which in a persistent modal can be a money action. Tab stays inside (iframes
  count: FundModal hosts PayPal's buttons), and on close focus goes back to what opened it. Focus or keys in another
  modal dialog over this one (the command palette) are left to that dialog.
-->
<script setup>
import { ref, watch, nextTick, onBeforeUnmount } from 'vue'
import { X } from 'lucide-vue-next'
import VIconButton from './VIconButton.vue'

const props = defineProps({
  open: { type: Boolean, default: false },
  title: { type: String, default: '' },
  sub: { type: String, default: '' },
  wide: { type: Boolean, default: false },
  size: { type: String, default: '' },          // '' | 'theater'
  persistent: { type: Boolean, default: false },
})
const emit = defineEmits(['close'])

const dialog = ref(null)
let returnTo = null

const FOCUSABLE = [
  'a[href]', 'area[href]', 'button:not([disabled])', 'input:not([disabled]):not([type=hidden])', 'select:not([disabled])',
  'textarea:not([disabled])', 'iframe', 'video[controls]', 'audio[controls]', '[contenteditable=true]', '[tabindex]:not([tabindex="-1"])',
].join(',')
const focusables = () => [...(dialog.value?.querySelectorAll(FOCUSABLE) || [])].filter((el) => el.getClientRects().length && !el.closest('[inert]'))
// with two dialogs open, only the one on top handles keys and focus
const onTop = () => {
  const all = document.querySelectorAll('.vk-modal')
  return !!dialog.value && all[all.length - 1] === dialog.value
}
// focus inside another modal dialog (the command palette over this one): its keys and focus are its own
const inOtherDialog = (el) => {
  const d = el?.closest?.('[aria-modal="true"]')
  return !!d && d !== dialog.value
}

function focusFirst() {
  const el = dialog.value
  if (!el) return
  const target = el.querySelector('[data-autofocus]') || el.querySelector('.vk-modal__close') || el
  target.focus({ preventScroll: true })
}

function onKey(e) {
  if (!onTop() || inOtherDialog(document.activeElement)) return
  if (e.key === 'Escape' && !props.persistent) { emit('close'); return }
  if (e.key !== 'Tab') return
  const list = focusables()
  if (!list.length) { e.preventDefault(); dialog.value.focus(); return }
  const first = list[0]
  const last = list[list.length - 1]
  const active = document.activeElement
  if (!dialog.value.contains(active)) { e.preventDefault(); first.focus(); return }
  if (e.shiftKey && (active === first || active === dialog.value)) { e.preventDefault(); last.focus() }
  else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus() }
}
// Tab inside an iframe never reaches this window, so focus that leaves the dialog any other way is brought back
function onFocusIn(e) {
  if (!onTop() || dialog.value.contains(e.target) || inOtherDialog(e.target)) return
  ;(focusables()[0] || dialog.value).focus({ preventScroll: true })
}

function release() {
  window.removeEventListener('keydown', onKey)
  document.removeEventListener('focusin', onFocusIn)
}
watch(() => props.open, async (o, was) => {
  if (o) {
    returnTo = document.activeElement
    window.addEventListener('keydown', onKey)
    document.addEventListener('focusin', onFocusIn)
    await nextTick()
    focusFirst()
  } else {
    release()
    if (was && returnTo?.isConnected) returnTo.focus({ preventScroll: true })
    returnTo = null
  }
}, { immediate: true })
onBeforeUnmount(() => {
  release()
  if (props.open && returnTo?.isConnected) returnTo.focus({ preventScroll: true })
})
</script>

<template>
  <Teleport to="body">
    <Transition name="vk-fade">
      <div v-if="open" class="vk-scrim" @mousedown.self="!persistent && emit('close')">
        <div
          ref="dialog"
          class="vk-modal"
          :class="{ 'vk-modal--wide': wide, [`vk-modal--${size}`]: !!size }"
          role="dialog" aria-modal="true" :aria-label="title" tabindex="-1" data-lenis-prevent
        >
          <header v-if="title" class="vk-modal__head">
            <div style="flex: 1">
              <h2 class="vk-modal__title">{{ title }}</h2>
              <p v-if="sub" class="vk-modal__sub">{{ sub }}</p>
            </div>
            <VIconButton v-if="!persistent" class="vk-modal__close" :icon="X" label="Close" size="sm" bare @click="emit('close')" />
          </header>
          <div class="vk-modal__body"><slot /></div>
          <footer v-if="$slots.foot" class="vk-modal__foot"><slot name="foot" /></footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
