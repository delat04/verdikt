<script setup>
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { Plus, Trash2, Copy, Check } from 'lucide-vue-next'
import AppShell from '@/layouts/AppShell.vue'
import { api } from '@/lib/api'
import { formatCents } from '@/utils/format'

const router = useRouter()

const role = ref('client')
const title = ref('')
const brief = ref('')
const milestones = ref([
  { title: 'Design & landing page', amount: '' },
  { title: 'Full launch', amount: '' },
])

const saving = ref(false)
const error = ref('')
const created = ref(null)
const copied = ref(false)

const toCents = (v) => Math.round(Number(String(v).replace(/[^0-9.]/g, '')) * 100) || 0
const totalCents = computed(() => milestones.value.reduce((s, m) => s + toCents(m.amount), 0))

function addMilestone() {
  if (milestones.value.length < 6) milestones.value.push({ title: '', amount: '' })
}

async function submit() {
  error.value = ''
  saving.value = true
  try {
    created.value = await api('/contracts', {
      body: {
        role: role.value,
        title: title.value,
        brief: brief.value,
        milestones: milestones.value.map((m) => ({ title: m.title, amount_cents: toCents(m.amount) })),
      },
    })
  } catch (e) {
    error.value = e.message
  } finally {
    saving.value = false
  }
}

async function copyCode() {
  try {
    await navigator.clipboard.writeText(created.value.inviteCode)
    copied.value = true
    setTimeout(() => (copied.value = false), 1500)
  } catch {}
}
</script>

<template>
  <AppShell :aside="false">
    <section class="wrap">
      <p class="eyebrow">Step 1 of 3 · Terms</p>
      <h1>New contract</h1>
      <p class="lede">Describe the work in plain words. Next, the agent turns it into checkable acceptance criteria that both of you sign before any money moves.</p>

      <div v-if="created" class="card done">
        <h2>Contract created</h2>
        <p>Send this invite code to the other party so they can join.</p>
        <div class="code">
          <span class="num">{{ created.inviteCode }}</span>
          <button class="btn btn-secondary" @click="copyCode">
            <Check v-if="copied" :size="15" /><Copy v-else :size="15" /> {{ copied ? 'Copied' : 'Copy' }}
          </button>
        </div>
        <button class="btn btn-primary" @click="router.push('/contracts')">Go to contracts</button>
      </div>

      <form v-else class="form" @submit.prevent="submit">
        <fieldset class="field">
          <legend class="eyebrow">I am the</legend>
          <div class="seg">
            <button type="button" class="seg__btn" :class="{ 'is-active': role === 'client' }" @click="role = 'client'">Client — I pay</button>
            <button type="button" class="seg__btn" :class="{ 'is-active': role === 'freelancer' }" @click="role = 'freelancer'">Freelancer — I deliver</button>
          </div>
        </fieldset>

        <label class="field">
          <span class="eyebrow">Project title</span>
          <input v-model="title" class="input" required placeholder="Landing page for a coffee brand" />
        </label>

        <label class="field">
          <span class="eyebrow">Brief</span>
          <textarea v-model="brief" class="input" rows="5" placeholder="What should be delivered? Pages, features, devices, deadlines, links to mockups…" />
        </label>

        <div class="field">
          <span class="eyebrow">Milestones — each one is funded and released on its own</span>
          <ol class="ms">
            <li v-for="(m, i) in milestones" :key="i" class="ms__row">
              <span class="ms__n num">M{{ i + 1 }}</span>
              <input v-model="m.title" class="input" required placeholder="Milestone title" />
              <div class="ms__amount">
                <span>$</span>
                <input v-model="m.amount" class="input num" required inputmode="decimal" placeholder="0.00" />
              </div>
              <button type="button" class="btn btn-icon" aria-label="Remove milestone" :disabled="milestones.length === 1" @click="milestones.splice(i, 1)">
                <Trash2 :size="15" />
              </button>
            </li>
          </ol>
          <div class="ms__foot">
            <button type="button" class="btn btn-secondary" :disabled="milestones.length >= 6" @click="addMilestone">
              <Plus :size="15" /> Add milestone
            </button>
            <span class="ms__total">Total <span class="num">{{ formatCents(totalCents) }}</span></span>
          </div>
        </div>

        <p v-if="error" class="error">{{ error }}</p>
        <div class="actions">
          <button type="button" class="btn btn-secondary" @click="router.push('/contracts')">Cancel</button>
          <button class="btn btn-primary" :disabled="saving">{{ saving ? 'Creating…' : 'Create contract' }}</button>
        </div>
      </form>
    </section>
  </AppShell>
</template>

<style scoped>
.wrap { max-width: 720px; }
h1 { margin: 0.25rem 0 0; font-size: 1.75rem; font-weight: 500; letter-spacing: -0.03em; }
.lede { margin: 0.5rem 0 2rem; max-width: 560px; font-size: 0.9375rem; color: var(--muted); line-height: 1.55; }

.form { display: flex; flex-direction: column; gap: 1.5rem; }
.field { display: flex; flex-direction: column; gap: 0.5rem; margin: 0; padding: 0; border: 0; }
textarea.input { resize: vertical; line-height: 1.5; }

.seg { display: grid; grid-template-columns: 1fr 1fr; gap: 2px; padding: 3px; border: 1px solid var(--line); border-radius: var(--r-md); background: var(--bg-2); }
.seg__btn { padding: 0.5625rem; border: 0; border-radius: calc(var(--r-md) - 3px); background: transparent; font: inherit; font-size: 0.875rem; color: var(--faint); cursor: pointer; }
.seg__btn:hover { color: var(--ink); }
.seg__btn.is-active { background: var(--bg); color: var(--accent-2); font-weight: 500; box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2); }

.ms { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 0.5rem; }
.ms__row { display: grid; grid-template-columns: 40px minmax(0, 1fr) 150px 40px; gap: 0.5rem; align-items: center; }
.ms__n { font-size: 0.75rem; color: var(--faint); }
.ms__amount { position: relative; display: flex; align-items: center; }
.ms__amount span { position: absolute; left: 0.75rem; font-family: var(--mono); font-size: 0.875rem; color: var(--faint); }
.ms__amount .input { padding-left: 1.625rem; text-align: right; }
.ms__foot { display: flex; align-items: center; justify-content: space-between; margin-top: 0.25rem; }
.ms__total { font-size: 0.875rem; color: var(--muted); }
.ms__total .num { margin-left: 0.5rem; font-size: 1.125rem; color: var(--ink); }

.error { margin: 0; font-size: 0.8125rem; color: var(--danger); }
.actions { display: flex; justify-content: flex-end; gap: 0.5rem; padding-top: 1.25rem; border-top: 1px solid var(--line); }

.done h2 { margin: 0; font-size: 1.125rem; font-weight: 600; }
.done p { margin: 0.375rem 0 0; font-size: 0.875rem; color: var(--muted); }
.code { display: flex; align-items: center; justify-content: space-between; gap: 1rem; margin: 1rem 0 1.25rem; padding: 0.75rem 0.75rem 0.75rem 1rem; border-radius: var(--r-md); background: var(--bg-2); border: 1px dashed var(--line); }
.code .num { font-size: 1.25rem; letter-spacing: 0.15em; color: var(--accent-2); }

@media (max-width: 640px) {
  .ms__row { grid-template-columns: 32px minmax(0, 1fr) 40px; }
  .ms__amount { grid-column: 2; }
}
</style>
