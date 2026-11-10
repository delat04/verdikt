/*  ============================================================================
    The deterministic pass, shared by verification and pre-checks:
    compiled specs → one plan → one browser session + one GitHub read → probes → OCR only if a text
    probe missed in the DOM. No model call happens here, so it costs no tokens and the same facts always
    give the same results.
    ============================================================================ */

import { createHash } from 'node:crypto'
import { inspectSite, inspectRepo } from './inspect.js'
import { readScreens } from './ocr.js'
import { ensureSpecs } from './compile.js'
import { planFor, evaluate, ENGINE } from './probes.js'
import { scanForInjection } from './guard.js'

export const sha = (x) => createHash('sha256').update(x).digest('hex')

const FORM_WORDS = /form|sign ?up|subscribe|newsletter|contact|waitlist/i

/**
 * @param {object} p
 * @param {object} p.contract   { id, title, brief }
 * @param {Array}  p.criteria   rows from public.criteria (check_spec may be empty: it compiles once here)
 * @param {Function} [p.onStage] (stage, detail) while it runs: browser | probes | ocr. During 'browser', detail is the
 *   browser's step from inspectSite ({ step, browser?, recording?, path? }); the other calls have none.
 * @param {boolean}  [p.record]  an official verification: the browser runs on Kernel and is recorded
 * @param {string}   [p.ref]     what the run is for (the submission id): names and tags the Kernel session
 * @param {string}   [p.kind]    'verify' for a recorded run, else 'precheck'
 */
export async function runProbes({ contract, criteria, liveUrl, repoUrl, onStage = () => {}, record = false, ref = '', kind = record ? 'verify' : 'precheck' }) {
  const t0 = Date.now()
  const specs = await ensureSpecs(contract, criteria)
  const plan = planFor([...specs.values()])
  plan.form ||= criteria.some((c) => FORM_WORDS.test(c.statement))

  await onStage('browser')
  const [site, repo] = await Promise.all([
    inspectSite(liveUrl, plan, { record, ref, kind, onStep: (d) => onStage('browser', d) }),
    inspectRepo(repoUrl, { files: plan.repoFiles }),
  ])
  const facts = { site, repo }
  const ms = { collect: Date.now() - t0, ocr: 0 }

  await onStage('probes')
  let evals = new Map(criteria.map((c) => [c.id, evaluate(c, specs.get(c.id), facts)]))
  if ([...evals.values()].some((e) => e.status === 'needs_ocr')) {
    await onStage('ocr')
    const t = Date.now()
    facts.ocr = await readScreens({ desktop: site.views.desktop?.screenshot, mobile: site.views.mobile?.screenshot })
    ms.ocr = Date.now() - t
    evals = new Map(criteria.map((c) => [c.id, evaluate(c, specs.get(c.id), facts)]))
  }
  ms.total = Date.now() - t0
  return { specs, facts, evals, flags: scanForInjection(site, repo), ms, plan }
}

/**
 * What the facts were, as a hash: anyone holding the same evidence and specs gets the same receipt.
 * precedentDigest: the hash of the precedent the model saw (precedent.js snapshotDigest), or null. Only a
 * digest joins the hashed object, so a verdict without precedent keeps the original receipt formula.
 */
export function receiptOf(specs, facts, results, precedentDigest = null) {
  const views = Object.fromEntries(Object.entries(facts.site.views).map(([k, v]) => [k, {
    ...v, screenshot: v.screenshot ? sha(v.screenshot) : null, text: v.text ? sha(v.text) : null,
  }]))
  const digest = sha(JSON.stringify({
    views, form: facts.site.form && { ...facts.site.form, screenshot: null }, subpages: facts.site.subpages, links: facts.site.links, axe: facts.site.axe,
    repo: facts.repo?.treeSha || facts.repo?.error || null, ocr: facts.ocr ? sha(JSON.stringify(facts.ocr)) : null,
  }))
  return sha(JSON.stringify({
    engine: ENGINE, specs: [...specs.entries()], digest, results: results.map((r) => [r.criterion_id, r.passed, r.layer]),
    ...(precedentDigest ? { precedent: precedentDigest } : {}),
  }))
}

/**
 * The evidence a model judgment of this check depended on. Same fingerprint as an earlier attempt → the
 * earlier answer stands (no new tokens, and the same evidence can't get two different answers).
 * Timing-based checks never reuse.
 */
export function fingerprintOf(criterion, spec, ev, facts) {
  if (criterion.kind === 'performance') return null
  const parts = [ENGINE, criterion.statement, JSON.stringify(spec), ev.probes.map((p) => `${p.type}:${p.status}`).join(',')]
  const v = facts.site.views
  if (['visual', 'functional'].includes(criterion.kind)) {
    parts.push(v.desktop?.screenshot ? sha(v.desktop.screenshot) : '-', v.mobile?.screenshot ? sha(v.mobile.screenshot) : '-')
    if (facts.site.form) parts.push(JSON.stringify({ ...facts.site.form, screenshot: null }))
  }
  if (['content', 'visual', 'functional'].includes(criterion.kind)) parts.push(sha(v.desktop?.text || ''), facts.ocr ? sha(JSON.stringify(facts.ocr)) : '-')
  if (criterion.kind === 'code') parts.push(facts.repo?.treeSha || facts.repo?.error || '-')
  return sha(parts.join('|'))
}
