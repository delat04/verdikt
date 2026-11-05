<!--
  CommandPalette — ⌘K / Ctrl+K from anywhere. Your moves first (each opens the contract with the
  action ready), then contracts, places, theme and — in demo mode — persona switching.
  ↑/↓ moves the gliding highlight, Enter opens, Esc closes.
-->
<script setup>
import { ref, computed, watch, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import {
  Search, FileText, Plus, KeyRound, Settings, Shapes, Sun, Moon, Monitor, Wallet, PenLine, Send, Eye,
  UserPlus, Users, RotateCcw, LayoutGrid, CornerDownLeft, ReceiptText,
} from 'lucide-vue-next'
import { vGlide } from '@/directives/glide'
import { useTheme } from '@/composables/useTheme'
import { useAuthStore } from '@/stores/auth'
import { api, isDemo } from '@/services'
import { CONTRACT_STATUS } from '@/domain/milestone'

const open = defineModel('open', { type: Boolean, default: false })
const props = defineProps({ rows: { type: Array, default: () => [] } })
const emit = defineEmits(['persona', 'reset'])

const router = useRouter()
const auth = useAuthStore()
const { setTheme } = useTheme()

const q = ref('')
const active = ref(0)
const input = ref(null)
const list = ref(null)

const ACTION_ICON = { invite: UserPlus, sign: PenLine, fund: Wallet, submit: Send, resubmit: Eye, review: Eye }

const all = computed(() => {
  const items = []
  for (const r of props.rows) {
    if (r.step?.actor !== 'you') continue
    items.push({
      id: `do-${r.c.id}`, group: 'Your move', icon: ACTION_ICON[r.step.action] || FileText, accent: true,
      label: r.step.title, sub: r.c.title,
      to: r.step.action ? { path: `/contracts/${r.c.id}`, query: { act: r.step.action } } : `/contracts/${r.c.id}`,
    })
  }
  for (const r of props.rows) {
    items.push({
      id: `c-${r.c.id}`, group: 'Contracts', icon: FileText, label: r.c.title,
      sub: [CONTRACT_STATUS[r.c.status]?.label, r.other?.name].filter(Boolean).join(' · '), to: `/contracts/${r.c.id}`,
    })
  }
  items.push(
    { id: 'home', group: 'Go to', icon: LayoutGrid, label: 'All contracts', to: '/contracts', keys: 'home dashboard' },
    { id: 'ledger', group: 'Go to', icon: ReceiptText, label: 'Ledger', to: '/ledger', keys: 'payments payouts earnings spend money csv export' },
    { id: 'new', group: 'Go to', icon: Plus, label: 'New contract', to: '/contracts/new', keys: 'create start brief' },
    { id: 'join', group: 'Go to', icon: KeyRound, label: 'Join with an invite code', to: '/join', keys: 'invitation code' },
    { id: 'settings', group: 'Go to', icon: Settings, label: 'Settings', to: '/settings', keys: 'profile paypal payout' },
    { id: 'design', group: 'Go to', icon: Shapes, label: 'Design system', to: '/design', keys: 'tokens components' },
    { id: 'light', group: 'Theme', icon: Sun, label: 'Light theme', run: () => setTheme('light') },
    { id: 'dark', group: 'Theme', icon: Moon, label: 'Dark theme', run: () => setTheme('dark') },
    { id: 'system', group: 'Theme', icon: Monitor, label: 'Match the device', run: () => setTheme('system') },
  )
  if (isDemo) {
    for (const [key, p] of Object.entries(api.personas())) {
      if (p.id === auth.user?.id) continue
      items.push({ id: `as-${key}`, group: 'Demo', icon: Users, label: `View as ${p.name}`, sub: `the ${key}`, keys: 'switch persona', run: () => emit('persona', key) })
    }
    items.push(
      { id: 'sample', group: 'Demo', icon: FileText, label: 'Load a sample contract', keys: 'example', run: async () => { const { id } = await api.loadSample(); router.push(`/contracts/${id}`) } },
      { id: 'reset', group: 'Demo', icon: RotateCcw, label: 'Reset the demo', keys: 'clear', run: () => emit('reset') },
    )
  }
  return items
})

const results = computed(() => {
  const t = q.value.trim().toLowerCase()
  if (!t) {
    let shown = 0
    return all.value.filter((i) => i.group !== 'Contracts' || shown++ < 5)
  }
  return all.value.filter((i) => `${i.label} ${i.sub || ''} ${i.group} ${i.keys || ''}`.toLowerCase().includes(t)).slice(0, 30)
})
const groups = computed(() => {
  const out = []
  results.value.forEach((it, index) => {
    let g = out[out.length - 1]
    if (!g || g.name !== it.group) out.push((g = { name: it.group, items: [] }))
    g.items.push({ ...it, index })
  })
  return out
})

watch(q, () => { active.value = 0 })
watch(open, async (o) => {
  if (!o) return
  q.value = ''
  active.value = 0
  await nextTick()
  input.value?.focus()
})
watch(active, async () => {
  await nextTick()
  list.value?.querySelector('.is-active')?.scrollIntoView({ block: 'nearest' })
})

// only a real pointer move takes the highlight (scrolling under a still cursor fires mousemove too)
let last = ''
function hover(e, index) {
  const at = `${e.screenX},${e.screenY}`
  if (at === last) return
  last = at
  active.value = index
}

function choose(it) {
  if (!it) return
  open.value = false
  if (it.to) router.push(it.to)
  else it.run?.()
}
function onKey(e) {
  const n = results.value.length
  if (e.key === 'ArrowDown') { e.preventDefault(); active.value = n ? (active.value + 1) % n : 0 }
  else if (e.key === 'ArrowUp') { e.preventDefault(); active.value = n ? (active.value - 1 + n) % n : 0 }
  else if (e.key === 'Enter') { e.preventDefault(); choose(results.value[active.value]) }
  else if (e.key === 'Escape') { e.preventDefault(); open.value = false }
}
const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)
</script>

