import { existsSync } from 'node:fs'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import fastifyStatic from '@fastify/static'
import { config } from './config.js'
import { PayPalError } from './lib/paypal.js'
import { healthReport } from './lib/health.js'
import contractRoutes, { inviteRoutes } from './routes/contracts.js'
import escrowRoutes from './routes/escrow.js'
import deliveryRoutes from './routes/delivery.js'
import webhookRoutes from './routes/webhooks.js'
import disputeRoutes from './routes/disputes.js'
import roomRoutes from './routes/room.js'
import ledgerRoutes from './routes/ledger.js'
import agentRoutes from './routes/agents.js'
import mcpRoutes from './routes/mcp.js'
import proofSettingsRoutes, { proofRoutes } from './routes/proof.js'
import changeRoutes from './routes/changes.js'
import verifierRoutes from './routes/verifier.js'
import expenseRoutes, { resumeExpenses } from './routes/expenses.js'
import jobRoutes from './routes/jobs.js'
import limitRoutes from './routes/limits.js'
import portfolioRoutes from './routes/portfolio.js'
import scheduleRoutes from './routes/schedule.js'
import studioRoutes, { studioDemoRoutes } from './routes/studio.js'
import { renewHolds, resumePayouts } from './lib/flow.js'
import { closeEndedLimits } from './lib/limits.js'
import { syncDisputes } from './agent/defense.js'
import { resumeVerifications } from './agent/verify.js'
import { resumeAppeals } from './agent/appeal.js'
import { resumeRooms } from './agent/negotiator.js'
import { initPrecedent, syncRecent } from './lib/precedent.js'
import { channel3Status } from './lib/channel3.js'

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

// one status object: each integration adds its own key in lib/health.js (states only, never a URL or a key)
app.get('/health', async () => healthReport())

await app.register(inviteRoutes, { prefix: '/api' })
await app.register(contractRoutes, { prefix: '/api' })
await app.register(escrowRoutes, { prefix: '/api' })
await app.register(deliveryRoutes, { prefix: '/api' })
await app.register(webhookRoutes, { prefix: '/api' })
await app.register(disputeRoutes, { prefix: '/api' })
await app.register(roomRoutes, { prefix: '/api' })
await app.register(ledgerRoutes, { prefix: '/api' })
await app.register(changeRoutes, { prefix: '/api' })
await app.register(verifierRoutes, { prefix: '/api' })
await app.register(expenseRoutes, { prefix: '/api' })
await app.register(jobRoutes, { prefix: '/api' })
await app.register(limitRoutes, { prefix: '/api' })
await app.register(portfolioRoutes, { prefix: '/api' })
await app.register(scheduleRoutes, { prefix: '/api' })
await app.register(studioRoutes, { prefix: '/api' })
// the demo's dashboard assistant: off unless STUDIO_DEMO_TURNS_PER_DAY gives it a budget
await app.register(studioDemoRoutes, { prefix: '/api' })
await app.register(agentRoutes, { prefix: '/api' })
// any AI agent can use Verdikt with a personal token: Streamable HTTP MCP at /mcp
await app.register(mcpRoutes)
// a freelancer's public proof of verified, PayPal-settled work (opt-in) and its badge
await app.register(proofRoutes)
await app.register(proofSettingsRoutes, { prefix: '/api' })

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

// Background care for the money: renew holds past PayPal's 3-day honor period, close spending limits past
// their end date (voiding what was never captured), and look for new
// PayPal disputes (webhooks do this instantly once deployed; locally the timer covers it)
const every = (ms, fn, label) => {
  const run = () => fn().catch((e) => app.log.warn({ err: e.message }, `${label} failed`))
  setTimeout(run, 15_000)
  setInterval(run, ms)
}
every(30 * 60_000, renewHolds, 'hold renewal')
every(30 * 60_000, closeEndedLimits, 'spending limit close')
every(10 * 60_000, syncDisputes, 'dispute sync')

// Precedent (Elastic): one line on where it stands (the v2 index is made only by `npm run precedent:sync --
// --rebuild --yes`, never here), then catch up on whatever a failed write or an outage missed
void initPrecedent(app.log)
every(30 * 60_000, syncRecent, 'precedent sync')

// Channel3: one line on how store search is set up (from env, no call)
{
  const c3 = channel3Status()
  app.log.info(c3.on ? `channel3 on (REST v1, cap ${c3.cap}/month)` : `channel3 off: no CHANNEL3_API_KEY, anonymous MCP search only (cap ${c3.cap}/month)`)
}

// Work that a restart interrupted picks up where it left off: checks, second reviews, payouts in flight, expense claims
Promise.all([resumeVerifications(), resumeAppeals(), resumePayouts(), resumeRooms(), resumeExpenses()])
  .then(([v, a, p]) => { if (v + a + p) app.log.info({ verifications: v, appeals: a, payouts: p }, 'resumed interrupted work') })
  .catch((e) => app.log.warn({ err: e.message }, 'resume failed'))
