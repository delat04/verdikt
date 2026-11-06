<!--
  Jobs — where people (and their agents) find each other before there's a contract.
  Find work: open jobs, apply with a price and a pitch; or search the public web for posts that fit you, each
  with a drafted message that brings the work into escrow (nothing is sent for you).
  Your posts: every application reviewed — Verdikt's PayPal-settled record of the freelancer, red flags, then
  Claude's read of the pitch — and hiring opens a contract room with both of you.
  Post a job: with a price check first — a fair range and what the project costs online, from live web prices.
-->
<script setup>
import { ref, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import { Briefcase, Search, Send, Check, X, Copy, ExternalLink, Scale, Globe, ArrowRight } from 'lucide-vue-next'
import AppShell from '@/layouts/AppShell.vue'
import VButton from '@/components/ui/VButton.vue'
import VField from '@/components/ui/VField.vue'
import VPill from '@/components/ui/VPill.vue'
import VSegmented from '@/components/ui/VSegmented.vue'
import VEmptyState from '@/components/ui/VEmptyState.vue'
import PriceCheck from '@/components/PriceCheck.vue'
import { useLive } from '@/composables/useLive'
import { useAuthStore } from '@/stores/auth'
import { api, isDemo } from '@/services'
import { toast } from '@/composables/useToast'
import { money, toCents, timeAgo, firstName, hostOf } from '@/domain/format'

const auth = useAuthStore()
const router = useRouter()
const { data, loading } = useLive(() => api.listJobs())

const view = ref(auth.profile?.intent === 'client' ? 'posts' : 'find')
const views = computed(() => [
  { value: 'find', label: 'Find work' },
  { value: 'posts', label: `Your posts${data.value?.posted?.length ? ` · ${data.value.posted.length}` : ''}` },
  { value: 'post', label: 'Post a job' },
])
const busy = ref('')
async function run(key, fn, ok) {
  busy.value = key
  try {
    const r = await fn()
    if (ok) toast(typeof ok === 'function' ? ok(r) : ok, { tone: 'ok' })
    return r
  } catch (e) {
    toast(e.message, { tone: 'danger' })
    return null
  } finally {
    busy.value = ''
  }
}
const budgetOf = (j) => (j.budgetMinCents || j.budgetMaxCents
  ? `${j.budgetMinCents ? money(j.budgetMinCents, j.currency, { whole: true }) : ''}${j.budgetMinCents && j.budgetMaxCents ? '–' : ''}${j.budgetMaxCents ? money(j.budgetMaxCents, j.currency, { whole: true }) : ''}`
  : 'Budget open')

// ---- find work
const q = ref('')
const open = computed(() => (data.value?.open || []).filter((j) => !q.value || `${j.title} ${j.brief} ${j.skills.join(' ')}`.toLowerCase().includes(q.value.toLowerCase())))
const applying = ref(null)
const form = ref({ price: '', days: '', pitch: '' })
function startApply(j) {
  applying.value = j.id
  form.value = { price: j.budgetMaxCents ? String(Math.round((j.budgetMinCents || j.budgetMaxCents) / 100 + ((j.budgetMaxCents - (j.budgetMinCents || j.budgetMaxCents)) / 200))) : '', days: j.dueDays ? String(j.dueDays) : '', pitch: '' }
}
const applyValid = computed(() => toCents(form.value.price) >= 100 && form.value.pitch.trim().length >= 40)
async function apply(j) {
  const r = await run(`apply-${j.id}`, () => api.applyToJob(j.id, { priceCents: toCents(form.value.price), days: form.value.days ? Number(form.value.days) : null, pitch: form.value.pitch.trim() }),
    `Applied to “${j.title}” — ${firstName(j.client?.name || 'the client')} sees it with a review`)
  if (r) applying.value = null
}
const STATUS = { pending: { label: 'Applied', tone: 'neutral' }, accepted: { label: 'Hired', tone: 'ok' }, declined: { label: 'Not chosen', tone: 'neutral' }, withdrawn: { label: 'Withdrawn', tone: 'neutral' } }

// ---- beyond Verdikt
const skills = ref('')
const scouted = ref(null)
const scout = async () => { scouted.value = await run('scout', () => api.scoutOpportunities(skills.value.trim())) }
async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast('Message copied') } catch { toast('Copy failed — select the text instead', { tone: 'danger' }) }
}

