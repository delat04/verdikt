<!--
  Dashboard — your money and proof in AG Studio: three related tables (milestones, the checks run on every
  delivery, and every PayPal movement), a ready-made report (Money · Proof · PayPal), and Claude as Studio's
  assistant: ask in plain words and it builds, edits and filters widgets. Studio runs the assistant's tools
  here in the browser; each turn goes through Verdikt's API to Claude (services/live.js → /api/studio/turn).
  Changes save in this browser, per person; "Reset" brings back the ready-made report.
-->
<script setup>
import { ref, computed, shallowRef, markRaw, onBeforeUnmount } from 'vue'
import { AgStudio } from 'ag-studio-vue3'
import { AgStudioModuleRegistry, AgStudioAiModule, createAiHarness, enableStudioDevValidations, studioTheme } from 'ag-studio'
import { MessageSquareText, Pencil, Check, RotateCcw } from 'lucide-vue-next'
import AppShell from '@/layouts/AppShell.vue'
import VButton from '@/components/ui/VButton.vue'
import VChips from '@/components/ui/VChips.vue'
import { useLive } from '@/composables/useLive'
import { useAuthStore } from '@/stores/auth'
import { api, isDemo } from '@/services'
import { studioRows, studioData } from '@/domain/studio'
import { DEFAULT_REPORT } from '@/domain/studioReport'

AgStudioModuleRegistry.registerModules([AgStudioAiModule])
if (import.meta.env.DEV) enableStudioDevValidations()

const auth = useAuthStore()
const { data: contracts } = useLive(() => api.studioContracts())

// the tables, rebuilt whenever a contract changes; kept out of Vue's reactivity (Studio owns the rows)
const data = computed(() => contracts.value && markRaw(studioData(studioRows(contracts.value, auth.user?.id))))

// ---- the report: what this person last left, or the ready-made one
const KEY = `verdikt-studio:${auth.user?.id || 'anon'}`
const clone = (o) => JSON.parse(JSON.stringify(o))
const saved = (() => {
  try {
    return JSON.parse(localStorage.getItem(KEY) || 'null')
  } catch {
    return null
  }
})()
const initialState = markRaw(saved || clone(DEFAULT_REPORT))

const studio = shallowRef(null)
// viewing shows the report alone; asking puts Claude beside it; editing brings the fields and the widget composer
const tool = ref('view')
const mode = computed(() => (tool.value === 'view' ? 'view' : 'edit'))
const pages = ref(initialState.pages.map((p) => p.id))
const page = ref(initialState.selectedPageId)
const NAMES = { money: 'Money', proof: 'Proof', paypal: 'PayPal' }
const pageChips = computed(() => pages.value.map((id, i) => ({ value: id, label: NAMES[id] || `Page ${i + 1}` })))

let timer = null
function onState() {
  const s = studio.value?.getState()
  if (!s) return
  pages.value = s.pages.map((p) => p.id)
  page.value = s.selectedPageId
  clearTimeout(timer)
  timer = setTimeout(() => {
    try { localStorage.setItem(KEY, JSON.stringify(studio.value.getState())) } catch {}
  }, 500)
}
onBeforeUnmount(() => clearTimeout(timer))

function goTo(id) {
  page.value = id
  const s = studio.value?.getState()
  if (s && s.selectedPageId !== id) studio.value.setState({ ...s, selectedPageId: id })
}
function reset() {
  try { localStorage.removeItem(KEY) } catch {}
  studio.value?.setState(clone(DEFAULT_REPORT))
}

// ---- Claude, as Studio's assistant
const MODELS = [{
  id: 'claude-opus-5-5', label: 'Claude Opus 5.5',
  efforts: [{ id: 'medium', label: 'Balanced' }, { id: 'low', label: 'Quick' }, { id: 'high', label: 'Thorough' }],
}]
const STARTERS = [
  { label: 'Explain this page', prompt: 'Explain what this page shows and what stands out in my numbers, in a few sentences.' },
  { label: 'Money held longest', prompt: 'Add a chart of the milestones whose money was held in escrow the longest, by days held.' },
  { label: 'Checks missed first time', prompt: 'On the Proof page, add a chart of the checks most often not met on the first delivery.' },
  { label: 'Only this year', prompt: 'Filter this page to money that moved this year.' },
]
const ai = markRaw(({ api: studioApi }) => createAiHarness(studioApi, { adapter: api.studioAdapter(), models: MODELS, promptStarters: STARTERS }))

const PANELS = {
  view: { view: {}, edit: {} },
  ask: { view: {}, edit: { right: ['ai'] } },
  edit: { view: {}, edit: { left: ['data', 'filters'], right: ['edit'] } },
}

