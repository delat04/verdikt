<!--
  PipelineWindow — Verdikt, framed: one job (Northbrew's loyalty card page) as it moves through the
  six stages of the landing's pipeline. A pure picture of (stage, t): the pipeline section scrubs it
  with the scroll, and its stacked version shows each stage at its end (t = 1). Decorative
  (aria-hidden): the words beside it say the same thing. Green only where a check passes or money moves.
-->
<script setup>
import { computed } from 'vue'
import { Check, X } from 'lucide-vue-next'
import VAvatar from '@/components/ui/VAvatar.vue'
import ScoreRing from '@/components/ScoreRing.vue'
import BrandMark from '@/components/BrandMark.vue'
import { PIPELINE, POST, APPLICANTS, ROOM, TERMS, CHECKS } from './pipelineContent'
import { range, typed, countUp } from './landingMath'

const props = defineProps({
  stage: { type: Number, default: 0 },   // 0 Post … 5 Paid
  t: { type: Number, default: 1 },       // progress through the stage, 0 → 1
  compact: { type: Boolean, default: false },
})

const on = (a) => props.t >= a
const r = (a, b) => range(props.t, a, b)
const caret = (a, b) => props.t > a && props.t < b

// Check: the precheck finds one failure, the fix lands, then the verdict reads down the list
const pre = computed(() => (props.t < 0.16 ? null : props.t < 0.3 ? 4 : 5))
const resolved = computed(() => Math.floor(r(0.34, 0.86) * CHECKS.length + 0.0001))
const passed = computed(() => Math.min(resolved.value, CHECKS.length))

// Fund: the hold grows out of the limit
const held = computed(() => countUp(600, r(0.32, 0.6)))
</script>

<template>
  <div class="pw" :class="{ 'pw--compact': compact }" aria-hidden="true">
    <header class="pw__bar">
      <span class="pw__brand"><BrandMark :size="16" /> Verdikt</span>
      <span class="pw__page">{{ PIPELINE[stage].page }}</span>
      <span class="pw__who"><VAvatar name="Maya Chen" size="sm" /><span>Maya Chen</span></span>
    </header>

    <div class="pw__body">
      <Transition name="pw-swap" mode="out-in">
        <!-- 01 Post -->
        <div v-if="stage === 0" key="post" class="pw__stage pw-post">
          <section class="pw-card">
            <p class="pw-card__head">Post a job</p>
            <span class="pw-label">Title</span>
            <p class="pw-input">{{ typed(POST.title, r(0, 0.2)) }}<i v-if="caret(0, 0.2)" class="pw-caret" /></p>
            <span class="pw-label">What done looks like</span>
            <p class="pw-input pw-input--area">{{ typed(POST.brief, r(0.18, 0.52)) }}<i v-if="caret(0.18, 0.52)" class="pw-caret" /></p>
            <div class="pw-split">
              <span class="pw-label">Budget</span>
              <span class="pw-input pw-input--num vk-num">{{ on(0.8) ? '$600' : '' }}</span>
            </div>
          </section>
          <section class="pw-card pw-price pw-in" :class="{ 'is-in': on(0.5) }">
            <p class="pw-card__head">Price check<em>live web prices</em></p>
            <p class="pw-price__range"><span class="vk-num">$450</span> to <span class="vk-num">$750</span></p>
            <div class="pw-price__track"><i class="pw-price__band" /><i class="pw-price__mark" :class="{ 'is-in': on(0.62) }" /></div>
            <p class="pw-price__hint">Suggested <span class="vk-num">$600</span> for about 7 days of work</p>
            <ul class="pw-sources">
              <li v-for="(s, i) in POST.sources" :key="s" class="pw-in" :class="{ 'is-in': on(0.58 + i * 0.07) }">{{ s }}</li>
            </ul>
            <span class="pw-btn pw-btn--primary" :class="{ 'is-pressed': on(0.88) }">{{ on(0.88) ? 'Posted to the job board' : 'Post job' }}</span>
          </section>
        </div>

        <!-- 02 Hire -->
        <div v-else-if="stage === 1" key="hire" class="pw__stage pw-hire">
          <section class="pw-card">
            <p class="pw-card__head">Loyalty card page for Northbrew<em>3 applications, reviewed</em></p>
            <ul class="pw-apps">
              <li v-for="(a, i) in APPLICANTS" :key="a.name" class="pw-in" :class="{ 'is-in': on(0.08 + i * 0.13), 'is-pick': i === 0 && on(0.66) }">
                <VAvatar :name="a.name" />
                <span class="pw-apps__who"><b>{{ a.name }}</b><small>{{ a.meta }}</small></span>
                <span class="pw-apps__fit"><b class="vk-num">{{ countUp(a.fit, r(0.1 + i * 0.13, 0.36 + i * 0.13)) }}</b><small>fit</small></span>
                <span class="pw-flag" :class="`pw-flag--${a.tone}`">{{ a.flag }}</span>
                <span class="pw-apps__price vk-num">{{ a.price }}</span>
              </li>
            </ul>
            <p class="pw-note pw-in" :class="{ 'is-in': on(0.56) }">Sam fits the brief best: he has shipped two QR sign-up flows, and his price is inside your budget.</p>
            <span class="pw-btn pw-btn--primary" :class="{ 'is-pressed': on(0.84) }">{{ on(0.84) ? 'Contract room open with Sam' : 'Hire Sam and open the room' }}</span>
          </section>
        </div>

        <!-- 03 Agree -->
        <div v-else-if="stage === 2" key="agree" class="pw__stage pw-agree">
          <section class="pw-card pw-chat">
            <p class="pw-card__head">Contract room<em>Maya, Sam and the mediator</em></p>
            <ul class="pw-msgs">
              <li v-for="(m, i) in ROOM" :key="i" class="pw-in" :class="[{ 'is-in': on(0.04 + i * 0.17) }, `pw-msg--${m.who === 'Mediator' ? 'ai' : m.who === 'Maya' ? 'me' : 'them'}`]">
                <small>{{ m.who }}</small>{{ m.text }}
              </li>
            </ul>
          </section>
          <section class="pw-card pw-terms">
            <p class="pw-card__head">Terms<em class="vk-num">v{{ on(0.32) ? 2 : 1 }}</em></p>
            <div class="pw-terms__meta"><span><small>Price</small><b class="vk-num">$600</b></span><span><small>Due</small><b>7 days</b></span></div>
            <ul class="pw-terms__list">
              <li v-for="c in TERMS" v-show="!c.added || on(0.32)" :key="c.text" :class="{ 'is-new': c.added }">
                <i class="pw-dot" />{{ c.text }}<span v-if="c.added" class="pw-new">new in v2</span>
              </li>
            </ul>
            <div class="pw-signs">
              <span class="pw-in" :class="{ 'is-in': on(0.62) }"><VAvatar name="Maya Chen" size="sm" />Maya signed v2</span>
              <span class="pw-in" :class="{ 'is-in': on(0.8) }"><VAvatar name="Sam Okafor" size="sm" />Sam signed v2</span>
            </div>
          </section>
        </div>

        <!-- 04 Fund -->
        <div v-else-if="stage === 3" key="fund" class="pw__stage pw-fund">
          <section class="pw-card pw-limit">
            <p class="pw-card__head">Your spending limit<em>approved once on PayPal</em></p>
            <p class="pw-limit__left"><b class="vk-num">${{ (1000 - held).toLocaleString('en-US') }}</b> left of <span class="vk-num">$1,000</span></p>
            <div class="pw-limit__bar"><i :style="{ width: `${held / 10}%` }" /></div>
            <ul class="pw-legend"><li><i class="is-held" />Held for jobs <span class="vk-num">${{ held }}</span></li><li><i />Left <span class="vk-num">${{ 1000 - held }}</span></li></ul>
          </section>
          <section class="pw-card pw-log">
            <p class="pw-card__head">Your agent, over MCP</p>
            <ol>
              <li class="pw-in" :class="{ 'is-in': on(0.08) }"><code>get_spending_limit</code><span>$1,000 left, up to $600 a job</span></li>
              <li class="pw-in" :class="{ 'is-in': on(0.3) }"><code>fund_milestone</code><span class="is-held">$600 held from your limit</span></li>
              <li class="pw-in" :class="{ 'is-in': on(0.66) }"><code>get_contract</code><span>Held by PayPal. Sam can start.</span></li>
            </ol>
          </section>
          <section class="pw-card pw-ms pw-in" :class="{ 'is-in': on(0.62) }">
            <div class="pw-ms__head">
              <span><small>Loyalty card page, milestone 1</small>Site live</span>
              <b class="vk-num">$600.00</b>
            </div>
            <ol class="pw-lane">
              <li v-for="(stop, i) in ['Held', 'Delivered', 'Verified', 'Paid']" :key="stop" :class="{ 'is-on': i === 0 && on(0.7) }"><i />{{ stop }}</li>
            </ol>
          </section>
        </div>

        <!-- 05 Check -->
        <div v-else-if="stage === 4" key="check" class="pw__stage pw-check">
          <section class="pw-card pw-pre">
            <span class="pw-pre__who"><VAvatar name="Sam Okafor" size="sm" />Sam’s coding agent ran the checks before delivering</span>
            <span class="pw-pre__score vk-num" :class="{ 'is-ok': pre === 5 }">{{ pre === null ? 'running…' : `${pre} of 5` }}</span>
          </section>
          <section class="pw-card pw-verdict">
            <div class="pw-verdict__head">
              <ScoreRing :value="(passed / CHECKS.length) * 100" :pending="resolved < CHECKS.length" :label="`${passed}/${CHECKS.length}`" :size="50" />
              <div>
                <p class="pw-verdict__title">{{ resolved < CHECKS.length ? 'Checking the delivery' : 'Every check passed' }}</p>
                <p class="pw-verdict__sub">{{ resolved < CHECKS.length ? 'loyalty.northbrew.co, and the repo' : '4 settled by probes, 1 by Claude, in 14 seconds' }}</p>
              </div>
            </div>
            <ul class="pw-checks">
              <li v-for="(c, i) in CHECKS" :key="c.text" :class="{ 'is-ok': i < resolved, 'is-run': i === resolved }">
                <span class="pw-ic"><Check v-if="i < resolved" :size="11" :stroke-width="2.8" /></span>
                <span class="pw-checks__text">{{ c.text }}</span>
                <span class="pw-by">{{ c.by }}</span>
              </li>
            </ul>
          </section>
        </div>

        <!-- 06 Paid -->
        <div v-else key="paid" class="pw__stage pw-paid">
          <section class="pw-card pw-payout">
            <span class="pw-payout__label">{{ on(0.22) ? 'Sent to Sam’s PayPal' : 'Released by the verdict' }}</span>
            <b class="pw-payout__amt vk-num" :class="{ 'is-ok': on(0.22) }">{{ on(0.22) ? '$588.00' : '$600.00' }}</b>
            <span class="pw-payout__fee">Verdikt’s 2% fee <span class="vk-num">$12.00</span>, from the payout</span>
          </section>
          <section v-if="!compact" class="pw-card pw-tl">
            <p class="pw-card__head">Timeline<em>every milestone on one clock</em></p>
            <div class="pw-tl__rows">
              <i class="pw-tl__today" />
              <div class="pw-tl__row"><span>Brand landing page</span><b><i class="is-paid" style="left: 2%; width: 20%" /></b></div>
              <div class="pw-tl__row"><span>Online shop</span><b><i class="is-held" style="left: 26%; width: 36%" /><em class="pw-tl__whisker" style="left: 62%; width: 30%" /></b></div>
              <div class="pw-tl__row"><span>Loyalty card page</span><b><i :class="on(0.4) ? 'is-paid' : 'is-held'" style="left: 46%; width: 18%" /></b></div>
            </div>
            <ul class="pw-legend pw-legend--tl"><li><i class="is-held" />Held by PayPal</li><li><i class="is-paid" />Paid</li><li><i class="is-whisker" />Hold good until</li></ul>
          </section>
        </div>
      </Transition>
    </div>
  </div>
</template>

<style scoped>
.pw {
  display: flex; flex-direction: column; height: 100%; overflow: hidden; pointer-events: none;
  border: 1px solid var(--vk-line); border-radius: 18px; background: var(--vk-surface);
  box-shadow: 0 40px 80px -42px rgba(14, 20, 40, .32), 0 2px 6px rgba(14, 15, 18, .04);
  font: var(--vk-type-dense); color: var(--vk-ink);
}
.pw__bar { display: flex; align-items: center; gap: 16px; height: 46px; padding: 0 18px; border-bottom: 1px solid var(--vk-line-subtle); color: var(--vk-muted); }
.pw__brand { display: inline-flex; align-items: center; gap: 7px; color: var(--vk-ink); }
.pw__page { padding-left: 16px; border-left: 1px solid var(--vk-line-subtle); }
.pw__who { display: inline-flex; align-items: center; gap: 8px; margin-left: auto; }
.pw__body { position: relative; flex: 1; min-height: 0; padding: 20px; background: var(--vk-canvas); }
.pw__stage { display: grid; gap: 14px; height: 100%; align-content: start; }

.pw-swap-enter-active, .pw-swap-leave-active { transition: opacity .3s ease, transform .4s cubic-bezier(.16, 1, .3, 1); }
.pw-swap-enter-from { opacity: 0; transform: translateY(10px); }
.pw-swap-leave-to { opacity: 0; transform: translateY(-8px); }

/* things that arrive within a stage */
.pw-in { opacity: 0; transform: translateY(6px); transition: opacity .45s ease, transform .5s cubic-bezier(.16, 1, .3, 1); }
.pw-in.is-in { opacity: 1; transform: none; }

.pw-card { display: grid; gap: 10px; align-content: start; padding: 16px 18px; border: 1px solid var(--vk-line); border-radius: 14px; background: var(--vk-surface); }
.pw-card__head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin: 0 0 2px; font: 400 15px/20px var(--vk-font); letter-spacing: -.01em; }
.pw-card__head em { font: var(--vk-type-small); font-style: normal; color: var(--vk-faint); }
.pw-label { font: var(--vk-type-small); color: var(--vk-faint); }
.pw-input { min-height: 36px; margin: -4px 0 2px; padding: 8px 11px; border: 1px solid var(--vk-line); border-radius: 10px; background: var(--vk-surface); font: var(--vk-type-dense); color: var(--vk-ink); }
.pw-input--area { min-height: 92px; }
.pw-input--num { min-width: 96px; margin: 0; }
.pw-split { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.pw-caret { display: inline-block; width: 1px; height: 14px; margin-left: 1px; vertical-align: -2px; background: var(--vk-accent); }
.pw-btn { justify-self: start; display: inline-flex; align-items: center; height: 34px; padding: 0 16px; border-radius: 999px; border: 1px solid var(--vk-line); background: var(--vk-surface); font: 400 13px/1 var(--vk-font); transition: background .3s, color .3s, transform .2s; }
.pw-btn--primary { border-color: transparent; background: var(--vk-accent); color: #fff; }
.pw-btn.is-pressed { background: var(--vk-ink); transform: scale(.98); }
.pw-note { margin: 0; padding: 10px 12px; border-radius: 10px; background: var(--vk-accent-soft); color: var(--vk-accent-text); }
.pw-dot { flex: none; width: 6px; height: 6px; border-radius: 50%; background: var(--vk-line-strong); }
.pw-legend { display: flex; flex-wrap: wrap; gap: 6px 16px; margin: 0; padding: 0; list-style: none; font: var(--vk-type-small); color: var(--vk-muted); }
.pw-legend li { display: inline-flex; align-items: center; gap: 7px; }
.pw-legend i { width: 14px; height: 8px; border-radius: 999px; border: 1px solid var(--vk-line-strong); }
.pw-legend i.is-held { border-color: var(--vk-accent-line); background: var(--vk-accent-soft); }
.pw-legend i.is-paid { border-color: color-mix(in srgb, var(--vk-ok) 40%, transparent); background: var(--vk-ok-soft); }
.pw-legend i.is-whisker { height: 0; border: 0; border-radius: 0; border-top: 2px dotted color-mix(in srgb, var(--vk-accent) 55%, transparent); }

/* 01 post */
.pw-post { grid-template-columns: 1.15fr .85fr; align-items: start; }
.pw-price__range { margin: 0; font: 300 30px/1.1 var(--vk-font); letter-spacing: -.03em; }
.pw-price__track { position: relative; height: 6px; margin: 6px 0 2px; border-radius: 999px; background: var(--vk-surface-2); }
.pw-price__band { position: absolute; left: 18%; right: 22%; top: 0; bottom: 0; border-radius: 999px; background: var(--vk-accent-line); }
.pw-price__mark { position: absolute; top: 50%; left: 18%; width: 12px; height: 12px; margin: -6px 0 0 -6px; border-radius: 50%; background: var(--vk-accent); box-shadow: 0 0 0 4px var(--vk-accent-soft); transition: left .8s cubic-bezier(.16, 1, .3, 1); }
.pw-price__mark.is-in { left: 50%; }
.pw-price__hint { margin: 0; color: var(--vk-muted); }
.pw-sources { display: grid; gap: 6px; margin: 2px 0 6px; padding: 10px 0 0; border-top: 1px solid var(--vk-line-subtle); list-style: none; font: var(--vk-type-small); color: var(--vk-muted); }

/* 02 hire */
.pw-apps { display: grid; margin: 0; padding: 0; list-style: none; }
.pw-apps li { display: grid; grid-template-columns: auto 1fr auto auto auto; align-items: center; gap: 14px; padding: 12px 10px; margin: 0 -10px; border-radius: 12px; border: 1px solid transparent; transition: opacity .45s, transform .5s cubic-bezier(.16, 1, .3, 1), background .4s, border-color .4s; }
.pw-apps li + li { border-top-color: var(--vk-line-subtle); border-radius: 0; }
.pw-apps li.is-pick { border-color: var(--vk-accent-line); background: var(--vk-accent-soft); border-radius: 12px; }
.pw-apps__who { display: grid; gap: 2px; min-width: 0; }
.pw-apps__who b { font-weight: 400; color: var(--vk-ink); }
.pw-apps__who small, .pw-apps__fit small { font: var(--vk-type-small); color: var(--vk-faint); }
.pw-apps__fit { display: grid; justify-items: end; }
.pw-apps__fit b { font: 400 18px/1 var(--vk-mono); color: var(--vk-ink); }
.pw-apps__price { font-size: 13px; color: var(--vk-muted); }
.pw-flag { padding: 4px 9px; border-radius: 999px; font: var(--vk-type-small); white-space: nowrap; }
.pw-flag--ok { background: var(--vk-surface-2); color: var(--vk-muted); }
.pw-flag--danger { background: var(--vk-danger-soft); color: var(--vk-danger-ink); }
.pw-flag--warn { background: #FEF4E2; color: #8A5600; }

/* 03 agree */
.pw-agree { grid-template-columns: .9fr 1.1fr; align-items: start; }
.pw-msgs { display: grid; gap: 10px; margin: 0; padding: 0; list-style: none; }
.pw-msgs li { display: grid; gap: 3px; max-width: 92%; padding: 9px 12px; border-radius: 12px; background: var(--vk-surface-2); }
.pw-msgs small { font: var(--vk-type-small); color: var(--vk-faint); }
.pw-msg--me { justify-self: end; background: var(--vk-accent-soft) !important; }
.pw-msg--ai { border: 1px solid var(--vk-accent-line); background: var(--vk-surface) !important; }
.pw-terms__meta { display: flex; gap: 28px; padding-bottom: 10px; border-bottom: 1px solid var(--vk-line-subtle); }
.pw-terms__meta span { display: grid; gap: 2px; }
.pw-terms__meta small { font: var(--vk-type-small); color: var(--vk-faint); }
.pw-terms__meta b { font-weight: 400; font-size: 15px; }
.pw-terms__list { display: grid; gap: 8px; margin: 0; padding: 0; list-style: none; }
.pw-terms__list li { display: flex; align-items: center; gap: 10px; color: var(--vk-ink-2); }
.pw-terms__list li.is-new { color: var(--vk-ink); }
.pw-terms__list li.is-new .pw-dot { background: var(--vk-accent); }
.pw-new { margin-left: auto; flex: none; padding: 2px 8px; border-radius: 999px; background: var(--vk-accent-soft); color: var(--vk-accent-text); font: var(--vk-type-small); }
.pw-signs { display: flex; flex-wrap: wrap; gap: 8px; padding-top: 10px; border-top: 1px solid var(--vk-line-subtle); }
.pw-signs span { display: inline-flex; align-items: center; gap: 8px; padding: 4px 12px 4px 4px; border-radius: 999px; background: var(--vk-surface-2); color: var(--vk-ink-2); }

/* 04 fund */
.pw-fund { grid-template-columns: 1fr 1fr; align-items: start; }
.pw-limit__left { margin: 4px 0 0; color: var(--vk-muted); }
.pw-limit__left b { margin-right: 4px; font: 300 34px/1 var(--vk-mono); letter-spacing: -.03em; color: var(--vk-ink); }
.pw-limit__bar { height: 10px; border-radius: 999px; background: var(--vk-surface-2); border: 1px solid var(--vk-line-subtle); overflow: hidden; }
.pw-limit__bar i { display: block; height: 100%; background: var(--vk-accent); border-radius: 999px; }
.pw-log ol { display: grid; gap: 12px; margin: 0; padding: 0; list-style: none; }
.pw-log li { display: grid; gap: 3px; }
.pw-log code { font: 400 12px/16px var(--vk-mono); color: var(--vk-accent-text); background: none; padding: 0; }
.pw-log span { color: var(--vk-ink-2); }
.pw-log span.is-held { color: var(--vk-accent-text); }
.pw-ms { grid-column: 1 / -1; }
.pw-ms__head { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; }
.pw-ms__head span { display: grid; gap: 2px; font: 400 15px/20px var(--vk-font); }
.pw-ms__head small { font: var(--vk-type-small); color: var(--vk-faint); }
.pw-ms__head b { font: 300 22px/1 var(--vk-mono); }
.pw-lane { position: relative; display: grid; grid-template-columns: repeat(4, 1fr); margin: 6px 0 0; padding: 0; list-style: none; font: var(--vk-type-small); color: var(--vk-faint); }
.pw-lane::before { content: ''; position: absolute; left: 5px; right: 0; top: 5px; height: 1px; background: var(--vk-line); }
.pw-lane li { position: relative; display: grid; gap: 8px; }
.pw-lane i { width: 11px; height: 11px; border-radius: 50%; border: 1px solid var(--vk-line-strong); background: var(--vk-surface); transition: background .4s, border-color .4s, box-shadow .4s; }
.pw-lane li.is-on { color: var(--vk-accent-text); }
.pw-lane li.is-on i { border-color: var(--vk-accent); background: var(--vk-accent); box-shadow: 0 0 0 4px var(--vk-accent-soft); }

/* 05 check */
.pw-pre { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 14px 10px 10px; }
.pw-pre__who { display: inline-flex; align-items: center; gap: 10px; color: var(--vk-muted); }
.pw-pre__score { flex: none; white-space: nowrap; padding: 4px 10px; border-radius: 999px; background: var(--vk-surface-2); color: var(--vk-muted); font-size: 12px; transition: background .3s, color .3s; }
.pw-pre__score.is-ok { background: var(--vk-ok-soft); color: var(--vk-ok-ink); }
.pw-verdict__head { display: flex; align-items: center; gap: 14px; padding-bottom: 12px; border-bottom: 1px solid var(--vk-line-subtle); }
.pw-verdict__title { margin: 0; font: 400 16px/20px var(--vk-font); }
.pw-verdict__sub { margin: 3px 0 0; font: var(--vk-type-small); color: var(--vk-faint); }
.pw-checks { display: grid; gap: 4px; margin: 0; padding: 0; list-style: none; }
.pw-checks li { display: flex; align-items: center; gap: 12px; padding: 7px 0; color: var(--vk-faint); transition: color .3s; }
.pw-checks li.is-ok, .pw-checks li.is-run { color: var(--vk-ink-2); }
.pw-ic { display: grid; place-items: center; flex: none; width: 20px; height: 20px; border-radius: 50%; border: 1px solid var(--vk-line-strong); transition: background .3s, border-color .3s; }
.is-ok .pw-ic { border-color: transparent; background: var(--vk-ok); color: #fff; }
.is-run .pw-ic { border-color: var(--vk-accent); border-top-color: transparent; animation: pw-spin .8s linear infinite; }
.pw-checks__text { flex: 1; min-width: 0; }
.pw-by { flex: none; padding: 2px 8px; border-radius: 999px; background: var(--vk-surface-2); font: var(--vk-type-small); color: var(--vk-muted); }
@keyframes pw-spin { to { transform: rotate(360deg); } }

/* 06 paid */
.pw-payout { gap: 4px; padding: 18px 20px; }
.pw-payout__label { color: var(--vk-muted); }
.pw-payout__amt { font: 300 44px/1.05 var(--vk-mono); letter-spacing: -.03em; color: var(--vk-ink); transition: color .4s; }
.pw-payout__amt.is-ok { color: var(--vk-ok-ink); }
.pw-payout__fee { font: var(--vk-type-small); color: var(--vk-faint); }
.pw-tl__rows { position: relative; display: grid; gap: 10px; padding: 6px 0; }
.pw-tl__row { display: grid; grid-template-columns: 34% 1fr; align-items: center; gap: 12px; color: var(--vk-ink-2); }
.pw-tl__row b { position: relative; height: 24px; }
.pw-tl__row b > i { position: absolute; top: 0; bottom: 0; border-radius: 999px; border: 1px solid transparent; transition: background .5s, border-color .5s; }
.pw-tl__row i.is-held { border-color: var(--vk-accent-line); background: var(--vk-accent-soft); }
.pw-tl__row i.is-paid { border-color: color-mix(in srgb, var(--vk-ok) 40%, transparent); background: var(--vk-ok-soft); }
.pw-tl__whisker { position: absolute; top: 50%; border-top: 2px dotted color-mix(in srgb, var(--vk-accent) 55%, transparent); }
.pw-tl__whisker::after { content: ''; position: absolute; right: 0; top: -7px; height: 12px; border-right: 2px solid color-mix(in srgb, var(--vk-accent) 55%, transparent); }
.pw-tl__today { position: absolute; top: -4px; bottom: -4px; left: calc(34% + 12px + (66% - 12px) * .58); border-left: 1.5px dashed var(--vk-ink); opacity: .5; }

/* narrow: one column, fewer details */
.pw--compact .pw__who span, .pw--compact .pw__page { display: none; }
.pw--compact .pw-post, .pw--compact .pw-agree, .pw--compact .pw-fund { grid-template-columns: 1fr; }
.pw--compact .pw-apps li { grid-template-columns: auto 1fr auto; }
.pw--compact .pw-flag, .pw--compact .pw-apps__price { display: none; }
.pw--compact .pw-by { display: none; }

@media (prefers-reduced-motion: reduce) {
  .pw-in, .pw-swap-enter-active, .pw-swap-leave-active, .pw-price__mark { transition: none; }
  .is-run .pw-ic { animation: none; }
}
</style>
