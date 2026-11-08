<!--
  MoneyTimeline — every milestone on one clock, coloured by where its money is rather than by category:
  dashed while it waits for funding, cobalt while PayPal holds it, green once it's paid.
  A held bar trails a dotted whisker to the day PayPal's hold lapses (Verdikt renews it before then),
  the dotted ink line is today, and the client's spending limit runs along the top as a thin band.
  rows: the Contracts page's rows [{ c, role, other }] · limit: the current spending limit, or null
-->
<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import VAvatar from '@/components/ui/VAvatar.vue'
import { money, shortDate, firstName } from '@/domain/format'
import { HELD, holdHealth } from '@/domain/milestone'

const props = defineProps({
  rows: { type: Array, required: true },
  limit: { type: Object, default: null },
})

const DAY = 864e5
const now = ref(Date.now())
const ms = (iso) => (iso ? new Date(iso).getTime() : null)
const day = (t) => shortDate(new Date(t).toISOString())
const startOfDay = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime() }

// one bar per milestone; an unfunded one is planned from where the one before it ends to its own due date
function bar(m, c, prevEnd) {
  const funded = ms(m.fundedAt || m.authorizedAt)
  const due = ms(m.dueAt)
  const late = due != null && now.value > due
  if (m.status === 'released') {
    const start = funded ?? prevEnd
    return { m, state: 'paid', start, end: Math.max(ms(m.releasedAt) ?? due ?? start, start + DAY / 2) }
  }
  if (m.status === 'refunded') {
    const at = ms(c.activity?.find((a) => a.milestoneId === m.id && a.event === 'escrow.refunded')?.createdAt)
    const start = funded ?? prevEnd
    return { m, state: 'refunded', start, end: Math.max(at ?? due ?? start, start + DAY / 2) }
  }
  if (HELD.includes(m.status)) {
    const start = funded ?? prevEnd
    const hold = holdHealth(m, now.value)
    return {
      m, state: 'held', start, late, undated: due == null, hold,
      end: Math.max(late ? now.value : due ?? start + 7 * DAY, start + DAY / 2),
      holdEnd: hold ? ms(hold.expiresAt) : null,
    }
  }
  return { m, state: 'open', start: prevEnd, late, undated: due == null, end: Math.max(due ?? prevEnd + 7 * DAY, prevEnd + DAY / 2) }
}

const groups = computed(() => props.rows.map((r) => {
  const c = r.c
  const signed = c.clientSignedAt && c.freelancerSignedAt ? Math.max(ms(c.clientSignedAt), ms(c.freelancerSignedAt)) : null
  let cursor = signed ?? ms(c.createdAt) ?? now.value
  const bars = (c.milestones || []).map((m) => { const b = bar(m, c, cursor); cursor = b.end; return b })
  // a cancelled contract's unfunded milestones were never going to happen
  return { r, bars: c.status === 'cancelled' ? bars.filter((b) => b.state !== 'open') : bars }
}).filter((g) => g.bars.length))

const band = computed(() => {
  const l = props.limit
  if (!l || !['active', 'closing'].includes(l.status)) return null
  return { l, start: ms(l.authorizedAt || l.createdAt), end: ms(l.endsAt) }
})

// the window: everything on screen plus a day either side, at least two weeks, and never far from today
const range = computed(() => {
  const pts = [now.value]
  for (const g of groups.value) for (const b of g.bars) pts.push(b.start, b.end, b.holdEnd ?? b.end)
  if (band.value) pts.push(band.value.start, band.value.end)
  const from = startOfDay(Math.max(Math.min(...pts), now.value - 45 * DAY) - DAY)
  let to = startOfDay(Math.min(Math.max(...pts), now.value + 75 * DAY) + 2 * DAY)
  if (to - from < 14 * DAY) to = from + 14 * DAY
  return { from, to, span: to - from }
})
const pct = (t) => ((Math.min(Math.max(t, range.value.from), range.value.to) - range.value.from) / range.value.span) * 100

