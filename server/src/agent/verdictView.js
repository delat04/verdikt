/*  ============================================================================
    A verdict as an agent reads it over MCP (get_verdict, wait_for_verdict): the outcome, each check, and the
    recording of the run with the second in it where each failed check was measured. Pure: it takes the rows
    the routes already loaded, so it is tested without Supabase.
    ============================================================================ */

import { clock, RECORDING_REASON } from './replay.js'
import { money } from '../lib/money.js'

export const RECORDING_NOTE = 'Recorded in Kernel’s cloud browser while the verifier ran. seen_at on a check is where in the video it was measured.'

// the same sentences the report shows both parties (web/src/domain/probes.js provenance)
const COMPLETE = 'The screenshots and measurements are complete.'

/**
 * The run's recording for an agent, or why there is none.
 * @param {object} [report]  verdicts.report
 * @returns {object|null} { video, length: 'm:ss', sha256, kernel_session, recorded_at, chapters: ['0:02 Desktop · 1440px', …], note },
 *   { unavailable: sentence } when Kernel was meant to record and didn't, null for a run that never used Kernel.
 *   An older report ({ url, seconds } only) gives just what it has
 */
export function recordingOf(report) {
  const r = report?.replay
  if (r?.url) {
    const out = {
      video: r.url,
      length: clock(r.seconds),
      sha256: r.sha256,
      kernel_session: r.session,
      recorded_at: r.recordedAt,
      chapters: Array.isArray(r.chapters) ? r.chapters.map((c) => `${clock(c.t)} ${c.label}`) : undefined,
      note: RECORDING_NOTE,
    }
    return Object.fromEntries(Object.entries(out).filter(([, v]) => v != null))
  }
  const site = report?.site
  if (site?.fallback) {
    return { unavailable: `Checked on Verdikt’s server: ${RECORDING_REASON[site.fallback] || 'Kernel didn’t start a browser'}, so there’s no recording this time. ${COMPLETE}` }
  }
  if (site?.recording && site.recording !== 'recorded') {
    return { unavailable: `Checked in Kernel’s cloud browser${site.region ? ` · ${site.region}` : ''}. ${RECORDING_REASON[site.recording] || 'The recording wasn’t made'}, so there’s no video this time. ${COMPLETE}` }
  }
  return null
}

/**
 * Where in the video a check was measured, from its moment evidence.
 * @param {Array} [evidence]  criterion_results.evidence
 * @returns {string|undefined} e.g. '0:13 · Phone · 375px'
 */
export function seenAt(evidence) {
  const m = (evidence || []).find((e) => e?.type === 'moment')
  return m ? `${clock(m.t)} · ${m.label}` : undefined
}

/**
 * The latest verdict on a milestone, as both MCP tools return it.
 * @param {object} m   the milestone with criteria ({ id, statement, position? }); for full also amount_cents,
 *   released_cents, tranches
 * @param {object} v   the verdict with report and criterion_results ({ criterion_id, passed, layer?, explanation, evidence? })
 * @param {object} [o]
 * @param {boolean} [o.full]  wait_for_verdict's view: engine, money, check ids and what decided each
 * @returns {object}
 */
export function verdictView(m, v, { full = false } = {}) {
  const recording = recordingOf(v.report)
  const criteria = [...(m.criteria || [])].sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
  const checks = criteria.map((c) => {
    const r = (v.criterion_results || []).find((x) => x.criterion_id === c.id)
    // seen_at only on what failed: that is the second an agent needs to fix
    const seen = r && r.passed === false ? seenAt(r.evidence) : undefined
    return full
      ? { id: c.id, check: c.statement, met: r?.passed ?? null, decided_by: r?.layer, why: r?.explanation || '', ...(seen ? { seen_at: seen } : {}) }
      : { check: c.statement, met: r?.passed ?? null, why: r?.explanation || '', ...(seen ? { seen_at: seen } : {}) }
  })
  if (!full) return { status: m.status, outcome: v.outcome, summary: v.summary, ...(recording ? { recording } : {}), checks }
  const e = v.report?.engine
  return {
    status: m.status, outcome: v.outcome, summary: v.summary,
    engine: e ? { decided: e.decided, model_tokens: (e.tokens?.input || 0) + (e.tokens?.output || 0), took_ms: e.ms?.total, receipt: e.receipt } : undefined,
    ...(recording ? { recording } : {}),
    money: { held: money(m.amount_cents - (m.released_cents || 0)), released: money(m.released_cents || 0), paypal_captures: (m.tranches || []).length },
    checks,
  }
}
