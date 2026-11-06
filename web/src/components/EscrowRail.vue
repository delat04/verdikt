<!--
  EscrowRail — the whole contract on one line; the signature piece of Verdikt.
  An inverted capsule (ink in light, white in dark — the Workspace schedule bar). Each milestone is
  a segment sized by its amount:
    paid  — green tint + check: money moved
    live  — the cobalt pill, with a lane inside (Held → Delivered → Verified → Paid) and a needle
            whose tag rides above the capsule; while the agent verifies, the needle travels check by check
    next  — dashed: reserved, not yet funded
    void  — refunded, struck through
  Click a segment (or use ←/→) to inspect that milestone; the ring glides to it.
-->
<script setup>
import { computed } from 'vue'
import { Check, Wallet, Hammer, ScanSearch, X, Scale, Banknote, Send, Undo2 } from 'lucide-vue-next'
import { vGlide } from '@/directives/glide'
import { STAGE, LANE, STATUS, stageAt, latestSubmission, checkStates } from '@/domain/milestone'
import { money, shortDate, dueLabel } from '@/domain/format'

const props = defineProps({
  milestones: { type: Array, required: true },
  currency: { type: String, default: 'USD' },
  signed: { type: Boolean, default: true },     // before both sign, nothing is live yet
  drafting: { type: Boolean, default: false },
})
const selected = defineModel({ type: String })

const total = computed(() => props.milestones.reduce((s, m) => s + m.amountCents, 0))
const paid = computed(() => props.milestones.filter((m) => m.status === 'released').length)
const complete = computed(() => props.milestones.length > 0 && props.milestones.every((m) => ['released', 'refunded'].includes(m.status)))
const liveId = computed(() => (props.signed ? props.milestones.find((m) => !['released', 'refunded'].includes(m.status))?.id : null))

const ICON = { draft: Wallet, awaiting_funding: Wallet, funded: Hammer, submitted: Send, verifying: ScanSearch, failed: X, disputed: Scale, passed: Banknote }

function liveNote(m) {
  const v = latestSubmission(m)?.verdict
  if (m.status === 'verifying' && m.progress) {
    const states = checkStates(m.progress)
    const done = states.filter((x) => x === 'pass' || x === 'fail').length
    return `${done} of ${states.length} checked`
  }
  if (m.status === 'failed' && v?.integrity) return 'Flagged · a note aimed at the verifier'
  if (m.status === 'failed' && v) return `${v.results.filter((r) => !r.passed).length} of ${v.results.length} checks failed`
  if (m.status === 'funded') return 'Money held · work in progress'
  if (m.status === 'submitted') return 'Delivered · agent starting'
  if (m.status === 'passed') return 'Every check passed'
  if (m.status === 'disputed') return 'Appeal under review'
  return STATUS[m.status]?.label || ''
}

const segments = computed(() => props.milestones.map((m, i) => {
  const state = m.status === 'released' ? 'paid' : m.status === 'refunded' ? 'void' : m.id === liveId.value ? 'live' : 'next'
  const share = total.value ? m.amountCents / total.value : 1 / props.milestones.length
  let note
  if (state === 'paid') {
    note = m.releasedCents && m.releasedCents < m.amountCents
      ? `${Math.round((m.releasedCents / m.amountCents) * 100)}% paid${m.releasedAt ? ` · ${shortDate(m.releasedAt)}` : ''}`
      : m.releasedAt ? `Paid ${shortDate(m.releasedAt)}` : 'Paid'
  }
  else if (state === 'void') note = 'Refunded'
  else if (state === 'live') note = liveNote(m)
  else if (!props.signed) note = props.drafting ? 'Drafting checks' : 'Awaiting signatures'
  else note = m.dueAt ? dueLabel(m.dueAt) : 'Up next'
  return {
    m, state, note,
    label: i === props.milestones.length - 1 && props.milestones.length > 1 ? 'Final' : `M${m.position}`,
    grow: (0.4 + share).toFixed(3),
    stage: state === 'live' ? STAGE[m.status] : null,
    at: state === 'live' ? stageAt(m) : 0,
  }
}))

function move(dir) {
  const ids = props.milestones.map((m) => m.id)
  const i = ids.indexOf(selected.value)
  const next = ids[Math.min(ids.length - 1, Math.max(0, i + dir))]
  if (next) {
    selected.value = next
    document.getElementById(`rail-${next}`)?.focus()
  }
}
</script>

