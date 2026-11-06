/*  ============================================================================
    Probes, as people read them — the same catalogue the server compiles each signed check into
    (server/src/agent/probes.js). The UI names what decided each check and shows the probes that run.
    ============================================================================ */

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
  browser: 'Opening the site at 1440px and 375px, and reading the repository',
  probes: 'Running the probes',
  ocr: 'Reading text drawn in the screenshots (OCR)',
  model: 'Claude is judging what the probes can’t settle',
}

export const tokensLabel = (t) => {
  const n = (t?.input || 0) + (t?.output || 0)
  return n ? `${n >= 1000 ? `${(n / 1000).toFixed(1)}k` : n} tokens` : 'no model tokens'
}
