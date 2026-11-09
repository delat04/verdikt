/*  ============================================================================
    Portfolio — past projects a freelancer lists, each checked live by Verdikt's probes:
      GET    /portfolio             your projects, with their last check
      POST   /portfolio             add one (title, what you built, live URL, optional GitHub repo)
      DELETE /portfolio/:id         remove one (the person only)
      POST   /portfolio/:id/check   open it now and run the portfolio checks (no model, no tokens)
    Projects show on the public proof page beside the paid work, and application reviews read them.
    ============================================================================ */

import { db } from '../lib/supabase.js'
import { requireUser } from '../lib/auth.js'
import { checkPortfolio } from '../agent/portfolio.js'

const MAX = 12
const isUrl = (v) => /^https:\/\/[^\s/.]+\.[^\s]+/i.test(String(v || '').trim())
const isRepo = (v) => /^https:\/\/github\.com\/[^/\s]+\/[^/\s]+/i.test(String(v || '').trim())

export const portfolioItem = (i) => ({
  id: i.id, title: i.title, summary: i.summary, liveUrl: i.live_url, repoUrl: i.repo_url || '',
  position: i.position, check: i.check_result || null, checkedAt: i.checked_at,
})

// a check drives a browser: one at a time per person, and a budget per hour
const busy = new Set()
const recent = new Map()
function allow(key, perHour) {
  const now = Date.now()
  const list = (recent.get(key) || []).filter((t) => now - t < 3600e3)
  if (list.length >= perHour) return false
  list.push(now)
  recent.set(key, list)
  return true
}

export default async function portfolioRoutes(app) {
  app.addHook('preHandler', requireUser)

  app.get('/portfolio', async (request) => {
    const { data } = await db().from('portfolio_items').select('*').eq('freelancer_id', request.user.id).order('position').order('created_at')
    return { items: (data || []).map(portfolioItem) }
  })

  app.post('/portfolio', async (request, reply) => {
    const title = String(request.body?.title || '').trim().slice(0, 80)
    const summary = String(request.body?.summary || '').trim().slice(0, 400)
    const liveUrl = String(request.body?.liveUrl || '').trim()
    const repoUrl = String(request.body?.repoUrl || '').trim()
    if (title.length < 2) return reply.code(400).send({ error: 'Give the project a name' })
    if (!isUrl(liveUrl)) return reply.code(400).send({ error: 'The live site must be a public https:// address' })
    if (repoUrl && !isRepo(repoUrl)) return reply.code(400).send({ error: 'The repository must be a public GitHub URL' })
    const { count } = await db().from('portfolio_items').select('id', { count: 'exact', head: true }).eq('freelancer_id', request.user.id)
    if ((count || 0) >= MAX) return reply.code(409).send({ error: `A portfolio holds up to ${MAX} projects — remove one first` })
    const { data, error } = await db().from('portfolio_items')
      .insert({ freelancer_id: request.user.id, title, summary, live_url: liveUrl, repo_url: repoUrl || null, position: count || 0 })
      .select('*').single()
    if (error) return reply.code(400).send({ error: error.message })
    return portfolioItem(data)
  })

  app.delete('/portfolio/:id', async (request, reply) => {
    if (request.user.viaToken) return reply.code(403).send({ error: 'Only you can remove a project from your portfolio' })
    const { data } = await db().from('portfolio_items').delete().eq('id', request.params.id).eq('freelancer_id', request.user.id).select('id')
    if (!data?.length) return reply.code(404).send({ error: 'Project not found' })
    return { ok: true }
  })

  app.post('/portfolio/:id/check', async (request, reply) => {
    const { data: item } = await db().from('portfolio_items').select('*').eq('id', request.params.id).eq('freelancer_id', request.user.id).maybeSingle()
    if (!item) return reply.code(404).send({ error: 'Project not found' })
    if (busy.has(request.user.id)) return reply.code(409).send({ error: 'A portfolio check is already running' })
    if (!allow(`portfolio:${request.user.id}`, 10)) return reply.code(429).send({ error: 'That’s 10 portfolio checks this hour — try again later' })
    busy.add(request.user.id)
    try {
      const result = await checkPortfolio({ liveUrl: item.live_url, repoUrl: item.repo_url })
      const { data } = await db().from('portfolio_items').update({ check_result: result, checked_at: result.at }).eq('id', item.id).select('*').single()
      return portfolioItem(data)
    } finally {
      busy.delete(request.user.id)
    }
  })
}
