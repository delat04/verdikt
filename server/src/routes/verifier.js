/*  ============================================================================
    Working with the verifier before and around a delivery:
    · GET  /milestones/:id/checks        the signed checks as a test suite: each one's compiled probes
    · POST /milestones/:id/precheck      freelancer: a dry run of every deterministic probe against a URL —
                                         no verdict, no money, no tokens; the result lands in the thread
    · POST /milestones/:id/verifier/ask  either side: a question about the checks, answered in the thread
    The same routes back the MCP tools, so a freelancer's coding agent can loop build → pre-check → fix
    → submit on its own.
    ============================================================================ */

import { db } from '../lib/supabase.js'
import { requireUser, milestoneFor } from '../lib/auth.js'
import { ensureSpecs } from '../agent/compile.js'
import { runProbes } from '../agent/engine.js'
import { PROBES, hardness, explain } from '../agent/probes.js'
import { askVerifier } from '../agent/explain.js'

const isUrl = (v) => /^https:\/\/[^\s/.]+\.[^\s]+/i.test(String(v || '').trim())
const SETTLED = ['released', 'refunded']

// pre-checks run a browser: one at a time per milestone, and a budget per hour
const busy = new Set()
const recent = new Map()   // key → timestamps
function allow(key, perHour) {
  const now = Date.now()
  const list = (recent.get(key) || []).filter((t) => now - t < 3600e3)
  if (list.length >= perHour) return false
  list.push(now)
  recent.set(key, list)
  return true
}

const post = (m, request, row) => db().from('verifier_thread').insert({
  milestone_id: m.id, contract_id: m.contract.id, via_agent: row.author !== 'verifier' && !!request.user.viaToken, ...row,
})

export default async function verifierRoutes(app) {
  app.addHook('preHandler', requireUser)

  app.get('/milestones/:id/checks', async (request, reply) => {
    const m = await milestoneFor(request, reply)
    if (!m) return
    const { data: criteria } = await db().from('criteria').select('*').eq('milestone_id', m.id).order('position')
    const specs = await ensureSpecs(m.contract, criteria || [])
    return {
      milestone: { id: m.id, position: m.position, title: m.title, status: m.status, amountCents: m.amount_cents },
      checks: (criteria || []).map((c) => {
        const spec = specs.get(c.id)
        return {
          id: c.id, position: c.position, kind: c.kind, statement: c.statement, method: c.method,
          decidedBy: spec.probes.length ? (spec.sufficient ? 'probes' : 'probes, then the model') : 'the model',
          probes: spec.probes.map((p) => ({ ...p, label: PROBES[p.type].label(p), hard: !!hardness(p, c) })),
        }
      }),
    }
  })

  app.post('/milestones/:id/precheck', async (request, reply) => {
    const m = await milestoneFor(request, reply, { role: 'freelancer' })
    if (!m) return
    if (SETTLED.includes(m.status)) return reply.code(409).send({ error: 'This milestone is already settled' })
    if (['submitted', 'verifying'].includes(m.status)) return reply.code(409).send({ error: 'The verifier is checking a delivery right now' })
    const { liveUrl, repoUrl = '' } = request.body || {}
    if (!isUrl(liveUrl)) return reply.code(400).send({ error: 'The live URL must be a public https:// address' })
    if (repoUrl && !/^https:\/\/github\.com\/[^/\s]+\/[^/\s]+/i.test(repoUrl)) return reply.code(400).send({ error: 'The repository must be a public GitHub URL' })
    if (busy.has(m.id)) return reply.code(409).send({ error: 'A pre-check is already running for this milestone' })
    if (!allow(`pre:${m.id}`, 12)) return reply.code(429).send({ error: 'That’s 12 pre-checks this hour — try again later' })

    busy.add(m.id)
    try {
      const { data: criteria } = await db().from('criteria').select('*').eq('milestone_id', m.id).order('position')
      const { evals, flags, ms } = await runProbes({ contract: m.contract, criteria, liveUrl: liveUrl.trim(), repoUrl: repoUrl.trim() || null })
      const checks = criteria.map((c) => {
        const e = evals.get(c.id)
        const status = e.status === 'pass' || e.status === 'fail' ? e.status : 'judge'
        const failing = e.probes.find((p) => p.status === 'fail')
        return {
          id: c.id, position: c.position, kind: c.kind, statement: c.statement, status, by: e.layer || null,
          explanation: status === 'judge' ? null : explain(e),
          fix: e.fix || null,
          probes: e.probes.map(({ wantsOcr, ...p }) => p),
          observed: failing?.observed || null,
        }
      })
      const counts = { pass: 0, fail: 0, judge: 0 }
      for (const c of checks) counts[c.status] += 1
      const integrity = flags.concealed.length ? { quotes: flags.concealed.slice(0, 3).map((h) => h.quote) } : null
      const result = { ready: counts.fail === 0 && !integrity, counts, checks, integrity, ms: ms.total, liveUrl, repoUrl, at: new Date().toISOString() }

      const host = new URL(liveUrl).host
      await post(m, request, {
        author: 'freelancer', kind: 'precheck',
        body: `Pre-checked ${host}: ${counts.pass} met · ${counts.fail} not met · ${counts.judge} left for the verifier to judge${integrity ? ' · hidden text that addresses the verifier' : ''}.`,
        data: { counts, liveUrl, repoUrl, ms: ms.total, integrity: !!integrity, checks: checks.map((c) => ({ id: c.id, status: c.status, observed: c.observed, fix: c.fix })) },
      })
      return result
    } finally {
      busy.delete(m.id)
    }
  })

  app.post('/milestones/:id/verifier/ask', async (request, reply) => {
    const m = await milestoneFor(request, reply)
    if (!m) return
    const question = String(request.body?.question || '').trim()
    if (question.length < 4) return reply.code(400).send({ error: 'Ask a question about the checks' })
    if (!allow(`ask:${m.id}`, 30)) return reply.code(429).send({ error: 'That’s 30 questions this hour — try again later' })
    await post(m, request, { author: m.role, kind: 'question', body: question.slice(0, 800) })
    let answer
    try {
      answer = await askVerifier(m, m.role, question.slice(0, 800))
    } catch (e) {
      request.log.error(e)
      await post(m, request, { author: 'verifier', kind: 'answer', body: 'The verifier couldn’t answer just now. Try again in a minute.', data: { error: true } })
      return reply.code(502).send({ error: 'The verifier couldn’t answer just now' })
    }
    await post(m, request, { author: 'verifier', kind: 'answer', body: answer.answer, data: { checks: answer.checks, nextSteps: answer.nextSteps } })
    return answer
  })
}
