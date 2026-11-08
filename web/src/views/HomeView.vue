<!--
  Home. The head stays put — the word, the one action (New contract) and the three numbers that
  matter (held · paid · on you); it tightens once you scroll. Below it two columns scroll on their own:
  main — Up next (the one cobalt card), invitations, then every contract as cards or on the money
         timeline; the filter bar sticks
  side — the money held across contracts, an invite-code box, the ledger
-->
<script setup>
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { Plus, KeyRound, FileText, Search, X, ArrowRight, ArrowUpRight, Briefcase, LayoutGrid, ChartGantt } from 'lucide-vue-next'
import AppShell from '@/layouts/AppShell.vue'
import VButton from '@/components/ui/VButton.vue'
import VCard from '@/components/ui/VCard.vue'
import VChips from '@/components/ui/VChips.vue'
import VSegmented from '@/components/ui/VSegmented.vue'
import VNotchCard from '@/components/ui/VNotchCard.vue'
import VAvatar from '@/components/ui/VAvatar.vue'
import VPill from '@/components/ui/VPill.vue'
import VEmptyState from '@/components/ui/VEmptyState.vue'
import NextStepCard from '@/components/NextStepCard.vue'
import ContractCard from '@/components/ContractCard.vue'
import MoneyTimeline from '@/components/MoneyTimeline.vue'
import EscrowCard from '@/components/EscrowCard.vue'
import ActivityFeed from '@/components/ActivityFeed.vue'
import { ACTION } from '@/components/actionMeta'
import { useLive } from '@/composables/useLive'
import { useSplitScroll } from '@/composables/useSplitScroll'
import { useAuthStore } from '@/stores/auth'
import { api, isDemo } from '@/services'
import { money, firstName } from '@/domain/format'
import { nextStep, roleOf, counterparty, contractTotals } from '@/domain/milestone'

const auth = useAuthStore()
const router = useRouter()
const route = useRoute()

const { data, loading, error } = useLive(async () => {
  const [contracts, invites, jobs, limits] = await Promise.all([
    api.listContracts(), api.listInvites(), api.listJobs().catch(() => null), api.listSpendLimits().catch(() => null),
  ])
  return { contracts, invites, jobs, limits }
})
const limit = computed(() => data.value?.limits?.current || null)

const rows = computed(() => (data.value?.contracts || []).map((c) => {
  const role = roleOf(c, auth.user?.id)
  return { c, role, other: counterparty(c, role), step: nextStep(c, role), totals: contractTotals(c) }
}))
const invites = computed(() => data.value?.invites || [])
const mine = computed(() => rows.value.filter((r) => r.step?.actor === 'you'))
const upNext = computed(() => mine.value[0] || null)
const totals = computed(() => rows.value.reduce((t, r) => ({
  held: t.held + r.totals.held, released: t.released + r.totals.released, total: t.total + r.totals.total,
  paid: t.paid + r.totals.releasedCount, count: t.count + r.c.milestones.length,
}), { held: 0, released: 0, total: 0, paid: 0, count: 0 }))
const activity = computed(() => rows.value
  .flatMap((r) => r.c.activity.map((a) => ({ ...a, _c: r.c })))
  .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  .slice(0, 12))
