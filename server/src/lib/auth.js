import { db, userFromRequest } from './supabase.js'

/** preHandler: every route in the plugin needs a signed-in user. */
export async function requireUser(request, reply) {
  const user = await userFromRequest(request)
  if (!user) return reply.code(401).send({ error: 'Sign in required' })
  request.user = user
}

/** Loads a milestone with its contract and the caller's role on it; replies 404/403 itself. */
export async function milestoneFor(request, reply, { role } = {}) {
  const { data: m } = await db()
    .from('milestones')
    .select('*, contract:contracts(id, title, brief, currency, status, client_id, freelancer_id, client_signed_at, freelancer_signed_at)')
    .eq('id', request.params.id)
    .maybeSingle()
  if (!m) { reply.code(404).send({ error: 'Milestone not found' }); return null }
  const me = request.user.id
  const mine = m.contract.client_id === me ? 'client' : m.contract.freelancer_id === me ? 'freelancer' : null
  if (!mine) { reply.code(403).send({ error: 'You are not a party to this contract' }); return null }
  if (role && mine !== role) { reply.code(403).send({ error: `Only the ${role} can do this` }); return null }
  m.role = mine
  return m
}
