<!--
  LandingNav — after the Aeon landing's. The hero carries its own bar (in LandingView); once the hero has
  scrolled away this floating bar slides in: the page's sections on the left, the mark in the middle, the way in
  on the right. It is frosted glass in the tone of what's under it: paper over the page, navy over the footer.
  "Menu" (here, or in the hero) opens a full-screen navy sheet with the sections in reading order. Esc and Close
  shut it; focus stays inside while it's open and goes back where it was.
-->
<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { ArrowRight, X } from 'lucide-vue-next'
import BrandMark from '@/components/BrandMark.vue'
import { useAuthStore } from '@/stores/auth'
import { isDemo, enterDemo } from '@/services'

const props = defineProps({
  shown: { type: Boolean, default: false },
  dark: { type: Boolean, default: false },
})
const emit = defineEmits(['go'])
const open = defineModel('open', { type: Boolean, default: false })

const LINKS = [
  { hash: '#how', label: 'How it works' },
  { hash: '#sides', label: 'Hire or freelance' },
  { hash: '#pipeline', label: 'The product' },
  { hash: '#start', label: 'Try it' },
]

const auth = useAuthStore()
const canDemo = computed(() => !isDemo && !auth.user)
const appLink = computed(() => (auth.user ? '/contracts' : '/login'))

const sheet = ref(null)
const closeBtn = ref(null)
let returnFocus = null

watch(open, async (v) => {
  document.documentElement.style.overflow = v ? 'hidden' : ''
  if (v) {
    returnFocus = document.activeElement
    await nextTick()
    closeBtn.value?.focus()
  } else if (returnFocus?.isConnected) {
    returnFocus.focus({ preventScroll: true })
    returnFocus = null
  }
})
// leaving the page from inside the sheet (the demo, Sign in) must not leave the next page locked
onBeforeUnmount(() => {
  if (open.value) document.documentElement.style.overflow = ''
})

function go(hash) {
  returnFocus = null
  open.value = false
  emit('go', hash)
}

function onSheetKey(e) {
  if (e.key === 'Escape') {
    e.preventDefault()
    open.value = false
    return
  }
  if (e.key !== 'Tab' || !sheet.value) return
  const items = [...sheet.value.querySelectorAll('a[href], button:not([disabled])')]
  if (!items.length) return
  const first = items[0]
  const last = items[items.length - 1]
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
}
</script>

<template>
  <nav class="bar" :class="{ 'is-shown': props.shown && !open, 'is-dark': props.dark }" aria-label="Sections">
    <ul class="bar__links">
      <li v-for="l in LINKS.slice(0, 3)" :key="l.hash"><a :href="l.hash" @click.prevent="emit('go', l.hash)">{{ l.label }}</a></li>
    </ul>

    <RouterLink to="/" class="bar__brand" aria-label="Verdikt home"><BrandMark :size="24" /><span>Verdikt</span></RouterLink>

    <div class="bar__end">
      <RouterLink v-if="!auth.user" :to="appLink" class="bar__plain">Sign in</RouterLink>
      <button v-if="canDemo" type="button" class="bar__pill" @click="enterDemo">Try the demo</button>
      <RouterLink v-else :to="appLink" class="bar__pill">Open the app</RouterLink>
      <button class="bar__menu" type="button" :aria-expanded="open" aria-controls="land-sheet" @click="open = true">
        Menu <span class="burger" aria-hidden="true" />
      </button>
    </div>
  </nav>

  <Transition name="sheet">
    <div
      v-if="open" id="land-sheet" ref="sheet" class="sheet is-dark"
      role="dialog" aria-modal="true" aria-label="Menu" @keydown="onSheetKey"
    >
      <div class="sheet__grid" aria-hidden="true"><span v-for="n in 6" :key="n" /></div>
      <header class="sheet__top">
        <span class="sheet__brand" aria-hidden="true"><BrandMark :size="28" /> Verdikt</span>
        <button ref="closeBtn" class="sheet__close" type="button" @click="open = false">
          Close <X :size="15" :stroke-width="1.8" aria-hidden="true" />
        </button>
      </header>

      <ol class="sheet__links">
        <li v-for="(l, i) in LINKS" :key="l.hash" :style="{ '--i': i }">
          <a :href="l.hash" @click.prevent="go(l.hash)">
            <span class="sheet__num vk-num">{{ String(i + 1).padStart(2, '0') }}</span>
            <span class="sheet__label">{{ l.label }}</span>
            <ArrowRight class="sheet__arrow" :size="40" :stroke-width="1.2" aria-hidden="true" />
          </a>
        </li>
      </ol>

      <footer class="sheet__foot">
        <button v-if="canDemo" type="button" class="cta cta--solid" @click="enterDemo">Try the demo</button>
        <RouterLink v-else :to="appLink" class="cta cta--solid">Open the app</RouterLink>
        <RouterLink v-if="!auth.user" :to="appLink" class="cta cta--line">Sign in</RouterLink>
        <span class="sheet__note">PayPal sandbox only, so no real money moves.</span>
        <RouterLink to="/design" class="sheet__link"><span>Design system</span><ArrowRight :size="16" :stroke-width="1.6" aria-hidden="true" /></RouterLink>
      </footer>
    </div>
  </Transition>
