/*  ============================================================================
    The recording, tied to the verdict. A Kernel run comes back with marks: where in the video each view opens
    (view), where its measurements were taken (measure), the form test (form) and each sub-page (page). From
    them a verdict gets chapters, and each check the moment in the video that shows what decided it.
    Shared: server/src/agent/replay.js and web/src/domain/replay.js are byte-identical copies (parity.test.js),
    so the verifier, the report and the demo place a check in the video the same way. No imports, no globals.
    ============================================================================ */

/**
 * A time in the video as people read it.
 * @param {number} s  seconds
 * @returns {string} 'm:ss', e.g. 73.4 → '1:13'
 */
export function clock(s) {
  const n = Math.max(0, Math.floor(Number(s) || 0))
  return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`
}

// what each chapter is called when its own mark is missing (a page that didn't load still has a measure mark)
const VIEW_LABEL = { desktop: 'Desktop · 1440px', mobile: 'Phone · 375px' }
const CHAPTER = ['view', 'form', 'page']

/**
 * The video's chapters: where each view, the form test and each sub-page start. Measure marks are moments
 * inside a chapter, not chapters.
 * @param {Array} marks  replay.marks: { t, kind, label, view?, path?, inVideo }
 * @returns {Array<{ t: number, label: string, kind: string, view?: string, path?: string, inVideo: boolean }>}
 */
export function chaptersOf(marks) {
  return (marks || []).filter((m) => CHAPTER.includes(m.kind)).map((m) => ({
    t: m.t,
    label: m.label,
    kind: m.kind,
    ...(m.view ? { view: m.view } : {}),
    ...(m.path ? { path: m.path } : {}),
    inVideo: m.inVideo !== false,
  }))
}

// probes that read one view of the page: which view their result is about
const PAGE_PROBES = ['loads', 'no_console_errors', 'no_horizontal_scroll', 'text_present', 'text_absent', 'element', 'lcp_under', 'meta', 'images_have_alt']
const viewOf = (p) => (p.viewport === 'mobile' ? 'mobile'
  : p.viewport === 'desktop' ? 'desktop'
    : p.type === 'no_horizontal_scroll' ? 'mobile'
      : /\b375px\b/.test(p.observed || '') ? 'mobile'
        : 'desktop')
// what a probe was measured on: { kind, view } or { kind: 'page', path }; null when the video doesn't show it
// (links are checked outside the browser, repo_* never open one)
function targetOf(p) {
  if (PAGE_PROBES.includes(p.type)) return { kind: 'measure', view: viewOf(p) }
  if (p.type === 'accessibility' || p.type === 'no_failed_requests') return { kind: 'measure', view: 'desktop' }
  if (p.type === 'form_submits') return { kind: 'form' }
  if (p.type === 'page_exists' && p.path) return { kind: 'page', path: p.path }
  return null
}
// without a probe that places it: the evidence the check cites, in this order
const BY_EVIDENCE = [
  [['form'], { kind: 'form' }],
  [['mobile', 'layout'], { kind: 'measure', view: 'mobile' }],
  [['desktop', 'console', 'network', 'performance', 'text', 'a11y'], { kind: 'measure', view: 'desktop' }],
]
const ORDER = { fail: 0, unknown: 1, pass: 2 }

/**
 * The second in the video where a check was decided: the failing measurement first, then one that couldn't be
 * made, then a passing one; else the evidence it cites. The same result and marks always give the same moment.
 * @param {object} result  { probes: [{ type, status, observed?, viewport?, path? }], evidence: string[] } (evidence keys)
 * @param {Array}  marks   replay.marks
 * @returns {{ type: 'moment', t: number, label: string, view: string } | null} null when the video doesn't show it
 */
export function momentFor(result, marks) {
  const usable = (marks || []).filter((m) => m.inVideo !== false)
  const find = (target) => usable.find((m) => m.kind === target.kind
    && (target.view === undefined || m.view === target.view)
    && (target.path === undefined || m.path === target.path))
  const moment = (mark, target) => {
    // the label is the chapter's: the view that was measured, the form test, or the sub-page's path
    const chapter = target.kind === 'measure' ? (marks || []).find((m) => m.kind === 'view' && m.view === target.view) : mark
    const view = target.view || mark.view || 'desktop'
    return { type: 'moment', t: mark.t, label: chapter?.label || VIEW_LABEL[view] || mark.label, view }
  }

  const probes = (result?.probes || [])
    .map((p, i) => ({ p, i }))
    .sort((a, b) => (ORDER[a.p.status] ?? 3) - (ORDER[b.p.status] ?? 3) || a.i - b.i)
  for (const { p } of probes) {
    const target = targetOf(p)
    const mark = target && find(target)
    if (mark) return moment(mark, target)
  }
  const cited = result?.evidence || []
  for (const [keys, target] of BY_EVIDENCE) {
    if (!keys.some((k) => cited.includes(k))) continue
    const mark = find(target)
    if (mark) return moment(mark, target)
  }
  return null
}

/** Why a run has no video, in a sentence fragment both parties read: env.fallback or site.recording. */
export const RECORDING_REASON = {
  no_recording: 'The recording didn’t start',
  no_video: 'The recording couldn’t be saved',
  upload_failed: 'The recording couldn’t be stored',
  create_failed: 'Kernel didn’t start a browser',
  connect_failed: 'Kernel’s browser didn’t answer',
  kernel_busy: 'Kernel was at its limit',
}