const ticks = computed(() => {
  const { from, to, span } = range.value
  const days = span / DAY
  const step = days <= 16 ? 1 : days <= 30 ? 2 : days <= 70 ? 7 : 14
  const d = new Date(from)
  if (step >= 7) while (d.getDay() !== 1) d.setDate(d.getDate() + 1)   // weeks start on Monday
  const out = []
  for (; d.getTime() < to; d.setDate(d.getDate() + step)) {
    const at = d.getTime()
    if (pct(at) > 95) break
    out.push({ at, n: d.getDate(), cap: d.toLocaleDateString('en-US', step < 7 ? { weekday: 'short' } : { month: 'short' }), past: at + DAY <= now.value })
  }
  return out
})

// the track's width decides whether a bar can hold its own label
const body = ref(null)
const width = ref(800)
let ro = null
watch(body, (el) => {
  ro?.disconnect()
  if (!el || typeof ResizeObserver === 'undefined') return
  ro = new ResizeObserver(([e]) => { width.value = e.contentRect.width })
  ro.observe(el)
})

const laid = computed(() => groups.value.map((g) => ({
  ...g,
  bars: g.bars.map((b) => {
    const left = pct(b.start)
    const w = Math.max(pct(b.end) - left, 0.6)
    const inside = (w / 100) * width.value >= 170
    const whisker = b.holdEnd && b.holdEnd > b.end ? { left: left + w, w: pct(b.holdEnd) - left - w } : null
    // a short bar's label goes past its whisker, else before it, else straight after it, over the whisker
    const barEnd = `${left}% + max(${w}%, 10px)`
    let out = null
    if (!inside) {
      if (whisker && whisker.left + whisker.w < 70) out = { left: `calc(${whisker.left + whisker.w}% + 8px)` }
      else if (!whisker && left + w < 70) out = { left: `calc(${barEnd} + 8px)` }
      else if (left > 30) out = { right: `calc(${100 - left}% + 8px)` }
      else out = { left: `calc(${barEnd} + 8px)` }
    }
    return { ...b, left, w, inside, whisker, out, clipL: b.start < range.value.from, clipR: b.end > range.value.to }
  }),
})))

// the limit's band names itself when there's room; its amounts sit beside it
const bandAt = computed(() => {
  if (!band.value) return null
  const left = pct(band.value.start)
  const w = Math.max(pct(band.value.end) - left, 1)
  const end = left + w
  return {
    left, w, inside: (w / 100) * width.value >= 120,
    note: end < 62 ? { left: `calc(${end}% + 10px)` } : { right: `calc(${100 - left}% + 10px)` },
  }
})

const STAGE_NOTE = { submitted: 'Delivered', verifying: 'Verifying', passed: 'Releasing', failed: 'Not yet', disputed: 'In review' }
function note(b) {
  if (b.state === 'paid') return 'Paid'
  if (b.state === 'refunded') return 'Refunded'
  if (b.late) return `${Math.max(1, Math.floor((now.value - ms(b.m.dueAt)) / DAY))}d late`
  if (b.state === 'held') return STAGE_NOTE[b.m.status] || ''
  return 'Not funded'
}
const holdCents = (m) => m.amountCents - (m.releasedCents || 0) + (m.expenseBudgetCents || 0)

