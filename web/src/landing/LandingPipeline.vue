<!--
  LandingPipeline — one job, from the brief to the payout, after the Aeon landing's pipeline.
  Pinned for six screens: the stage's words on the left with an index of all six, the product on
  the right (PipelineWindow), scrubbed by the scroll. On the way out the window grows to fill the
  screen with white, and the closing section follows on it. On narrow screens and under reduced motion nothing is pinned: each
  stage is stacked as ordinary content with the window at its end state.
-->
<script setup>
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import PipelineWindow from './PipelineWindow.vue'
import { PIPELINE } from './pipelineContent'
import { stageAt, range, easeInOut } from './landingMath'

gsap.registerPlugin(ScrollTrigger)

const el = ref(null)
const p = ref(0)
const reduced = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches
const narrow = ref(typeof window !== 'undefined' && window.innerWidth <= 900)
const still = computed(() => reduced || narrow.value)

const at = computed(() => stageAt(p.value, PIPELINE.length, 0.02, 0.9))
const curtain = computed(() => easeInOut(range(p.value, 0.92, 0.995)))

let ctx = null
function pin() {
  ctx?.revert()
  ctx = null
  if (still.value || !el.value) return
  ctx = gsap.context(() => {
    ScrollTrigger.create({
      trigger: el.value, start: 'top top', end: () => `+=${window.innerHeight * 6}`, pin: true,
      refreshPriority: -1,   // after the story above it is pinned, so the positions include its spacer
      onUpdate: (s) => { p.value = s.progress },
    })
  }, el.value)
}

let mq = null
const onMq = () => { narrow.value = mq.matches }
watch(still, async () => {
  ctx?.revert()
  ctx = null
  await nextTick()
  pin()
  ScrollTrigger.refresh()
})
onMounted(() => {
  mq = matchMedia('(max-width: 900px)')
  mq.addEventListener('change', onMq)
  pin()
})
onBeforeUnmount(() => {
  mq?.removeEventListener('change', onMq)
  ctx?.revert()
})
</script>

<template>
  <section id="pipeline" ref="el" class="pl" :class="{ 'pl--still': still }" aria-labelledby="pl-title">
    <!-- pinned: the words, the index, the window -->
    <div v-if="!still" class="pl__frame">
      <div class="pl__side">
        <h2 id="pl-title" class="pl__title">One job, from the brief to the payout.</h2>
        <div class="pl__stages">
          <article
            v-for="(s, i) in PIPELINE" :key="s.name" class="pl__stage"
            :class="{ 'is-on': i === at.index, 'is-past': i < at.index }" :aria-hidden="i !== at.index"
          >
            <h3 class="pl__stage-title">{{ s.title }}</h3>
            <p class="pl__stage-body">{{ s.body }}</p>
          </article>
        </div>
        <ol class="pl__index" aria-hidden="true">
          <li v-for="(s, i) in PIPELINE" :key="s.name" :class="{ 'is-on': i === at.index, 'is-done': i < at.index }">
            <span class="vk-num">{{ String(i + 1).padStart(2, '0') }}</span>
            <span>{{ s.name }}</span>
            <b><i :style="{ transform: `scaleX(${i < at.index ? 1 : i === at.index ? at.t : 0})` }" /></b>
          </li>
        </ol>
      </div>

      <div class="pl__window" :style="{ opacity: 1 - curtain * 1.5 }">
        <PipelineWindow :stage="at.index" :t="at.t" />
      </div>

      <!-- out: the window grows into the page below -->
      <div v-if="curtain > 0" class="pl__curtain" :style="{ '--e': curtain }" aria-hidden="true" />
    </div>

    <!-- still: the same stages as stacked content -->
    <div v-else class="pl__flow">
      <h2 id="pl-title" class="pl__title">One job, from the brief to the payout.</h2>
      <article v-for="(s, i) in PIPELINE" :key="s.name" class="pl__flow-stage">
        <div class="pl__flow-text">
          <p class="pl__flow-num"><span class="vk-num">{{ String(i + 1).padStart(2, '0') }}</span>{{ s.name }}</p>
          <h3 class="pl__stage-title">{{ s.title }}</h3>
          <p class="pl__stage-body">{{ s.body }}</p>
        </div>
        <div class="pl__flow-window"><PipelineWindow :stage="i" :t="1" :compact="narrow" /></div>
      </article>
    </div>
  </section>
