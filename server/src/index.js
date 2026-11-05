import Fastify from 'fastify'
import cors from '@fastify/cors'
import { config } from './config.js'
import { PayPalError } from './lib/paypal.js'
import contractRoutes, { inviteRoutes } from './routes/contracts.js'
import escrowRoutes from './routes/escrow.js'
import deliveryRoutes from './routes/delivery.js'
import webhookRoutes from './routes/webhooks.js'
import disputeRoutes from './routes/disputes.js'
import roomRoutes from './routes/room.js'
import { renewHolds, resumePayouts } from './lib/flow.js'
import { syncDisputes } from './agent/defense.js'
import { resumeVerifications } from './agent/verify.js'
import { resumeAppeals } from './agent/appeal.js'

const app = Fastify({ logger: { level: process.env.LOG_LEVEL || 'info' } })

await app.register(cors, { origin: config.corsOrigin })

// An action with nothing to say (sign, fund, refund) may arrive as JSON with an empty body: treat it as {}
app.addContentTypeParser('application/json', { parseAs: 'string' }, (request, body, done) => {
  if (!body) return done(null, {})
  try {
    done(null, JSON.parse(body))
  } catch (e) {
    e.statusCode = 400
    done(e)
  }
})

app.setErrorHandler((error, request, reply) => {
  if (error instanceof PayPalError) {
    request.log.warn({ debugId: error.debugId, details: error.body?.details }, 'PayPal error')
    return reply.code(502).send({ error: `PayPal: ${error.message}`, paypalDebugId: error.debugId })
  }
  request.log.error(error)
  return reply.code(error.statusCode || 500).send({ error: error.message })
})

app.get('/health', async () => ({ ok: true, paypalEnv: config.paypal.env }))

await app.register(inviteRoutes, { prefix: '/api' })
await app.register(contractRoutes, { prefix: '/api' })
await app.register(escrowRoutes, { prefix: '/api' })
await app.register(deliveryRoutes, { prefix: '/api' })
await app.register(webhookRoutes, { prefix: '/api' })
await app.register(disputeRoutes, { prefix: '/api' })
await app.register(roomRoutes, { prefix: '/api' })

await app.listen({ port: config.port, host: '0.0.0.0' })

// Background care for the money: renew holds past PayPal's 3-day honor period, and look for new
// PayPal disputes (webhooks do this instantly once deployed; locally the timer covers it)
const every = (ms, fn, label) => {
  const run = () => fn().catch((e) => app.log.warn({ err: e.message }, `${label} failed`))
  setTimeout(run, 15_000)
  setInterval(run, ms)
}
every(30 * 60_000, renewHolds, 'hold renewal')
every(10 * 60_000, syncDisputes, 'dispute sync')

// Work that a restart interrupted picks up where it left off: checks, second reviews, payouts in flight
Promise.all([resumeVerifications(), resumeAppeals(), resumePayouts()])
  .then(([v, a, p]) => { if (v + a + p) app.log.info({ verifications: v, appeals: a, payouts: p }, 'resumed interrupted work') })
  .catch((e) => app.log.warn({ err: e.message }, 'resume failed'))
