<!--
  QueueCapsule — the top bar's inverted capsule (the Workspace schedule bar), answering one question
  from any page: what is waiting on me? Your moves first — the first one in cobalt — then anything the
  agent is doing right now. Each item opens the contract with that action ready.
-->
<script setup>
import { computed } from 'vue'
import { ArrowUpRight, Check } from 'lucide-vue-next'

const props = defineProps({
  rows: { type: Array, default: () => [] },     // [{ c, step }]
  max: { type: Number, default: 3 },
})

const mine = computed(() => props.rows.filter((r) => r.step?.actor === 'you'))
const agent = computed(() => props.rows.filter((r) => r.step?.actor === 'agent'))
const items = computed(() => [...mine.value, ...agent.value].slice(0, props.max).map((r) => ({
  id: r.c.id,
  label: r.step.short || r.step.title,
  where: r.c.title,
  mine: r.step.actor === 'you',
  to: r.to || (r.step.actor === 'you' && r.step.action ? { path: `/contracts/${r.c.id}`, query: { act: r.step.action } } : `/contracts/${r.c.id}`),
})))
const more = computed(() => mine.value.length + agent.value.length - items.value.length)
</script>

<template>
  <nav class="queue" aria-label="Your queue">
    <span class="queue__label">Your queue</span>
    <span class="queue__count vk-num" :class="{ 'is-zero': !mine.length }">{{ mine.length }}</span>

    <template v-if="items.length">
      <RouterLink
        v-for="(it, i) in items" :key="it.id" :to="it.to" class="queue__item"
        :class="{ 'is-first': i === 0 && it.mine, 'is-agent': !it.mine }"
      >
        <span class="queue__dot" aria-hidden="true" />
        <span class="queue__what">{{ it.label }}</span>
        <span class="queue__where">{{ it.where }}</span>
        <span v-if="i === 0 && it.mine" class="queue__go" aria-hidden="true"><ArrowUpRight :size="14" :stroke-width="2.2" /></span>
      </RouterLink>
      <span v-if="more > 0" class="queue__more vk-num">+{{ more }}</span>
    </template>
    <span v-else class="queue__clear"><Check :size="14" :stroke-width="2.2" /> Nothing waiting on you</span>
  </nav>
</template>

<style scoped>
.queue {
  --q-fg: var(--vk-on-ink);
  --q-muted: color-mix(in srgb, var(--vk-on-ink) 68%, var(--vk-ink));
  --q-line: color-mix(in srgb, var(--vk-on-ink) 20%, var(--vk-ink));
  display: flex; align-items: center; gap: 6px; min-width: 0; height: 52px; padding: 0 6px 0 20px; box-sizing: border-box;
  border-radius: var(--vk-r-full); background: var(--vk-ink); color: var(--q-fg); overflow: hidden;
}
.queue__label { flex: none; font: 400 14px/1 var(--vk-font); letter-spacing: -.01em; }
.queue__count {
  flex: none; display: grid; place-items: center; min-width: 22px; height: 22px; margin: 0 8px 0 2px; padding: 0 6px; box-sizing: border-box;
  border-radius: var(--vk-r-full); background: var(--vk-accent); color: #fff; font-size: 11px;
}
.queue__count.is-zero { background: transparent; color: var(--q-muted); box-shadow: inset 0 0 0 1px var(--q-line); }

.queue__item {
  display: inline-flex; align-items: center; gap: 8px; min-width: 0; height: 40px; padding: 0 14px;
  border: 1px solid var(--q-line); border-radius: var(--vk-r-full);
  color: var(--q-fg); text-decoration: none !important; white-space: nowrap;
  transition: background var(--vk-dur-2), border-color var(--vk-dur-2);
}
.queue__item:hover { background: color-mix(in srgb, var(--vk-on-ink) 8%, var(--vk-ink)); }
.queue__dot { width: 7px; height: 7px; flex: none; border-radius: 50%; background: var(--vk-accent); }
.queue__what { font: 400 13px/1 var(--vk-font); }
.queue__where { min-width: 0; overflow: hidden; text-overflow: ellipsis; font: var(--vk-type-small); color: var(--q-muted); }
.queue__item.is-agent .queue__dot { background: var(--vk-warn); animation: vk-beacon 1.3s ease-in-out infinite; }
.queue__item.is-agent .queue__what { color: var(--q-muted); }

/* the first move is the cobalt segment, with its round arrow */
.queue__item.is-first { flex: 0 1 auto; padding-right: 4px; border-color: transparent; background: var(--vk-accent); color: #fff; }
.queue__item.is-first:hover { background: var(--vk-accent-hover); }
.queue__item.is-first .queue__dot { background: #fff; }
.queue__item.is-first .queue__where { color: #fff; }
.queue__go { display: grid; place-items: center; width: 32px; height: 32px; margin-left: 4px; flex: none; border-radius: 50%; background: #fff; color: var(--vk-accent); }
.queue__item:not(.is-first) { flex: 0 1 auto; }

.queue__more { flex: none; padding: 0 10px; font-size: 12px; color: var(--q-muted); }
.queue__clear { display: inline-flex; align-items: center; gap: 8px; padding: 0 12px 0 4px; font: var(--vk-type-dense); color: var(--q-muted); white-space: nowrap; }
.queue__clear svg { color: var(--vk-rail-ok); }
</style>