const firstRun = computed(() => !loading.value && !rows.value.length && !invites.value.length)
// before the first contract the work usually starts on the job board: point at what's waiting there
const lead = computed(() => {
  const j = data.value?.jobs
  if (!j) return null
  const post = (j.posted || []).find((p) => p.status === 'open' && p.candidates?.some((a) => a.status === 'pending'))
  if (post) {
    const n = post.candidates.filter((a) => a.status === 'pending').length
    return {
      title: `${n} ${n > 1 ? 'people' : 'person'} applied to “${post.title}”`,
      sub: 'Each application arrives reviewed: their paid work on Verdikt, red flags, and how well the pitch fits your brief. Hiring one opens a contract room with both of you.',
      label: 'Review applications', to: { path: '/jobs', query: { view: 'posts' } },
    }
  }
  const sent = (j.applied || []).find((a) => a.status === 'pending')
  if (sent) {
    return {
      title: `You applied to “${sent.job?.title}”`,
      sub: `${firstName(sent.job?.client || 'The client')} sees your price and pitch with a review. Once you're hired, the contract room opens here.`,
      label: 'Find more work', to: { path: '/jobs', query: { view: 'find' } },
    }
  }
  if (auth.profile?.intent !== 'client' && j.open?.length) {
    return {
      title: `${j.open.length} open job${j.open.length > 1 ? 's' : ''} on the board`,
      sub: 'Apply with a price and a pitch, yourself or through your agent. Hiring opens a contract room, and PayPal holds the money until the work passes the checks you both sign.',
      label: 'Find work', to: { path: '/jobs', query: { view: 'find' } },
    }
  }
  return null
})

// ---- filters
const DONE = ['completed', 'cancelled']
const filter = ref('all')
const q = ref('')
const searching = ref(false)
const counts = computed(() => ({
  all: rows.value.length,
  you: mine.value.length,
  flight: rows.value.filter((r) => !DONE.includes(r.c.status) && r.step?.actor !== 'you').length,
  done: rows.value.filter((r) => DONE.includes(r.c.status)).length,
}))
const chips = computed(() => [
  { value: 'all', label: 'All', count: counts.value.all },
  { value: 'you', label: 'Your move', count: counts.value.you },
  { value: 'flight', label: 'In flight', count: counts.value.flight },
  { value: 'done', label: 'Done', count: counts.value.done },
])
const shown = computed(() => {
  const t = q.value.trim().toLowerCase()
  return rows.value.filter((r) => {
    if (filter.value === 'you' && r.step?.actor !== 'you') return false
    if (filter.value === 'flight' && (DONE.includes(r.c.status) || r.step?.actor === 'you')) return false
    if (filter.value === 'done' && !DONE.includes(r.c.status)) return false
    return !t || `${r.c.title} ${r.other?.name || ''}`.toLowerCase().includes(t)
  })
})
function toggleSearch() {
  searching.value = !searching.value
  if (!searching.value) q.value = ''
}

// ---- cards or the timeline; the choice sticks in this browser, and ?view=timeline opens straight onto it
const LAYOUT_KEY = 'verdikt-contracts-layout'
const storedLayout = (() => { try { return localStorage.getItem(LAYOUT_KEY) } catch { return null } })()
const layout = ref([route.query.view, storedLayout].includes('timeline') ? 'timeline' : 'cards')
watch(layout, (v) => { try { localStorage.setItem(LAYOUT_KEY, v) } catch { /* private window */ } })
const layouts = [
  { value: 'cards', icon: LayoutGrid, label: 'Cards' },
  { value: 'timeline', icon: ChartGantt, label: 'Timeline' },
]

// ---- scrolling: the head condenses; the filter bar sticks and shows a hairline once it does
const { root, scrolled, condensed } = useSplitScroll({ room: 110 })   // the head shrinks ~45px here
const sentinel = ref(null)
const stuck = ref(false)
let io = null
watch(sentinel, (el) => {
  io?.disconnect()
  if (!el || typeof IntersectionObserver === 'undefined') return
  io = new IntersectionObserver(([e]) => { stuck.value = !e.isIntersecting && e.boundingClientRect.top < window.innerHeight / 2 })
  io.observe(el)
})
onBeforeUnmount(() => io?.disconnect())

const hour = new Date().getHours()
const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'

const code = ref('')
const loadingSample = ref(false)
const loadingRoom = ref(false)
async function sampleRoom() {
  loadingRoom.value = true
  try {
    const { id } = await api.loadRoomSample()
    router.push(`/contracts/${id}`)
  } finally {
    loadingRoom.value = false
  }
}
async function sample() {
  loadingSample.value = true
  try {
    const { id } = await api.loadSample()
    router.push(`/contracts/${id}`)
  } finally {
    loadingSample.value = false
  }
}
</script>

