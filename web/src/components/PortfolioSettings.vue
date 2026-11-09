<!--
  PortfolioSettings — past projects a freelancer lists, each opened and checked live by Verdikt's probes
  (desktop and phone sizes, speed, accessibility, basics, links, and the repo if there is one). The title and
  summary are the freelancer's words; the result is what was measured, and when. Clients see it on the public
  proof page and next to applications.
-->
<script setup>
import { ref, onMounted } from 'vue'
import { Plus, RefreshCw, ExternalLink, Check, X, Minus, ChevronDown } from 'lucide-vue-next'
import VCard from '@/components/ui/VCard.vue'
import VField from '@/components/ui/VField.vue'
import VButton from '@/components/ui/VButton.vue'
import { api, isDemo } from '@/services'
import { toast } from '@/composables/useToast'
import { timeAgo, hostOf } from '@/domain/format'

const items = ref([])
const loaded = ref(false)
const adding = ref(false)
const blank = () => ({ title: '', liveUrl: '', repoUrl: '', summary: '' })
const form = ref(blank())
const busy = ref('')            // 'add' | `check:<id>` | `remove:<id>`
const open = ref(new Set())     // projects whose checks are expanded

onMounted(async () => {
  try { items.value = (await api.listPortfolio()).items } catch (e) { toast(e.message, { tone: 'danger' }) } finally { loaded.value = true }
})

const toggle = (id) => { const s = new Set(open.value); s.has(id) ? s.delete(id) : s.add(id); open.value = s }
const clean = (i) => i.check && !i.check.counts.fail && !i.check.counts.unclear

async function add() {
  busy.value = 'add'
  try {
    const item = await api.addPortfolio({ ...form.value })
    items.value = [...items.value, item]
    form.value = blank()
    adding.value = false
    busy.value = ''
    await check(item)           // a project is checked as soon as it's added
  } catch (e) {
    toast(e.message, { tone: 'danger' })
  } finally {
    if (busy.value === 'add') busy.value = ''
  }
}

async function check(item) {
  busy.value = `check:${item.id}`
  try {
    const next = await api.checkPortfolio(item.id)
    items.value = items.value.map((x) => (x.id === next.id ? next : x))
    open.value = new Set([...open.value, next.id])
    const { pass, fail } = next.check.counts
    toast(fail ? `${pass} of ${next.check.total} checks pass on ${hostOf(next.liveUrl)}` : `Every check passes on ${hostOf(next.liveUrl)}`)
  } catch (e) {
    toast(e.message, { tone: 'danger' })
  } finally {
    busy.value = ''
  }
}

async function remove(item) {
  busy.value = `remove:${item.id}`
  try {
    await api.deletePortfolio(item.id)
    items.value = items.value.filter((x) => x.id !== item.id)
    toast('Removed from your portfolio')
  } catch (e) {
    toast(e.message, { tone: 'danger' })
  } finally {
    busy.value = ''
  }
}
</script>

<template>
  <VCard title="Portfolio" sub="Past projects, opened and checked live by Verdikt. Clients see what passed and when, beside your paid work.">
    <div class="pfo">
      <p v-if="loaded && !items.length && !adding" class="pfo__empty">Add a site you built. Verdikt opens it at desktop and phone sizes and runs the same probes it uses on deliveries.</p>

      <ul v-if="items.length" class="pfo__list">
        <li v-for="item in items" :key="item.id" class="pfo__item">
          <div class="pfo__head">
            <div class="pfo__name">
              <h3 class="pfo__title">{{ item.title }}</h3>
              <a :href="item.liveUrl" target="_blank" rel="noopener" class="pfo__host">{{ hostOf(item.liveUrl) }} <ExternalLink :size="12" aria-hidden="true" /></a>
            </div>
            <span v-if="item.check" class="pfo__score" :class="{ 'is-clean': clean(item) }">
              <span class="vk-num">{{ item.check.counts.pass }}/{{ item.check.total }}</span> pass
            </span>
          </div>
          <p v-if="item.summary" class="pfo__summary">{{ item.summary }}</p>

          <template v-if="busy === `check:${item.id}`">
            <p class="pfo__running"><span class="vk-spin" aria-hidden="true" /> Opening {{ hostOf(item.liveUrl) }} at 1440px and 375px{{ item.repoUrl ? ' and reading the repo' : '' }}…</p>
          </template>
          <template v-else-if="item.check">
            <div class="pfo__meter" :aria-label="`${item.check.counts.pass} of ${item.check.total} checks pass`">
              <span v-for="c in item.check.checks" :key="c.id" :class="`is-${c.status}`" />
            </div>
            <button type="button" class="pfo__toggle" :aria-expanded="open.has(item.id)" @click="toggle(item.id)">
              Checked {{ timeAgo(item.checkedAt) }} · {{ (item.check.ms / 1000).toFixed(1) }} s · no model
              <span v-if="item.check.demo" class="vk-faint">· sample result in demo mode</span>
              <ChevronDown :size="14" aria-hidden="true" :class="{ 'is-open': open.has(item.id) }" />
            </button>
            <ul v-if="open.has(item.id)" class="pfo__checks">
              <li v-for="c in item.check.checks" :key="c.id" :class="`is-${c.status}`">
                <span class="pfo__icon" aria-hidden="true"><Check v-if="c.status === 'pass'" :size="13" /><X v-else-if="c.status === 'fail'" :size="13" /><Minus v-else :size="13" /></span>
                <div>
                  <p class="pfo__check">{{ c.statement }}</p>
                  <p class="pfo__measured">{{ c.status === 'fail' && c.fix && !c.explanation.includes(c.fix) ? `${c.explanation} ${c.fix}` : c.explanation }}</p>
                </div>
              </li>
            </ul>
          </template>
          <p v-else class="pfo__measured">Not checked yet.</p>

          <div class="pfo__actions">
            <VButton size="sm" variant="secondary" :icon="RefreshCw" :loading="busy === `check:${item.id}`" :disabled="!!busy" @click="check(item)">{{ item.check ? 'Check again' : 'Check now' }}</VButton>
            <VButton size="sm" variant="ghost" :loading="busy === `remove:${item.id}`" :disabled="!!busy" @click="remove(item)">Remove</VButton>
          </div>
        </li>
      </ul>

      <form v-if="adding" class="pfo__form" @submit.prevent="add">
        <div class="pfo__row">
          <VField label="Project" for="pf-title"><input id="pf-title" v-model="form.title" class="vk-input" maxlength="80" placeholder="Booking page for a yoga studio" required /></VField>
          <VField label="Live site" for="pf-live"><input id="pf-live" v-model="form.liveUrl" class="vk-input" type="url" placeholder="https://…" required /></VField>
        </div>
        <VField label="GitHub repository" for="pf-repo" optional hint="Public repos also get a README and committed-secrets check.">
          <input id="pf-repo" v-model="form.repoUrl" class="vk-input" type="url" placeholder="https://github.com/you/project" />
        </VField>
        <VField label="What you built" for="pf-summary" optional>
          <input id="pf-summary" v-model="form.summary" class="vk-input" maxlength="400" placeholder="Class timetable with online booking and email reminders" />
        </VField>
        <div class="pfo__actions">
          <VButton type="submit" :loading="busy === 'add'" :disabled="!!busy && busy !== 'add'">Add and check it</VButton>
          <VButton variant="ghost" @click="adding = false; form = blank()">Cancel</VButton>
        </div>
      </form>
      <div v-else class="pfo__actions">
        <VButton variant="secondary" :icon="Plus" :disabled="!!busy || items.length >= 12" @click="adding = true">Add a project</VButton>
        <span v-if="isDemo" class="vk-faint pfo__note">The demo can't open real sites, so checks here return sample measurements.</span>
      </div>
    </div>
  </VCard>
