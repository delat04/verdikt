<!--
  AppShell — the app frame.
  · Sidebar: brand, search (⌘K), the pages with labels — the active one carries the gliding pill —
    then design system, theme and you. Below 960px it slides in as a drawer from the menu button.
  · Top bar: back + where you are · the queue capsule (what's waiting on you, from any page) ·
    in demo mode, the persona switch so one person can play both sides.
-->
<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { LayoutGrid, Plus, Settings, Sun, Moon, Monitor, LogOut, Shapes, RotateCcw, Search, ArrowLeft, FlaskConical, Menu, X, ReceiptText } from 'lucide-vue-next'
import BrandMark from '@/components/BrandMark.vue'
import VAvatar from '@/components/ui/VAvatar.vue'
import VButton from '@/components/ui/VButton.vue'
import VSegmented from '@/components/ui/VSegmented.vue'
import QueueCapsule from '@/components/QueueCapsule.vue'
import CommandPalette from '@/components/CommandPalette.vue'
import { vGlide } from '@/directives/glide'
import { useAuthStore } from '@/stores/auth'
import { useTheme } from '@/composables/useTheme'
import { useLive } from '@/composables/useLive'
import { api, isDemo, canLeaveDemo, leaveDemo } from '@/services'
import { toast } from '@/composables/useToast'
import { nextStep, roleOf, counterparty } from '@/domain/milestone'

defineProps({ back: { type: [String, Object], default: null } })

const auth = useAuthStore()
const route = useRoute()
const router = useRouter()
const { theme, setTheme } = useTheme()

const nav = [
  { label: 'Contracts', to: '/contracts', icon: LayoutGrid, match: (p) => p === '/contracts' || /^\/contracts\/(?!new)/.test(p) },
  { label: 'Ledger', to: '/ledger', icon: ReceiptText, match: (p) => p.startsWith('/ledger') },
  { label: 'New contract', to: '/contracts/new', icon: Plus, match: (p) => p === '/contracts/new' },
  { label: 'Settings', to: '/settings', icon: Settings, match: (p) => p.startsWith('/settings') },
]
const THEMES = [
  { value: 'light', label: '', icon: Sun, aria: 'Light theme' },
  { value: 'dark', label: '', icon: Moon, aria: 'Dark theme' },
  { value: 'system', label: '', icon: Monitor, aria: 'Match the device' },
]

// the queue reads every contract once, for the capsule, the badge and the palette
const { data } = useLive(() => api.listContracts())
const rows = computed(() => (data.value || []).map((c) => {
  const role = roleOf(c, auth.user?.id)
  return { c, role, other: counterparty(c, role), step: nextStep(c, role) }
}))
const onYou = computed(() => rows.value.filter((r) => r.step?.actor === 'you').length)

// ---- demo persona switch
const personas = isDemo ? api.personas() : null
const activePersona = computed(() => (personas ? Object.keys(personas).find((k) => personas[k].id === auth.user?.id) : null))
async function switchTo(key) {
  if (key === activePersona.value) return
  await auth.signInAs(key)
  toast(`Now viewing as ${personas[key].name} (${key})`)
  if (!auth.onboarded) router.push({ path: '/onboarding', query: { next: route.fullPath } })
}
const demoOpen = ref(false)
const demoEl = ref(null)
async function resetDemo() {
  demoOpen.value = false
  await api.reset()
  await auth.refresh()
  router.push('/login')
}
async function signOut() {
  await auth.signOut()
  router.push('/login')
}

// ---- drawer (below 960px)
const drawer = ref(false)
watch(() => route.fullPath, () => { drawer.value = false })

// ---- ⌘K / Ctrl+K, and "/" when not typing
const palette = ref(false)
const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)
function onKey(e) {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault()
    palette.value = !palette.value
  } else if (e.key === '/' && !e.target.closest?.('input, textarea, select, [contenteditable]')) {
    e.preventDefault()
    palette.value = true
  } else if (e.key === 'Escape' && drawer.value) {
    drawer.value = false
  }
}
function onPointer(e) {
  if (demoOpen.value && demoEl.value && !demoEl.value.contains(e.target)) demoOpen.value = false
}
onMounted(() => {
  window.addEventListener('keydown', onKey)
  document.addEventListener('pointerdown', onPointer)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  document.removeEventListener('pointerdown', onPointer)
})
</script>

