<script setup>
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { FileText, FilePlus2, PanelLeftClose, PanelLeftOpen, Sun, Moon, LogOut } from 'lucide-vue-next'
import BrandMark from '@/components/BrandMark.vue'
import { useAuthStore } from '@/stores/auth'
import { useTheme } from '@/composables/useTheme'

/* Header + rail + main + right panel — the run-arrands dashboard frame */
defineProps({ aside: { type: Boolean, default: true } })

const auth = useAuthStore()
const route = useRoute()
const router = useRouter()
const { theme, toggle } = useTheme()

const collapsed = ref(false)
try { collapsed.value = localStorage.getItem('verdikt-rail') === '1' } catch {}
function toggleRail() {
  collapsed.value = !collapsed.value
  try { localStorage.setItem('verdikt-rail', collapsed.value ? '1' : '0') } catch {}
}

const nav = [
  { label: 'Contracts', to: '/contracts', icon: FileText, exact: true },
  { label: 'New contract', to: '/contracts/new', icon: FilePlus2 },
]
const isActive = (item) => (item.exact ? route.path === item.to : route.path.startsWith(item.to))

async function signOut() {
  await auth.signOut()
  router.push('/login')
}
</script>

<template>
  <div class="app">
    <!-- ---- header ---- -->
    <header class="app-header">
      <RouterLink to="/contracts" class="brand">
        <BrandMark :size="30" />
        <span class="brand__text">
          <span>Verdikt</span>
          <span>AI-verified escrow</span>
        </span>
      </RouterLink>

      <div class="header-actions">
        <div class="user-chip">
          <span class="user-chip__meta">
            <span class="user-chip__name">{{ auth.displayName }}</span>
            <span class="user-chip__mail">{{ auth.user?.email }}</span>
          </span>
          <span class="user-chip__dot" />
        </div>
        <div class="header-actions__buttons">
          <button class="btn btn-icon" :aria-label="`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`" @click="toggle">
            <Sun v-if="theme === 'dark'" :size="17" />
            <Moon v-else :size="17" />
          </button>
          <button class="btn btn-icon" aria-label="Sign out" @click="signOut">
            <LogOut :size="17" />
          </button>
        </div>
      </div>
    </header>

    <!-- ---- body ---- -->
    <div class="app-body" :class="{ 'rail-collapsed': collapsed, 'no-aside': !aside }">
      <nav class="side-nav">
        <div class="nav">
          <RouterLink
            v-for="item in nav" :key="item.to" :to="item.to"
            :class="{ 'is-active': isActive(item) }" :title="collapsed ? item.label : undefined"
          >
            <component :is="item.icon" :size="18" />
            <span class="nav__label">{{ item.label }}</span>
          </RouterLink>
        </div>
        <div class="rail-foot">
          <div class="side-foot">
            <p class="side-foot__title">Verdikt<small>β</small></p>
            <p class="side-foot__legal">Payments in PayPal sandbox. Verdicts by Claude — every decision comes with evidence.</p>
          </div>
          <button class="rail-collapse" @click="toggleRail">
            <PanelLeftOpen v-if="collapsed" :size="18" />
            <PanelLeftClose v-else :size="18" />
            <span class="nav__label">Collapse</span>
          </button>
        </div>
      </nav>

      <main class="main"><slot /></main>

      <aside v-if="aside" class="sidebar"><slot name="aside" /></aside>
    </div>
  </div>
</template>

<style scoped>
.app { height: 100dvh; display: flex; flex-direction: column; overflow: hidden; background: var(--bg-2); }

/* ---- header ---- */
.app-header {
  display: flex; align-items: center; gap: 2rem; flex-shrink: 0;
  padding: 0.75rem clamp(1rem, 2.5vw, 1.75rem);
  background: var(--bg); border-bottom: 1px solid var(--line);
}
.brand { display: flex; align-items: center; gap: 0.625rem; text-decoration: none; color: var(--ink); }
.brand__text { display: flex; flex-direction: column; line-height: 1.2; }
.brand__text span:first-child { font-weight: 600; font-size: 1.0625rem; letter-spacing: -0.02em; }
.brand__text span:last-child { font-size: 0.75rem; color: var(--faint); }

