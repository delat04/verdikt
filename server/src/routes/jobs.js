/*  ============================================================================
    Jobs — where a contract starts when the two sides haven't met yet. People and their agents (over MCP)
    use the same routes.
    · POST /jobs                       post a job (you become the client)
    · GET  /jobs                       open jobs, your posts with their applications (reviewed), your applications
    · POST /jobs/:id/apply             a price, a timeline and a pitch; reviewed for the poster in the background
    · POST /applications/:id/hire      the poster hires: a contract room opens with both of them, the job brief and
                                       the accepted proposal; the mediator drafts terms from there
    · POST /applications/:id/decline | /withdraw,  POST /jobs/:id/close
    · POST /price-check                a fair price and an online cost plan, from live web prices (cached)
    · POST /opportunities/scout        public posts elsewhere that fit a freelancer, each with a drafted pitch
    ============================================================================ */

import { db, audit } from '../lib/supabase.js'
import { requireUser } from '../lib/auth.js'
import { say } from '../lib/room.js'
import { emptyTerms, mediateSoon } from '../agent/mediator.js'
import { priceCheck, reviewApplication, scout } from '../agent/market.js'
import { money } from '../lib/money.js'

const recent = new Map()
function allow(key, max, windowMs) {
  const now = Date.now()
  const list = (recent.get(key) || []).filter((t) => now - t < windowMs)
  if (list.length >= max) return false
  list.push(now)
  recent.set(key, list)
  return true
}
const cleanSkills = (list) => [...new Set((Array.isArray(list) ? list : String(list || '').split(','))
  .map((s) => String(s).trim().slice(0, 30)).filter(Boolean))].slice(0, 8)

const JOB_SELECT = '*, client:profiles!jobs_client_id_fkey(id, display_name), job_applications(id, freelancer_id, status)'
const viewJob = (j, me) => ({
  id: j.id, title: j.title, brief: j.brief, currency: j.currency, status: j.status, skills: j.skills,
  budgetMinCents: j.budget_min_cents, budgetMaxCents: j.budget_max_cents, dueDays: j.due_days, viaAgent: j.via_agent,
  client: j.client && { id: j.client.id, name: j.client.display_name }, mine: j.client_id === me,
  applications: (j.job_applications || []).filter((a) => a.status !== 'withdrawn').length,
  applied: (j.job_applications || []).find((a) => a.freelancer_id === me)?.status || null,
  priceCheck: j.price_check || null, contractId: j.contract_id, createdAt: j.created_at,
})
const viewApplication = (a) => ({
  id: a.id, jobId: a.job_id, status: a.status, pitch: a.pitch, priceCents: a.price_cents, days: a.days, viaAgent: a.via_agent,
  freelancer: a.freelancer && { id: a.freelancer.id, name: a.freelancer.display_name, headline: a.freelancer.headline || '', handle: a.freelancer.public_proof ? a.freelancer.handle : null },
  review: a.review?.at ? a.review : null, createdAt: a.created_at, decidedAt: a.decided_at,
})

