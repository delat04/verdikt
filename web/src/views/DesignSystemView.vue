<!--
  Design system — the living reference. Everything renders from the real tokens and components,
  so this page can't drift from the app.
-->
<script setup>
import { ref, computed, onBeforeUnmount } from 'vue'
import {
  ArrowRight, Plus, Wallet, Trash2, Check, Search, Sun, Moon, Monitor, Globe, PenLine, ScanSearch, Banknote, Briefcase, Code2,
  LayoutGrid, Settings, ArrowUpRight, Play,
} from 'lucide-vue-next'
import BrandMark from '@/components/BrandMark.vue'
import VButton from '@/components/ui/VButton.vue'
import VIconButton from '@/components/ui/VIconButton.vue'
import VPill from '@/components/ui/VPill.vue'
import VCard from '@/components/ui/VCard.vue'
import VNotchCard from '@/components/ui/VNotchCard.vue'
import VField from '@/components/ui/VField.vue'
import VSegmented from '@/components/ui/VSegmented.vue'
import VChips from '@/components/ui/VChips.vue'
import VTabs from '@/components/ui/VTabs.vue'
import VModal from '@/components/ui/VModal.vue'
import VAvatar from '@/components/ui/VAvatar.vue'
import VCopy from '@/components/ui/VCopy.vue'
import VEmptyState from '@/components/ui/VEmptyState.vue'
import StatusPill from '@/components/StatusPill.vue'
import ScoreRing from '@/components/ScoreRing.vue'
import EscrowCard from '@/components/EscrowCard.vue'
import EscrowRail from '@/components/EscrowRail.vue'
import MiniRail from '@/components/MiniRail.vue'
import StageTrack from '@/components/StageTrack.vue'
import NextStepCard from '@/components/NextStepCard.vue'
import QueueCapsule from '@/components/QueueCapsule.vue'
import { vGlide } from '@/directives/glide'
import { STATUS } from '@/domain/milestone'
import { useTheme } from '@/composables/useTheme'
import { toast } from '@/composables/useToast'

const { theme, setTheme } = useTheme()
const themeModel = ref(theme.value)
const pickTheme = (t) => { themeModel.value = t; setTheme(t) }

const seg = ref('phased')
const tab = ref('checks')
const chip = ref('all')
const role = ref('client')
const modal = ref(false)
const railNav = ref('/contracts')

// ---- sample milestones for the rail, in every state
const day = 864e5
const ago = (d) => new Date(Date.now() - d * day).toISOString()
const results = (fails) => Array.from({ length: 6 }, (_, i) => ({ criterionId: `c${i}`, passed: i >= fails }))
const base = () => [
  { id: 'm1', position: 1, title: 'Brand landing page', amountCents: 120000, status: 'released', fundedAt: ago(8), releasedAt: ago(5), submissions: [{ id: 's1', attempt: 1, createdAt: ago(5.2), verdict: { outcome: 'pass', createdAt: ago(5.1), results: results(0) } }] },
  { id: 'm2', position: 2, title: 'Online shop', amountCents: 180000, status: 'funded', fundedAt: ago(4), submissions: [] },
  { id: 'm3', position: 3, title: 'Launch & handover', amountCents: 60000, status: 'draft', dueAt: ago(-6), submissions: [] },
]
const railState = ref('failed')
const progress = ref({ c0: 'pass', c1: 'pass', c2: 'running', c3: 'pending', c4: 'pending', c5: 'pending' })
const railMs = computed(() => {
  const ms = base()
  const m2 = ms[1]
  if (railState.value === 'unsigned') ms.forEach((m) => { m.status = 'draft'; m.releasedAt = null; m.submissions = [] })
  if (railState.value === 'verifying') Object.assign(m2, { status: 'verifying', progress: progress.value, submissions: [{ id: 's2', attempt: 1, createdAt: ago(0.01), verdict: null }] })
  if (railState.value === 'failed') Object.assign(m2, { status: 'failed', submissions: [{ id: 's2', attempt: 1, createdAt: ago(0.3), verdict: { outcome: 'fail', createdAt: ago(0.28), results: results(2) } }] })
  if (railState.value === 'complete') ms.forEach((m, i) => Object.assign(m, { status: 'released', fundedAt: ago(9 - i * 2), releasedAt: ago(6 - i * 2) }))
  return ms
})
const railSel = ref('m2')