<template>
  <AppShell>
    <template #crumbs><span>{{ greeting }}, {{ firstName(auth.name) }}</span></template>

    <div ref="root" class="vk-split home" :class="{ 'is-scrolled': scrolled, 'is-condensed': condensed }">
      <!-- head: the word, the action, the numbers — always on screen -->
      <header class="vk-split__head hero">
        <div class="hero__left">
          <h1 class="vk-display hero__title">Contracts</h1>
          <VButton variant="ink" size="lg" orb :icon="Plus" to="/contracts/new" class="hero__new">New contract</VButton>
        </div>
        <div v-if="rows.length" class="vk-stats hero__stats">
          <div class="vk-stat">
            <span class="vk-stat__n">{{ money(totals.held, 'USD', { whole: true }) }}</span><span class="vk-stat__l">held</span>
          </div>
          <div class="vk-stat">
            <span class="vk-stat__n">{{ money(totals.released, 'USD', { whole: true }) }}</span><span class="vk-stat__l">paid</span>
            <span v-if="totals.paid" class="vk-stat__d vk-stat__d--ok" :title="`${totals.paid} of ${totals.count} milestones paid`">{{ totals.paid }}/{{ totals.count }}</span>
          </div>
          <div class="vk-stat">
            <span class="vk-stat__n">{{ mine.length }}</span><span class="vk-stat__l">on you</span>
          </div>
        </div>
      </header>

      <!-- first run: one card, three ways in -->
      <div v-if="firstRun" class="vk-split__cols vk-split__cols--solo">
        <div class="vk-split__col">
          <p v-if="error" class="vk-field__error">{{ error }}</p>
          <VNotchCard as="section" class="first">
            <template #corner>
              <RouterLink :to="lead?.to || '/contracts/new'" class="vk-notch__corner" :aria-label="lead?.label || 'Create a contract'"><ArrowUpRight :size="17" :stroke-width="1.9" /></RouterLink>
            </template>
            <VEmptyState
              :icon="lead ? Briefcase : FileText" :title="lead?.title || 'No contracts yet'"
              :sub="lead?.sub || 'Describe the work and set milestones. The agent turns it into checks you both sign, PayPal holds the money, and it moves only when the checks pass.'"
            >
              <VButton v-if="lead" :icon="ArrowRight" :to="lead.to">{{ lead.label }}</VButton>
              <VButton :variant="lead ? 'secondary' : 'primary'" :icon="Plus" to="/contracts/new">Create a contract</VButton>
              <VButton v-if="isDemo && !lead" variant="secondary" :loading="loadingSample" @click="sample">Load a sample contract</VButton>
              <VButton v-if="isDemo && !lead" variant="secondary" :loading="loadingRoom" @click="sampleRoom">Open a sample contract room</VButton>
              <VButton variant="ghost" :icon="KeyRound" to="/join">I have an invite code</VButton>
            </VEmptyState>
          </VNotchCard>
        </div>
      </div>

      <div v-else class="vk-split__cols">
        <!-- main column -->
        <div class="vk-split__col main">
          <p v-if="error" class="vk-field__error">{{ error }}</p>

          <NextStepCard
            v-if="upNext"
            class="vk-rise"
            :step="{ ...upNext.step, eyebrow: `Up next · ${upNext.c.title}` }"
            :you="auth.name"
            :them="upNext.other?.name"
          >
            <VButton
              v-if="upNext.step.action && ACTION[upNext.step.action]"
              size="lg" :icon="ACTION[upNext.step.action].icon"
              :to="{ path: `/contracts/${upNext.c.id}`, query: { act: upNext.step.action } }"
            >{{ ACTION[upNext.step.action].label }}</VButton>
            <VButton size="lg" variant="secondary" :icon-right="ArrowRight" :to="`/contracts/${upNext.c.id}`">Open</VButton>
          </NextStepCard>

          <!-- invitations -->
          <section v-if="invites.length" class="block">
            <div class="block__head">
              <h2 class="block__title">Invitations <span class="block__n">{{ invites.length }} new</span></h2>
            </div>
            <div class="cards">
              <VNotchCard v-for="c in invites" :key="c.id" :to="`/join/${c.inviteCode}`" class="invite">
                <div class="invite__who vk-notch__head">
                  <VAvatar :name="(c.client || c.freelancer)?.name" size="lg" />
                  <div>
                    <p class="invite__name">{{ (c.client || c.freelancer)?.name }}</p>
                    <p class="invite__sub">invited you as the {{ c.client ? 'freelancer' : 'client' }}</p>
                  </div>
                </div>
                <h3 class="invite__title">{{ c.title }}</h3>
                <div class="invite__foot">
                  <VPill tone="accent" size="sm">Invitation</VPill>
                  <span v-if="c.status === 'scoping'" class="vk-faint">Contract room · terms in progress</span>
                  <span v-else class="vk-faint">{{ c.milestones.length }} milestones · <span class="vk-num">{{ money(contractTotals(c).total, c.currency, { whole: true }) }}</span></span>
                </div>
              </VNotchCard>
            </div>
          </section>

          <!-- every contract; the filter bar sticks to the top of the column -->
          <section class="block">
            <span ref="sentinel" class="sentinel" aria-hidden="true" />
            <div class="block__head block__head--bar" :class="{ 'is-stuck': stuck }">
              <h2 class="block__title">Your contracts <span class="block__n">{{ rows.length }} total</span></h2>
              <div class="block__tools">
                <div class="find" :class="{ 'is-open': searching }">
                  <button type="button" class="vk-icon-btn vk-icon-btn--lg" :aria-label="searching ? 'Close search' : 'Find a contract'" @click="toggleSearch">
                    <component :is="searching ? X : Search" :size="17" :stroke-width="1.9" />
                  </button>
                  <input v-if="searching" v-model="q" class="find__input" placeholder="Title or name" aria-label="Find a contract" autofocus @keydown.esc="toggleSearch" />
                </div>
                <VChips v-model="filter" :options="chips" label="Filter contracts" />
                <VSegmented v-model="layout" :options="layouts" label="Show contracts as" class="layout" />
              </div>
            </div>

            <div v-if="loading" class="cards">
              <div v-for="i in 2" :key="i" class="vk-skel" style="height: 280px; border-radius: var(--vk-r-xl)" />
            </div>
            <MoneyTimeline v-else-if="shown.length && layout === 'timeline'" :rows="shown" :limit="limit" class="vk-rise" />
            <TransitionGroup v-else-if="shown.length" tag="div" name="vk-list" class="cards">
              <ContractCard v-for="r in shown" :key="r.c.id" :row="r" />
            </TransitionGroup>
            <p v-else class="none">
              {{ q ? `No contract matches “${q}”.` : filter === 'you' ? 'Nothing is waiting on you.' : filter === 'done' ? 'No finished contracts yet.' : 'Nothing in flight.' }}
            </p>
          </section>
        </div>

        <!-- side column -->
        <aside class="vk-split__col side">
          <EscrowCard :held-cents="totals.held" :released-cents="totals.released" :total-cents="totals.total || null" label="Held across contracts" />

          <VCard title="Have an invite code?" sub="Join a contract someone shared with you.">
            <form class="join" @submit.prevent="router.push(`/join/${code.trim()}`)">
              <div class="vk-affix" style="flex: 1">
                <KeyRound :size="15" />
                <input v-model="code" class="vk-input vk-num" placeholder="e.g. NB4X2Q" required aria-label="Invite code" />
              </div>
              <VButton type="submit" variant="secondary">Open</VButton>
            </form>
          </VCard>

          <VCard v-if="activity.length" title="Ledger" sub="The latest across all your contracts.">
            <ActivityFeed :items="activity" show-contract />
          </VCard>
        </aside>
      </div>
    </div>
  </AppShell>
