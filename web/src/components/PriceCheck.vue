<!--
  PriceCheck — a fair price for the work and everything the project costs online, from current public
  prices (Claude searched the web; every source shown is a page the search returned). The plan's totals,
  the suggested expense budget and Verdikt's fee are computed by the server, not by the model.
-->
<script setup>
import { computed } from 'vue'
import { ExternalLink } from 'lucide-vue-next'
import { money, hostOf } from '@/domain/format'

const props = defineProps({
  result: { type: Object, required: true },
  budget: { type: Object, default: null },   // { minCents, maxCents } the poster typed, to compare
})
defineEmits(['use-range', 'use-expenses'])

const $ = (c, o) => money(c, props.result.currency || 'USD', o)
const w = computed(() => props.result.work)
const plan = computed(() => props.result.plan)
// the scale runs a little past the range so the ends and the typed budget fit
const lo = computed(() => Math.min(w.value.lowCents, props.budget?.minCents || Infinity) * 0.85)
const hi = computed(() => Math.max(w.value.highCents, props.budget?.maxCents || 0) * 1.1)
const at = (c) => `${Math.max(0, Math.min(100, ((c - lo.value) / (hi.value - lo.value)) * 100))}%`
const period = (c) => (c.period === 'once' ? '' : c.period === 'month' ? '/mo' : '/yr')
const verdict = computed(() => {
  const b = props.budget
  if (!b?.maxCents && !b?.minCents) return null
  if (b.maxCents && b.maxCents < w.value.lowCents) return { tone: 'warn', text: `Your budget tops out below the fair range — expect fewer or weaker applications.` }
  if (b.minCents && b.minCents > w.value.highCents) return { tone: 'neutral', text: `Your budget starts above the fair range — you could offer less.` }
  return { tone: 'ok', text: 'Your budget overlaps the fair range.' }
})
</script>

<template>
  <section class="pc">
    <div class="pc__top">
      <div>
        <p class="pc__eyebrow vk-eyebrow">Fair price for the work</p>
        <p class="pc__range vk-num">{{ $(w.lowCents, { whole: true }) }}–{{ $(w.highCents, { whole: true }) }}</p>
        <p class="pc__typ">typically <b class="vk-num">{{ $(w.typicalCents, { whole: true }) }}</b> · about {{ result.days }} working day{{ result.days === 1 ? '' : 's' }}</p>
      </div>
      <slot name="action" />
    </div>
    <div class="pc__scale" role="img" :aria-label="`Fair range ${$(w.lowCents)} to ${$(w.highCents)}, typically ${$(w.typicalCents)}`">
      <span class="pc__band" :style="{ left: at(w.lowCents), width: `calc(${at(w.highCents)} - ${at(w.lowCents)})` }" />
      <span class="pc__tick" :style="{ left: at(w.typicalCents) }" />
      <span v-if="budget?.minCents || budget?.maxCents" class="pc__budget" :style="{ left: budget.minCents ? at(budget.minCents) : '0%', width: `calc(${budget.maxCents ? at(budget.maxCents) : '100%'} - ${budget.minCents ? at(budget.minCents) : '0%'})` }" :title="'Your budget'" />
    </div>
    <p v-if="verdict" class="pc__verdict" :class="`is-${verdict.tone}`">{{ verdict.text }}</p>
    <p class="pc__basis">{{ w.basis }}<a v-if="w.source" :href="w.source" target="_blank" rel="noopener noreferrer" class="pc__src">{{ hostOf(w.source) }}<ExternalLink :size="11" /></a></p>
    <p v-if="result.milestones?.length > 1" class="pc__split">
      <span class="vk-faint">Pay it in {{ result.milestones.length }}:</span>
      <span v-for="m in result.milestones" :key="m.title" class="pc__part">{{ m.title }} <span class="vk-num">{{ m.sharePct }}%</span></span>
    </p>

    <div class="pc__costs">
      <p class="pc__h">What it costs online</p>
      <ul v-if="result.costs.length">
        <li v-for="c in result.costs" :key="c.item" :class="{ 'is-optional': c.optional }">
          <span class="pc__item">{{ c.item }}<span v-if="c.optional" class="pc__opt">optional</span></span>
          <a v-if="c.source" :href="c.source" target="_blank" rel="noopener noreferrer" class="pc__src">{{ hostOf(c.source) }}<ExternalLink :size="11" /></a>
          <span class="pc__amt vk-num">{{ c.cents ? `${$(c.cents)}${period(c)}` : 'free' }}</span>
        </li>
      </ul>
      <p v-else class="vk-faint pc__none">Nothing beyond the work itself.</p>
    </div>

    <dl class="pc__plan">
      <div><dt>Work</dt><dd class="vk-num">{{ $(plan.workCents) }}</dd></div>
      <div><dt>Bought during the build</dt><dd class="vk-num">{{ $(plan.upfrontCents) }}</dd></div>
      <div><dt>After launch</dt><dd class="vk-num">{{ $(plan.monthlyCents) }}/mo · {{ $(plan.yearlyCents) }}/yr</dd></div>
      <div><dt>Verdikt fee</dt><dd>{{ plan.feePercent }}% · <span class="vk-num">{{ $(plan.feeCents) }}</span>, from the freelancer's payout — you pay nothing extra</dd></div>
    </dl>
    <div class="pc__foot">
      <p class="pc__exp">
        <template v-if="plan.expenseBudgetCents">Suggested expense budget: <b class="vk-num">{{ $(plan.expenseBudgetCents) }}</b> for {{ plan.covers.join(', ') }} — held with the work, paid only against receipts.</template>
        <template v-else>No expense budget needed.</template>
      </p>
      <slot name="foot" />
    </div>
    <p v-if="result.notes" class="pc__notes">{{ result.notes }}</p>
    <p class="pc__meta vk-faint">
      {{ result.demo ? 'Sample figures in demo mode — the live app searches current prices.' : `Claude searched ${result.searches || 0} time${result.searches === 1 ? '' : 's'} and read ${result.searched || 0} pages; only those pages are cited.` }}
      <template v-if="result.cached"> · reused, no new tokens</template><template v-else-if="result.tokens"> · {{ Math.round(result.tokens / 1000) }}k tokens</template>
    </p>
  </section>
