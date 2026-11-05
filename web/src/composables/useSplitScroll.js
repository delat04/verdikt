import { ref, watch, onBeforeUnmount } from 'vue'

/**
 * Scroll state for a split page (.vk-split: a fixed head, then .vk-split__col columns that scroll alone).
 *   const { root, scrolled, condensed, reveal } = useSplitScroll()
 *   <div ref="root" class="vk-split" :class="{ 'is-scrolled': scrolled, 'is-condensed': condensed }">
 * scrolled  — any column has moved: the head shows its hairline
 * condensed — the main (first) column is well into its content: the head can shrink to give it room.
 *             It only turns on when the column has room to spare, so shrinking the head can never
 *             make the column stop scrolling and flip it straight back.
 * Listens on the page root in the capture phase, so columns that re-render are still heard.
 */
export function useSplitScroll({ condenseAt = 56, room = 200 } = {}) {
  const root = ref(null)
  const scrolled = ref(false)
  const condensed = ref(false)

  const cols = () => (root.value ? [...root.value.querySelectorAll(':scope > .vk-split__cols > .vk-split__col')] : [])
  function update() {
    const list = cols()
    scrolled.value = list.some((c) => c.scrollTop > 2)
    const main = list[0]
    if (!main) return
    if (!condensed.value && main.scrollTop > condenseAt && main.scrollHeight - main.clientHeight > room) condensed.value = true
    else if (condensed.value && main.scrollTop < 8) condensed.value = false
  }

  let bound = null
  watch(root, (el) => {
    bound?.removeEventListener('scroll', update, true)
    bound = el
    el?.addEventListener('scroll', update, { capture: true, passive: true })
  }, { flush: 'post' })
  onBeforeUnmount(() => bound?.removeEventListener('scroll', update, true))

  // bring `el` to just under the head inside the main column (only if it's above the fold, unless forced)
  function reveal(el, { force = false, offset = 12 } = {}) {
    const main = cols()[0]
    if (!main || !el || main.scrollHeight <= main.clientHeight) return el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    const top = el.getBoundingClientRect().top - main.getBoundingClientRect().top + main.scrollTop - offset
    if (force || top < main.scrollTop || top > main.scrollTop + main.clientHeight - 80) main.scrollTo({ top: Math.max(0, top), behavior: 'smooth' })
  }

  return { root, scrolled, condensed, reveal }
}
