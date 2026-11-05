/*  ============================================================================
    Negotiating agents — a party can hand the contract room to an agent with a private mandate:
    the most they'll pay (or the least they'll take), the time limit, the must-haves. The agent
    speaks for them in the room, concedes in steps, and accepts only inside the mandate.
    Guardrails live in code, not in the prompt: the agent can never accept terms whose price or
    timing falls outside the mandate, never speaks more than MAX_TURNS times, and hands the
    room back to its person when the other side won't come within reach. Money still needs the
    person: an agent can agree terms, but only the client approves the PayPal hold.
    ============================================================================ */

import { callTool } from './claude.js'
import { db, audit } from '../lib/supabase.js'
import { say, loadRoom, nameOf, totalOf, lastDueOf, acceptVersion } from '../lib/room.js'
import { money } from '../lib/money.js'

const MAX_TURNS = 6

const SYSTEM = `You negotiate a software contract for one person (your principal) inside Verdikt's contract room.
A neutral mediator (Verdikt) keeps the terms sheet; the other party may be a person or another agent.
Later an AI verifier releases each PayPal-held payment only when the delivery passes the agreed "done means" lines.

How you work:
- Your mandate is private. Never state or hint at its numbers, never say you have a limit or a budget cap.
  Argue from scope, time, risk and fairness instead.
- Make concrete proposals the mediator can record: an amount in dollars, a launch in N days, moving a feature
  out of scope or to a later payment, splitting payments.
- Concede in steps. Open with room to move (a client offers below its limit, a freelancer asks above its minimum)
  but stay realistic and polite. Never go past the mandate.
- meets_mandate is true only if the current sheet satisfies every part of it: price, time and each must-have in scope.
- accept only when meets_mandate is true. If the other side has twice refused to come within the mandate, hand_back.
- wait when the newest message is your own or nobody needs you; don't repeat yourself.
- Speak in first person as the agent, warm and brief (under 60 words, no lists). In your first message say
  you're negotiating for your principal by first name.
- reason is a private note to your principal (one sentence): why you did what you did.`

const TOOL = {
  name: 'act',
  description: 'Decide your move in the room for your principal.',
  input_schema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['say', 'accept', 'hand_back', 'wait'] },
      message: { type: 'string' },
      meets_mandate: { type: 'boolean' },
      reason: { type: 'string' },
    },
    required: ['action', 'message', 'meets_mandate', 'reason'],
    additionalProperties: false,
  },
}

/** Price and timing only — the part of a mandate code can check without judgement. */
export function fitsMandate(terms, m, role) {
  const total = totalOf(terms)
  const due = lastDueOf(terms)
  const problems = []
  if (!terms?.milestones?.length) problems.push('no payments on the sheet yet')
  if (m.limit_cents) {
    if (role === 'client' && total > m.limit_cents) problems.push(`total ${money(total)} is above the limit`)
    if (role === 'freelancer' && total < m.limit_cents) problems.push(`total ${money(total)} is below the minimum`)
  }
  if (m.deadline_days && due) {
    if (role === 'client' && due > m.deadline_days) problems.push(`launch on day ${due} is later than allowed`)
    if (role === 'freelancer' && due < m.deadline_days) problems.push(`launch on day ${due} is sooner than workable`)
  }
  return { ok: !problems.length, total, due, problems }
}

const running = new Map()
export function negotiateSoon(contractId, delay = 1500) {
  if (running.has(contractId)) { running.set(contractId, true); return }
  running.set(contractId, false)
  setTimeout(async () => {
    try {
      for (;;) {
        await negotiate(contractId)
        if (!running.get(contractId)) break
        running.set(contractId, false)
      }
    } catch (e) {
      console.error('negotiator failed', e)
    } finally {
      running.delete(contractId)
    }
  }, delay)
}

async function handBack(c, m, note, publicLine) {
  await db().from('room_mandates').update({ active: false, status: 'handed_back', status_note: note, updated_at: new Date().toISOString() })
    .eq('contract_id', c.id).eq('role', m.role)
  if (publicLine) await say(c.id, m.role, publicLine, { via_agent: true })
  await audit({ contractId: c.id, actor: m.role, event: 'room.agent_handed_back', payload: { viaAgent: true } })
}