// on a phone the widgets stack in reading order, full width, with the small number tiles two to a row
const BREAKPOINTS = [{
  maxWidth: 640,
  layout(candidates, { columns }) {
    const order = candidates.map((c, i) => ({ i, l: c.layout })).sort((a, b) => a.l.yTrack - b.l.yTrack || a.l.xTrack - b.l.xTrack)
    const out = []
    let y = 0
    let half = null   // a number tile waiting for its neighbour
    for (const { i, l } of order) {
      const tile = l.xSpan <= 6 && l.ySpan <= 8
      if (tile && half) {
        out[i] = { xTrack: Math.floor(columns / 2), yTrack: half.yTrack, xSpan: columns - Math.floor(columns / 2), ySpan: half.ySpan }
        y += half.ySpan
        half = null
        continue
      }
      if (half) { y += half.ySpan; half = null }
      if (tile) {
        out[i] = half = { xTrack: 0, yTrack: y, xSpan: Math.floor(columns / 2), ySpan: l.ySpan }
        continue
      }
      const ySpan = Math.min(l.ySpan, 20)
      out[i] = { xTrack: 0, yTrack: y, xSpan: columns, ySpan }
      y += ySpan
    }
    return out
  },
}]

const theme = markRaw(studioTheme.withParams({
  fontFamily: 'var(--vk-font)',
  fontSize: 13,
  fontWeight: 400,
  accentColor: 'var(--vk-accent)',
  backgroundColor: 'var(--vk-surface)',
  foregroundColor: 'var(--vk-ink)',
  textColor: 'var(--vk-ink)',
  subtleTextColor: 'var(--vk-muted)',
  borderColor: 'var(--vk-line)',
  menuBackgroundColor: 'var(--vk-surface)',
  tooltipBackgroundColor: 'var(--vk-surface)',
  studioCanvasBackgroundColor: 'var(--vk-canvas)',
  studioWrapperBackgroundColor: 'var(--vk-canvas)',
  studioWidgetBackgroundColor: 'var(--vk-surface)',
  studioWidgetShadow: 'none',
  // narrow screens get Studio's stacked layout instead of a clipped desktop canvas
  studioMinWidth: 300,
  studioCanvasMinWidth: 300,
  studioResponsiveMinWidth: 300,
  studioWidgetTitleFontWeight: 400,
  studioWidgetTitleTextColor: 'var(--vk-ink)',
  studioWidgetCaptionTextColor: 'var(--vk-muted)',
  studioPanelHeaderFontWeight: 400,
  studioPopupTitleBarFontWeight: 400,
  chartFontFamily: 'var(--vk-font)',
  chartFontWeight: 400,
  chartTextColor: 'var(--vk-ink)',
  chartSubtleTextColor: 'var(--vk-muted)',
  chartAxisLabelColor: 'var(--vk-muted)',
  chartGridLineColor: 'var(--vk-line)',
}))

function onReady(e) {
  studio.value = e.api
}
</script>

<template>
  <AppShell>
    <template #crumbs><span>Dashboard</span></template>
    <div class="dash">
      <header class="dash__head">
        <div>
          <p class="vk-eyebrow">Dashboard</p>
          <h1 class="dash__title">Your money and proof, any way you want to see it</h1>
          <p class="dash__sub">
            Every milestone, every check on every delivery and every PayPal movement, in one report you can change.
            Ask Claude to build a chart, explain a number or filter a page.
            <span v-if="isDemo" class="vk-faint">In the demo, your contracts sit beside a year of sample history.</span>
          </p>
        </div>
        <div class="dash__tools">
          <VChips :model-value="page" :options="pageChips" label="Report page" @update:model-value="goTo" />
          <template v-if="tool === 'view'">
            <VButton size="sm" :icon="MessageSquareText" @click="tool = 'ask'">Ask Claude</VButton>
            <VButton variant="secondary" size="sm" :icon="Pencil" @click="tool = 'edit'">Edit</VButton>
          </template>
          <VButton v-else variant="secondary" size="sm" :icon="Check" @click="tool = 'view'">Done</VButton>
          <VButton variant="ghost" size="sm" :icon="RotateCcw" @click="reset">Reset</VButton>
        </div>
      </header>

      <div class="dash__studio">
        <AgStudio
          v-if="data"
          class="dash__ag"
          :data="data"
          :mode="mode"
          :initial-state="initialState"
          :theme="theme"
          :ai="ai"
          :panels="PANELS[tool]"
          :responsive-layout-breakpoints="BREAKPOINTS"
          @api-ready="onReady"
          @state-updated="onState"
        />
        <div v-else class="dash__loading">Loading your milestones…</div>
      </div>
    </div>
  </AppShell>
</template>

<style scoped>
.dash { display: flex; flex-direction: column; gap: 18px; height: 100%; min-height: 0; box-sizing: border-box; padding: 28px clamp(16px, 3vw, 36px) 20px; }
.dash__head { flex: none; display: flex; justify-content: space-between; gap: 24px; align-items: flex-end; flex-wrap: wrap; }
.dash__title { margin: 6px 0 0; font: var(--vk-type-title); letter-spacing: -.03em; color: var(--vk-ink); max-width: 30ch; }
.dash__sub { margin: 8px 0 0; font: var(--vk-type-dense); color: var(--vk-muted); max-width: 78ch; }
.dash__tools { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.dash__studio { flex: 1; min-height: 640px; border: 1px solid var(--vk-line); border-radius: var(--vk-card-r); overflow: hidden; background: var(--vk-canvas); }
.dash__ag { width: 100%; height: 100%; }
.dash__loading { padding: 24px; font: var(--vk-type-dense); color: var(--vk-muted); }
</style>
