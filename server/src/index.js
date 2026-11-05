import { existsSync } from 'node:fs'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import fastifyStatic from '@fastify/static'
import { config } from './config.js'
import { PayPalError } from './lib/paypal.js'
import contractRoutes, { inviteRoutes } from './routes/contracts.js'
import escrowRoutes from './routes/escrow.js'
import deliveryRoutes from './routes/delivery.js'
import webhookRoutes from './routes/webhooks.js'
import disputeRoutes from './routes/disputes.js'
import roomRoutes from './routes/room.js'
import ledgerRoutes from './routes/ledger.js'
import agentRoutes from './routes/agents.js'
import mcpRoutes from './routes/mcp.js'
import { renewHolds, resumePayouts } from './lib/flow.js'
import { syncDisputes } from './agent/defense.js'
import { resumeVerifications } from './agent/verify.js'
import { resumeAppeals } from './agent/appeal.js'
import { resumeRooms } from './agent/negotiator.js'

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
await app.register(ledgerRoutes, { prefix: '/api' })
await app.register(agentRoutes, { prefix: '/api' })
// any AI agent can use Verdikt with a personal token: Streamable HTTP MCP at /mcp
await app.register(mcpRoutes)

// Deployed, the built web app ships in the same image (WEB_DIST): serve it, with long caching for the
// hashed assets, and hand every other GET to the app's router so deep links like /contracts/:id work
const webDist = process.env.WEB_DIST
if (webDist && existsSync(webDist)) {
  await app.register(fastifyStatic, {
    root: webDist,
    wildcard: false,
    cacheControl: false,   // our header below, not the plugin's max-age=0
    setHeaders: (res, path) => res.setHeader('Cache-Control', /[\\/]assets[\\/]/.test(path) ? 'public, max-age=31536000, immutable' : 'no-cache'),
  })
  app.setNotFoundHandler((request, reply) => {
    if (request.method !== 'GET' || request.url.startsWith('/api/')) return reply.code(404).send({ error: 'Not found' })
    return reply.header('Cache-Control', 'no-cache').sendFile('index.html')
  })
}

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
Promise.all([resumeVerifications(), resumeAppeals(), resumePayouts(), resumeRooms()])
  .then(([v, a, p]) => { if (v + a + p) app.log.info({ verifications: v, appeals: a, payouts: p }, 'resumed interrupted work') })
  .catch((e) => app.log.warn({ err: e.message }, 'resume failed'))