function cols(b) {
  const when = (iso) => (iso ? shortDate(iso) : 'No date')
  if (b.state === 'paid') return [['Funded', when(b.m.fundedAt || b.m.authorizedAt)], ['Paid', when(b.m.releasedAt)]]
  if (b.state === 'refunded') return [['Funded', when(b.m.fundedAt || b.m.authorizedAt)], ['Refunded', day(b.end)]]
  if (b.state === 'held') return [['Funded', when(b.m.fundedAt || b.m.authorizedAt)], [b.late ? 'Was due' : 'Due', when(b.m.dueAt)]]
  return [['From', day(b.start)], [b.late ? 'Was due' : 'Due', when(b.m.dueAt)]]
}
function line(b, g) {
  const { m } = b
  const cur = g.r.c.currency
  if (b.state === 'paid') {
    return m.payoutStatus === 'SUCCESS' && m.payoutCents
      ? `${money(m.payoutCents, cur)} reached ${firstName(g.r.c.freelancer?.name || 'the freelancer')}'s PayPal.`
      : `${money(m.releasedCents ?? m.amountCents, cur)} released by the verdict.`
  }
  if (b.state === 'refunded') return m.spendLimitId ? 'Freed back into the spending limit.' : 'Returned to the client.'
  if (b.state === 'held') {
    const h = b.hold
    const until = h ? ` until ${shortDate(h.expiresAt)}` : ''
    if (m.spendLimitId) return `PayPal holds ${money(holdCents(m), cur)} under the spending limit${until}.`
    const renew = h?.renewedAt ? ` Renewed ${shortDate(h.renewedAt)}.` : h?.renewsAt && ms(h.renewsAt) > now.value ? ` Verdikt renews it ${shortDate(h.renewsAt)}.` : ''
    return `PayPal holds ${money(holdCents(m), cur)}${until}.${renew}`
  }
  return g.r.role === 'client'
    ? 'Not funded yet. Fund it and PayPal holds the money until the checks pass.'
    : `Waiting for ${firstName(g.r.c.client?.name || 'the client')} to fund it.`
}
const label = (b, g) => [b.m.title, money(b.m.amountCents, g.r.c.currency), note(b), ...cols(b).map(([k, v]) => `${k} ${v}`), line(b, g)].filter(Boolean).join(', ')

// the tooltip lives on <body> so the scrolling track never clips it
const tip = ref(null)
function show(e, b, g) {
  const r = e.currentTarget.getBoundingClientRect()
  const above = r.bottom + 140 > window.innerHeight
  tip.value = { b, g, x: Math.min(Math.max(r.left, 12), window.innerWidth - 292), y: above ? r.top - 8 : r.bottom + 8, above }
}
const hide = () => { tip.value = null }

let clock = null
onMounted(() => {
  clock = setInterval(() => { now.value = Date.now() }, 60_000)
  window.addEventListener('scroll', hide, true)
})
onBeforeUnmount(() => {
  clearInterval(clock)
  ro?.disconnect()
  window.removeEventListener('scroll', hide, true)
})
</script>

