<!--
  AgentAccess — personal tokens that let an AI agent use Verdikt for you over MCP (Claude Desktop,
  Claude Code, any MCP client). A token is shown once; the agent acts with your rights, everything
  it says is labelled as your agent, and money needs you once: it creates PayPal hold links you approve,
  or holds jobs from the spending limit you approved (SpendLimit, below).
-->
<script setup>
import { ref, onMounted } from 'vue'
import { Bot, Plus, KeyRound, ShieldCheck } from 'lucide-vue-next'
import VCard from '@/components/ui/VCard.vue'
import VButton from '@/components/ui/VButton.vue'
import VCopy from '@/components/ui/VCopy.vue'
import { api, isDemo } from '@/services'
import { toast } from '@/composables/useToast'
import { timeAgo, shortDate } from '@/domain/format'

const mcpUrl = `${import.meta.env.VITE_API_URL || (import.meta.env.PROD ? location.origin : 'http://localhost:4100')}/mcp`
const tokens = ref([])
const label = ref('Claude Desktop')
const fresh = ref(null)        // { token, label } — shown once
const busy = ref('')

async function load() {
  if (isDemo) return
  try { tokens.value = (await api.listAgentTokens()).tokens } catch (e) { toast(e.message, { tone: 'danger' }) }
}
onMounted(load)

async function create() {
  busy.value = 'create'
  try {
    const t = await api.createAgentToken(label.value.trim() || 'AI agent')
    fresh.value = t
    await load()
  } catch (e) {
    toast(e.message, { tone: 'danger' })
  } finally {
    busy.value = ''
  }
}
async function revoke(t) {
  busy.value = t.id
  try {
    await api.revokeAgentToken(t.id)
    if (fresh.value?.id === t.id) fresh.value = null
    toast(`Revoked “${t.label}” — that agent can no longer act for you`)
    await load()
  } finally {
    busy.value = ''
  }
}
const desktopConfig = (token) => JSON.stringify({ mcpServers: { verdikt: { type: 'http', url: mcpUrl, headers: { Authorization: `Bearer ${token}` } } } }, null, 2)
const codeCommand = (token) => `claude mcp add --transport http verdikt ${mcpUrl} --header "Authorization: Bearer ${token}"`
</script>

<template>
  <VCard title="AI agents" sub="Let an AI agent hire, negotiate and deliver through Verdikt for you, over MCP.">
    <div class="aa">
      <ul class="aa__facts">
        <li><Bot :size="15" aria-hidden="true" /> 31 tools: price and post jobs, review applicants and hire, negotiate, accept and sign terms, fund, plan purchases, deliver, read verdicts, check a portfolio, check the money against PayPal.</li>
        <li><ShieldCheck :size="15" aria-hidden="true" /> It acts with your rights and everything it says is labelled as your agent. Money needs you once: approve each PayPal hold, or set a spending limit and it holds jobs from that, within your rules.</li>
      </ul>

      <template v-if="isDemo">
        <p class="aa__demo">Agent tokens need a real account. Sign in for real, then connect any MCP client to <span class="vk-num">{{ mcpUrl }}</span>.</p>
      </template>

      <template v-else>
        <form class="aa__new" @submit.prevent="create">
          <input v-model="label" class="vk-input" maxlength="60" aria-label="Name this agent" placeholder="Which agent is this for?" />
          <VButton type="submit" :icon="Plus" :loading="busy === 'create'">Create token</VButton>
        </form>

        <div v-if="fresh" class="aa__fresh" role="status">
          <p class="aa__fresh-title"><KeyRound :size="15" aria-hidden="true" /> Copy it now — it won't be shown again</p>
          <VCopy :value="fresh.token" label="Copy token" />
          <details class="aa__how" open>
            <summary>Claude Desktop — add to claude_desktop_config.json</summary>
            <pre class="aa__code">{{ desktopConfig(fresh.token) }}</pre>
            <VCopy :value="desktopConfig(fresh.token)" label="Copy config" />
          </details>
          <details class="aa__how">
            <summary>Claude Code — run in a terminal</summary>
            <pre class="aa__code">{{ codeCommand(fresh.token) }}</pre>
            <VCopy :value="codeCommand(fresh.token)" label="Copy command" />
          </details>
        </div>

        <ul v-if="tokens.length" class="aa__list">
          <li v-for="t in tokens" :key="t.id" :class="{ 'is-revoked': t.revoked_at }">
            <span class="aa__name">{{ t.label }}</span>
            <span class="aa__meta">
              <template v-if="t.revoked_at">revoked {{ shortDate(t.revoked_at) }}</template>
              <template v-else>created {{ shortDate(t.created_at) }} · {{ t.last_used_at ? `used ${timeAgo(t.last_used_at)}` : 'not used yet' }}</template>
            </span>
            <VButton v-if="!t.revoked_at" size="sm" variant="ghost" :loading="busy === t.id" @click="revoke(t)">Revoke</VButton>
          </li>
        </ul>
        <p class="aa__endpoint vk-faint">MCP endpoint · <span class="vk-num">{{ mcpUrl }}</span></p>
      </template>
    </div>
  </VCard>
</template>

<style scoped>
.aa { display: flex; flex-direction: column; gap: 16px; }
.aa__facts { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 8px; }
.aa__facts li { display: flex; gap: 10px; font: var(--vk-type-dense); color: var(--vk-ink-2); }
.aa__facts svg { flex: none; margin-top: 2px; color: var(--vk-accent-text); }
.aa__demo { margin: 0; padding: 12px 14px; border: 1px solid var(--vk-line-subtle); border-radius: var(--vk-r-sm); background: var(--vk-surface-2); font: var(--vk-type-dense); color: var(--vk-ink-2); overflow-wrap: anywhere; }
.aa__new { display: flex; gap: 8px; }
.aa__new .vk-input { flex: 1; min-width: 0; }
.aa__fresh { display: flex; flex-direction: column; gap: 10px; padding: 14px 16px; border: 1px solid var(--vk-accent-line); border-radius: var(--vk-r-md); background: var(--vk-accent-soft); }
.aa__fresh-title { display: flex; align-items: center; gap: 8px; margin: 0; font: var(--vk-type-dense); color: var(--vk-ink); }
.aa__how summary { font: var(--vk-type-small); color: var(--vk-ink-2); cursor: pointer; }
.aa__code { margin: 8px 0; padding: 10px 12px; border: 1px solid var(--vk-line); border-radius: var(--vk-r-sm); background: var(--vk-surface); font: 12px/18px var(--vk-mono); color: var(--vk-ink); white-space: pre-wrap; overflow-wrap: anywhere; }
.aa__list { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; }
.aa__list li { display: flex; align-items: center; gap: 12px; padding: 10px 0; border-top: 1px solid var(--vk-line-subtle); }
.aa__list li.is-revoked { opacity: .6; }
.aa__name { font: var(--vk-type-dense); color: var(--vk-ink); }
.aa__meta { flex: 1; font: var(--vk-type-small); color: var(--vk-muted); }
.aa__endpoint { margin: 0; font: var(--vk-type-small); overflow-wrap: anywhere; }
</style>
