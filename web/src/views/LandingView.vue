<!--
  Landing. The hero is the machine (HeroMachine, after the Aeon landing's): deliveries ride a belt into a glass
  press that checks and stamps each one, and they leave paid, or held. Then the deal itself: the Verdikt mark in 3D
  on a near-white grid of tiles, its white stroke the work and its lime stroke the money, arriving with the story.
  Scroll and the page pins while the mark goes through the four real stages: a line drawing while the checks are
  signed, the money lime glass while PayPal holds it, the work turning solid as a scan reads down it, and the
  money solid lime when it's paid, with green rings running out from it.
  Then the two sides, and the product end to end (LandingPipeline: one job from the brief to the payout, pinned for
  six screens), whose window grows into the closing section (LandingClose); the footer is the one dark band.
  Motion: Lenis smooths the scroll, GSAP ScrollTrigger drives the story, three.js draws the paper and the mark
  (src/landing/stage.js, loaded after first paint). Reduced motion keeps the story but drops smoothing,
  the intro, drifting and pointer tilt; without WebGL the flat mark stands in.
-->
<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount, defineAsyncComponent } from 'vue'
import { Play } from 'lucide-vue-next'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import Lenis from 'lenis'
import 'lenis/dist/lenis.css'
import BrandMark from '@/components/BrandMark.vue'
import VButton from '@/components/ui/VButton.vue'
import LandingNav from '@/landing/LandingNav.vue'
import LandingPipeline from '@/landing/LandingPipeline.vue'
import LandingClose from '@/landing/LandingClose.vue'
import HeroMachine from '@/landing/HeroMachine.vue'
import { soundOn } from '@/landing/machineSound'
import { useAuthStore } from '@/stores/auth'
import { isDemo, enterDemo } from '@/services'

gsap.registerPlugin(ScrollTrigger)

const auth = useAuthStore()
const canDemo = computed(() => !isDemo && !auth.user)
const appLink = computed(() => (auth.user ? '/contracts' : '/login'))
const startLink = computed(() => (auth.user ? '/contracts/new' : '/login'))

// one click from the story to a real recording: the 'v1' sample delivery as Kernel's cloud browser recorded it
// when the demo was built (replays.json), loaded only when asked for, with its two failures on camera
const ReplayPlayer = defineAsyncComponent(() => import('@/components/ReplayPlayer.vue'))
const watching = ref(false)
const sampleReplay = ref(null)
// the two failures on camera, timed from the recording's own chapters and marks (re-recording moves them)
const sampleMoments = ref([])
const at = (list, test, fallback) => list?.find(test)?.t ?? fallback
async function watchSample() {
  if (!sampleReplay.value) {
    const { default: samples } = await import('@/services/replays.json')
    const { facts, shots, delivered, ...replay } = samples['northbrew-shop-v1']
    sampleReplay.value = { ...replay, by: 'kernel', sample: true }
    sampleMoments.value = [
      { t: at(replay.chapters, (c) => c.kind === 'form', 0), label: 'Form test', statement: 'The newsletter form submits and the site accepts it', passed: false },
      { t: at(replay.marks, (m) => m.kind === 'measure' && m.view === 'mobile', 0), label: 'Phone · 375px', statement: 'Nothing on the page is wider than a 375px screen', passed: false },
    ]
  }
  watching.value = true
}
// the page behind holds still while the recording is open
watch(watching, (on) => (on ? lenis?.stop() : lenis?.start()))

const steps = [
  { label: 'Agreed', title: 'Agree what done means.', text: 'In a shared contract room, an AI mediator turns what you both want into checks it can test: the layout at 375px, the exact copy, the cart total. You sign them together.' },
  { label: 'Held', title: 'PayPal holds the money.', text: 'The client approves a PayPal authorization: a hold, not a charge. The freelancer sees the money is there before starting, and Verdikt renews the hold when PayPal’s 3-day honor period ends. A milestone can also hold an expense budget with a shopping list of real products from Channel3, and a receipt that names a listed item at its price is reimbursed by rules alone.' },
  { label: 'Checked', title: 'An agent checks the delivery.', text: 'Each signed check runs as a probe in a cloud browser on Kernel, recorded so both of you can watch it, and against the repo. Most are settled with no model call. Before Claude judges the rest from the evidence it collected, Elastic finds how the most similar checks on other contracts were decided.', watch: true },
  { label: 'Paid', title: 'Proven, so it’s paid.', text: 'When every check passes, PayPal captures the hold and the freelancer is paid, less a 2% fee. If one fails, the money stays held and both sides see exactly why.' },
]