// watch the needle travel: one check per tick while "Verifying" is shown
let timer = null
function runChecks() {
  railState.value = 'verifying'
  const keys = Object.keys(progress.value)
  keys.forEach((k, i) => { progress.value[k] = i === 0 ? 'running' : 'pending' })
  clearInterval(timer)
  let i = 0
  timer = setInterval(() => {
    progress.value = { ...progress.value, [keys[i]]: i === 3 ? 'fail' : 'pass', ...(keys[i + 1] ? { [keys[i + 1]]: 'running' } : {}) }
    i += 1
    if (i >= keys.length) clearInterval(timer)
  }, 900)
}
onBeforeUnmount(() => clearInterval(timer))

const tracks = computed(() => ['funded', 'verifying', 'failed', 'released'].map((s) => {
  const m = { ...base()[1], status: s }
  if (s !== 'funded') m.submissions = [{ id: 'x', attempt: s === 'released' ? 2 : 1, createdAt: ago(1), verdict: s === 'verifying' ? null : { outcome: s === 'failed' ? 'fail' : 'pass', createdAt: ago(0.9), results: results(s === 'failed' ? 2 : 0) } }]
  if (s === 'released') m.releasedAt = ago(0.8)
  return m
}))

const queueRows = [
  { c: { id: 'q1', title: 'Northbrew landing + shop' }, step: { actor: 'you', short: 'Fund $1,800', action: 'fund' } },
  { c: { id: 'q2', title: 'Atlas onboarding flow' }, step: { actor: 'you', short: 'Sign the terms', action: 'sign' } },
  { c: { id: 'q3', title: 'Pine & Co. booking site' }, step: { actor: 'agent', short: 'Checking M2' } },
]

const SECTIONS = ['Principles', 'Color', 'Type', 'Actions', 'Status', 'Cards', 'Forms', 'Navigation', 'The rail', 'Money & verdicts', 'Feedback', 'Icons & motion']
const anchor = (s) => s.toLowerCase().replace(/[^a-z]+/g, '-')

const swatches = [
  { group: 'Surface — the 80%', tokens: ['--vk-canvas', '--vk-surface', '--vk-surface-2', '--vk-raised', '--vk-thumb'] },
  { group: 'Line — always 1px solid', tokens: ['--vk-line-subtle', '--vk-line', '--vk-line-strong'] },
  { group: 'Ink — the 10% text', tokens: ['--vk-ink', '--vk-ink-2', '--vk-muted', '--vk-faint'] },
  { group: 'Accent — the 10% (trust)', tokens: ['--vk-accent', '--vk-accent-hover', '--vk-accent-text', '--vk-accent-soft'] },
  { group: 'Status — meaning only', tokens: ['--vk-ok', '--vk-rail-ok', '--vk-warn', '--vk-danger', '--vk-ok-soft', '--vk-danger-soft'] },
]

const typeScale = [
  { name: 'Hero', token: '--vk-type-hero', sample: 'Contracts' },
  { name: 'Title', token: '--vk-type-title', sample: 'Northbrew landing + shop' },
  { name: 'Page', token: '--vk-type-page', sample: 'Get paid when the work is proven.' },
  { name: 'Section', token: '--vk-type-section', sample: 'Waiting on you' },
  { name: 'Card', token: '--vk-type-card', sample: 'Northbrew — landing page & shop' },
  { name: 'Body', token: '--vk-type-body', sample: 'PayPal holds the money until the checks you signed pass.' },
  { name: 'Dense', token: '--vk-type-dense', sample: 'Attempt 2 · submitted 4m ago' },
  { name: 'Number', token: '--vk-num-40', sample: '$1,800' },
]
</script>