<template>
  <div class="rail" :class="{ 'is-complete': complete }">
    <div class="rail__lead">
      <span class="rail__label">Milestones</span>
      <span class="rail__chip">
        <Check v-if="complete" :size="13" :stroke-width="2.4" />
        <span class="vk-num">{{ paid }}/{{ milestones.length }}</span> paid
      </span>
    </div>

    <div v-glide class="rail__track" role="tablist" aria-label="Milestones" @keydown.right.prevent="move(1)" @keydown.left.prevent="move(-1)">
      <button
        v-for="s in segments"
        :id="`rail-${s.m.id}`"
        :key="s.m.id"
        type="button"
        role="tab"
        class="rail__seg"
        :class="[`is-${s.state}`, { 'is-active': selected === s.m.id }]"
        :style="{ '--grow': s.grow }"
        :aria-selected="selected === s.m.id"
        :tabindex="selected === s.m.id ? 0 : -1"
        :title="`${s.label} · ${s.m.title} · ${money(s.m.amountCents, currency)}`"
        @click="selected = s.m.id"
      >
        <span class="rail__mark" aria-hidden="true">
          <Check v-if="s.state === 'paid'" :size="14" :stroke-width="2.6" />
          <Undo2 v-else-if="s.state === 'void'" :size="13" :stroke-width="2.2" />
          <component :is="ICON[s.m.status] || Wallet" v-else-if="s.state === 'live'" :size="16" :stroke-width="2" />
          <template v-else>{{ s.m.position }}</template>
        </span>
        <span class="rail__text">
          <span class="rail__title">{{ s.label }} · {{ s.m.title }}</span>
          <span class="rail__note"><span class="rail__note-amt vk-num">{{ money(s.m.amountCents, currency, { whole: true }) }} · </span>{{ s.note }}</span>
        </span>

        <!-- the live segment carries its own lane: where the money is in this milestone -->
        <span v-if="s.state === 'live'" class="rail__lane" :style="{ '--at': `${s.at}%` }" aria-hidden="true">
          <span class="rail__path" />
          <span class="rail__fill" />
          <i v-for="(t, k) in LANE" :key="t" class="rail__tick" :class="{ 'is-on': k * 33.34 <= s.at }" :style="{ left: `${Math.min(100, k * 33.34)}%` }" />
          <span class="rail__needle" :data-tone="s.stage?.tone">
            <span class="rail__tag"><span class="rail__tag-dot" :class="{ 'is-live': s.stage?.live }" />{{ s.stage?.label }}</span>
          </span>
        </span>

        <span class="rail__amt vk-num">{{ money(s.m.amountCents, currency, { whole: true }) }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.rail {
  /* the capsule inverts with the theme: ink in light, white in dark */
  --r-bg: var(--vk-ink);
  --r-fg: var(--vk-on-ink);
  --r-muted: color-mix(in srgb, var(--vk-on-ink) 68%, var(--vk-ink));
  --r-line: color-mix(in srgb, var(--vk-on-ink) 26%, var(--vk-ink));
  --r-hover: color-mix(in srgb, var(--vk-on-ink) 8%, var(--vk-ink));
  display: flex; align-items: stretch; gap: 6px; container: rail / inline-size;
  margin-top: 46px; padding: 6px; min-height: 66px; box-sizing: border-box;   /* room for the needle tag */
  border-radius: var(--vk-r-full); background: var(--r-bg); color: var(--r-fg);
}

/* lead — "Your Schedule [28 March]" becomes "Milestones [1/3 paid]" */
.rail__lead { display: flex; align-items: center; gap: 10px; flex: none; padding: 0 10px 0 18px; }
.rail__label { font: 400 14px/1 var(--vk-font); letter-spacing: -.01em; }
.rail__chip {
  display: inline-flex; align-items: center; gap: 5px; height: 32px; padding: 0 12px;
  border: 1px solid var(--r-line); border-radius: var(--vk-r-full);
  font: var(--vk-type-small); color: var(--r-muted); white-space: nowrap;
}
.rail__chip .vk-num { color: var(--r-fg); }
.rail.is-complete .rail__chip { color: var(--vk-rail-ok); border-color: color-mix(in srgb, var(--vk-rail-ok) 45%, var(--r-bg)); }

/* track — segments sized by amount; the selected one wears a glide ring */
.rail__track { display: flex; gap: 4px; flex: 1; min-width: 0; }
.rail__track::before { background: transparent; border-radius: var(--vk-r-full); box-shadow: 0 0 0 2px var(--r-fg); z-index: 1; }

.rail__seg {
  flex: var(--grow) 1 0; min-width: 64px; container-type: inline-size;
  display: flex; align-items: center; gap: 10px; padding: 0 16px 0 8px;
  border: 1px solid transparent; border-radius: var(--vk-r-full); background: transparent;
  color: var(--r-fg); font: inherit; text-align: left; cursor: pointer;
  transition: background var(--vk-dur-2), border-color var(--vk-dur-2);
}
.rail__seg:focus-visible { outline: 2px solid var(--vk-accent); outline-offset: 3px; }
.rail__mark {
  display: grid; place-items: center; flex: none; width: 36px; height: 36px; border-radius: 50%;
  border: 1px solid var(--r-line); font: 400 12px/1 var(--vk-mono); color: var(--r-muted);
}
.rail__text { display: flex; flex-direction: column; gap: 4px; min-width: 0; flex: 1 1 auto; }
.rail__title { font: 400 13px/1.15 var(--vk-font); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rail__note { font: var(--vk-type-small); color: var(--r-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rail__amt { margin-left: auto; flex: none; font: var(--vk-num-13); color: var(--r-muted); }

/* next — reserved, dashed */
.rail__seg.is-next { border: 1px dashed var(--r-line); }
.rail__seg.is-next:hover { background: var(--r-hover); }

/* paid — money moved: the only green on the rail */
.rail__seg.is-paid { background: color-mix(in srgb, var(--vk-rail-ok) 15%, var(--r-bg)); }
.rail__seg.is-paid:hover { background: color-mix(in srgb, var(--vk-rail-ok) 22%, var(--r-bg)); }
.rail__seg.is-paid .rail__mark { border-color: transparent; background: var(--vk-rail-ok); color: var(--r-bg); }
.rail__seg.is-paid .rail__amt { color: var(--r-fg); }

/* void — refunded */
.rail__seg.is-void { border: 1px solid var(--r-line); }
.rail__seg.is-void .rail__amt { text-decoration: line-through; }

/* live — the cobalt pill */
.rail__seg.is-live {
  flex-grow: calc(var(--grow) + .7); min-width: 340px;
  background: var(--vk-accent); color: #fff; padding-right: 20px;
}
.rail__seg.is-live:hover { background: var(--vk-accent-hover); }
.rail__seg.is-live .rail__mark { border-color: transparent; background: rgba(255, 255, 255, .18); color: #fff; }
.rail__seg.is-live .rail__note { color: #fff; }
.rail__seg.is-live .rail__amt { color: #fff; font-size: 14px; }
.rail__seg.is-live .rail__text { flex: 0 1 auto; max-width: 46%; }

/* the lane inside the live pill: four stops, a fill up to the needle */
.rail__lane { position: relative; flex: 1 1 80px; min-width: 64px; height: 12px; margin: 0 8px 0 10px; }
.rail__path, .rail__fill { position: absolute; left: 0; top: 50%; height: 2px; margin-top: -1px; border-radius: 2px; }
.rail__path { right: 0; background: repeating-linear-gradient(90deg, rgba(255, 255, 255, .42) 0 4px, transparent 4px 8px); }
.rail__fill { width: var(--at); background: #fff; transition: width .7s var(--vk-ease-out); }
.rail__tick {
  position: absolute; top: 50%; width: 8px; height: 8px; margin: -4px 0 0 -4px; border-radius: 50%;
  background: var(--vk-accent); box-shadow: inset 0 0 0 1.5px rgba(255, 255, 255, .55);
}
.rail__tick.is-on { background: #fff; box-shadow: none; }
.rail__needle {
  position: absolute; left: var(--at); bottom: 50%; width: 2px; height: 46px; margin-left: -1px;
  background: #fff; border-radius: 2px; transition: left .7s var(--vk-ease-out);
}
.rail__needle::after { content: ''; position: absolute; left: -3px; bottom: -4px; width: 8px; height: 8px; border-radius: 50%; background: #fff; }
.rail__tag {
  position: absolute; left: 50%; bottom: 100%; transform: translate(-50%, -2px);
  display: inline-flex; align-items: center; gap: 6px; height: 24px; padding: 0 10px;
  border: 1px solid var(--vk-line); border-radius: var(--vk-r-full); background: var(--vk-surface); color: var(--vk-ink);
  font: 400 11px/1 var(--vk-font); white-space: nowrap; box-shadow: var(--vk-elev-pop);
}
.rail__tag-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--vk-accent); }
.rail__tag-dot.is-live { animation: vk-beacon 1.3s ease-in-out infinite; }
.rail__needle[data-tone='warn'] .rail__tag-dot { background: var(--vk-warn); }
.rail__needle[data-tone='danger'] .rail__tag-dot { background: var(--vk-danger); }
.rail__needle[data-tone='ok'] .rail__tag-dot { background: var(--vk-ok); }
.rail__needle[data-tone='neutral'] .rail__tag-dot { background: var(--vk-faint); }

/* narrow segments fold the amount into the note, then keep only the mark */
.rail__note-amt { display: none; }
@container (max-width: 210px) { .rail__amt { display: none; } .rail__note-amt { display: inline; } }
@container (max-width: 92px) { .rail__text { display: none; } }

/* a narrower rail gives its lead back to the segments */
@media (min-width: 761px) {
  @container rail (max-width: 860px) { .rail__label { display: none; } .rail__lead { padding-left: 8px; } }
  @container rail (max-width: 700px) { .rail__lead { display: none; } }
}

/* phones: the capsule stands up — one row per milestone */
@media (max-width: 760px) {
  .rail { flex-direction: column; border-radius: var(--vk-r-xl); margin-top: 0; padding: 8px; }
  .rail__lead { justify-content: space-between; padding: 8px 6px 10px 12px; }
  .rail__track { flex-direction: column; gap: 6px; }
  .rail__seg, .rail__seg.is-live { min-width: 0; min-height: 56px; flex: none; }
  .rail__seg.is-live .rail__text { max-width: none; flex: 1 1 auto; }
  .rail__lane { display: none; }
}
@media (prefers-reduced-motion: reduce) { .rail__fill, .rail__needle { transition: none; } }
</style>