.header-actions { display: flex; align-items: center; margin-left: auto; }
.user-chip { display: flex; align-items: center; gap: 0.75rem; }
.user-chip__meta { display: flex; flex-direction: column; line-height: 1.2; text-align: right; }
.user-chip__name { font-size: 0.875rem; font-weight: 500; }
.user-chip__mail { font-family: var(--mono); font-size: 0.6875rem; color: var(--faint); }
.user-chip__dot { width: 8px; height: 8px; border-radius: 50%; background: var(--ok); box-shadow: 0 0 0 3px var(--ok-soft); }
.header-actions__buttons {
  display: flex; gap: 0.5rem; margin-left: 1.25rem; padding-left: 1.25rem; border-left: 1px solid var(--line);
}

/* ---- body ---- */
.app-body {
  --rail: 232px;
  flex: 1; min-height: 0;
  display: grid; grid-template-columns: var(--rail) minmax(0, 1fr) 340px;
  transition: grid-template-columns 0.22s ease;
}
.app-body.no-aside { grid-template-columns: var(--rail) minmax(0, 1fr); }
.app-body.rail-collapsed { --rail: 68px; }

.side-nav, .main, .sidebar { min-height: 0; overflow-y: auto; scrollbar-width: thin; scrollbar-color: var(--line) transparent; }
.side-nav {
  display: flex; flex-direction: column; justify-content: space-between; gap: 1.5rem;
  padding: 1.25rem 0.75rem; background: var(--bg); border-right: 1px solid var(--line); overflow-x: hidden;
}
.main { padding: 1.75rem clamp(1.25rem, 2.5vw, 2.25rem) 3rem; }
.sidebar { padding: 1.75rem 1.25rem 3rem; background: var(--bg); border-left: 1px solid var(--line); }

/* ---- rail ---- */
.nav { display: flex; flex-direction: column; gap: 0.125rem; }
.nav a {
  display: flex; align-items: center; gap: 0.625rem;
  padding: 0.5625rem 0.6875rem; border-radius: var(--r-md);
  color: var(--muted); text-decoration: none; font-size: 0.9375rem; white-space: nowrap;
  transition: background 0.2s, color 0.2s;
}
.nav a svg { flex-shrink: 0; }
.nav a:hover { background: var(--bg-3); color: var(--ink); }
.nav a.is-active { background: var(--accent-soft); color: var(--accent-2); font-weight: 500; }

.rail-collapse {
  display: flex; align-items: center; gap: 0.625rem; width: 100%;
  padding: 0.5625rem 0.6875rem; border: 0; border-radius: var(--r-md);
  background: transparent; font: inherit; font-size: 0.875rem; color: var(--faint); cursor: pointer; white-space: nowrap;
}
.rail-collapse:hover { background: var(--bg-3); color: var(--ink); }
.rail-collapse svg { flex-shrink: 0; }

.side-foot { margin-bottom: 0.75rem; padding: 0 0.6875rem; }
.side-foot__title { margin: 0; font-size: 1.25rem; font-weight: 600; letter-spacing: -0.02em; }
.side-foot__title small { font-size: 0.5em; vertical-align: super; margin-left: 0.15em; color: var(--accent-2); }
.side-foot__legal {
  margin: 0.875rem 0 0; padding-top: 0.875rem; border-top: 1px solid var(--line);
  font-size: 0.75rem; line-height: 1.5; color: var(--faint);
}

.rail-collapsed .nav__label, .rail-collapsed .side-foot { display: none; }
.rail-collapsed .nav a, .rail-collapsed .rail-collapse { justify-content: center; padding-inline: 0; }

@media (max-width: 1100px) {
  .app-body { grid-template-columns: var(--rail) minmax(0, 1fr); }
  .sidebar { display: none; }
}
@media (max-width: 720px) {
  .app-body { --rail: 68px; }
  .nav__label, .side-foot, .user-chip__meta { display: none; }
  .nav a, .rail-collapse { justify-content: center; padding-inline: 0; }
}
</style>