<template>
  <div class="ds">
    <aside class="ds__nav">
      <RouterLink to="/" class="ds__brand"><BrandMark :size="26" /> Verdikt <span class="vk-faint">DS</span></RouterLink>
      <nav class="ds__links" aria-label="Sections">
        <a v-for="s in SECTIONS" :key="s" :href="`#${anchor(s)}`" class="ds__link">{{ s }}</a>
      </nav>
      <VSegmented
        :model-value="themeModel" block label="Theme"
        :options="[{ value: 'light', label: '', icon: Sun }, { value: 'dark', label: '', icon: Moon }, { value: 'system', label: '', icon: Monitor }]"
        @update:model-value="pickTheme"
      />
    </aside>

    <main class="ds__main">
      <header class="ds__hero">
        <p class="vk-eyebrow">Design system · v2</p>
        <h1 class="vk-display ds__title">Every pixel has a job.</h1>
        <p class="ds__lede">Verdikt asks two strangers to trust software with money. The interface earns that by being calm, exact and honest: one clear next step, one colour for trust, green only when money actually moves — and the whole contract on one line.</p>
        <p class="ds__lineage vk-faint">Lineage: <b>Aeon</b> — token layering, pill cards, v-glide · <b>Dextra</b> — cobalt, wizard motion, segmented &amp; tabs · <b>run-arrands</b> — the 80/10/10 rule, milestone track · <b>Workspace</b> — grey canvas, notch cards, filter chips, the inverted capsule.</p>
      </header>

      <!-- principles -->
      <section :id="anchor('Principles')" class="sec">
        <h2 class="sec__title">Principles</h2>
        <div class="grid3">
          <VCard title="80 · 10 · 10" sub="80% surface — white cards on a near-white canvas, or their near-black variants. 10% ink for text. 10% accent for what you can act on.">
            <div class="ratio" aria-hidden="true"><span style="flex: 8; background: var(--vk-surface-2)" /><span style="flex: 1; background: var(--vk-ink)" /><span style="flex: 1; background: var(--vk-accent)" /></div>
          </VCard>
          <VCard title="Cobalt fill = your move" sub="Only the card that waits on you is filled. Everything else stays surface, so your eye lands on it first." />
          <VCard title="The rail is the contract" sub="Every milestone on one inverted capsule, sized by its money. You always know where the money is." />
          <VCard title="Green means money moved" sub="Success colour is never decoration. It marks a passed check or a released payment — nothing else." />
          <VCard title="1px, solid, grey" sub="Every border is one pixel of a grey tuned per theme — it even follows the notch on a card." />
          <VCard title="No coloured left borders" sub="Status on a card is a 3px pill on the left edge plus a 4% tint — the pill card." />
          <VCard title="One weight: 400" sub="Nothing is ever bold. Size, colour and spacing carry the hierarchy, so the page stays calm." />
          <VCard title="AA or it doesn't ship" sub="Even the faintest text clears 4.5:1 on white and on the grey canvas, in both themes." />
          <VCard title="Evidence over adjectives" sub="The agent never says “looks good”. It shows the check, the screenshot, the log line." />
        </div>
      </section>

      <!-- color -->
      <section :id="anchor('Color')" class="sec">
        <h2 class="sec__title">Color</h2>
        <div class="swatches">
          <div v-for="g in swatches" :key="g.group" class="swatches__group">
            <p class="vk-eyebrow">{{ g.group }}</p>
            <div v-for="t in g.tokens" :key="t" class="sw">
              <span class="sw__chip" :style="{ background: `var(${t})` }" />
              <span class="sw__name vk-num">{{ t }}</span>
            </div>
          </div>
        </div>
      </section>

      <!-- type -->
      <section :id="anchor('Type')" class="sec">
        <h2 class="sec__title">Type</h2>
        <VCard size="lg">
          <div class="fonts">
            <div><p class="vk-eyebrow">Sans · Inter Tight</p><p class="fonts__s">Aa Bb Cc — 0123</p></div>
            <div><p class="vk-eyebrow">Numbers · JetBrains Mono</p><p class="fonts__s vk-num">$2,400.00 · DEMO-CAP-5TR1</p></div>
          </div>
          <div v-for="t in typeScale" :key="t.name" class="trow">
            <span class="vk-eyebrow">{{ t.name }}</span>
            <span :style="{ font: `var(${t.token})`, letterSpacing: t.name === 'Hero' ? '-.045em' : undefined }" class="trow__s">{{ t.sample }}</span>
            <span class="vk-num vk-faint trow__t">{{ t.token }}</span>
          </div>
          <div class="vk-stats" style="margin-top: 28px">
            <div class="vk-stat"><span class="vk-stat__n">$1,800</span><span class="vk-stat__l">held</span></div>
            <div class="vk-stat"><span class="vk-stat__n">$1,200</span><span class="vk-stat__l">paid</span><span class="vk-stat__d vk-stat__d--ok">1×</span></div>
            <div class="vk-stat"><span class="vk-stat__n">2</span><span class="vk-stat__l">on you</span></div>
          </div>
          <p class="note"><b>One weight — 400 — for every word and number.</b> Hierarchy comes from size, colour (ink → muted → faint) and spacing. Stats: a mono number, a word, and at most one small badge.</p>
        </VCard>
      </section>

      <!-- actions -->
      <section :id="anchor('Actions')" class="sec">
        <h2 class="sec__title">Actions</h2>
        <VCard size="lg">
          <div class="row">
            <VButton variant="ink" size="lg" orb :icon="Plus">New contract</VButton>
            <VButton :icon-right="ArrowRight">Primary</VButton>
            <VButton variant="ink">Ink</VButton>
            <VButton variant="secondary" :icon="Plus">Secondary</VButton>
            <VButton variant="ghost">Ghost</VButton>
            <VButton variant="ok" :icon="Check">Release $1,200</VButton>
            <VButton variant="danger" :icon="Trash2">Void hold</VButton>
            <VButton loading>Loading</VButton>
          </div>
          <div class="row" style="margin-top: 16px">
            <VIconButton :icon="Search" label="Search" size="lg" />
            <VIconButton :icon="ArrowUpRight" label="Open" size="lg" tone="ink" />
            <VIconButton :icon="Plus" label="Add" size="lg" tone="accent" />
            <VIconButton :icon="Search" label="Search" />
            <VIconButton :icon="Trash2" label="Remove" size="sm" bare />
            <span class="vk-kbd">Ctrl</span><span class="vk-kbd">K</span>
          </div>
          <p class="note">Primary is the one thing to do on a screen. The orb button opens something new. Circles are for verbs that need no word. <b>OK (green) only moves money to the freelancer.</b></p>
        </VCard>
      </section>

      <!-- status -->
      <section :id="anchor('Status')" class="sec">
        <h2 class="sec__title">Status</h2>
        <VCard size="lg">
          <div class="row">
            <StatusPill v-for="(_, s) in STATUS" :key="s" :status="s" />
          </div>
          <div class="row" style="margin-top: 14px">
            <VPill tone="accent">Accent</VPill><VPill tone="ok">OK</VPill><VPill tone="warn" live>Live</VPill><VPill tone="danger">Danger</VPill><VPill outline :dot="false">Outline tag</VPill><VPill size="sm">Small</VPill>
          </div>
        </VCard>
      </section>

      <!-- cards -->
      <section :id="anchor('Cards')" class="sec">
        <h2 class="sec__title">Cards</h2>
        <p class="sec__lede">The notch card is the signature container: its corner is cut around a round button, and the 1px line follows the cut. Link cards open whole; the corner turns ink and the arrow swings on hover.</p>
        <div class="grid3">
          <VNotchCard to="/design" class="demo-notch">
            <div class="vk-notch__head demo-notch__who"><VAvatar name="Sam Okafor" size="lg" /><div><p class="demo-notch__name">Sam Okafor</p><p class="vk-faint demo-notch__sub">Freelancer</p></div></div>
            <h3 class="demo-notch__title">Northbrew landing + shop</h3>
            <div style="margin-top: auto; padding-top: 18px"><MiniRail :milestones="base()" /></div>
          </VNotchCard>
          <VNotchCard tone="accent" class="demo-notch">
            <p class="vk-eyebrow vk-notch__head">Accent · your move</p>
            <h3 class="demo-notch__title">Fund $1,800 into escrow</h3>
            <div style="margin-top: auto; padding-top: 18px"><VButton :icon="Wallet">Fund with PayPal</VButton></div>
          </VNotchCard>
          <VNotchCard tone="ink" class="demo-notch">
            <p class="vk-eyebrow vk-notch__head" style="color: inherit; opacity: .6">Ink</p>
            <h3 class="demo-notch__title">One per page, at most.</h3>
          </VNotchCard>
        </div>
        <NextStepCard style="margin-top: 16px" you="Maya Chen" :step="{ tone: 'accent', eyebrow: 'M2 · Online shop', actor: 'you', title: 'Fund $1,800.00 into escrow', sub: 'PayPal holds it. You are charged only when the work passes the checks you signed.' }">
          <VButton size="lg" :icon="Wallet">Fund with PayPal</VButton>
        </NextStepCard>
        <NextStepCard style="margin-top: 16px" :step="{ tone: 'warn', eyebrow: 'M2 · Online shop', actor: 'agent', title: 'The agent is checking the delivery', sub: 'The corner says who the contract waits on: your initials, theirs, or the agent — turning while it works.' }" />
        <div class="grid2" style="margin-top: 16px">
          <VCard title="Default card" sub="Surface, 1px line, 20px radius (28px large).">Body copy sits on the surface.</VCard>
          <VCard variant="well" title="Well" sub="Sunken: key → value, receipts.">
            <dl class="vk-kv"><div class="vk-kv__row"><dt class="vk-kv__k">Authorization</dt><dd class="vk-kv__v">DEMO-AUTH-Q8M3XZ</dd></div></dl>
          </VCard>
          <VCard variant="pill" tone="danger" title="Pill card · danger" sub="Status without a coloured border: a pill on the left edge + 4% tint." />
          <VCard variant="pill" tone="ok" title="Pill card · ok" sub="Released. Money moved." />
        </div>
      </section>

      <!-- forms -->
      <section :id="anchor('Forms')" class="sec">
        <h2 class="sec__title">Forms</h2>
        <VCard size="lg">
          <div class="grid2">
            <VField label="Project title" for="ds1" hint="Hints explain; they never repeat the label."><input id="ds1" class="vk-input" placeholder="Landing page for a coffee roastery" /></VField>
            <VField label="Amount" for="ds2"><div class="vk-affix"><span class="vk-affix__pre">$</span><input id="ds2" class="vk-input vk-num" value="1,800.00" /><span class="vk-affix__post">USD</span></div></VField>
            <VField label="Live URL" for="ds3" error="Must be a public https:// URL."><div class="vk-affix"><Globe :size="15" /><input id="ds3" class="vk-input" aria-invalid="true" value="localhost:3000" /></div></VField>
            <VField label="Note" for="ds4" optional><textarea id="ds4" class="vk-textarea" rows="2" placeholder="What changed" /></VField>
          </div>
          <div class="vk-choices grid2" style="margin-top: 18px" role="radiogroup">
            <button type="button" class="vk-choice" :class="{ 'is-active': role === 'client' }" @click="role = 'client'">
              <span class="vk-choice__icon"><Briefcase :size="18" /></span><span><p class="vk-choice__title">I'm the client</p><p class="vk-choice__sub">Choice card · radio</p></span><span class="vk-choice__radio" />
            </button>
            <button type="button" class="vk-choice" :class="{ 'is-active': role === 'freelancer' }" @click="role = 'freelancer'">
              <span class="vk-choice__icon"><Code2 :size="18" /></span><span><p class="vk-choice__title">I'm the freelancer</p><p class="vk-choice__sub">Selected = accent line + 4% tint</p></span><span class="vk-choice__radio" />
            </button>
          </div>
        </VCard>
      </section>

      <!-- navigation -->
      <section :id="anchor('Navigation')" class="sec">
        <h2 class="sec__title">Navigation <span class="vk-faint">· v-glide</span></h2>
        <p class="sec__lede">One indicator travels between items with a short spring (500ms, cubic-bezier(.34, 1.32, .5, 1)) — it lands instead of stopping. The app frame: a labelled sidebar (a drawer below 960px), a top bar with the queue capsule, and ⌘K / Ctrl+K from anywhere. Pages are split: the head (title, main action, the rail) stays on screen and tightens as you scroll, while the main and side columns each scroll on their own — filter bars, tabs and the wizard's Back / Continue stick where you need them.</p>
        <div class="nav-demo">
          <div class="nav-demo__side">
            <span class="nav-demo__brand"><BrandMark :size="22" /> Verdikt</span>
            <span class="nav-demo__search"><Search :size="15" :stroke-width="1.9" /> Search <span class="vk-kbd">K</span></span>
            <div v-glide class="nav-demo__links">
              <button v-for="n in [{ to: '/contracts', icon: LayoutGrid, label: 'Contracts', badge: 2 }, { to: '/new', icon: Plus, label: 'New contract' }, { to: '/settings', icon: Settings, label: 'Settings' }]" :key="n.to" type="button" class="nav-demo__link" :class="{ 'is-active': railNav === n.to }" @click="railNav = n.to">
                <component :is="n.icon" :size="17" :stroke-width="1.9" />
                <span>{{ n.label }}</span>
                <span v-if="n.badge" class="nav-demo__badge vk-num">{{ n.badge }}</span>
              </button>
            </div>
          </div>
          <div class="nav-demo__body">
            <p class="vk-eyebrow">Queue capsule — what's waiting on you, from any page</p>
            <QueueCapsule :rows="queueRows" style="margin-top: 10px" />
            <QueueCapsule :rows="[]" style="margin-top: 10px; max-width: 360px" />
            <p class="vk-eyebrow" style="margin-top: 24px">Filter chips</p>
            <VChips v-model="chip" style="margin-top: 10px" :options="[{ value: 'all', label: 'All', count: 7 }, { value: 'you', label: 'Your move', count: 2 }, { value: 'flight', label: 'In flight', count: 4 }, { value: 'done', label: 'Done', count: 1 }]" />
            <p class="vk-eyebrow" style="margin-top: 24px">Segmented · tabs</p>
            <div class="row" style="margin-top: 10px">
              <VSegmented v-model="seg" :options="[{ value: 'single', label: 'One delivery' }, { value: 'phased', label: 'Three phases' }, { value: 'custom', label: 'Custom' }]" label="Plan" />
            </div>
            <VTabs v-model="tab" style="margin-top: 16px" :options="[{ value: 'checks', label: 'Checks', count: 6 }, { value: 'delivery', label: 'Delivery', count: 2 }, { value: 'payment', label: 'Payment' }]" />
          </div>
        </div>
      </section>

      <!-- the rail -->
      <section :id="anchor('The rail')" class="sec">
        <h2 class="sec__title">The rail</h2>
        <p class="sec__lede">The core of Verdikt: the contract on one inverted capsule. Segments are sized by their money. <b>Paid</b> is green-tinted with a check, the <b>live</b> milestone is the cobalt pill with its own lane — Held, Delivered, Verified, Paid — and a needle whose tag rides above the capsule. <b>Next</b> is dashed: reserved, not funded. Click a segment (or ←/→) to inspect it. On phones the capsule stands up, one row per milestone.</p>
        <div class="row">
          <VSegmented v-model="railState" :options="[{ value: 'unsigned', label: 'Not signed' }, { value: 'held', label: 'Held' }, { value: 'verifying', label: 'Verifying' }, { value: 'failed', label: 'Not yet' }, { value: 'complete', label: 'Paid in full' }]" label="Rail state" />
          <VButton variant="secondary" size="sm" :icon="Play" @click="runChecks">Run the checks</VButton>
        </div>
        <EscrowRail v-model="railSel" :milestones="railMs" :signed="railState !== 'unsigned'" />
        <div class="grid2" style="margin-top: 20px">
          <VCard title="Mini rail" sub="The rail at card size, on Home.">
            <div class="minis">
              <MiniRail :milestones="railMs" :signed="railState !== 'unsigned'" />
              <MiniRail :milestones="base()" />
            </div>
          </VCard>
          <VCard title="Stage track" sub="Inside a milestone: each stop, and when it happened.">
            <div class="tracks">
              <div v-for="m in tracks" :key="m.status" class="tracks__row">
                <StatusPill :status="m.status" size="sm" />
                <StageTrack :milestone="m" />
              </div>
            </div>
          </VCard>
        </div>
      </section>

      <!-- money -->
      <section :id="anchor('Money & verdicts')" class="sec">
        <h2 class="sec__title">Money &amp; verdicts</h2>
        <div class="grid2">
          <EscrowCard :held-cents="180000" :released-cents="120000" :total-cents="360000" tag="M2 · Held" />
          <VCard title="Score ring" sub="Checks passed. Red until every check passes; green only then.">
            <div class="row">
              <ScoreRing :value="100" label="6/6" />
              <ScoreRing :value="67" :pass="false" label="4/6" />
              <ScoreRing :value="50" :pass="false" label="3/6" :size="64" />
            </div>
          </VCard>
          <VCard title="Receipts" variant="well">
            <dl class="vk-kv">
              <div class="vk-kv__row"><dt class="vk-kv__k">PayPal order</dt><dd class="vk-kv__v"><VCopy value="DEMO-ORD-7H2K9P" /></dd></div>
              <div class="vk-kv__row"><dt class="vk-kv__k">Capture</dt><dd class="vk-kv__v"><VCopy value="DEMO-CAP-5TR1WA" /></dd></div>
            </dl>
          </VCard>
        </div>
      </section>

      <!-- feedback -->
      <section :id="anchor('Feedback')" class="sec">
        <h2 class="sec__title">Feedback</h2>
        <div class="grid2">
          <VCard title="Toasts & dialogs">
            <div class="row">
              <VButton variant="secondary" @click="toast('$1,800.00 is held in escrow', { tone: 'ok' })">Show toast</VButton>
              <VButton variant="secondary" @click="modal = true">Open dialog</VButton>
            </div>
            <div class="row" style="margin-top: 16px">
              <VAvatar name="Maya Chen" size="lg" /><VAvatar name="Maya Chen" /><VAvatar name="Sam Okafor" size="sm" /><span class="vk-spin" />
            </div>
          </VCard>
          <VCard title="Loading">
            <div class="vk-skel" style="height: 14px; width: 70%" />
            <div class="vk-skel" style="height: 14px; width: 50%; margin-top: 10px" />
            <div class="vk-progress" style="margin-top: 16px"><div class="vk-progress__bar" style="width: 62%" /></div>
          </VCard>
        </div>
        <VCard style="margin-top: 16px">
          <VEmptyState :icon="PenLine" title="Empty states teach the next step" sub="Say what will appear here and how to make it happen — then offer that one action.">
            <VButton :icon="Plus">Create a contract</VButton>
          </VEmptyState>
        </VCard>
      </section>

      <!-- icons -->
      <section :id="anchor('Icons & motion')" class="sec">
        <h2 class="sec__title">Icons &amp; motion</h2>
        <div class="grid2">
          <VCard title="Icons" sub="Lucide, 1.9 stroke, 14–19px. Concrete nouns and verbs only.">
            <div class="row icons">
              <PenLine :size="18" /><Wallet :size="18" /><ScanSearch :size="18" /><Banknote :size="18" /><Globe :size="18" /><Check :size="18" />
            </div>
            <p class="note"><b>Never:</b> sparkles, lightbulbs or activity pulses. The agent is shown by what it does — scanning, checking — not by magic.</p>
          </VCard>
          <VCard title="Motion" sub="Fast and purposeful.">
            <dl class="vk-kv">
              <div class="vk-kv__row"><dt class="vk-kv__k">Hover / press</dt><dd class="vk-kv__v">90–160ms</dd></div>
              <div class="vk-kv__row"><dt class="vk-kv__k">Enter / step slide</dt><dd class="vk-kv__v">240–340ms ease-out</dd></div>
              <div class="vk-kv__row"><dt class="vk-kv__k">Glide indicator</dt><dd class="vk-kv__v">500ms spring</dd></div>
              <div class="vk-kv__row"><dt class="vk-kv__k">Rail needle</dt><dd class="vk-kv__v">700ms ease-out, per check</dd></div>
              <div class="vk-kv__row"><dt class="vk-kv__k">Reduced motion</dt><dd class="vk-kv__v">all → 0.01ms</dd></div>
            </dl>
          </VCard>
        </div>
      </section>
    </main>

    <VModal :open="modal" title="Release anyway?" sub="Dialogs state the consequence, then offer the safe choice first." @close="modal = false">
      <p class="vk-muted" style="margin: 0">PayPal captures $1,800.00 from the hold. This can't be undone from Verdikt.</p>
      <template #foot>
        <VButton variant="secondary" @click="modal = false">Keep it held</VButton>
        <VButton variant="ok" @click="modal = false">Release $1,800.00</VButton>
      </template>
    </VModal>
  </div>