</template>

<style scoped>
.pc { display: flex; flex-direction: column; gap: 12px; padding: 16px 18px; border: 1px solid var(--vk-line); border-radius: var(--vk-r-md); background: var(--vk-surface); }
.pc__top { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.pc__eyebrow { margin: 0; }
.pc__range { margin: 4px 0 0; font: var(--vk-num-28); letter-spacing: -.02em; color: var(--vk-ink); }
.pc__typ { margin: 2px 0 0; font: var(--vk-type-small); color: var(--vk-muted); }
.pc__typ b { font-weight: 400; color: var(--vk-ink); }
.pc__scale { position: relative; height: 10px; border-radius: var(--vk-r-full); background: var(--vk-surface-2); border: 1px solid var(--vk-line); }
.pc__band { position: absolute; top: 2px; bottom: 2px; border-radius: var(--vk-r-full); background: var(--vk-accent-soft); border: 1px solid var(--vk-accent-line); }
.pc__tick { position: absolute; top: -3px; width: 2px; height: 14px; margin-left: -1px; border-radius: 1px; background: var(--vk-accent); }
.pc__budget { position: absolute; bottom: -7px; height: 3px; border-radius: 2px; background: var(--vk-ink-2); min-width: 3px; }
.pc__verdict { margin: 0; font: var(--vk-type-small); color: var(--vk-ink-2); }
.pc__verdict.is-warn { color: var(--vk-warn-ink); }
.pc__basis { margin: 0; font: var(--vk-type-small); color: var(--vk-ink-2); }
.pc__src { display: inline-flex; align-items: center; gap: 3px; margin-left: 6px; font: var(--vk-type-small); color: var(--vk-accent-text); text-decoration: none; white-space: nowrap; }
.pc__src:hover { text-decoration: underline; text-underline-offset: 3px; }
.pc__split { display: flex; flex-wrap: wrap; gap: 6px 12px; margin: 0; font: var(--vk-type-small); color: var(--vk-ink-2); }
.pc__part .vk-num { color: var(--vk-muted); }
.pc__h { margin: 0 0 6px; font: var(--vk-type-dense); color: var(--vk-ink); }
.pc__costs ul { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; }
.pc__costs li { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: 10px; align-items: baseline; padding: 7px 0; border-top: 1px solid var(--vk-line-subtle); font: var(--vk-type-small); color: var(--vk-ink-2); }
.pc__costs li.is-optional { color: var(--vk-muted); }
.pc__opt { margin-left: 6px; padding: 0 6px; border: 1px solid var(--vk-line); border-radius: var(--vk-r-full); font-size: 11px; color: var(--vk-muted); }
.pc__amt { color: var(--vk-ink); white-space: nowrap; }
.pc__none { margin: 0; font: var(--vk-type-small); }
.pc__plan { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 18px; margin: 0; padding: 12px 0 0; border-top: 1px solid var(--vk-line); }
.pc__plan div { min-width: 0; }
.pc__plan dt { font: var(--vk-type-small); color: var(--vk-muted); }
.pc__plan dd { margin: 2px 0 0; font: var(--vk-type-small); color: var(--vk-ink); }
.pc__foot { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
.pc__exp { margin: 0; font: var(--vk-type-small); color: var(--vk-ink-2); }
.pc__exp b { font-weight: 400; color: var(--vk-ink); }
.pc__notes { margin: 0; font: var(--vk-type-small); color: var(--vk-ink-2); }
.pc__meta { margin: 0; font-size: 12px; }
@media (max-width: 560px) { .pc__plan { grid-template-columns: 1fr; } .pc__costs li { grid-template-columns: minmax(0, 1fr) auto; } .pc__costs li .pc__src { display: none; } }
</style>
