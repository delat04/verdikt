/*  ============================================================================
    Moving a due date after the terms are signed — one side proposes (e.g. by dragging the milestone's bar on
    the timeline), the other accepts or declines. Nothing moves on one side's word.
      POST /milestones/:id/due-proposal          propose { dueAt, reason }
      POST /milestones/:id/due-proposal/accept   the other side: the due date moves
      POST /milestones/:id/due-proposal/decline  the other side declines, or the proposer withdraws
    ============================================================================ */

import { db, audit } from '../lib/supabase.js'
import { requireUser, milestoneFor } from '../lib/auth.js'

const SETTLED = ['released', 'refunded']
const day = (iso) => (iso ? iso.slice(0, 10) : 'no date')

export default async function scheduleRoutes(app) {
  app.addHook('preHandler', requireUser)

  app.post('/milestones/:id/due-proposal', async (request, reply) => {
    const m = await milestoneFor(request, reply)
    if (!m) return
    if (!(m.contract.client_signed_at && m.contract.freelancer_signed_at)) return reply.code(409).send({ error: 'Before signing, change the date in the contract room' })
    if (SETTLED.includes(m.status)) return reply.code(409).send({ error: 'This milestone is already settled' })
    const due = new Date(String(request.body?.dueAt || ''))
    if (Number.isNaN(due.getTime())) return reply.code(400).send({ error: 'Pick a date' })
    if (due.getTime() < Date.now() + 3600e3) return reply.code(400).send({ error: 'The new date has to be in the future' })
    if (due.getTime() > Date.now() + 365 * 864e5) return reply.code(400).send({ error: 'Pick a date within a year' })
    if (m.due_at && day(m.due_at) === day(due.toISOString())) return reply.code(400).send({ error: 'That’s already the due date' })
    const proposal = {
      dueAt: due.toISOString(), from: m.due_at || null, by: m.role, reason: String(request.body?.reason || '').trim().slice(0, 240),
      viaAgent: !!request.user.viaToken, at: new Date().toISOString(),
    }
    await db().from('milestones').update({ due_proposal: proposal }).eq('id', m.id)
    await audit({ contractId: m.contract.id, milestoneId: m.id, actor: m.role, event: 'terms.due_proposed', payload: { milestone: m.position, from: day(m.due_at), to: day(proposal.dueAt), reason: proposal.reason, viaAgent: proposal.viaAgent } })
    return { proposal }
  })

  app.post('/milestones/:id/due-proposal/accept', async (request, reply) => {
    const m = await milestoneFor(request, reply)
    if (!m) return
    const p = m.due_proposal
    if (!p) return reply.code(409).send({ error: 'No date change is waiting' })
    if (p.by === m.role) return reply.code(403).send({ error: 'The other side accepts a date change' })
    await db().from('milestones').update({ due_at: p.dueAt, due_proposal: null }).eq('id', m.id)
    await audit({ contractId: m.contract.id, milestoneId: m.id, actor: m.role, event: 'terms.due_changed', payload: { milestone: m.position, from: day(p.from), to: day(p.dueAt), viaAgent: !!request.user.viaToken } })
    return { dueAt: p.dueAt }
  })

  app.post('/milestones/:id/due-proposal/decline', async (request, reply) => {
    const m = await milestoneFor(request, reply)
    if (!m) return
    const p = m.due_proposal
    if (!p) return reply.code(409).send({ error: 'No date change is waiting' })
    await db().from('milestones').update({ due_proposal: null }).eq('id', m.id)
    await audit({ contractId: m.contract.id, milestoneId: m.id, actor: m.role, event: p.by === m.role ? 'terms.due_withdrawn' : 'terms.due_declined', payload: { milestone: m.position, to: day(p.dueAt) } })
    return { ok: true }
  })
}
