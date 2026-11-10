/*  ============================================================================
    Probes, as people read them — the same catalogue the server compiles each signed check into
    (server/src/agent/probes.js). The UI names what decided each check and shows the probes that run.
    ============================================================================ */

import { RECORDING_REASON } from './replay'

const PX = { desktop: '1440px', mobile: '375px' }
const at = (p, fallback) => {
  const v = p.viewport || fallback
  return v === 'both' ? '' : ` at ${PX[v]}`
}
const quote = (list = []) => list.map((t) => `“${t}”`).join(', ')
const META = { title: 'page title', description: 'meta description', viewport: 'mobile viewport tag', og_image: 'social preview image', favicon: 'favicon', lang: 'language attribute' }

const LABEL = {
  loads: (p) => `The page loads${at(p, 'both')}`,
  no_console_errors: (p) => `No JavaScript errors${at(p, 'both')}`,
  no_failed_requests: () => 'No failed requests to the site itself',
  no_horizontal_scroll: (p) => `Nothing wider than the screen${at(p, 'mobile')}`,
  text_present: (p) => `Shows ${quote(p.text)}`,
  text_absent: (p) => `No ${p.text?.length ? quote(p.text) : 'placeholder text'}`,
  element: (p) => `${p.min > 1 ? `At least ${p.min} × ` : ''}${p.selector} visible${at(p, 'desktop')}`,
  form_submits: () => 'The form submits and the site accepts it',
  lcp_under: (p) => `Main content paints in under ${(p.ms / 1000).toFixed(1)} s${at(p, 'both')}`,
  page_exists: (p) => `${p.path} loads${p.text?.length ? ` and shows ${quote(p.text)}` : ''}`,
  meta: (p) => `Has a ${META[p.name] || p.name}`,
  images_have_alt: () => 'Every image has alt text',
  links_work: () => 'Links to the site’s own pages work',
  accessibility: () => 'No serious accessibility issues (axe-core, WCAG A/AA)',
  repo_file: (p) => `Repository has ${p.path}`,
  repo_script: (p) => `package.json has a “${p.name}” script`,
  repo_dependency: (p) => `Built with ${p.name}`,
  repo_contains: (p) => `${p.path} mentions ${quote(p.text)}`,
  repo_no_secrets: () => 'No secrets or .env files committed',
}
export const probeLabel = (p) => p.label || LABEL[p.type]?.(p) || p.type

/** What decided a check. Only "probe" and "OCR" are deterministic; "unchanged" reuses an earlier judgment. */
export const LAYER = {
  probe: { short: 'Probe', long: 'Decided by deterministic probes — no model call' },
  ocr: { short: 'OCR', long: 'Decided by reading the text in the screenshot — no model call' },
  model: { short: 'Claude', long: 'Judged by Claude, with the probe results as facts' },
  reused: { short: 'Unchanged', long: 'Same evidence as the last attempt, so the earlier answer stands — no model call' },
}

export const STAGE = {
  compile: 'Compiling the signed checks into probes',
  browser: 'Opening the site and reading the repository',
  probes: 'Running the probes',
  ocr: 'Reading text drawn in the screenshots (OCR)',
  precedent: 'Looking up how similar checks were decided (Elastic)',
  model: 'Claude is judging what the probes can’t settle',
}
// the demo's 'precedent' stage: no Elastic call, the cases come from the demo's fixed sample history
export const PRECEDENT_SAMPLE_STAGE = 'Looking up how similar checks were decided · from the demo’s sample history'

/**
 * What the browser is doing during the 'browser' stage: progress['@'].step (and path, for a sub-page). Whether it
 * records is said once, beside the clock (meta.recording), never here: Kernel can start a browser that doesn't record.
 * The demo's sample walk (meta.sample) records nothing now; it plays back the sample's Kernel run.
 */
export const STEP = {
  open: (kind, sample) => (sample ? 'Opening the sample’s Kernel run, recorded when the demo was built' : kind === 'kernel' ? 'Starting a browser in Kernel’s cloud' : 'Starting the browser'),
  desktop: 'Opening the page at 1440px',
  mobile: 'Opening the page at 375px',
  form: 'Trying the form with a test address',
  page: (path) => `Opening ${path || 'a page'}`,
}
export const stepLabel = (m = {}) => {
  const s = STEP[m.step]
  return typeof s === 'function' ? (m.step === 'page' ? s(m.path) : s(m.browser, !!m.sample)) : s || null
}

/** Why a check has no video: the server's reasons (shared, domain/replay.js) and the demo's own. */
export const RECORDING = {
  ...RECORDING_REASON,
  demo_only: 'Demo mode doesn’t open this delivery, so its measurements are illustrative and there’s no recording. The sample deliveries were measured and recorded in Kernel’s cloud browser.',
}
// a reason mid-sentence: lower-first, except a name ('Kernel didn’t start a browser' stays as it is)
export const lowerFirst = (s = '') => (/^Kernel/.test(s) ? s : s.charAt(0).toLowerCase() + s.slice(1))

/** A chapter (or a moment's label) in a word or two: views by name, the form test, a sub-page by its path. */
export const CHAPTER_SHORT = { desktop: 'Desktop', mobile: 'Phone', form: 'Form test' }
export function chapterShort(c = {}) {
  if (c.kind === 'page' || c.path) return c.path || c.label
  if (c.kind === 'form') return CHAPTER_SHORT.form
  if (c.kind === 'view' && CHAPTER_SHORT[c.view]) return CHAPTER_SHORT[c.view]
  // a moment carries only its chapter's label: 'Phone · 375px' → 'Phone'
  return (c.label || '').split(' · ')[0]
}

// where the browser was when it stopped (env.retry.at): a view, the form test or a sub-page's path
const AT = { desktop: 'the desktop view', mobile: 'the phone view', form: 'the form test' }

/**
 * Where a check ran, in a line both parties read: Kernel's cloud browser or Verdikt's server, and whether there's
 * a recording, from the verdict's report.site ({ browser, region, chrome, recording, fallback, sample }).
 * @returns {string|null} null when the verdict doesn't say (an older verdict, or the demo's unrecorded runs)
 */
export function provenance(site) {
  if (!site?.browser) return null
  const where = ['Checked in Kernel’s cloud browser', site.region].filter(Boolean).join(' · ')
  if (site.browser === 'kernel') {
    const chrome = site.chrome ? ` · Chrome ${site.chrome}` : ''
    if (site.sample) return `Sample delivery checked in Kernel’s cloud browser${site.region ? ` · ${site.region}` : ''}${chrome}, when the demo was built`
    if (!site.recording || site.recording === 'recorded') return `${where}${chrome} · 1440 and 375px`
    return `${where}. ${RECORDING[site.recording] || 'The recording couldn’t be saved'}, so there’s no video this time. The screenshots and measurements are complete.`
  }
  if (site.fallback) return `Checked on Verdikt’s server: ${RECORDING[site.fallback] || 'Kernel was unavailable'}, so there’s no recording this time. The screenshots and measurements are complete.`
  return 'Checked on Verdikt’s server.'
}
/** The sentence for a run that lost its first browser (site.retry: { at, reason }), else null. */
export function retryLine(site) {
  const at = site?.retry?.at
  if (!at) return null
  return `The first browser stopped during ${AT[at] || at}, so the whole check ran again in a new one.`
}

export const tokensLabel = (t) => {
  const n = (t?.input || 0) + (t?.output || 0)
  return n ? `${n >= 1000 ? `${(n / 1000).toFixed(1)}k` : n} tokens` : 'no model tokens'
}