<template>
  <Teleport to="body">
    <Transition name="vk-fade">
      <div v-if="open" class="vk-scrim pal-scrim" @mousedown.self="open = false">
        <div class="pal" role="dialog" aria-modal="true" aria-label="Search and commands">
          <div class="pal__search">
            <Search :size="18" :stroke-width="1.9" aria-hidden="true" />
            <input
              ref="input" v-model="q" class="pal__input" placeholder="Search contracts and actions…"
              role="combobox" aria-expanded="true" aria-controls="pal-list" :aria-activedescendant="results.length ? `pal-${active}` : undefined"
              autocomplete="off" spellcheck="false" @keydown="onKey"
            />
            <kbd class="vk-kbd">esc</kbd>
          </div>

          <div id="pal-list" ref="list" v-glide class="pal__list" role="listbox" aria-label="Results">
            <template v-for="g in groups" :key="g.name">
              <p class="pal__group" role="presentation">{{ g.name }}</p>
              <button
                v-for="it in g.items" :id="`pal-${it.index}`" :key="it.id" type="button" role="option" tabindex="-1"
                class="pal__item" :class="{ 'is-active': it.index === active }" :aria-selected="it.index === active"
                @mousemove="hover($event, it.index)" @click="choose(it)"
              >
                <span class="pal__icon" :class="{ 'is-accent': it.accent }"><component :is="it.icon" :size="16" :stroke-width="1.9" /></span>
                <span class="pal__label">{{ it.label }}</span>
                <span v-if="it.sub" class="pal__sub">{{ it.sub }}</span>
                <CornerDownLeft v-if="it.index === active" class="pal__enter" :size="14" :stroke-width="2" aria-hidden="true" />
              </button>
            </template>
            <p v-if="!results.length" class="pal__empty">Nothing matches “{{ q }}”.</p>
          </div>

          <div class="pal__foot">
            <span><kbd class="vk-kbd">↑</kbd><kbd class="vk-kbd">↓</kbd> move</span>
            <span><kbd class="vk-kbd">↵</kbd> open</span>
            <span class="pal__foot-end"><kbd class="vk-kbd">{{ mac ? '⌘' : 'Ctrl' }}</kbd><kbd class="vk-kbd">K</kbd> anywhere</span>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.pal-scrim { place-items: start center; padding-top: min(14vh, 120px); }
.pal {
  width: min(100%, 640px); display: flex; flex-direction: column; max-height: min(560px, calc(100dvh - 120px));
  border: 1px solid var(--vk-line); border-radius: var(--vk-r-xl); background: var(--vk-surface); box-shadow: var(--vk-elev-modal); overflow: hidden;
}
.pal__search { display: flex; align-items: center; gap: 12px; padding: 0 18px; height: 64px; border-bottom: 1px solid var(--vk-line); color: var(--vk-faint); flex: none; }
.pal__input { flex: 1; min-width: 0; height: 100%; border: 0; outline: none; background: transparent; font: 400 16px/1 var(--vk-font); color: var(--vk-ink); }
.pal__input::placeholder { color: var(--vk-faint); }
.pal__list { flex: 1; overflow-y: auto; padding: 6px 8px 10px; }
.pal__list::before { border-radius: var(--vk-r-md); background: var(--vk-selected); }
.pal__group { margin: 12px 12px 6px; font: var(--vk-num-11); letter-spacing: .1em; text-transform: uppercase; color: var(--vk-faint); }
.pal__item {
  display: flex; align-items: center; gap: 12px; width: 100%; min-height: 48px; padding: 6px 12px;
  border: 0; border-radius: var(--vk-r-md); background: transparent; color: var(--vk-ink-2); font: inherit; text-align: left; cursor: pointer;
}
.pal__item.is-active { color: var(--vk-ink); }
.pal__icon { display: grid; place-items: center; flex: none; width: 34px; height: 34px; border-radius: 50%; border: 1px solid var(--vk-line); background: var(--vk-surface); color: var(--vk-ink-2); }
.pal__icon.is-accent { border-color: var(--vk-accent); background: var(--vk-accent); color: var(--vk-on-accent); }
.pal__label { font: 400 14px/20px var(--vk-font); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 0 1 auto; min-width: 0; }
.pal__sub { flex: 1 1 auto; min-width: 0; font: var(--vk-type-small); color: var(--vk-faint); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pal__enter { flex: none; margin-left: auto; color: var(--vk-faint); }
.pal__empty { margin: 24px 12px; font: var(--vk-type-dense); color: var(--vk-muted); text-align: center; }
.pal__foot { display: flex; align-items: center; gap: 18px; padding: 12px 18px; border-top: 1px solid var(--vk-line-subtle); font: var(--vk-type-small); color: var(--vk-faint); flex: none; }
.pal__foot span { display: inline-flex; align-items: center; gap: 4px; }
.pal__foot-end { margin-left: auto; }
@media (max-width: 640px) {
  .pal-scrim { padding: 12px; }
  .pal__sub { display: none; }
  .pal__foot { display: none; }
}
</style>
