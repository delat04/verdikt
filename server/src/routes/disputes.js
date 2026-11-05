/*  ============================================================================
    PayPal disputes — either party can ask Verdikt to look for new disputes now
    (webhooks and a 10-minute timer do it on their own). The agent answers each new one.
    ============================================================================ */

import { requireUser } from '../lib/auth.js'
import { syncDisputes } from '../agent/defense.js'

export default async function disputeRoutes(app) {
  app.addHook('preHandler', requireUser)

  app.post('/disputes/sync', async () => syncDisputes())
}