</template>

<style scoped>
.ds { display: grid; grid-template-columns: var(--vk-sidebar-w) minmax(0, 1fr); min-height: 100dvh; background: var(--vk-canvas); }
.ds__nav {
  position: sticky; top: 0; height: 100dvh; display: flex; flex-direction: column; gap: 20px;
  padding: 20px 14px; border-right: 1px solid var(--vk-line); background: var(--vk-surface); box-sizing: border-box;
}
.ds__brand { display: inline-flex; align-items: center; gap: 10px; padding: 4px 8px; color: var(--vk-ink); font: 400 20px/1 var(--vk-font); letter-spacing: -.03em; text-decoration: none !important; }
.ds__links { display: flex; flex-direction: column; gap: 2px; flex: 1; overflow-y: auto; }
.ds__link { padding: 11px 14px; border-radius: var(--vk-r-full); font: 400 14px/1 var(--vk-font); color: var(--vk-muted); text-decoration: none !important; }
.ds__link:hover { color: var(--vk-ink); background: var(--vk-hover); }
.ds__main { max-width: 1080px; padding: 48px clamp(16px, 4vw, 48px) 120px; }
.ds__hero { padding-bottom: 32px; border-bottom: 1px solid var(--vk-line); }
.ds__title { margin-top: 12px; }
.ds__lede { margin: 18px 0 0; max-width: 680px; font: 400 17px/27px var(--vk-font); color: var(--vk-muted); }
.ds__lineage { margin: 16px 0 0; font: var(--vk-type-small); }
.ds__lineage b { font-weight: 400; color: var(--vk-ink-2); }
.sec { padding-top: 56px; scroll-margin-top: 16px; }
.sec__title { margin: 0 0 16px; font: 400 30px/36px var(--vk-font); letter-spacing: -.03em; }
.sec__lede { margin: -4px 0 20px; max-width: 760px; font: var(--vk-type-body); color: var(--vk-muted); }
.sec__lede b { color: var(--vk-ink); font-weight: 400; }
.grid2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
.grid3 { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; }
.row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.note { margin: 14px 0 0; font: var(--vk-type-dense); color: var(--vk-muted); }
.note b { color: var(--vk-ink); font-weight: 400; }
.ratio { display: flex; height: 12px; border-radius: 6px; overflow: hidden; border: 1px solid var(--vk-line); }

