<!--
  VerdictReport — what the agent checked, live while it runs and as a report after.
  Both parties see the same report: each signed criterion, pass or not, why, and the evidence.
  Failed checks come first: they are the only thing anyone needs to act on.
-->
<script setup>
import { ref, computed } from 'vue'
import { Check, X, Globe, Github, Circle, ShieldAlert } from 'lucide-vue-next'
import VPill from './ui/VPill.vue'
import VModal from './ui/VModal.vue'
import ScoreRing from './ScoreRing.vue'
import { timeAgo, hostOf } from '@/domain/format'

const props = defineProps({
  criteria: { type: Array, required: true },
  submission: { type: Object, required: true },
  progress: { type: Object, default: null },     // { [criterionId]: pending | running | pass | fail } while verifying
})

const verdict = computed(() => props.submission.verdict)
const live = computed(() => !verdict.value && !!props.progress)
const byId = computed(() => Object.fromEntries(props.criteria.map((c) => [c.id, c])))

const rows = computed(() => {
  if (verdict.value) {
    return [...verdict.value.results]
      .map((r) => ({ ...r, criterion: byId.value[r.criterionId] }))
      .filter((r) => r.criterion)
      .sort((a, b) => Number(a.passed) - Number(b.passed) || a.criterion.position - b.criterion.position)
  }
  return props.criteria.map((c) => ({ criterion: c, state: props.progress?.[c.id] || 'pending' }))
})

const passed = computed(() => verdict.value?.results.filter((r) => r.passed).length ?? 0)
const total = computed(() => props.criteria.length)
const checked = computed(() => Object.values(props.progress || {}).filter((s) => s === 'pass' || s === 'fail').length)
const pct = computed(() => (verdict.value ? (passed.value / Math.max(1, verdict.value.results.length)) * 100 : (checked.value / Math.max(1, total.value)) * 100))

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
          {{ verdict ? verdict.summary : 'The agent opens the live site at desktop and mobile sizes, runs each check, and reads the repository.' }}
        </p>
        <div class="report__links">
          <a v-if="submission.liveUrl" :href="submission.liveUrl" target="_blank" rel="noopener"><Globe :size="13" :stroke-width="1.9" /> {{ hostOf(submission.liveUrl) }}</a>
          <a v-if="submission.repoUrl" :href="submission.repoUrl" target="_blank" rel="noopener"><Github :size="13" :stroke-width="1.9" /> {{ hostOf(submission.repoUrl) }}{{ submission.repoUrl.replace(/^https?:\/\/[^/]+/, '') }}</a>
          <span v-if="verdict" class="vk-faint">Confidence <span class="vk-num">{{ Math.round(verdict.confidence * 100) }}%</span></span>
        </div>
      </div>
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
          <p class="report__statement">{{ r.criterion.statement }}</p>
          <p v-if="verdict && !r.passed" class="report__why">{{ r.explanation }}</p>
          <p v-else-if="r.state === 'running'" class="report__doing vk-faint">{{ r.criterion.method || 'Checking…' }}</p>
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
          <details v-if="verdict && r.passed && r.evidence?.length" class="report__more">
            <summary>Evidence</summary>
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
.report__links { display: flex; gap: 16px; flex-wrap: wrap; margin-top: 8px; font: var(--vk-type-small); }
.report__links a { display: inline-flex; align-items: center; gap: 5px; color: var(--vk-muted); }
.report__links a:hover { color: var(--vk-ink); }

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
.report__statement { margin: 0; font: var(--vk-type-body); color: var(--vk-ink); }
.is-pending .report__statement { color: var(--vk-muted); }
.report__why { margin: 6px 0 0; font: var(--vk-type-dense); color: var(--vk-ink-2); }
.report__doing { margin: 6px 0 0; font: var(--vk-type-small); }
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
</style>
