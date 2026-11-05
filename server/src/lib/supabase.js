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

/** Resolves the Supabase user from a `Bearer <access token>` header, or null. */
export async function userFromRequest(request) {
  const header = request.headers.authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : null
  if (!token) return null
  const { data, error } = await db().auth.getUser(token)
  return error ? null : data.user
}

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
