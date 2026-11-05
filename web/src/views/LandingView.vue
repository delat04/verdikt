<!-- Landing — the pitch in one scroll: the promise, the proof (a real verdict), how it works, who it's for. -->
<script setup>
import { computed } from 'vue'
import { ArrowRight, PenLine, Wallet, ScanSearch, Banknote, Check, X, Briefcase, Code2 } from 'lucide-vue-next'
import BrandMark from '@/components/BrandMark.vue'
import VButton from '@/components/ui/VButton.vue'
import VPill from '@/components/ui/VPill.vue'
import EscrowCard from '@/components/EscrowCard.vue'
import ScoreRing from '@/components/ScoreRing.vue'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const appLink = computed(() => (auth.user ? '/contracts' : '/login'))

const checks = [
  { ok: true, text: 'Live URL serves the shop on desktop and mobile' },
  { ok: true, text: 'A product can be added to the cart; total updates' },
  { ok: false, text: 'No horizontal scrolling at 375px wide', why: 'Pricing card is 412px wide on a 375px screen.' },
  { ok: true, text: 'LCP under 2.5 s on a mid-range phone' },
]

const steps = [
  { icon: PenLine, title: 'Agree on checkable terms', text: 'Describe the work in plain words. The agent turns it into acceptance criteria it can test. Both sides edit and sign.' },
  { icon: Wallet, title: 'PayPal holds the money', text: 'The client funds each milestone with a PayPal authorization — a hold, not a charge.' },
  { icon: ScanSearch, title: 'The agent checks the delivery', text: 'It opens the live site at desktop and mobile sizes, runs each check, reads the repo, and keeps the evidence.' },
  { icon: Banknote, title: 'Proven → released', text: 'Every check passes: PayPal captures and the freelancer is paid. Not yet: it stays held, and both sides see why.' },
]
</script>

