<!--
  ContractRoom — client and freelancer shape the contract in one conversation. The mediator rereads
  it after each message and keeps a versioned terms sheet current; when both accept the same version,
  the terms lock into milestones and the checks are drafted. Chat on the left, the sheet on the right,
  each scrolling on its own; the composer and the acceptance stay on screen.
-->
<script setup>
import { ref, computed, watch, nextTick, onBeforeUnmount } from 'vue'
import { Send, Check, UserPlus, ArrowLeftRight, CircleDashed, CornerDownLeft, Bot, Lock, Pause } from 'lucide-vue-next'
import VField from '@/components/ui/VField.vue'
import VButton from '@/components/ui/VButton.vue'
import VAvatar from '@/components/ui/VAvatar.vue'
import VCopy from '@/components/ui/VCopy.vue'
import VModal from '@/components/ui/VModal.vue'
import VPill from '@/components/ui/VPill.vue'
import StatusPill from '@/components/StatusPill.vue'
import BrandMark from '@/components/BrandMark.vue'
import { useSplitScroll } from '@/composables/useSplitScroll'
import { useAuthStore } from '@/stores/auth'
import { api, isDemo } from '@/services'
import { toast } from '@/composables/useToast'
import { money, firstName, shortDate, timeAgo, toCents } from '@/domain/format'

const props = defineProps({
  contract: { type: Object, required: true },
  role: { type: String, default: null },
  other: { type: Object, default: null },
})
const auth = useAuthStore()
const { root, scrolled } = useSplitScroll()

const room = computed(() => props.contract.room)
const terms = computed(() => room.value?.terms || { version: 0, milestones: [], scope: [], out_of_scope: [], questions: [] })
const v = computed(() => terms.value.version)
const total = computed(() => terms.value.milestones.reduce((s, m) => s + m.amount_cents, 0))
const lastDue = computed(() => Math.max(0, ...terms.value.milestones.map((m) => m.due_days || 0)))
const cur = computed(() => props.contract.currency)
const otherRole = computed(() => (props.role === 'client' ? 'freelancer' : 'client'))
const people = computed(() => ({
  client: props.contract.client?.name || '',
  freelancer: props.contract.freelancer?.name || '',
}))
const nameOf = (r) => (r === 'agent' ? 'Verdikt' : firstName(people.value[r]) || (r === 'client' ? 'The client' : 'The freelancer'))
const dueDate = (days) => shortDate(new Date(Date.now() + days * 864e5).toISOString())

// ---- acceptance: both must accept the same version
const mineV = computed(() => (props.role === 'client' ? room.value?.clientV : room.value?.freelancerV))
const theirsV = computed(() => (props.role === 'client' ? room.value?.freelancerV : room.value?.clientV))
const iAccepted = computed(() => mineV.value === v.value && v.value > 0)
const theyAccepted = computed(() => theirsV.value === v.value && v.value > 0)
const blocker = computed(() => {
  if (!props.other) return `Invite ${props.role === 'client' ? 'your freelancer' : 'your client'} first`
  if (!terms.value.milestones.length) return 'Agree a price first — the sheet needs at least one payment'
  if (busyMediator.value) return 'The mediator is updating the sheet'
  return ''
})
const acceptRows = computed(() => ['client', 'freelancer'].map((r) => {
  const accepted = r === 'client' ? room.value?.clientV : room.value?.freelancerV
  const here = r === 'client' ? !!props.contract.client : !!props.contract.freelancer
  return {
    role: r, name: people.value[r] || (r === 'client' ? 'Client' : 'Freelancer'), here, you: r === props.role,
    state: !here ? 'Not in the room yet' : accepted === v.value && v.value > 0 ? `Accepted v${v.value}` : accepted ? `Accepted v${accepted} · changed since` : 'Not yet',
    ok: here && accepted === v.value && v.value > 0,
  }
}))

const accepting = ref(false)
async function accept() {
  accepting.value = true
  try {
    const res = await api.acceptTerms(props.contract.id, v.value)
    if (!res?.locked) toast(`You accepted version ${v.value}`)   // a lock is announced by the contract page as it turns over
  } catch (e) {
    toast(e.message, { tone: 'danger' })
  } finally {
    accepting.value = false
  }
}

// ---- the thread
const messages = computed(() => room.value?.messages || [])
const lastAgent = computed(() => [...messages.value].reverse().find((m) => m.author === 'agent'))
const suggestions = computed(() => {
  const m = lastAgent.value
  if (!m || messages.value.at(-1)?.author === props.role) return []
  return (m.suggestions || []).filter((s) => s.for === props.role || s.for === 'both')
})
const latestChanges = computed(() => {
  const m = [...messages.value].reverse().find((x) => x.author === 'agent' && x.changes?.length)
  return m && m.version === v.value ? m.changes : []
})