</template>

<style scoped>
/* head — tightens once the main column is well into its content */
.hero { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px 40px; flex-wrap: wrap; padding-top: 20px; transition: padding var(--vk-dur-4) var(--vk-ease-out); }
.hero__left { display: flex; align-items: center; gap: 20px; flex-wrap: wrap; }
.hero__title { transition: font-size var(--vk-dur-4) var(--vk-ease-out); }
.hero__stats { padding-bottom: 6px; }
.hero__stats .vk-stat__n { transition: font-size var(--vk-dur-4) var(--vk-ease-out), line-height var(--vk-dur-4) var(--vk-ease-out); }
.hero__new { transition: height var(--vk-dur-4) var(--vk-ease-out), background var(--vk-dur-2); }
.is-condensed .hero { padding-top: 8px; }
.is-condensed .hero__title { font-size: 36px; }
.is-condensed .hero__new { --vk-btn-h: var(--vk-h-md); font-size: 14px; }
.is-condensed .hero__stats { padding-bottom: 2px; }
.is-condensed .hero__stats .vk-stat__n { font-size: 24px; line-height: 28px; }
.is-condensed .hero__stats .vk-stat__d { top: -10px; }

.first { max-width: 760px; margin: 8px auto 0; }
.main, .side { display: flex; flex-direction: column; }
.main { gap: 40px; }
.side { gap: 16px; }

