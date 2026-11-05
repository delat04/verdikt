<!--
  VNotchCard — the Workspace card: soft 28px corners, the top-right corner cut out around a round
  button. The outline is an SVG path drawn at the card's measured size, so the 1px line follows
  the notch exactly (no clip-path tricks, no missing border on the curve).
  tone: default | accent (cobalt fill = "your move") | ink
  `to` turns the whole card into one link and the corner into its arrow.
  Slot `corner` replaces the arrow (an avatar, a link of its own when the card isn't a link).
-->
<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { RouterLink } from 'vue-router'
import { ArrowUpRight } from 'lucide-vue-next'

const props = defineProps({
  to: { type: [String, Object], default: null },
  tone: { type: String, default: 'default' },
  radius: { type: Number, default: 28 },
  as: { type: String, default: 'article' },
})

// notch geometry: a 40px button with a 6px moat → 52px pocket; RC hugs the button, RF rounds the shoulders
const N = 52
const RC = 26
const RF = 14

const root = ref(null)
const w = ref(0)
const h = ref(0)
let ro = null
const node = () => root.value?.$el || root.value
function measure() {
  const el = node()
  if (!el) return
  w.value = el.offsetWidth
  h.value = el.offsetHeight
}
onMounted(() => {
  measure()
  if (typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(measure)
    ro.observe(node())
  }
})
onBeforeUnmount(() => ro?.disconnect())

const d = computed(() => {
  const W = w.value
  const H = h.value
  if (!W || !H) return ''
  const s = 0.5                                        // half-pixel: a crisp 1px stroke
  const R = Math.max(8, Math.min(props.radius, (H - N - RF) / 2, (W - N - RF) / 2))
  const x = W - N
  return [
    `M${s + R},${s}`,
    `H${x - RF}`,
    `A${RF},${RF} 0 0 1 ${x},${s + RF}`,               // shoulder down into the pocket
    `V${N - RC}`,
    `A${RC},${RC} 0 0 0 ${x + RC},${N}`,               // the pocket hugs the button
    `H${W - s - RF}`,
    `A${RF},${RF} 0 0 1 ${W - s},${N + RF}`,           // shoulder back out
    `V${H - s - R}`,
    `A${R},${R} 0 0 1 ${W - s - R},${H - s}`,
    `H${s + R}`,
    `A${R},${R} 0 0 1 ${s},${H - s - R}`,
    `V${s + R}`,
    `A${R},${R} 0 0 1 ${s + R},${s}`,
    'Z',
  ].join(' ')
})
</script>

<template>
  <component
    :is="to ? RouterLink : as"
    ref="root"
    :to="to || undefined"
    class="vk-notch"
    :class="[tone !== 'default' && `vk-notch--${tone}`, { 'vk-notch--link': !!to }]"
  >
    <svg class="vk-notch__shape" :width="w" :height="h" aria-hidden="true"><path :d="d" /></svg>
    <slot name="corner">
      <span class="vk-notch__corner" aria-hidden="true"><ArrowUpRight :size="17" :stroke-width="1.9" /></span>
    </slot>
    <div class="vk-notch__body"><slot /></div>
  </component>
</template>
