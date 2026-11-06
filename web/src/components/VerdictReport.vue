<!--
  VerdictReport — what the agent checked, live while it runs and as a report after.
  Both parties see the same report: each signed criterion, pass or not, what decided it (a deterministic
  probe, OCR, Claude, or an unchanged earlier answer), the probe results, and the evidence.
  Failed checks come first: they are the only thing anyone needs to act on.
-->
<script setup>
import { ref, computed } from 'vue'
import { Check, X, Minus, Globe, Github, Circle, ShieldAlert } from 'lucide-vue-next'
import VPill from './ui/VPill.vue'
import VModal from './ui/VModal.vue'
import VCopy from './ui/VCopy.vue'
import ScoreRing from './ScoreRing.vue'
import { timeAgo, hostOf } from '@/domain/format'
import { LAYER, STAGE, probeLabel, tokensLabel } from '@/domain/probes'

const props = defineProps({
  criteria: { type: Array, required: true },
  submission: { type: Object, required: true },
  progress: { type: Object, default: null },     // { [criterionId]: pending | running | pass | fail, '@': { stage, by } } while verifying
})

const verdict = computed(() => props.submission.verdict)
const live = computed(() => !verdict.value && !!props.progress)
const byId = computed(() => Object.fromEntries(props.criteria.map((c) => [c.id, c])))
const meta = computed(() => props.progress?.['@'] || {})

const rows = computed(() => {
  if (verdict.value) {
    return [...verdict.value.results]
      .map((r) => ({ ...r, criterion: byId.value[r.criterionId] }))
      .filter((r) => r.criterion)
      .sort((a, b) => Number(a.passed) - Number(b.passed) || a.criterion.position - b.criterion.position)
  }
  return props.criteria.map((c) => ({ criterion: c, state: props.progress?.[c.id] || 'pending', layer: meta.value.by?.[c.id] || null }))
})

const passed = computed(() => verdict.value?.results.filter((r) => r.passed).length ?? 0)
const total = computed(() => props.criteria.length)
const checked = computed(() => props.criteria.filter((c) => ['pass', 'fail'].includes(props.progress?.[c.id])).length)
const pct = computed(() => (verdict.value ? (passed.value / Math.max(1, verdict.value.results.length)) * 100 : (checked.value / Math.max(1, total.value)) * 100))

// how the verdict was reached: checks per layer, as a strip and a sentence
const engine = computed(() => verdict.value?.engine || null)
const strip = computed(() => {
  const d = engine.value?.decided
  if (!d) return []
  const words = { probe: 'by probes', ocr: 'by OCR', reused: 'unchanged', model: 'by Claude' }
  return ['probe', 'ocr', 'reused', 'model'].filter((k) => d[k]).map((k) => ({ key: k, n: d[k], label: `${d[k]} ${words[k]}` }))
})
const deterministic = computed(() => (engine.value ? (engine.value.decided.probe || 0) + (engine.value.decided.ocr || 0) : 0))

const zoom = ref(null)
</script>

