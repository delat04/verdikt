/*  ============================================================================
    The mediator — the AI in the contract room. After people speak, it rereads the conversation
    and keeps a versioned terms sheet current with what they actually agreed, then says (briefly)
    only what helps them agree: testable wording for vague wishes, a concrete trade when they
    disagree on money or time, the question that blocks them and who should answer it.
    It never invents scope, prices or dates; those arrive as suggestions a party can accept.
    ============================================================================ */

import { callTool } from './claude.js'
import { db, audit } from '../lib/supabase.js'

const SYSTEM = `You are Verdikt's mediator in a contract room where a client and a freelancer agree the terms of a software
project before any money is held in PayPal escrow. Later an AI verifier will check the delivered work against these
terms using only screenshots of the live site at 1440px and 375px, the page text, console and network logs, a scripted
form submission and the public GitHub repository. So every "done means" line must be checkable that way.

Your job, every turn:
- Keep the terms sheet current with what the parties have actually said and agreed. Never invent requirements,
  prices or dates nobody stated; propose them as suggestions instead. When one side proposes and the other hasn't
  answered, record the proposal and list the open question.
- Turn vague wishes ("modern", "fast", "clean", "user-friendly") into testable wording, offered as suggestions.
- When they disagree on money or time, don't split the difference blindly: propose a concrete trade (move part of the
  scope to a later milestone, fewer pages, a later date, a smaller first milestone) and say why it is fair.
- Ask the one or two questions that most block agreement, and say who should answer.
- Be neutral, warm and brief: at most 70 words, plain language, first names, no lists in the reply. If neither party
  needs you right now, leave the reply empty and only update the terms.
- Suggestions are messages a party could send to agree with something specific (written in first person, under 160
  characters), each with a short label (under 40 characters). 0 to 3 of them.

Terms rules: 1 to 4 milestones, the last is the final payment. Titles name the deliverable only (no "final
payment", no amounts or dates in titles). Amounts in US cents. due_days counts from today.
Each milestone has 2 to 5 "done means" lines, each one sentence and testable. Keep the summary to two sentences.
Out of scope lists what was explicitly excluded or deferred. "changes" names what you changed this turn in a few
words each (e.g. "M2 price: $1,500 → $1,800"); leave it empty if nothing changed.`

const TOOL = {
  name: 'update_room',
  description: 'Record the updated terms sheet, what changed, and the mediator\'s reply (empty when nothing needs saying).',
  input_schema: {
    type: 'object',
    properties: {
      reply: { type: 'string' },
      suggestions: {
        type: 'array',
        items: {
          type: 'object',
          properties: { label: { type: 'string' }, text: { type: 'string' }, for: { type: 'string', enum: ['client', 'freelancer', 'both'] } },
          required: ['label', 'text', 'for'],
          additionalProperties: false,
        },
      },
      changes: { type: 'array', items: { type: 'string' } },
      terms: {
        type: 'object',
        properties: {
          summary: { type: 'string' },
          scope: { type: 'array', items: { type: 'string' } },
          out_of_scope: { type: 'array', items: { type: 'string' } },
          milestones: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string' },
                amount_cents: { type: 'integer' },
                due_days: { type: 'integer' },
                done_means: { type: 'array', items: { type: 'string' } },
              },
              required: ['title', 'amount_cents', 'due_days', 'done_means'],
              additionalProperties: false,
            },
          },
          questions: {
            type: 'array',
            items: {
              type: 'object',
              properties: { text: { type: 'string' }, for: { type: 'string', enum: ['client', 'freelancer', 'both'] } },
              required: ['text', 'for'],
              additionalProperties: false,
            },
          },
        },
        required: ['summary', 'scope', 'out_of_scope', 'milestones', 'questions'],
        additionalProperties: false,
      },
    },
    required: ['reply', 'suggestions', 'changes', 'terms'],
    additionalProperties: false,
  },
}

export const emptyTerms = () => ({ version: 0, summary: '', scope: [], out_of_scope: [], milestones: [], questions: [] })

const comparable = (t) => JSON.stringify({ ...t, version: undefined, questions: undefined })

// one run per room at a time; a message that arrives mid-run asks for one more pass
const running = new Map()

export function mediateSoon(contractId) {
  const r = running.get(contractId)
  if (r) { r.again = true; return }
  running.set(contractId, { again: false })
  setTimeout(() => loop(contractId), 1200) // let a quick follow-up message land first
}

async function loop(contractId) {
  try {
    for (;;) {
      await mediate(contractId)
      const r = running.get(contractId)
      if (!r?.again) break
      r.again = false
    }
  } catch (e) {
    console.error('mediator failed', e)
    await db().from('room_messages').insert({ contract_id: contractId, author: 'system', body: 'The mediator could not answer just now. Keep talking — it will catch up on your next message.' })
  } finally {
    running.delete(contractId)
    await db().from('contracts').update({ mediator_busy: false }).eq('id', contractId)
  }
}

async function mediate(contractId) {
  await db().from('contracts').update({ mediator_busy: true }).eq('id', contractId)
  const { data: c } = await db().from('contracts')
    .select('id, title, brief, currency, terms, client:profiles!contracts_client_id_fkey(display_name), freelancer:profiles!contracts_freelancer_id_fkey(display_name)')
    .eq('id', contractId).single()
  const { data: msgs } = await db().from('room_messages').select('author, body, created_at').eq('contract_id', contractId)
    .order('created_at', { ascending: false }).limit(40)
  const names = { client: c.client?.display_name || 'the client', freelancer: c.freelancer?.display_name || 'the freelancer (not joined yet)', agent: 'Verdikt', system: 'Room' }
  const terms = c.terms || emptyTerms()

  const content = [{
    type: 'text',
    text: [
      `Project: ${c.title}`,
      `Opening note: ${c.brief || '—'}`,
      `Client: ${names.client} · Freelancer: ${names.freelancer} · Today: ${new Date().toISOString().slice(0, 10)}`,
      '',
      `Current terms sheet (version ${terms.version}):`,
      JSON.stringify({ ...terms, version: undefined }, null, 1),
      '',
      'Conversation, oldest first (the last line is the newest):',
      ...[...(msgs || [])].reverse().map((m) => `${names[m.author]}${['client', 'freelancer'].includes(m.author) ? ` (${m.author})` : ''}: ${m.body}`),
      '',
      'Call update_room.',
    ].join('\n'),
  }]

  const out = await callTool({ system: SYSTEM, content, tool: TOOL, effort: 'medium' })
  const next = { ...out.terms, version: terms.version }
  const changed = comparable(next) !== comparable(terms)
  if (changed) next.version = terms.version + 1
  // questions refresh every turn without bumping the version (they don't change what anyone accepts)
  await db().from('contracts').update({ terms: next }).eq('id', contractId)

  const reply = out.reply.trim()
  if (reply || (changed && out.changes.length)) {
    await db().from('room_messages').insert({
      contract_id: contractId, author: 'agent', body: reply,
      suggestions: out.suggestions.slice(0, 3), changes: changed ? out.changes.slice(0, 6) : [], version: next.version,
    })
  }
  if (changed) await audit({ contractId, actor: 'agent', event: 'room.terms_updated', payload: { version: next.version, changes: out.changes.slice(0, 3) } })
}
