/*  ============================================================================
    The contract room — client and freelancer shape the terms together; the mediator keeps the
    terms sheet current. open → talk → both accept the same version → lock: milestones are created
    from the sheet and the checks are drafted (then the usual sign → fund → deliver flow).
    Either side can hand the room to a negotiating agent with a private mandate.
    ============================================================================ */

import { db, audit } from '../lib/supabase.js'
import { requireUser } from '../lib/auth.js'
import { mediateSoon, emptyTerms } from '../agent/mediator.js'
import { negotiateSoon } from '../agent/negotiator.js'
import { say, loadRoom, roleOf, nameOf, acceptVersion, RoomError } from '../lib/room.js'

async function roomFor(request, reply) {
  const c = await loadRoom(request.params.id)
  if (!c) { reply.code(404).send({ error: 'Contract not found' }); return null }
  const role = roleOf(c, request.user.id)
  if (!role) { reply.code(403).send({ error: 'You are not in this room' }); return null }
  if (c.status !== 'scoping') { reply.code(409).send({ error: 'The terms are already locked' }); return null }
  return { c, role, name: nameOf(c, role) }
}

/** Open a room: a title and a sentence or two; the mediator drafts from there. Also used over MCP. */
export async function openRoom(userId, { title = '', idea = '', role = 'client', counterpartEmail = '', currency = 'USD' }, { viaAgent = false } = {}) {
  if (title.trim().length < 4) throw new RoomError(400, 'Give the project a title')
  if (idea.trim().length < 15) throw new RoomError(400, 'Say in a sentence or two what this is about')
  if (!['client', 'freelancer'].includes(role)) throw new RoomError(400, 'Invalid role')
  const { data: c, error } = await db().from('contracts').insert({
    title: title.trim(), brief: idea.trim(), currency, created_by: userId, status: 'scoping', terms: emptyTerms(),
    invite_email: counterpartEmail.trim() || null,
    client_id: role === 'client' ? userId : null,
    freelancer_id: role === 'freelancer' ? userId : null,
  }).select().single()
  if (error) throw error
  const { data: p } = await db().from('profiles').select('display_name').eq('id', userId).single()
  await say(c.id, role, idea.trim(), { via_agent: viaAgent })
  await audit({ contractId: c.id, actor: role, event: 'room.opened', payload: { name: p?.display_name, viaAgent } })
  mediateSoon(c.id)
  return { id: c.id, inviteCode: c.invite_code }
}

/** Hand the room to an agent with a private mandate (or update it). */
export async function setMandate(c, role, userId, { limitCents, deadlineDays, mustHaves = [], notes = '', autoAccept = true }) {
  const limit = limitCents == null || limitCents === '' ? null : Number(limitCents)
  const days = deadlineDays == null || deadlineDays === '' ? null : Number(deadlineDays)
  if (limit != null && (!Number.isInteger(limit) || limit < 100)) throw new RoomError(400, 'The price limit needs to be at least $1.00')
  if (days != null && (!Number.isInteger(days) || days < 1 || days > 365)) throw new RoomError(400, 'The time limit is a number of days, 1 to 365')
  if (limit == null && days == null && !mustHaves.length) throw new RoomError(400, 'Give your agent at least one limit or must-have')
  const { data: existing } = await db().from('room_mandates').select('active').eq('contract_id', c.id).eq('role', role).maybeSingle()
  await db().from('room_mandates').upsert({
    contract_id: c.id, role, user_id: userId, limit_cents: limit, deadline_days: days,
    must_haves: mustHaves.map((s) => String(s).trim()).filter(Boolean).slice(0, 8), notes: String(notes).slice(0, 500),
    auto_accept: !!autoAccept, active: true, status: 'negotiating', status_note: '', turns: 0, updated_at: new Date().toISOString(),
  })
  if (!existing?.active) await say(c.id, 'system', `${nameOf(c, role)} handed the negotiation to an agent. It speaks for them within limits only they can see.`)
  await audit({ contractId: c.id, actor: role, event: 'room.agent_on', payload: {} })
  negotiateSoon(c.id, 600)
}

export default async function roomRoutes(app) {
  app.addHook('preHandler', requireUser)

  app.post('/rooms', async (request) => openRoom(request.user.id, request.body || {}, { viaAgent: !!request.user.viaToken }))

  // ---- talk
  app.post('/contracts/:id/room/messages', async (request, reply) => {
    const room = await roomFor(request, reply)
    if (!room) return
    const body = String(request.body?.body || '').trim()
    if (!body) return reply.code(400).send({ error: 'Write something first' })
    await say(room.c.id, room.role, body.slice(0, 2000), { via_agent: !!request.user.viaToken })
    mediateSoon(room.c.id)
    return { ok: true }
  })

  // ---- ask the mediator to look again now
  app.post('/contracts/:id/room/ask', async (request, reply) => {
    const room = await roomFor(request, reply)
    if (!room) return
    mediateSoon(room.c.id)
    return { ok: true }
  })

  // ---- accept a version of the terms; when both accept the same one, they lock
  app.post('/contracts/:id/room/accept', async (request, reply) => {
    const room = await roomFor(request, reply)
    if (!room) return
    const res = await acceptVersion(room.c, room.role, Number(request.body?.version), { viaAgent: !!request.user.viaToken })
    return { ok: true, ...res }
  })

  // ---- negotiating agent: hand over with a private mandate, or take the room back
  app.post('/contracts/:id/room/mandate', async (request, reply) => {
    const room = await roomFor(request, reply)
    if (!room) return
    await setMandate(room.c, room.role, request.user.id, request.body || {})
    return { ok: true }
  })
  app.post('/contracts/:id/room/mandate/stop', async (request, reply) => {
    const room = await roomFor(request, reply)
    if (!room) return
    await db().from('room_mandates').update({ active: false, status: 'paused', updated_at: new Date().toISOString() }).eq('contract_id', room.c.id).eq('role', room.role)
    await say(room.c.id, 'system', `${room.name} is back in the room in person.`)
    await audit({ contractId: room.c.id, actor: room.role, event: 'room.agent_off', payload: {} })
    return { ok: true }
  })
}
