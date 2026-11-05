import { isConfigured } from '@/lib/supabase'
import { demo } from './demo'
import { live } from './live'

/* Live when Supabase is configured; otherwise the in-browser demo. A visitor can also choose the demo
   on a live deployment ("Try it now", or a link with ?demo) — remembered in this browser — so anyone
   can play the whole flow without an account, and go back to real accounts from the demo menu. */
const MODE_KEY = 'verdikt-mode'
const chosen = (() => {
  try {
    if (new URLSearchParams(location.search).has('demo')) localStorage.setItem(MODE_KEY, 'demo')
    return localStorage.getItem(MODE_KEY)
  } catch {
    return null
  }
})()
const forced = import.meta.env.VITE_DEMO === 'true'

export const api = isConfigured && !forced && chosen !== 'demo' ? live : demo
export const isDemo = api.mode === 'demo'
export const canLeaveDemo = isDemo && isConfigured && !forced

export function enterDemo() {
  try { localStorage.setItem(MODE_KEY, 'demo') } catch {}
  location.assign('/login')
}
export function leaveDemo() {
  try { localStorage.removeItem(MODE_KEY) } catch {}
  location.assign('/login')
}