</template>

<style scoped>
.pfo { display: flex; flex-direction: column; gap: 14px; }
.pfo__empty { margin: 0; font: var(--vk-type-dense); color: var(--vk-muted); max-width: 60ch; }
.pfo__list { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 10px; }
.pfo__item { display: flex; flex-direction: column; gap: 10px; padding: 14px 16px; border: 1px solid var(--vk-line); border-radius: var(--vk-r-md); background: var(--vk-surface); }
.pfo__head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
.pfo__name { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.pfo__title { margin: 0; font: 400 15px/21px var(--vk-font); color: var(--vk-ink); }
.pfo__host { display: inline-flex; align-items: center; gap: 4px; font: var(--vk-type-small); color: var(--vk-accent-text); text-decoration: none; overflow-wrap: anywhere; }
.pfo__host:hover { text-decoration: underline; }
.pfo__score { flex: none; font: var(--vk-type-small); color: var(--vk-muted); }
.pfo__score .vk-num { font: var(--vk-num-18); color: var(--vk-ink); }
.pfo__score.is-clean .vk-num { color: var(--vk-ok-ink); }
.pfo__summary { margin: 0; font: var(--vk-type-dense); color: var(--vk-ink-2); }
.pfo__running { display: flex; align-items: center; gap: 8px; margin: 0; font: var(--vk-type-small); color: var(--vk-muted); }
.pfo__meter { display: flex; gap: 3px; }
.pfo__meter span { flex: 1; height: 6px; border-radius: var(--vk-r-full); background: var(--vk-surface-2); border: 1px solid var(--vk-line); }
.pfo__meter span.is-pass { background: var(--vk-ok); border-color: var(--vk-ok); }
.pfo__meter span.is-fail { background: var(--vk-danger); border-color: var(--vk-danger); }
.pfo__toggle { all: unset; display: inline-flex; align-items: center; gap: 6px; flex-wrap: wrap; cursor: pointer; font: var(--vk-type-small); color: var(--vk-muted); }
.pfo__toggle:hover { color: var(--vk-ink); }
.pfo__toggle:focus-visible { outline: 2px solid var(--vk-accent); outline-offset: 2px; border-radius: 4px; }
.pfo__toggle svg { transition: transform .15s ease; }
.pfo__toggle svg.is-open { transform: rotate(180deg); }
.pfo__checks { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 8px; border-top: 1px solid var(--vk-line-subtle); padding-top: 10px; }
.pfo__checks li { display: flex; gap: 10px; align-items: flex-start; }
.pfo__icon { flex: none; display: grid; place-items: center; width: 20px; height: 20px; border-radius: 50%; border: 1px solid var(--vk-line); color: var(--vk-muted); }
.is-pass > .pfo__icon { color: var(--vk-ok-ink); border-color: var(--vk-ok); }
.is-fail > .pfo__icon { color: var(--vk-danger-ink); border-color: var(--vk-danger); }
.pfo__check { margin: 0; font: var(--vk-type-dense); color: var(--vk-ink); }
.pfo__measured { margin: 2px 0 0; font: var(--vk-type-small); color: var(--vk-muted); }
.pfo__actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.pfo__note { font: var(--vk-type-small); }
.pfo__form { display: flex; flex-direction: column; gap: 12px; padding-top: 4px; }
.pfo__row { display: grid; grid-template-columns: 1fr 1.2fr; gap: 12px; }
@media (max-width: 640px) { .pfo__row { grid-template-columns: 1fr; } }
</style>
