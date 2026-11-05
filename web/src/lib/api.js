import { supabase } from './supabase'

const BASE = import.meta.env.VITE_API_URL || 'http://localhost:4100'

/** Calls the Verdikt API with the user's Supabase session. Throws with the server's message. */
export async function api(path, { method = 'POST', body } = {}) {
  const { data } = await supabase.auth.getSession()
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(data.session && { Authorization: `Bearer ${data.session.access_token}` }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`)
  return json
}
