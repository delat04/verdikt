/*  ============================================================================
    One structured call to Claude: the model answers by calling a single strict tool,
    so the result is always schema-valid JSON we can store and show.
    Optionally the model may first use tools on a remote MCP server (PayPal's) — Anthropic runs those
    calls server-side; we only read the trace of what it looked up.
    ============================================================================ */

import Anthropic from '@anthropic-ai/sdk'

export const MODEL = process.env.VERDIKT_MODEL || 'claude-opus-5-5'

let client = null
const anthropic = () => (client ??= new Anthropic())

export class AgentError extends Error {}

/**
 * @param {object} p
 * @param {string} p.system      — stable instructions (kept first so the prefix caches)
 * @param {Array}  p.content     — user content blocks (text, images)
 * @param {object} p.tool        — { name, description, input_schema } (strict is added here)
 * @param {string} [p.effort]    — low | medium | high | xhigh | max
 * @param {Array}  [p.mcpServers] — [{ type: 'url', url, name, authorization_token }]
 * @param {Array}  [p.toolsets]   — [{ type: 'mcp_toolset', mcp_server_name, default_config, configs }]
 * @returns {Promise<{ input: object, trace: Array<{ tool: string, input: object, ok: boolean }> }>}
 */
export async function callAgent({ system, content, tool, effort = 'high', mcpServers, toolsets = [] }) {
  const messages = [{ role: 'user', content }]
  const trace = []
  // a long run of server-side tool calls can pause the turn; send it back as-is to let it continue
  for (let turn = 0; turn < 4; turn += 1) {
    const response = await anthropic().beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      // On a policy decline, re-run on Anthropic's recommended fallback model instead of failing
      betas: ['server-side-fallback-2026-07-01', ...(mcpServers?.length ? ['mcp-client-2025-11-20'] : [])],
      fallbacks: 'default',
      output_config: { effort },
      system,
      ...(mcpServers?.length ? { mcp_servers: mcpServers } : {}),
      tools: [{ ...tool, strict: true }, ...toolsets],
      tool_choice: { type: 'auto' },
      messages,
    })

    for (const b of response.content) {
      if (b.type === 'mcp_tool_use') trace.push({ id: b.id, tool: b.name, input: b.input, ok: true })
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
    if (!call) throw new AgentError(`The model did not call ${tool.name}`)
    return { input: call.input, trace: trace.map(({ id, ...t }) => t) }
  }
  throw new AgentError('The model kept working past the turn limit')
}

/** The common case: no remote tools, just the structured answer. */
export async function callTool(p) {
  return (await callAgent(p)).input
}