<template>
  <div class="shell" :class="{ 'is-drawer': drawer }">
    <!-- sidebar -->
    <aside class="side" aria-label="Main">
      <div class="side__top">
        <RouterLink to="/contracts" class="side__brand" aria-label="Verdikt — contracts">
          <BrandMark :size="26" />
          <span>Verdikt</span>
        </RouterLink>
        <button type="button" class="vk-icon-btn vk-icon-btn--bare side__close" aria-label="Close menu" @click="drawer = false"><X :size="18" :stroke-width="1.9" /></button>
      </div>

      <button type="button" class="side__search" @click="palette = true">
        <Search :size="16" :stroke-width="1.9" />
        <span>Search</span>
        <span class="side__keys"><kbd class="vk-kbd">{{ mac ? '⌘' : 'Ctrl' }}</kbd><kbd class="vk-kbd">K</kbd></span>
      </button>

      <p class="side__group">Workspace</p>
      <nav v-glide class="side__nav">
        <RouterLink
          v-for="item in nav" :key="item.to" :to="item.to" class="side__link"
          :class="{ 'is-active': item.match(route.path) }" :aria-current="item.match(route.path) ? 'page' : undefined"
        >
          <component :is="item.icon" :size="18" :stroke-width="1.9" />
          <span class="side__label">{{ item.label }}</span>
          <span v-if="item.to === '/contracts' && onYou" class="side__badge vk-num" :title="`${onYou} waiting on you`">{{ onYou }}</span>
        </RouterLink>
      </nav>

      <div class="side__foot">
        <RouterLink to="/design" class="side__link side__link--quiet"><Shapes :size="17" :stroke-width="1.9" /><span class="side__label">Design system</span></RouterLink>
        <VSegmented :model-value="theme" :options="THEMES" block label="Theme" class="side__theme" @update:model-value="setTheme" />
        <div class="side__me">
          <RouterLink to="/settings" class="side__who" :title="`${auth.name} — settings`">
            <VAvatar :name="auth.name" />
            <span class="side__who-text">
              <span class="side__name">{{ auth.name }}</span>
              <span class="side__mail">{{ auth.user?.email }}</span>
            </span>
          </RouterLink>
          <button type="button" class="vk-icon-btn vk-icon-btn--bare" aria-label="Sign out" title="Sign out" @click="signOut"><LogOut :size="16" :stroke-width="1.9" /></button>
        </div>
      </div>
    </aside>
    <Transition name="vk-fade"><div v-if="drawer" class="side-scrim" aria-hidden="true" @click="drawer = false" /></Transition>

    <div class="main">
      <header class="top">
        <div class="top__left">
          <button type="button" class="vk-icon-btn vk-icon-btn--lg top__menu" aria-label="Open menu" @click="drawer = true"><Menu :size="18" :stroke-width="1.9" /></button>
          <RouterLink v-if="back" :to="back" class="vk-icon-btn vk-icon-btn--lg top__back" aria-label="Back"><ArrowLeft :size="18" :stroke-width="1.9" /></RouterLink>
          <div class="top__crumbs"><slot name="crumbs" /></div>
        </div>

        <QueueCapsule :rows="rows" class="top__queue" />

        <div class="top__right">
          <button type="button" class="vk-icon-btn vk-icon-btn--lg top__search" aria-label="Search" @click="palette = true"><Search :size="17" :stroke-width="1.9" /></button>
          <template v-if="isDemo">
            <div v-glide class="vk-seg persona" role="radiogroup" aria-label="Demo: view as">
              <button
                v-for="(p, key) in personas" :key="key" type="button" role="radio" class="vk-seg__btn"
                :class="{ 'is-active': activePersona === key }" :aria-checked="activePersona === key" :title="`View as ${p.name}, the ${key}`" @click="switchTo(key)"
              >
                <VAvatar :name="p.name" size="sm" />
                <span class="persona__name">{{ p.name.split(' ')[0] }}</span>
              </button>
            </div>
            <div ref="demoEl" class="demo">
              <button type="button" class="demo__chip" :aria-expanded="demoOpen" aria-label="About demo mode" @click="demoOpen = !demoOpen"><FlaskConical :size="14" :stroke-width="2" /><span>Demo</span></button>
              <Transition name="vk-fade">
                <div v-if="demoOpen" class="demo__pop" role="dialog" aria-label="About demo mode">
                  <p class="demo__title">You're in demo mode</p>
                  <p class="demo__text">Everything runs in this browser. PayPal (sandbox) and the agent are simulated, so the whole flow works without keys. Switch between Maya and Sam to play both sides.</p>
                  <VButton size="sm" variant="secondary" :icon="RotateCcw" @click="resetDemo">Reset the demo</VButton>
                  <VButton v-if="canLeaveDemo" size="sm" variant="ghost" @click="leaveDemo">Use a real account</VButton>
                </div>
              </Transition>
            </div>
          </template>
        </div>
      </header>

      <main class="content"><slot /></main>
    </div>

    <CommandPalette v-model:open="palette" :rows="rows" @persona="switchTo" @reset="resetDemo" />
  </div>
