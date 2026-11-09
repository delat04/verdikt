<!--
  Timeline — every contract's milestones on one Bryntum Gantt, with what PayPal is doing underneath: each
  milestone's work bar (to its due date), the PayPal hold (an authorization is good for 29 days) and its 3-day honor
  period (after which Verdikt renews it), and the moments money moved (delivered, renewed, paid).
  Dragging the end of a work bar doesn't move the date: it proposes the new date to the other side, who accepts or
  declines. Signed dates change only when both agree.
-->
<script setup>
import { ref, computed } from 'vue'
import { BryntumGantt } from '@bryntum/gantt-vue-community'
import { CalendarClock, Check, X } from 'lucide-vue-next'
import AppShell from '@/layouts/AppShell.vue'
import VButton from '@/components/ui/VButton.vue'
import VModal from '@/components/ui/VModal.vue'
import VField from '@/components/ui/VField.vue'
import { useLive } from '@/composables/useLive'
import { useAuthStore } from '@/stores/auth'
import { api } from '@/services'
import { toast } from '@/composables/useToast'
import { shortDate, firstName } from '@/domain/format'
import { STATUS, roleOf, counterparty, latestSubmission } from '@/domain/milestone'

const DAY = 864e5
const auth = useAuthStore()
const { data, reload } = useLive(() => api.listContracts())
const contracts = computed(() => (data.value || []).filter((c) => c.milestones?.length && c.status !== 'cancelled'))
const at = (iso) => (iso ? new Date(iso) : null)
const plus = (d, days) => new Date(d.getTime() + days * DAY)
const signed = (c) => !!(c.clientSignedAt && c.freelancerSignedAt)
const settled = (m) => ['released', 'refunded'].includes(m.status)

// ---- the Gantt rows: contract → milestone → work, PayPal hold, honor period, and the moments money moved
const project = computed(() => {
  const tasks = []
  const dependencies = []
  for (const c of contracts.value) {
    const role = roleOf(c, auth.user?.id)
    const other = counterparty(c, role)
    const ms = [...c.milestones].sort((a, b) => a.position - b.position)
    let prevEnd = at(c.clientSignedAt) || at(c.createdAt) || new Date()
    const children = ms.map((m) => {
      const start = at(m.fundedAt) || prevEnd
      let end = at(m.dueAt) || plus(start, 7)
      if (end <= start) end = plus(start, 1)
      prevEnd = end
      const p = m.dueProposal
      const rows = [{
        id: `w:${m.id}`, name: `Work · due ${shortDate(m.dueAt || end.toISOString())}`, startDate: start, endDate: end, manuallyScheduled: true,
        cls: `vk-work is-${m.status}`, draggable: false, resizable: signed(c) && !settled(m) && !p && !!role,
        milestoneId: m.id, contractId: c.id, kind: 'work', label: `M${m.position} · ${m.title}`,
      }]
      if (p) {
        const to = at(p.dueAt)
        rows.push({
          id: `p:${m.id}`, name: `Proposed: due ${shortDate(p.dueAt)}`, startDate: to > end ? end : to, endDate: to > end ? to : end,
          manuallyScheduled: true, cls: 'vk-proposal', draggable: false, resizable: false, kind: 'proposal',
        })
      }
      const authorized = at(m.authorizedAt)
      if (authorized) {
        const expires = at(m.holdExpiresAt) || plus(authorized, 29)
        rows.push({ id: `h:${m.id}`, name: 'PayPal hold', startDate: authorized, endDate: settled(m) ? (at(m.releasedAt) || expires) : expires, manuallyScheduled: true, cls: 'vk-hold', draggable: false, resizable: false, kind: 'hold' })
        rows.push({ id: `o:${m.id}`, name: 'Honor period, 3 days', startDate: authorized, endDate: plus(authorized, 3), manuallyScheduled: true, cls: 'vk-honor', draggable: false, resizable: false, kind: 'honor' })
      }
      const moments = [
        [latestSubmission(m)?.createdAt, 'Delivered', 'vk-moment'],
        [m.reauthorizedAt, 'Hold renewed', 'vk-moment'],
        [m.status === 'released' ? m.releasedAt : null, 'Paid', 'vk-paid'],
      ]
      for (const [when, name, cls] of moments) {
        if (when) rows.push({ id: `${name}:${m.id}`, name, startDate: at(when), duration: 0, manuallyScheduled: true, cls, draggable: false, resizable: false, kind: 'moment' })
      }
      return {
        id: `m:${m.id}`, name: `M${m.position} · ${m.title}`, expanded: true, cls: 'vk-milestone',
        status: STATUS[m.status]?.label || m.status, children: rows,
      }
    })
    ms.slice(1).forEach((m, i) => dependencies.push({ id: `d:${m.id}`, fromTask: `w:${ms[i].id}`, toTask: `w:${m.id}` }))
    tasks.push({ id: `c:${c.id}`, name: c.title, expanded: true, cls: 'vk-contract', status: other ? `with ${other.name}` : '', children })
  }
  return { tasks, dependencies }
})

