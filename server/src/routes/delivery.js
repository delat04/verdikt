/*  ============================================================================
    Delivery — the freelancer submits; the verifier starts at once.
    Appeals — either party can contest a failed verdict: a second reviewer re-checks the failed checks
    and recommends release, a partial release, or upholding it. Releasing still takes the client's click.
    ============================================================================ */

import { db, audit } from '../lib/supabase.js'
import { requireUser, milestoneFor } from '../lib/auth.js'
import { verifyInBackground } from '../agent/verify.js'
import { reviewAppealInBackground } from '../agent/appeal.js'
import { release } from '../lib/flow.js'

const isUrl = (v) => /^https:\/\/[^\s/.]+\.[^\s]+/i.test(String(v || '').trim())

export default async function deliveryRoutes(app) {
  app.addHook('preHandler', requireUser)

  app.post('/milestones/:id/submit', async (request, reply) => {
    const m = await milestoneFor(request, reply, { role: 'freelancer' })
    if (!m) return
    if (!['funded', 'failed'].includes(m.status)) return reply.code(409).send({ error: 'This milestone is not waiting for a delivery' })

    const { liveUrl, repoUrl = '', notes = '' } = request.body || {}
    if (!isUrl(liveUrl)) return reply.code(400).send({ error: 'The live URL must be a public https:// address' })
    if (repoUrl && !/^https:\/\/github\.com\/[^/\s]+\/[^/\s]+/i.test(repoUrl)) return reply.code(400).send({ error: 'The repository must be a public GitHub URL' })

    const { count } = await db().from('submissions').select('id', { count: 'exact', head: true }).eq('milestone_id', m.id)
    const { data: sub, error } = await db().from('submissions').insert({
      milestone_id: m.id, submitted_by: request.user.id, attempt: (count || 0) + 1,
      live_url: liveUrl.trim(), repo_url: repoUrl.trim() || null, notes: notes.trim().slice(0, 2000),
    }).select().single()
    if (error) throw error

    await db().from('milestones').update({ status: 'submitted' }).eq('id', m.id)
    await audit({ contractId: m.contract.id, milestoneId: m.id, actor: 'freelancer', event: 'work.submitted', payload: { attempt: sub.attempt } })
    verifyInBackground(m.id, sub.id)
    return { submissionId: sub.id }
  })

  app.post('/milestones/:id/appeal', async (request, reply) => {
    const m = await milestoneFor(request, reply)
    if (!m) return
    if (m.status !== 'failed') return reply.code(409).send({ error: 'Only a failed verdict can be appealed' })
    const reason = String(request.body?.reason || '').trim()
    if (reason.length < 10) return reply.code(400).send({ error: 'Say what the agent got wrong' })
    const { data: sub } = await db().from('submissions').select('id').eq('milestone_id', m.id).order('attempt', { ascending: false }).limit(1).maybeSingle()
    const { data: appeal, error } = await db().from('appeals')
      .insert({ milestone_id: m.id, submission_id: sub?.id || null, filed_by: m.role, reason: reason.slice(0, 2000) })
      .select().single()
    if (error) throw error
    await db().from('milestones').update({ status: 'disputed' }).eq('id', m.id)
    await audit({ contractId: m.contract.id, milestoneId: m.id, actor: m.role, event: 'verdict.appealed', payload: { reason: reason.slice(0, 2000) } })
    reviewAppealInBackground(appeal.id)
    return { status: 'disputed', appealId: appeal.id }
  })

  // the client acts on the second review: release what it recommends, or keep the money held
  async function decidedAppeal(request, reply) {
    const { data: a } = await db().from('appeals').select('*').eq('id', request.params.id).maybeSingle()
    if (!a) { reply.code(404).send({ error: 'Appeal not found' }); return null }
    request.params.id = a.milestone_id
    const m = await milestoneFor(request, reply, { role: 'client' })
    if (!m) return null
    if (a.status !== 'decided' || m.status !== 'disputed') { reply.code(409).send({ error: 'This review has already been settled' }); return null }
    return { a, m }
  }

  app.post('/appeals/:id/accept', async (request, reply) => {
    const found = await decidedAppeal(request, reply)
    if (!found) return
    const { a, m } = found
    if (!['release', 'partial'].includes(a.recommendation)) return reply.code(409).send({ error: 'This review upheld the verdict' })
    await db().from('appeals').update({ status: 'accepted', closed_at: new Date().toISOString() }).eq('id', a.id)
    await audit({ contractId: m.contract.id, milestoneId: m.id, actor: 'client', event: 'appeal.accepted', payload: { releaseCents: a.release_cents } })
    // the review's figure is the milestone's total release; tranches already paid count toward it
    const capture = await release({ ...m, contract_id: m.contract.id }, 'client', { amountCents: Math.max(100, a.release_cents - (m.released_cents || 0)) })
    return { status: 'released', captureId: capture.id }
  })

  app.post('/appeals/:id/decline', async (request, reply) => {
    const found = await decidedAppeal(request, reply)
    if (!found) return
    const { a, m } = found
    await db().from('appeals').update({ status: 'declined', closed_at: new Date().toISOString() }).eq('id', a.id)
    await db().from('milestones').update({ status: 'failed' }).eq('id', m.id)
    await audit({ contractId: m.contract.id, milestoneId: m.id, actor: 'client', event: 'appeal.declined', payload: {} })
    return { status: 'failed' }
  })
}
