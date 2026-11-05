<!--
  New contract — two ways in. Recommended: open a contract room (your side → the idea), where both
  parties shape the terms with the AI mediator. Or write them yourself in four short steps:
  side → the work → milestones → review.
  Plain words in, checkable terms out: the agent drafts the criteria right after "Create".
  A split page: the steps stay on top, Back / Continue stay pinned to the bottom of the form, and the
  right column shows the contract taking shape as you type (the rail sizes itself to the amounts).
-->
<script setup>
import { ref, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ArrowLeft, ArrowRight, Briefcase, Code2, Plus, Trash2, Check, MessagesSquare, ListChecks } from 'lucide-vue-next'
import AppShell from '@/layouts/AppShell.vue'
import VButton from '@/components/ui/VButton.vue'
import VCard from '@/components/ui/VCard.vue'
import VField from '@/components/ui/VField.vue'
import VIconButton from '@/components/ui/VIconButton.vue'
import VSegmented from '@/components/ui/VSegmented.vue'
import MiniRail from '@/components/MiniRail.vue'
import { useSplitScroll } from '@/composables/useSplitScroll'
import { api } from '@/services'
import { useAuthStore } from '@/stores/auth'
import { money, toCents } from '@/domain/format'
import { toast } from '@/composables/useToast'

const auth = useAuthStore()
const router = useRouter()

// room: agree the terms in conversation with the mediator · manual: write brief and milestones now
const mode = ref('room')
const STEPS = computed(() => (mode.value === 'room' ? ['Your side', 'The idea'] : ['Your side', 'The work', 'Milestones', 'Review']))
const last = computed(() => STEPS.value.length - 1)
const step = ref(0)
const idea = ref('')
const IDEA_HINTS = ['Budget is about $', 'It should be live in ', 'It must work on phones.', 'Must-haves: ']
const addIdea = (h) => { idea.value = `${idea.value.trim()}${idea.value.trim() ? ' ' : ''}${h}` }
const dir = ref('wz-next')

const role = ref(auth.profile?.intent === 'freelancer' ? 'freelancer' : 'client')
const counterpartEmail = ref('')
const title = ref('')
const brief = ref('')
const plan = ref('phased')
const milestones = ref([])

const HINTS = [
  'It must look right on phones (375px wide) as well as desktop.',
  'It has a contact or newsletter form that confirms after submitting.',
  'Pages load fast on mobile.',
  'The code is handed over in a GitHub repository.',
  'All the copy I provide is used — no placeholder text.',
]
function addHint(h) {
  if (brief.value.includes(h)) return
  brief.value = `${brief.value.trim()}${brief.value.trim() ? '\n' : ''}${h}`
}

const PLANS = {
  single: [{ title: 'Full delivery', description: 'Everything in the brief, delivered at once', amount: '' }],
  phased: [
    { title: 'Design & landing page', description: 'Approved design and the first live page', amount: '' },
    { title: 'Core build', description: 'The main features from the brief', amount: '' },
    { title: 'Launch & handover', description: 'Polish, performance and repository handover', amount: '' },
  ],
}
function applyPlan(p) {
  milestones.value = PLANS[p].map((m) => ({ ...m, due: '' }))
}
applyPlan('phased')
watch(plan, (p) => applyPlan(p))

const total = computed(() => milestones.value.reduce((s, m) => s + toCents(m.amount), 0))
// the preview rail starts where a real one does: M1 waiting to be funded, the rest in line
const previewMs = computed(() => milestones.value.map((m, i) => ({ id: String(i), amountCents: toCents(m.amount), status: i === 0 ? 'awaiting_funding' : 'draft' })))
const label = (i) => (i === milestones.value.length - 1 && milestones.value.length > 1 ? 'Final' : `M${i + 1}`)
const other = computed(() => (role.value === 'client' ? 'freelancer' : 'client'))

const valid = computed(() => (mode.value === 'room' ? [
  true,
  title.value.trim().length >= 4 && idea.value.trim().length >= 15,
] : [
  true,
  title.value.trim().length >= 4 && brief.value.trim().length >= 30,
  milestones.value.length > 0 && milestones.value.every((m) => m.title.trim() && toCents(m.amount) >= 100),
  true,
])[step.value])