// ---- your posts
const posted = computed(() => data.value?.posted || [])
const hire = async (a, j) => {
  const r = await run(`hire-${a.id}`, () => api.hireApplicant(a.id), `${firstName(a.freelancer?.name || 'They')} is hired — the contract room is open`)
  if (r?.contractId) router.push(`/contracts/${r.contractId}`)
}
const decline = (a) => run(`decline-${a.id}`, () => api.declineApplicant(a.id), 'Application declined')
const closeJob = (j) => run(`close-${j.id}`, () => api.closeJob(j.id), 'Job closed')
const fitTone = (f) => (f >= 70 ? 'ok' : f >= 40 ? 'warn' : 'danger')

// ---- post a job
const draft = ref({ title: '', brief: '', min: '', max: '', days: '', skills: '' })
const price = ref(null)
watch(() => [draft.value.title, draft.value.brief], () => { price.value = null })
const canPrice = computed(() => draft.value.title.trim().length >= 4 && draft.value.brief.trim().length >= 30)
const typed = computed(() => ({ minCents: toCents(draft.value.min) || null, maxCents: toCents(draft.value.max) || null }))
const checkPrice = async () => { price.value = await run('price', () => api.priceCheck({ title: draft.value.title.trim(), brief: draft.value.brief.trim() })) }
function useRange() {
  draft.value.min = String(Math.round(price.value.work.lowCents / 100))
  draft.value.max = String(Math.round(price.value.work.highCents / 100))
  if (!draft.value.days) draft.value.days = String(Math.max(7, Math.ceil(price.value.days * 1.5)))
}
async function post() {
  const r = await run('post', () => api.postJob({
    title: draft.value.title.trim(), brief: draft.value.brief.trim(),
    budgetMinCents: typed.value.minCents, budgetMaxCents: typed.value.maxCents, dueDays: draft.value.days ? Number(draft.value.days) : null,
    skills: draft.value.skills.split(',').map((s) => s.trim()).filter(Boolean),
    priceCheck: price.value ? { lowCents: price.value.work.lowCents, typicalCents: price.value.work.typicalCents, highCents: price.value.work.highCents, upfrontCents: price.value.plan.upfrontCents } : null,
  }), 'Job posted — applications arrive with a review')
  if (r) { draft.value = { title: '', brief: '', min: '', max: '', days: '', skills: '' }; price.value = null; view.value = 'posts' }
}
</script>

