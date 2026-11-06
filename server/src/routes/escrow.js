/*  ============================================================================
    Escrow — one milestone at a time, on PayPal Orders v2
    fund      : create an AUTHORIZE order the client approves     (client)
    authorize : place the hold once approved                      (client)
    release   : capture the hold, all or part — client releases early/anyway   (client; the verifier calls flow.release)
    refund    : void the hold after a failed verdict              (client)
    payout    : retry paying the freelancer (e.g. once they've added a PayPal email)   (either party)
    ============================================================================ */

import { config } from '../config.js'
import * as paypal from '../lib/paypal.js'
import { db, audit } from '../lib/supabase.js'
import { requireUser, milestoneFor } from '../lib/auth.js'
import { release, refund, payout } from '../lib/flow.js'
import { money } from '../lib/money.js'

export default async function escrowRoutes(app) {
  app.addHook('preHandler', requireUser)

  app.post('/milestones/:id/fund', async (request, reply) => {
    const m = await milestoneFor(request, reply, { role: 'client' })
    if (!m) return
    if (m.status !== 'awaiting_funding') return reply.code(409).send({ error: m.status === 'draft' ? 'Sign the terms and finish earlier milestones first' : `Milestone is ${m.status}` })

    // one hold for the work and its expense budget; what the budget doesn't spend is never charged
    const budget = m.expense_budget_cents || 0
    const order = await paypal.createAuthorizeOrder({
      amountCents: m.amount_cents + budget,
      currency: m.contract.currency,
      referenceId: m.id,
      description: `${m.contract.title} — M${m.position} ${m.title}${budget ? ` + up to ${money(budget, m.contract.currency)} expenses` : ''}`,
      requestId: `fund-${m.id}-${Date.now()}`,
      returnUrl: `${config.appUrl}/contracts/${m.contract.id}?paypal=approved&milestone=${m.id}`,
      cancelUrl: `${config.appUrl}/contracts/${m.contract.id}?paypal=cancelled&milestone=${m.id}`,
    })
    await db().from('milestones').update({ paypal_order_id: order.id }).eq('id', m.id)
    await audit({ contractId: m.contract.id, milestoneId: m.id, actor: 'client', event: 'escrow.order_created', payload: { orderId: order.id } })
    return { orderId: order.id, approveUrl: paypal.approveLink(order) }
  })

  app.post('/milestones/:id/authorize', async (request, reply) => {
    const m = await milestoneFor(request, reply, { role: 'client' })
    if (!m) return
    if (!m.paypal_order_id) return reply.code(409).send({ error: 'Fund the milestone first' })
    if (m.status === 'funded') return { status: 'funded', authorizationId: m.paypal_authorization_id }

    const { authorization } = await paypal.authorizeOrder(m.paypal_order_id, { requestId: `auth-${m.paypal_order_id}` })
    if (authorization?.status !== 'CREATED') return reply.code(402).send({ error: `PayPal authorization ${authorization?.status || 'missing'}` })

    const now = new Date().toISOString()
    await db().from('milestones')
      .update({
        status: 'funded', paypal_authorization_id: authorization.id, funded_at: now,
        authorized_at: now, hold_expires_at: authorization.expiration_time || null,
      })
      .eq('id', m.id)
    await audit({
      contractId: m.contract.id, milestoneId: m.id, actor: 'paypal', event: 'escrow.funds_held',
      payload: { authorizationId: authorization.id, amountCents: m.amount_cents + (m.expense_budget_cents || 0), expenseBudgetCents: m.expense_budget_cents || undefined, expiresAt: authorization.expiration_time },
    })
    return { status: 'funded', authorizationId: authorization.id }
  })

  app.post('/milestones/:id/release', async (request, reply) => {
    const m = await milestoneFor(request, reply, { role: 'client' })
    if (!m) return
    if (!m.paypal_authorization_id || ['released', 'refunded'].includes(m.status)) return reply.code(409).send({ error: `Milestone is ${m.status}` })
    const amountCents = request.body?.amountCents == null ? undefined : Math.round(Number(request.body.amountCents))
    // check by check, part of the hold may already be released: what's left is what can go now
    const left = m.amount_cents - (m.released_cents || 0)
    if (amountCents !== undefined && !(amountCents >= 100 && amountCents <= left)) {
      return reply.code(400).send({ error: 'Release between $1.00 and what is still held' })
    }
    const capture = await release({ ...m, contract_id: m.contract.id }, 'client', { amountCents })
    return { status: 'released', captureId: capture.id }
  })

  app.post('/milestones/:id/payout', async (request, reply) => {
    const m = await milestoneFor(request, reply)
    if (!m) return
    if (m.status !== 'released') return reply.code(409).send({ error: 'Only a released milestone can be paid out' })
    return payout(m.id)
  })

  app.post('/milestones/:id/refund', async (request, reply) => {
    const m = await milestoneFor(request, reply, { role: 'client' })
    if (!m) return
    if (m.status !== 'failed') return reply.code(409).send({ error: 'Refunds need a failed verdict' })
    await refund({ ...m, contract_id: m.contract.id }, 'client')
    return { status: 'refunded' }
  })
}
