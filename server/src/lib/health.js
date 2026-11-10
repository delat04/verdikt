/*  ============================================================================
    /health — one flat object for uptime checks and for anyone asking which integrations are live.
    Each integration adds its own key here (kernel, precedent, channel3) with a state or a count it
    already holds in memory: never a URL, a host or a key, and never a call to the service itself.
    ============================================================================ */

import { config } from '../config.js'
import { health as precedentHealth } from './precedent.js'
import { channel3Status } from './channel3.js'
import { kernelOn } from './kernel.js'

export function healthReport() {
  return {
    ok: true,
    paypalEnv: config.paypal.env,
    // Kernel: true when KERNEL_API_KEY is set (official checks then run, recorded, in Kernel's cloud browser), from env alone
    kernel: kernelOn(),
    // Elastic: on | off | degraded, as last checked at boot (and every 5 minutes after, when used)
    precedent: precedentHealth().state,
    // Channel3: { on (key set), search: 'rest' | 'mcp', cap (searches a month) }, from env alone
    channel3: channel3Status(),
  }
}