</template>

<style scoped>
/* ---- the floating bar */
.bar {
  --bar-bg: rgba(247, 248, 250, .72);
  position: fixed; top: 16px; left: 50%; z-index: 30;
  display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: clamp(24px, 4vw, 72px);
  width: calc(100% - 32px); padding: 8px 8px 8px 26px;
  border: 1px solid var(--vk-line); border-radius: 12px;
  /* frosted glass: what scrolls under it shows through, blurred, in the bar's tone */
  background: linear-gradient(180deg, rgba(255, 255, 255, .5), transparent 60%), var(--bar-bg);
  -webkit-backdrop-filter: blur(18px) saturate(1.5); backdrop-filter: blur(18px) saturate(1.5);
  box-shadow: 0 12px 32px -22px rgba(14, 20, 40, .35);
  color: var(--vk-ink);
  transform: translate(-50%, calc(-100% - 24px)); opacity: 0; pointer-events: none;
  transition: transform .6s cubic-bezier(.16, 1, .3, 1), opacity .4s ease, background-color .4s ease, color .4s ease, border-color .4s ease;
}
@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .bar { --bar-bg: var(--vk-canvas); }
}
.bar.is-shown { transform: translate(-50%, 0); opacity: 1; pointer-events: auto; }
/* over the footer's navy band the glass is navy */
.bar.is-dark { --bar-bg: rgba(12, 18, 34, .72); background: linear-gradient(180deg, rgba(255, 255, 255, .06), transparent 60%), var(--bar-bg); }

