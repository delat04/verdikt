<!--
  Ask it in plain words ("held over $500", "what did I pay Sam this month") and Claude sets the grid's
  filters and sort — it only sees the column schema, never the money.
  Ledger — every milestone across every contract as one AG Grid: what was held, released, returned,
  kept as fee and paid out, with the PayPal ids behind each number. Freelancers read it as earnings
  across clients ("Money in"), clients as spend ("Money out"). The head stays put; the grid fills the rest.
  Click a row to open its contract; click an id to copy it; export what you see as CSV.
-->
<script setup>
import { ref, computed, shallowRef } from 'vue'
import { useRouter } from 'vue-router'
import { AgGridVue } from 'ag-grid-vue3'
import { ModuleRegistry, AllCommunityModule, themeQuartz } from 'ag-grid-community'
import { Download, Search, ScanSearch, X, CornerDownLeft } from 'lucide-vue-next'
import { LEDGER_SCHEMA, toGrid, describe } from '@/domain/ledgerAsk'
import AppShell from '@/layouts/AppShell.vue'
import VButton from '@/components/ui/VButton.vue'
import VChips from '@/components/ui/VChips.vue'
import { useLive } from '@/composables/useLive'
import { useAuthStore } from '@/stores/auth'
import { api } from '@/services'
import { toast } from '@/composables/useToast'
import { money, shortDate } from '@/domain/format'
import { STATUS, HELD, PAYOUT, roleOf, counterparty, latestSubmission } from '@/domain/milestone'

ModuleRegistry.registerModules([AllCommunityModule])

const auth = useAuthStore()
const router = useRouter()
const { data, loading } = useLive(() => api.listContracts())

// ---- one row per milestone
const rows = computed(() => (data.value || []).flatMap((c) => {
  const role = roleOf(c, auth.user?.id)
  const other = counterparty(c, role)
  return c.milestones.map((m) => {
    const v = latestSubmission(m)?.verdict
    const released = m.status === 'released' ? (m.releasedCents ?? m.amountCents) : 0
    return {
      contractId: c.id,
      contract: c.title,
      milestone: `M${m.position} · ${m.title}`,
      side: role === 'freelancer' ? 'in' : 'out',
      with: other?.name || 'Not joined',
      status: m.status,
      amount: m.amountCents,
      held: HELD.includes(m.status) ? m.amountCents : 0,
      released,
      returned: m.voidedCents || (m.status === 'refunded' ? m.amountCents : 0),
      fee: m.feeCents || 0,
      paidOut: m.payoutStatus === 'SUCCESS' ? (m.payoutCents || 0) : 0,
      payout: m.payoutStatus || '',
      checks: v ? `${v.results.filter((r) => r.passed).length}/${v.results.length}` : '',
      attempts: m.submissions.length || 0,
      fundedAt: m.fundedAt || '',
      releasedAt: m.releasedAt || '',
      order: m.paypal?.orderId || '',
      authorization: m.paypal?.authorizationId || '',
      capture: m.paypal?.captureId || '',
      payoutBatch: m.paypal?.payoutBatchId || '',
      currency: c.currency,
    }
  })
}))

// ---- views
const view = ref('all')
const q = ref('')
const shown = computed(() => rows.value.filter((r) => view.value === 'all' || r.side === view.value))
const sum = (list, k) => list.reduce((s, r) => s + (r[k] || 0), 0)
const chips = computed(() => [
  { value: 'all', label: 'Everything', count: rows.value.length },
  { value: 'in', label: 'Money in', count: rows.value.filter((r) => r.side === 'in').length },
  { value: 'out', label: 'Money out', count: rows.value.filter((r) => r.side === 'out').length },
])
const stats = computed(() => ({
  held: sum(shown.value, 'held'),
  released: sum(shown.value, 'released'),
  paidOut: sum(shown.value, 'paidOut'),
  fee: sum(shown.value, 'fee'),
}))

// ---- the grid
const MONEY = ['amount', 'held', 'released', 'returned', 'fee', 'paidOut']
const IDS = ['order', 'authorization', 'capture', 'payoutBatch']
const usd = (p) => (p.value ? money(p.value, p.data?.currency || 'USD') : p.node?.rowPinned ? money(0) : '—')
const when = (p) => (p.value ? shortDate(p.value) : '')

function pill(label, tone) {
  const el = document.createElement('span')
  el.className = `vk-pill vk-pill--sm${tone && tone !== 'neutral' ? ` vk-pill--${tone}` : ''}`
  const dot = document.createElement('span')
  dot.className = 'vk-pill__dot'
  el.append(dot, document.createTextNode(label))
  return el
}