const reduced = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches

const root = ref(null)
const canvas = ref(null)
const heroFigure = ref(null)
const heroCopy = ref(null)
const story = ref(null)
const storyAnchor = ref(null)
const storyText = ref(null)
const active = ref(0)
const progress = ref(0)
// the caption under the mark: the amount, and what it's doing at this step (the scan settles a check a quarter of the way down)
const tag = computed(() => {
  if (active.value === 0) return '4 checks signed, nothing held yet'
  if (active.value === 1) return 'held by PayPal, not charged'
  if (active.value === 3) return 'sent to Sam’s PayPal'
  const passed = Math.min(4, Math.floor(Math.min(1, Math.max(0, (progress.value - 0.5) / 0.22)) * 4))
  return `${passed} of 4 checks passed`
})
const navShown = ref(false)
const navOnDark = ref(false)
const menuOpen = ref(false)
const noGL = ref(false)

const st = { intro: reduced ? 1 : 0, blend: 0, story: 0, fade: 1 }
let lenis = null
let ctx = null
let stage = null
let alive = true
const lerp = (a, b, t) => a + (b - a) * t
const ease = (t) => t * t * (3 - 2 * t)

// the paper's light (and which text column stays calm) moves from the hero's machine to the story's mark
function between(a, b) {
  const t = ease(st.blend)
  const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect()
  return { left: lerp(ra.left, rb.left, t), top: lerp(ra.top, rb.top, t), width: lerp(ra.width, rb.width, t), height: lerp(ra.height, rb.height, t) }
}

function tick(time) {
  lenis?.raf(time * 1000)
  // the floating bar comes in once the hero, and its own bar, have mostly scrolled away
  navShown.value = window.scrollY > window.innerHeight * 0.75
  if (!stage || !heroFigure.value || !storyAnchor.value || st.fade <= 0) return
  // the mark lives in the story: it arrives with it, still a line drawing, as the section scrolls in
  stage.frame({
    rect: storyAnchor.value.getBoundingClientRect(),
    glow: between(heroFigure.value, storyAnchor.value),
    quiet: between(heroCopy.value, storyText.value),
    blend: st.blend, story: st.story, intro: reduced ? 1 : st.blend, paper: st.intro, time, scroll: window.scrollY,
  })
}

function go(hash) {
  const el = document.querySelector(hash)
  if (!el) return
  if (lenis) lenis.scrollTo(el, { duration: 1.6, force: true })
  else el.scrollIntoView()
}

// the menu sheet holds the page still while it's open. Sync, so a section picked in the sheet starts Lenis
// again before its glide begins (start() resets Lenis, which would cut a glide already under way)
watch(menuOpen, (v) => (v ? lenis?.stop() : lenis?.start()), { flush: 'sync' })

