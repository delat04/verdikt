import { verifyWebhook } from '../lib/paypal.js'
import { db, audit } from '../lib/supabase.js'

// PayPal events we mirror into the audit log (reference_id = milestone id)
const TRACKED = new Set([
  'PAYMENT.AUTHORIZATION.CREATED',
  'PAYMENT.AUTHORIZATION.VOIDED',
  'PAYMENT.CAPTURE.COMPLETED',
  'PAYMENT.CAPTURE.DENIED',
  'CUSTOMER.DISPUTE.CREATED',
])

export default async function webhookRoutes(app) {
  app.post('/paypal/webhook', async (request, reply) => {
    const event = request.body
    const valid = await verifyWebhook(request.headers, event).catch(() => false)
    if (!valid) return reply.code(400).send({ error: 'Invalid signature' })
    if (!TRACKED.has(event.event_type)) return { ok: true }

    const orderId = event.resource?.supplementary_data?.related_ids?.order_id
    const milestone = orderId
      ? (await db().from('milestones').select('id, contract_id').eq('paypal_order_id', orderId).maybeSingle()).data
      : null

    await audit({
      contractId: milestone?.contract_id,
      milestoneId: milestone?.id,
      actor: 'paypal',
      event: `paypal.${event.event_type.toLowerCase()}`,
      payload: { id: event.id, resourceId: event.resource?.id, status: event.resource?.status },
    })
    return { ok: true }
  })
}
