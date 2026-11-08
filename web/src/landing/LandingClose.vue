<!--
  LandingClose — the last word, after the Klavi landing's hero: the two people you can play on the left with the
  closing line and the way in; on the right a café owner like Maya (photo from Unsplash, free under the Unsplash
  License: unsplash.com/photos/QGg-vsPYbu8) cut into a stepped shape with rounded corners, inside and out, and
  three white cards sitting in its notches. Each card is a
  true thing about Verdikt, not a traction number. A band of the product's words runs underneath.
-->
<script setup>
import { computed } from 'vue'
import { Lock, Percent, Plug, ArrowDownRight, Bot } from 'lucide-vue-next'
import VButton from '@/components/ui/VButton.vue'
import VAvatar from '@/components/ui/VAvatar.vue'
import { useAuthStore } from '@/stores/auth'
import { isDemo, enterDemo } from '@/services'

const auth = useAuthStore()
const canDemo = computed(() => !isDemo && !auth.user)
const appLink = computed(() => (auth.user ? '/contracts' : '/login'))
const startLink = computed(() => (auth.user ? '/contracts/new' : '/login'))

const STATS = [
  { key: 'hold', n: '$0', text: 'charged for work until it passes', icon: Lock, img: '/landing/thumb-hold.webp' },
  { key: 'fee', n: '2%', text: 'fee, taken only from a payout', icon: Percent, img: '/landing/thumb-paid.webp' },
  { key: 'agent', n: '28', text: 'tools for your AI agent, over MCP', icon: Plug, img: '/landing/thumb-agent.webp' },
]
const WORDS = ['Contract room', 'Signed checks', 'PayPal hold', 'Probes', 'Verdict', 'Payout', 'Spending limits', 'Expense receipts', 'Appeals', 'MCP agents']

/* the stepped outline, in 0–1 of its box (which is 5:4): a notch top right, over the screenshot's empty corner,
   and one bottom left, where two of the cards sit; the third rides the right edge. Every corner, convex or
   concave, is rounded the same, so the shape reads as one piece. */
const OUTLINE = [[0, 0], [0.6, 0], [0.6, 0.21], [1, 0.21], [1, 1], [0.22, 1], [0.22, 0.8], [0, 0.8]]
function rounded(points, rx, ry) {
  const n = points.length
  const step = (p, q) => (p[0] === q[0]
    ? [p[0], p[1] + Math.sign(q[1] - p[1]) * ry]
    : [p[0] + Math.sign(q[0] - p[0]) * rx, p[1]])
  return points.map((p, i) => {
    const a = step(p, points[(i - 1 + n) % n])
    const b = step(p, points[(i + 1) % n])
    return `${i ? 'L' : 'M'}${a[0].toFixed(4)},${a[1].toFixed(4)} Q${p[0]},${p[1]} ${b[0].toFixed(4)},${b[1].toFixed(4)}`
  }).join(' ') + ' Z'
}
const SHAPE = rounded(OUTLINE, 0.04, 0.05)
</script>

<template>
  <section id="start" class="cl" aria-labelledby="cl-title">
    <div class="wrap cl__grid">
      <div class="cl__copy">
        <div class="cl__who">
          <span class="cl__faces" aria-hidden="true">
            <VAvatar name="Maya Chen" size="lg" />
            <VAvatar name="Sam Okafor" size="lg" />
            <span class="cl__bot"><Bot :size="18" :stroke-width="1.9" /></span>
          </span>
          <p><b>Maya hires, Sam delivers.</b> Play either side in the demo, or let an agent play it.</p>
        </div>
        <h2 id="cl-title" class="cl__title">Money moves on evidence.</h2>
        <p class="cl__sub">Try the whole flow with two sample people and PayPal’s sandbox. Nothing to sign up for, and no real money moves.</p>
        <div class="cl__cta">
          <VButton v-if="canDemo" size="lg" @click="enterDemo">Try the demo</VButton>
          <VButton v-else :to="appLink" size="lg">Open the app</VButton>
          <RouterLink :to="startLink" class="cl__round" aria-label="Start a contract" title="Start a contract"><ArrowDownRight :size="20" :stroke-width="1.6" /></RouterLink>
        </div>
      </div>

      <div class="cl__art">
        <svg class="cl__defs" width="0" height="0" aria-hidden="true">
          <clipPath id="cl-shape" clipPathUnits="objectBoundingBox"><path :d="SHAPE" /></clipPath>
        </svg>
        <div class="cl__frame"><div class="cl__shape">
          <img src="/landing/persona.webp" alt="A café owner smiling, arms folded, in her coffee shop." width="1400" height="1120" loading="lazy" decoding="async" />
        </div></div>
        <article v-for="s in STATS" :key="s.key" class="cl-stat" :class="`cl-stat--${s.key}`">
          <span class="cl-stat__thumb" aria-hidden="true">
            <img :src="s.img" alt="" width="192" height="192" loading="lazy" decoding="async" />
            <i class="cl-stat__chip"><component :is="s.icon" :size="13" :stroke-width="2.2" /></i>
          </span>
          <p class="cl-stat__text"><b class="vk-num">{{ s.n }}</b><span>{{ s.text }}</span></p>
        </article>
      </div>
    </div>

    <div class="cl__marquee" aria-hidden="true">
      <div class="cl__track">
        <template v-for="copy in 2" :key="copy">
          <span v-for="w in WORDS" :key="`${copy}-${w}`" class="cl__word">{{ w }}<i>/</i></span>
        </template>
      </div>
    </div>
  </section>
</template>

