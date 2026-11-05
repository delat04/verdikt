<!--
  Proof of work — a freelancer's public record: only milestones an AI verifier checked against signed
  terms and PayPal paid out. Clients stay anonymous; every card carries its check result and a masked
  PayPal capture id. Opt-in from Settings. Public route: /u/:handle
-->
<script setup>
import { ref, onMounted, computed } from 'vue'
import { ShieldCheck, ArrowRight, Check } from 'lucide-vue-next'
import BrandMark from '@/components/BrandMark.vue'
import VButton from '@/components/ui/VButton.vue'
import VAvatar from '@/components/ui/VAvatar.vue'
import VPill from '@/components/ui/VPill.vue'
import { api } from '@/services'
import { money, shortDate } from '@/domain/format'

const props = defineProps({ handle: { type: String, required: true } })
const data = ref(null)
const error = ref('')
onMounted(async () => {
  try { data.value = await api.getProof(props.handle) } catch (e) { error.value = e.message }
})
const s = computed(() => data.value?.stats)
const pct = (x) => (x == null ? '—' : `${Math.round(x * 100)}%`)
</script>

<template>
  <div class="pf">
    <header class="pf__nav">
      <RouterLink to="/" class="pf__brand"><BrandMark :size="26" /> Verdikt</RouterLink>
      <VButton to="/login" size="sm" variant="ink" :icon-right="ArrowRight">Start a contract</VButton>
    </header>

    <main class="pf__main">
      <div v-if="error" class="pf__empty">
        <h1 class="pf__title">No public proof page here</h1>
        <p class="pf__sub">{{ error }}</p>
      </div>
      <div v-else-if="!data" class="pf__empty"><span class="vk-spin" /></div>

      <template v-else>
        <section class="pf__hero">
          <VAvatar :name="data.name" size="lg" />
          <div>
            <p class="vk-eyebrow">Proof of work · verified by AI, settled by PayPal</p>
            <h1 class="pf__title">{{ data.name }}</h1>
            <p v-if="data.headline" class="pf__sub">{{ data.headline }}</p>
          </div>
        </section>

        <section class="vk-stats pf__stats" aria-label="Verified record">
          <div class="vk-stat"><span class="vk-stat__n pf__money">{{ money(s.paidCents, 'USD', { whole: true }) }}</span><span class="vk-stat__l">paid on evidence</span></div>
          <div class="vk-stat"><span class="vk-stat__n">{{ s.milestones }}</span><span class="vk-stat__l">milestones</span></div>
          <div class="vk-stat"><span class="vk-stat__n">{{ pct(s.firstTryRate) }}</span><span class="vk-stat__l">passed first try</span></div>
          <div class="vk-stat"><span class="vk-stat__n">{{ s.clients }}</span><span class="vk-stat__l">{{ s.clients === 1 ? 'client' : 'clients' }}</span></div>
          <div class="vk-stat"><span class="vk-stat__n">{{ s.captures }}</span><span class="vk-stat__l">PayPal captures</span></div>
        </section>

        <p class="pf__why"><ShieldCheck :size="16" aria-hidden="true" /> Nothing here is self-reported. Each card is a milestone an AI verifier checked against terms both sides signed, and PayPal paid out. Clients stay anonymous.</p>

        <ol class="pf__grid">
          <li v-for="(p, i) in data.proofs" :key="i" class="pf__card">
            <div class="pf__card-top">
              <h2 class="pf__card-title">{{ p.title }}</h2>
              <span class="pf__card-money vk-num">{{ money(p.releasedCents, 'USD', { whole: true }) }}</span>
            </div>
            <div class="pf__meter" :aria-label="`${p.checks.passed} of ${p.checks.total} checks passed`">
              <span v-for="n in p.checks.total" :key="n" :class="{ 'is-on': n <= p.checks.passed }" />
            </div>
            <p class="pf__card-meta">
              <Check :size="13" aria-hidden="true" /> {{ p.checks.passed }} of {{ p.checks.total }} checks
              · {{ shortDate(p.releasedAt) }}
              <template v-if="p.releasedCents < p.ofCents"> · {{ money(p.releasedCents, 'USD', { whole: true }) }} of {{ money(p.ofCents, 'USD', { whole: true }) }}</template>
            </p>
            <div class="pf__card-foot">
              <VPill size="sm" :tone="p.attempts <= 1 ? 'ok' : 'neutral'" :dot="false">{{ p.attempts <= 1 ? 'First try' : `${p.attempts} attempts` }}</VPill>
              <span class="pf__cap vk-num">PayPal {{ p.capture }}<template v-if="p.captures > 1"> · {{ p.captures }} captures</template></span>
            </div>
          </li>
        </ol>
        <p v-if="!data.proofs.length" class="pf__sub">No paid milestones yet.</p>

        <section class="pf__cta">
          <div>
            <h2 class="pf__cta-title">Hire {{ data.name.split(' ')[0] }} through Verdikt</h2>
            <p class="pf__sub">PayPal holds the money; it's released only when the work passes the checks you both signed.</p>
          </div>
          <VButton to="/login" :icon-right="ArrowRight">Start a contract</VButton>
        </section>
      </template>
    </main>
  </div>
