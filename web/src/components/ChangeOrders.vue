<!--
  ChangeOrders — after signing, a new ask goes through the agent instead of an argument: it says which
  signed check already covers it (owed, no extra charge), or drafts a priced milestone the other side
  accepts, counters or declines. An accepted change becomes the next milestone, funded through PayPal.
-->
<script setup>
import { ref, computed } from 'vue'
import { GitPullRequestArrow, Check, X } from 'lucide-vue-next'
import VCard from '@/components/ui/VCard.vue'
import VButton from '@/components/ui/VButton.vue'
import VPill from '@/components/ui/VPill.vue'
import { api } from '@/services'
import { toast } from '@/composables/useToast'
import { money, toCents, firstName, timeAgo } from '@/domain/format'

const props = defineProps({
  contract: { type: Object, required: true },
  role: { type: String, default: null },
})
const list = computed(() => [...(props.contract.changes || [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt)))
const name = (r) => firstName((r === 'client' ? props.contract.client : props.contract.freelancer)?.name || r)
const decider = (ch) => (ch.pricedBy === 'agent' ? (ch.requestedBy === 'client' ? 'freelancer' : 'client') : ch.pricedBy === 'client' ? 'freelancer' : 'client')
const STATUS = {
  reviewing: { label: 'Checking the terms', tone: 'warn', live: true },
  in_scope: { label: 'Already covered', tone: 'accent' },
  proposed: { label: 'Change order', tone: 'neutral' },
  accepted: { label: 'Added', tone: 'ok' },
  declined: { label: 'Declined', tone: 'neutral' },
  error: { label: 'Not reviewed', tone: 'danger' },
}

const open = ref(false)
const text = ref('')
const busy = ref('')
async function submit() {
  busy.value = 'new'
  try {
    await api.requestChange(props.contract.id, text.value.trim())
    text.value = ''
    open.value = false
    toast('Checking it against the signed terms')
  } catch (e) {
    toast(e.message, { tone: 'danger' })
  } finally {
    busy.value = ''
  }
}
const counter = ref({})   // id → { amount, days }
async function act(ch, kind) {
  busy.value = `${kind}:${ch.id}`
  try {
    if (kind === 'accept') {
      await api.acceptChange(ch.id)
      toast(`Added as the next milestone — ${money(ch.amountCents, props.contract.currency)}`, { tone: 'ok' })
    } else if (kind === 'decline') {
      await api.declineChange(ch.id)
    } else {
      const c = counter.value[ch.id]
      await api.counterChange(ch.id, { amountCents: toCents(c.amount), dueDays: Number(c.days) })
      counter.value = { ...counter.value, [ch.id]: null }
      toast(`Countered at ${money(toCents(c.amount), props.contract.currency)}`)
    }
  } catch (e) {
    toast(e.message, { tone: 'danger' })
  } finally {
    busy.value = ''
  }
}
const startCounter = (ch) => { counter.value = { ...counter.value, [ch.id]: { amount: String(ch.amountCents / 100), days: String(ch.dueDays) } } }
</script>

<template>
  <VCard title="Changes" sub="New asks are checked against the signed terms first.">
    <div class="co">
      <form v-if="open" class="co__new" @submit.prevent="submit">
        <textarea v-model="text" class="vk-textarea" rows="3" :placeholder="role === 'client' ? 'What else do you need? e.g. “Add a blog with three posts”' : 'What did the client ask for? e.g. “They want a booking page now”'" />
        <div class="co__row">
          <VButton type="submit" size="sm" :loading="busy === 'new'" :disabled="text.trim().length < 8">Check it</VButton>
          <VButton size="sm" variant="ghost" @click="open = false">Cancel</VButton>
        </div>
      </form>
      <VButton v-else size="sm" variant="secondary" :icon="GitPullRequestArrow" @click="open = true">Request a change</VButton>

      <ol v-if="list.length" class="co__list">
        <li v-for="ch in list" :key="ch.id" class="co__item">
          <div class="co__head">
            <VPill size="sm" :tone="STATUS[ch.status]?.tone" :live="STATUS[ch.status]?.live">{{ STATUS[ch.status]?.label || ch.status }}</VPill>
            <span class="vk-faint co__when">{{ name(ch.requestedBy) }} · {{ timeAgo(ch.createdAt) }}</span>
          </div>
          <p class="co__ask">“{{ ch.request }}”</p>
          <p v-if="ch.reply" class="co__reply">{{ ch.reply }}</p>
          <p v-if="ch.status === 'in_scope' && ch.coveredBy" class="co__covered"><Check :size="13" aria-hidden="true" /> {{ ch.coveredBy }}</p>

          <div v-if="['proposed', 'accepted'].includes(ch.status)" class="co__offer">
            <div class="co__offer-top">
              <span class="co__title">{{ ch.title }}</span>
              <span class="vk-num">{{ money(ch.amountCents, contract.currency, { whole: true }) }} · {{ ch.dueDays }}d</span>
            </div>
            <ul class="co__done"><li v-for="(d, i) in ch.doneMeans" :key="i">{{ d }}</li></ul>
            <p class="vk-faint co__priced">{{ ch.pricedBy === 'agent' ? 'Priced by the agent from this contract’s rates' : `Countered by ${name(ch.pricedBy)}` }}</p>
          </div>

          <template v-if="ch.status === 'proposed'">
            <div v-if="counter[ch.id]" class="co__counter">
              <div class="vk-affix"><span class="vk-affix__pre">$</span><input v-model="counter[ch.id].amount" class="vk-input vk-num" inputmode="decimal" aria-label="Your price" /></div>
              <div class="vk-affix"><input v-model="counter[ch.id].days" class="vk-input vk-num" inputmode="numeric" aria-label="Days" /><span class="vk-affix__post">days</span></div>
              <VButton size="sm" :loading="busy === `counter:${ch.id}`" @click="act(ch, 'counter')">Send</VButton>
            </div>
            <div v-else-if="role === decider(ch)" class="co__row">
              <VButton size="sm" :icon="Check" :loading="busy === `accept:${ch.id}`" @click="act(ch, 'accept')">Accept {{ money(ch.amountCents, contract.currency, { whole: true }) }}</VButton>
              <VButton size="sm" variant="secondary" @click="startCounter(ch)">Counter</VButton>
              <VButton size="sm" variant="ghost" :icon="X" :loading="busy === `decline:${ch.id}`" @click="act(ch, 'decline')">Decline</VButton>
            </div>
            <p v-else class="vk-faint co__wait">Waiting for {{ name(decider(ch)) }} to accept, counter or decline.</p>
          </template>
        </li>
      </ol>
    </div>
  </VCard>
</template>

<style scoped>
.co { display: flex; flex-direction: column; gap: 14px; align-items: stretch; }
.co > .vk-btn { align-self: flex-start; }
.co__new { display: flex; flex-direction: column; gap: 8px; }
.co__row { display: flex; gap: 8px; flex-wrap: wrap; }
.co__list { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; }
.co__item { display: flex; flex-direction: column; gap: 8px; padding: 14px 0; border-top: 1px solid var(--vk-line-subtle); }
.co__head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.co__when { font: var(--vk-type-small); }
.co__ask { margin: 0; font: var(--vk-type-dense); color: var(--vk-ink); }
.co__reply { margin: 0; font: var(--vk-type-small); color: var(--vk-ink-2); }
.co__covered { display: flex; gap: 6px; align-items: baseline; margin: 0; padding: 8px 10px; border-radius: var(--vk-r-sm); background: var(--vk-accent-soft); font: var(--vk-type-small); color: var(--vk-ink-2); }
.co__offer { padding: 10px 12px; border: 1px solid var(--vk-line); border-radius: var(--vk-r-sm); background: var(--vk-surface-2); display: flex; flex-direction: column; gap: 6px; }
.co__offer-top { display: flex; justify-content: space-between; gap: 10px; font: var(--vk-type-dense); color: var(--vk-ink); }
.co__done { margin: 0; padding-left: 16px; display: flex; flex-direction: column; gap: 3px; font: var(--vk-type-small); color: var(--vk-ink-2); }
.co__priced, .co__wait { margin: 0; font: var(--vk-type-small); }
.co__counter { display: grid; grid-template-columns: 1fr 0.8fr auto; gap: 8px; align-items: center; }
</style>
