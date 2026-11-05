import { createHash } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { config } from '../config.js'

let admin = null

/** Service-role client: bypasses RLS, server only. */
export function db() {
  admin ??= createClient(config.supabase.url, config.supabase.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return admin
}

/** Resolves the Supabase user from a `Bearer <access token>` header — or a Verdikt agent token (vk_…) — or null. */
export async function userFromRequest(request) {
  const header = request.headers.authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : null
  if (!token) return null
  if (token.startsWith('vk_')) return userFromAgentToken(token)
  const { data, error } = await db().auth.getUser(token)
  return error ? null : data.user
}

export const hashToken = (token) => createHash('sha256').update(token).digest('hex')

// an AI agent acting for a person: same rights as the person, and everything it says is marked as its own
const tokenCache = new Map()
async function userFromAgentToken(token) {
  const hash = hashToken(token)
  const hit = tokenCache.get(hash)
  if (hit && hit.until > Date.now()) return hit.user
  const { data: row } = await db().from('agent_tokens').select('id, user_id, label, last_used_at').eq('token_hash', hash).is('revoked_at', null).maybeSingle()
  if (!row) return null
  const { data } = await db().auth.admin.getUserById(row.user_id)
  if (!data?.user) return null
  const user = { id: row.user_id, email: data.user.email, viaToken: true, tokenLabel: row.label }
  tokenCache.set(hash, { user, until: Date.now() + 60_000 })
  if (!row.last_used_at || Date.now() - new Date(row.last_used_at).getTime() > 60_000) {
    await db().from('agent_tokens').update({ last_used_at: new Date().toISOString() }).eq('id', row.id)
  }
  return user
}
export const forgetAgentToken = (hash) => tokenCache.delete(hash)

export async function audit({ contractId, milestoneId, actor, event, payload = {} }) {
  const { error } = await db().from('audit_log').insert({
    contract_id: contractId,
    milestone_id: milestoneId,
    actor,
    event,
    payload,
  })
  if (error) console.error('audit_log insert failed', error)
}
