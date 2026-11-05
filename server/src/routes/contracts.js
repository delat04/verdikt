import { db, userFromRequest, audit } from '../lib/supabase.js'

const MAX_MILESTONES = 6

export default async function contractRoutes(app) {
  app.addHook('preHandler', async (request, reply) => {
    const user = await userFromRequest(request)
    if (!user) return reply.code(401).send({ error: 'Sign in required' })
    request.user = user
  })

  // ---- Create a contract with its milestones (criteria come next, drafted by the agent) ----
  app.post('/contracts', async (request, reply) => {
    const { title, brief = '', role = 'client', currency = 'USD', milestones = [] } = request.body || {}

    if (!title?.trim()) return reply.code(400).send({ error: 'Title is required' })
    if (!['client', 'freelancer'].includes(role)) return reply.code(400).send({ error: 'Invalid role' })
    if (!milestones.length || milestones.length > MAX_MILESTONES) {
      return reply.code(400).send({ error: `Add between 1 and ${MAX_MILESTONES} milestones` })
    }
    for (const m of milestones) {
      if (!m.title?.trim() || !Number.isInteger(m.amount_cents) || m.amount_cents < 100) {
        return reply.code(400).send({ error: 'Each milestone needs a title and at least $1.00' })
      }
    }

    const userId = request.user.id
    const { data: contract, error } = await db().from('contracts').insert({
      title: title.trim(),
      brief: brief.trim(),
      currency,
      created_by: userId,
      client_id: role === 'client' ? userId : null,
      freelancer_id: role === 'freelancer' ? userId : null,
      status: 'draft',
    }).select().single()
    if (error) throw error

    const { error: mError } = await db().from('milestones').insert(milestones.map((m, i) => ({
      contract_id: contract.id,
      position: i + 1,
      title: m.title.trim(),
      amount_cents: m.amount_cents,
    })))
    if (mError) {
      await db().from('contracts').delete().eq('id', contract.id)
      throw mError
    }

    await audit({ contractId: contract.id, actor: role, event: 'contract.created', payload: { milestones: milestones.length } })
    return { id: contract.id, inviteCode: contract.invite_code }
  })

  // ---- Counterparty joins with the invite code ----
  app.post('/contracts/join', async (request, reply) => {
    const code = String(request.body?.code || '').trim().toLowerCase()
    const { data: contract } = await db().from('contracts').select('*').eq('invite_code', code).maybeSingle()
    if (!contract) return reply.code(404).send({ error: 'Invite not found' })

    const userId = request.user.id
    if ([contract.client_id, contract.freelancer_id].includes(userId)) return { id: contract.id }

    const seat = !contract.client_id ? 'client_id' : !contract.freelancer_id ? 'freelancer_id' : null
    if (!seat) return reply.code(409).send({ error: 'This contract already has both parties' })

    await db().from('contracts').update({ [seat]: userId, status: 'negotiating' }).eq('id', contract.id)
    await audit({
      contractId: contract.id, actor: seat === 'client_id' ? 'client' : 'freelancer', event: 'contract.joined',
    })
    return { id: contract.id }
  })
}