const range = computed(() => {
  const dates = project.value.tasks.flatMap(function walk(t) { return [t.startDate, t.endDate, ...(t.children || []).flatMap(walk)] }).filter(Boolean)
  if (!dates.length) return { startDate: plus(new Date(), -7), endDate: plus(new Date(), 30) }
  return { startDate: plus(new Date(Math.min(...dates)), -3), endDate: plus(new Date(Math.max(...dates)), 7) }
})

const columns = [
  { type: 'name', text: 'Contract and milestone', width: 300 },
  { text: 'Status', field: 'status', width: 140, editor: false },
]

// ---- dragging a work bar's end proposes a date; nothing else on the chart moves
const proposing = ref(null)   // { milestoneId, label, from, to }
const reason = ref('')
const busy = ref('')
// our own fields (kind, milestoneId, label) aren't Bryntum fields: they stay on the record's original data
const own = (r) => r.originalData || {}
const listeners = {
  beforeTaskResize: ({ taskRecord }) => own(taskRecord).kind === 'work' && taskRecord.resizable !== false,
  beforeTaskResizeFinalize: ({ taskRecord, context }) => {
    context.async = true
    const to = context.endDate
    const from = taskRecord.endDate
    context.finalize(false)   // the bar snaps back: the date moves only if the other side accepts
    const { milestoneId, label } = own(taskRecord)
    if (to && milestoneId) {
      proposing.value = { milestoneId, label, from, to }
      reason.value = ''
    }
  },
}
async function propose() {
  busy.value = 'propose'
  try {
    await api.proposeDue(proposing.value.milestoneId, { dueAt: proposing.value.to.toISOString(), reason: reason.value })
    toast(`Proposed — ${proposing.value.label} would be due ${shortDate(proposing.value.to.toISOString())}`)
    proposing.value = null
    await reload()
  } catch (e) {
    toast(e.message, { tone: 'danger' })
  } finally {
    busy.value = ''
  }
}

// ---- date changes waiting on someone
const waiting = computed(() => contracts.value.flatMap((c) => {
  const role = roleOf(c, auth.user?.id)
  const other = counterparty(c, role)
  return c.milestones.filter((m) => m.dueProposal).map((m) => ({ c, m, p: m.dueProposal, mine: m.dueProposal.by === role, other }))
}))
async function answer(w, accept) {
  busy.value = `${accept ? 'accept' : 'decline'}:${w.m.id}`
  try {
    if (accept) await api.acceptDue(w.m.id)
    else await api.declineDue(w.m.id)
    toast(accept ? `M${w.m.position} is now due ${shortDate(w.p.dueAt)}` : w.mine ? 'Proposal withdrawn' : 'Declined — the date stays')
    await reload()
  } catch (e) {
    toast(e.message, { tone: 'danger' })
  } finally {
    busy.value = ''
  }
}