<template>
  <div class="land">
    <header class="nav">
      <RouterLink to="/" class="nav__brand"><BrandMark :size="28" /> Verdikt</RouterLink>
      <nav class="nav__links">
        <a href="#how">How it works</a>
        <RouterLink to="/design">Design system</RouterLink>
      </nav>
      <VButton :to="appLink" variant="ink" size="sm" :icon-right="ArrowRight">{{ auth.user ? 'Open the app' : 'Sign in' }}</VButton>
    </header>

    <!-- hero -->
    <section class="hero">
      <svg class="hero__lines" viewBox="0 0 1000 600" preserveAspectRatio="none" aria-hidden="true">
        <path d="M0 600 A620 620 0 0 1 620 -20" /><line x1="0" y1="1" x2="1000" y2="1" /><line x1="520" y1="0" x2="520" y2="600" />
      </svg>
      <div class="hero__copy">
        <VPill tone="accent">AI-verified escrow · PayPal</VPill>
        <h1 class="hero__title">Get paid when the work is <em>proven.</em></h1>
        <p class="hero__sub">Freelancers get stiffed. Clients pay for work that isn't done. Verdikt turns a contract into checks both sides sign, holds the money with PayPal, and lets an agent test the delivery — releasing payment only when it passes, with the evidence for every decision.</p>
        <div class="hero__cta">
          <VButton :to="auth.user ? '/contracts/new' : '/login'" size="lg" :icon-right="ArrowRight">Start a contract</VButton>
          <a href="#how" class="vk-btn vk-btn--secondary vk-btn--lg">How it works</a>
        </div>
      </div>

      <div class="hero__proof" aria-label="Example verdict">
        <div class="verdict">
          <div class="verdict__head">
            <ScoreRing :value="75" :pass="false" label="3/4" :size="64" />
            <div>
              <p class="vk-eyebrow">M2 · Online shop</p>
              <p class="verdict__title">Not yet — 1 check failed</p>
              <VPill tone="danger" size="sm">$1,800 stays held</VPill>
            </div>
          </div>
          <ul class="verdict__rows">
            <li v-for="c in checks" :key="c.text" :class="c.ok ? 'ok' : 'no'">
              <span class="ic"><Check v-if="c.ok" :size="12" :stroke-width="2.6" /><X v-else :size="12" :stroke-width="2.6" /></span>
              <span>
                {{ c.text }}
                <small v-if="c.why">{{ c.why }}</small>
              </span>
            </li>
          </ul>
        </div>
        <EscrowCard class="hero__escrow" :held-cents="180000" :released-cents="120000" :total-cents="360000" tag="M2 · Held" />
      </div>
    </section>

    <!-- how -->
    <section id="how" class="how">
      <p class="vk-eyebrow">How it works</p>
      <h2 class="sec__title">Four steps. Money moves on evidence, not on arguments.</h2>
      <ol class="how__grid">
        <li v-for="(s, i) in steps" :key="s.title" class="how__item">
          <span class="how__n vk-num">0{{ i + 1 }}</span>
          <span class="how__icon"><component :is="s.icon" :size="18" :stroke-width="1.9" /></span>
          <h3>{{ s.title }}</h3>
          <p>{{ s.text }}</p>
        </li>
      </ol>
    </section>

    <!-- sides -->
    <section class="sides">
      <div class="side">
        <span class="side__icon"><Briefcase :size="18" /></span>
        <h3>For clients</h3>
        <ul>
          <li>Pay only for work that passes the checks you signed.</li>
          <li>If it never passes, the hold is voided — you're never charged.</li>
          <li>Release early any time you're happy.</li>
        </ul>
      </div>
      <div class="side">
        <span class="side__icon"><Code2 :size="18" /></span>
        <h3>For freelancers</h3>
        <ul>
          <li>Know the money is held before you start.</li>
          <li>Paid the moment the checks pass — no chasing invoices.</li>
          <li>Clear reasons when something fails, and an appeal if the agent is wrong.</li>
        </ul>
      </div>
    </section>

    <!-- built on -->
    <section class="built">
      <p class="vk-eyebrow">Built on</p>
      <div class="built__row">
        <span><b>PayPal Orders v2</b> authorize → capture / void</span>
        <span><b>Claude</b> criteria drafting, vision checks, code review</span>
        <span><b>Supabase</b> auth, realtime, row-level security</span>
      </div>
    </section>

    <footer class="foot">
      <span class="foot__brand"><BrandMark :size="20" /> Verdikt</span>
      <span class="vk-faint">Escrow · Verify · Release — PayPal sandbox only, no real money moves.</span>
    </footer>
  </div>
</template>

<style scoped>
.land { min-height: 100dvh; background: var(--vk-canvas); overflow-x: hidden; }
.nav { display: flex; align-items: center; gap: 24px; max-width: 1180px; margin: 0 auto; height: 72px; padding: 0 clamp(16px, 4vw, 40px); }
.nav__brand { display: inline-flex; align-items: center; gap: 10px; color: var(--vk-ink); font: 400 18px/1 var(--vk-font); letter-spacing: -.03em; text-decoration: none !important; }
.nav__links { display: flex; gap: 20px; margin-left: auto; font: var(--vk-type-dense); }
.nav__links a { color: var(--vk-muted); }
.nav__links a:hover { color: var(--vk-ink); text-decoration: none; }

