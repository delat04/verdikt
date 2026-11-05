<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { Plus, KeyRound, ShieldCheck, ScanSearch, Banknote } from 'lucide-vue-next'
import AppShell from '@/layouts/AppShell.vue'
import EscrowCard from '@/components/EscrowCard.vue'
import StatusBadge from '@/components/StatusBadge.vue'
import MilestoneSteps from '@/components/MilestoneSteps.vue'
import { supabase } from '@/lib/supabase'
import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth'
import { formatCents, timeAgo } from '@/utils/format'

const auth = useAuthStore()
const router = useRouter()

const contracts = ref([])
const activity = ref([])
const loading = ref(true)
const error = ref('')

const inviteCode = ref('')
const joining = ref(false)

async function load() {
  error.value = ''
  const [c, a] = await Promise.all([
    supabase.from('contracts')
      .select('id, title, status, currency, client_id, freelancer_id, created_at, milestones(id, position, title, amount_cents, status)')
      .order('created_at', { ascending: false }),
    supabase.from('audit_log')
      .select('id, actor, event, created_at, contract_id')
      .order('created_at', { ascending: false })
      .limit(8),
  ])
  if (c.error) error.value = c.error.message
  contracts.value = (c.data || []).map((x) => ({
    ...x, milestones: [...(x.milestones || [])].sort((p, q) => p.position - q.position),
  }))
  activity.value = a.data || []
  loading.value = false
}

// Live updates while a milestone moves through verification
let channel
onMounted(() => {
  load()
  channel = supabase.channel('dashboard')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'milestones' }, load)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'audit_log' }, load)
    .subscribe()
})
onUnmounted(() => channel && supabase.removeChannel(channel))

// ---- derived figures ----
const allMilestones = computed(() => contracts.value.flatMap((c) => c.milestones))
const HELD = ['funded', 'submitted', 'verifying', 'passed', 'failed', 'disputed']
const heldCents = computed(() => allMilestones.value.filter((m) => HELD.includes(m.status)).reduce((s, m) => s + m.amount_cents, 0))
const releasedCents = computed(() => allMilestones.value.filter((m) => m.status === 'released').reduce((s, m) => s + m.amount_cents, 0))
const heldCount = computed(() => allMilestones.value.filter((m) => HELD.includes(m.status)).length)

function roleIn(contract) {
  return contract.client_id === auth.user?.id ? 'Client' : 'Freelancer'
}
function currentMilestone(contract) {
  return contract.milestones.find((m) => !['released', 'refunded'].includes(m.status)) || contract.milestones.at(-1)
}
function totalCents(contract) {
  return contract.milestones.reduce((s, m) => s + m.amount_cents, 0)
}

async function join() {
  joining.value = true
  error.value = ''
  try {
    await api('/contracts/join', { body: { code: inviteCode.value } })
    inviteCode.value = ''
    await load()
  } catch (e) {
    error.value = e.message
  } finally {
    joining.value = false
  }
}

const EVENT_LABELS = {
  'contract.created': 'Contract created',
  'contract.joined': 'Counterparty joined',
  'escrow.order_created': 'PayPal order created',
  'escrow.funds_held': 'Funds held in escrow',
  'escrow.released': 'Funds released',
  'escrow.refunded': 'Hold voided — refunded',
}
</script>

<template>
  <AppShell>
    <section class="section">
      <div class="section-head bordered">
        <div>
          <p class="eyebrow">Your contracts</p>
          <h1>Contracts</h1>
        </div>
        <button class="btn btn-primary" @click="router.push('/contracts/new')">
          <Plus :size="16" /> New contract
        </button>
      </div>

      <p v-if="error" class="error">{{ error }}</p>

      <div v-if="loading" class="list">
        <div v-for="i in 2" :key="i" class="card skeleton" />
      </div>

      <div v-else-if="!contracts.length" class="empty card">
        <h2>No contracts yet</h2>
        <p>Create one as the client or the freelancer, or join one with the invite code you received.</p>
        <div class="empty__actions">
          <button class="btn btn-primary" @click="router.push('/contracts/new')"><Plus :size="16" /> New contract</button>
        </div>
      </div>

      <div v-else class="list">
        <article v-for="c in contracts" :key="c.id" class="card contract">
          <header class="contract__head">
            <div>
              <h3>{{ c.title }}</h3>
              <p class="contract__meta">
                <span>{{ roleIn(c) }}</span>
                <span>·</span>
                <span>{{ c.milestones.length }} milestone{{ c.milestones.length === 1 ? '' : 's' }}</span>
                <span>·</span>
                <span>{{ timeAgo(c.created_at) }}</span>
              </p>
            </div>
            <p class="contract__total num">{{ formatCents(totalCents(c), c.currency) }}</p>
          </header>

          <div v-if="currentMilestone(c)" class="contract__now">
            <div class="contract__now-head">
              <span class="eyebrow">M{{ currentMilestone(c).position }} · {{ currentMilestone(c).title }}</span>
              <StatusBadge :status="currentMilestone(c).status" />
            </div>
            <MilestoneSteps :status="currentMilestone(c).status" />
          </div>
        </article>
      </div>
    </section>

    <template #aside>
      <section class="section">
        <EscrowCard :held-cents="heldCents" :released-cents="releasedCents" :milestones-held="heldCount" />
      </section>

      <section class="section">
        <div class="section-head"><h2>Join a contract</h2></div>
        <form class="join" @submit.prevent="join">
          <div class="join__field">
            <KeyRound :size="15" />
            <input v-model="inviteCode" class="input num" placeholder="Invite code" required />
          </div>
          <button class="btn btn-secondary" :disabled="joining">{{ joining ? 'Joining…' : 'Join' }}</button>
        </form>
      </section>

      <section class="section">
        <div class="section-head"><h2>Activity</h2><span class="eyebrow">Audit log</span></div>
        <ol v-if="activity.length" class="feed">
          <li v-for="a in activity" :key="a.id">
            <span class="feed__dot" :data-actor="a.actor" />
            <span class="feed__text">{{ EVENT_LABELS[a.event] || a.event }}</span>
            <span class="feed__time num">{{ timeAgo(a.created_at) }}</span>
          </li>
        </ol>
        <p v-else class="muted">Every agent decision and PayPal event shows up here.</p>
      </section>

      <section class="section">
        <div class="section-head"><h2>How it works</h2></div>
        <ul class="how">
          <li><ShieldCheck :size="16" /> Both sides sign checkable criteria</li>
          <li><Banknote :size="16" /> Client funds the milestone — PayPal holds it</li>
          <li><ScanSearch :size="16" /> The agent tests the delivered work</li>
          <li><span class="how__ok" /> Proven → released. Not yet → held, with reasons.</li>
        </ul>
      </section>
    </template>
  </AppShell>