const draft = ref('')
const sending = ref(false)
const outbox = ref([])               // shown faded until the server echoes it back
const nudged = ref(false)            // we just spoke: show the mediator as busy before the server says so
let nudgeTimer = null
const busyMediator = computed(() => !!room.value?.busy || nudged.value)

const inputEl = ref(null)
const threadEnd = ref(null)
function grow() {
  const el = inputEl.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${Math.min(el.scrollHeight, 160)}px`
}
function use(s) {
  draft.value = s.text
  nextTick(() => { grow(); inputEl.value?.focus() })
}
async function send() {
  const body = draft.value.trim()
  if (!body || sending.value) return
  sending.value = true
  outbox.value.push({ id: `o${Date.now()}`, body })
  draft.value = ''
  nextTick(grow)
  nudged.value = true
  clearTimeout(nudgeTimer)
  nudgeTimer = setTimeout(() => { nudged.value = false }, 8000)
  try {
    await api.sendRoomMessage(props.contract.id, body)
  } catch (e) {
    outbox.value = outbox.value.filter((o) => o.body !== body)
    draft.value = body
    nudged.value = false
    toast(e.message, { tone: 'danger' })
  } finally {
    sending.value = false
  }
}
function onKey(e) {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send() }
}
onBeforeUnmount(() => clearTimeout(nudgeTimer))

// new messages: drop echoed drafts, stop the local "busy", follow the thread if you were at the bottom
watch(() => messages.value.length, (n, was) => {
  const mine = messages.value.filter((m) => m.author === props.role).map((m) => m.body)
  outbox.value = outbox.value.filter((o) => !mine.includes(o.body))
  if (was && messages.value.slice(was).some((m) => m.author === 'agent' || m.author === 'system')) nudged.value = false
  follow()
})
watch(() => room.value?.busy, (b, was) => { if (was && !b) nudged.value = false })
watch(busyMediator, () => follow())
// the thread's scroller: its own column on wide screens, the page below 1100px
function scroller(el) {
  for (let n = el?.parentElement; n; n = n.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(n).overflowY) && n.scrollHeight > n.clientHeight) return n
  }
  return document.scrollingElement
}
function follow(force = false) {
  const col = scroller(threadEnd.value)
  if (!col) return
  const near = col.scrollHeight - col.scrollTop - col.clientHeight < 220
  // after the render settles: chips and the suggestion row can still change the height
  if (near || force) nextTick(() => setTimeout(() => col.scrollTo({ top: col.scrollHeight, behavior: force ? 'auto' : 'smooth' }), 40))
}
watch(threadEnd, (el) => { if (el) setTimeout(() => follow(true), 30) })

// ---- the sheet flashes what just changed
const flash = ref(new Set())
let flashTimer = null
watch(terms, (now, before) => {
  if (!before || now.version === before.version) return
  const sig = (m) => JSON.stringify(m)
  const keys = new Set()
  now.milestones.forEach((m, i) => { if (sig(m) !== sig(before.milestones[i])) keys.add(`m${i}`) })
  now.scope.forEach((s) => { if (!before.scope.includes(s)) keys.add(`s:${s}`) })
  now.out_of_scope.forEach((s) => { if (!before.out_of_scope.includes(s)) keys.add(`o:${s}`) })
  if (now.summary !== before.summary) keys.add('summary')
  flash.value = keys
  clearTimeout(flashTimer)
  flashTimer = setTimeout(() => { flash.value = new Set() }, 2600)
})
onBeforeUnmount(() => clearTimeout(flashTimer))

// ---- your negotiating agent: a private mandate, only you see it
const mandate = computed(() => room.value?.mandate || null)
const agentOn = computed(() => !!mandate.value?.active)
const isClient = computed(() => props.role === 'client')
const mandateOpen = ref(false)
const mForm = ref({ limit: '', days: '', must: '', notes: '', auto: true })
function openMandate() {
  const m = mandate.value
  mForm.value = {
    limit: m?.limitCents ? String(m.limitCents / 100) : '',
    days: m?.deadlineDays ? String(m.deadlineDays) : '',
    must: (m?.mustHaves || []).join(', '),
    notes: m?.notes || '',
    auto: m ? m.autoAccept : true,
  }
  mandateOpen.value = true
}
const mandateSummary = computed(() => {
  const m = mandate.value
  if (!m) return ''
  return [
    m.limitCents && `${isClient.value ? 'up to' : 'at least'} ${money(m.limitCents, cur.value, { whole: true })}`,
    m.deadlineDays && `${isClient.value ? 'live within' : 'needs'} ${m.deadlineDays} days`,
    m.mustHaves?.length && `${m.mustHaves.length} must-have${m.mustHaves.length > 1 ? 's' : ''}`,
  ].filter(Boolean).join(' · ')
})
const savingMandate = ref(false)
async function saveMandate() {
  savingMandate.value = true
  try {
    await api.setMandate(props.contract.id, {
      limitCents: mForm.value.limit ? toCents(mForm.value.limit) : null,
      deadlineDays: mForm.value.days ? Number(mForm.value.days) : null,
      mustHaves: mForm.value.must.split(/[,\n]/).map((x) => x.trim()).filter(Boolean),
      notes: mForm.value.notes.trim(),
      autoAccept: mForm.value.auto,
    })
    mandateOpen.value = false
    toast('Your agent is negotiating — your limits stay private')
  } catch (e) {
    toast(e.message, { tone: 'danger' })
  } finally {
    savingMandate.value = false
  }
}
async function stopAgent() {
  try {
    await api.stopMandate(props.contract.id)
    toast("You're back in the room")
  } catch (e) {
    toast(e.message, { tone: 'danger' })
  }
}
const whoSaid = (m) => (m.author === props.role ? (m.viaAgent ? 'Your agent' : 'You') : `${nameOf(m.author)}${m.viaAgent ? "'s agent" : ''}`)

// ---- invite + demo switch
const inviteOpen = ref(false)
const inviteLink = computed(() => `${window.location.origin}/join/${props.contract.inviteCode}`)
const personas = isDemo ? api.personas() : null
async function switchToOther() {
  const key = Object.keys(personas).find((k) => k === otherRole.value)
  await auth.signInAs(key)
  toast(`Now viewing as ${personas[key].name} (${key})`)
}
</script>

<template>
  <div ref="root" class="vk-split room" :class="{ 'is-scrolled': scrolled }">
    <header class="vk-split__head">
      <div class="head">
        <div class="head__main">
          <div class="head__meta">
            <StatusPill status="scoping" contract />
            <span class="vk-faint">You're the {{ role }}<template v-if="other"> · with {{ other.name }}</template></span>
          </div>
          <h1 class="head__title">{{ contract.title }}</h1>
        </div>
        <div class="vk-stats head__stats">
          <div class="vk-stat"><span class="vk-stat__n">{{ total ? money(total, cur, { whole: true }) : '—' }}</span><span class="vk-stat__l">on the table</span></div>
          <div class="vk-stat"><span class="vk-stat__n">{{ terms.milestones.length || '—' }}</span><span class="vk-stat__l">{{ terms.milestones.length === 1 ? 'payment' : 'payments' }}</span></div>
          <div class="vk-stat"><span class="vk-stat__n">v{{ v }}</span><span class="vk-stat__l">terms</span></div>
        </div>
      </div>
    </header>

    <div class="vk-split__cols">
      <!-- the conversation -->
      <div class="vk-split__col vk-split__col--flush-end chat">
        <div class="chat__intro">
          <p class="vk-eyebrow">Contract room</p>
          <p class="chat__lede">Agree scope, price and dates here. Verdikt keeps the terms sheet current as you talk, turns vague wishes into checks it can verify later, and suggests fair trades when you disagree. Nothing is charged until you both accept the same version and sign.</p>
        </div>

        <ol class="thread">
          <li v-for="m in messages" :key="m.id" class="msg" :class="[`msg--${m.author}`, { 'msg--mine': m.author === role }]">
            <template v-if="m.author === 'system'">
              <span class="msg__sys">{{ m.body }}</span>
            </template>
            <template v-else>
              <span v-if="m.author === 'agent'" class="msg__mark" aria-hidden="true"><BrandMark :size="18" /></span>
              <VAvatar v-else-if="m.author !== role" :name="people[m.author]" size="sm" class="msg__avatar" />
              <div class="msg__body">
                <p class="msg__who">
                  <span>{{ m.author === 'agent' ? 'Verdikt · mediator' : whoSaid(m) }}</span>
                  <span v-if="m.viaAgent && m.author !== role" class="msg__agent"><Bot :size="11" aria-hidden="true" /> agent</span>
                  <span class="vk-faint">{{ timeAgo(m.createdAt) }}</span>
                </p>
                <p v-if="m.body" class="msg__text">{{ m.body }}</p>
                <div v-if="m.changes?.length" class="msg__changes">
                  <span class="msg__ver vk-num">v{{ m.version }}</span>
                  <span v-for="(c, i) in m.changes" :key="i" class="msg__change">{{ c }}</span>
                </div>
              </div>
            </template>
          </li>
          <li v-for="o in outbox" :key="o.id" class="msg msg--mine is-pending">
            <div class="msg__body">
              <p class="msg__who"><span>You</span><span class="vk-faint">sending</span></p>
              <p class="msg__text">{{ o.body }}</p>
            </div>
          </li>
          <li v-if="busyMediator" class="msg msg--agent is-typing" aria-live="polite">
            <span class="msg__mark" aria-hidden="true"><BrandMark :size="18" /></span>
            <div class="msg__body">
              <p class="msg__text typing"><span class="typing__dots" aria-hidden="true"><i /><i /><i /></span> Rereading the conversation and updating the terms</p>
            </div>
          </li>
        </ol>
        <div ref="threadEnd" />

        <div class="composer">
          <div v-if="suggestions.length" class="composer__suggest">
            <span class="vk-faint">Suggested</span>
            <button v-for="s in suggestions" :key="s.label" type="button" class="chip" :title="s.text" @click="use(s)">{{ s.label }}</button>
          </div>
          <div class="composer__box">
            <textarea
              ref="inputEl" v-model="draft" rows="1" class="composer__input"
              :placeholder="other ? `Message ${firstName(other.name)} and Verdikt…` : 'Describe what you need — Verdikt drafts the terms as you go…'"
              aria-label="Message the room" @input="grow" @keydown="onKey"
            />
            <VButton :icon="Send" :loading="sending" :disabled="!draft.trim()" aria-label="Send" @click="send">Send</VButton>
          </div>
          <p class="composer__hint vk-faint"><CornerDownLeft :size="12" /> Enter to send · Shift + Enter for a new line</p>
        </div>
      </div>

      <!-- the terms sheet -->
      <aside class="vk-split__col vk-split__col--flush-end sheet-col">
        <section class="sheet">
          <div class="sheet__head">
            <div>
              <p class="vk-eyebrow">Terms sheet</p>
              <h2 class="sheet__title">Version <span class="vk-num">{{ v }}</span></h2>
            </div>
            <VPill v-if="busyMediator" tone="warn" size="sm" live>Updating</VPill>
            <VPill v-else-if="iAccepted && theyAccepted" tone="ok" size="sm">Agreed</VPill>
            <VPill v-else tone="neutral" size="sm" :dot="false">Draft</VPill>
          </div>

          <ul v-if="latestChanges.length" class="sheet__changes" aria-label="What changed in this version">
            <li v-for="(c, i) in latestChanges" :key="i">{{ c }}</li>
          </ul>

          <p v-if="terms.summary" class="sheet__summary" :class="{ 'is-flash': flash.has('summary') }">{{ terms.summary }}</p>
          <p v-else class="sheet__empty">The sheet fills in as you talk. Say what you need, the budget and when it should be live.</p>

          <ol v-if="terms.milestones.length" class="pays">
            <li v-for="(m, i) in terms.milestones" :key="i" class="pay" :class="{ 'is-flash': flash.has(`m${i}`) }">
              <div class="pay__top">
                <span class="pay__n vk-num">{{ i + 1 }}</span>
                <span class="pay__title">{{ m.title }}</span>
                <span class="pay__amount vk-num">{{ money(m.amount_cents, cur, { whole: true }) }}</span>
              </div>
              <p class="pay__due">
                <template v-if="m.due_days">Day <span class="vk-num">{{ m.due_days }}</span> · {{ dueDate(m.due_days) }}</template>
                <template v-else>No date yet</template>
                <template v-if="i === terms.milestones.length - 1 && terms.milestones.length > 1"> · final payment</template>
              </p>
              <ul class="pay__done">
                <li v-for="(d, j) in m.done_means" :key="j"><CircleDashed :size="13" class="pay__tick" aria-hidden="true" />{{ d }}</li>
              </ul>
            </li>
          </ol>
          <div v-if="terms.milestones.length > 1" class="sheet__total">
            <span>Total</span>
            <span class="vk-num">{{ money(total, cur, { whole: true }) }}<template v-if="lastDue"> · {{ lastDue }} days</template></span>
          </div>

          <div v-if="terms.scope.length || terms.out_of_scope.length" class="scope">
            <div v-if="terms.scope.length">
              <p class="vk-eyebrow">In scope</p>
              <ul class="tags">
                <li v-for="s in terms.scope" :key="s" class="tag" :class="{ 'is-flash': flash.has(`s:${s}`) }">{{ s }}</li>
              </ul>
            </div>
            <div v-if="terms.out_of_scope.length">
              <p class="vk-eyebrow">Out of scope</p>
              <ul class="tags">
                <li v-for="s in terms.out_of_scope" :key="s" class="tag tag--out" :class="{ 'is-flash': flash.has(`o:${s}`) }">{{ s }}</li>
              </ul>
            </div>
          </div>

          <div v-if="terms.questions?.length" class="qs">
            <p class="vk-eyebrow">Open questions</p>
            <ul>
              <li v-for="(q, i) in terms.questions" :key="i">
                <span class="qs__for">{{ q.for === 'both' ? 'Both' : q.for === role ? 'You' : nameOf(q.for) }}</span>
                <span>{{ q.text }}</span>
              </li>
            </ul>
          </div>
        </section>

        <!-- acceptance stays at the bottom of the column -->
        <div class="agree-dock">
        <section v-if="other" class="agent" :class="{ 'is-on': agentOn }" aria-label="Your negotiating agent">
          <div class="agent__head">
            <span class="agent__icon" aria-hidden="true"><Bot :size="16" /></span>
            <div class="agent__text">
              <p class="agent__title">
                <template v-if="agentOn">Your agent is negotiating</template>
                <template v-else-if="mandate?.status === 'handed_back'">Your agent handed the room back</template>
                <template v-else>Let an agent negotiate for you</template>
              </p>
              <p class="agent__sub">
                <template v-if="agentOn">{{ mandateSummary }} · turn {{ mandate.turns }} of 6</template>
                <template v-else-if="mandate?.status === 'handed_back'">{{ mandate.statusNote }}</template>
                <template v-else>Set your limits once. It bargains within them and accepts only terms that fit.</template>
              </p>
            </div>
          </div>
          <p v-if="agentOn && mandate.statusNote" class="agent__note"><Lock :size="11" aria-hidden="true" /> {{ mandate.statusNote }}</p>
          <div class="agent__actions">
            <VButton v-if="agentOn" size="sm" variant="secondary" :icon="Pause" @click="stopAgent">Take over</VButton>
            <VButton size="sm" :variant="agentOn ? 'ghost' : 'secondary'" :icon="agentOn ? null : Bot" @click="openMandate">{{ agentOn ? 'Adjust limits' : mandate ? 'Hand it back to the agent' : 'Set up my agent' }}</VButton>
          </div>
        </section>
        <section class="agree" aria-label="Accept the terms">
          <ul class="agree__rows">
            <li v-for="r in acceptRows" :key="r.role" :class="{ 'is-ok': r.ok }">
              <VAvatar :name="r.name" size="sm" />
              <span class="agree__who">{{ r.you ? 'You' : firstName(r.name) }} <span class="vk-faint">· {{ r.role }}</span></span>
              <span class="agree__state">
                <Check v-if="r.ok" :size="14" aria-hidden="true" />{{ r.state }}
              </span>
            </li>
          </ul>

          <template v-if="!other">
            <VButton block :icon="UserPlus" @click="inviteOpen = true">Invite {{ role === 'client' ? 'your freelancer' : 'your client' }}</VButton>
          </template>
          <template v-else-if="iAccepted">
            <p class="agree__note">You accepted version {{ v }}. When {{ firstName(other.name) }} accepts the same version, the terms lock into milestones.</p>
            <VButton v-if="isDemo" block variant="secondary" :icon="ArrowLeftRight" @click="switchToOther">Switch to {{ firstName(other.name) }} to accept</VButton>
          </template>
          <template v-else>
            <VButton block :icon="Check" :loading="accepting" :disabled="!!blocker" @click="accept">
              {{ theyAccepted ? `Accept v${v} and lock the terms` : `Accept version ${v}` }}
            </VButton>
            <p class="agree__note">{{ blocker || (theyAccepted ? `${firstName(other.name)} already accepted this version. Accepting locks it, and the agent turns each payment into checks you both sign.` : 'Accepting does not charge anything. If the sheet changes, both of you accept again.') }}</p>
          </template>
        </section>
        </div>
      </aside>
    </div>

    <VModal :open="mandateOpen" title="Your negotiating agent" :sub="`It speaks for you in this room. ${firstName(other?.name || 'The other side')} sees that an agent is negotiating, never your limits.`" @close="mandateOpen = false">
      <form class="mandate" @submit.prevent="saveMandate">
        <div class="mandate__row">
          <VField :label="isClient ? 'The most you\'ll pay' : 'The least you\'ll take'" for="mlimit" optional>
            <div class="vk-affix"><span class="vk-affix__pre">$</span><input id="mlimit" v-model="mForm.limit" class="vk-input vk-num" inputmode="decimal" placeholder="1,400" /><span class="vk-affix__post">{{ cur }}</span></div>
          </VField>
          <VField :label="isClient ? 'Live within' : 'Time you need'" for="mdays" optional>
            <div class="vk-affix"><input id="mdays" v-model="mForm.days" class="vk-input vk-num" inputmode="numeric" placeholder="30" /><span class="vk-affix__post">days</span></div>
          </VField>
        </div>
        <VField :label="isClient ? 'Must be in scope' : 'Must stay out of scope'" for="mmust" optional hint="Separate with commas">
          <input id="mmust" v-model="mForm.must" class="vk-input" :placeholder="isClient ? 'menu page, pickup orders' : 'card payments'" />
        </VField>
        <VField label="Anything else it should know" for="mnotes" optional>
          <input id="mnotes" v-model="mForm.notes" class="vk-input" :placeholder="isClient ? 'Prefer two payments' : 'Payments can be a separate job'" />
        </VField>
        <label class="mandate__auto">
          <input v-model="mForm.auto" type="checkbox" />
          <span>Accept on my behalf when every limit is met. Otherwise it hands the room back to me to confirm.</span>
        </label>
        <p class="mandate__safe"><Lock :size="13" aria-hidden="true" /> The limits are checked in code, not just asked of the AI: it can never accept a price or date outside them. It speaks at most 6 times, then hands back to you. Money still needs you — only the client approves the PayPal hold.</p>
      </form>
      <template #foot>
        <VButton variant="secondary" @click="mandateOpen = false">Cancel</VButton>
        <VButton :icon="Bot" :loading="savingMandate" @click="saveMandate">{{ agentOn ? 'Update limits' : 'Start negotiating' }}</VButton>
      </template>
    </VModal>

    <VModal :open="inviteOpen" title="Invite to the room" :sub="`They join as the ${otherRole} and shape the terms with you.`" @close="inviteOpen = false">
      <div class="invite">
        <p class="vk-eyebrow">Invite code</p>
        <p class="invite__code vk-num"><VCopy :value="contract.inviteCode" label="Copy code" /></p>
        <p class="vk-eyebrow" style="margin-top: 16px">Or send the link</p>
        <VCopy :value="inviteLink" label="Copy link" />
        <p v-if="contract.inviteEmail" class="vk-faint invite__note">{{ contract.inviteEmail }} also sees it as an invitation when they sign in.</p>
      </div>
    </VModal>
  </div>
</template>

<style scoped>
.head { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px 40px; flex-wrap: wrap; padding-top: 4px; }
.head__main { min-width: 0; flex: 1 1 420px; }
.head__meta { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; font: var(--vk-type-dense); }
.head__title { margin: 14px 0 0; font: var(--vk-type-title); letter-spacing: -.035em; }
.head__stats { padding-bottom: 4px; }
.head__stats .vk-stat__n { font: var(--vk-num-28); }

/* ---- conversation */
.chat { display: flex; flex-direction: column; min-width: 0; }
.chat__intro { padding: 4px 0 20px; border-bottom: 1px solid var(--vk-line-subtle); }
.chat__lede { margin: 8px 0 0; max-width: 64ch; font: var(--vk-type-dense); color: var(--vk-muted); }

.thread { margin: 0; padding: 20px 0 8px; list-style: none; display: flex; flex-direction: column; gap: 18px; flex: 1 0 auto; }
.msg { display: flex; gap: 10px; align-items: flex-start; max-width: min(620px, 88%); }
.msg--mine { align-self: flex-end; flex-direction: row-reverse; }
.msg--system { align-self: center; max-width: 100%; }
.msg__sys {
  display: inline-block; padding: 4px 12px; border: 1px solid var(--vk-line); border-radius: var(--vk-r-full);
  font: var(--vk-type-small); color: var(--vk-muted); background: var(--vk-surface);
}
.msg__mark {
  display: grid; place-items: center; flex: none; width: 28px; height: 28px; border-radius: 50%;
  border: 1px solid var(--vk-line); background: var(--vk-surface); color: var(--vk-ink);
}
.msg__avatar { flex: none; }
.msg__body { min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.msg--mine .msg__body { align-items: flex-end; }
.msg__who { display: flex; gap: 8px; margin: 0; font: var(--vk-type-small); color: var(--vk-ink-2); }
.msg__text {
  margin: 0; padding: 10px 14px; border: 1px solid var(--vk-line); border-radius: 16px 16px 16px 4px;
  background: var(--vk-surface); font: var(--vk-type-body); color: var(--vk-ink); white-space: pre-wrap; overflow-wrap: anywhere;
}
.msg--mine .msg__text { border-radius: 16px 16px 4px 16px; background: var(--vk-accent-soft); border-color: var(--vk-accent-line); }
.msg--agent .msg__text { background: var(--vk-surface-2); }
.msg.is-pending { opacity: .6; }
.msg__changes { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 2px; }
.msg__ver { padding: 2px 8px; border-radius: var(--vk-r-full); background: var(--vk-ink); color: var(--vk-on-ink); font-size: 11px; line-height: 16px; }
.msg__change { padding: 2px 9px; border: 1px solid var(--vk-line); border-radius: var(--vk-r-full); font: var(--vk-type-small); color: var(--vk-ink-2); background: var(--vk-surface); }

.typing { display: flex; align-items: center; gap: 10px; color: var(--vk-muted); }
.typing__dots { display: inline-flex; gap: 4px; }
.typing__dots i { width: 5px; height: 5px; border-radius: 50%; background: var(--vk-accent); animation: room-dot 1.2s infinite var(--vk-ease-out); }
.typing__dots i:nth-child(2) { animation-delay: .15s; }
.typing__dots i:nth-child(3) { animation-delay: .3s; }
@keyframes room-dot { 0%, 60%, 100% { opacity: .25; transform: translateY(0); } 30% { opacity: 1; transform: translateY(-3px); } }
@media (prefers-reduced-motion: reduce) { .typing__dots i { animation: none; opacity: .6; } }

/* the composer stays at the bottom of the conversation column */
.composer {
  position: sticky; bottom: 0; z-index: 2; margin-top: 12px; padding: 12px 0 16px;
  background: linear-gradient(to bottom, transparent, var(--vk-canvas) 14px);
}
.composer__suggest { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 10px; font: var(--vk-type-small); }
.chip {
  padding: 5px 12px; border: 1px solid var(--vk-accent-line); border-radius: var(--vk-r-full); background: var(--vk-surface);
  font: var(--vk-type-small); color: var(--vk-accent-text); cursor: pointer; transition: background var(--vk-dur-2), border-color var(--vk-dur-2);
}
.chip:hover { background: var(--vk-accent-soft); }
.chip:focus-visible { outline: 2px solid var(--vk-focus); outline-offset: 2px; }
.composer__box {
  display: flex; align-items: flex-end; gap: 8px; padding: 6px 6px 6px 16px;
  border: 1px solid var(--vk-line-strong); border-radius: 22px; background: var(--vk-surface);
}
.composer__box:focus-within { border-color: var(--vk-accent); box-shadow: 0 0 0 3px var(--vk-accent-soft); }
.composer__input {
  flex: 1; min-width: 0; resize: none; border: 0; outline: 0; padding: 9px 0; background: transparent;
  font: var(--vk-type-body); color: var(--vk-ink); max-height: 160px;
}
.composer__input::placeholder { color: var(--vk-faint); }
.composer__hint { display: flex; align-items: center; gap: 6px; margin: 8px 0 0 16px; font: var(--vk-type-small); }

/* ---- terms sheet */
.sheet-col { display: flex; flex-direction: column; gap: 14px; }
.sheet { padding: 18px; border: 1px solid var(--vk-line); border-radius: var(--vk-r-md); background: var(--vk-surface); display: flex; flex-direction: column; gap: 14px; }
.sheet__head { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
.sheet__title { margin: 4px 0 0; font: 400 20px/26px var(--vk-font); letter-spacing: -.02em; color: var(--vk-ink); }
.sheet__changes { margin: 0; padding: 10px 12px; list-style: none; display: flex; flex-direction: column; gap: 4px; border-radius: var(--vk-r-sm); background: var(--vk-accent-soft); font: var(--vk-type-small); color: var(--vk-ink-2); }
.sheet__changes li::before { content: '· '; color: var(--vk-accent-text); }
.sheet__summary { margin: 0; font: var(--vk-type-dense); color: var(--vk-ink-2); border-radius: var(--vk-r-sm); }
.sheet__empty { margin: 0; font: var(--vk-type-dense); color: var(--vk-muted); }

.pays { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 10px; }
.pay { padding: 12px 14px; border: 1px solid var(--vk-line); border-radius: var(--vk-r-sm); background: var(--vk-surface); transition: background var(--vk-dur-4), border-color var(--vk-dur-4); }
.pay__top { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: baseline; gap: 10px; }
.pay__n { display: grid; place-items: center; width: 20px; height: 20px; border-radius: 50%; border: 1px solid var(--vk-line-strong); font-size: 11px; color: var(--vk-ink-2); align-self: center; }
.pay__title { font: 400 14px/20px var(--vk-font); color: var(--vk-ink); }
.pay__amount { font: var(--vk-num-18); color: var(--vk-ink); }
.pay__due { margin: 4px 0 0 30px; font: var(--vk-type-small); color: var(--vk-muted); }
.pay__done { margin: 10px 0 0 30px; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 6px; font: var(--vk-type-small); color: var(--vk-ink-2); }
.pay__done li { display: flex; gap: 8px; }
.pay__tick { flex: none; margin-top: 2px; color: var(--vk-faint); }
.sheet__total { display: flex; justify-content: space-between; gap: 10px; padding-top: 10px; border-top: 1px solid var(--vk-line-subtle); font: var(--vk-type-dense); color: var(--vk-ink); }

.scope { display: flex; flex-direction: column; gap: 12px; }
.tags { margin: 8px 0 0; padding: 0; list-style: none; display: flex; flex-wrap: wrap; gap: 6px; }
.tag { padding: 3px 10px; border: 1px solid var(--vk-line); border-radius: var(--vk-r-full); font: var(--vk-type-small); color: var(--vk-ink-2); background: var(--vk-surface-2); transition: background var(--vk-dur-4), border-color var(--vk-dur-4); }
.tag--out { color: var(--vk-muted); text-decoration: line-through; text-decoration-color: var(--vk-line-strong); background: var(--vk-surface); }

.qs ul { margin: 8px 0 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 8px; }
.qs li { display: flex; gap: 8px; align-items: baseline; font: var(--vk-type-small); color: var(--vk-ink-2); }
.qs__for { flex: none; padding: 1px 8px; border-radius: var(--vk-r-full); border: 1px solid var(--vk-line); color: var(--vk-ink); }

.is-flash { background: var(--vk-accent-soft) !important; border-color: var(--vk-accent-line) !important; }

/* acceptance sticks to the bottom of the sheet column */
.agree-dock {
  position: sticky; bottom: 0; z-index: 1; margin-top: auto; padding: 14px 0 16px;
  background: linear-gradient(to bottom, transparent, var(--vk-canvas) 14px);
}
.agree {
  padding: 16px; display: flex; flex-direction: column; gap: 12px;
  border: 1px solid var(--vk-line); border-radius: var(--vk-r-md); background: var(--vk-surface); box-shadow: var(--vk-elev-1);
}
.agree__rows { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 10px; }
.agree__rows li { display: flex; align-items: center; gap: 10px; font: var(--vk-type-dense); }
.agree__who { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--vk-ink); }
.agree__state { display: inline-flex; align-items: center; gap: 4px; font: var(--vk-type-small); color: var(--vk-muted); }
.is-ok .agree__state { color: var(--vk-accent-text); }
.agree__note { margin: 0; font: var(--vk-type-small); color: var(--vk-muted); }

.msg__agent { display: inline-flex; align-items: center; gap: 3px; padding: 0 7px; border: 1px solid var(--vk-accent-line); border-radius: var(--vk-r-full); color: var(--vk-accent-text); font-size: 11px; line-height: 16px; }

.agent { margin-bottom: 10px; padding: 14px 16px; border: 1px solid var(--vk-line); border-radius: var(--vk-r-md); background: var(--vk-surface); display: flex; flex-direction: column; gap: 10px; }
.agent.is-on { border-color: var(--vk-accent-line); background: var(--vk-accent-soft); }
.agent__head { display: flex; gap: 10px; align-items: flex-start; }
.agent__icon { display: grid; place-items: center; flex: none; width: 28px; height: 28px; border-radius: 50%; border: 1px solid var(--vk-line); background: var(--vk-surface); color: var(--vk-accent-text); }
.agent__text { min-width: 0; }
.agent__title { margin: 0; font: 400 14px/20px var(--vk-font); color: var(--vk-ink); }
.agent__sub { margin: 2px 0 0; font: var(--vk-type-small); color: var(--vk-muted); }
.agent__note { display: flex; gap: 6px; align-items: baseline; margin: 0; font: var(--vk-type-small); color: var(--vk-ink-2); }
.agent__actions { display: flex; gap: 8px; flex-wrap: wrap; }

.mandate { display: flex; flex-direction: column; gap: 14px; }
.mandate__row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.mandate__auto { display: flex; gap: 10px; align-items: flex-start; font: var(--vk-type-dense); color: var(--vk-ink-2); cursor: pointer; }
.mandate__auto input { margin-top: 3px; accent-color: var(--vk-accent); }
.mandate__safe { display: flex; gap: 8px; align-items: baseline; margin: 0; padding: 10px 12px; border: 1px solid var(--vk-line-subtle); border-radius: var(--vk-r-sm); background: var(--vk-surface-2); font: var(--vk-type-small); color: var(--vk-ink-2); }
@media (max-width: 560px) { .mandate__row { grid-template-columns: 1fr; } }

.invite__code { margin: 6px 0 0; font-size: 26px; letter-spacing: .14em; }
.invite__note { margin: 16px 0 0; font: var(--vk-type-small); }

@media (max-width: 1100px) {
  .composer { bottom: 0; }
  .agree-dock { position: static; padding-top: 0; background: none; }
}
@media (max-width: 760px) {
  .head__title { font-size: 28px; line-height: 34px; }
  .head__stats { gap: 18px; }
  .head__stats .vk-stat__n { font-size: 20px; line-height: 24px; }
  .msg { max-width: 94%; }
}
</style>