<template>
  <AppShell>
    <div class="vk-page jobs">
      <header class="vk-page__head">
        <div>
          <p class="vk-eyebrow">Jobs</p>
          <h1 class="vk-page__title">Find each other first</h1>
          <p class="vk-page__sub">Post a job or apply to one — yourself or through your AI agent. Hiring opens a contract room with both of you; the money waits in PayPal escrow until the work passes the checks you sign.</p>
        </div>
        <VSegmented v-model="view" :options="views" label="Jobs" />
      </header>

      <div v-if="loading && !data" class="vk-skel" style="height: 280px; border-radius: var(--vk-r-lg)" />

      <!-- ===== find work ===== -->
      <template v-else-if="view === 'find'">
        <div class="vk-affix jobs__search"><Search :size="15" /><input v-model="q" class="vk-input" placeholder="Search jobs — a stack, a kind of work" aria-label="Search jobs" /></div>
        <ol v-if="open.length" class="jobs__list">
          <li v-for="j in open" :key="j.id" class="job">
            <div class="job__head">
              <div class="job__titles">
                <p class="job__title">{{ j.title }}</p>
                <p class="job__meta vk-faint">{{ j.client?.name || 'A client' }}<template v-if="j.viaAgent"> · posted by their agent</template> · {{ timeAgo(j.createdAt) }} · {{ j.applications }} applied</p>
              </div>
              <div class="job__money">
                <p class="job__budget vk-num">{{ budgetOf(j) }}</p>
                <p v-if="j.dueDays" class="job__due vk-faint">in {{ j.dueDays }} days</p>
              </div>
            </div>
            <p class="job__brief">{{ j.brief }}</p>
            <div class="job__foot">
              <span v-for="s in j.skills" :key="s" class="job__tag">{{ s }}</span>
              <VPill v-if="j.applied" :tone="STATUS[j.applied]?.tone" size="sm" class="job__state">{{ STATUS[j.applied]?.label }}</VPill>
              <VButton v-else-if="applying !== j.id" size="sm" variant="secondary" :icon="Send" class="job__state" @click="startApply(j)">Apply</VButton>
            </div>
            <form v-if="applying === j.id" class="apply" @submit.prevent="apply(j)">
              <div class="apply__grid">
                <VField label="Your price" :for="`p-${j.id}`">
                  <div class="vk-affix"><span class="vk-affix__pre">$</span><input :id="`p-${j.id}`" v-model="form.price" class="vk-input vk-num" inputmode="decimal" /></div>
                </VField>
                <VField label="Days to deliver" :for="`d-${j.id}`" optional>
                  <input :id="`d-${j.id}`" v-model="form.days" class="vk-input vk-num" inputmode="numeric" />
                </VField>
              </div>
              <VField label="How you'd do it" :for="`t-${j.id}`" hint="Concrete beats long: what you'd build, with what, how it'll be checked. Asking to be paid off Verdikt flags the application.">
                <textarea :id="`t-${j.id}`" v-model="form.pitch" class="vk-textarea" rows="4" maxlength="3000" />
              </VField>
              <div class="apply__actions">
                <VButton variant="ghost" @click="applying = null">Cancel</VButton>
                <VButton type="submit" :icon="Send" :disabled="!applyValid || !!busy" :loading="busy === `apply-${j.id}`">Send application</VButton>
              </div>
            </form>
          </li>
        </ol>
        <VEmptyState v-else :icon="Briefcase" title="No open jobs match" sub="Post one yourself, or look beyond Verdikt below." />

        <section v-if="data?.applied?.length" class="mine">
          <h2 class="jobs__h2">Your applications</h2>
          <ul class="mine__list">
            <li v-for="a in data.applied" :key="a.id">
              <span class="mine__what">{{ a.job?.title }}<span class="vk-faint"> · {{ a.job?.client }}</span></span>
              <span class="vk-num">{{ money(a.priceCents, a.job?.currency || 'USD') }}</span>
              <VPill :tone="STATUS[a.status]?.tone" size="sm">{{ STATUS[a.status]?.label }}</VPill>
              <VButton v-if="a.job?.contractId" size="sm" variant="ghost" :icon-right="ArrowRight" :to="`/contracts/${a.job.contractId}`">Contract room</VButton>
            </li>
          </ul>
        </section>

        <!-- beyond Verdikt: the web, not other marketplaces -->
        <section class="scout">
          <div class="scout__head">
            <p class="scout__title"><Globe :size="16" :stroke-width="1.9" /> Find work beyond Verdikt</p>
            <p class="scout__sub">Claude searches the public web for recent posts from people looking to hire for what you do — or the boards and threads where they post — and drafts a first message offering to do it through Verdikt's escrow. It never suggests moving work off a marketplace, cites only pages it actually found, and never sends anything: you decide whether to reach out.</p>
          </div>
          <form class="scout__form" @submit.prevent="scout">
            <input v-model="skills" class="vk-input" maxlength="400" placeholder="What you do — e.g. Vue and Supabase web apps, landing pages for small businesses" aria-label="Your skills" />
            <VButton type="submit" variant="secondary" :icon="Search" :disabled="skills.trim().length < 3 || !!busy" :loading="busy === 'scout'">Search the web</VButton>
          </form>
          <p v-if="busy === 'scout'" class="scout__wait vk-faint"><span class="vk-spin" /> Searching and reading posts — about half a minute…</p>
          <template v-if="scouted">
            <ol v-if="scouted.posts.length" class="scout__list">
              <li v-for="p in scouted.posts" :key="p.url" class="post">
                <p class="post__kind"><span class="post__tag">{{ p.kind === 'board' ? 'Where this work gets posted' : 'Post' }}</span><span v-if="p.marketplace" class="post__tag">Marketplace — apply there</span></p>
                <a :href="p.url" target="_blank" rel="noopener noreferrer" class="post__title">{{ p.title }} <ExternalLink :size="13" /></a>
                <p class="post__meta vk-faint">{{ p.source || hostOf(p.url) }}<template v-if="p.posted || p.age"> · {{ p.posted || p.age }}</template><template v-if="p.budget"> · {{ p.budget }}</template></p>
                <p class="post__fit">{{ p.fit }}</p>
                <p v-if="p.marketplace" class="post__fit vk-faint">Its terms keep the client's work on that site, so Verdikt doesn't draft a message to move it.</p>
                <div v-if="p.pitch" class="post__pitch">
                  <p>{{ p.pitch }}</p>
                  <VButton size="sm" variant="ghost" :icon="Copy" @click="copy(p.pitch)">Copy message</VButton>
                </div>
              </li>
            </ol>
            <p v-else class="vk-faint scout__none">No fitting posts this time — try other words for what you do.</p>
            <p class="scout__meta vk-faint">{{ scouted.demo ? 'Sample results in demo mode — the live app searches the web.' : `${scouted.searches} searches · ${scouted.searched} pages read${scouted.dropped ? ` · ${scouted.dropped} result${scouted.dropped === 1 ? '' : 's'} dropped (not from the search, or a marketplace)` : ''}${scouted.cached ? ' · reused, no new tokens' : ''}` }}</p>
          </template>
        </section>
      </template>

      <!-- ===== your posts ===== -->
      <template v-else-if="view === 'posts'">
        <VEmptyState v-if="!posted.length" :icon="Briefcase" title="You haven't posted a job" sub="Post one and freelancers — or their agents — apply with a price and a plan.">
          <VButton @click="view = 'post'">Post a job</VButton>
        </VEmptyState>
        <section v-for="j in posted" :key="j.id" class="posted">
          <div class="job__head">
            <div class="job__titles">
              <p class="job__title">{{ j.title }}</p>
              <p class="job__meta vk-faint">{{ budgetOf(j) }}<template v-if="j.dueDays"> · in {{ j.dueDays }} days</template> · posted {{ timeAgo(j.createdAt) }}<template v-if="j.priceCheck"> · fair range {{ money(j.priceCheck.lowCents, j.currency, { whole: true }) }}–{{ money(j.priceCheck.highCents, j.currency, { whole: true }) }}</template></p>
            </div>
            <VPill :tone="j.status === 'hired' ? 'ok' : 'neutral'" size="sm" :outline="j.status === 'open'">{{ { open: 'Open', hired: 'Hired', closed: 'Closed' }[j.status] }}</VPill>
          </div>
          <ol v-if="j.candidates.length" class="cands">
            <li v-for="(a, i) in j.candidates" :key="a.id" class="cand" :class="`is-${a.status}`">
              <div class="cand__head">
                <span class="cand__rank vk-num">{{ i + 1 }}</span>
                <div class="cand__who">
                  <p class="cand__name">{{ a.freelancer?.name }}<span v-if="a.viaAgent" class="cand__agent">agent</span><RouterLink v-if="a.freelancer?.handle" :to="`/u/${a.freelancer.handle}`" class="cand__proof">proof of work</RouterLink></p>
                  <p class="cand__offer vk-num">{{ money(a.priceCents, j.currency) }}<template v-if="a.days"> · {{ a.days }} days</template></p>
                </div>
                <span v-if="a.review" class="cand__fit vk-num" :class="`is-${fitTone(a.review.fit)}`" :title="`Fit ${a.review.fit} of 100`">{{ a.review.fit }}</span>
                <span v-else class="cand__fit is-wait vk-faint"><span class="vk-spin" /></span>
              </div>
              <template v-if="a.review">
                <p class="cand__sum">{{ a.review.summary }}</p>
                <ul class="cand__flags">
                  <li v-for="f in a.review.flags" :key="f.text" :class="`is-${f.tone}`">{{ f.text }}</li>
                </ul>
                <ul v-if="a.review.risks?.length" class="cand__risks">
                  <li v-for="r in a.review.risks" :key="r">{{ r }}</li>
                </ul>
                <p v-if="a.review.ask" class="cand__ask"><b>Ask them:</b> {{ a.review.ask }}</p>
              </template>
              <p v-else class="cand__sum vk-faint">Reviewing — Verdikt's record of their paid work, red flags, then Claude reads the pitch.</p>
              <details class="cand__pitch"><summary>Their pitch</summary><p>{{ a.pitch }}</p></details>
              <div v-if="j.status === 'open' && a.status === 'pending'" class="cand__actions">
                <VButton size="sm" variant="ghost" :icon="X" :loading="busy === `decline-${a.id}`" @click="decline(a)">Decline</VButton>
                <VButton size="sm" :variant="i === 0 && (a.review?.fit ?? 0) >= 40 ? 'primary' : 'secondary'" :icon="Check" :loading="busy === `hire-${a.id}`" :disabled="!!busy" @click="hire(a, j)">Hire and open the room</VButton>
              </div>
              <VPill v-else-if="a.status !== 'pending'" :tone="STATUS[a.status]?.tone" size="sm" class="cand__state">{{ a.status === 'accepted' ? 'Hired' : STATUS[a.status]?.label }}</VPill>
            </li>
          </ol>
          <p v-else class="vk-faint posted__none">No applications yet. Freelancers' agents find open jobs over MCP too.</p>
          <div class="posted__foot">
            <VButton v-if="j.contractId" size="sm" variant="secondary" :icon-right="ArrowRight" :to="`/contracts/${j.contractId}`">Open the contract room</VButton>
            <VButton v-if="j.status === 'open'" size="sm" variant="ghost" :loading="busy === `close-${j.id}`" @click="closeJob(j)">Close the job</VButton>
          </div>
        </section>
      </template>

      <!-- ===== post a job ===== -->
      <form v-else class="newjob" @submit.prevent="post">
        <VField label="Title" for="nj-title"><input id="nj-title" v-model="draft.title" class="vk-input" maxlength="120" placeholder="Bakery website on its own domain" /></VField>
        <VField label="What should exist when it's done" for="nj-brief" hint="Pages, features, devices — the agent turns this into checks it can test.">
          <textarea id="nj-brief" v-model="draft.brief" class="vk-textarea" rows="4" maxlength="4000" placeholder="A one-page site with the menu and prices, opening hours, a map and a contact form that emails me. Must look right on phones." />
        </VField>

        <div class="newjob__price">
          <VButton variant="secondary" :icon="Scale" :disabled="!canPrice || !!busy" :loading="busy === 'price'" @click="checkPrice">{{ price ? 'Check again' : 'Check the price' }}</VButton>
          <p class="vk-faint">A fair range and what the project costs online — domain, hosting, fonts — from current public prices.</p>
        </div>
        <p v-if="busy === 'price'" class="vk-faint newjob__wait"><span class="vk-spin" /> Searching current prices and rate guides…</p>
        <PriceCheck v-if="price" :result="price" :budget="typed">
          <template #action><VButton size="sm" variant="secondary" @click="useRange">Use this range</VButton></template>
        </PriceCheck>

        <div class="newjob__grid">
          <VField label="Budget from" for="nj-min" optional><div class="vk-affix"><span class="vk-affix__pre">$</span><input id="nj-min" v-model="draft.min" class="vk-input vk-num" inputmode="decimal" /></div></VField>
          <VField label="Budget up to" for="nj-max" optional><div class="vk-affix"><span class="vk-affix__pre">$</span><input id="nj-max" v-model="draft.max" class="vk-input vk-num" inputmode="decimal" /></div></VField>
          <VField label="Wanted in (days)" for="nj-days" optional><input id="nj-days" v-model="draft.days" class="vk-input vk-num" inputmode="numeric" /></VField>
        </div>
        <VField label="Skills" for="nj-skills" optional hint="Comma-separated — freelancers and their agents search by these."><input id="nj-skills" v-model="draft.skills" class="vk-input" placeholder="Vue, HTML/CSS, forms" /></VField>
        <div class="newjob__actions">
          <VButton type="submit" :icon="Briefcase" :disabled="!canPrice || !!busy" :loading="busy === 'post'">Post the job</VButton>
        </div>
      </form>
    </div>
  </AppShell>
