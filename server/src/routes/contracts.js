/*  ============================================================================
    Contracts — create (the agent drafts the checks), invite, join, edit terms, sign.
    ============================================================================ */

import { db, audit } from '../lib/supabase.js'
import { requireUser, milestoneFor } from '../lib/auth.js'
import { draftInBackground } from '../lib/room.js'
import { mediateSoon } from '../agent/mediator.js'
import { compileInBackground } from '../agent/compile.js'

const MAX_MILESTONES = 6
const KINDS = ['visual', 'functional', 'code', 'performance', 'content']
export { draftInBackground }

function invitePreview(c) {
  const inviter = c.client || c.freelancer
  return {
    id: c.id, title: c.title, brief: c.brief, currency: c.currency,
    seat: !c.client_id ? 'client' : !c.freelancer_id ? 'freelancer' : null,
    inviter: inviter && { id: inviter.id, name: inviter.display_name },
    status: c.status,
    milestones: c.status === 'scoping'
      ? (c.terms?.milestones || []).map((m) => ({ title: m.title, amountCents: m.amount_cents }))
      : [...c.milestones].sort((a, b) => a.position - b.position).map((m) => ({ title: m.title, amountCents: m.amount_cents })),
  }
}
const PREVIEW_SELECT = 'id, title, brief, currency, status, terms, client_id, freelancer_id, invite_code, invite_email, client:profiles!contracts_client_id_fkey(id, display_name), freelancer:profiles!contracts_freelancer_id_fkey(id, display_name), milestones(title, amount_cents, position)'

// ---- public: what an invite link shows before you sign in
export async function inviteRoutes(app) {
  app.get('/invites/:code', async (request, reply) => {
    const { data: c } = await db().from('contracts').select(PREVIEW_SELECT).eq('invite_code', String(request.params.code).trim().toLowerCase()).maybeSingle()
    if (!c) return reply.code(404).send({ error: 'No contract matches this invite code.' })
    return invitePreview(c)
  })
}