const { root, scrolled, reveal } = useSplitScroll()
const formEl = ref(null)
function go(d) {
  dir.value = d > 0 ? 'wz-next' : 'wz-back'
  step.value += d
  reveal(formEl.value)   // a new step starts at its top
}

const busy = ref(false)
const error = ref('')
async function openRoom() {
  busy.value = true
  error.value = ''
  try {
    const { id } = await api.openRoom({ role: role.value, title: title.value, idea: idea.value, counterpartEmail: counterpartEmail.value })
    toast('Room open — Verdikt is drafting the first terms')
    router.push(`/contracts/${id}`)
  } catch (e) {
    error.value = e.message
    busy.value = false
  }
}
async function create() {
  busy.value = true
  error.value = ''
  try {
    const { id } = await api.createContract({
      role: role.value,
      title: title.value,
      brief: brief.value,
      counterpartEmail: counterpartEmail.value,
      milestones: milestones.value.map((m) => ({
        title: m.title, description: m.description, amountCents: toCents(m.amount),
        dueAt: m.due ? new Date(m.due).toISOString() : null,
      })),
    })
    toast('Contract created — the agent is drafting the checks')
    router.push(`/contracts/${id}`)
  } catch (e) {
    error.value = e.message
    busy.value = false
  }
}
</script>

