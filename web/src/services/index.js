import { isConfigured } from '@/lib/supabase'
import { demo } from './demo'
import { live } from './live'

/* Live when Supabase is configured (and demo isn't forced); otherwise the in-browser demo. */
export const api = isConfigured && import.meta.env.VITE_DEMO !== 'true' ? live : demo
export const isDemo = api.mode === 'demo'