<template>
  <section class="tl" aria-label="Milestones on a timeline">
    <div class="tl__scroll">
      <div ref="body" class="tl__body">
        <div class="tl__grid" aria-hidden="true">
          <span v-for="t in ticks" :key="t.at" class="tl__line" :style="{ left: `${pct(t.at)}%` }" />
          <span class="tl__now" :style="{ left: `${pct(now)}%` }" />
        </div>

        <div class="tl__head" aria-hidden="true">
          <span v-for="t in ticks" :key="t.at" class="tl__tick" :class="{ 'is-past': t.past }" :style="{ left: `${pct(t.at)}%` }">
            <b class="vk-num">{{ t.n }}</b><small>{{ t.cap }}</small>
          </span>
          <span class="tl__today" :style="{ left: `${pct(now)}%` }">Today</span>
        </div>

        <div v-if="bandAt" class="tl__row tl__row--band">
          <RouterLink
            to="/settings" class="tl__band" :style="{ left: `${bandAt.left}%`, width: `${bandAt.w}%` }"
            :aria-label="`Spending limit: ${money(band.l.availableCents, band.l.currency)} of ${money(band.l.capCents, band.l.currency)} left, ${band.l.status === 'closing' ? 'ending' : `ends ${shortDate(band.l.endsAt)}`}`"
          >{{ bandAt.inside ? 'Spending limit' : '' }}</RouterLink>
          <span class="tl__bandnote" :style="bandAt.note" aria-hidden="true">
            <template v-if="!bandAt.inside">Spending limit · </template>
            <span class="vk-num">{{ money(band.l.availableCents, band.l.currency, { whole: true }) }}</span> of
            <span class="vk-num">{{ money(band.l.capCents, band.l.currency, { whole: true }) }}</span> left ·
            {{ band.l.status === 'closing' ? 'ending' : `ends ${shortDate(band.l.endsAt)}` }}
          </span>
        </div>

        <template v-for="g in laid" :key="g.r.c.id">
          <div class="tl__group">
            <RouterLink :to="`/contracts/${g.r.c.id}`" class="tl__gname">
              <VAvatar v-if="g.r.other" :name="g.r.other.name" size="sm" />
              <span class="tl__gtitle">{{ g.r.c.title }}</span>
              <span v-if="g.r.other" class="tl__gwith">with {{ g.r.other.name }}</span>
            </RouterLink>
          </div>
          <div v-for="b in g.bars" :key="b.m.id" class="tl__row">
            <span v-if="b.whisker" class="tl__whisker" :style="{ left: `${b.whisker.left}%`, width: `${b.whisker.w}%` }" aria-hidden="true" />
            <RouterLink
              :to="`/contracts/${g.r.c.id}`"
              class="tl__bar" :class="[`is-${b.state}`, { 'has-label': b.inside, 'is-clip-l': b.clipL, 'is-clip-r': b.clipR, 'is-undated': b.undated }]"
              :style="{ left: `${b.left}%`, width: `${b.w}%` }"
              :aria-label="label(b, g)"
              @mouseenter="show($event, b, g)" @mouseleave="hide" @focus="show($event, b, g)" @blur="hide"
            >
              <template v-if="b.inside">
                <span class="tl__name">{{ b.m.title }}</span>
                <span v-if="note(b)" class="tl__note" :class="{ 'is-late': b.late, 'is-bad': b.m.status === 'failed' }">{{ note(b) }}</span>
                <span class="tl__amt vk-num">{{ money(b.m.amountCents, g.r.c.currency, { whole: true }) }}</span>
              </template>
            </RouterLink>
            <RouterLink
              v-if="b.out" :to="`/contracts/${g.r.c.id}`" class="tl__out" :style="b.out" tabindex="-1" aria-hidden="true"
              @mouseenter="show($event, b, g)" @mouseleave="hide"
            >
              <span class="tl__name">{{ b.m.title }}</span>
              <span class="tl__amt vk-num">{{ money(b.m.amountCents, g.r.c.currency, { whole: true }) }}</span>
              <span v-if="note(b)" class="tl__note" :class="{ 'is-late': b.late, 'is-bad': b.m.status === 'failed' }">{{ note(b) }}</span>
            </RouterLink>
          </div>
        </template>

        <p v-if="!laid.length" class="tl__none">Milestones show here once a contract has its terms.</p>
      </div>
    </div>

    <ul class="tl__legend">
      <li><span class="tl__key is-open" />Not funded yet</li>
      <li><span class="tl__key is-held" />Held by PayPal</li>
      <li><span class="tl__key is-paid" />Paid</li>
      <li><span class="tl__key tl__key--whisker" />Hold good until</li>
      <li><span class="tl__key tl__key--now" />Today</li>
    </ul>

    <Teleport to="body">
      <div
        v-if="tip" class="tl-tip" role="tooltip"
        :style="{ left: `${tip.x}px`, top: `${tip.y}px`, transform: tip.above ? 'translateY(-100%)' : 'none' }"
      >
        <p class="tl-tip__title">
          <span>{{ tip.b.m.title }}</span>
          <span class="vk-num">{{ money(tip.b.m.amountCents, tip.g.r.c.currency) }}</span>
        </p>
        <div class="tl-tip__cols">
          <div v-for="[k, v] in cols(tip.b)" :key="k" class="tl-tip__col">
            <small>{{ k }}</small><b>{{ v }}</b>
          </div>
        </div>
        <p class="tl-tip__line">{{ line(tip.b, tip.g) }}</p>
      </div>
    </Teleport>
  </section>
</template>

<style scoped>
.tl { padding: 8px 20px 16px; border: 1px solid var(--vk-line); border-radius: var(--vk-r-xl); background: var(--vk-surface); }
.tl__scroll { overflow-x: auto; }
.tl__body { position: relative; min-width: 640px; padding-bottom: 6px; }

