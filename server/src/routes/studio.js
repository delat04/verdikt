/*  ============================================================================
    Studio — Claude as the AI assistant inside AG Studio, the money & proof dashboard.
      POST /studio/turn   one turn of AG Studio's agent loop: its conversation, instructions and tool
                          schemas in; Claude's reply streamed back as AG-UI events, one JSON object per
                          line ({ e } per event, then { done } with the whole response, or { error }).
      POST /studio/demo-turn  the same for the in-browser demo (sample data, no account), only when
                          STUDIO_DEMO_TURNS_PER_DAY is set: a daily budget across everyone, and a per-visitor
                          budget per hour. Without it the demo's assistant says it has no Claude behind it.
    AG Studio runs the loop and executes every tool itself, in the browser, against the dashboard.
    Claude only sees what the browser sends: the conversation and what its tools returned.
    ============================================================================ */

import { PassThrough } from 'node:stream'
import { requireUser } from '../lib/auth.js'
import { anthropic, MODEL } from '../agent/claude.js'

const PREAMBLE = `You are Claude, the assistant inside Verdikt's money & proof dashboard, built on AG Studio.
Verdikt holds freelance payments in PayPal escrow per milestone and releases them when an AI verifier
confirms the agreed checks pass. The person you help is a client (money out) or a freelancer (money in).
The data sources are their own milestones, the verification checks run on each delivery, and every money
movement PayPal made. Money is in US dollars. Read numbers through your tools; never invent them.
Write in plain, short sentences, and use the person's own words for contracts and people.`

const EFFORTS = new Set(['low', 'medium', 'high'])
const JSON_TOOL = 'final_answer'

// a run is many turns (the lead agent plans, delegates and edits widgets): a generous budget per hour
const recent = new Map()
function allow(key, perHour) {
  const now = Date.now()
  const list = (recent.get(key) || []).filter((t) => now - t < 3600e3)
  if (list.length >= perHour) return false
  list.push(now)
  recent.set(key, list)
  return true
}

const safeId = (id) => String(id || 'call').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64)
const parseArgs = (s) => {
  try {
    const v = JSON.parse(s || '{}')
    return v && typeof v === 'object' && !Array.isArray(v) ? v : { value: v }
  } catch {
    return {}
  }
}