<template>
  <div class="report">
    <!-- head: score + summary -->
    <div class="report__head">
      <ScoreRing
        :value="pct"
        :pass="verdict ? verdict.outcome === 'pass' : false"
        :pending="!verdict"
        :label="verdict ? `${passed}/${verdict.results.length}` : `${checked}/${total}`"
        :size="84"
      />
      <div class="report__summary">
        <div class="report__pills">
          <VPill v-if="live" tone="warn" live>Checking · {{ checked }} of {{ total }}</VPill>
          <VPill v-else-if="verdict?.outcome === 'pass'" tone="ok">Passed</VPill>
          <VPill v-else-if="verdict?.outcome === 'fail'" tone="danger">Not yet</VPill>
          <VPill v-else tone="neutral">Queued</VPill>
          <span class="vk-faint report__attempt">Attempt {{ submission.attempt }} · {{ timeAgo(submission.createdAt) }}</span>
        </div>
        <p class="report__text">
          {{ verdict ? verdict.summary : 'Probes run first: layout, exact copy, status, console, accessibility, the repository. Claude only judges what they can’t settle.' }}
        </p>
        <p v-if="live && meta.stage" class="report__stage"><span class="vk-spin" /> {{ STAGE[meta.stage] || 'Checking' }}</p>
        <div class="report__links">
          <a v-if="submission.liveUrl" :href="submission.liveUrl" target="_blank" rel="noopener"><Globe :size="13" :stroke-width="1.9" /> {{ hostOf(submission.liveUrl) }}</a>
          <a v-if="submission.repoUrl" :href="submission.repoUrl" target="_blank" rel="noopener"><Github :size="13" :stroke-width="1.9" /> {{ hostOf(submission.repoUrl) }}{{ submission.repoUrl.replace(/^https?:\/\/[^/]+/, '') }}</a>
          <span v-if="verdict" class="vk-faint">Confidence <span class="vk-num">{{ Math.round(verdict.confidence * 100) }}%</span></span>
        </div>
      </div>
    </div>

    <!-- how it was decided -->
    <div v-if="engine" class="engine">
      <div class="engine__strip" role="img" :aria-label="strip.map((s) => s.label).join(', ')">
        <span v-for="s in strip" :key="s.key" class="engine__seg" :class="`is-${s.key}`" :style="{ flex: s.n }" />
      </div>
      <p class="engine__text">
        <span v-for="(s, i) in strip" :key="s.key"><i class="engine__dot" :class="`is-${s.key}`" />{{ s.label }}<template v-if="i < strip.length - 1"> · </template></span>
      </p>
      <p class="engine__meta vk-faint">
        {{ deterministic }} of {{ verdict.results.length }} decided without a model ·
        <span class="vk-num">{{ tokensLabel(engine.tokens) }}</span> ·
        <span class="vk-num">{{ ((engine.ms?.total || 0) / 1000).toFixed(1) }} s</span> ·
        <span class="vk-num">{{ engine.probes?.run || 0 }}</span> probes
        <span v-if="engine.receipt" class="engine__receipt">· receipt <VCopy :value="engine.receipt" label="Copy the verdict receipt (sha-256 of the specs, the evidence and the results)">{{ engine.receipt.slice(0, 12) }}</VCopy></span>
      </p>
    </div>

    <!-- integrity: the delivery tried to talk to the verifier -->
    <section v-if="verdict?.integrity" class="vk-card vk-card--pill vk-card--tone-danger integrity" role="alert">
      <div class="integrity__body">
        <p class="integrity__title"><ShieldAlert :size="16" :stroke-width="1.9" /> The delivery tried to influence the verifier</p>
        <p class="integrity__sub">Found in {{ verdict.integrity.sources.join(', ') }}. It was read as evidence, not followed, and auto-release is off until it's removed.</p>
        <blockquote v-for="q in verdict.integrity.quotes" :key="q" class="integrity__quote">“{{ q }}”</blockquote>
      </div>
    </section>

    <!-- rows -->
    <TransitionGroup tag="ol" name="vk-list" class="report__rows">
      <li v-for="r in rows" :key="r.criterion.id" class="report__row" :class="verdict ? (r.passed ? 'is-pass' : 'is-fail') : `is-${r.state}`">
        <span class="report__icon" aria-hidden="true">
          <Check v-if="verdict ? r.passed : r.state === 'pass'" :size="13" :stroke-width="2.6" />
          <X v-else-if="verdict ? !r.passed : r.state === 'fail'" :size="13" :stroke-width="2.6" />
          <span v-else-if="r.state === 'running'" class="vk-spin" />
          <Circle v-else :size="10" :stroke-width="2" />
        </span>
        <div class="report__body">
          <div class="report__line">
            <p class="report__statement">{{ r.criterion.statement }}</p>
            <span v-if="r.layer" class="by" :class="`by--${r.layer}`" :title="LAYER[r.layer]?.long">{{ LAYER[r.layer]?.short || r.layer }}</span>
          </div>
          <p v-if="verdict && !r.passed" class="report__why">{{ r.explanation }}</p>
          <p v-else-if="r.state === 'running'" class="report__doing vk-faint">{{ r.criterion.method || 'Checking…' }}</p>

          <!-- the probes, measured -->
          <!-- a single decisive probe is already the explanation above -->
          <ul v-if="verdict && !r.passed && r.probes?.length && (r.probes.length > 1 || !['probe', 'ocr'].includes(r.layer))" class="probes">
            <li v-for="(p, k) in r.probes" :key="k" :class="`is-${p.status}`">
              <span class="probes__mark" aria-hidden="true"><Check v-if="p.status === 'pass'" :size="11" :stroke-width="2.6" /><X v-else-if="p.status === 'fail'" :size="11" :stroke-width="2.6" /><Minus v-else :size="11" :stroke-width="2.6" /></span>
              <span class="probes__label">{{ probeLabel(p) }}<span v-if="p.via === 'ocr'" class="probes__via"> · OCR</span></span>
              <span class="probes__obs">{{ p.observed }}</span>
            </li>
          </ul>

          <div v-if="verdict && r.evidence?.length && !r.passed" class="report__evidence">
            <template v-for="(e, k) in r.evidence" :key="k">
              <button v-if="e.type === 'screenshot'" type="button" class="shot" @click="zoom = e">
                <img :src="e.url" :alt="e.label" loading="lazy" />
                <span class="shot__label">{{ e.label }}</span>
              </button>
              <figure v-else class="log">
                <figcaption class="vk-eyebrow">{{ e.label }}</figcaption>
                <pre class="vk-num">{{ e.text }}</pre>
              </figure>
            </template>
          </div>
          <details v-if="verdict && r.passed && (r.evidence?.length || r.probes?.length)" class="report__more">
            <summary>{{ r.probes?.length ? `${r.probes.length} probe${r.probes.length > 1 ? 's' : ''} and evidence` : 'Evidence' }}</summary>
            <ul v-if="r.probes?.length" class="probes">
              <li v-for="(p, k) in r.probes" :key="k" :class="`is-${p.status}`">
                <span class="probes__mark" aria-hidden="true"><Check v-if="p.status === 'pass'" :size="11" :stroke-width="2.6" /><X v-else-if="p.status === 'fail'" :size="11" :stroke-width="2.6" /><Minus v-else :size="11" :stroke-width="2.6" /></span>
                <span class="probes__label">{{ probeLabel(p) }}<span v-if="p.via === 'ocr'" class="probes__via"> · OCR</span></span>
                <span class="probes__obs">{{ p.observed }}</span>
              </li>
            </ul>
            <div class="report__evidence">
              <template v-for="(e, k) in r.evidence" :key="k">
                <button v-if="e.type === 'screenshot'" type="button" class="shot" @click="zoom = e">
                  <img :src="e.url" :alt="e.label" loading="lazy" />
                  <span class="shot__label">{{ e.label }}</span>
                </button>
                <figure v-else class="log">
                  <figcaption class="vk-eyebrow">{{ e.label }}</figcaption>
                  <pre class="vk-num">{{ e.text }}</pre>
                </figure>
              </template>
            </div>
          </details>
        </div>
      </li>
    </TransitionGroup>

    <VModal :open="!!zoom" :title="zoom?.label || ''" wide @close="zoom = null">
      <img v-if="zoom" :src="zoom.url" :alt="zoom.label" class="zoom" />
    </VModal>
  </div>
