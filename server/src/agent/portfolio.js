/*  ============================================================================
    Portfolio checks — a freelancer's past projects, opened by the same probes that check a delivery.
    The checks are fixed (no contract to compile from), so this is the deterministic pass alone: one browser
    session at desktop and phone sizes, one GitHub read, no model call, no tokens. What a client sees is
    what was measured, and when — the claim (title, summary) stays the freelancer's words.
    ============================================================================ */

import { inspectSite, inspectRepo } from './inspect.js'
import { cleanSpec, planFor, evaluate, explain } from './probes.js'
import { db } from '../lib/supabase.js'

export const PORTFOLIO_CHECKS = [
  { id: 'opens', kind: 'functional', statement: 'Opens on a desktop and a phone with no JavaScript errors', probes: [{ type: 'loads', viewport: 'both' }, { type: 'no_console_errors', viewport: 'both' }] },
  { id: 'phone', kind: 'visual', statement: 'Fits a 375px phone: nothing wider than the screen', probes: [{ type: 'no_horizontal_scroll', viewport: 'mobile' }] },
  { id: 'speed', kind: 'performance', statement: 'Main content paints in under 2.5 s on a phone', probes: [{ type: 'lcp_under', ms: 2500, viewport: 'mobile' }] },
  { id: 'access', kind: 'visual', statement: 'No serious accessibility issues (axe-core, WCAG A/AA)', probes: [{ type: 'accessibility', min: 0 }] },
  { id: 'basics', kind: 'content', statement: 'Has a page title, a description and a favicon', probes: [{ type: 'meta', name: 'title' }, { type: 'meta', name: 'description' }, { type: 'meta', name: 'favicon' }] },
  { id: 'links', kind: 'functional', statement: 'Links to its own pages work', probes: [{ type: 'links_work' }] },
  { id: 'readme', kind: 'code', repo: true, statement: 'The repository has a README', probes: [{ type: 'repo_file', path: 'README*' }] },
  { id: 'secrets', kind: 'code', repo: true, statement: 'No secrets or .env files committed', probes: [{ type: 'repo_no_secrets' }] },
]

/** Open a project and run every portfolio check; repo checks only when a repository was given. */
export async function checkPortfolio({ liveUrl, repoUrl = null }) {
  const t0 = Date.now()
  const checks = PORTFOLIO_CHECKS.filter((c) => !c.repo || repoUrl)
  const specs = new Map(checks.map((c) => [c.id, cleanSpec({ probes: c.probes, sufficient: true, by: 'portfolio' })]))
  const plan = planFor([...specs.values()])
  const [site, repo] = await Promise.all([inspectSite(liveUrl, plan), repoUrl ? inspectRepo(repoUrl, { files: plan.repoFiles }) : null])
  const facts = { site, repo }
  const results = checks.map((c) => {
    const e = evaluate({ id: c.id, kind: c.kind, statement: c.statement }, specs.get(c.id), facts)
    // every portfolio check is sufficient on its own; anything else means a probe couldn't decide
    const status = e.status === 'pass' || e.status === 'fail' ? e.status : 'unclear'
    return {
      id: c.id, statement: c.statement, status,
      explanation: status === 'unclear' ? 'The probes could not decide this one.' : explain(e),
      fix: e.fix || null,
      probes: e.probes.map(({ wantsOcr, ...p }) => p),
    }
  })
  const counts = { pass: 0, fail: 0, unclear: 0 }
  for (const r of results) counts[r.status] += 1
  return { counts, total: results.length, checks: results, ms: Date.now() - t0, liveUrl, repoUrl, at: new Date().toISOString() }
}

/** A freelancer's portfolio as facts for an application review: what's listed, what was checked, how it went. */
export async function portfolioFacts(freelancerId) {
  const { data: items } = await db().from('portfolio_items').select('title, live_url, repo_url, check_result, checked_at').eq('freelancer_id', freelancerId).order('position')
  const list = items || []
  const checked = list.filter((i) => i.check_result)
  const clean = checked.filter((i) => i.check_result.counts.fail === 0 && i.check_result.counts.unclear === 0)
  const lines = list.slice(0, 6).map((i) => {
    const host = new URL(i.live_url).host
    const r = i.check_result
    return r ? `${i.title} (${host}): ${r.counts.pass} of ${r.total} portfolio checks pass` : `${i.title} (${host}): not checked`
  })
  return { projects: list.length, checked: checked.length, clean: clean.length, lines }
}