export default async function jobRoutes(app) {
  app.addHook('preHandler', requireUser)

  // ---- post
  app.post('/jobs', async (request, reply) => {
    const b = request.body || {}
    const title = String(b.title || '').trim()
    const brief = String(b.brief || '').trim()
    if (title.length < 4) return reply.code(400).send({ error: 'Give the job a title' })
    if (brief.length < 30) return reply.code(400).send({ error: 'Describe the job in at least 30 characters' })
    const min = b.budgetMinCents == null || b.budgetMinCents === '' ? null : Math.round(Number(b.budgetMinCents))
    const max = b.budgetMaxCents == null || b.budgetMaxCents === '' ? null : Math.round(Number(b.budgetMaxCents))
    if ((min != null && !(min >= 100)) || (max != null && !(max >= 100)) || (min != null && max != null && min > max)) {
      return reply.code(400).send({ error: 'The budget is a range of at least $1.00, low to high' })
    }
    const due = b.dueDays == null || b.dueDays === '' ? null : Math.round(Number(b.dueDays))
    if (due != null && !(due >= 1 && due <= 365)) return reply.code(400).send({ error: 'Wanted in 1 to 365 days' })
    if (!allow(`post-${request.user.id}`, 10, 864e5)) return reply.code(429).send({ error: 'Ten job posts a day — try again tomorrow' })
    const { data: j, error } = await db().from('jobs').insert({
      client_id: request.user.id, title: title.slice(0, 120), brief: brief.slice(0, 4000), currency: b.currency || 'USD',
      budget_min_cents: min, budget_max_cents: max, due_days: due, skills: cleanSkills(b.skills), via_agent: !!request.user.viaToken,
      price_check: b.priceCheck && typeof b.priceCheck === 'object' ? b.priceCheck : null,
    }).select().single()
    if (error) throw error
    return { id: j.id }
  })

  // ---- browse: open jobs (not yours), your posts with every application reviewed, and where you applied
  app.get('/jobs', async (request) => {
    const me = request.user.id
    const q = String(request.query?.q || '').trim().toLowerCase()
    const [{ data: open }, { data: mine }, { data: applied }] = await Promise.all([
      db().from('jobs').select(JOB_SELECT).eq('status', 'open').neq('client_id', me).order('created_at', { ascending: false }).limit(60),
      db().from('jobs').select(JOB_SELECT).eq('client_id', me).order('created_at', { ascending: false }).limit(30),
      db().from('job_applications').select('*, job:jobs(id, title, status, currency, contract_id, client:profiles!jobs_client_id_fkey(display_name))').eq('freelancer_id', me).order('created_at', { ascending: false }).limit(30),
    ])
    const match = (j) => !q || `${j.title} ${j.brief} ${(j.skills || []).join(' ')}`.toLowerCase().includes(q)
    const ids = (mine || []).map((j) => j.id)
    const { data: apps } = ids.length
      ? await db().from('job_applications').select('*, freelancer:profiles!job_applications_freelancer_id_fkey(id, display_name, headline, handle, public_proof)').in('job_id', ids).neq('status', 'withdrawn')
      : { data: [] }
    return {
      open: (open || []).filter(match).map((j) => viewJob(j, me)),
      posted: (mine || []).map((j) => ({
        ...viewJob(j, me),
        candidates: (apps || []).filter((a) => a.job_id === j.id).map(viewApplication)
          .sort((x, y) => (y.status === 'accepted') - (x.status === 'accepted') || (y.review?.fit ?? -1) - (x.review?.fit ?? -1)),
      })),
      applied: (applied || []).map((a) => ({ ...viewApplication(a), job: a.job && { id: a.job.id, title: a.job.title, status: a.job.status, currency: a.job.currency, client: a.job.client?.display_name, contractId: a.status === 'accepted' ? a.job.contract_id : null } })),
    }
  })

  // ---- apply
  app.post('/jobs/:id/apply', async (request, reply) => {
    const { data: j } = await db().from('jobs').select('*').eq('id', request.params.id).maybeSingle()
    if (!j || j.status !== 'open') return reply.code(404).send({ error: 'This job is no longer open' })
    if (j.client_id === request.user.id) return reply.code(409).send({ error: "You can't apply to your own job" })
    const pitch = String(request.body?.pitch || '').trim()
    const price = Math.round(Number(request.body?.priceCents))
    const days = request.body?.days == null || request.body.days === '' ? null : Math.round(Number(request.body.days))
    if (pitch.length < 40) return reply.code(400).send({ error: 'Say in at least 40 characters how you would do it' })
    if (!(price >= 100)) return reply.code(400).send({ error: 'Your price needs to be at least $1.00' })
    if (days != null && !(days >= 1 && days <= 365)) return reply.code(400).send({ error: 'Days to deliver: 1 to 365' })
    if (!allow(`apply-${request.user.id}`, 30, 864e5)) return reply.code(429).send({ error: 'Thirty applications a day — try again tomorrow' })
    const { data: a, error } = await db().from('job_applications').upsert({
      job_id: j.id, freelancer_id: request.user.id, pitch: pitch.slice(0, 3000), price_cents: price, days,
      via_agent: !!request.user.viaToken, status: 'pending', review: {}, created_at: new Date().toISOString(),
    }, { onConflict: 'job_id,freelancer_id' }).select().single()
    if (error) throw error
    // the poster sees it reviewed; the applicant doesn't wait for that
    reviewApplication(a.id).catch((e) => console.error('review failed', e.message))
    return { id: a.id, status: 'pending', next: 'The client sees your application with a review. If they hire you, a contract room opens with both of you in it.' }
  })

  async function applicationFor(request, reply, who) {
    const { data: a } = await db().from('job_applications')
      .select('*, job:jobs(*), freelancer:profiles!job_applications_freelancer_id_fkey(id, display_name)').eq('id', request.params.id).maybeSingle()
    if (!a) { reply.code(404).send({ error: 'Application not found' }); return null }
    const ok = who === 'client' ? a.job.client_id === request.user.id : a.freelancer_id === request.user.id
    if (!ok) { reply.code(403).send({ error: who === 'client' ? 'Only the person who posted the job can do this' : 'Only the applicant can do this' }); return null }
    return a
  }

  // ---- hire: a contract room with both of them, seeded with the job and the accepted proposal
  app.post('/applications/:id/hire', async (request, reply) => {
    const a = await applicationFor(request, reply, 'client')
    if (!a) return
    const j = a.job
    if (j.status !== 'open' || a.status !== 'pending') return reply.code(409).send({ error: 'This job or application is already settled' })
    const { data: c, error } = await db().from('contracts').insert({
      title: j.title, brief: j.brief, currency: j.currency, created_by: j.client_id, status: 'scoping', terms: emptyTerms(),
      client_id: j.client_id, freelancer_id: a.freelancer_id,
    }).select().single()
    if (error) throw error
    const { data: p } = await db().from('profiles').select('display_name').eq('id', j.client_id).single()
    const due = j.due_days ? ` Wanted in ${j.due_days} days.` : ''
    const budget = j.budget_min_cents || j.budget_max_cents ? ` Budget ${j.budget_min_cents ? money(j.budget_min_cents, j.currency) : ''}${j.budget_min_cents && j.budget_max_cents ? '–' : ''}${j.budget_max_cents ? money(j.budget_max_cents, j.currency) : ''}.` : ''
    await say(c.id, 'client', `${j.brief}${budget}${due}`, { via_agent: !!request.user.viaToken })
    await say(c.id, 'freelancer', `${a.pitch}\n\nMy price: ${money(a.price_cents, j.currency)}${a.days ? `, delivered in ${a.days} days` : ''}.`, { via_agent: a.via_agent })
    await say(c.id, 'system', `${p?.display_name || 'The client'} hired ${a.freelancer?.display_name || 'the freelancer'} from the job post. The mediator is drafting terms from the brief and the accepted proposal.`)
    const now = new Date().toISOString()
    await db().from('job_applications').update({ status: 'accepted', decided_at: now }).eq('id', a.id)
    await db().from('job_applications').update({ status: 'declined', decided_at: now }).eq('job_id', j.id).eq('status', 'pending')
    await db().from('jobs').update({ status: 'hired', contract_id: c.id }).eq('id', j.id)
    await audit({ contractId: c.id, actor: 'client', event: 'job.hired', payload: { jobId: j.id, name: a.freelancer?.display_name, priceCents: a.price_cents, days: a.days, viaAgent: !!request.user.viaToken } })
    mediateSoon(c.id)
    return { contractId: c.id, next: 'Both of you are in the contract room. The mediator drafts terms from the brief and the accepted price; accept the same version to lock them.' }
  })

  app.post('/applications/:id/decline', async (request, reply) => {
    const a = await applicationFor(request, reply, 'client')
    if (!a) return
    if (a.status !== 'pending') return reply.code(409).send({ error: 'Already settled' })
    await db().from('job_applications').update({ status: 'declined', decided_at: new Date().toISOString() }).eq('id', a.id)
    return { status: 'declined' }
  })

  app.post('/applications/:id/withdraw', async (request, reply) => {
    const a = await applicationFor(request, reply, 'freelancer')
    if (!a) return
    if (a.status !== 'pending') return reply.code(409).send({ error: 'Already settled' })
    await db().from('job_applications').update({ status: 'withdrawn', decided_at: new Date().toISOString() }).eq('id', a.id)
    return { status: 'withdrawn' }
  })

  app.post('/jobs/:id/close', async (request, reply) => {
    const { data: j } = await db().from('jobs').select('id, client_id, status').eq('id', request.params.id).maybeSingle()
    if (!j || j.client_id !== request.user.id) return reply.code(404).send({ error: 'Job not found' })
    if (j.status !== 'open') return reply.code(409).send({ error: 'This job is already settled' })
    await db().from('jobs').update({ status: 'closed' }).eq('id', j.id)
    await db().from('job_applications').update({ status: 'declined', decided_at: new Date().toISOString() }).eq('job_id', j.id).eq('status', 'pending')
    return { status: 'closed' }
  })

  // ---- a fair price and what the project costs online
  app.post('/price-check', async (request, reply) => {
    const title = String(request.body?.title || '').trim()
    const brief = String(request.body?.brief || '').trim()
    if (title.length < 4 || brief.length < 30) return reply.code(400).send({ error: 'A title and a brief of at least 30 characters' })
    if (!allow(`price-${request.user.id}`, 12, 3600e3)) return reply.code(429).send({ error: 'Twelve price checks an hour — try again later' })
    try {
      return await priceCheck({ title, brief, currency: request.body?.currency || 'USD' })
    } catch (e) {
      console.error('price check failed', e)
      return reply.code(502).send({ error: `The price check couldn't finish (${e.message})` })
    }
  })

  // ---- work outside Verdikt
  app.post('/opportunities/scout', async (request, reply) => {
    const skills = String(request.body?.skills || '').trim()
    if (skills.length < 3) return reply.code(400).send({ error: 'Say what you do — skills, stack, the kind of work' })
    if (!allow(`scout-${request.user.id}`, 4, 864e5)) return reply.code(429).send({ error: 'Four searches a day — try again tomorrow' })
    try {
      return await scout({ skills })
    } catch (e) {
      console.error('scout failed', e)
      return reply.code(502).send({ error: `The search couldn't finish (${e.message})` })
    }
  })
}