<template>
  <AppShell back="/contracts">
    <template #crumbs><RouterLink to="/contracts">Contracts</RouterLink><span class="vk-faint">/</span><span>New</span></template>

    <div ref="root" class="vk-split wizard" :class="{ 'is-scrolled': scrolled }">
      <header class="vk-split__head head">
        <div class="head__row">
          <h1 class="head__title">New contract</h1>
          <span class="vk-faint head__count vk-num">Step {{ step + 1 }} of {{ STEPS.length }}</span>
        </div>
        <ol class="vk-steps" aria-label="Progress">
          <li v-for="(s, i) in STEPS" :key="s" class="vk-steps__item" :class="{ 'is-done': i < step, 'is-now': i === step }">
            <span class="vk-steps__bar" />
            <span class="vk-steps__label">{{ i + 1 }} · {{ s }}</span>
          </li>
        </ol>
      </header>

      <div class="vk-split__cols">
      <div class="vk-split__col vk-split__col--flush-end">
      <form ref="formEl" class="form" @submit.prevent="step < last ? valid && go(1) : valid && (mode === 'room' ? openRoom() : create())">
        <Transition :name="dir" mode="out-in">
          <!-- 1 · side -->
          <section v-if="step === 0" key="0" class="step">
            <h2 class="step__title">How do you want to set the terms?</h2>
            <div class="vk-choices two" role="radiogroup" aria-label="How the terms are made">
              <button type="button" role="radio" class="vk-choice" :class="{ 'is-active': mode === 'room' }" :aria-checked="mode === 'room'" @click="mode = 'room'">
                <span class="vk-choice__icon"><MessagesSquare :size="18" /></span>
                <span><p class="vk-choice__title">Agree them together <span class="rec">Recommended</span></p><p class="vk-choice__sub">Open a contract room with your {{ other }}. Verdikt drafts the terms as you talk and suggests fair trades.</p></span>
                <span class="vk-choice__radio" />
              </button>
              <button type="button" role="radio" class="vk-choice" :class="{ 'is-active': mode === 'manual' }" :aria-checked="mode === 'manual'" @click="mode = 'manual'">
                <span class="vk-choice__icon"><ListChecks :size="18" /></span>
                <span><p class="vk-choice__title">Write them myself</p><p class="vk-choice__sub">Brief, milestones and amounts now. The agent drafts the checks right after.</p></span>
                <span class="vk-choice__radio" />
              </button>
            </div>
            <h2 class="step__title step__title--next">Which side of this contract are you?</h2>
            <div class="vk-choices two" role="radiogroup" aria-label="Your role">
              <button type="button" role="radio" class="vk-choice" :class="{ 'is-active': role === 'client' }" :aria-checked="role === 'client'" @click="role = 'client'">
                <span class="vk-choice__icon"><Briefcase :size="18" /></span>
                <span><p class="vk-choice__title">I'm the client</p><p class="vk-choice__sub">I fund milestones and pay for work that passes.</p></span>
                <span class="vk-choice__radio" />
              </button>
              <button type="button" role="radio" class="vk-choice" :class="{ 'is-active': role === 'freelancer' }" :aria-checked="role === 'freelancer'" @click="role = 'freelancer'">
                <span class="vk-choice__icon"><Code2 :size="18" /></span>
                <span><p class="vk-choice__title">I'm the freelancer</p><p class="vk-choice__sub">I deliver the work and get paid when it's proven.</p></span>
                <span class="vk-choice__radio" />
              </button>
            </div>
            <VField :label="`Your ${other}'s email`" for="cp" optional hint="They'll see an invitation when they sign in. You also get a code to share.">
              <input id="cp" v-model="counterpartEmail" class="vk-input" type="email" :placeholder="other === 'freelancer' ? 'sam@okafor.studio' : 'maya@northbrew.co'" />
            </VField>
          </section>

          <!-- 2 · the work -->
          <section v-else-if="step === 1 && mode === 'room'" key="1r" class="step">
            <h2 class="step__title">What's the idea?</h2>
            <p class="step__sub">A sentence or two is enough. Verdikt drafts the first terms sheet from it, and your {{ other }} shapes the rest with you in the room.</p>
            <VField label="Project title" for="rtitle">
              <input id="rtitle" v-model="title" class="vk-input vk-input--lg" required placeholder="Café site with pickup orders" />
            </VField>
            <VField label="Your opening message" for="idea" :hint="`${idea.trim().length} characters · at least 15`">
              <textarea id="idea" v-model="idea" class="vk-textarea" rows="5" placeholder="We need a site for the café: the menu, opening hours and pre-orders for pickup. Budget about $1,500, live in 4 weeks." />
            </VField>
            <div class="hints">
              <span class="vk-eyebrow">Helps the first draft</span>
              <div class="hints__row">
                <button v-for="h in IDEA_HINTS" :key="h" type="button" class="hint" @click="addIdea(h)"><Plus :size="12" :stroke-width="2.4" />{{ h.replace(/[ .$]+$/, '') }}</button>
              </div>
            </div>
            <p v-if="error" class="vk-field__error">{{ error }}</p>
          </section>

          <section v-else-if="step === 1" key="1" class="step">
            <h2 class="step__title">Describe the work in plain words</h2>
            <p class="step__sub">The agent turns this into checks it can run against the live site and the code. The clearer the brief, the fairer the verdict.</p>
            <VField label="Project title" for="title">
              <input id="title" v-model="title" class="vk-input vk-input--lg" required placeholder="Landing page and shop for a coffee roastery" />
            </VField>
            <VField label="Brief" for="brief" :hint="`${brief.trim().length} characters · at least 30`">
              <textarea id="brief" v-model="brief" class="vk-textarea" rows="7" placeholder="What should exist when this is done? Pages, features, devices, links to designs…" />
            </VField>
            <div class="hints">
              <span class="vk-eyebrow">Often worth saying</span>
              <div class="hints__row">
                <button v-for="h in HINTS" :key="h" type="button" class="hint" :class="{ 'is-on': brief.includes(h) }" @click="addHint(h)">
                  <Check v-if="brief.includes(h)" :size="12" :stroke-width="2.4" /><Plus v-else :size="12" :stroke-width="2.4" />
                  {{ h.replace(/\.$/, '') }}
                </button>
              </div>
            </div>
          </section>

          <!-- 3 · milestones -->
          <section v-else-if="step === 2" key="2" class="step">
            <div class="step__row">
              <div>
                <h2 class="step__title">Split it into milestones</h2>
                <p class="step__sub">Each one is funded, checked and paid on its own. The last one is the final payment.</p>
              </div>
              <VSegmented v-model="plan" :options="[{ value: 'single', label: 'One delivery' }, { value: 'phased', label: 'Three phases' }]" label="Plan" />
            </div>

            <ol class="ms">
              <li v-for="(m, i) in milestones" :key="i" class="ms__item">
                <div class="ms__head">
                  <span class="ms__n vk-num">{{ i === milestones.length - 1 && milestones.length > 1 ? 'Final' : `M${i + 1}` }}</span>
                  <VIconButton :icon="Trash2" label="Remove milestone" size="sm" bare :disabled="milestones.length === 1" @click="milestones.splice(i, 1)" />
                </div>
                <div class="ms__grid">
                  <VField label="Title" :for="`mt${i}`">
                    <input :id="`mt${i}`" v-model="m.title" class="vk-input" required />
                  </VField>
                  <VField label="Amount" :for="`ma${i}`">
                    <div class="vk-affix">
                      <span class="vk-affix__pre">$</span>
                      <input :id="`ma${i}`" v-model="m.amount" class="vk-input vk-num" inputmode="decimal" placeholder="0.00" required />
                      <span class="vk-affix__post">USD</span>
                    </div>
                  </VField>
                  <VField label="What's delivered" :for="`md${i}`" class="ms__wide">
                    <input :id="`md${i}`" v-model="m.description" class="vk-input" placeholder="What exists at the end of this milestone" />
                  </VField>
                  <VField label="Due" :for="`mdue${i}`" optional>
                    <input :id="`mdue${i}`" v-model="m.due" class="vk-input" type="date" />
                  </VField>
                </div>
              </li>
            </ol>
            <div class="ms__foot">
              <VButton variant="ghost" size="sm" :icon="Plus" :disabled="milestones.length >= 6" @click="milestones.push({ title: '', description: '', amount: '', due: '' })">Add milestone</VButton>
              <p class="ms__total">Total <span class="vk-num">{{ money(total) }}</span></p>
            </div>
          </section>

          <!-- 4 · review -->
          <section v-else key="3" class="step">
            <h2 class="step__title">Review, then let the agent draft the checks</h2>
            <VCard variant="well">
              <dl class="vk-kv">
                <div class="vk-kv__row"><dt class="vk-kv__k">Project</dt><dd class="vk-kv__v" style="font-family: var(--vk-font)">{{ title }}</dd></div>
                <div class="vk-kv__row"><dt class="vk-kv__k">You are</dt><dd class="vk-kv__v" style="font-family: var(--vk-font)">The {{ role }}</dd></div>
                <div class="vk-kv__row"><dt class="vk-kv__k">Inviting</dt><dd class="vk-kv__v">{{ counterpartEmail || 'By code, after creating' }}</dd></div>
                <div v-for="(m, i) in milestones" :key="i" class="vk-kv__row">
                  <dt class="vk-kv__k">{{ i === milestones.length - 1 && milestones.length > 1 ? 'Final' : `M${i + 1}` }} · {{ m.title }}</dt>
                  <dd class="vk-kv__v">{{ money(toCents(m.amount)) }}</dd>
                </div>
                <div class="vk-kv__row total"><dt class="vk-kv__k">Total</dt><dd class="vk-kv__v">{{ money(total) }}</dd></div>
              </dl>
            </VCard>
            <div class="brief">
              <p class="vk-eyebrow">The brief the agent reads</p>
              <p class="brief__text">{{ brief }}</p>
            </div>
            <p v-if="error" class="vk-field__error">{{ error }}</p>
          </section>
        </Transition>

        <footer class="foot">
          <VButton v-if="step > 0" variant="ghost" :icon="ArrowLeft" @click="go(-1)">Back</VButton>
          <VButton v-else variant="ghost" to="/contracts">Cancel</VButton>
          <span style="flex: 1" />
          <VButton v-if="step < last" type="submit" :disabled="!valid" :icon-right="ArrowRight">Continue</VButton>
          <VButton v-else-if="mode === 'room'" type="submit" :disabled="!valid" :loading="busy" :icon="MessagesSquare">Open the room</VButton>
          <VButton v-else type="submit" :loading="busy">Create & draft the checks</VButton>
        </footer>
      </form>
      </div>

      <!-- the contract taking shape -->
      <aside class="vk-split__col side">
        <VCard v-if="mode === 'room'" class="pv">
          <p class="vk-eyebrow">Contract room</p>
          <h3 class="pv__title" :class="{ 'is-empty': !title.trim() }">{{ title.trim() || 'Untitled contract' }}</h3>
          <p class="pv__who">You're the {{ role }} · {{ counterpartEmail ? `inviting ${counterpartEmail}` : 'invite by code once the room is open' }}</p>
          <p v-if="idea.trim()" class="pv__idea">{{ idea.trim() }}</p>
        </VCard>
        <VCard v-if="mode === 'room'" title="How the room works">
          <ol class="after">
            <li><span class="vk-num">1</span> Verdikt drafts a terms sheet from your message: scope, payments, dates.</li>
            <li><span class="vk-num">2</span> You and your {{ other }} talk it through. It turns vague wishes into checks and proposes fair trades.</li>
            <li><span class="vk-num">3</span> When you both accept the same version, the terms lock into milestones the agent can verify.</li>
          </ol>
        </VCard>
        <VCard v-if="mode === 'manual'" class="pv">
          <p class="vk-eyebrow">Live preview</p>
          <h3 class="pv__title" :class="{ 'is-empty': !title.trim() }">{{ title.trim() || 'Untitled contract' }}</h3>
          <p class="pv__who">You're the {{ role }} · {{ counterpartEmail ? `inviting ${counterpartEmail}` : 'invite by code after creating' }}</p>
          <MiniRail :milestones="previewMs" class="pv__rail" />
          <ol class="pv__ms">
            <li v-for="(m, i) in milestones" :key="i">
              <span class="pv__n vk-num">{{ label(i) }}</span>
              <span class="pv__t" :class="{ 'is-empty': !m.title.trim() }">{{ m.title.trim() || 'Untitled milestone' }}</span>
              <span class="vk-num">{{ toCents(m.amount) ? money(toCents(m.amount)) : '—' }}</span>
            </li>
          </ol>
          <div class="pv__total"><span>Total held in escrow, milestone by milestone</span><span class="vk-num">{{ money(total) }}</span></div>
        </VCard>

        <VCard v-if="mode === 'manual'" title="After you create it">
          <ol class="after">
            <li><span class="vk-num">1</span> The agent drafts checkable criteria for each milestone — usually in seconds.</li>
            <li><span class="vk-num">2</span> You and your {{ other }} review, edit and sign them.</li>
            <li><span class="vk-num">3</span> The client funds milestone 1. PayPal holds it until the checks pass.</li>
          </ol>
        </VCard>
      </aside>
      </div>
    </div>
  </AppShell>