/* day lines and today's dotted line run the full height */
.tl__grid { position: absolute; inset: 0; pointer-events: none; }
.tl__line { position: absolute; top: 0; bottom: 0; border-left: 1px solid var(--vk-line-subtle); }
.tl__now { position: absolute; top: 30px; bottom: 0; border-left: 1.5px dashed var(--vk-ink); opacity: .6; }

.tl__head { position: relative; height: 52px; }
.tl__tick { position: absolute; top: 8px; display: flex; flex-direction: column; gap: 4px; padding-left: 7px; }
.tl__tick b { font: 400 14px/1 var(--vk-mono); color: var(--vk-ink); }
.tl__tick small { font: 400 10px/1 var(--vk-font); letter-spacing: .06em; text-transform: uppercase; color: var(--vk-faint); }
.tl__tick.is-past b { color: var(--vk-faint); }
.tl__today {
  position: absolute; top: 8px; z-index: 1; transform: translateX(-50%); padding: 5px 9px; border-radius: var(--vk-r-full);
  background: var(--vk-ink); color: var(--vk-on-ink); font: 400 11px/1 var(--vk-font); white-space: nowrap;
}

.tl__row { position: relative; height: 42px; }
.tl__row--band { height: 38px; }
.tl__group { position: relative; display: flex; align-items: flex-end; height: 42px; padding-bottom: 6px; }
.tl__gname { display: inline-flex; align-items: center; gap: 8px; min-width: 0; max-width: 100%; padding-right: 8px; background: var(--vk-surface); color: var(--vk-ink); text-decoration: none; }
.tl__gtitle { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font: 400 14px/18px var(--vk-font); }
.tl__gwith { flex: none; font: var(--vk-type-small); color: var(--vk-faint); }
.tl__gname:hover .tl__gtitle { text-decoration: underline; text-underline-offset: 3px; text-decoration-color: var(--vk-line-strong); }

