import { verifyWebhook } from '../lib/paypal.js'
import { db, audit } from '../lib/supabase.js'
import { syncDisputes } from '../agent/defense.js'

// PayPal events we mirror into the audit log (reference_id = milestone id)
const TRACKED = new Set([
  'PAYMENT.AUTHORIZATION.CREATED',
  'PAYMENT.AUTHORIZATION.VOIDED',
  'PAYMENT.CAPTURE.COMPLETED',
  'PAYMENT.CAPTURE.DENIED',
  'CUSTOMER.DISPUTE.CREATED',
  'CUSTOMER.DISPUTE.UPDATED',
  'PAYMENT.PAYOUTS-ITEM.SUCCEEDED',
  'PAYMENT.PAYOUTS-ITEM.FAILED',
  'PAYMENT.PAYOUTS-ITEM.RETURNED',
  'PAYMENT.PAYOUTS-ITEM.UNCLAIMED',
  'PAYMENT.PAYOUTS-ITEM.BLOCKED',
])

export default async function webhookRoutes(app) {
  app.post('/paypal/webhook', async (request, reply) => {
    const event = request.body
    const valid = await verifyWebhook(request.headers, event).catch(() => false)
    if (!valid) return reply.code(400).send({ error: 'Invalid signature' })
    if (!TRACKED.has(event.event_type)) return { ok: true }

    // a new dispute: find it, match it to a milestone, and let the agent answer
    if (event.event_type.startsWith('CUSTOMER.DISPUTE.')) {
      syncDisputes().catch((e) => request.log.warn(e, 'dispute sync failed'))
      return { ok: true }
    }

    // payouts carry our milestone id as sender_item_id
    if (event.event_type.startsWith('PAYMENT.PAYOUTS-ITEM.')) {
      const milestoneId = event.resource?.payout_item?.sender_item_id
      const status = event.resource?.transaction_status
      if (milestoneId && status) {
        await db().from('milestones').update({
          payout_status: status, paypal_payout_item_id: event.resource.payout_item_id,
          ...(status === 'SUCCESS' ? { paid_out_at: new Date().toISOString() } : {}),
        }).eq('id', milestoneId)
      }
      return { ok: true }
    }

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