// ISO timestamps filtered by calendar day (Ask the ledger sends dates as YYYY-MM-DD)
const dateFilter = {
  filter: 'agDateColumnFilter',
  filterParams: {
    comparator: (day, value) => {
      if (!value) return -1
      const d = new Date(value)
      const at = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
      return at < day.getTime() ? -1 : at > day.getTime() ? 1 : 0
    },
  },
}

const columnDefs = [
  { field: 'contract', headerName: 'Contract', pinned: 'left', minWidth: 220, flex: 1.4, cellClass: 'cell-strong' },
  { field: 'milestone', headerName: 'Milestone', minWidth: 200, flex: 1.2 },
  {
    field: 'side', headerName: 'Flow', width: 96,
    cellRenderer: (p) => (p.node.rowPinned ? '' : pill(p.value === 'in' ? 'In' : 'Out', p.value === 'in' ? 'ok' : 'accent')),
  },
  { field: 'with', headerName: 'With', minWidth: 140 },
  {
    field: 'status', headerName: 'Status', width: 160,
    cellRenderer: (p) => (p.node.rowPinned ? '' : pill(STATUS[p.value]?.label || p.value, p.value === 'released' ? 'ok' : STATUS[p.value]?.tone)),
  },
  ...MONEY.map((k) => ({
    field: k, type: 'numericColumn', width: 132, valueFormatter: usd, cellClass: 'vk-num',
    headerName: { amount: 'Amount', held: 'Held now', released: 'Released', returned: 'Returned', fee: 'Fee', paidOut: 'Paid out' }[k],
  })),
  {
    field: 'payout', headerName: 'Payout', width: 150,
    cellRenderer: (p) => (p.value && !p.node.rowPinned ? pill(PAYOUT[p.value]?.label || p.value, PAYOUT[p.value]?.tone) : ''),
  },
  { field: 'checks', headerName: 'Checks met', width: 120, cellClass: 'vk-num', type: 'rightAligned' },
  { field: 'attempts', headerName: 'Attempts', width: 108, cellClass: 'vk-num', type: 'numericColumn', valueFormatter: (p) => (p.node?.rowPinned ? '' : p.value || '') },
  { field: 'fundedAt', headerName: 'Funded', width: 112, valueFormatter: when, sort: 'desc', ...dateFilter },
  { field: 'releasedAt', headerName: 'Released on', width: 124, valueFormatter: when, ...dateFilter },
  ...IDS.map((k) => ({
    field: k, width: 190, cellClass: 'vk-num cell-id', tooltipValueGetter: (p) => (p.value ? 'Click to copy' : ''),
    headerName: { order: 'PayPal order', authorization: 'Authorization', capture: 'Capture', payoutBatch: 'Payout batch' }[k],
  })),
]
const defaultColDef = { sortable: true, filter: true, resizable: true, suppressHeaderMenuButton: true }

// totals follow whatever is filtered
const gridApi = shallowRef(null)
const pinned = ref([])
function totals() {
  const list = []
  gridApi.value?.forEachNodeAfterFilter((n) => { if (n.data) list.push(n.data) })
  shownCount.value = list.length
  pinned.value = [{
    contract: `Total · ${list.length} milestone${list.length === 1 ? '' : 's'}`,
    ...Object.fromEntries(MONEY.map((k) => [k, sum(list, k)])),
  }]
}
function onReady(e) {
  gridApi.value = e.api
  totals()
}
function onCell(e) {
  if (e.node.rowPinned) return
  if (IDS.includes(e.colDef.field)) {
    if (!e.value) return
    navigator.clipboard?.writeText(e.value).then(() => toast(`Copied ${e.value}`), () => {})
    return
  }
  router.push(`/contracts/${e.data.contractId}`)
}
// ---- ask the ledger
const askText = ref('')
const asking = ref(false)
const asked = ref(null)          // { question, answer, filters, sort, side }
const IDEAS = ['Held over $500', 'Disputes', 'Biggest payouts', 'What failed the checks?']
async function ask(question = askText.value) {
  const qn = question.trim()
  if (!qn || asking.value) return
  askText.value = qn
  asking.value = true
  try {
    const v = await api.askLedger(qn, LEDGER_SCHEMA)
    view.value = v.side || 'all'
    const { model, state } = toGrid(v)
    gridApi.value?.setFilterModel(Object.keys(model).length ? model : null)
    if (state.length) gridApi.value?.applyColumnState({ state, defaultState: { sort: null } })
    asked.value = { question: qn, ...v }
  } catch (e) {
    toast(e.message, { tone: 'danger' })
  } finally {
    asking.value = false
  }
}
function clearAsk() {
  asked.value = null
  askText.value = ''
  view.value = 'all'
  gridApi.value?.setFilterModel(null)
  gridApi.value?.applyColumnState({ state: [{ colId: 'fundedAt', sort: 'desc' }], defaultState: { sort: null } })
}
const shownCount = ref(0)
const exportCsv = () => gridApi.value?.exportDataAsCsv({ fileName: `verdikt-ledger-${new Date().toISOString().slice(0, 10)}.csv` })

