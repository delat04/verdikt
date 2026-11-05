/*  ============================================================================
    The contract room — client and freelancer shape the terms together; the mediator keeps the
    terms sheet current. open → talk → both accept the same version → lock: milestones are created
    from the sheet and the checks are drafted (then the usual sign → fund → deliver flow).
    ============================================================================ */

import { db, audit } from '../lib/supabase.js'
import { requireUser } from '../lib/auth.js'
import { mediateSoon, emptyTerms } from '../agent/mediator.js'
import { draftInBackground } from './contracts.js'

const say = (contractId, author, body, extra = {}) => db().from('room_messages').insert({ contract_id: contractId, author, body, ...extra })

async function roomFor(request, reply) {
  const { data: c } = await db().from('contracts')
    .select('*, client:profiles!contracts_client_id_fkey(display_name), freelancer:profiles!contracts_freelancer_id_fkey(display_name)')
    .eq('id', request.params.id).maybeSingle()
  if (!c) { reply.code(404).send({ error: 'Contract not found' }); return null }
  const me = request.user.id
  const role = c.client_id === me ? 'client' : c.freelancer_id === me ? 'freelancer' : null
  if (!role) { reply.code(403).send({ error: 'You are not in this room' }); return null }
  if (c.status !== 'scoping') { reply.code(409).send({ error: 'The terms are already locked' }); return null }
  return { c, role, name: (role === 'client' ? c.client : c.freelancer)?.display_name || role }
}

export default async function roomRoutes(app) {
  app.addHook('preHandler', requireUser)

  // ---- open a room: a title and a sentence or two; the mediator drafts from there
  app.post('/rooms', async (request, reply) => {
    const { title = '', idea = '', role = 'client', counterpartEmail = '', currency = 'USD' } = request.body || {}
    if (title.trim().length < 4) return reply.code(400).send({ error: 'Give the project a title' })
    if (idea.trim().length < 15) return reply.code(400).send({ error: 'Say in a sentence or two what this is about' })
    if (!['client', 'freelancer'].includes(role)) return reply.code(400).send({ error: 'Invalid role' })
    const me = request.user.id
    const { data: c, error } = await db().from('contracts').insert({
      title: title.trim(), brief: idea.trim(), currency, created_by: me, status: 'scoping', terms: emptyTerms(),
      invite_email: counterpartEmail.trim() || null,
      client_id: role === 'client' ? me : null,
      freelancer_id: role === 'freelancer' ? me : null,
    }).select().single()
    if (error) throw error
    const { data: p } = await db().from('profiles').select('display_name').eq('id', me).single()
    await say(c.id, role, idea.trim())
    await audit({ contractId: c.id, actor: role, event: 'room.opened', payload: { name: p?.display_name } })
    mediateSoon(c.id)
    return { id: c.id, inviteCode: c.invite_code }
  })

  // ---- talk
  app.post('/contracts/:id/room/messages', async (request, reply) => {
    const room = await roomFor(request, reply)
    if (!room) return
    const body = String(request.body?.body || '').trim()
    if (!body) return reply.code(400).send({ error: 'Write something first' })
    await say(room.c.id, room.role, body.slice(0, 2000))
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
    const { c, role, name } = room
    const terms = c.terms || emptyTerms()
    const version = Number(request.body?.version)
    if (version !== terms.version) return reply.code(409).send({ error: 'The terms changed while you were reading — check the latest version' })
    if (!c.client_id || !c.freelancer_id) return reply.code(409).send({ error: 'Both of you need to be in the room first' })
    const ms = terms.milestones || []
    if (!ms.length || ms.length > 6 || ms.some((m) => !m.title?.trim() || !Number.isInteger(m.amount_cents) || m.amount_cents < 100)) {
      return reply.code(409).send({ error: 'The terms need 1–6 milestones, each with a title and at least $1.00' })
    }
    const field = role === 'client' ? 'terms_client_v' : 'terms_freelancer_v'
    await db().from('contracts').update({ [field]: version }).eq('id', c.id)
    await say(c.id, 'system', `${name} accepted version ${version}.`, { version })
    await audit({ contractId: c.id, actor: role, event: 'room.accepted', payload: { version } })

    const otherAccepted = (role === 'client' ? c.terms_freelancer_v : c.terms_client_v) === version
    if (!otherAccepted) return { ok: true, locked: false }

    // ---- lock: the sheet becomes milestones and a brief; the checks are drafted from them
    const brief = [
      terms.summary,
      terms.scope?.length ? `In scope: ${terms.scope.join('; ')}.` : '',
      terms.out_of_scope?.length ? `Out of scope: ${terms.out_of_scope.join('; ')}.` : '',
    ].filter(Boolean).join(' ')
    const { data: rows, error } = await db().from('milestones').insert(ms.map((m, i) => ({
      contract_id: c.id, position: i + 1, title: m.title.trim(),
      description: (m.done_means || []).map((d) => d.replace(/\.?$/, '.')).join(' '), amount_cents: m.amount_cents,
      due_at: m.due_days > 0 ? new Date(Date.now() + m.due_days * 864e5).toISOString() : null, status: 'draft',
    }))).select()
    if (error) throw error
    await db().from('contracts').update({ status: 'drafting', brief: brief || c.brief }).eq('id', c.id)
    await say(c.id, 'system', `Both of you accepted version ${version}. The terms are locked — the agent is turning each milestone into checks you'll sign.`, { version })
    await audit({ contractId: c.id, actor: 'system', event: 'room.locked', payload: { version, milestones: rows.length } })
    draftInBackground({ ...c, brief: brief || c.brief }, rows.sort((a, b) => a.position - b.position))
    return { ok: true, locked: true }
  })
}