</template>

<style scoped>
.pl { position: relative; z-index: 1; }
/* the window is centred at its own height; the exit grows from exactly that rectangle */
.pl__frame { --win-h: min(66vh, 560px); --win-y: calc((100vh - var(--win-h)) / 2); position: relative; height: 100vh; overflow: hidden; }

.pl__side {
  position: absolute; top: 15vh; bottom: 10vh; left: var(--gut); width: calc(33vw - var(--gut));
  display: grid; grid-template-rows: auto 1fr auto; gap: 3vh;
}
.pl__title { margin: 0; max-width: 14ch; font: 300 clamp(30px, 2.9vw, 46px)/1.02 var(--vk-font); letter-spacing: -.045em; }
.pl__stages { position: relative; display: grid; align-self: center; }
.pl__stage {
  grid-area: 1 / 1; display: grid; gap: 14px; align-content: start;
  opacity: 0; transform: translateY(18px); filter: blur(4px); pointer-events: none;
  transition: opacity .6s cubic-bezier(.16, 1, .3, 1), transform .8s cubic-bezier(.16, 1, .3, 1), filter .6s;
}
.pl__stage.is-past { transform: translateY(-18px); }
.pl__stage.is-on { opacity: 1; transform: none; filter: none; pointer-events: auto; transition-delay: 60ms; }
.pl__stage-title { margin: 0; font: 400 clamp(22px, 1.9vw, 30px)/1.12 var(--vk-font); letter-spacing: -.03em; }
.pl__stage-body { max-width: 34em; margin: 0; font: 400 clamp(15px, 1.05vw, 17px)/1.55 var(--vk-font); color: var(--vk-muted); }

.pl__index { margin: 0; padding: 0; list-style: none; }
.pl__index li { display: grid; grid-template-columns: 30px 1fr 64px; align-items: center; height: 28px; font: 400 14px/1 var(--vk-font); color: var(--vk-faint); transition: color .4s; }
.pl__index li .vk-num { font-size: 12px; }
.pl__index li.is-done { color: var(--vk-muted); }
.pl__index li.is-on { color: var(--vk-ink); }
.pl__index b { height: 2px; overflow: hidden; background: var(--vk-line); }
.pl__index i { display: block; height: 100%; background: var(--vk-accent); transform-origin: left; }

.pl__window { position: absolute; top: var(--win-y); right: var(--gut); left: 37vw; height: var(--win-h); }

.pl__curtain {
  position: absolute; inset: 0;
  background: var(--vk-surface);   /* the closing section's white */
  clip-path: inset(
    calc(var(--win-y) * (1 - var(--e))) calc(var(--gut) * (1 - var(--e))) calc(var(--win-y) * (1 - var(--e))) calc(37vw * (1 - var(--e)))
    round calc(18px * (1 - var(--e)))
  );
}

/* still */
.pl__flow { display: grid; gap: 12vh; max-width: 1320px; margin: 0 auto; padding: 14vh var(--gut) 16vh; }
.pl__flow .pl__title { max-width: 18ch; font-size: clamp(32px, 4vw, 52px); }
.pl__flow-stage { display: grid; grid-template-columns: minmax(0, .8fr) minmax(0, 1.2fr); gap: clamp(24px, 4vw, 64px); align-items: center; }
.pl__flow-text { display: grid; gap: 14px; min-width: 0; }
.pl__flow-num { display: flex; align-items: baseline; gap: 12px; margin: 0; font: var(--vk-type-dense); color: var(--vk-muted); }
.pl__flow-num .vk-num { font: 300 34px/1 var(--vk-mono); letter-spacing: -.04em; color: var(--vk-ink); }
.pl__flow-window { min-width: 0; }
@media (max-width: 900px) {
  .pl__flow { gap: 9vh; padding: 12vh var(--gut); }
  .pl__flow-stage { grid-template-columns: minmax(0, 1fr); gap: 20px; }
}
@media (prefers-reduced-motion: reduce) {
  .pl__stage { transition: none; filter: none; }
}
</style>