const tooltip = {
  template: ({ taskRecord: r }) => {
    const t = { ...own(r), name: r.name, resizable: r.resizable }
    if (t.kind === 'hold') return 'PayPal holds the money: an authorization, good for 29 days. Charged only when the checks pass.'
    if (t.kind === 'honor') return 'PayPal’s 3-day honor period. After it, Verdikt renews the hold so the money stays guaranteed.'
    if (t.kind === 'work') return t.resizable ? `${t.label}: drag the end to propose a new due date.` : `${t.label}`
    if (t.kind === 'proposal') return 'A date change waiting for the other side.'
    return t.name
  },
}
</script>

<template>
  <AppShell>
    <template #crumbs><span>Timeline</span></template>
    <div class="tl">
      <header class="tl__head">
        <div>
          <p class="vk-eyebrow">Timeline</p>
          <h1 class="tl__title">Every milestone, and what PayPal is doing underneath</h1>
          <p class="tl__sub">Each work bar runs to its due date. Under it, the PayPal hold (29 days) and its 3-day honor period, after which Verdikt renews it. Drag the end of a work bar to propose a new date: it moves only if the other side accepts.</p>
        </div>
        <ul class="tl__legend" aria-label="Legend">
          <li><span class="sw sw--work" /> Work</li>
          <li><span class="sw sw--hold" /> PayPal hold</li>
          <li><span class="sw sw--honor" /> Honor period</li>
          <li><span class="sw sw--proposal" /> Proposed date</li>
          <li><span class="sw sw--paid" /> Paid</li>
        </ul>
      </header>

      <section v-if="waiting.length" class="tl__waiting" aria-label="Date changes waiting">
        <div v-for="w in waiting" :key="w.m.id" class="tl__ask">
          <CalendarClock :size="16" aria-hidden="true" />
          <p>
            <strong>{{ w.c.title }} · M{{ w.m.position }}</strong>
            {{ w.mine ? 'You proposed' : `${firstName(w.other?.name || 'They')} proposed` }} moving the due date from {{ w.p.from ? shortDate(w.p.from) : 'no date' }} to {{ shortDate(w.p.dueAt) }}<template v-if="w.p.reason">: “{{ w.p.reason }}”</template>.
            <span v-if="w.mine" class="vk-faint">Waiting for {{ firstName(w.other?.name || 'them') }}.</span>
          </p>
          <div class="tl__ask-actions">
            <template v-if="!w.mine">
              <VButton size="sm" variant="secondary" :icon="Check" :loading="busy === `accept:${w.m.id}`" :disabled="!!busy" @click="answer(w, true)">Accept</VButton>
              <VButton size="sm" variant="ghost" :icon="X" :loading="busy === `decline:${w.m.id}`" :disabled="!!busy" @click="answer(w, false)">Decline</VButton>
            </template>
            <VButton v-else size="sm" variant="ghost" :loading="busy === `decline:${w.m.id}`" :disabled="!!busy" @click="answer(w, false)">Withdraw</VButton>
          </div>
        </div>
      </section>

      <div v-if="!contracts.length" class="tl__empty">No milestones yet. They show here once a contract has its terms.</div>
      <div v-else class="tl__gantt">
        <BryntumGantt
          :tasks="project.tasks"
          :dependencies="project.dependencies"
          :columns="columns"
          :start-date="range.startDate"
          :end-date="range.endDate"
          view-preset="weekAndDayLetter"
          :row-height="40"
          :bar-margin="8"
          :task-drag-feature="false"
          :task-drag-create-feature="false"
          :task-menu-feature="false"
          :cell-edit-feature="false"
          :cell-menu-feature="false"
          :header-menu-feature="false"
          :task-tooltip-feature="tooltip"
          :listeners="listeners"
        />
      </div>
    </div>

    <VModal :open="!!proposing" title="Propose a new due date" :sub="proposing ? `${proposing.label}: from ${shortDate(proposing.from.toISOString())} to ${shortDate(proposing.to.toISOString())}. The date changes only if the other side accepts.` : ''" @close="proposing = null">
      <VField label="Why" for="tl-reason" optional hint="The other side sees this with the proposal.">
        <input id="tl-reason" v-model="reason" class="vk-input" maxlength="240" placeholder="The client's brand assets arrive on Friday" />
      </VField>
      <template #foot>
        <VButton variant="secondary" @click="proposing = null">Cancel</VButton>
        <VButton :loading="busy === 'propose'" @click="propose">Propose the date</VButton>
      </template>
    </VModal>
  </AppShell>