</template>

<style scoped>
.jobs { display: flex; flex-direction: column; gap: 18px; }
.jobs__search { max-width: 520px; }
.jobs__h2 { margin: 0 0 10px; font: 400 18px/24px var(--vk-font); color: var(--vk-ink); }
.jobs__list, .cands, .scout__list { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 12px; }

.job, .posted { display: flex; flex-direction: column; gap: 10px; padding: 18px 20px; border: 1px solid var(--vk-line); border-radius: var(--vk-r-lg); background: var(--vk-surface); }
.job__head { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; }
.job__titles { min-width: 0; }
.job__title { margin: 0; font: 400 17px/23px var(--vk-font); color: var(--vk-ink); }
.job__meta { margin: 3px 0 0; font: var(--vk-type-small); }
.job__money { text-align: right; flex: none; }
.job__budget { margin: 0; font: var(--vk-num-13); color: var(--vk-ink); }
.job__due { margin: 2px 0 0; font: var(--vk-type-small); }
.job__brief { margin: 0; font: var(--vk-type-dense); color: var(--vk-ink-2); display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.job__foot { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.job__tag { padding: 1px 8px; border: 1px solid var(--vk-line); border-radius: var(--vk-r-full); font: var(--vk-type-small); color: var(--vk-ink-2); }
.job__state { margin-left: auto; }

.apply { display: flex; flex-direction: column; gap: 12px; padding: 14px 16px; border: 1px solid var(--vk-line); border-radius: var(--vk-r-md); background: var(--vk-surface-2); }
.apply__grid { display: grid; grid-template-columns: 180px 160px; gap: 12px; }
.apply__actions, .newjob__actions { display: flex; justify-content: flex-end; gap: 8px; }

.mine__list { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; }
.mine__list li { display: flex; align-items: center; gap: 12px; padding: 10px 0; border-top: 1px solid var(--vk-line-subtle); font: var(--vk-type-dense); }
.mine__what { flex: 1; min-width: 0; color: var(--vk-ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.scout { display: flex; flex-direction: column; gap: 12px; margin-top: 10px; padding-top: 22px; border-top: 1px solid var(--vk-line); }
.scout__title { display: flex; align-items: center; gap: 8px; margin: 0; font: 400 18px/24px var(--vk-font); color: var(--vk-ink); }
.scout__sub { margin: 4px 0 0; font: var(--vk-type-small); color: var(--vk-muted); max-width: 720px; }
.scout__form { display: flex; gap: 10px; }
.scout__form .vk-input { flex: 1; }
.scout__wait .vk-spin, .newjob__wait .vk-spin { margin-right: 6px; }
.scout__wait, .scout__none, .scout__meta, .newjob__wait { margin: 0; font: var(--vk-type-small); }
.post { display: flex; flex-direction: column; gap: 6px; padding: 14px 16px; border: 1px solid var(--vk-line); border-radius: var(--vk-r-md); }
.post__kind { display: flex; gap: 6px; margin: 0; }
.post__tag { padding: 0 8px; border: 1px solid var(--vk-line); border-radius: var(--vk-r-full); font: 400 11px/18px var(--vk-mono); color: var(--vk-muted); }
.post__title { display: inline-flex; align-items: center; gap: 6px; font: var(--vk-type-dense); color: var(--vk-accent-text); text-decoration: none; }
.post__title:hover { text-decoration: underline; text-underline-offset: 3px; }
.post__meta, .post__fit { margin: 0; font: var(--vk-type-small); }
.post__fit { color: var(--vk-ink-2); }
.post__pitch { display: flex; align-items: flex-end; gap: 10px; padding: 10px 12px; border-radius: var(--vk-r-sm); background: var(--vk-surface-2); }
.post__pitch p { flex: 1; margin: 0; font: var(--vk-type-small); color: var(--vk-ink); white-space: pre-wrap; }

.cand { display: flex; flex-direction: column; gap: 8px; padding: 14px 16px; border: 1px solid var(--vk-line); border-radius: var(--vk-r-md); }
.cand.is-declined, .cand.is-withdrawn { opacity: .65; }
.cand__head { display: grid; grid-template-columns: 22px minmax(0, 1fr) auto; gap: 10px; align-items: center; }
.cand__rank { display: grid; place-items: center; width: 22px; height: 22px; border-radius: 50%; border: 1px solid var(--vk-line-strong); font-size: 11px; color: var(--vk-muted); }
.cand__name { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin: 0; font: var(--vk-type-dense); color: var(--vk-ink); }
.cand__agent { padding: 0 6px; border: 1px solid var(--vk-line); border-radius: var(--vk-r-full); font: 400 11px/16px var(--vk-mono); color: var(--vk-muted); }
.cand__proof { font: var(--vk-type-small); color: var(--vk-accent-text); }
.cand__offer { margin: 2px 0 0; font: var(--vk-type-small); color: var(--vk-ink-2); }
.cand__fit { display: grid; place-items: center; min-width: 40px; height: 30px; padding: 0 8px; border-radius: var(--vk-r-full); border: 1px solid var(--vk-line); font: var(--vk-num-13); }
/* a strong fit is a recommendation, not money moving: cobalt, not green */
.cand__fit.is-ok { color: var(--vk-accent-text); background: var(--vk-accent-soft); border-color: var(--vk-accent-line); }
.cand__fit.is-warn { color: var(--vk-warn-ink); background: var(--vk-warn-soft); }
.cand__fit.is-danger { color: var(--vk-danger-ink); background: var(--vk-danger-soft); border-color: color-mix(in srgb, var(--vk-danger) 35%, transparent); }
.cand__sum { margin: 0; font: var(--vk-type-dense); color: var(--vk-ink); }
.cand__flags { display: flex; flex-wrap: wrap; gap: 6px; margin: 0; padding: 0; list-style: none; }
.cand__flags li { padding: 2px 9px; border: 1px solid var(--vk-line); border-radius: var(--vk-r-full); font: var(--vk-type-small); color: var(--vk-ink-2); }
.cand__flags li.is-ok { color: var(--vk-ok-ink); border-color: color-mix(in srgb, var(--vk-ok) 35%, transparent); }
.cand__flags li.is-warn { color: var(--vk-warn-ink); border-color: color-mix(in srgb, var(--vk-warn) 45%, transparent); }
.cand__flags li.is-danger { color: var(--vk-danger-ink); border-color: color-mix(in srgb, var(--vk-danger) 45%, transparent); background: var(--vk-danger-soft); }
.cand__risks { margin: 0; padding-left: 18px; list-style: disc; font: var(--vk-type-small); color: var(--vk-ink-2); display: flex; flex-direction: column; gap: 2px; }
.cand__ask { margin: 0; font: var(--vk-type-small); color: var(--vk-ink-2); }
.cand__ask b { font-weight: 400; color: var(--vk-ink); }
.cand__pitch summary { cursor: pointer; font: var(--vk-type-small); color: var(--vk-muted); }
.cand__pitch p { margin: 6px 0 0; font: var(--vk-type-small); color: var(--vk-ink-2); white-space: pre-wrap; }
.cand__actions { display: flex; justify-content: flex-end; gap: 8px; }
.cand__state { align-self: flex-start; }
.posted__none { margin: 0; font: var(--vk-type-small); }
.posted__foot { display: flex; gap: 8px; justify-content: flex-end; }
.posted__foot:empty { display: none; }

.newjob { display: flex; flex-direction: column; gap: 16px; max-width: 760px; }
.newjob__price { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.newjob__price p { margin: 0; font: var(--vk-type-small); flex: 1; min-width: 220px; }
.newjob__grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
@media (max-width: 640px) {
  .apply__grid, .newjob__grid { grid-template-columns: 1fr; }
  .scout__form { flex-direction: column; }
  .job__head { flex-direction: column; }
  .job__money { text-align: left; }
}
</style>
