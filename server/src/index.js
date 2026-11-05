import Fastify from 'fastify'
import cors from '@fastify/cors'
import { config } from './config.js'
import { PayPalError } from './lib/paypal.js'
import contractRoutes from './routes/contracts.js'
import escrowRoutes from './routes/escrow.js'
import webhookRoutes from './routes/webhooks.js'

const app = Fastify({ logger: { level: process.env.LOG_LEVEL || 'info' } })

await app.register(cors, { origin: config.corsOrigin })

app.setErrorHandler((error, request, reply) => {
  if (error instanceof PayPalError) {
    request.log.warn({ debugId: error.debugId, details: error.body?.details }, 'PayPal error')
    return reply.code(502).send({ error: error.message, paypalDebugId: error.debugId })
  }
  request.log.error(error)
  return reply.code(error.statusCode || 500).send({ error: error.message })
})

app.get('/health', async () => ({ ok: true, paypalEnv: config.paypal.env }))

await app.register(contractRoutes, { prefix: '/api' })
await app.register(escrowRoutes, { prefix: '/api' })
await app.register(webhookRoutes, { prefix: '/api' })

await app.listen({ port: config.port, host: '0.0.0.0' })
