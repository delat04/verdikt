<!--
  ReplayPlayer — the verifier's browser session as it was recorded in Kernel's cloud, with its chapters (each
  view, the form test, each sub-page) and the checks that weren't met, each a click from the second that shows it.
  Opens at startAt (a check's moment) or just before the first chapter. A replay from before chapters existed
  ({ url, seconds }) plays with its note and footer only.
-->
<script setup>
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { Download, X } from 'lucide-vue-next'
import VModal from './ui/VModal.vue'
import VButton from './ui/VButton.vue'
import VCopy from './ui/VCopy.vue'
import { clock, mb, shortDate } from '@/domain/format'

const props = defineProps({
  open: { type: Boolean, default: false },
  // { url, seconds, bytes, sha256, session, recordedAt, region, chapters[], marks[], poster, sample }
  replay: { type: Object, default: null },
  moments: { type: Array, default: () => [] },  // [{ t, label, statement, passed }]
  startAt: { type: Number, default: null },      // a moment's second; null opens at the first chapter
  sub: { type: String, default: '' },
})
const emit = defineEmits(['close'])

const reducedMotion = typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
const video = ref(null)
const status = ref('loading')   // loading | ready | error
const now = ref(0)

const chapters = computed(() => [...(props.replay?.chapters || [])].sort((a, b) => a.t - b.t))
const playable = computed(() => chapters.value.filter((c) => c.inVideo !== false))
const failed = computed(() => props.moments.filter((m) => !m.passed && Number.isFinite(m.t)).sort((a, b) => a.t - b.t))
// where a chapter ends: the next one in the video, else the end of the recording
const endOf = (c) => {
  const next = playable.value.find((x) => x.t > c.t)
  return next ? next.t : Math.max(c.t, Number(props.replay?.seconds) || Infinity)
}
const current = computed(() => playable.value.findLast((c) => now.value >= c.t - 0.05 && now.value < endOf(c)) || null)
const missedIn = (c) => (c.inVideo === false ? 0 : failed.value.filter((m) => m.t >= c.t && m.t < endOf(c)).length)

// ---- the chapters and the measurements, as WebVTT tracks (the chapter list is the visible copy of the first)
const ts = (s) => {
  const ms = Math.max(0, Math.round(s * 1000))
  const p = (n, w = 2) => String(n).padStart(w, '0')
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)}.${p(ms % 1000, 3)}`
}
const vtt = (cues) => URL.createObjectURL(new Blob([`WEBVTT\n\n${cues.map(([a, b, text], i) => `${i + 1}\n${ts(a)} --> ${ts(b)}\n${text}`).join('\n\n')}\n`], { type: 'text/vtt' }))
const tracks = ref({ chapters: null, captions: null })
function revoke() {
  Object.values(tracks.value).forEach((u) => u && URL.revokeObjectURL(u))
  tracks.value = { chapters: null, captions: null }
}
watch(() => props.replay, (r) => {
  revoke()
  if (!r) return
  const cues = playable.value.map((c) => [c.t, Math.min(endOf(c), c.t + 3600), c.label])
  const measured = (r.marks || []).filter((m) => (m.kind || 'measure') === 'measure' && m.inVideo !== false).map((m) => [m.t, m.t + 3, m.label])
  tracks.value = { chapters: cues.length ? vtt(cues) : null, captions: measured.length ? vtt(measured) : null }
}, { immediate: true })
onBeforeUnmount(revoke)

// ---- playback
watch(() => props.open, (o) => { if (o) { status.value = 'loading'; now.value = 0 } })
function onMeta() {
  const v = video.value
  if (!v) return
  const at = props.startAt != null ? props.startAt - 0.5 : (playable.value[0]?.t ?? 0) - 0.3
  v.currentTime = Math.min(Math.max(0, at), Number.isFinite(v.duration) ? v.duration : Infinity)
  now.value = v.currentTime
}
const onTime = () => { now.value = video.value?.currentTime || 0 }
function seek(t, lead = 0.3) {
  const v = video.value
  if (!v || status.value === 'error') return
  v.currentTime = Math.max(0, t - lead)
  now.value = v.currentTime
  v.play().catch(() => {})
}
function retry() {
  status.value = 'loading'
  video.value?.load()
}

// ---- download: a cross-origin <a download> (Supabase storage) is ignored by browsers, so that file is fetched first
const downloading = ref(false)
const sameOrigin = computed(() => {
  try { return new URL(props.replay?.url, location.href).origin === location.origin } catch { return true }
})
const fileName = computed(() => `verdikt-recording-${props.replay?.session?.slice(0, 8) || 'kernel'}.mp4`)
async function download(e) {
  if (sameOrigin.value) return
  e.preventDefault()
  downloading.value = true
  try {
    const blob = await (await fetch(props.replay.url)).blob()
    const href = URL.createObjectURL(blob)
    Object.assign(document.createElement('a'), { href, download: fileName.value }).click()
    setTimeout(() => URL.revokeObjectURL(href), 1000)
  } catch {
    window.open(props.replay.url, '_blank', 'noopener')   // can't fetch it: open it, and the browser offers to save
  } finally {
    downloading.value = false
  }
}
</script>

<template>
  <VModal :open="open && !!replay" size="theater" title="What the verifier saw" :sub="sub" @close="emit('close')">
    <div v-if="replay" class="rp">
      <!-- while it loads, the stage shows the page's top (the poster cropped, not a tall page letterboxed) and the
           video stays transparent, so Chrome's own spinner never doubles the 'Loading' pill -->
      <div
        class="rp-stage" :class="{ 'is-error': status === 'error', 'is-loading': status === 'loading' }"
        :style="status === 'loading' && replay.poster ? { backgroundImage: `url(${JSON.stringify(replay.poster)})` } : null"
      >
        <video
          ref="video"
          :src="replay.url"
          :autoplay="!reducedMotion"
          controls playsinline muted preload="metadata" data-autofocus
          @loadedmetadata="onMeta"
          @canplay="status = 'ready'"
          @timeupdate="onTime"
          @seeked="onTime"
          @error="status = 'error'"
        >
          <track v-if="tracks.chapters" kind="chapters" srclang="en" label="Chapters" :src="tracks.chapters" />
          <!-- off by default: the outlines that show what was measured are already drawn into the video -->
          <track v-if="tracks.captions" kind="captions" srclang="en" label="What the verifier did" :src="tracks.captions" />
        </video>
        <p v-if="status === 'loading'" class="rp-loading" role="status"><span class="vk-spin" /> Loading the recording</p>
        <div v-if="status === 'error'" class="rp-error" role="alert">
          <p class="rp-error__text">The recording couldn’t load. The screenshots and measurements in this report don’t depend on it.</p>
          <div class="rp-error__actions">
            <VButton variant="secondary" size="sm" @click="retry">Try again</VButton>
            <a :href="replay.url" :download="fileName" class="rp-link" @click="download">Download MP4</a>
          </div>
        </div>
      </div>

      <div v-if="chapters.length" class="rp-grid" :class="{ 'has-missed': failed.length }">
        <section class="rp-sec" aria-labelledby="rp-chapters">
          <h3 id="rp-chapters" class="vk-eyebrow">Chapters</h3>
          <ol class="rp-chapters">
            <li v-for="c in chapters" :key="`${c.kind}-${c.t}-${c.label}`">
              <button
                type="button" class="rp-chapter" :disabled="c.inVideo === false"
                :aria-current="current === c ? 'true' : undefined"
                @click="seek(c.t)"
              >
                <span class="vk-num rp-chapter__t">{{ c.inVideo === false ? '–' : clock(c.t) }}</span>
                <span class="rp-chapter__label">{{ c.label }}</span>
                <span v-if="c.inVideo === false" class="rp-chapter__aside">not in the recording</span>
                <span v-else-if="missedIn(c)" class="rp-chapter__aside is-missed">{{ missedIn(c) }} check{{ missedIn(c) > 1 ? 's' : '' }} not met</span>
              </button>
            </li>
          </ol>
        </section>
        <section v-if="failed.length" class="rp-sec" aria-labelledby="rp-missed">
          <h3 id="rp-missed" class="vk-eyebrow">Not met</h3>
          <ul class="rp-missed">
            <li v-for="(m, i) in failed" :key="i">
              <X :size="14" :stroke-width="2.2" class="rp-missed__x" aria-hidden="true" />
              <span class="rp-missed__text">{{ m.statement }}</span>
              <button type="button" class="rp-at vk-num" :aria-label="`Play from ${clock(m.t)}, ${m.label}`" @click="seek(m.t, 0.5)">{{ clock(m.t) }}</button>
            </li>
          </ul>
        </section>
      </div>

      <p class="rp-note">
        <template v-if="replay.sample">A real Kernel recording of Verdikt’s verifier checking this sample delivery, made when the demo was built. Live checks record their own.</template>
        <template v-else>Recorded in Kernel’s cloud browser{{ replay.recordedAt ? ` on ${shortDate(replay.recordedAt)}` : '' }} while the verifier ran. The outlines were drawn after every measurement and screenshot was taken, so they’re not part of the evidence.<template v-if="replay.sha256"> This file’s sha-256 is stored with the verdict.</template></template>
      </p>
    </div>

    <template #foot>
      <div v-if="replay" class="rp-foot">
        <p class="rp-foot__facts">
          <span v-if="replay.sha256" class="rp-fact">sha-256 <VCopy :value="replay.sha256" label="Copy the recording’s sha-256">{{ replay.sha256.slice(0, 12) }}</VCopy></span>
          <span v-if="replay.session" class="rp-fact">Kernel session <VCopy :value="replay.session" label="Copy the Kernel session id">{{ replay.session.slice(0, 8) }}</VCopy></span>
          <span v-if="replay.bytes" class="vk-num">{{ mb(replay.bytes) }}</span>
        </p>
        <a :href="replay.url" :download="fileName" class="vk-btn vk-btn--secondary vk-btn--sm" :aria-busy="downloading || undefined" @click="download">
          <Download :size="14" :stroke-width="1.9" aria-hidden="true" /> Download MP4
        </a>
      </div>
    </template>
  </VModal>
</template>

<style scoped>
.rp { display: flex; flex-direction: column; gap: 16px; }
/* capped so the chapters and the custody facts below fit beside it on a 900px-tall laptop */
.rp-stage { position: relative; aspect-ratio: 16 / 10; max-height: 56dvh; overflow: hidden; background: #000; border: 1px solid var(--vk-line); border-radius: var(--vk-r-sm); }
.rp-stage video { display: block; width: 100%; height: 100%; object-fit: contain; background: #000; }
.rp-stage.is-loading { background: #000 center top / cover no-repeat; }
.rp-stage.is-loading video { opacity: 0; }
.rp-stage.is-error { background: var(--vk-surface-2); }
.rp-stage.is-error video { visibility: hidden; }
.rp-loading {
  position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); display: flex; align-items: center; gap: 8px;
  margin: 0; padding: 6px 12px; border: 1px solid var(--vk-line); border-radius: var(--vk-r-full);
  background: var(--vk-surface); font: var(--vk-type-small); color: var(--vk-muted); white-space: nowrap; pointer-events: none;
}
.rp-error { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; padding: 16px; text-align: center; }
.rp-error__text { max-width: 420px; margin: 0; font: var(--vk-type-dense); color: var(--vk-ink-2); }
.rp-error__actions { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; justify-content: center; }
.rp-link { font: var(--vk-type-small); color: var(--vk-muted); text-decoration: underline; text-underline-offset: 3px; }
.rp-link:hover { color: var(--vk-ink); }

.rp-grid { display: grid; grid-template-columns: minmax(0, 1fr); gap: 20px; }
@media (min-width: 900px) { .rp-grid.has-missed { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 32px; } }
.rp-sec { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.rp-chapters, .rp-missed { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; }
.rp-chapter {
  display: flex; align-items: baseline; gap: 12px; width: 100%; padding: 7px 10px; text-align: left;
  border: 0; border-left: 1px solid transparent; background: none; cursor: pointer;
  font: var(--vk-type-dense); color: var(--vk-muted); transition: color var(--vk-dur-1);
}
.rp-chapter:hover:not(:disabled) { color: var(--vk-ink); }
.rp-chapter[aria-current='true'] { color: var(--vk-ink); border-left-color: var(--vk-ink); }
.rp-chapter:disabled { cursor: default; }
.rp-chapter__t { flex: none; min-width: 34px; font-size: 12px; }
.rp-chapter__label { min-width: 0; }
.rp-chapter__aside { margin-left: auto; padding-left: 8px; font: var(--vk-type-small); color: var(--vk-muted); white-space: nowrap; }
.rp-chapter__aside.is-missed { color: var(--vk-danger-ink); }
.rp-missed li { display: grid; grid-template-columns: 16px minmax(0, 1fr) auto; align-items: baseline; column-gap: 10px; padding: 6px 0; font: var(--vk-type-dense); color: var(--vk-ink); }
.rp-missed li + li { border-top: 1px solid var(--vk-line-subtle); }
.rp-missed__x { align-self: center; color: var(--vk-danger-ink); }
.rp-missed__text { min-width: 0; }
.rp-at { padding: 2px 4px; border: 0; background: none; cursor: pointer; font-size: 12px; color: var(--vk-muted); text-decoration: underline; text-underline-offset: 3px; }
.rp-at:hover { color: var(--vk-ink); }
.rp-note { margin: 0; font: var(--vk-type-small); color: var(--vk-faint); }

.rp-foot { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; width: 100%; }
.rp-foot__facts { display: flex; align-items: center; gap: 6px 16px; flex-wrap: wrap; margin: 0; min-width: 0; font: var(--vk-type-small); color: var(--vk-muted); }
.rp-fact { display: inline-flex; align-items: center; gap: 6px; }
.rp-foot .vk-btn { text-decoration: none; }
</style>