</template>

<style>
@import '@bryntum/core-community/fontawesome/css/fontawesome.css';
@import '@bryntum/core-community/fontawesome/css/solid.css';
@import '@bryntum/gantt-community/gantt.css';
@import '@bryntum/gantt-community/svalbard-light.css';

/* bars, in Verdikt's colours: ink work, cobalt for the PayPal hold, green only where money moved */
.tl__gantt .b-gantt-task.vk-work { background: var(--vk-ink); }
.tl__gantt .b-gantt-task.vk-work.is-released { background: var(--vk-ink-2); }
.tl__gantt .b-gantt-task.vk-hold { background: var(--vk-accent-soft); border: 1px solid var(--vk-accent-line); color: var(--vk-accent-text); }
.tl__gantt .b-gantt-task.vk-honor { background: var(--vk-accent); }
.tl__gantt .b-gantt-task.vk-proposal { background: transparent; border: 1.5px dashed var(--vk-accent); }
.tl__gantt .vk-paid .b-gantt-task-content { background: var(--vk-ok); }
.tl__gantt .vk-moment .b-gantt-task-content { background: var(--vk-muted); }
.tl__gantt .b-gantt-task.vk-milestone, .tl__gantt .b-gantt-task.vk-contract { background: var(--vk-line); }
</style>

<style scoped>
.tl { display: flex; flex-direction: column; gap: 18px; padding: 28px clamp(16px, 3vw, 36px) 40px; }
.tl__head { display: flex; justify-content: space-between; gap: 24px; align-items: flex-end; flex-wrap: wrap; }
.tl__title { margin: 6px 0 0; font: var(--vk-type-title); letter-spacing: -.03em; color: var(--vk-ink); max-width: 24ch; }
.tl__sub { margin: 8px 0 0; font: var(--vk-type-dense); color: var(--vk-muted); max-width: 72ch; }
.tl__legend { margin: 0; padding: 0; list-style: none; display: flex; gap: 14px; flex-wrap: wrap; font: var(--vk-type-small); color: var(--vk-muted); }
.tl__legend li { display: inline-flex; align-items: center; gap: 6px; }
.sw { width: 18px; height: 8px; border-radius: 3px; display: inline-block; }
.sw--work { background: var(--vk-ink); }
.sw--hold { background: var(--vk-accent-soft); border: 1px solid var(--vk-accent-line); }
.sw--honor { background: var(--vk-accent); }
.sw--proposal { border: 1.5px dashed var(--vk-accent); }
.sw--paid { width: 9px; height: 9px; transform: rotate(45deg); border-radius: 1px; background: var(--vk-ok); }
.tl__waiting { display: flex; flex-direction: column; gap: 8px; }
.tl__ask { display: flex; align-items: center; gap: 12px; padding: 12px 14px; border: 1px solid var(--vk-accent-line); border-radius: var(--vk-r-md); background: var(--vk-accent-soft); }
.tl__ask > svg { flex: none; color: var(--vk-accent-text); }
.tl__ask p { margin: 0; flex: 1; font: var(--vk-type-dense); color: var(--vk-ink-2); }
.tl__ask strong { font-weight: 400; color: var(--vk-ink); }
.tl__ask-actions { display: flex; gap: 6px; flex: none; }
.tl__gantt { height: min(68vh, 640px); min-height: 380px; border: 1px solid var(--vk-line); border-radius: var(--vk-r-md); overflow: hidden; background: var(--vk-surface); }
.tl__empty { padding: 60px 0; text-align: center; font: var(--vk-type-dense); color: var(--vk-muted); }
@media (max-width: 720px) { .tl__ask { flex-wrap: wrap; } }
</style>
