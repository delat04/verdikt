/**
 * v-glide — one active indicator that travels between the items of a group
 * (nav rows, segmented options, tabs, lineage nodes). Ported from Aeon's v-ae-glide / Dextra's v-glide.
 *
 *   <nav v-glide class="vk-seg"><button class="vk-seg__btn is-active">…</button>…</nav>
 *   <ul v-glide="'[aria-current=page]'">…</ul>      (custom selector for the active item)
 *
 * Measures the active item and writes --vk-gx/--vk-gy/--vk-gw/--vk-gh/--vk-go on the group, adds
 * `.vk-glide` (the group's ::before is the indicator; geometry in ds.css, colour/radius per group)
 * and `.is-glide-ready` once placed, so the first paint lands without sliding.
 */
import { nextTick } from 'vue'

const ACTIVE = '.is-active, [aria-current="page"], [aria-selected="true"], [aria-checked="true"]'

function place(el) {
  const active = el.querySelector(el._glideSelector || ACTIVE)
  if (!active || active.offsetWidth === 0) {
    el.style.setProperty('--vk-go', '0')
    return
  }
  const e = el.getBoundingClientRect()
  const r = active.getBoundingClientRect()
  el.style.setProperty('--vk-gx', `${r.left - e.left - el.clientLeft + el.scrollLeft}px`)
  el.style.setProperty('--vk-gy', `${r.top - e.top - el.clientTop + el.scrollTop}px`)
  el.style.setProperty('--vk-gw', `${r.width}px`)
  el.style.setProperty('--vk-gh', `${r.height}px`)
  el.style.setProperty('--vk-go', '1')
  if (!el.classList.contains('is-glide-ready')) {
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('is-glide-ready')))
  }
}

export const vGlide = {
  mounted(el, binding) {
    el._glideSelector = typeof binding.value === 'string' ? binding.value : ''
    el.classList.add('vk-glide')
    place(el)
    if (typeof ResizeObserver !== 'undefined') {
      el._glideRo = new ResizeObserver(() => place(el))
      el._glideRo.observe(el)
    }
    document.fonts?.ready.then(() => place(el))
  },
  // A :class binding rewrites the group's classes on update: put ours back, then re-measure
  updated(el, binding) {
    el._glideSelector = typeof binding.value === 'string' ? binding.value : ''
    el.classList.add('vk-glide')
    if (el.classList.contains('is-glide-ready') === false && el.style.getPropertyValue('--vk-go') === '1') {
      el.classList.add('is-glide-ready')
    }
    nextTick(() => place(el))
  },
  beforeUnmount(el) {
    el._glideRo?.disconnect()
  },
}
