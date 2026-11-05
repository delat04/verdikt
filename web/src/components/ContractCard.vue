<!--
  ContractCard — one contract on Home, as a notch card (the whole card opens it). Reads top to bottom:
  who it's with → what it is → where the money is (mini rail) → what happens next and whose move it is.
-->
<script setup>
import { computed } from 'vue'
import VNotchCard from './ui/VNotchCard.vue'
import VAvatar from './ui/VAvatar.vue'
import VPill from './ui/VPill.vue'
import StatusPill from './StatusPill.vue'
import MiniRail from './MiniRail.vue'
import { money, firstName } from '@/domain/format'
import { termsSigned } from '@/domain/milestone'

const props = defineProps({ row: { type: Object, required: true } })   // { c, role, other, step, totals }
const c = computed(() => props.row.c)
const room = computed(() => (c.value.status === 'scoping' ? c.value.room?.terms : null))
const onTable = computed(() => room.value?.milestones.reduce((s, m) => s + m.amount_cents, 0) || 0)
const actor = computed(() => ({
  you: 'Your move',
  them: props.row.other ? `${firstName(props.row.other.name)}'s move` : 'Waiting',
  agent: 'Agent',
}[props.row.step?.actor] || ''))
</script>

<template>
  <VNotchCard :to="`/contracts/${c.id}`" class="cc" :aria-label="`${c.title} — ${row.step?.title || ''}`">
    <div class="cc__who vk-notch__head">
      <VAvatar :name="row.other?.name || '?'" size="lg" />
      <div class="cc__who-text">
        <span class="cc__name">{{ row.other?.name || 'Not joined yet' }}</span>
        <span class="cc__role">{{ row.role === 'client' ? 'Freelancer' : 'Client' }} · you're the {{ row.role }}</span>
      </div>
    </div>

    <h3 class="cc__title">{{ c.title }}</h3>
    <div class="cc__tags">
      <StatusPill :status="c.status" contract size="sm" />
      <VPill v-if="room" size="sm" :dot="false" outline>Terms v{{ room.version }}</VPill>
      <VPill v-else size="sm" :dot="false" outline>{{ c.milestones.length }} milestone{{ c.milestones.length > 1 ? 's' : '' }}</VPill>
    </div>

    <div v-if="room" class="cc__money">
      <p class="cc__sum">
        <span class="vk-num">{{ onTable ? money(onTable, c.currency, { whole: true }) : '—' }}</span>
        <span class="vk-faint"> on the table · {{ room.milestones.length || 'no' }} payment{{ room.milestones.length === 1 ? '' : 's' }} drafted</span>
      </p>
    </div>
    <div v-else class="cc__money">
      <MiniRail :milestones="c.milestones" :signed="termsSigned(c)" />
      <p class="cc__sum">
        <span class="vk-num cc__paid">{{ money(row.totals.released, c.currency, { whole: true }) }}</span>
        <span class="vk-faint"> paid of </span>
        <span class="vk-num">{{ money(row.totals.total, c.currency, { whole: true }) }}</span>
        <span v-if="row.totals.held" class="cc__held vk-faint"> · <span class="vk-num">{{ money(row.totals.held, c.currency, { whole: true }) }}</span> held</span>
      </p>
    </div>

    <p v-if="row.step" class="cc__next" :class="`is-${row.step.actor}`">
      <span class="cc__dot" aria-hidden="true" />
      <span class="cc__next-text">{{ row.step.short || row.step.title }}</span>
      <span v-if="actor" class="cc__actor">{{ actor }}</span>
    </p>
  </VNotchCard>
</template>

<style scoped>
.cc { min-height: 280px; }
.cc__who { display: flex; align-items: center; gap: 12px; }
.cc__who-text { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.cc__name { font: 400 14px/18px var(--vk-font); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cc__role { font: var(--vk-type-small); color: var(--vk-faint); }
.cc__title { margin: 22px 0 0; font: 400 21px/26px var(--vk-font); letter-spacing: -.025em; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.cc__tags { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 12px; }
.cc__money { margin-top: auto; padding-top: 22px; }
.cc__sum { margin: 10px 0 0; font: var(--vk-type-small); }
.cc__paid { color: var(--vk-ink); }
.cc__next {
  display: flex; align-items: center; gap: 10px; margin: 16px -22px -22px; padding: 14px 22px;
  border-top: 1px solid var(--vk-line-subtle); font: var(--vk-type-dense); color: var(--vk-muted);
}
.cc__dot { width: 8px; height: 8px; border-radius: 50%; flex: none; background: var(--vk-line-strong); }
.cc__next-text { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cc__actor { flex: none; font: var(--vk-num-11); letter-spacing: .06em; text-transform: uppercase; color: var(--vk-faint); }
.cc__next.is-you { color: var(--vk-ink); }
.cc__next.is-you .cc__dot { background: var(--vk-accent); box-shadow: 0 0 0 3px var(--vk-accent-soft); }
.cc__next.is-you .cc__actor { color: var(--vk-accent-text); }
.cc__next.is-agent .cc__dot { background: var(--vk-warn); animation: vk-beacon 1.3s ease-in-out infinite; }
</style>