.block__head { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin-bottom: 16px; }
.block__title { display: flex; align-items: baseline; gap: 14px; margin: 0; font: 400 26px/32px var(--vk-font); letter-spacing: -.025em; }
.block__n { font: 400 13px/1 var(--vk-font); color: var(--vk-muted); text-decoration: underline; text-underline-offset: 5px; text-decoration-color: var(--vk-line-strong); }
.block__tools { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.layout :deep(.vk-seg__btn) { height: 36px; }   /* level with the 44px chips */

/* the filter bar sticks to the top of the column; a hairline marks it once it does */
.sentinel { display: block; height: 1px; margin-bottom: -1px; }
.block__head--bar {
  position: sticky; top: -20px; z-index: 3; margin: 0 -8px 16px; padding: 24px 8px 12px;
  background: var(--vk-canvas); box-shadow: 0 1px 0 transparent; transition: box-shadow var(--vk-dur-3);
}
.block__head--bar.is-stuck { box-shadow: 0 1px 0 var(--vk-line); }

.find { display: flex; align-items: center; height: var(--vk-h-xl); border-radius: var(--vk-r-full); transition: background var(--vk-dur-2); }
.find.is-open { padding-right: 16px; border: 1px solid var(--vk-line-strong); background: var(--vk-surface); }
.find.is-open .vk-icon-btn { border-color: transparent; background: transparent; height: 42px; }
.find__input { width: 160px; border: 0; outline: none; background: transparent; font: var(--vk-type-dense); color: var(--vk-ink); }

.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(290px, 1fr)); gap: 16px; }
.none { margin: 0; padding: 40px 0; text-align: center; font: var(--vk-type-dense); color: var(--vk-muted); border: 1px dashed var(--vk-line-strong); border-radius: var(--vk-r-xl); }

.invite { min-height: 220px; }
.invite__who { display: flex; align-items: center; gap: 12px; }
.invite__name { margin: 0; font: 400 14px/18px var(--vk-font); }
.invite__sub { margin: 2px 0 0; font: var(--vk-type-small); color: var(--vk-faint); }
.invite__title { margin: 20px 0 0; font: 400 21px/26px var(--vk-font); letter-spacing: -.025em; }
.invite__foot { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-top: auto; padding-top: 18px; font: var(--vk-type-small); }

.join { display: flex; gap: 8px; }

@media (max-width: 1100px) {
  .side { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); align-items: start; }
  .block__head--bar { top: 0; margin: 0 -16px 16px; padding: 12px 16px; }
}
@media (max-width: 640px) {
  .hero__title { font-size: 44px; }
  .vk-stat__n { font-size: 28px; line-height: 32px; }
  .block__title { font-size: 22px; }
}
</style>