/* bars: the colour is the money's state */
.tl__bar {
  position: absolute; top: 5px; height: 32px; min-width: 10px; display: flex; align-items: center; gap: 10px; padding: 0;
  border: 1px solid transparent; border-radius: var(--vk-r-full); text-decoration: none; overflow: hidden;
  font: 400 13px/1 var(--vk-font); transition: box-shadow var(--vk-dur-2);
}
.tl__bar.has-label { padding: 0 12px; }
.tl__bar:hover, .tl__bar:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--vk-focus); }
.tl__bar.is-open { border: 1px dashed var(--vk-line-strong); background: var(--vk-surface); color: var(--vk-muted); }
.tl__bar.is-held { border-color: var(--vk-accent-line); background: var(--vk-accent-soft); color: var(--vk-accent-text); }
.tl__bar.is-paid { border-color: color-mix(in srgb, var(--vk-ok) 40%, transparent); background: var(--vk-ok-soft); color: var(--vk-ok-ink); }
.tl__bar.is-refunded { border-color: var(--vk-line); background: var(--vk-surface-2); color: var(--vk-faint); }
.tl__bar.is-clip-l { border-left: 0; border-top-left-radius: 0; border-bottom-left-radius: 0; }
.tl__bar.is-clip-r { border-right: 0; border-top-right-radius: 0; border-bottom-right-radius: 0; }
.tl__bar.is-undated { -webkit-mask-image: linear-gradient(90deg, #000 75%, transparent); mask-image: linear-gradient(90deg, #000 75%, transparent); }
.tl__name { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tl__note { flex: none; font-size: 12px; }
.tl__amt { flex: none; font-size: 12px; }
.tl__note.is-late { color: var(--vk-warn-ink); }
.tl__note.is-bad { color: var(--vk-danger-ink); }

/* a short bar keeps its label beside it, on a patch of surface so day lines and whiskers pass behind */
.tl__out {
  position: absolute; top: 9px; z-index: 1; height: 24px; display: flex; align-items: center; gap: 8px; max-width: 46%; padding: 0 6px;
  border-radius: var(--vk-r-xs); background: var(--vk-surface);
  font: 400 13px/1 var(--vk-font); color: var(--vk-ink); text-decoration: none; white-space: nowrap;
}
.tl__out .tl__name { flex: 0 1 auto; }
.tl__out .tl__amt, .tl__out .tl__note:not(.is-late):not(.is-bad) { color: var(--vk-muted); }

/* from the end of the work to the day PayPal's hold lapses */
.tl__whisker { position: absolute; top: 50%; border-top: 2px dotted color-mix(in srgb, var(--vk-accent) 55%, transparent); }
.tl__whisker::after { content: ''; position: absolute; right: 0; top: -7px; height: 12px; border-right: 2px solid color-mix(in srgb, var(--vk-accent) 55%, transparent); }

.tl__band {
  position: absolute; top: 6px; height: 26px; display: flex; align-items: center; gap: 10px; padding: 0 12px; overflow: hidden;
  border: 1px dashed var(--vk-accent); border-radius: var(--vk-r-full); color: var(--vk-accent-text); text-decoration: none;
  font: 400 12px/1 var(--vk-font); white-space: nowrap;
}
.tl__band:hover, .tl__band:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--vk-focus); }
.tl__bandnote { position: absolute; top: 6px; height: 26px; display: flex; align-items: center; gap: 5px; font: var(--vk-type-small); color: var(--vk-muted); white-space: nowrap; }

.tl__none { position: relative; margin: 0; padding: 32px 0 26px; text-align: center; font: var(--vk-type-dense); color: var(--vk-muted); }

.tl__legend { display: flex; flex-wrap: wrap; gap: 8px 20px; margin: 12px 0 0; padding: 14px 0 0; border-top: 1px solid var(--vk-line-subtle); list-style: none; font: var(--vk-type-small); color: var(--vk-muted); }
.tl__legend li { display: inline-flex; align-items: center; gap: 8px; }
.tl__key { width: 22px; height: 12px; border: 1px solid transparent; border-radius: var(--vk-r-full); }
.tl__key.is-open { border: 1px dashed var(--vk-line-strong); }
.tl__key.is-held { border-color: var(--vk-accent-line); background: var(--vk-accent-soft); }
.tl__key.is-paid { border-color: color-mix(in srgb, var(--vk-ok) 40%, transparent); background: var(--vk-ok-soft); }
.tl__key--whisker { height: 0; border: 0; border-radius: 0; border-top: 2px dotted color-mix(in srgb, var(--vk-accent) 55%, transparent); }
.tl__key--now { width: 0; height: 14px; border: 0; border-radius: 0; border-left: 1.5px dashed var(--vk-ink); }

/* the tooltip: ink, two dates side by side, then where the money is */
.tl-tip {
  position: fixed; z-index: var(--vk-z-modal); width: 280px; padding: 12px 14px 13px; border-radius: var(--vk-r-md);
  background: var(--vk-ink); color: var(--vk-on-ink); box-shadow: var(--vk-elev-pop); pointer-events: none;
}
.tl-tip__title { display: flex; justify-content: space-between; gap: 12px; margin: 0 0 10px; font: 400 13px/18px var(--vk-font); }
.tl-tip__title .vk-num { flex: none; font-size: 12px; }
.tl-tip__cols { display: flex; }
.tl-tip__col { flex: 1; display: flex; flex-direction: column; gap: 5px; }
.tl-tip__col + .tl-tip__col { padding-left: 12px; border-left: 1px solid color-mix(in srgb, var(--vk-on-ink) 22%, transparent); }
.tl-tip__col small { font: 400 10px/1 var(--vk-font); letter-spacing: .06em; text-transform: uppercase; color: color-mix(in srgb, var(--vk-on-ink) 72%, transparent); }
.tl-tip__col b { font: 400 15px/1 var(--vk-font); color: inherit; }
.tl-tip__line { margin: 11px 0 0; padding-top: 10px; border-top: 1px solid color-mix(in srgb, var(--vk-on-ink) 22%, transparent); font: 400 12px/17px var(--vk-font); color: color-mix(in srgb, var(--vk-on-ink) 86%, transparent); }
</style>