</template>

<style scoped>
.shell { display: grid; grid-template-columns: var(--vk-sidebar-w) minmax(0, 1fr); height: 100dvh; background: var(--vk-canvas); }

/* ---- sidebar ---- */
.side {
  display: flex; flex-direction: column; min-height: 0; padding: 18px 14px 14px; box-sizing: border-box;
  border-right: 1px solid var(--vk-line); background: var(--vk-surface); overflow-y: auto;
}
.side__top { display: flex; align-items: center; justify-content: space-between; padding: 2px 6px 0; }
.side__brand { display: inline-flex; align-items: center; gap: 10px; color: var(--vk-ink); font: 400 20px/1 var(--vk-font); letter-spacing: -.03em; text-decoration: none !important; }
.side__close { display: none; }

.side__search {
  display: flex; align-items: center; gap: 10px; height: 40px; margin-top: 22px; padding: 0 8px 0 14px;
  border: 1px solid var(--vk-line-strong); border-radius: var(--vk-r-full); background: var(--vk-surface);
  font: var(--vk-type-dense); color: var(--vk-muted); cursor: pointer; text-align: left;
  transition: border-color var(--vk-dur-2), color var(--vk-dur-2);
}
.side__search:hover { border-color: var(--vk-faint); color: var(--vk-ink); }
.side__search > span:first-of-type { flex: 1; }
.side__keys { display: inline-flex; gap: 3px; }

.side__group { margin: 24px 14px 8px; font: var(--vk-num-11); letter-spacing: .12em; text-transform: uppercase; color: var(--vk-faint); }
.side__nav { display: flex; flex-direction: column; gap: 2px; }
/* the active pill: a raised chip with a hairline, so it reads on white and on near-black */
.side__nav::before { border-radius: var(--vk-r-full); background: var(--vk-surface-2); box-shadow: inset 0 0 0 1px var(--vk-line); }
.side__link {
  display: flex; align-items: center; gap: 12px; height: 42px; padding: 0 14px;
  border-radius: var(--vk-r-full); color: var(--vk-muted); font: 400 14px/1 var(--vk-font); text-decoration: none !important;
  transition: color var(--vk-dur-2), background var(--vk-dur-2);
}
.side__link:hover { color: var(--vk-ink); }
.side__link:not(.is-active):hover { background: var(--vk-hover); }
.side__link.is-active { color: var(--vk-ink); }
.side__label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.side__badge {
  display: grid; place-items: center; min-width: 22px; height: 22px; padding: 0 7px; box-sizing: border-box;
  border-radius: var(--vk-r-full); background: var(--vk-accent); color: var(--vk-on-accent); font-size: 11px;
}

