<!--
  PrecedentLine — under a check Claude judged: how the most similar checks on other contracts were decided, and
  whether this one went the same way. Live, the cases come from Elastic (meaning and keywords, reranked, one per
  contract, redacted); in the demo, from a fixed sample history. The line says the stance in words, a departure
  says why without a click, and the panel lists the cases and how they were found (live: the recorded search;
  the demo: the live pipeline's settings, labelled as such).
  It renders nothing for a probe-decided row, an older verdict that never looked, or with precedent off.
-->
<script setup>
import { ref, computed, watch, useId } from 'vue'
import { Check, X, ChevronDown } from 'lucide-vue-next'
import VCopy from './ui/VCopy.vue'
import { KIND } from '@/domain/milestone'
import { timeAgo } from '@/domain/format'
import { stanceOf, decidedBy, bandLabel, firstSentence } from '@/domain/precedent'

const props = defineProps({
  criterionId: { type: String, required: true },
  // the result's precedent evidence: v2 { v, stance, departsBecause, sample?, items } or a legacy { items }; null when none
  item: { type: Object, default: null },
  passed: { type: Boolean, default: false },
  explanation: { type: String, default: '' },
  layer: { type: String, default: null },
  // the verdict's report.precedent: { status, asked, cases, corpus, embed, reranker, floor, asOf, ms, digest }
  meta: { type: Object, default: null },
  asked: { type: Boolean, default: false },     // this check's precedent was searched for (it went to Claude)
  defaultOpen: { type: Boolean, default: false },
})

const cases = computed(() => (Array.isArray(props.item?.items) ? props.item.items : []))
const STANCES = ['follows', 'split', 'departs']

// follows · split · departs from the cases (a v2 item says its stance; a legacy one is counted here, by the same
// rule the server uses), none when the search found nothing, unavailable when it couldn't run; else null
const s = computed(() => {
  if (cases.value.length) {
    const counted = stanceOf(cases.value, props.passed)
    return props.item.v && STANCES.includes(props.item.stance) ? { ...counted, stance: props.item.stance } : counted
  }
  const status = props.meta?.status
  if (['ok', 'sample'].includes(status) && props.asked) return { stance: 'none' }
  if (['timeout', 'error', 'degraded'].includes(status) && props.layer === 'model') return { stance: 'unavailable' }
  return null
})

// a departure always says why: the verifier's own reason, else the first sentence of its explanation
const why = computed(() => (s.value?.stance === 'departs' ? props.item?.departsBecause || firstSentence(props.explanation) : ''))

// unique per instance: the same check can show in the current report and in an earlier attempt's
const panelId = `prec-${props.criterionId}-${useId()}`
const open = ref(props.defaultOpen)
watch(() => props.defaultOpen, (v) => { open.value = v })

const sample = computed(() => !!props.item?.sample || props.meta?.status === 'sample')
// what a live search uses, as server/src/lib/precedent.js sets it by default (EMBED, RERANKER, FLOOR): shown on a
// sample so the demo says how live verdicts find their cases. A live verdict shows its own recorded values instead
const LIVE_PIPELINE = { embed: '.jina-embeddings-v5-text-small', reranker: '.jina-reranker-v3', floor: 0.22 }
const corpus = computed(() => (Number.isFinite(props.meta?.corpus) ? props.meta.corpus.toLocaleString('en-US') : null))

/** How long ago a case was decided, in the words people use: '3d ago', '3 weeks ago', '5 months ago'. */
function ago(iso) {
  const days = (Date.now() - Date.parse(iso)) / 864e5
  if (!Number.isFinite(days)) return ''
  if (days < 7) return timeAgo(iso)
  if (days < 60) {
    const w = Math.floor(days / 7)
    return `${w} week${w > 1 ? 's' : ''} ago`
  }
  if (days < 365) return `${Math.round(days / 30.44)} months ago`
  const y = Math.floor(days / 365)
  return `${y} year${y > 1 ? 's' : ''} ago`
}

/**
 * A case's meta row: its kind, how it was finally decided, a pass on a later try, when, and how close it is.
 * A legacy case (no v) has none of these: it shows its statement and reason only.
 */
function metaOf(p) {
  if (!props.item?.v) return []
  return [
    KIND[p.kind]?.label,
    decidedBy(p),
    // a second review already says how it ended; 'try 2' is a second delivery
    p.met && p.metFirst === false && !p.appeal ? 'met on try 2' : '',
    p.at ? ago(p.at) : '',
    p.band ? bandLabel(p.band) : '',
  ].filter(Boolean)
}

const searched = computed(() => {
  const at = Date.parse(props.meta?.asOf)
  if (!Number.isFinite(at)) return null
  const when = new Date(at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  return Number.isFinite(props.meta?.ms) ? `${when} · ${props.meta.ms} ms` : when
})
</script>

<template>
  <div v-if="s" class="pl" :class="`is-${s.stance}`">
    <template v-if="cases.length">
      <button type="button" class="pl__line" :aria-expanded="open ? 'true' : 'false'" :aria-controls="panelId" @click="open = !open">
        <span v-if="s.stance === 'follows'">In line with <span class="vk-num">{{ s.same }}</span> of <span class="vk-num">{{ s.n }}</span> similar checks on other contracts</span>
        <span v-else-if="s.stance === 'split'">Similar checks went both ways: <span class="vk-num">{{ s.met }}</span> met, <span class="vk-num">{{ s.notMet }}</span> not met</span>
        <span v-else>Decided differently from <span class="vk-num">{{ s.n - s.same }}</span> of <span class="vk-num">{{ s.n }}</span> similar checks on other contracts</span>
        <ChevronDown :size="13" :stroke-width="1.9" aria-hidden="true" :class="{ flip: open }" />
      </button>
      <p v-if="why" class="pl__why">Why: {{ why }}</p>

      <!-- v-show, not v-if: the report's row TransitionGroup never sees it come and go -->
      <div v-show="open" :id="panelId" class="pl__panel">
        <p class="vk-eyebrow">Similar checks on other contracts</p>
        <ul class="pl__cases" aria-label="Similar checks on other contracts">
          <li v-for="(p, j) in cases" :key="p.id || j" :class="p.met ? 'is-met' : 'is-not'">
            <span class="pl__mark" aria-hidden="true"><Check v-if="p.met" :size="11" :stroke-width="2.6" /><X v-else :size="11" :stroke-width="2.6" /></span>
            <div class="pl__case">
              <p class="pl__text"><span class="vk-sr-only">{{ p.met ? 'Met' : 'Not met' }}</span> {{ p.statement }}<span v-if="p.reason" class="pl__reason"> — {{ p.reason }}</span></p>
              <p v-if="metaOf(p).length" class="pl__meta" :title="Number.isFinite(p.score) ? `raw relevance ${p.score}` : null">
                <!-- the trailing space keeps the words apart for screen readers; the flex gap draws the spacing -->
                <span v-for="(x, k) in metaOf(p)" :key="k">{{ x }}{{ k < metaOf(p).length - 1 ? ' · ' : '' }}</span>
              </p>
            </div>
          </li>
        </ul>
        <p v-if="sample" class="pl__foot">Sample precedent from the demo’s sample history. Live verdicts search real past checks with Elastic.</p>
        <p v-else class="pl__foot">Found with Elastic among <span v-if="corpus" class="vk-num">{{ corpus }}</span>{{ corpus ? ' ' : '' }}past checks, by meaning and keywords, reranked, one per contract. Each contract’s own names, links, quotes and amounts are removed. This delivery’s evidence decides.</p>
        <!-- the demo searched nothing: the live pipeline's fixed settings, labelled as such, without a time or a snapshot -->
        <details v-if="sample" class="pl__how">
          <summary>How live verdicts find these</summary>
          <dl class="pl__dl">
            <dt>Embeddings</dt><dd>{{ LIVE_PIPELINE.embed }}</dd>
            <dt>Keywords</dt><dd>BM25, fused with RRF</dd>
            <dt>Reranker</dt><dd>{{ LIVE_PIPELINE.reranker }}</dd>
            <dt>Floor</dt><dd>{{ LIVE_PIPELINE.floor }} (calibrated)</dd>
            <dt>Cases</dt><dd>one per contract, never this one’s</dd>
            <dt>Receipt</dt><dd>the cases shown are hashed into it</dd>
          </dl>
        </details>
        <details v-else-if="meta?.embed" class="pl__how">
          <summary>How these were found</summary>
          <dl class="pl__dl">
            <dt>Embeddings</dt><dd>{{ meta.embed }}</dd>
            <dt>Keywords</dt><dd>BM25, fused with RRF</dd>
            <dt>Reranker</dt><dd>{{ meta.reranker }}</dd>
            <template v-if="meta.floor != null"><dt>Floor</dt><dd>{{ meta.floor }}</dd></template>
            <template v-if="searched"><dt>Searched</dt><dd>{{ searched }}</dd></template>
            <!-- the snapshot covers the cases this verdict's model was shown: a reused answer's came from an earlier one -->
            <template v-if="meta.digest && layer === 'model'">
              <dt>Snapshot</dt>
              <dd><VCopy :value="meta.digest" label="Copy the precedent snapshot (sha-256 of each case shown to the verifier: its text, outcome and score)">{{ meta.digest.slice(0, 12) }}</VCopy></dd>
            </template>
          </dl>
        </details>
      </div>
    </template>

    <p v-else-if="s.stance === 'none'" class="pl__quiet">No similar checks on other contracts yet</p>
    <p v-else class="pl__quiet">Couldn’t look up similar checks this time. Judged on this delivery’s evidence alone.</p>
  </div>
</template>

<style scoped>
.pl { margin-top: 4px; min-width: 0; }
/* inline-block, not flex: when the line wraps on a phone, the chevron follows its last word */
.pl__line {
  display: inline-block; padding: 3px 0 4px; border: 0; background: none;
  cursor: pointer; text-align: left; font: var(--vk-type-small); color: var(--vk-muted);
}
.pl__line:hover { color: var(--vk-ink); }
.is-departs .pl__line { color: var(--vk-warn-ink); }
.is-departs .pl__line:hover { text-decoration: underline; text-underline-offset: 3px; }
.pl__line svg { display: inline-block; margin-left: 4px; vertical-align: -2px; transition: transform var(--vk-dur-2); }
.pl__line svg.flip { transform: rotate(180deg); }
.pl__why { margin: 2px 0 0; font: var(--vk-type-dense); color: var(--vk-ink-2); }
.pl__quiet { margin: 0; padding: 3px 0; font: var(--vk-type-small); color: var(--vk-faint); }

/* the cases */
.pl__panel { max-width: 640px; margin-top: 8px; padding: 10px 12px; border: 1px solid var(--vk-line); border-radius: var(--vk-r-sm); background: var(--vk-surface); }
.pl__cases { margin: 8px 0 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 10px; }
.pl__cases li { position: relative; display: grid; grid-template-columns: 16px minmax(0, 1fr); column-gap: 8px; }
.pl__mark { display: grid; place-items: center; width: 16px; height: 16px; margin-top: 1px; border-radius: 50%; border: 1px solid var(--vk-line); }
.is-met .pl__mark { color: var(--vk-ok-ink); border-color: color-mix(in srgb, var(--vk-ok) 35%, transparent); }
.is-not .pl__mark { color: var(--vk-danger-ink); border-color: color-mix(in srgb, var(--vk-danger) 35%, transparent); }
.pl__case { min-width: 0; }
.pl__text { margin: 0; font: var(--vk-type-small); color: var(--vk-ink); }
.pl__reason { color: var(--vk-faint); }
.pl__meta { display: flex; flex-wrap: wrap; gap: 0 5px; margin: 3px 0 0; font: 400 12px/17px var(--vk-mono); color: var(--vk-faint); }
/* each part wraps whole, its separator with it (the parts are a few words each) */
.pl__meta span { white-space: nowrap; }
.pl__foot { margin: 12px 0 0; font: var(--vk-type-small); color: var(--vk-faint); }

/* how the cases were found: live, the recorded values; a sample, the live pipeline's settings */
.pl__how { margin-top: 8px; }
.pl__how summary { width: max-content; font: var(--vk-type-small); color: var(--vk-muted); cursor: pointer; }
.pl__how summary:hover { color: var(--vk-ink); }
.pl__dl { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 4px 14px; margin: 8px 0 0; font: 400 12px/18px var(--vk-mono); }
.pl__dl dt { color: var(--vk-faint); }
.pl__dl dd { min-width: 0; margin: 0; color: var(--vk-ink-2); }

@media (max-width: 560px) {
  .pl__panel { max-width: none; }
  .pl__why, .pl__text, .pl__meta, .pl__dl dd { overflow-wrap: anywhere; }
  /* the panel's text column is narrow here: a long part ("overturned on second review") wraps inside itself */
  .pl__meta span { white-space: normal; }
}
</style>