</template>

<style scoped>
.wizard { --vk-aside-w: 360px; }
.head { display: flex; flex-direction: column; gap: 16px; padding-top: 20px; }
.head__row { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; }
.head__title { margin: 0; font: var(--vk-type-page); letter-spacing: -.03em; }
.head__count { font: var(--vk-num-11); letter-spacing: .08em; text-transform: uppercase; }
.form { max-width: 720px; }
.step { display: flex; flex-direction: column; gap: 20px; }
.step__title { margin: 0; font: var(--vk-type-page); letter-spacing: -.025em; }
.step__title--next { margin-top: 12px; }
.rec { margin-left: 6px; padding: 1px 8px; border-radius: var(--vk-r-full); background: var(--vk-accent-soft); color: var(--vk-accent-text); font: var(--vk-type-small); vertical-align: 1px; }
.pv__idea { margin: 14px 0 0; padding: 10px 14px; border: 1px solid var(--vk-accent-line); border-radius: 16px 16px 4px 16px; background: var(--vk-accent-soft); font: var(--vk-type-dense); color: var(--vk-ink); overflow-wrap: anywhere; }
.step__sub { margin: -12px 0 0; font: var(--vk-type-body); color: var(--vk-muted); max-width: 560px; }
.step__row { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
.step__row .step__sub { margin-top: 8px; }
.two { grid-template-columns: 1fr 1fr; }

.hints { display: flex; flex-direction: column; gap: 10px; }
.hints__row { display: flex; gap: 8px; flex-wrap: wrap; }
.hint {
  display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 0 12px;
  border: 1px solid var(--vk-line); border-radius: var(--vk-r-full); background: var(--vk-surface);
  font: var(--vk-type-small); color: var(--vk-ink-2); cursor: pointer; transition: border-color var(--vk-dur-2);
}
.hint:hover { border-color: var(--vk-line-strong); }
.hint.is-on { border-color: var(--vk-accent-line); background: var(--vk-accent-soft); color: var(--vk-accent-text); }

.ms { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 12px; }
.ms__item { padding: 16px; border: 1px solid var(--vk-line); border-radius: var(--vk-r-md); background: var(--vk-surface); }
.ms__head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
.ms__n { font-size: 12px; color: var(--vk-muted); text-transform: uppercase; letter-spacing: .08em; }
.ms__grid { display: grid; grid-template-columns: minmax(0, 1fr) 180px; gap: 14px; }
.ms__foot { display: flex; align-items: center; justify-content: space-between; }
.ms__total { margin: 0; font: var(--vk-type-body); color: var(--vk-muted); }
.ms__total .vk-num { margin-left: 8px; font-size: 18px; color: var(--vk-ink); }

.total { padding-top: 10px; border-top: 1px solid var(--vk-line); }
.total .vk-kv__v { font-size: 16px; }
.after { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 10px; }
.after li { display: flex; gap: 12px; font: var(--vk-type-dense); color: var(--vk-ink-2); }
.after .vk-num { display: grid; place-items: center; flex: none; width: 22px; height: 22px; border-radius: 50%; border: 1px solid var(--vk-line); font-size: 11px; color: var(--vk-muted); }

/* Back / Continue stay pinned to the bottom of the column, whatever the step's length */
.foot {
  position: sticky; bottom: 0; z-index: 2; display: flex; align-items: center; gap: 8px;
  margin-top: 32px; padding: 16px 0 20px; border-top: 1px solid var(--vk-line); background: var(--vk-canvas);
}

.brief { padding: 16px 18px; border: 1px solid var(--vk-line); border-radius: var(--vk-r-md); background: var(--vk-surface); }
.brief__text { margin: 8px 0 0; font: var(--vk-type-dense); color: var(--vk-ink-2); white-space: pre-line; }

.side { display: flex; flex-direction: column; gap: 16px; }
.pv__title { margin: 12px 0 0; font: 400 21px/27px var(--vk-font); letter-spacing: -.025em; overflow-wrap: anywhere; }
.pv__title.is-empty, .pv__t.is-empty { color: var(--vk-faint); }
.pv__who { margin: 6px 0 0; font: var(--vk-type-small); color: var(--vk-muted); overflow-wrap: anywhere; }
.pv__rail { margin-top: 18px; }
.pv__ms { margin: 16px 0 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 10px; }
.pv__ms li { display: grid; grid-template-columns: 40px minmax(0, 1fr) auto; gap: 10px; align-items: baseline; font: var(--vk-type-dense); }
.pv__n { font-size: 11px; color: var(--vk-faint); text-transform: uppercase; letter-spacing: .06em; }
.pv__t { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--vk-ink-2); }
.pv__total { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; margin-top: 16px; padding-top: 14px; border-top: 1px solid var(--vk-line); font: var(--vk-type-small); color: var(--vk-muted); }
.pv__total .vk-num { font-size: 18px; color: var(--vk-ink); }

@media (max-width: 1100px) {
  .foot { padding-bottom: 16px; }
}
@media (max-width: 640px) {
  .two { grid-template-columns: 1fr; }
  .ms__grid { grid-template-columns: 1fr; }
}
</style>
