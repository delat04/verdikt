/*  ============================================
    Escrow routes — one milestone at a time
    fund  : create AUTHORIZE order        (client)
    hold  : authorize after approval      (client)
    release / refund : capture / void     (client now; the verdict agent later)
    ============================================ */

import * as paypal from '../lib/paypal.js'
import { db, userFromRequest, audit } from '../lib/supabase.js'

async function loadMilestone(id) {
  const { data, error } = await db()
    .from('milestones')
    .select('*, contract:contracts(id, title, currency, client_id, freelancer_id)')
    .eq('id', id)
    .single()
  if (error) return null
  return data
}

export default async function escrowRoutes(app) {
  // ---- auth guard: every route needs a signed-in party ----
  app.addHook('preHandler', async (request, reply) => {
    const user = await userFromRequest(request)
    if (!user) return reply.code(401).send({ error: 'Sign in required' })
    request.user = user
  })

  async function milestoneForClient(request, reply) {
    const milestone = await loadMilestone(request.params.id)
    if (!milestone) return reply.code(404).send({ error: 'Milestone not found' })
    if (milestone.contract.client_id !== request.user.id) {
      return reply.code(403).send({ error: 'Only the client can do this' })
    }
    return milestone
  }

  // ---- 1. Fund: create the PayPal order the client will approve ----
  app.post('/milestones/:id/fund', async (request, reply) => {
    const milestone = await milestoneForClient(request, reply)
    if (reply.sent) return
    if (!['draft', 'awaiting_funding'].includes(milestone.status)) {
      return reply.code(409).send({ error: `Milestone is ${milestone.status}` })
    }

    const order = await paypal.createAuthorizeOrder({
      amountCents: milestone.amount_cents,
      currency: milestone.contract.currency,
      referenceId: milestone.id,
      description: `${milestone.contract.title} — ${milestone.title}`,
      requestId: `fund-${milestone.id}-${Date.now()}`,
    })

    await db().from('milestones')
      .update({ status: 'awaiting_funding', paypal_order_id: order.id })
      .eq('id', milestone.id)
    await audit({
      contractId: milestone.contract.id, milestoneId: milestone.id,
      actor: 'client', event: 'escrow.order_created', payload: { orderId: order.id },
    })

    return { orderId: order.id, approveUrl: paypal.approveLink(order) }
  })

  // ---- 2. Hold: authorize the approved order, funds are now held ----
  app.post('/milestones/:id/authorize', async (request, reply) => {
    const milestone = await milestoneForClient(request, reply)
    if (reply.sent) return
    if (!milestone.paypal_order_id) return reply.code(409).send({ error: 'Fund the milestone first' })

    const { authorization } = await paypal.authorizeOrder(milestone.paypal_order_id, {
      requestId: `auth-${milestone.paypal_order_id}`,
    })
    if (authorization?.status !== 'CREATED') {
      return reply.code(402).send({ error: `Authorization ${authorization?.status || 'missing'}` })
    }

    await db().from('milestones')
      .update({ status: 'funded', paypal_authorization_id: authorization.id, funded_at: new Date().toISOString() })
      .eq('id', milestone.id)
    await audit({
      contractId: milestone.contract.id, milestoneId: milestone.id,
      actor: 'paypal', event: 'escrow.funds_held',
      payload: { authorizationId: authorization.id, expiresAt: authorization.expiration_time },
    })

    return { status: 'funded', authorizationId: authorization.id }
  })

  // ---- 3a. Release: capture the hold (client can always release early) ----
  app.post('/milestones/:id/release', async (request, reply) => {
    const milestone = await milestoneForClient(request, reply)
    if (reply.sent) return
    if (!milestone.paypal_authorization_id || milestone.status === 'released') {
      return reply.code(409).send({ error: `Milestone is ${milestone.status}` })
    }

    const capture = await paypal.captureAuthorization(milestone.paypal_authorization_id, {
      requestId: `release-${milestone.id}`,
      noteToPayer: `Verdikt released: ${milestone.title}`,
    })

    await db().from('milestones')
      .update({ status: 'released', paypal_capture_id: capture.id, released_at: new Date().toISOString() })
      .eq('id', milestone.id)
    await audit({
      contractId: milestone.contract.id, milestoneId: milestone.id,
      actor: 'client', event: 'escrow.released', payload: { captureId: capture.id, status: capture.status },
    })

    return { status: 'released', captureId: capture.id }
  })

  // ---- 3b. Refund: void the hold, the client is never charged ----
  app.post('/milestones/:id/refund', async (request, reply) => {
    const milestone = await milestoneForClient(request, reply)
    if (reply.sent) return
    // Day 1 rule: refunds need a failed verdict. Disputes come later.
    if (milestone.status !== 'failed') {
      return reply.code(409).send({ error: 'Refunds need a failed verdict' })
    }

    await paypal.voidAuthorization(milestone.paypal_authorization_id, { requestId: `refund-${milestone.id}` })
    await db().from('milestones').update({ status: 'refunded' }).eq('id', milestone.id)
    await audit({
      contractId: milestone.contract.id, milestoneId: milestone.id,
      actor: 'client', event: 'escrow.refunded', payload: {},
    })

    return { status: 'refunded' }
  })
}