/** One pass: at most one agent speaks (or accepts), then the mediator takes its turn. */
async function negotiate(contractId) {
  const { data: mandates } = await db().from('room_mandates').select('*').eq('contract_id', contractId).eq('active', true)
  if (!mandates?.length) return
  const c = await loadRoom(contractId)
  if (!c || c.status !== 'scoping' || c.mediator_busy) return
  const { data: msgs } = await db().from('room_messages').select('author, body, via_agent, created_at').eq('contract_id', contractId)
    .order('created_at', { ascending: false }).limit(30)
  const thread = [...(msgs || [])].reverse()
  const lastParty = [...thread].reverse().find((x) => x.author === 'client' || x.author === 'freelancer')
  const terms = c.terms || { version: 0, milestones: [] }

  // the side that was just spoken to goes first
  const order = [...mandates.filter((x) => x.role !== lastParty?.author), ...mandates.filter((x) => x.role === lastParty?.author)]
  for (const m of order) {
    const role = m.role
    const other = role === 'client' ? 'freelancer' : 'client'
    const mineV = role === 'client' ? c.terms_client_v : c.terms_freelancer_v
    const fit = fitsMandate(terms, m, role)
    // its turn: the other side spoke last, the terms now fit and it hasn't accepted, or it was just handed the room
    const myTurn = !lastParty || lastParty.author !== role || (fit.ok && mineV !== terms.version) || m.turns === 0
    // the sheet suits it and it already accepted: stay quiet unless the other side just said something
    if (!myTurn || (fit.ok && mineV === terms.version && lastParty?.author === role)) continue
    if (!(role === 'client' ? c.client_id : c.freelancer_id)) continue
    const name = nameOf(c, role).split(' ')[0]
    if (m.turns >= MAX_TURNS) {
      await handBack(c, m, `Reached ${MAX_TURNS} turns without terms that fit your mandate (${fit.problems.join('; ') || 'must-haves not met'}).`, `${name} will take it from here personally.`)
      return
    }

    const names = { client: nameOf(c, 'client'), freelancer: nameOf(c, 'freelancer'), agent: 'Verdikt (mediator)', system: 'Room' }
    const out = await callTool({
      system: SYSTEM,
      effort: 'medium',
      tool: TOOL,
      content: [{
        type: 'text',
        text: [
          `You negotiate for ${names[role]} (the ${role}). The other party is ${names[other] || `the ${other}`}.`,
          `Project: ${c.title}`,
          '',
          'Your private mandate:',
          m.limit_cents ? `- ${role === 'client' ? 'Pay at most' : 'Accept no less than'} ${money(m.limit_cents)} in total` : '- No price limit',
          m.deadline_days ? `- ${role === 'client' ? 'Launch no later than' : 'Launch no sooner than'} day ${m.deadline_days}` : '- No time limit',
          m.must_haves?.length ? `- Must ${role === 'client' ? 'be in scope' : 'stay out of scope'}: ${m.must_haves.join('; ')}` : '- No must-haves',
          m.notes ? `- Notes from ${names[role]}: ${m.notes}` : '',
          `- You may accept on your own: ${m.auto_accept ? 'yes' : `no — when the terms fit, hand back so ${name} accepts`}`,
          '',
          `Current terms sheet (version ${terms.version}), total ${money(fit.total)}, last payment on day ${fit.due || '—'}:`,
          JSON.stringify({ ...terms, version: undefined, questions: undefined }, null, 1),
          `Price/time check against your mandate: ${fit.ok ? 'fits' : fit.problems.join('; ')}.`,
          `Accepted this version so far: ${names.client}: ${c.terms_client_v === terms.version ? 'yes' : 'no'} · ${names.freelancer}: ${c.terms_freelancer_v === terms.version ? 'yes' : 'no'}`,
          `You have spoken ${m.turns} of ${MAX_TURNS} times.`,
          '',
          'Conversation, oldest first:',
          ...thread.map((x) => `${x.author === 'client' || x.author === 'freelancer' ? `${names[x.author]}${x.via_agent ? "'s agent" : ''}${x.author === role ? ' (your side)' : ''}` : names[x.author]}: ${x.body}`),
          '',
          'Call act.',
        ].filter((l) => l !== '').join('\n'),
      }],
    })

    let action = out.action
    // guardrails: never accept outside price/time, never accept what the model itself says doesn't meet the mandate
    if (action === 'accept' && (!fit.ok || !out.meets_mandate)) action = out.message.trim() ? 'say' : 'wait'
    if (action === 'accept' && !m.auto_accept) {
      await handBack(c, m, `Version ${terms.version} fits your mandate — accept it yourself to lock the terms.`, out.message.trim() || `These terms work. ${name} will confirm personally.`)
      return
    }
    if (action === 'accept') {
      if (out.message.trim()) await say(c.id, role, out.message.trim().slice(0, 600), { via_agent: true })
      await db().from('room_mandates').update({ turns: m.turns + 1, status_note: out.reason.slice(0, 300), updated_at: new Date().toISOString() }).eq('contract_id', c.id).eq('role', role)
      const { locked } = await acceptVersion(c, role, terms.version, { viaAgent: true })
      if (!locked) negotiateSoon(c.id)   // the other side's agent may accept the same version now
      return
    }
    if (action === 'hand_back') {
      await handBack(c, m, out.reason.slice(0, 300), out.message.trim() || `${name} will take it from here personally.`)
      return
    }
    if (action === 'say' && out.message.trim()) {
      await say(c.id, role, out.message.trim().slice(0, 600), { via_agent: true })
      await db().from('room_mandates').update({ turns: m.turns + 1, status_note: out.reason.slice(0, 300), updated_at: new Date().toISOString() }).eq('contract_id', c.id).eq('role', role)
      await audit({ contractId: c.id, actor: role, event: 'room.agent_spoke', payload: { viaAgent: true } })
      const { mediateSoon } = await import('./mediator.js')
      mediateSoon(c.id)
      return
    }
  }
}

/** After a restart (or a free-plan wake-up): pick up rooms whose mediator or agents were mid-turn. */
export async function resumeRooms() {
  const { data: rooms } = await db().from('contracts').select('id, mediator_busy').eq('status', 'scoping')
  if (!rooms?.length) return
  const { data: active } = await db().from('room_mandates').select('contract_id').eq('active', true).in('contract_id', rooms.map((r) => r.id))
  const { mediateSoon } = await import('./mediator.js')
  for (const r of rooms) if (r.mediator_busy) mediateSoon(r.id)
  for (const id of new Set((active || []).map((m) => m.contract_id))) {
    if (!rooms.find((r) => r.id === id)?.mediator_busy) negotiateSoon(id, 3000)
  }
}
