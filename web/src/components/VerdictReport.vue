<!--
  VerdictReport — what the agent checked, live while it runs and as a report after.
  Both parties see the same report: each signed criterion, pass or not, what decided it (a deterministic
  probe, OCR, Claude, or an unchanged earlier answer), the probe results, and the evidence.
  Failed checks come first: they are the only thing anyone needs to act on.
-->
<script setup>
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { Check, X, Minus, Globe, Github, Circle, ShieldAlert, Play, VideoOff } from 'lucide-vue-next'
import VPill from './ui/VPill.vue'
import VModal from './ui/VModal.vue'
import VCopy from './ui/VCopy.vue'
import ScoreRing from './ScoreRing.vue'
import ReplayPlayer from './ReplayPlayer.vue'
import PrecedentLine from './PrecedentLine.vue'
import { timeAgo, hostOf, shortDate, clock } from '@/domain/format'
import { LAYER, STAGE, PRECEDENT_SAMPLE_STAGE, RECORDING, probeLabel, tokensLabel, stepLabel, provenance, retryLine, chapterShort } from '@/domain/probes'

const props = defineProps({
  criteria: { type: Array, required: true },
  submission: { type: Object, required: true },
  progress: { type: Object, default: null },     // { [criterionId]: pending | running | pass | fail, '@': { stage, by } } while verifying
  // the check stopped before a verdict (verify.error: the browser lost twice, the model or the database down). The
  // report can't tell which, so it says only what's true for all of them: nothing decided, money held
  stalled: { type: Boolean, default: false },
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

// one of the demo's sample deliveries (web/public/samples) is named for what it is, not for the host serving it
const deliveryLabel = (url) => {
  const sample = /\/samples\/([\w-]+)\.html$/.exec(url || '')?.[1]
  return sample ? `${sample} · sample site` : hostOf(url)
}

// ---- the browser session, recorded in Kernel's cloud: a card with its chapters and where checks failed, and the
// player, opened at the start or at the second a check was decided (its 'moment' evidence)
const replay = computed(() => verdict.value?.replay || null)
const watching = ref(false)
const startAt = ref(null)
function openAt(t) {
  startAt.value = Number.isFinite(t) ? t : null
  watching.value = true
}
const seconds = computed(() => Number(replay.value?.seconds) || 0)
const momentOf = (r) => r.evidence?.find((e) => e.type === 'moment') || null
// every check's moment, for the player: what was measured there and whether it was met
const moments = computed(() => (verdict.value?.results || []).flatMap((r) => {
  const m = momentOf(r)
  return m ? [{ t: m.t, label: m.label, statement: byId.value[r.criterionId]?.statement || '', passed: r.passed }] : []
}))
const failedOnCamera = computed(() => moments.value.filter((m) => !m.passed))
// one link per second shown, however many checks failed there
const failLinks = computed(() => [...new Map(failedOnCamera.value.map((m) => [`${m.label}@${m.t}`, m])).values()].sort((a, b) => a.t - b.t))
// the sub names the chapters views first, then the form test and the sub-pages: 'Desktop · Phone · Form test'
const RANK = (c) => (c.kind === 'view' ? (c.view === 'mobile' ? 1 : 0) : c.kind === 'form' ? 2 : 3)
const cardSub = computed(() => {
  const names = [...new Set([...(replay.value?.chapters || [])].sort((a, b) => RANK(a) - RANK(b) || a.t - b.t).map(chapterShort))]
  const line = [...names, 'recorded in Kernel’s cloud browser', ...(replay.value?.sample ? ['sample delivery'] : [])].join(' · ')
  return line.charAt(0).toUpperCase() + line.slice(1)
})
// the chapter rail: each chapter as wide as it runs (the first from 0:00), so a failure tick sits at t / seconds
const bar = computed(() => {
  const list = (replay.value?.chapters || []).filter((c) => c.inVideo !== false && c.t < seconds.value).sort((a, b) => a.t - b.t)
  return list.map((c, i) => ({ ...c, grow: Math.max(0.01, (list[i + 1]?.t ?? seconds.value) - (i ? c.t : 0)) }))
})
const ticks = computed(() => (seconds.value ? failLinks.value.filter((m) => m.t <= seconds.value).map((m) => (m.t / seconds.value) * 100) : []))
const poster = computed(() => replay.value?.poster
  || verdict.value?.results.flatMap((r) => r.evidence || []).find((e) => e.type === 'screenshot' && e.label === 'Desktop · 1440px')?.url
  || null)
// the player's sub: which attempt, what was delivered, when it was recorded
const hostLabel = (url) => /\/samples\/([\w-]+)\.html$/.exec(url || '')?.[1] || hostOf(url)
const playerSub = computed(() => `Attempt ${props.submission.attempt} · ${hostLabel(props.submission.liveUrl)} · ${shortDate(replay.value?.recordedAt || verdict.value?.createdAt)}`)

// ---- where the check ran, and why there's no video when there isn't one
const site = computed(() => verdict.value?.site || null)
const where = computed(() => provenance(site.value))
const retried = computed(() => retryLine(site.value))
const whereLine = computed(() => [where.value && retried.value && !/\.$/.test(where.value) ? `${where.value}.` : where.value, retried.value].filter(Boolean).join(' '))
const unrecorded = computed(() => {
  const s = site.value
  if (!s || replay.value || !((s.recording && s.recording !== 'recorded') || s.fallback)) return null
  const why = RECORDING[s.fallback || s.recording] || 'Kernel was unavailable'
  // the provenance line above already gives this reason: say it once
  return whereLine.value.includes(why) ? null : why
})

// ---- live: what the browser is doing, and for how long it's been recording (a client-side clock from startedAt)
const stageLine = computed(() => (meta.value.stage === 'browser' && meta.value.step ? stepLabel(meta.value) : null)
  // the demo looks nothing up: its similar checks are the sample history's, said as such (like its Kernel recording)
  || (meta.value.stage === 'precedent' && meta.value.precedent?.sample ? PRECEDENT_SAMPLE_STAGE : null)
  || STAGE[meta.value.stage] || 'Checking')
const recordingNow = computed(() => live.value && meta.value.stage === 'browser' && !!meta.value.recording)
// the demo's sample walk records nothing: it plays back the run Kernel recorded when the demo was built, so no clock
const replayingSample = computed(() => live.value && meta.value.stage === 'browser' && !!meta.value.sample)
const tick = ref(Date.now())
let timer = null
watch(() => live.value && !!meta.value.startedAt, (on) => {
  clearInterval(timer)
  timer = null
  if (!on) return
  tick.value = Date.now()
  timer = setInterval(() => { tick.value = Date.now() }, 1000)
}, { immediate: true })
onBeforeUnmount(() => clearInterval(timer))
const elapsed = computed(() => Math.max(0, (tick.value - Date.parse(meta.value.startedAt)) / 1000) || 0)

// precedent (Elastic): how the most similar checks elsewhere were decided. Each Claude-judged row says it in its
// PrecedentLine; the engine line counts them; live, the model stage says how many it was shown
const precedentOf = (r) => r.evidence?.find((e) => e.type === 'precedent') || null
const seen = computed(() => verdict.value?.precedent || null)
const PREC_FOUND = ['ok', 'sample']
const PREC_DOWN = ['timeout', 'error', 'degraded']
// the live line under the model stage: sample (the demo), found, none, down, or null (an older server sent no
// status: say nothing rather than claim a search found nothing)
const liveSeen = computed(() => {
  const p = meta.value.precedent
  if (!p) return null
  if (p.sample || p.status === 'sample') return 'sample'
  if (p.status === 'ok') return p.cases ? 'found' : 'none'
  return PREC_DOWN.includes(p.status) ? 'down' : null
})
// a failed check's panel opens by itself only where it fits beside the report: on a phone the line and its
// reason stay, and the cases are one tap away
const wide = ref(typeof window === 'undefined' || !window.matchMedia || window.matchMedia('(min-width: 561px)').matches)
// the evidence boxes show screenshots, moments and logs; precedent has its own line, so it never opens one alone
const hasEvidence = (r) => (r.evidence || []).some((e) => e.type !== 'precedent')
const receiptLabel = computed(() => (engine.value?.receiptCovers?.includes('precedent')
  ? 'Copy the verdict receipt (sha-256 of the specs, the evidence, the precedent shown to the verifier and the results)'
  : 'Copy the verdict receipt (sha-256 of the specs, the evidence and the results)'))
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
          <VPill v-else-if="stalled" tone="neutral">Not decided</VPill>
          <VPill v-else tone="neutral">Queued</VPill>
          <span class="vk-faint report__attempt">Attempt {{ submission.attempt }} · {{ timeAgo(submission.createdAt) }}</span>
        </div>
        <p class="report__text">
          {{ verdict ? verdict.summary : stalled ? 'This check couldn’t finish. Nothing was decided and the money is still held. Submit again to re-run it.' : 'Probes run first: layout, exact copy, status, console, accessibility, the repository. Claude only judges what they can’t settle.' }}
        </p>
        <p v-if="live && meta.stage" class="report__stage">
          <span class="vk-spin" />
          <span>{{ stageLine }}<template v-if="recordingNow"> · Recording · <span class="vk-num">{{ clock(elapsed) }}</span></template><template v-else-if="replayingSample && meta.step !== 'open'"> · from the sample’s Kernel recording</template></span>
        </p>
        <!-- what Claude is being shown beside the evidence: the similar checks found in the 'precedent' stage -->
        <!-- found or none only when the search answered; the demo's are sample checks; never a claim when it failed -->
        <p v-if="live && meta.stage === 'model' && meta.precedent && liveSeen" class="report__seen">
          <template v-if="liveSeen === 'sample'">Compared with <span class="vk-num">{{ meta.precedent.cases }}</span> sample check{{ meta.precedent.cases === 1 ? '' : 's' }} from the demo’s history</template>
          <template v-else-if="liveSeen === 'found'">Compared with <span class="vk-num">{{ meta.precedent.cases }}</span> similar check{{ meta.precedent.cases === 1 ? '' : 's' }} on other contracts</template>
          <template v-else-if="liveSeen === 'none'">No similar checks on other contracts yet</template>
          <template v-else>Couldn’t look up similar checks this time. Judged on this delivery’s evidence alone.</template>
        </p>
        <div class="report__links">
          <a v-if="submission.liveUrl" :href="submission.liveUrl" target="_blank" rel="noopener"><Globe :size="13" :stroke-width="1.9" /> {{ deliveryLabel(submission.liveUrl) }}</a>
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
        <span v-if="seen && PREC_FOUND.includes(seen.status) && seen.asked?.length">· <template v-if="seen.cases">compared with <span class="vk-num">{{ seen.cases }}</span> {{ seen.status === 'sample' ? 'sample' : 'similar' }} check{{ seen.cases === 1 ? '' : 's' }}</template><template v-else>no similar checks yet</template></span>
        <span v-else-if="seen && PREC_DOWN.includes(seen.status)">· precedent unavailable</span>
        <span v-if="engine.receipt" class="engine__receipt">· receipt <VCopy :value="engine.receipt" :label="receiptLabel">{{ engine.receipt.slice(0, 12) }}</VCopy></span>
      </p>
      <p v-if="whereLine" class="engine__where">{{ whereLine }}</p>
    </div>

    <!-- the verifier's browser session, recorded in Kernel's cloud: chapters, where checks failed, one click to the second -->
    <div v-if="replay" class="rp-card">
      <!-- the poster repeats the title button for the pointer; keyboard and screen readers use the title -->
      <button type="button" class="rp-card__poster" tabindex="-1" aria-hidden="true" @click="openAt(null)">
        <img v-if="poster" :src="poster" alt="" loading="lazy" />
        <span class="rp-card__play"><Play :size="13" :stroke-width="2" /></span>
      </button>
      <div class="rp-card__body">
        <div class="rp-card__top">
          <button type="button" class="rp-card__title" @click="openAt(null)">Watch what the verifier saw</button>
          <span v-if="seconds" class="vk-num rp-card__len">{{ clock(seconds) }}</span>
        </div>
        <p class="rp-card__sub">{{ cardSub }}</p>
        <div v-if="bar.length" class="rp-bar" role="group" aria-label="Chapters">
          <button
            v-for="c in bar" :key="`${c.kind}-${c.t}`" type="button" class="rp-bar__seg"
            :style="{ flex: `${c.grow} 1 0px` }" :aria-label="`Play from ${c.label} at ${clock(c.t)}`" :data-tip="`${chapterShort(c)} · ${clock(c.t)}`" data-tip-pos="top" @click="openAt(c.t)"
          />
          <span v-for="(x, i) in ticks" :key="`tick-${i}`" class="rp-bar__tick" :style="{ left: `${x}%` }" aria-hidden="true" />
        </div>
        <p v-if="failLinks.length" class="rp-card__fails">
          {{ failedOnCamera.length }} check{{ failedOnCamera.length > 1 ? 's' : '' }} failed on camera:
          <template v-for="(m, i) in failLinks" :key="`${m.label}@${m.t}`">
            <button type="button" class="rp-card__at" :aria-label="`Watch ${m.label} at ${clock(m.t)}`" @click="openAt(m.t)">{{ chapterShort(m) }} <span class="vk-num">{{ clock(m.t) }}</span></button><template v-if="i < failLinks.length - 1"> · </template>
          </template>
        </p>
      </div>
    </div>
    <!-- no video this time: why, without a button -->
    <p v-else-if="unrecorded" class="rp-none"><VideoOff :size="14" :stroke-width="1.9" aria-hidden="true" /> {{ unrecorded }}</p>

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
          <!-- a failed check says what to fix first; its precedent supports it below -->
          <p v-if="verdict && !r.passed" class="report__why">{{ r.explanation }}</p>
          <p v-else-if="r.state === 'running'" class="report__doing vk-faint">{{ r.criterion.method || 'Checking…' }}</p>
          <!-- precedent: on every row Claude judged (or reused), passed or not, without opening the evidence. A failed
               row's explanation is already above, so a departure's "Why" falls back to it only on a passed row -->
          <PrecedentLine
            v-if="verdict && ['model', 'reused'].includes(r.layer)"
            :criterion-id="r.criterionId" :item="precedentOf(r)" :passed="r.passed" :explanation="r.passed ? (r.explanation || '') : ''" :layer="r.layer"
            :meta="seen" :asked="!!seen?.asked?.includes(r.criterionId)" :default-open="!r.passed && wide"
          />

          <!-- the probes, measured -->
          <!-- a single decisive probe is already the explanation above -->
          <ul v-if="verdict && !r.passed && r.probes?.length && (r.probes.length > 1 || !['probe', 'ocr'].includes(r.layer))" class="probes">
            <li v-for="(p, k) in r.probes" :key="k" :class="`is-${p.status}`">
              <span class="probes__mark" aria-hidden="true"><Check v-if="p.status === 'pass'" :size="11" :stroke-width="2.6" /><X v-else-if="p.status === 'fail'" :size="11" :stroke-width="2.6" /><Minus v-else :size="11" :stroke-width="2.6" /></span>
              <span class="probes__label">{{ probeLabel(p) }}<span v-if="p.via === 'ocr'" class="probes__via"> · OCR</span></span>
              <span class="probes__obs">{{ p.observed }}</span>
            </li>
          </ul>

          <div v-if="verdict && hasEvidence(r) && !r.passed" class="report__evidence">
            <template v-for="(e, k) in r.evidence" :key="k">
              <button v-if="e.type === 'screenshot'" type="button" class="shot" @click="zoom = e">
                <img :src="e.url" :alt="e.label" loading="lazy" />
                <span class="shot__label">{{ e.label }}</span>
              </button>
              <!-- a moment in the recording: a chip to the second it was measured (nothing without a video); never a log box -->
              <template v-else-if="e.type === 'moment'">
                <template v-if="replay">
                  <button type="button" class="moment" :aria-label="`Watch the moment this was measured, at ${clock(e.t)}, ${e.label}`" @click="openAt(e.t)">
                    <Play :size="12" :stroke-width="2" aria-hidden="true" /> Watch <span class="vk-num">{{ clock(e.t) }}</span> · {{ e.label }}
                  </button>
                  <span class="moment__break" aria-hidden="true" />
                </template>
              </template>
              <!-- precedent: shown by the row's PrecedentLine, never as a box here -->
              <template v-else-if="e.type === 'precedent'" />
              <figure v-else class="log">
                <figcaption class="vk-eyebrow">{{ e.label }}</figcaption>
                <pre class="vk-num">{{ e.text }}</pre>
              </figure>
            </template>
          </div>
          <details v-if="verdict && r.passed && (hasEvidence(r) || r.probes?.length)" class="report__more">
            <summary>{{ r.probes?.length ? `${r.probes.length} probe${r.probes.length > 1 ? 's' : ''} and evidence` : 'Evidence' }}</summary>
            <ul v-if="r.probes?.length" class="probes">
              <li v-for="(p, k) in r.probes" :key="k" :class="`is-${p.status}`">
                <span class="probes__mark" aria-hidden="true"><Check v-if="p.status === 'pass'" :size="11" :stroke-width="2.6" /><X v-else-if="p.status === 'fail'" :size="11" :stroke-width="2.6" /><Minus v-else :size="11" :stroke-width="2.6" /></span>
                <span class="probes__label">{{ probeLabel(p) }}<span v-if="p.via === 'ocr'" class="probes__via"> · OCR</span></span>
                <span class="probes__obs">{{ p.observed }}</span>
              </li>
            </ul>
            <div v-if="hasEvidence(r)" class="report__evidence">
              <template v-for="(e, k) in r.evidence" :key="k">
                <button v-if="e.type === 'screenshot'" type="button" class="shot" @click="zoom = e">
                  <img :src="e.url" :alt="e.label" loading="lazy" />
                  <span class="shot__label">{{ e.label }}</span>
                </button>
                <template v-else-if="e.type === 'moment'">
                  <template v-if="replay">
                    <button type="button" class="moment" :aria-label="`Watch the moment this was measured, at ${clock(e.t)}, ${e.label}`" @click="openAt(e.t)">
                      <Play :size="12" :stroke-width="2" aria-hidden="true" /> Watch <span class="vk-num">{{ clock(e.t) }}</span> · {{ e.label }}
                    </button>
                    <span class="moment__break" aria-hidden="true" />
                  </template>
                </template>
                <template v-else-if="e.type === 'precedent'" />
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

    <ReplayPlayer :open="watching" :replay="replay" :moments="moments" :start-at="startAt" :sub="playerSub" @close="watching = false" />
  </div>
</template>

<style scoped>
.report__head { display: flex; gap: 20px; align-items: center; padding-bottom: 20px; border-bottom: 1px solid var(--vk-line-subtle); }
.report__summary { flex: 1; min-width: 0; }
.report__pills { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.report__attempt { font: var(--vk-type-small); }
.report__text { margin: 8px 0 0; font: var(--vk-type-body); color: var(--vk-ink-2); }
.report__stage { display: flex; align-items: center; gap: 8px; margin: 8px 0 0; font: var(--vk-type-small); color: var(--vk-muted); }
/* under the stage line, aligned with its text (the 16px spinner and its 8px gap) */
.report__seen { margin: 2px 0 0 24px; font: var(--vk-type-small); color: var(--vk-faint); }
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

.engine__where { margin: 0; font: var(--vk-type-small); color: var(--vk-faint); }

/* the recording: poster, title and length, the chapters as a rail, and where checks failed on camera */
.rp-card { display: flex; gap: 14px; margin-top: 14px; padding: 12px 14px; border: 1px solid var(--vk-line); border-radius: var(--vk-r-md); background: var(--vk-surface); }
.rp-card__poster {
  position: relative; flex: none; display: grid; place-items: center; width: 112px; height: 70px; padding: 0; overflow: hidden;
  border: 1px solid var(--vk-line); border-radius: var(--vk-r-xs); background: var(--vk-surface-2); cursor: pointer;
}
.rp-card__poster img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; object-position: top; }
.rp-card__play { position: relative; display: grid; place-items: center; width: 28px; height: 28px; border-radius: 50%; background: var(--vk-accent); color: var(--vk-on-accent); }
.rp-card__play svg { margin-left: 2px; }
.rp-card__body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.rp-card__top { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
.rp-card__title { padding: 0; border: 0; background: none; cursor: pointer; text-align: left; font: var(--vk-type-dense); color: var(--vk-ink); }
.rp-card__title:hover { text-decoration: underline; text-underline-offset: 3px; }
.rp-card__len { flex: none; font-size: 12px; color: var(--vk-muted); }
.rp-card__sub { margin: 0; font: var(--vk-type-small); color: var(--vk-faint); }
/* each chapter is a 24px-tall target (WCAG 2.5.8) drawing a 6px bar in its middle */
.rp-bar { position: relative; display: flex; gap: 1px; margin: -3px 0 -7px; }
.rp-bar__seg { position: relative; min-width: 4px; height: 24px; padding: 0; border: 0; background: none; cursor: pointer; }
.rp-bar__seg::before { content: ''; position: absolute; left: 0; right: 0; top: 9px; height: 6px; border-radius: var(--vk-r-full); background: var(--vk-line); transition: background var(--vk-dur-1); }
.rp-bar__seg:hover::before, .rp-bar__seg:focus-visible::before { background: var(--vk-line-strong); }
/* the last chapter's tip hangs left from its right edge, so a hidden tip never widens a phone's page */
.rp-bar__seg:last-of-type::after { left: auto; right: 0; transform: translate(0, 4px); }
.rp-bar__seg:last-of-type:hover::after, .rp-bar__seg:last-of-type:focus-visible::after { transform: none; }
.rp-bar__tick { position: absolute; top: 7px; width: 2px; height: 10px; margin-left: -1px; border-radius: 1px; background: var(--vk-danger); pointer-events: none; }
.rp-card__fails { margin: 2px 0 0; font: var(--vk-type-small); color: var(--vk-muted); }
.rp-card__at { padding: 0; border: 0; background: none; cursor: pointer; font: inherit; color: var(--vk-ink-2); text-decoration: underline; text-underline-offset: 3px; }
.rp-card__at:hover { color: var(--vk-ink); }
.rp-card__at .vk-num { font-size: 12px; }
.rp-none { display: flex; align-items: center; gap: 8px; margin: 14px 0 0; font: var(--vk-type-small); color: var(--vk-faint); }
.rp-none svg { flex: none; }

/* a check's moment in the recording */
.moment {
  align-self: flex-start; display: inline-flex; align-items: center; gap: 6px; height: 26px; padding: 0 10px;
  border: 1px solid var(--vk-line); border-radius: var(--vk-r-full); background: var(--vk-surface); cursor: pointer;
  font: var(--vk-type-small); color: var(--vk-muted); white-space: nowrap; transition: border-color var(--vk-dur-1);
}
.moment:hover { border-color: var(--vk-line-strong); color: var(--vk-ink); }
.moment .vk-num { font-size: 12px; }
.moment__break { flex-basis: 100%; height: 0; }
@media (max-width: 560px) {
  .rp-card__poster { width: 88px; height: 55px; }
  .moment { white-space: normal; height: auto; min-height: 26px; }
}
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