.hero { position: relative; display: grid; grid-template-columns: minmax(0, 1.05fr) minmax(0, .95fr); gap: 56px; align-items: center; max-width: 1180px; margin: 0 auto; padding: 56px clamp(16px, 4vw, 40px) 88px; }
.hero__lines { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
.hero__lines * { fill: none; stroke: var(--vk-line); vector-effect: non-scaling-stroke; }
.hero__copy { position: relative; }
.hero__title { margin: 20px 0 0; font: 400 clamp(44px, 6vw, 76px)/1 var(--vk-font); letter-spacing: -.05em; }
.hero__title em { font-style: normal; font-weight: 400; color: var(--vk-accent-text); }
.hero__sub { margin: 24px 0 0; max-width: 540px; font: 400 17px/27px var(--vk-font); color: var(--vk-muted); }
.hero__cta { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 32px; }

.hero__proof { position: relative; display: flex; flex-direction: column; gap: 16px; }
.verdict { padding: 22px; border: 1px solid var(--vk-line); border-radius: var(--vk-r-lg); background: var(--vk-surface); box-shadow: var(--vk-elev-pop); }
.verdict__head { display: flex; align-items: center; gap: 16px; padding-bottom: 16px; border-bottom: 1px solid var(--vk-line-subtle); }
.verdict__title { margin: 4px 0 8px; font: 400 17px/22px var(--vk-font); }
.verdict__rows { margin: 0; padding: 0; list-style: none; }
.verdict__rows li { display: flex; gap: 12px; padding: 12px 0 0; font: var(--vk-type-dense); color: var(--vk-ink-2); }
.verdict__rows small { display: block; margin-top: 2px; font: var(--vk-type-small); color: var(--vk-danger-ink); }
.ic { display: grid; place-items: center; flex: none; width: 20px; height: 20px; border-radius: 50%; }
.ok .ic { background: var(--vk-ok-soft); color: var(--vk-ok-ink); }
.no .ic { background: var(--vk-danger-soft); color: var(--vk-danger-ink); }
.hero__escrow { margin-left: 48px; margin-right: -12px; }

.how, .sides, .built { max-width: 1180px; margin: 0 auto; padding: 72px clamp(16px, 4vw, 40px); border-top: 1px solid var(--vk-line); }
.sec__title { margin: 12px 0 0; max-width: 640px; font: 400 34px/40px var(--vk-font); letter-spacing: -.035em; }
.how__grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin: 40px 0 0; padding: 0; list-style: none; }
.how__item { position: relative; padding: 22px; border: 1px solid var(--vk-line); border-radius: var(--vk-r-md); background: var(--vk-surface); }
.how__n { position: absolute; top: 22px; right: 22px; font-size: 12px; color: var(--vk-faint); }
.how__icon { display: grid; place-items: center; width: 38px; height: 38px; border-radius: var(--vk-r-sm); border: 1px solid var(--vk-accent-line); background: var(--vk-accent-soft); color: var(--vk-accent-text); }
.how__item h3 { margin: 18px 0 0; font: var(--vk-type-card); }
.how__item p { margin: 8px 0 0; font: var(--vk-type-dense); color: var(--vk-muted); }

.sides { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.side { padding: 28px; border: 1px solid var(--vk-line); border-radius: var(--vk-r-lg); background: var(--vk-surface); }
.side__icon { display: grid; place-items: center; width: 38px; height: 38px; border-radius: var(--vk-r-sm); border: 1px solid var(--vk-line); background: var(--vk-surface-2); }
.side h3 { margin: 16px 0 0; font: var(--vk-type-section); }
.side ul { margin: 12px 0 0; padding: 0 0 0 18px; display: flex; flex-direction: column; gap: 8px; font: var(--vk-type-body); color: var(--vk-ink-2); }

.built__row { display: flex; gap: 32px; flex-wrap: wrap; margin-top: 14px; font: var(--vk-type-dense); color: var(--vk-muted); }
.built__row b { font-weight: 400; color: var(--vk-ink); margin-right: 6px; }

.foot { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; max-width: 1180px; margin: 0 auto; padding: 28px clamp(16px, 4vw, 40px) 48px; border-top: 1px solid var(--vk-line); font: var(--vk-type-small); }
.foot__brand { display: inline-flex; align-items: center; gap: 8px; font-weight: 400; }

@media (max-width: 980px) {
  .hero { grid-template-columns: 1fr; gap: 40px; padding-top: 24px; }
  .hero__escrow { margin: 0; }
  .how__grid { grid-template-columns: 1fr 1fr; }
}
@media (max-width: 620px) {
  .nav__links { display: none; }
  .nav .vk-btn { margin-left: auto; }
  .how__grid, .sides { grid-template-columns: 1fr; }
}
</style>