.side__foot { margin-top: auto; padding-top: 20px; display: flex; flex-direction: column; gap: 12px; }
.side__link--quiet { height: 38px; font-size: 13px; }
.side__theme { margin: 0 2px; }
.side__me { display: flex; align-items: center; gap: 6px; padding: 12px 2px 0 6px; border-top: 1px solid var(--vk-line); }
.side__who { display: flex; align-items: center; gap: 10px; flex: 1; min-width: 0; padding: 4px; border-radius: var(--vk-r-full); color: inherit; text-decoration: none !important; }
.side__who:hover { background: var(--vk-hover); }
.side__who-text { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.side__name { font: 400 13px/1.2 var(--vk-font); color: var(--vk-ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.side__mail { font: var(--vk-type-small); color: var(--vk-faint); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.side-scrim { display: none; }

/* ---- top bar: transparent on the canvas ---- */
.main { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
.top {
  display: flex; align-items: center; gap: 16px;
  height: var(--vk-topbar-h); padding: 10px clamp(16px, 2.4vw, 32px) 0; box-sizing: border-box; flex: none;
}
/* left and right share the slack equally, so the capsule sits in the middle; the right side never shrinks */
.top__left { display: flex; align-items: center; gap: 12px; flex: 1 1 0; min-width: 0; }
.top__menu, .top__search { display: none; }
.top__crumbs { min-width: 0; display: flex; align-items: center; gap: 8px; font: var(--vk-type-dense); color: var(--vk-muted); white-space: nowrap; overflow: hidden; }
.top__crumbs :deep(a) { color: var(--vk-muted); }
.top__crumbs :deep(a:hover) { color: var(--vk-ink); }
.top__crumbs :deep(span:last-child) { color: var(--vk-ink); overflow: hidden; text-overflow: ellipsis; }
.top__queue { flex: 0 1 auto; min-width: 0; max-width: 640px; }
.top__right { display: flex; align-items: center; justify-content: flex-end; gap: 8px; flex: 1 1 0; min-width: max-content; }

.persona { padding: 4px; }
.persona .vk-seg__btn { height: 34px; padding: 0 12px 0 4px; }

.demo { position: relative; }
.demo__chip {
  display: inline-flex; align-items: center; gap: 6px; height: var(--vk-h-xl); padding: 0 14px;
  border: 1px dashed var(--vk-line-strong); border-radius: var(--vk-r-full); background: transparent;
  font: 400 12px/1 var(--vk-font); color: var(--vk-muted); cursor: pointer;
}
.demo__chip:hover, .demo__chip[aria-expanded='true'] { color: var(--vk-ink); border-color: var(--vk-faint); }
.demo__pop {
  position: absolute; right: 0; top: calc(100% + 10px); z-index: var(--vk-z-sheet); width: 300px;
  padding: 18px; border: 1px solid var(--vk-line); border-radius: var(--vk-r-lg); background: var(--vk-surface); box-shadow: var(--vk-elev-pop);
}
.demo__title { margin: 0; font: 400 15px/20px var(--vk-font); color: var(--vk-ink); }
.demo__text { margin: 6px 0 14px; font: var(--vk-type-dense); color: var(--vk-muted); }

.content { flex: 1; min-height: 0; overflow-y: auto; scrollbar-gutter: stable; }

/* ---- narrower: the capsule drops its secondary items, then takes its own row ---- */
@media (max-width: 1280px) {
  .top__queue :deep(.queue__where) { display: none; }
}
@media (max-width: 1120px) {
  .top { flex-wrap: wrap; height: auto; row-gap: 10px; padding-bottom: 4px; }
  .top__queue { order: 3; flex-basis: 100%; max-width: none; }
  .persona__name { display: none; }
}

/* ---- below 960px: the sidebar becomes a drawer ---- */
@media (max-width: 960px) {
  .shell { grid-template-columns: minmax(0, 1fr); }
  .side {
    position: fixed; z-index: var(--vk-z-sheet); inset: 0 auto 0 0; width: min(300px, 86vw);
    transform: translateX(-102%); transition: transform var(--vk-dur-4) var(--vk-ease-out); box-shadow: var(--vk-elev-modal);
  }
  .shell.is-drawer .side { transform: none; }
  .side__close { display: inline-grid; }
  .side-scrim { display: block; position: fixed; inset: 0; z-index: calc(var(--vk-z-sheet) - 1); background: var(--vk-scrim); }
  .top__menu, .top__search { display: inline-grid; }
}
@media (max-width: 560px) {
  .top { padding: 10px 16px 4px; gap: 10px; }
  .top__queue :deep(.queue__item:not(.is-first)) { display: none; }
  .demo__chip { width: var(--vk-h-xl); padding: 0; justify-content: center; }
  .demo__chip span { display: none; }
  .top__crumbs { display: none; }
}
</style>