onMounted(async () => {
  document.documentElement.classList.add('is-landing')
  if (!reduced) {
    lenis = new Lenis({ duration: 1.15, easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)) })
    lenis.on('scroll', ScrollTrigger.update)
  }
  gsap.ticker.add(tick)
  gsap.ticker.lagSmoothing(0)

  ctx = gsap.context(() => {
    if (!reduced) {
      const intro = gsap.timeline({ delay: 0.1 })
      intro.from('.hero__title .ln > span', { yPercent: 112, duration: 1.4, ease: 'expo.out', stagger: 0.1 }, 0.2)
      intro.from('.hero__sub, .hero__cta, .hero__sound, .hero__cue', { autoAlpha: 0, y: 16, duration: 1.1, ease: 'power3.out', stagger: 0.09 }, 0.75)
      intro.from('.hero__figure', { autoAlpha: 0, y: 40, duration: 1.6, ease: 'expo.out' }, 0.45)
      intro.from('.top', { autoAlpha: 0, y: -10, duration: 1.2, ease: 'power3.out' }, 0.5)
    }

    // the story arrives: the mark with it, the paper's light moving from the machine to the mark
    ScrollTrigger.create({ trigger: story.value, start: 'top bottom', end: 'top top', onUpdate: (s) => { st.blend = s.progress } })
    // the story: pinned for three screens, four steps
    ScrollTrigger.create({
      trigger: story.value, start: 'top top', end: () => `+=${window.innerHeight * 3}`, pin: true, anticipatePin: 1,
      onUpdate: (s) => {
        st.story = s.progress
        progress.value = s.progress
        active.value = Math.min(3, Math.floor(s.progress * 4))
      },
    })
    // over the footer's dark band the floating bar turns dark with it (refreshed after the pipeline's pin above it)
    ScrollTrigger.create({ trigger: '.band', start: 'top 44px', end: 'bottom top', refreshPriority: -2, onToggle: (s) => { navOnDark.value = s.isActive } })
    // the stage fades as the two sides come up
    ScrollTrigger.create({
      trigger: '.sides', start: 'top bottom', end: 'top 30%',
      onUpdate: (s) => { st.fade = 1 - s.progress; if (canvas.value) canvas.value.style.opacity = String(st.fade) },
    })
  }, root.value)

  try {
    const { createStage } = await import('@/landing/stage')
    if (!alive) return
    stage = createStage(canvas.value, { reduced })
    await stage.ready
    if (!alive) return
    if (!reduced) gsap.to(st, { intro: 1, duration: 2.8, ease: 'power2.inOut' })
  } catch {
    noGL.value = true
  }
  document.fonts?.ready.then(() => alive && ScrollTrigger.refresh())
})

onBeforeUnmount(() => {
  alive = false
  gsap.ticker.remove(tick)
  gsap.killTweensOf(st)
  ctx?.revert()
  lenis?.destroy()
  stage?.dispose()
  document.documentElement.classList.remove('is-landing')
})
</script>