</template>

<style scoped>
.section + .section { margin-top: 2rem; }
.section-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 1rem; margin-bottom: 1.125rem; }
.section-head.bordered { padding-bottom: 1rem; border-bottom: 1px solid var(--line); }
.section-head h1 { margin: 0.25rem 0 0; font-size: 1.75rem; font-weight: 500; letter-spacing: -0.03em; }
.section-head h2 { margin: 0; font-size: 1rem; font-weight: 600; letter-spacing: -0.01em; }

.error { margin: 0 0 1rem; font-size: 0.8125rem; color: var(--danger); }
.muted { margin: 0; font-size: 0.8125rem; color: var(--faint); line-height: 1.5; }

.list { display: flex; flex-direction: column; gap: 0.875rem; }
.skeleton { height: 148px; background: linear-gradient(90deg, var(--bg) 0%, var(--bg-3) 50%, var(--bg) 100%); background-size: 200% 100%; animation: shimmer 1.4s linear infinite; }
@keyframes shimmer { to { background-position: -200% 0; } }

/* ---- empty state ---- */
.empty { padding: 2.5rem 2rem; text-align: center; }
.empty h2 { margin: 0; font-size: 1.125rem; font-weight: 600; }
.empty p { max-width: 420px; margin: 0.5rem auto 0; font-size: 0.875rem; color: var(--muted); line-height: 1.5; }
.empty__actions { margin-top: 1.25rem; }

/* ---- contract card ---- */
.contract { transition: border-color 150ms, box-shadow 150ms; }
.contract:hover { border-color: color-mix(in srgb, var(--accent) 60%, var(--line)); }
.contract__head { display: flex; justify-content: space-between; align-items: flex-start; gap: 1.25rem; }
.contract__head h3 { margin: 0; font-size: 1rem; font-weight: 600; line-height: 1.4; }
.contract__meta { display: flex; gap: 0.375rem; margin: 0.25rem 0 0; font-size: 0.8125rem; color: var(--faint); }
.contract__total { margin: 0; font-size: 1.25rem; white-space: nowrap; }
.contract__now { margin-top: 1.125rem; padding: 1rem 1rem 0.875rem; border-radius: var(--r-md); background: var(--bg-2); border: 1px solid var(--line); }
.contract__now-head { display: flex; align-items: center; justify-content: space-between; gap: 1rem; margin-bottom: 1rem; }

/* ---- sidebar ---- */
.join { display: flex; gap: 0.5rem; }
.join__field { position: relative; flex: 1; display: flex; align-items: center; }
.join__field svg { position: absolute; left: 0.75rem; color: var(--faint); }
.join__field .input { padding-left: 2.125rem; }

.feed { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 0.75rem; }
.feed li { display: flex; align-items: center; gap: 0.625rem; font-size: 0.8125rem; }
.feed__dot { width: 7px; height: 7px; border-radius: 50%; background: var(--faint); flex-shrink: 0; }
.feed__dot[data-actor='agent'] { background: var(--warn); }
.feed__dot[data-actor='paypal'] { background: var(--accent); }
.feed__text { flex: 1; min-width: 0; color: var(--muted); }
.feed__time { font-size: 0.6875rem; color: var(--faint); }

.how { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 0.75rem; }
.how li { display: flex; align-items: flex-start; gap: 0.625rem; font-size: 0.8125rem; color: var(--muted); line-height: 1.45; }
.how li svg { flex-shrink: 0; margin-top: 1px; color: var(--accent-2); }
.how__ok { flex-shrink: 0; width: 16px; height: 16px; margin-top: 1px; border-radius: 50%; background: var(--ok); box-shadow: 0 0 0 3px var(--ok-soft); transform: scale(0.7); }
</style>