</template>

<style scoped>
.pf { min-height: 100vh; background: var(--vk-canvas); }
.pf__nav { display: flex; align-items: center; justify-content: space-between; max-width: 1080px; margin: 0 auto; padding: 20px clamp(16px, 4vw, 40px); }
.pf__brand { display: inline-flex; align-items: center; gap: 10px; font: 400 18px/24px var(--vk-font); color: var(--vk-ink); text-decoration: none; }
.pf__main { max-width: 1080px; margin: 0 auto; padding: 24px clamp(16px, 4vw, 40px) 80px; display: flex; flex-direction: column; gap: 28px; }
.pf__empty { padding: 80px 0; text-align: center; }
.pf__hero { display: flex; align-items: center; gap: 18px; }
.pf__title { margin: 6px 0 0; font: var(--vk-type-title); letter-spacing: -.035em; color: var(--vk-ink); }
.pf__sub { margin: 6px 0 0; font: var(--vk-type-body); color: var(--vk-muted); }
.pf__stats { padding: 22px 0; border-top: 1px solid var(--vk-line); border-bottom: 1px solid var(--vk-line); }
.pf__stats .vk-stat__n { font: var(--vk-num-28); }
.pf__money { color: var(--vk-ok-ink); }
.pf__why { display: flex; gap: 10px; align-items: flex-start; margin: 0; font: var(--vk-type-dense); color: var(--vk-ink-2); max-width: 760px; }
.pf__why svg { flex: none; margin-top: 2px; color: var(--vk-accent-text); }
.pf__grid { margin: 0; padding: 0; list-style: none; display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 14px; }
.pf__card { display: flex; flex-direction: column; gap: 12px; padding: 18px; border: 1px solid var(--vk-line); border-radius: var(--vk-r-md); background: var(--vk-surface); }
.pf__card-top { display: flex; justify-content: space-between; gap: 12px; align-items: baseline; }
.pf__card-title { margin: 0; font: 400 15px/21px var(--vk-font); color: var(--vk-ink); }
.pf__card-money { font: var(--vk-num-18); color: var(--vk-ok-ink); white-space: nowrap; }
.pf__meter { display: flex; gap: 3px; }
.pf__meter span { flex: 1; height: 6px; border-radius: var(--vk-r-full); background: var(--vk-surface-2); border: 1px solid var(--vk-line); }
.pf__meter span.is-on { background: var(--vk-ok); border-color: var(--vk-ok); }
.pf__card-meta { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; margin: 0; font: var(--vk-type-small); color: var(--vk-muted); }
.pf__card-foot { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.pf__cap { font-size: 11px; color: var(--vk-faint); }
.pf__cta { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; padding: 24px; border: 1px solid var(--vk-accent-line); border-radius: var(--vk-r-lg); background: var(--vk-accent-soft); }
.pf__cta-title { margin: 0; font: 400 20px/26px var(--vk-font); color: var(--vk-ink); }
</style>