export default async function contractRoutes(app) {
  app.addHook('preHandler', requireUser)

  // ---- invitations addressed to my email
  app.get('/invites/mine', async (request) => {
    const { data } = await db().from('contracts').select(PREVIEW_SELECT).ilike('invite_email', request.user.email)
    const me = request.user.id
    return {
      invites: (data || []).filter((c) => c.client_id !== me && c.freelancer_id !== me).map((c) => ({
        ...invitePreview(c), inviteCode: c.invite_code, client: c.client && { name: c.client.display_name }, freelancer: c.freelancer && { name: c.freelancer.display_name },
        milestones: invitePreview(c).milestones.map((m) => ({ ...m, status: 'draft' })),
      })),
    }
  })

  // ---- create: contract + milestones, then the agent drafts the checks
  app.post('/contracts', async (request, reply) => {
    const { title, brief = '', role = 'client', currency = 'USD', counterpartEmail = '', milestones = [] } = request.body || {}
    if (!title?.trim() || title.trim().length < 4) return reply.code(400).send({ error: 'Give the project a title' })
    if (brief.trim().length < 30) return reply.code(400).send({ error: 'The brief needs at least 30 characters' })
    if (!['client', 'freelancer'].includes(role)) return reply.code(400).send({ error: 'Invalid role' })
    if (!milestones.length || milestones.length > MAX_MILESTONES) return reply.code(400).send({ error: `Add between 1 and ${MAX_MILESTONES} milestones` })
    if (milestones.some((m) => !m.title?.trim() || !Number.isInteger(m.amountCents) || m.amountCents < 100)) {
      return reply.code(400).send({ error: 'Each milestone needs a title and at least $1.00' })
    }

    const me = request.user.id
    const { data: contract, error } = await db().from('contracts').insert({
      title: title.trim(), brief: brief.trim(), currency, created_by: me, status: 'drafting',
      invite_email: counterpartEmail.trim() || null,
      client_id: role === 'client' ? me : null,
      freelancer_id: role === 'freelancer' ? me : null,
    }).select().single()
    if (error) throw error

    const { data: rows, error: mError } = await db().from('milestones').insert(milestones.map((m, i) => ({
      contract_id: contract.id, position: i + 1, title: m.title.trim(), description: m.description?.trim() || '',
      amount_cents: m.amountCents, due_at: m.dueAt || null, status: 'draft',
    }))).select()
    if (mError) {
      await db().from('contracts').delete().eq('id', contract.id)
      throw mError
    }

    await audit({ contractId: contract.id, actor: role, event: 'contract.created', payload: { milestones: rows.length } })
    draftInBackground(contract, rows.sort((a, b) => a.position - b.position))
    return { id: contract.id, inviteCode: contract.invite_code }
  })

  // ---- join with an invite code
  app.post('/contracts/join', async (request, reply) => {
    const code = String(request.body?.code || '').trim().toLowerCase()
    const { data: c } = await db().from('contracts').select('*').eq('invite_code', code).maybeSingle()
    if (!c) return reply.code(404).send({ error: 'No contract matches this invite code.' })
    const me = request.user.id
    if ([c.client_id, c.freelancer_id].includes(me)) return { id: c.id }
    const seat = !c.client_id ? 'client_id' : !c.freelancer_id ? 'freelancer_id' : null
    if (!seat) return reply.code(409).send({ error: 'This contract already has both parties.' })
    await db().from('contracts').update({ [seat]: me }).eq('id', c.id)
    const { data: p } = await db().from('profiles').select('display_name').eq('id', me).single()
    await audit({ contractId: c.id, actor: seat === 'client_id' ? 'client' : 'freelancer', event: 'contract.joined', payload: { name: p?.display_name } })
    if (c.status === 'scoping') {
      await db().from('room_messages').insert({ contract_id: c.id, author: 'system', body: `${p?.display_name || 'They'} joined the room.` })
      mediateSoon(c.id)
    }
    return { id: c.id }
  })

  // ---- edit a milestone's checks (resets both signatures)
  app.put('/milestones/:id/criteria', async (request, reply) => {
    const m = await milestoneFor(request, reply)
    if (!m) return
    if (m.contract.client_signed_at && m.contract.freelancer_signed_at) return reply.code(409).send({ error: 'Terms are signed by both parties and locked' })
    const list = request.body?.criteria || []
    if (!list.length || list.length > 10 || list.some((c) => !KINDS.includes(c.kind) || (c.statement || '').trim().length < 8)) {
      return reply.code(400).send({ error: 'Each check needs a type and a sentence the agent can test' })
    }
    await db().from('criteria').delete().eq('milestone_id', m.id)
    await db().from('criteria').insert(list.map((c, i) => ({
      milestone_id: m.id, position: i + 1, kind: c.kind, statement: c.statement.trim(), method: c.method || 'Checked by the agent against the live URL and repository.',
    })))
    await db().from('contracts').update({ client_signed_at: null, freelancer_signed_at: null }).eq('id', m.contract.id)
    await audit({ contractId: m.contract.id, milestoneId: m.id, actor: m.role, event: 'terms.edited', payload: { milestone: m.position } })
    compileInBackground(m.contract.id)
    return { ok: true }
  })

  // ---- how money moves: the whole milestone on a pass, or check by check (part of the terms)
  app.put('/contracts/:id/release-mode', async (request, reply) => {
    const { data: c } = await db().from('contracts').select('*').eq('id', request.params.id).maybeSingle()
    if (!c || ![c.client_id, c.freelancer_id].includes(request.user.id)) return reply.code(404).send({ error: 'Contract not found' })
    const mode = request.body?.mode
    if (!['whole', 'per_check'].includes(mode)) return reply.code(400).send({ error: 'Choose whole or per_check' })
    if (c.client_signed_at && c.freelancer_signed_at) return reply.code(409).send({ error: 'Terms are signed by both parties and locked' })
    if (mode === c.release_mode) return { ok: true }
    await db().from('contracts').update({ release_mode: mode, client_signed_at: null, freelancer_signed_at: null }).eq('id', c.id)
    await audit({ contractId: c.id, actor: c.client_id === request.user.id ? 'client' : 'freelancer', event: 'terms.release_mode', payload: { mode } })
    return { ok: true }
  })

  // ---- sign the terms (covers every milestone)
  app.post('/contracts/:id/sign', async (request, reply) => {
    const { data: c } = await db().from('contracts').select('*').eq('id', request.params.id).maybeSingle()
    if (!c) return reply.code(404).send({ error: 'Contract not found' })
    const me = request.user.id
    const role = c.client_id === me ? 'client' : c.freelancer_id === me ? 'freelancer' : null
    if (!role) return reply.code(403).send({ error: 'You are not a party to this contract' })
    if (c.status === 'drafting') return reply.code(409).send({ error: 'The checks are still being drafted' })
    if (!c.client_id || !c.freelancer_id) return reply.code(409).send({ error: 'Both parties must join before signing' })

    const field = role === 'client' ? 'client_signed_at' : 'freelancer_signed_at'
    const patch = { [field]: new Date().toISOString() }
    const bothSigned = role === 'client' ? !!c.freelancer_signed_at : !!c.client_signed_at
    if (bothSigned) patch.status = 'active'
    await db().from('contracts').update(patch).eq('id', c.id)
    await audit({ contractId: c.id, actor: role, event: 'terms.signed' })

    if (bothSigned) {
      const { data: first } = await db().from('milestones').select('id').eq('contract_id', c.id).eq('status', 'draft').order('position').limit(1).maybeSingle()
      if (first) await db().from('milestones').update({ status: 'awaiting_funding' }).eq('id', first.id)
      await audit({ contractId: c.id, actor: 'system', event: 'contract.active' })
    }
    return { ok: true, active: bothSigned }
  })
}