</template>

<style scoped>
.report__head { display: flex; gap: 20px; align-items: center; padding-bottom: 20px; border-bottom: 1px solid var(--vk-line-subtle); }
.report__summary { flex: 1; min-width: 0; }
.report__pills { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.report__attempt { font: var(--vk-type-small); }
.report__text { margin: 8px 0 0; font: var(--vk-type-body); color: var(--vk-ink-2); }
.report__stage { display: flex; align-items: center; gap: 8px; margin: 8px 0 0; font: var(--vk-type-small); color: var(--vk-muted); }
.report__links { display: flex; gap: 16px; flex-wrap: wrap; margin-top: 8px; font: var(--vk-type-small); }
.report__links a { display: inline-flex; align-items: center; gap: 5px; color: var(--vk-muted); }
.report__links a:hover { color: var(--vk-ink); }

/* how the verdict was reached */
.engine { display: flex; flex-direction: column; gap: 8px; padding: 14px 0 16px; border-bottom: 1px solid var(--vk-line-subtle); }
.engine__strip { display: flex; gap: 3px; height: 6px; }
.engine__seg { border-radius: var(--vk-r-full); min-width: 6px; }
.is-probe { background: var(--vk-ink-2); }
.is-ocr { background: color-mix(in srgb, var(--vk-ink-2) 55%, var(--vk-surface)); }
.is-reused { background: var(--vk-line-strong); }
.is-model { background: var(--vk-accent); }
.engine__text { margin: 0; font: var(--vk-type-small); color: var(--vk-ink-2); }
.engine__dot { display: inline-block; width: 7px; height: 7px; margin-right: 6px; border-radius: 50%; vertical-align: 1px; }
.engine__meta { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; margin: 0; font: var(--vk-type-small); }
.engine__receipt { display: inline-flex; align-items: center; gap: 6px; }

.integrity { margin-top: 16px; }
.integrity__body { padding: 14px 16px 14px 18px; }
.integrity__title { display: flex; align-items: center; gap: 8px; margin: 0; font: 400 15px/20px var(--vk-font); color: var(--vk-danger-ink); }
.integrity__sub { margin: 6px 0 0; font: var(--vk-type-dense); color: var(--vk-ink-2); }
.integrity__quote { margin: 10px 0 0; padding: 8px 12px; border: 1px solid var(--vk-line); border-radius: var(--vk-r-sm); background: var(--vk-surface); font: var(--vk-num-13); color: var(--vk-ink); }
.report__rows { margin: 0; padding: 0; list-style: none; }
.report__row { display: flex; gap: 14px; padding: 16px 0; border-bottom: 1px solid var(--vk-line-subtle); }
.report__row:last-child { border-bottom: 0; padding-bottom: 0; }
.report__icon {
  display: grid; place-items: center; flex: none; width: 24px; height: 24px; margin-top: -1px;
  border-radius: 50%; border: 1px solid var(--vk-line); color: var(--vk-faint); background: var(--vk-surface);
}
.is-pass .report__icon { background: var(--vk-ok-soft); border-color: color-mix(in srgb, var(--vk-ok) 35%, transparent); color: var(--vk-ok-ink); }
.is-fail .report__icon { background: var(--vk-danger-soft); border-color: color-mix(in srgb, var(--vk-danger) 35%, transparent); color: var(--vk-danger-ink); }
.is-running .report__icon { border-color: var(--vk-accent-line); }
.report__body { flex: 1; min-width: 0; }
.report__line { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
.report__statement { margin: 0; font: var(--vk-type-body); color: var(--vk-ink); }
.is-pending .report__statement { color: var(--vk-muted); }
.report__why { margin: 6px 0 0; font: var(--vk-type-dense); color: var(--vk-ink-2); }
.report__doing { margin: 6px 0 0; font: var(--vk-type-small); }

/* what decided the check */
.by {
  flex: none; padding: 1px 8px; border: 1px solid var(--vk-line); border-radius: var(--vk-r-full);
  font: 400 11px/18px var(--vk-mono); color: var(--vk-muted); background: var(--vk-surface); white-space: nowrap;
}
.by--model { color: var(--vk-accent-text); border-color: var(--vk-accent-line); }

.probes { margin: 10px 0 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 6px; }
.probes li { display: grid; grid-template-columns: 16px minmax(0, 1fr); column-gap: 8px; font: var(--vk-type-small); }
.probes__mark { display: grid; place-items: center; width: 16px; height: 16px; margin-top: 1px; border-radius: 50%; border: 1px solid var(--vk-line); color: var(--vk-faint); }
.probes .is-pass .probes__mark { color: var(--vk-ok-ink); border-color: color-mix(in srgb, var(--vk-ok) 35%, transparent); }
.probes .is-fail .probes__mark { color: var(--vk-danger-ink); border-color: color-mix(in srgb, var(--vk-danger) 35%, transparent); }
.probes__label { color: var(--vk-ink); }
.probes__via { color: var(--vk-faint); }
.probes__obs { grid-column: 2; color: var(--vk-muted); font: var(--vk-num-13); font-size: 12px; overflow-wrap: anywhere; }

.report__evidence { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 12px; }
.report__more { margin-top: 8px; }
.report__more summary { font: var(--vk-type-small); color: var(--vk-muted); cursor: pointer; width: max-content; }
.report__more summary:hover { color: var(--vk-ink); }

.shot { display: flex; flex-direction: column; gap: 6px; padding: 0; border: 0; background: none; cursor: zoom-in; text-align: left; }
.shot img { display: block; height: 120px; width: auto; max-width: 220px; object-fit: cover; object-position: top; border-radius: var(--vk-r-sm); border: 1px solid var(--vk-line); background: var(--vk-surface-2); }
.shot:hover img { border-color: var(--vk-line-strong); }
.shot__label { font: var(--vk-type-small); color: var(--vk-muted); }
.log { margin: 0; flex: 1 1 260px; min-width: 0; padding: 10px 12px; border-radius: var(--vk-r-sm); border: 1px solid var(--vk-line-subtle); background: var(--vk-surface-2); }
.log pre { margin: 6px 0 0; font-size: 12px; line-height: 1.6; white-space: pre-wrap; color: var(--vk-ink-2); }
.zoom { display: block; width: 100%; height: auto; border-radius: var(--vk-r-sm); border: 1px solid var(--vk-line); }
@media (max-width: 560px) { .report__line { flex-direction: column; gap: 6px; } }
</style>