/** AG Studio's conversation items → Claude messages (alternating roles, tool results first in a turn). */
export function toMessages(items = []) {
  const messages = []
  const push = (role, block) => {
    const last = messages.at(-1)
    if (last?.role === role) last.content.push(block)
    else messages.push({ role, content: [block] })
  }
  for (const it of items) {
    if (it?.type === 'message' && it.kind === 'input') {
      const text = (it.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n').trim()
      if (text) push('user', { type: 'text', text: it.role === 'system' ? `<studio-context>\n${text}\n</studio-context>` : text })
    } else if (it?.type === 'message' && it.kind === 'output') {
      const text = (it.content || []).map((c) => (c.type === 'text' ? c.text : c.refusal || '')).join('').trim()
      if (text) push('assistant', { type: 'text', text })
    } else if (it?.type === 'function_call') {
      push('assistant', { type: 'tool_use', id: safeId(it.callId), name: it.name, input: parseArgs(it.arguments) })
    } else if (it?.type === 'function_call_output') {
      push('user', { type: 'tool_result', tool_use_id: safeId(it.callId), content: String(it.output ?? '') })
    }
    // reasoning items are not replayed: Claude's thinking is off for these turns
  }
  for (const m of messages) {
    if (m.role === 'user') m.content.sort((a, b) => (a.type === 'tool_result' ? 0 : 1) - (b.type === 'tool_result' ? 0 : 1))
  }
  if (messages[0]?.role !== 'user') messages.unshift({ role: 'user', content: [{ type: 'text', text: 'Continue.' }] })
  return messages
}

const objectSchema = (s) => (s && s.type === 'object' ? s : { type: 'object', properties: s?.properties || {}, ...(s?.required ? { required: s.required } : {}) })

// Opus 5.5 takes no forced tool_choice ("any" / "tool"): a forced choice becomes an instruction instead
function toolChoiceOf(choice, json) {
  if (json) return { choice: { type: 'auto' }, rule: `Answer only by calling ${JSON_TOOL}; write nothing else.` }
  if (choice === 'none') return { choice: { type: 'none' } }
  if (choice === 'required') return { choice: { type: 'auto' }, rule: 'Call one of your tools in this turn.' }
  if (choice && typeof choice === 'object' && choice.name) return { choice: { type: 'auto' }, rule: `Call the ${choice.name} tool in this turn.` }
  return { choice: { type: 'auto' } }
}

const LIMITS = { bodyLimit: 4 * 1024 * 1024 }
const DEMO_PER_DAY = Math.max(0, Number(process.env.STUDIO_DEMO_TURNS_PER_DAY || 0))
const demoDay = { date: '', used: 0 }

export default async function studioRoutes(app) {
  app.addHook('preHandler', requireUser)

  app.post('/studio/turn', LIMITS, async (request, reply) => {
    if (!allow(`studio:${request.user.id}`, 240)) return reply.code(429).send({ error: 'That’s a lot of dashboard work this hour — try again later' })
    return turn(request, reply, { maxTokens: 16000 })
  })
}

export async function studioDemoRoutes(app) {
  app.post('/studio/demo-turn', LIMITS, async (request, reply) => {
    if (!DEMO_PER_DAY) return reply.code(403).send({ error: 'Claude isn’t switched on for the demo' })
    const today = new Date().toISOString().slice(0, 10)
    if (demoDay.date !== today) Object.assign(demoDay, { date: today, used: 0 })
    if (demoDay.used >= DEMO_PER_DAY) return reply.code(429).send({ error: 'The demo’s Claude budget for today is spent — sign in to keep going' })
    if (!allow(`studio-demo:${request.ip}`, 60)) return reply.code(429).send({ error: 'That’s a lot of dashboard work this hour — try again later' })
    demoDay.used += 1
    return turn(request, reply, { maxTokens: 8000 })
  })
}

async function turn(request, reply, { maxTokens }) {
  const body = request.body || {}
  if (!Array.isArray(body.input)) return reply.code(400).send({ error: 'Send the conversation as input' })

  const json = body.responseFormat?.type === 'json'
  const wrapped = json && body.responseFormat.schema?.type !== 'object'
  const tools = (Array.isArray(body.tools) ? body.tools : [])
    .filter((t) => t?.name && (t.kind || 'client') === 'client')
    .slice(0, 64)
    .map((t) => ({ name: t.name, description: String(t.description || '').slice(0, 4000), input_schema: objectSchema(t.parameters) }))
  if (json) {
    const schema = body.responseFormat.schema || {}
    tools.push({
      name: JSON_TOOL,
      description: body.responseFormat.description || `Give your answer as ${body.responseFormat.name || 'structured data'}.`,
      input_schema: wrapped ? { type: 'object', properties: { value: schema }, required: ['value'] } : schema,
    })
  }
  if (tools.length) tools[tools.length - 1].cache_control = { type: 'ephemeral' }

  const messages = toMessages(body.input)
  const last = messages.at(-1)?.content.at(-1)
  if (last) last.cache_control = { type: 'ephemeral' }

  const effort = EFFORTS.has(body.model?.effort) ? body.model.effort : 'medium'
  const { choice, rule } = toolChoiceOf(body.toolChoice, json)
  const params = {
    model: MODEL,
    max_tokens: maxTokens,
    output_config: { effort },
    system: [
      { type: 'text', text: PREAMBLE },
      ...(body.instructions ? [{ type: 'text', text: String(body.instructions), cache_control: { type: 'ephemeral' } }] : []),
      // after the cached prefix, so a turn-specific rule doesn't invalidate it
      ...(rule && tools.length ? [{ type: 'text', text: rule }] : []),
    ],
    messages,
    ...(tools.length ? { tools, tool_choice: choice } : {}),
  }

  const out = new PassThrough()
  const send = (o) => out.write(`${JSON.stringify(o)}\n`)
  const aborter = new AbortController()
  // the browser went away mid-turn (cancelled, or the page closed): stop Claude too
  reply.raw.on('close', () => { if (!reply.raw.writableFinished) aborter.abort() })

  ;(async () => {
    const blocks = new Map()   // content index → { kind, id }
    try {
      const stream = anthropic().messages.stream(params, { signal: aborter.signal })
      let msgId = 'msg'
      for await (const ev of stream) {
        if (ev.type === 'message_start') msgId = ev.message.id
        else if (ev.type === 'content_block_start') {
          const b = ev.content_block
          if (b.type === 'text') {
            const id = `${msgId}_${ev.index}`
            blocks.set(ev.index, { kind: 'text', id })
            send({ e: { type: 'TEXT_MESSAGE_START', messageId: id, role: 'assistant' } })
          } else if (b.type === 'tool_use' && b.name !== JSON_TOOL) {
            blocks.set(ev.index, { kind: 'tool', id: b.id })
            send({ e: { type: 'TOOL_CALL_START', toolCallId: b.id, toolCallName: b.name } })
          }
        } else if (ev.type === 'content_block_delta') {
          const b = blocks.get(ev.index)
          if (b?.kind === 'text' && ev.delta.type === 'text_delta') send({ e: { type: 'TEXT_MESSAGE_CONTENT', messageId: b.id, delta: ev.delta.text } })
          if (b?.kind === 'tool' && ev.delta.type === 'input_json_delta' && ev.delta.partial_json) send({ e: { type: 'TOOL_CALL_ARGS', toolCallId: b.id, delta: ev.delta.partial_json } })
        } else if (ev.type === 'content_block_stop') {
          const b = blocks.get(ev.index)
          if (b?.kind === 'text') send({ e: { type: 'TEXT_MESSAGE_END', messageId: b.id } })
          if (b?.kind === 'tool') send({ e: { type: 'TOOL_CALL_END', toolCallId: b.id } })
        }
      }
      const msg = await stream.finalMessage()

      const output = []
      for (const [i, b] of msg.content.entries()) {
        if (b.type === 'text' && b.text) {
          output.push({ id: `${msg.id}_${i}`, kind: 'output', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'text', text: b.text, annotations: [] }] })
        } else if (b.type === 'tool_use' && b.name === JSON_TOOL) {
          // a structured answer arrives as a forced tool call: hand it to Studio as the message text
          const text = JSON.stringify(wrapped ? b.input?.value : b.input)
          const id = `${msg.id}_${i}`
          send({ e: { type: 'TEXT_MESSAGE_START', messageId: id, role: 'assistant' } })
          send({ e: { type: 'TEXT_MESSAGE_CONTENT', messageId: id, delta: text } })
          send({ e: { type: 'TEXT_MESSAGE_END', messageId: id } })
          output.push({ id, kind: 'output', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'text', text, annotations: [] }] })
        } else if (b.type === 'tool_use') {
          output.push({ id: b.id, kind: 'output', type: 'function_call', callId: b.id, name: b.name, arguments: JSON.stringify(b.input ?? {}), status: 'completed' })
        }
      }
      if (msg.stop_reason === 'refusal') {
        output.push({ id: `${msg.id}_refusal`, kind: 'output', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'refusal', refusal: 'Claude declined this request.' }] })
      }
      const u = msg.usage || {}
      const input = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0)
      send({
        done: {
          id: msg.id,
          createdAt: Date.now(),
          model: msg.model,
          status: msg.stop_reason === 'max_tokens' ? 'incomplete' : 'completed',
          ...(msg.stop_reason === 'max_tokens' ? { incompleteDetails: { reason: 'max_output_tokens' } } : {}),
          output,
          usage: {
            inputTokens: input,
            outputTokens: u.output_tokens || 0,
            totalTokens: input + (u.output_tokens || 0),
            cachedInputTokens: u.cache_read_input_tokens || 0,
            cacheWriteTokens: u.cache_creation_input_tokens || 0,
          },
        },
      })
    } catch (e) {
      if (!aborter.signal.aborted) {
        request.log.warn({ err: e.message }, 'studio turn failed')
        send({ error: e.status === 429 ? 'Claude is busy — try again in a moment' : `Claude couldn’t answer: ${e.message}` })
      }
    } finally {
      out.end()
    }
  })()

  reply.header('Cache-Control', 'no-cache, no-transform').header('X-Accel-Buffering', 'no')
  return reply.type('application/x-ndjson; charset=utf-8').send(out)
}
