/*  ============================================================================
    Agent access — personal tokens that let an AI agent (Claude Desktop, Claude Code, any MCP
    client) act for you in Verdikt through the MCP server at /mcp. Shown once, stored as a hash,
    revocable. An agent token can't mint more tokens.
    ============================================================================ */

import { randomBytes } from 'node:crypto'
import { db, audit, hashToken, forgetAgentToken } from '../lib/supabase.js'
import { requireUser } from '../lib/auth.js'

export default async function agentRoutes(app) {
  app.addHook('preHandler', requireUser)
  app.addHook('preHandler', async (request, reply) => {
    if (request.user.viaToken) return reply.code(403).send({ error: 'Agent tokens are managed by the person, in Settings' })
  })

  app.get('/agent-tokens', async (request) => {
    const { data } = await db().from('agent_tokens').select('id, label, created_at, last_used_at, revoked_at')
      .eq('user_id', request.user.id).order('created_at', { ascending: false })
    return { tokens: data || [] }
  })

  app.post('/agent-tokens', async (request, reply) => {
    const label = String(request.body?.label || 'AI agent').trim().slice(0, 60) || 'AI agent'
    const { count } = await db().from('agent_tokens').select('id', { count: 'exact', head: true }).eq('user_id', request.user.id).is('revoked_at', null)
    if (count >= 5) return reply.code(409).send({ error: 'You have 5 active agent tokens — revoke one first' })
    const token = `vk_${randomBytes(24).toString('base64url')}`
    const { data, error } = await db().from('agent_tokens').insert({ user_id: request.user.id, label, token_hash: hashToken(token) }).select('id, label, created_at').single()
    if (error) throw error
    await audit({ actor: 'system', event: 'agent_token.created', payload: { label } })
    return { ...data, token }
  })

  app.post('/agent-tokens/:id/revoke', async (request) => {
    const { data } = await db().from('agent_tokens').update({ revoked_at: new Date().toISOString() })
      .eq('id', request.params.id).eq('user_id', request.user.id).select('token_hash').maybeSingle()
    if (data) forgetAgentToken(data.token_hash)
    return { ok: true }
  })
}