<template>
  <div ref="root" class="land" :class="{ 'no-gl': noGL }">
    <canvas ref="canvas" class="stage" aria-hidden="true" />

    <LandingNav v-model:open="menuOpen" :shown="navShown" :dark="navOnDark" @go="go" />

    <!-- the promise -->
    <section class="hero">
      <!-- the hero's own bar, after the Aeon landing's: it scrolls away with the hero, and the floating one takes over -->
      <header class="top">
        <RouterLink to="/" class="top__brand" aria-label="Verdikt home"><BrandMark :size="26" /><span>Verdikt</span></RouterLink>
        <nav class="top__nav" aria-label="Primary">
          <button v-if="canDemo" type="button" class="pill pill--solid" @click="enterDemo">Try the demo</button>
          <RouterLink v-else :to="appLink" class="pill pill--solid">Open the app</RouterLink>
          <RouterLink v-if="!auth.user" :to="appLink" class="pill">Sign in</RouterLink>
          <button type="button" class="pill" :aria-expanded="menuOpen" aria-controls="land-sheet" @click="menuOpen = true">
            Menu <span class="burger" aria-hidden="true" />
          </button>
        </nav>
      </header>
      <div class="wrap hero__grid">
        <div ref="heroCopy" class="hero__copy">
          <h1 class="hero__title">
            <span class="ln"><span>Get paid</span></span>
            <span class="ln"><span>when the work</span></span>
            <span class="ln"><span>is proven.</span></span>
          </h1>
          <p class="hero__sub">
            Verdikt turns a freelance contract into checks you both sign. PayPal holds the money, an agent tests the
            delivery against those checks, and the payment is released only when they pass.
          </p>
          <div class="hero__cta">
            <VButton v-if="canDemo" size="lg" @click="enterDemo">Try the demo, no sign-up</VButton>
            <VButton v-else :to="appLink" size="lg">Open the app</VButton>
            <VButton :to="startLink" variant="secondary" size="lg">Start a contract</VButton>
          </div>
          <button type="button" class="hero__sound" :aria-pressed="soundOn" @click="soundOn = !soundOn">Sound {{ soundOn ? 'on' : 'off' }}</button>
          <p class="vk-sr-only">
            In the picture, deliveries ride a belt into Verdikt: a live site, a code repo, design files, copy and a receipt.
            Each is checked against its signed checks and leaves paid, or held when a check fails.
          </p>
        </div>
        <div ref="heroFigure" class="hero__figure"><HeroMachine /></div>
      </div>
      <a href="#how" class="hero__cue" @click.prevent="go('#how')"><i aria-hidden="true" />See how a payment moves</a>
    </section>

    <!-- the story: pinned, the mark goes through the four stages -->
    <section id="how" ref="story" class="story" aria-label="How a payment moves">
      <div class="wrap story__grid">
        <div ref="storyText" class="story__text">
          <ol class="rail" :class="{ 'is-paid': active === 3 }" :style="{ '--p': progress }">
            <li v-for="(s, i) in steps" :key="s.label" :class="{ 'is-on': i === active, 'is-done': i < active }">{{ s.label }}</li>
          </ol>
          <div class="story__steps">
            <article v-for="(s, i) in steps" :key="s.title" class="step" :class="{ 'is-on': i === active, 'is-past': i < active }" :aria-hidden="i !== active">
              <h2 class="step__title">{{ s.title }}</h2>
              <p class="step__text">{{ s.text }}</p>
              <button v-if="s.watch" type="button" class="step__watch" :tabindex="i === active ? undefined : -1" @click="watchSample">
                <Play :size="14" :stroke-width="1.9" aria-hidden="true" /> Watch a recorded check
              </button>
            </article>
          </div>
        </div>
        <div ref="storyAnchor" class="anchor story__anchor">
          <BrandMark v-if="noGL" class="still" :size="160" />
          <!-- what the money is doing, under the mark -->
          <p class="tag" :class="{ 'is-paid': active === 3 }">
            <span class="tag__amt">{{ active === 3 ? '$1,764.00' : '$1,800.00' }}</span>
            <span class="tag__cap">{{ tag }}</span>
          </p>
        </div>
      </div>
    </section>

    <!-- the two sides -->
    <section id="sides" class="sides" aria-label="Hire or freelance">
      <div class="wrap sides__grid">
        <div class="side">
          <h3>If you hire</h3>
          <ul>
            <li>Pay only for work that passes the checks you signed.</li>
            <li>If it never passes, the hold is voided and you’re never charged.</li>
            <li>Release early whenever you’re happy.</li>
          </ul>
        </div>
        <div class="side">
          <h3>If you freelance</h3>
          <ul>
            <li>Know the money is held before you start.</li>
            <li>Get paid the moment the checks pass, with no invoices to chase.</li>
            <li>See the reason when something fails, and appeal if the agent is wrong.</li>
          </ul>
        </div>
      </div>
    </section>

    <!-- the product, end to end: pinned, its window grows into the page below -->
    <LandingPipeline />

    <!-- the last word: the two people, the product cut into a stepped shape, the product's words -->
    <LandingClose />

    <ReplayPlayer
      v-if="sampleReplay" :open="watching" :replay="sampleReplay" :moments="sampleMoments"
      sub="Sample delivery · northbrew-shop-v1 · recorded on Kernel, served by Verdikt for the demo" @close="watching = false"
    />

    <!-- the footer: the one dark band -->
    <div class="band is-dark">
      <footer class="foot">
        <div class="wrap foot__row">
          <span class="foot__brand"><BrandMark :size="22" /> Verdikt</span>
          <span>Built on PayPal Orders v2 and Payouts, Claude, Kernel, Elastic, Channel3, AG Grid and AG Studio, Bryntum and Supabase. PayPal sandbox only, so no real money moves.</span>
          <RouterLink to="/design">Design system</RouterLink>
        </div>
      </footer>
    </div>
  </div>
</template>

