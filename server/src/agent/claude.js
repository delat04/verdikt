/*  ============================================================================
    One structured call to Claude: the model answers by calling a single strict tool,
    so the result is always schema-valid JSON we can store and show.
    Optionally the model may first use tools on a remote MCP server (PayPal's) — Anthropic runs those
    calls server-side; we only read the trace of what it looked up.
    With OPENROUTER_API_KEY set, the same calls go to Claude through OpenRouter's Anthropic-compatible
    endpoint instead (e.g. bring-your-own-key); otherwise straight to Anthropic with ANTHROPIC_API_KEY.
    ============================================================================ */

import Anthropic from '@anthropic-ai/sdk'

const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY || ''
// the SDK adds /v1/messages itself, so a base URL copied with /v1 on the end is trimmed
const OPENROUTER_BASE = (process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api').replace(/\/v1\/?$/, '')

export const MODEL = process.env.VERDIKT_MODEL || (OPENROUTER_KEY ? 'anthropic/claude-opus-5.5' : 'claude-opus-5-5')

let client = null
export const anthropic = () => (client ??= OPENROUTER_KEY
  ? new Anthropic({ baseURL: OPENROUTER_BASE, apiKey: null, authToken: OPENROUTER_KEY })
  : new Anthropic())

export class AgentError extends Error {}

/**
 * @param {object} p
 * @param {string} p.system      — stable instructions (kept first so the prefix caches)
 * @param {Array}  p.content     — user content blocks (text, images)
 * @param {object} p.tool        — { name, description, input_schema } (strict is added here)
 * @param {string} [p.effort]    — low | medium | high | xhigh | max
 * @param {Array}  [p.mcpServers] — [{ type: 'url', url, name, authorization_token }]
 * @param {Array}  [p.toolsets]   — [{ type: 'mcp_toolset', mcp_server_name, default_config, configs }]
 * @returns {Promise<{ input: object, trace: Array<{ tool: string, input: object, ok: boolean }>, usage: { input: number, output: number, searches: number }, searched: Array<{ url: string, title: string, age: string }> }>}
 */
export async function callAgent({ system, content, tool, effort = 'high', mcpServers, toolsets = [] }) {
  const messages = [{ role: 'user', content }]
  const trace = []
  const usage = { input: 0, output: 0, searches: 0 }
  const searched = []   // every page a server-side web search returned: what the answer may cite
  let nudged = false
  // a long run of server-side tool calls can pause the turn; send it back as-is to let it continue
  for (let turn = 0; turn < 5; turn += 1) {
    const response = await anthropic().beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      // On a policy decline, re-run on Anthropic's recommended fallback model instead of failing.
      // OpenRouter's endpoint rejects this field, so through it a decline is reported as one.
      betas: [...(OPENROUTER_KEY ? [] : ['server-side-fallback-2026-07-01']), ...(mcpServers?.length ? ['mcp-client-2025-11-20'] : [])],
      ...(OPENROUTER_KEY ? {} : { fallbacks: 'default' }),
      output_config: { effort },
      system,
      ...(mcpServers?.length ? { mcp_servers: mcpServers } : {}),
      tools: [{ ...tool, strict: true }, ...toolsets],
      tool_choice: { type: 'auto' },
      messages,
    })

    usage.input += (response.usage?.input_tokens || 0) + (response.usage?.cache_read_input_tokens || 0) + (response.usage?.cache_creation_input_tokens || 0)
    usage.output += response.usage?.output_tokens || 0
    usage.searches += response.usage?.server_tool_use?.web_search_requests || 0
    for (const b of response.content) {
      if (b.type === 'mcp_tool_use') trace.push({ id: b.id, tool: b.name, input: b.input, ok: true })
      if (b.type === 'web_search_tool_result' && Array.isArray(b.content)) {
        for (const r of b.content) if (r.url) searched.push({ url: r.url, title: r.title || '', age: r.page_age || '' })
      }
      if (b.type === 'mcp_tool_result') {
        const t = trace.find((x) => x.id === b.tool_use_id)
        if (t) t.ok = !b.is_error
      }
    }
    if (response.stop_reason === 'refusal') {
      throw new AgentError(`The model declined (${response.stop_details?.category ?? 'unspecified'})`)
    }
    if (response.stop_reason === 'max_tokens') {
      throw new AgentError('The model ran out of output tokens before finishing')
    }
    if (response.stop_reason === 'pause_turn') {
      messages.push({ role: 'assistant', content: response.content })
      continue
    }
    const call = response.content.find((b) => b.type === 'tool_use' && b.name === tool.name)
    // with server tools in play it may end its turn in prose: ask once more for the answer tool (this model
    // doesn't take a forced tool_choice)
    if (!call && !nudged) {
      messages.push({ role: 'assistant', content: response.content }, { role: 'user', content: `Now record your answer by calling ${tool.name} — nothing else.` })
      nudged = true
      continue
    }
    if (!call) throw new AgentError(`The model did not call ${tool.name}`)
    return { input: call.input, trace: trace.map(({ id, ...t }) => t), usage, searched }
  }
  throw new AgentError('The model kept working past the turn limit')
}

/** The common case: no remote tools, just the structured answer. */
export async function callTool(p) {
  return (await callAgent(p)).input
}