.swatches { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 16px; }
.swatches__group { display: flex; flex-direction: column; gap: 6px; }
.swatches__group .vk-eyebrow { margin-bottom: 4px; }
.sw { display: flex; align-items: center; gap: 10px; padding: 6px; border: 1px solid var(--vk-line); border-radius: var(--vk-r-md); background: var(--vk-surface); }
.sw__chip { width: 40px; height: 28px; border-radius: 8px; border: 1px solid var(--vk-line); flex: none; }
.sw__name { font-size: 11.5px; color: var(--vk-muted); }

.fonts { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; padding-bottom: 16px; border-bottom: 1px solid var(--vk-line-subtle); }
.fonts__s { margin: 8px 0 0; font-size: 26px; letter-spacing: -.02em; }
.trow { display: grid; grid-template-columns: 100px minmax(0, 1fr) auto; align-items: baseline; gap: 16px; padding: 14px 0; border-bottom: 1px solid var(--vk-line-subtle); }
.trow__s { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.trow__t { font-size: 11px; }

.demo-notch { min-height: 220px; }
.demo-notch__who { display: flex; align-items: center; gap: 12px; }
.demo-notch__name { margin: 0; font: 400 14px/18px var(--vk-font); }
.demo-notch__sub { margin: 2px 0 0; font: var(--vk-type-small); }
.demo-notch__title { margin: 18px 0 0; font: 400 20px/26px var(--vk-font); letter-spacing: -.025em; }

.nav-demo { display: flex; overflow: hidden; border: 1px solid var(--vk-line); border-radius: var(--vk-r-xl); background: var(--vk-canvas); }
.nav-demo__side { display: flex; flex-direction: column; gap: 14px; width: 220px; flex: none; padding: 18px 12px; border-right: 1px solid var(--vk-line); background: var(--vk-surface); box-sizing: border-box; }
.nav-demo__brand { display: inline-flex; align-items: center; gap: 8px; padding: 0 6px; font: 400 18px/1 var(--vk-font); letter-spacing: -.03em; color: var(--vk-ink); }
.nav-demo__search { display: flex; align-items: center; gap: 8px; height: 36px; padding: 0 8px 0 12px; border: 1px solid var(--vk-line-strong); border-radius: var(--vk-r-full); font: var(--vk-type-dense); color: var(--vk-muted); }
.nav-demo__search .vk-kbd { margin-left: auto; }
.nav-demo__links { display: flex; flex-direction: column; gap: 2px; }
.nav-demo__links::before { border-radius: var(--vk-r-full); background: var(--vk-surface-2); box-shadow: inset 0 0 0 1px var(--vk-line); }
.nav-demo__link { display: flex; align-items: center; gap: 10px; height: 40px; padding: 0 12px; border: 0; border-radius: var(--vk-r-full); background: transparent; font: 400 14px/1 var(--vk-font); color: var(--vk-muted); cursor: pointer; text-align: left; }
.nav-demo__link span:first-of-type { flex: 1; }
.nav-demo__link.is-active, .nav-demo__link:hover { color: var(--vk-ink); }
.nav-demo__badge { display: grid; place-items: center; min-width: 22px; height: 22px; padding: 0 7px; box-sizing: border-box; border-radius: var(--vk-r-full); background: var(--vk-accent); color: var(--vk-on-accent); font-size: 11px; }
.nav-demo__body { flex: 1; min-width: 0; padding: 18px; }

.minis { display: flex; flex-direction: column; gap: 14px; padding-top: 4px; }
.tracks { display: flex; flex-direction: column; gap: 18px; }
.tracks__row { display: grid; grid-template-columns: 120px minmax(0, 1fr); align-items: start; gap: 12px; }
.tracks__row > :first-child { justify-self: start; margin-top: -4px; }
.icons { color: var(--vk-ink-2); gap: 18px; }

@media (max-width: 900px) {
  .ds { grid-template-columns: 1fr; }
  .ds__nav { position: static; height: auto; margin: 12px 12px 0; flex-direction: row; flex-wrap: wrap; align-items: center; }
  .ds__links { display: none; }
  .grid2, .grid3, .fonts { grid-template-columns: 1fr; }
  .trow { grid-template-columns: 1fr; gap: 4px; }
  .nav-demo { flex-direction: column; }
  .nav-demo__side { width: auto; border-right: 0; border-bottom: 1px solid var(--vk-line); }
  .tracks__row { grid-template-columns: 1fr; }
}
</style>