// the grid speaks the design system: tokens in, so light and dark follow on their own
const theme = themeQuartz.withParams({
  fontFamily: 'var(--vk-font)',
  fontSize: 13,
  headerFontSize: 12,
  headerFontWeight: 400,
  spacing: 7,
  accentColor: 'var(--vk-accent)',
  backgroundColor: 'var(--vk-surface)',
  foregroundColor: 'var(--vk-ink)',
  textColor: 'var(--vk-ink)',
  subtleTextColor: 'var(--vk-muted)',
  borderColor: 'var(--vk-line)',
  headerBackgroundColor: 'var(--vk-surface-2)',
  headerTextColor: 'var(--vk-muted)',
  chromeBackgroundColor: 'var(--vk-surface-2)',
  oddRowBackgroundColor: 'var(--vk-surface)',
  rowHoverColor: 'var(--vk-hover)',
  selectedRowBackgroundColor: 'var(--vk-accent-soft)',
  wrapperBorderRadius: 20,
  borderRadius: 8,
  inputBorder: { color: 'var(--vk-line-strong)' },
  pinnedRowBorder: { color: 'var(--vk-line-strong)' },
})
</script>

<template>
  <AppShell>
    <template #crumbs><span>Ledger</span></template>

    <div class="vk-split ledger">
      <header class="vk-split__head head">
        <div class="head__row">
          <div>
            <h1 class="head__title">Ledger</h1>
            <p class="head__sub">Every milestone you're part of — held, released, returned, paid out — with the PayPal ids behind each number.</p>
          </div>
          <div class="vk-stats head__stats">
            <div class="vk-stat"><span class="vk-stat__n">{{ money(stats.held, 'USD', { whole: true }) }}</span><span class="vk-stat__l">held</span></div>
            <div class="vk-stat"><span class="vk-stat__n">{{ money(stats.released, 'USD', { whole: true }) }}</span><span class="vk-stat__l">released</span></div>
            <div class="vk-stat"><span class="vk-stat__n">{{ money(stats.paidOut, 'USD', { whole: true }) }}</span><span class="vk-stat__l">paid out</span></div>
          </div>
        </div>
        <div class="tools">
          <VChips v-model="view" :options="chips" label="Which money" />
          <div class="tools__right">
            <label class="find">
              <Search :size="15" :stroke-width="1.9" />
              <input v-model="q" class="find__input" placeholder="Search contracts, people, ids" aria-label="Search the ledger" />
            </label>
            <VButton variant="secondary" :icon="Download" @click="exportCsv">Export CSV</VButton>
          </div>
        </div>
        <form class="ask" @submit.prevent="ask()">
          <ScanSearch :size="16" :stroke-width="1.9" class="ask__icon" aria-hidden="true" />
          <input v-model="askText" class="ask__input" placeholder="Ask your money a question — “held over $500”, “what did I pay Sam this month?”" aria-label="Ask the ledger" />
          <VButton type="submit" size="sm" :loading="asking" :disabled="!askText.trim()" :icon-right="CornerDownLeft">Ask</VButton>
        </form>
        <div v-if="asked" class="asked" aria-live="polite">
          <p class="asked__answer">{{ asked.answer }} <span class="vk-faint">· {{ shownCount }} row{{ shownCount === 1 ? '' : 's' }}</span></p>
          <div class="asked__chips">
            <span v-for="(f, i) in asked.filters" :key="i" class="asked__chip">{{ describe(f) }}</span>
            <span v-for="(s, i) in asked.sort" :key="`s${i}`" class="asked__chip">Sorted by {{ s.field }} {{ s.dir === 'desc' ? '↓' : '↑' }}</span>
            <button type="button" class="asked__clear" @click="clearAsk"><X :size="13" /> Clear</button>
          </div>
        </div>
        <div v-else class="ideas">
          <span class="vk-faint">Try</span>
          <button v-for="i in IDEAS" :key="i" type="button" class="ideas__chip" @click="ask(i)">{{ i }}</button>
        </div>
      </header>

      <div class="grid">
        <AgGridVue
          class="grid__ag"
          :theme="theme"
          :row-data="shown"
          :column-defs="columnDefs"
          :default-col-def="defaultColDef"
          :pinned-bottom-row-data="pinned"
          :quick-filter-text="q"
          :loading="loading"
          :animate-rows="true"
          :tooltip-show-delay="300"
          overlay-no-rows-template="<span style='padding: 24px; color: var(--vk-muted)'>No milestones yet. Create a contract and they'll appear here.</span>"
          @grid-ready="onReady"
          @model-updated="totals"
          @cell-clicked="onCell"
        />
      </div>
    </div>
  </AppShell>