<style scoped>
/* white, like the reference, so the app's grey screenshot reads as its own shape */
.cl { position: relative; z-index: 1; overflow: hidden; padding: clamp(110px, 16vh, 170px) 0 clamp(56px, 8vh, 90px); background: var(--vk-surface); }
.wrap { position: relative; z-index: 1; max-width: 1320px; margin: 0 auto; padding: 0 var(--gut); }
.cl__grid { display: grid; grid-template-columns: minmax(0, .82fr) minmax(0, 1.18fr); gap: clamp(32px, 5vw, 80px); align-items: center; }

.cl__who { display: flex; align-items: center; gap: 14px; }
.cl__faces { display: flex; flex: none; }
.cl__faces > * { box-shadow: 0 0 0 3px var(--vk-surface); }
.cl__faces > * + * { margin-left: -8px; }
.cl__bot { display: grid; place-items: center; width: 44px; height: 44px; border-radius: 50%; background: var(--vk-accent); color: #fff; }
.cl__who p { max-width: 28ch; margin: 0; font: var(--vk-type-dense); color: var(--vk-muted); }
.cl__who b { font-weight: 400; color: var(--vk-accent-text); }
.cl__title { max-width: 10ch; margin: 30px 0 0; font: 300 clamp(46px, 5.6vw, 88px)/.96 var(--vk-font); letter-spacing: -.052em; }
.cl__sub { max-width: 40ch; margin: 26px 0 0; font: 400 17px/27px var(--vk-font); color: var(--vk-muted); }
.cl__cta { display: flex; align-items: center; gap: 12px; margin-top: 34px; }
.cl__round {
  display: grid; place-items: center; width: 56px; height: 56px; border-radius: 50%;
  border: 1px solid var(--vk-line-strong); color: var(--vk-ink); text-decoration: none;
  transition: border-color .25s, background .25s, transform .4s cubic-bezier(.16, 1, .3, 1);
}
.cl__round:hover { border-color: var(--vk-ink); background: var(--vk-surface); transform: rotate(-45deg); }

/* the art: a 5:4 box, the screenshot cut to the stepped shape, the cards in its notches */
.cl__art { position: relative; aspect-ratio: 5 / 4; }
.cl__defs { position: absolute; }
.cl__frame { position: absolute; inset: 0; filter: drop-shadow(0 0 1px rgba(14, 15, 18, .28)) drop-shadow(0 30px 40px rgba(14, 20, 40, .12)); }   /* the shadow follows the cut */
.cl__shape { position: absolute; inset: 0; clip-path: url(#cl-shape); background: var(--vk-canvas); }
.cl__shape img { display: block; width: 100%; height: 100%; object-fit: cover; }

.cl-stat {
  position: absolute; display: flex; align-items: center; gap: 14px; width: max-content; max-width: 300px;
  padding: 10px 20px 10px 10px; border: 1px solid var(--vk-line); border-radius: 22px; background: var(--vk-surface);
  /* the page-coloured ring makes each card read as cut out of the picture */
  box-shadow: 0 0 0 9px var(--vk-surface), 0 22px 40px -24px rgba(14, 20, 40, .28);
}
.cl-stat--hold { right: 0; top: 1%; }
.cl-stat--fee { right: -4%; top: 47%; }
.cl-stat--agent { left: -3%; bottom: 2%; }
.cl-stat__thumb { position: relative; flex: none; width: 66px; height: 66px; }
.cl-stat__thumb img { display: block; width: 100%; height: 100%; border-radius: 15px; object-fit: cover; }
.cl-stat__chip {
  position: absolute; right: -6px; bottom: -6px; display: grid; place-items: center; width: 26px; height: 26px;
  border-radius: 9px; background: var(--vk-accent); color: #fff; box-shadow: 0 0 0 3px var(--vk-surface);
}
.cl-stat__text { display: grid; gap: 3px; margin: 0; }
.cl-stat__text b { font: 400 28px/1 var(--vk-mono); letter-spacing: -.03em; color: var(--vk-ink); }
.cl-stat__text span { max-width: 16ch; font: var(--vk-type-small); color: var(--vk-muted); }

/* the product's words, running underneath */
.cl__marquee { margin-top: clamp(64px, 10vh, 110px); overflow: hidden; -webkit-mask-image: linear-gradient(90deg, transparent, #000 8% 92%, transparent); mask-image: linear-gradient(90deg, transparent, #000 8% 92%, transparent); }
.cl__track { display: flex; width: max-content; animation: cl-run 60s linear infinite; }
.cl__word { flex: none; padding-right: .6em; font: 400 clamp(20px, 2.3vw, 32px)/1.2 var(--vk-font); letter-spacing: .16em; text-transform: uppercase; color: var(--vk-ink-2); white-space: nowrap; }
.cl__word i { padding-left: .6em; font-style: normal; color: var(--vk-line-strong); }
@keyframes cl-run { to { transform: translateX(-50%); } }

@media (max-width: 900px) {
  .cl__grid { grid-template-columns: minmax(0, 1fr); }
  /* narrow: the photo stands on its own, the three cards stack under it */
  .cl__art { aspect-ratio: auto; display: grid; gap: 10px; margin-top: 24px; }
  .cl__frame { position: relative; aspect-ratio: 5 / 4; margin-bottom: 8px; }
  .cl-stat { position: static; width: auto; max-width: none; gap: 12px; padding: 8px 16px 8px 8px; border-radius: 18px; box-shadow: none; }
  .cl-stat__thumb { width: 52px; height: 52px; }
  .cl-stat__thumb img { border-radius: 12px; }
  .cl-stat__chip { width: 22px; height: 22px; border-radius: 8px; }
  .cl-stat__text b { font-size: 22px; }
  .cl-stat__text span { max-width: none; }
}
@media (prefers-reduced-motion: reduce) {
  .cl__track { animation: none; }
  .cl__round { transition: none; }
}
</style>