<style>
/* while the landing is up, the page behind it is the landing's paper (overscroll, scrollbar) */
html.is-landing, html.is-landing body { background: #f7f8fa; color-scheme: light; }
/* the dark places: a deep navy with steel-blue light, cobalt only as a thin accent. Global (under .land) so
   the nav's floating bar and menu sheet, in their own component, take it too. */
.land .is-dark {
  --vk-canvas: #070B16; --vk-surface: #0C1222; --vk-surface-2: #121A2E; --vk-raised: #1A2338;
  --vk-hover: rgba(255, 255, 255, .05); --vk-selected: rgba(255, 255, 255, .08);
  --vk-line-subtle: #161E30; --vk-line: #222B40; --vk-line-strong: #34405A;
  --vk-ink: #EEF1F7; --vk-ink-2: #D3D9E6; --vk-muted: #A6B1C5; --vk-faint: #7F8AA0; --vk-on-ink: #070B16;
  --vk-accent-text: #A9BCFF; --vk-accent-soft: rgba(49, 94, 251, .18); --vk-accent-line: rgba(140, 165, 255, .4);
  --vk-ok: #3BE37A; --vk-ok-ink: #5BEA8F; --vk-ok-soft: rgba(59, 227, 122, .12);
  --vk-focus: rgba(140, 165, 255, .32);
  color: var(--vk-ink); color-scheme: dark;
}
</style>

<style scoped>
/* the landing is light, whatever the device theme: the app's own light tokens. Colour lives in the mark,
   in one dark panel (the agent's session) and in the closing band, never washed across the page. */
.land {
  --vk-canvas: #F7F8FA; --vk-surface: #FFFFFF; --vk-surface-2: #F1F3F6; --vk-raised: #FFFFFF;
  --vk-hover: rgba(14, 15, 18, .04); --vk-selected: rgba(14, 15, 18, .07);
  --vk-line-subtle: #E5E7EB; --vk-line: #D9DCE2; --vk-line-strong: #BCC1CA;
  --vk-ink: #0E0F12; --vk-ink-2: #2B2E35; --vk-muted: #4B505B; --vk-faint: #656B79; --vk-on-ink: #FFFFFF;
  --vk-accent: #315EFB; --vk-accent-hover: #2448D8; --vk-accent-text: #2448D8;
  --vk-accent-soft: #EEF2FF; --vk-accent-line: #CBD7FF; --vk-on-accent: #FFFFFF;
  --vk-ok: #12B76A; --vk-ok-ink: #0B7A47; --vk-ok-soft: #E7F8EF;
  --vk-danger: #E5484D; --vk-danger-ink: #A3292D; --vk-danger-soft: #FDECEC;
  --vk-elev-pop: 0 16px 40px -16px rgba(14, 15, 18, .22), 0 2px 6px rgba(14, 15, 18, .04);
  --vk-focus: rgba(49, 94, 251, .18);
  --gut: clamp(20px, 5vw, 64px);
  position: relative; min-height: 100dvh; background: var(--vk-canvas); color: var(--vk-ink); overflow-x: clip;
  color-scheme: light;
}
.no-gl {
  background:
    radial-gradient(50% 45% at 72% 42%, rgba(49, 94, 251, .10), transparent 70%),
    linear-gradient(rgba(14, 15, 18, .05) 1px, transparent 1px) 0 0 / 68px 68px,
    linear-gradient(90deg, rgba(14, 15, 18, .05) 1px, transparent 1px) 0 0 / 68px 68px,
    var(--vk-canvas);
}
.stage { position: fixed; inset: 0; z-index: 0; width: 100%; height: 100%; display: block; pointer-events: none; }
.no-gl .stage { display: none; }
.wrap { position: relative; z-index: 1; max-width: 1320px; margin: 0 auto; padding: 0 var(--gut); }

/* ---- the hero's bar: the mark on the left, round pills on the right */
.top {
  position: absolute; top: 0; left: 0; right: 0; z-index: 2;
  display: flex; align-items: center; justify-content: space-between; gap: 16px;
  padding: clamp(16px, 2.4vw, 32px) var(--gut) 0;
}
.top__brand { display: inline-flex; align-items: center; gap: 10px; color: var(--vk-ink); font: 400 19px/1 var(--vk-font); letter-spacing: -.03em; text-decoration: none !important; }
.top__nav { display: flex; gap: 10px; }
.pill {
  display: inline-flex; align-items: center; gap: 10px; padding: 10px 16px;
  border: 1px solid var(--vk-ink); border-radius: 999px;
  /* a little frost, so the belt running up behind them doesn't show through the words */
  background: rgba(247, 248, 250, .6); -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px);
  color: var(--vk-ink); font: 400 14px/1 var(--vk-font); letter-spacing: .01em; text-decoration: none !important; cursor: pointer;
  transition: background-color .3s, color .3s, border-color .3s;
}
.pill:hover { background: var(--vk-ink); color: var(--vk-on-ink); }
.pill--solid { background: var(--vk-ink); color: var(--vk-on-ink); }
.pill--solid:hover { border-color: var(--vk-accent); background: var(--vk-accent); color: #fff; }
.burger { width: 12px; height: 6px; border-block: 1.5px solid currentColor; }

/* ---- hero */
.hero { position: relative; min-height: 100svh; display: flex; align-items: center; padding: 104px 0 96px; }
.hero__grid { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: 0 24px; align-items: center; width: 100%; }
.hero__copy { grid-column: 1 / span 5; position: relative; z-index: 1; }
.hero__title { margin: 0; font: 300 clamp(44px, 5.2vw, 84px)/.96 var(--vk-font); letter-spacing: -.052em; }
.ln { display: block; overflow: hidden; padding-bottom: .08em; margin-bottom: -.08em; }
.ln > span { display: block; }
.hero__sub { max-width: 44ch; margin: 30px 0 0; font: 400 18px/28px var(--vk-font); color: var(--vk-muted); }
.hero__cta { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 36px; }
.anchor { aspect-ratio: 1.6; width: 100%; }
.hero__sound { margin-top: 26px; padding: 0; border: 0; background: none; font: 400 11px/1 var(--vk-mono); letter-spacing: .04em; color: var(--vk-faint); cursor: pointer; }
.hero__sound:hover { color: var(--vk-ink); }
/* the machine: the belt runs on past the figure, off the right edge and up behind the nav */
.hero__figure { grid-column: 6 / span 7; width: min(calc(100% + 8vw), 1000px); margin-right: -8vw; justify-self: end; }
.hero__cue { position: absolute; left: var(--gut); bottom: 32px; z-index: 1; display: inline-flex; align-items: center; gap: 12px; font: 400 13px/1 var(--vk-font); color: var(--vk-faint); text-decoration: none; }
.hero__cue i { position: relative; width: 1px; height: 36px; overflow: hidden; background: var(--vk-line-strong); }
.hero__cue i::after { content: ''; position: absolute; left: 0; top: -40%; width: 1px; height: 40%; background: linear-gradient(transparent, var(--vk-accent-text)); animation: cue 2.4s cubic-bezier(.65, 0, .35, 1) infinite; }
.hero__cue:hover { color: var(--vk-ink); }
@keyframes cue { to { top: 100%; } }

/* ---- story */
.story { position: relative; height: 100vh; display: flex; align-items: center; }
.story__grid { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: 0 24px; align-items: center; width: 100%; }
.story__text { grid-column: 1 / span 5; }
.story__anchor { grid-column: 6 / span 7; }
.rail { position: relative; display: grid; grid-template-columns: repeat(4, 1fr); margin: 0 0 48px; padding: 0 0 14px; list-style: none; font: 400 13px/1 var(--vk-font); }
.rail::before, .rail::after { content: ''; position: absolute; left: 0; bottom: 0; height: 1px; }
.rail::before { right: 0; background: var(--vk-line-strong); }
.rail::after { width: calc(var(--p) * 100%); background: var(--vk-accent); transition: background .6s; }
.rail.is-paid::after { background: var(--vk-ok); }
.rail li { color: var(--vk-faint); transition: color .5s; }
.rail li.is-done { color: var(--vk-muted); }
.rail li.is-on { color: var(--vk-ink); }
.story__steps { display: grid; }
.step { grid-area: 1 / 1; opacity: 0; transform: translateY(22px); filter: blur(6px); transition: opacity .7s cubic-bezier(.16, 1, .3, 1), transform .9s cubic-bezier(.16, 1, .3, 1), filter .7s; pointer-events: none; }
.step.is-past { transform: translateY(-22px); }
.step.is-on { opacity: 1; transform: none; filter: none; pointer-events: auto; }
.step__title { margin: 0; font: 300 clamp(34px, 3.7vw, 56px)/1.02 var(--vk-font); letter-spacing: -.045em; }
.step__text { max-width: 42ch; margin: 22px 0 0; font: 400 17px/27px var(--vk-font); color: var(--vk-muted); }
.step__watch {
  display: inline-flex; align-items: center; gap: 8px; margin-top: 18px; padding: 0; border: 0; background: none; cursor: pointer;
  font: 400 15px/24px var(--vk-font); color: var(--vk-ink); text-decoration: underline; text-underline-offset: 4px;
}
.step__watch:hover { color: var(--vk-accent); }

/* ---- sections below the story */
.sides { position: relative; padding: clamp(96px, 14vh, 160px) 0; }

.sides__grid { display: grid; grid-template-columns: 1fr 1fr; border-top: 1px solid var(--vk-line); }
.side { padding: 40px 48px 0 0; }
.side + .side { padding-left: 48px; border-left: 1px solid var(--vk-line); }
.side h3 { margin: 0; font: 300 clamp(26px, 2.4vw, 34px)/1.1 var(--vk-font); letter-spacing: -.035em; }
.side ul { display: flex; flex-direction: column; gap: 12px; margin: 24px 0 0; padding: 0; list-style: none; font: 400 16px/25px var(--vk-font); color: var(--vk-muted); }

/* the footer: the one dark place on the page */
.band {
  position: relative; z-index: 1; overflow: hidden; background: var(--vk-canvas);
  background-image:
    linear-gradient(rgba(255, 255, 255, .035) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255, 255, 255, .035) 1px, transparent 1px);
  background-size: 68px 68px;
}
.foot { position: relative; z-index: 1; border-top: 1px solid var(--vk-line); background: rgba(7, 11, 22, .72); -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px); }
.foot__row { display: flex; align-items: center; gap: 16px 32px; flex-wrap: wrap; padding-top: 28px; padding-bottom: 40px; font: var(--vk-type-small); color: var(--vk-faint); }
.foot__brand { display: inline-flex; align-items: center; gap: 8px; color: var(--vk-ink); font: 400 15px/1 var(--vk-font); }
.foot__row a { margin-left: auto; color: var(--vk-muted); }