</template>

<style scoped>
.ledger { padding-bottom: 20px; }
.ask {
  display: flex; align-items: center; gap: 10px; padding: 6px 6px 6px 16px;
  border: 1px solid var(--vk-line-strong); border-radius: var(--vk-r-full); background: var(--vk-surface);
}
.ask:focus-within { border-color: var(--vk-accent); box-shadow: 0 0 0 3px var(--vk-accent-soft); }
.ask__icon { flex: none; color: var(--vk-accent-text); }
.ask__input { flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; font: var(--vk-type-body); color: var(--vk-ink); }
.ask__input::placeholder { color: var(--vk-faint); }
.asked { display: flex; align-items: center; justify-content: space-between; gap: 8px 16px; flex-wrap: wrap; }
.asked__answer { margin: 0; font: var(--vk-type-dense); color: var(--vk-ink); }
.asked__chips { display: flex; flex-wrap: wrap; gap: 6px; }
.asked__chip { padding: 3px 10px; border: 1px solid var(--vk-accent-line); border-radius: var(--vk-r-full); background: var(--vk-accent-soft); font: var(--vk-type-small); color: var(--vk-accent-text); }
.asked__clear, .ideas__chip {
  display: inline-flex; align-items: center; gap: 4px; padding: 3px 10px; border: 1px solid var(--vk-line); border-radius: var(--vk-r-full);
  background: var(--vk-surface); font: var(--vk-type-small); color: var(--vk-ink-2); cursor: pointer;
}
.asked__clear:hover, .ideas__chip:hover { border-color: var(--vk-line-strong); }
.ideas { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; font: var(--vk-type-small); }
.head { padding-top: 20px; display: flex; flex-direction: column; gap: 18px; }
.head__row { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px 40px; flex-wrap: wrap; }
.head__title { margin: 0; font: 400 44px/1 var(--vk-font); letter-spacing: -.04em; }
.head__sub { margin: 10px 0 0; max-width: 60ch; font: var(--vk-type-body); color: var(--vk-muted); }
.head__stats .vk-stat__n { font: var(--vk-num-28); }
.tools { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.tools__right { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.find {
  display: flex; align-items: center; gap: 8px; height: var(--vk-h-xl); padding: 0 16px; box-sizing: border-box;
  border: 1px solid var(--vk-line-strong); border-radius: var(--vk-r-full); background: var(--vk-surface); color: var(--vk-faint);
}
.find:focus-within { border-color: var(--vk-accent); box-shadow: 0 0 0 4px var(--vk-focus); }
.find__input { width: 220px; border: 0; outline: none; background: transparent; font: var(--vk-type-dense); color: var(--vk-ink); }

.grid { flex: 1; min-height: 360px; padding-top: 16px; }
.grid__ag { height: 100%; }
.grid :deep(.cell-strong) { color: var(--vk-ink); }
.grid :deep(.cell-id) { color: var(--vk-muted); cursor: copy; }
.grid :deep(.ag-row:not(.ag-row-pinned)) { cursor: pointer; }
.grid :deep(.ag-row-pinned) { font-family: var(--vk-mono); }
.grid :deep(.ag-cell) { display: flex; align-items: center; }
.grid :deep(.ag-right-aligned-cell) { justify-content: flex-end; }

@media (max-width: 1100px) {
  .grid { height: 70vh; flex: none; }
}
@media (max-width: 640px) {
  .head__title { font-size: 34px; }
  .find__input { width: 140px; }
}
</style>
