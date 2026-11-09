/*  ============================================================================
    Proof of work — a freelancer's public record built only from work an AI verifier checked and
    PayPal settled. Every number traces to a PayPal capture and a verdict, so it can't be padded.
    Beside it, the portfolio: past projects the freelancer listed, each with what Verdikt's probes
    measured when they opened it (the title and summary stay the freelancer's own words).
    Opt-in (Settings → Public proof page); clients stay anonymous and project titles stay private —
    only milestone titles, amounts, check results and masked PayPal capture ids are shown.
      GET  /api/proof/:handle     the page's data (public)
      GET  /badge/:handle.svg     an embeddable badge for a README or portfolio (public)
      PUT  /api/profile/proof     turn it on/off, choose the handle and headline (signed in)
    ============================================================================ */

import { db } from '../lib/supabase.js'
import { requireUser } from '../lib/auth.js'
import { money } from '../lib/money.js'

const HANDLE = /^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$/

async function proofOf(handle) {
  const { data: p } = await db().from('profiles').select('id, display_name, headline, handle, public_proof, created_at').eq('handle', handle).maybeSingle()
  if (!p?.public_proof) return null
  const { data: contracts } = await db().from('contracts')
    .select('id, client_id, status, milestones(id, title, amount_cents, released_cents, released_at, status, tranches, payout_cents, payout_status, paypal_capture_id, submissions(attempt, verdicts(outcome, created_at, criterion_results(passed))))')
    .eq('freelancer_id', p.id)
  const ms = (contracts || []).flatMap((c) => c.milestones.map((m) => ({ ...m, clientId: c.client_id })))
  const paid = ms.filter((m) => (m.released_cents || 0) > 0)
  const verdictsOf = (m) => m.submissions.flatMap((s) => s.verdicts.map((v) => ({ ...v, attempt: s.attempt })))
  const firstTry = paid.filter((m) => verdictsOf(m).some((v) => v.attempt === 1 && v.outcome === 'pass')).length
  const proofs = paid.sort((a, b) => (b.released_at || '').localeCompare(a.released_at || '')).slice(0, 12).map((m) => {
    const v = verdictsOf(m).sort((a, b) => b.created_at.localeCompare(a.created_at))[0]
    const results = v?.criterion_results || []
    const captures = m.tranches?.length || 1
    const capture = m.tranches?.at(-1)?.captureId || m.paypal_capture_id || ''
    return {
      title: m.title, releasedCents: m.released_cents, ofCents: m.amount_cents, releasedAt: m.released_at,
      checks: { passed: results.filter((r) => r.passed).length, total: results.length },
      captures, capture: capture ? `•••${capture.slice(-6)}` : '', paidOut: m.payout_status === 'SUCCESS',
      attempts: m.submissions.length,
    }
  })
  // past projects the freelancer listed, with what Verdikt measured when it opened them
  const { data: items } = await db().from('portfolio_items').select('title, summary, live_url, repo_url, check_result, checked_at').eq('freelancer_id', p.id).order('position').order('created_at')
  const portfolio = (items || []).map((i) => ({
    title: i.title, summary: i.summary, liveUrl: i.live_url, repoUrl: i.repo_url || '', host: new URL(i.live_url).host, checkedAt: i.checked_at,
    check: i.check_result && {
      counts: i.check_result.counts, total: i.check_result.total,
      checks: i.check_result.checks.map((c) => ({ statement: c.statement, status: c.status, explanation: c.explanation })),
    },
  }))
  return {
    name: p.display_name, headline: p.headline, handle: p.handle, since: p.created_at, portfolio,
    stats: {
      paidCents: paid.reduce((s, m) => s + m.released_cents, 0),
      milestones: paid.length,
      firstTryRate: paid.length ? firstTry / paid.length : null,
      clients: new Set(paid.map((m) => m.clientId)).size,
      checksPassed: paid.reduce((s, m) => s + (verdictsOf(m)[0]?.criterion_results?.filter((r) => r.passed).length || 0), 0),
      captures: paid.reduce((s, m) => s + (m.tranches?.length || 1), 0),
    },
    proofs,
  }
}

const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]))
function badge(left, right) {
  // flat badge; widths estimated from character count (Inter-ish metrics at 11px)
  const w = (t) => Math.round(t.length * 6.4 + 16)
  const lw = w(left)
  const rw = w(right)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${lw + rw}" height="22" role="img" aria-label="${esc(left)}: ${esc(right)}">
<title>${esc(left)}: ${esc(right)}</title>
<clipPath id="r"><rect width="${lw + rw}" height="22" rx="11"/></clipPath>
<g clip-path="url(#r)"><rect width="${lw}" height="22" fill="#0B1220"/><rect x="${lw}" width="${rw}" height="22" fill="#315EFB"/></g>
<g fill="#fff" font-family="Inter,Segoe UI,Helvetica,Arial,sans-serif" font-size="11" font-weight="400">
<text x="${lw / 2}" y="15" text-anchor="middle">${esc(left)}</text><text x="${lw + rw / 2}" y="15" text-anchor="middle">${esc(right)}</text></g></svg>`
}

export async function proofRoutes(app) {
  app.get('/api/proof/:handle', async (request, reply) => {
    const data = await proofOf(String(request.params.handle).toLowerCase())
    if (!data) return reply.code(404).send({ error: 'No public proof page here' })
    return data
  })

  app.get('/badge/:file', async (request, reply) => {
    const handle = String(request.params.file).replace(/\.svg$/, '').toLowerCase()
    const data = HANDLE.test(handle) ? await proofOf(handle) : null
    const right = data
      ? `${money(data.stats.paidCents).replace(/\.00$/, '')} paid on evidence · ${data.stats.milestones} milestone${data.stats.milestones === 1 ? '' : 's'}`
      : 'no public proof'
    return reply.header('content-type', 'image/svg+xml').header('cache-control', 'public, max-age=3600').send(badge('Verdikt', right))
  })
}

export default async function proofSettingsRoutes(app) {
  app.addHook('preHandler', requireUser)
  app.put('/profile/proof', async (request, reply) => {
    if (request.user.viaToken) return reply.code(403).send({ error: 'Only you can publish your proof page' })
    const handle = String(request.body?.handle || '').trim().toLowerCase()
    const headline = String(request.body?.headline || '').trim().slice(0, 120)
    const on = !!request.body?.publicProof
    if (!HANDLE.test(handle)) return reply.code(400).send({ error: 'Handle: 3–30 lowercase letters, numbers or dashes' })
    const { data: taken } = await db().from('profiles').select('id').eq('handle', handle).neq('id', request.user.id).maybeSingle()
    if (taken) return reply.code(409).send({ error: 'That handle is taken' })
    await db().from('profiles').update({ handle, headline, public_proof: on }).eq('id', request.user.id)
    return { ok: true, handle, publicProof: on }
  })
}
