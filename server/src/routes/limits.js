/*  ============================================================================
    Spending limits — one PayPal hold the person approves once; their agent hires within it
    GET  /spend-limits                    the open limit (with what's captured, earmarked and left) and past ones
    POST /spend-limits                    set one up: creates the PayPal AUTHORIZE order for the whole limit
    POST /spend-limits/:id/authorize      place the hold once the person approved it on PayPal
    POST /spend-limits/:id/end            no new holds; closes and voids the rest once its jobs settle
    POST /milestones/:id/fund-from-limit  hold a milestone from the limit — no PayPal approval (client or their agent)
    ============================================================================ */

import { config } from '../config.js'
import * as paypal from '../lib/paypal.js'
import { db } from '../lib/supabase.js'
import { requireUser, milestoneFor } from '../lib/auth.js'
import { money } from '../lib/money.js'
import { openLimit, usage, view, fundFromLimit, endLimit } from '../lib/limits.js'

const MAX_CENTS = 2_500_000   // $25,000: a limit is for an agent's errands, not a payroll
const MAX_DAYS = 28           // PayPal keeps an authorization valid for 29 days

export default async function limitRoutes(app) {
  app.addHook('preHandler', requireUser)

  app.get('/spend-limits', async (request) => {
    const { data } = await db().from('spend_limits').select('*').eq('client_id', request.user.id).order('created_at', { ascending: false }).limit(10)
    const open = (data || []).find((l) => ['awaiting_approval', 'active', 'closing'].includes(l.status))
    return {
      current: open ? view(open, await usage(open)) : null,
      past: await Promise.all((data || []).filter((l) => l !== open).slice(0, 5).map(async (l) => view(l, await usage(l)))),
    }
  })

  app.post('/spend-limits', async (request, reply) => {
    if (request.user.viaToken) return reply.code(403).send({ error: 'Only the person can set a spending limit, in the Verdikt app — an agent can’t give itself money' })
    const b = request.body || {}
    const cap = Math.round(Number(b.capCents))
    const perJob = Math.round(Number(b.perJobCents || b.capCents))
    const days = Math.round(Number(b.days || 14))
    const currency = /^[A-Z]{3}$/.test(b.currency || '') ? b.currency : 'USD'
    if (!(cap >= 100 && cap <= MAX_CENTS)) return reply.code(400).send({ error: `Set a limit between ${money(100)} and ${money(MAX_CENTS)}` })
    if (!(perJob >= 100 && perJob <= cap)) return reply.code(400).send({ error: 'The most for one job has to fit inside the limit' })
    if (!(days >= 1 && days <= MAX_DAYS)) return reply.code(400).send({ error: `A limit lasts 1 to ${MAX_DAYS} days — PayPal keeps a hold for 29` })

    // one open limit at a time: an unapproved one is simply replaced
    const existing = await openLimit(request.user.id)
    if (existing?.status === 'awaiting_approval') await endLimit(existing)
    else if (existing) return reply.code(409).send({ error: 'You already have a spending limit. End it before setting a new one.' })

    const endsAt = new Date(Date.now() + days * 864e5).toISOString()
    const { data: l, error } = await db().from('spend_limits').insert({
      client_id: request.user.id, cap_cents: cap, per_job_cents: perJob, currency, ends_at: endsAt, note: String(b.note || '').trim().slice(0, 280),
    }).select('*').single()
    if (error) throw error
    const order = await paypal.createAuthorizeOrder({
      amountCents: cap, currency, referenceId: `limit-${l.id}`,
      description: `Verdikt spending limit for your AI agent — up to ${money(cap, currency)}, charged only for work that passes its checks`,
      requestId: `limit-${l.id}`,
      returnUrl: `${config.appUrl}/settings?limit=approved`,
      cancelUrl: `${config.appUrl}/settings?limit=cancelled`,
    })
    await db().from('spend_limits').update({ paypal_order_id: order.id }).eq('id', l.id)
    return { id: l.id, orderId: order.id, approveUrl: paypal.approveLink(order) }
  })

  app.post('/spend-limits/:id/authorize', async (request, reply) => {
    const { data: l } = await db().from('spend_limits').select('*').eq('id', request.params.id).eq('client_id', request.user.id).maybeSingle()
    if (!l) return reply.code(404).send({ error: 'Spending limit not found' })
    if (l.status === 'active') return view(l, await usage(l))
    if (l.status !== 'awaiting_approval' || !l.paypal_order_id) return reply.code(409).send({ error: 'This spending limit has ended' })
    const { authorization } = await paypal.authorizeOrder(l.paypal_order_id, { requestId: `limit-auth-${l.paypal_order_id}` })
    if (authorization?.status !== 'CREATED') return reply.code(402).send({ error: `PayPal authorization ${authorization?.status || 'missing'}` })
    // the limit can't outlive PayPal's hold
    const lapses = authorization.expiration_time && new Date(authorization.expiration_time).getTime()
    const endsAt = lapses && lapses < new Date(l.ends_at).getTime() ? new Date(lapses - 864e5).toISOString() : l.ends_at
    const { data: active } = await db().from('spend_limits').update({
      status: 'active', paypal_authorization_id: authorization.id, authorized_at: new Date().toISOString(),
      hold_expires_at: authorization.expiration_time || null, ends_at: endsAt,
    }).eq('id', l.id).select('*').single()
    return view(active, await usage(active))
  })

  app.post('/spend-limits/:id/end', async (request, reply) => {
    if (request.user.viaToken) return reply.code(403).send({ error: 'Only the person can end a spending limit' })
    const { data: l } = await db().from('spend_limits').select('*').eq('id', request.params.id).eq('client_id', request.user.id).maybeSingle()
    if (!l) return reply.code(404).send({ error: 'Spending limit not found' })
    if (l.status === 'closed') return view(l)
    await endLimit(l, 'Ended by you')
    const { data: now } = await db().from('spend_limits').select('*').eq('id', l.id).single()
    return view(now, await usage(now))
  })

  app.post('/milestones/:id/fund-from-limit', async (request, reply) => {
    const m = await milestoneFor(request, reply, { role: 'client' })
    if (!m) return
    if (m.status !== 'awaiting_funding') return reply.code(409).send({ error: m.status === 'draft' ? 'Sign the terms and finish earlier milestones first' : `Milestone is ${m.status}` })
    try {
      return await fundFromLimit(m, { viaAgent: !!request.user.viaToken })
    } catch (e) {
      return reply.code(e.statusCode || 500).send({ error: e.message })
    }
  })
}