.bar a, .bar button { color: inherit; text-decoration: none; }
.bar__links { display: flex; gap: 26px; margin: 0; padding: 0; list-style: none; }
.bar__links a, .bar__plain { font: 400 14px/1 var(--vk-font); color: var(--vk-muted); transition: color .25s; }
.bar__links a:hover, .bar__plain:hover { color: var(--vk-ink); }
.bar__brand { display: inline-flex; align-items: center; gap: 9px; font: 400 17px/1 var(--vk-font); letter-spacing: -.03em; }
.bar__end { display: flex; align-items: center; justify-content: flex-end; gap: 22px; }
.bar .bar__pill {
  padding: 11px 18px; border: 0; border-radius: 8px; background: var(--vk-ink); color: var(--vk-on-ink);
  font: 400 14px/1 var(--vk-font); cursor: pointer; transition: background-color .3s, color .3s;
}
.bar .bar__pill:hover { background: var(--vk-accent); color: #fff; }
.bar__menu {
  display: none; align-items: center; gap: 10px; padding: 10px 16px;
  border: 1px solid var(--vk-line-strong); border-radius: 8px; background: transparent;
  font: 400 14px/1 var(--vk-font); cursor: pointer; transition: border-color .25s;
}
.bar__menu:hover { border-color: var(--vk-ink); }
.burger { width: 12px; height: 6px; border-block: 1.5px solid currentColor; }

@media (max-width: 1080px) {
  .bar__links, .bar__plain { display: none; }
  .bar { grid-template-columns: auto 1fr; padding-left: 20px; }
  .bar__brand { order: -1; }
  .bar__menu { display: inline-flex; }
}
@media (max-width: 520px) {
  .bar .bar__pill { display: none; }
}

/* ---- the full-screen sheet: the page's navy, its sections in reading order */
.sheet {
  position: fixed; inset: 0; z-index: 50; display: grid; grid-template-rows: auto 1fr auto;
  padding: clamp(18px, 3.5vw, 48px) var(--gut); overflow-y: auto;
  background:
    radial-gradient(60% 50% at 85% 0%, rgba(49, 94, 251, .14), transparent 70%),
    var(--vk-canvas);
  color: var(--vk-ink);
}
.sheet__grid { position: absolute; inset: 0 1.5vw; display: grid; grid-template-columns: repeat(6, 1fr); pointer-events: none; }
.sheet__grid span { border-left: 1px solid rgba(255, 255, 255, .05); }
.sheet__top { position: relative; display: flex; align-items: center; justify-content: space-between; }
.sheet__brand { display: inline-flex; align-items: center; gap: 10px; font: 400 20px/1 var(--vk-font); letter-spacing: -.03em; }
.sheet__close {
  display: inline-flex; align-items: center; gap: 10px; padding: 10px 16px;
  border: 1px solid var(--vk-line-strong); border-radius: 999px; background: transparent; color: var(--vk-ink);
  font: 400 14px/1 var(--vk-font); cursor: pointer; transition: background-color .3s, color .3s, border-color .3s;
}
.sheet__close:hover { border-color: var(--vk-ink); background: var(--vk-ink); color: var(--vk-on-ink); }

.sheet__links { position: relative; align-self: center; margin: 6vh 0; padding: 0; list-style: none; }
.sheet__links li { border-top: 1px solid var(--vk-line); transition: opacity .5s ease, transform .6s cubic-bezier(.16, 1, .3, 1); transition-delay: calc(var(--i) * 45ms + 80ms); }
.sheet__links li:last-child { border-bottom: 1px solid var(--vk-line); }
.sheet__links a { display: grid; grid-template-columns: 64px 1fr auto; align-items: center; padding: clamp(12px, 2vh, 22px) 0; color: var(--vk-ink); text-decoration: none; }
.sheet__num { align-self: baseline; padding-top: .9em; font: 400 12px/1 var(--vk-mono); color: var(--vk-faint); }
.sheet__label { font: 300 clamp(40px, 7.4vh, 88px)/1 var(--vk-font); letter-spacing: -.045em; transition: color .3s, transform .5s cubic-bezier(.16, 1, .3, 1); }
.sheet__arrow { color: var(--vk-accent-text); opacity: 0; transform: translateX(-12px); transition: opacity .3s, transform .5s cubic-bezier(.16, 1, .3, 1); }
.sheet__links a:hover .sheet__label, .sheet__links a:focus-visible .sheet__label { color: var(--vk-accent-text); transform: translateX(10px); }
.sheet__links a:hover .sheet__arrow, .sheet__links a:focus-visible .sheet__arrow { opacity: 1; transform: none; }

.sheet__foot { position: relative; display: flex; flex-wrap: wrap; align-items: center; gap: 14px 22px; }
.cta {
  display: inline-flex; align-items: center; justify-content: center; min-height: 48px; padding: 0 22px;
  border: 1px solid var(--vk-ink); border-radius: 999px; font: 400 15px/1 var(--vk-font); text-decoration: none; white-space: nowrap; cursor: pointer;
  transition: background-color .3s, color .3s, border-color .3s;
}
.cta--solid { background: var(--vk-ink); color: var(--vk-on-ink); }
.cta--solid:hover { border-color: var(--vk-accent); background: var(--vk-accent); color: #fff; }
.cta--line { background: transparent; color: var(--vk-ink); }
.cta--line:hover { background: var(--vk-ink); color: var(--vk-on-ink); }
.sheet__note { font: var(--vk-type-small); color: var(--vk-faint); }
.sheet__link {
  display: inline-flex; align-items: center; gap: 8px; margin-left: auto; padding-bottom: 6px;
  border-bottom: 1px solid var(--vk-line-strong); color: var(--vk-ink); font: 400 15px/1.3 var(--vk-font); text-decoration: none;
  transition: border-color .3s;
}
.sheet__link:hover { border-color: var(--vk-ink); }
.sheet__link svg { transition: transform .3s cubic-bezier(.16, 1, .3, 1); }
.sheet__link:hover svg { transform: translateX(4px); }

/* open and close: the sheet wipes down, its sections rise in after it */
.sheet-enter-active, .sheet-leave-active { transition: clip-path .6s cubic-bezier(.16, 1, .3, 1), opacity .4s ease; }
.sheet-enter-from, .sheet-leave-to { clip-path: inset(0 0 100% 0); }
.sheet-enter-from .sheet__links li { opacity: 0; transform: translateY(24px); }
.sheet-leave-to { opacity: 0; }

:focus-visible { outline: 2px solid var(--vk-accent-text); outline-offset: 3px; }

@media (max-width: 640px) {
  .sheet__links { margin: 4vh 0; }
  .sheet__links a { grid-template-columns: 40px 1fr auto; }
  .sheet__num { padding-top: .5em; }
  .sheet__label { font-size: clamp(30px, 9.5vw, 48px); }
  .sheet__arrow { width: 28px; height: 28px; }
  .sheet__note { order: 3; width: 100%; }
  .sheet__link { margin-left: 0; }
}
@media (prefers-reduced-motion: reduce) {
  .bar, .sheet__links li, .sheet__label, .sheet__arrow { transition: none; }
  .sheet-enter-active, .sheet-leave-active { transition: none; }
}
</style>