/* the caption under the mark */
.story__anchor { position: relative; }
.tag { position: absolute; left: 0; right: 0; bottom: 0; display: flex; justify-content: center; align-items: baseline; gap: 12px; margin: 0; white-space: nowrap; }
.tag__amt { font: 400 22px/1 var(--vk-mono); letter-spacing: -.02em; color: var(--vk-ink); }
.tag__cap { font: var(--vk-type-dense); color: var(--vk-muted); }
.tag.is-paid .tag__cap { color: var(--vk-ok-ink); }
/* without WebGL, the flat mark holds the place */
.still { position: absolute; left: 50%; top: 44%; width: auto; height: 62%; transform: translate(-50%, -50%); }

:focus-visible { outline: 2px solid var(--vk-accent-text); outline-offset: 3px; }

@media (max-width: 900px) {
  .hero { min-height: 0; padding: 120px 0 72px; }
  .hero__cue { display: none; }
  .hero__grid, .story__grid { grid-template-columns: 1fr; }
  .hero__copy, .hero__figure, .story__text, .story__anchor { grid-column: 1 / -1; }
  /* stacked under the text, the belt fades out at both ends instead of running up over it */
  .hero__figure { width: auto; margin: 40px calc(-1 * var(--gut)) 0; -webkit-mask-image: linear-gradient(118deg, transparent 4%, #000 22% 78%, transparent 96%); mask-image: linear-gradient(118deg, transparent 4%, #000 22% 78%, transparent 96%); }
  .story { height: 100svh; }
  .story__grid { align-content: center; gap: 28px; }
  .story__anchor { order: -1; width: 92%; margin: 0 auto; aspect-ratio: 1.3; }
  .rail { margin-bottom: 26px; }
  .step__text { font-size: 16px; line-height: 25px; }
  .sides__grid { grid-template-columns: 1fr; }
  .side, .side + .side { padding: 32px 0 0; border-left: 0; }
  .side + .side { margin-top: 32px; border-top: 1px solid var(--vk-line); }
}
@media (max-width: 560px) {
  /* the hero's own button sits right under it */
  .pill--solid { display: none; }
  .foot__row a { margin-left: 0; }
}
@media (prefers-reduced-motion: reduce) {
  .hero__cue i::after { animation: none; }
  .step { transition: none; filter: none; }
}
</style>
