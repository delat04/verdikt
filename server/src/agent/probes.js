/*  ============================================================================
    Probes — the deterministic half of the verifier.
    Each signed check compiles into probes from a fixed catalogue (data, never code): "nothing wider than
    375px", "the page shows “Order online”", "package.json has a build script". At delivery they run against
    the facts the browser and GitHub collected, so the same facts always give the same answer, at no token
    cost. A failed hard probe fails its check outright; a check whose probes are sufficient passes without
    the model; everything else goes to Claude with the probe results attached as facts.
    ============================================================================ */

export const ENGINE = 'probes-1'

const VIEWPORT_PX = { desktop: 1440, mobile: 375 }
const META = { title: 'page title', description: 'meta description', viewport: 'mobile viewport tag', og_image: 'social preview image (og:image)', favicon: 'favicon', lang: 'language attribute' }
const PLACEHOLDERS = ['lorem ipsum', 'dolor sit amet', 'your text here', 'insert text', '[placeholder]']
const SECRET = [
  /AKIA[0-9A-Z]{16}/, /\bsk_live_[0-9a-zA-Z]{16,}/, /\bghp_[0-9A-Za-z]{30,}/, /\bxox[bpa]-[0-9A-Za-z-]{20,}/,
  /AIza[0-9A-Za-z_-]{35}/, /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/, /\bsk-ant-[0-9A-Za-z_-]{20,}/,
]

const quote = (list) => list.map((t) => `“${t}”`).join(', ')
const vpLabel = (p, fallback) => {
  const v = p.viewport || fallback
  return v === 'both' ? '' : ` at ${VIEWPORT_PX[v]}px`
}

/** The catalogue. `hard`: a failure decides the check on its own; soft failures go to the model as a fact. */
export const PROBES = {
  loads: { needs: 'page', hard: true, label: (p) => `The page loads${vpLabel(p, 'both')}` },
  no_console_errors: { needs: 'page', hard: true, label: (p) => `No JavaScript errors${vpLabel(p, 'both')}` },
  no_failed_requests: { needs: 'page', hard: true, label: () => 'No failed requests to the site itself' },
  no_horizontal_scroll: { needs: 'page', hard: true, label: (p) => `Nothing wider than the screen${vpLabel(p, 'mobile')}` },
  text_present: { needs: 'page', hard: 'quoted', label: (p) => `Shows ${quote(p.text)}` },
  text_absent: { needs: 'page', hard: true, label: (p) => `No ${quote(p.text?.length ? p.text : ['placeholder text'])}` },
  element: { needs: 'page', hard: false, label: (p) => `${p.min > 1 ? `At least ${p.min} × ` : ''}\`${p.selector}\` visible${vpLabel(p, 'desktop')}` },
  form_submits: { needs: 'form', hard: true, label: () => 'The form submits and the site accepts it' },
  lcp_under: { needs: 'page', hard: true, label: (p) => `Main content paints in under ${(p.ms / 1000).toFixed(1)} s${vpLabel(p, 'both')}` },
  page_exists: { needs: 'subpage', hard: true, label: (p) => `${p.path} loads${p.text?.length ? ` and shows ${quote(p.text)}` : ''}` },
  meta: { needs: 'page', hard: true, label: (p) => `Has a ${META[p.name] || p.name}` },
  images_have_alt: { needs: 'page', hard: true, label: () => 'Every image has alt text' },
  links_work: { needs: 'links', hard: true, label: () => 'Links to the site’s own pages work' },
  accessibility: { needs: 'axe', hard: true, label: () => 'No serious accessibility issues (axe-core, WCAG A/AA)' },
  repo_file: { needs: 'repo', hard: true, label: (p) => `Repository has ${p.path}` },
  repo_script: { needs: 'repo', hard: true, label: (p) => `package.json has a “${p.name}” script` },
  repo_dependency: { needs: 'repo', hard: true, label: (p) => `Built with ${p.name}` },
  repo_contains: { needs: 'repo', hard: false, label: (p) => `${p.path} mentions ${quote(p.text)}` },
  repo_no_secrets: { needs: 'repo', hard: true, label: () => 'No secrets or .env files committed' },
}
export const PROBE_TYPES = Object.keys(PROBES)

// the arguments each probe reads; anything else a model attaches is dropped
const ARGS = {
  loads: ['viewport'], no_console_errors: ['viewport'], no_horizontal_scroll: ['viewport'], text_present: ['text', 'viewport'],
  text_absent: ['text'], element: ['selector', 'min', 'viewport'], lcp_under: ['ms', 'viewport'], page_exists: ['path', 'text'],
  meta: ['name'], accessibility: ['min'], repo_file: ['path'], repo_script: ['name'], repo_dependency: ['name'], repo_contains: ['path', 'text'],
}

// ---------------------------------------------------------------- specs
/** Specs come from a model or old rows: keep only well-formed probes from the catalogue. */
export function cleanSpec(raw) {
  const probes = []
  for (const p of Array.isArray(raw?.probes) ? raw.probes : []) {
    if (!PROBES[p?.type]) continue
    const out = { type: p.type }
    if (['desktop', 'mobile', 'both'].includes(p.viewport)) out.viewport = p.viewport
    const text = (Array.isArray(p.text) ? p.text : []).map((t) => String(t).trim()).filter((t) => t.length >= 2 && t.length <= 80).slice(0, 5)
    if (text.length) out.text = text
    if (typeof p.selector === 'string' && p.selector.trim() && p.selector.length <= 120) out.selector = p.selector.trim()
    if (Number.isInteger(p.min) && p.min >= 0 && p.min <= 50) out.min = p.min
    if (Number.isFinite(p.ms) && p.ms >= 300 && p.ms <= 20000) out.ms = Math.round(p.ms)
    if (typeof p.path === 'string' && p.path.trim() && p.path.length <= 120) out.path = p.path.trim()
    if (typeof p.name === 'string' && p.name.trim() && p.name.length <= 60) out.name = p.name.trim()
    for (const k of Object.keys(out)) if (k !== 'type' && !(ARGS[p.type] || []).includes(k)) delete out[k]
    // a probe missing what it needs to run is dropped, not guessed
    if (p.type === 'text_present' && !out.text) continue
    if (p.type === 'element' && !out.selector) continue
    if (p.type === 'lcp_under' && !out.ms) continue
    if (p.type === 'page_exists' && !/^\/[^\s]*$/.test(out.path || '')) continue
    if (p.type === 'meta' && !META[out.name]) continue
    if (['repo_file', 'repo_contains'].includes(p.type) && !out.path) continue
    if (['repo_script', 'repo_dependency'].includes(p.type) && !out.name) continue
    if (p.type === 'repo_contains' && !out.text) continue
    probes.push(out)
  }
  return { v: 1, probes: probes.slice(0, 6), sufficient: !!raw?.sufficient && probes.length > 0, by: raw?.by || 'rules' }
}

/** Without the model: read the sentence for checks a probe can run. Never "sufficient" — a pass still gets judged. */
export function rulesSpec({ statement, kind }) {
  const s = statement.toLowerCase()
  const probes = []
  const add = (p) => { if (!probes.some((x) => JSON.stringify(x) === JSON.stringify(p))) probes.push(p) }
  if (/\b(loads?|opens?|reachable|live url|http)\b/.test(s)) add({ type: 'loads', viewport: 'both' })
  if (/console|javascript error|without (any )?errors|error-free/.test(s)) add({ type: 'no_console_errors', viewport: 'both' })
  if (/horizontal(ly)? scroll|overflow|wider than|375 ?px|sideways/.test(s)) add({ type: 'no_horizontal_scroll', viewport: 'mobile' })
  if (/lorem|placeholder|dummy text/.test(s)) add({ type: 'text_absent', text: PLACEHOLDERS.slice(0, 3) })
  const quoted = [...statement.matchAll(/[“"']([^“”"']{2,60})[”"']/g)].map((x) => x[1].trim()).filter(Boolean)
  if (quoted.length && kind !== 'code') add({ type: 'text_present', text: quoted.slice(0, 4) })
  if (/\b(form|sign ?up|subscribe|newsletter|waitlist)\b/.test(s) && /submit|send|success|confirm|accept|store|save|work/.test(s)) add({ type: 'form_submits' })
  const time = /(lcp|largest contentful paint|paints?|loads?)[^.]{0,40}?(under|within|below|less than|<)\s*(\d+(?:\.\d+)?)\s*(ms|s|sec|seconds?)\b/.exec(s)
  if (time) add({ type: 'lcp_under', ms: Math.round(Number(time[3]) * (time[4] === 'ms' ? 1 : 1000)), viewport: 'both' })
  if (/alt text|alt attribute|alternative text/.test(s)) add({ type: 'images_have_alt' })
  if (/accessib|wcag|colou?r contrast|screen reader|a11y/.test(s)) add({ type: 'accessibility' })
  if (/meta description/.test(s)) add({ type: 'meta', name: 'description' })
  if (/favicon/.test(s)) add({ type: 'meta', name: 'favicon' })
  if (/og:image|open graph|social (preview|card)/.test(s)) add({ type: 'meta', name: 'og_image' })
  if (/broken links?|links? (all )?work/.test(s)) add({ type: 'links_work' })
  for (const page of s.matchAll(/\b(about|contact|pricing|blog|faq|menu|privacy|terms)\b page/g)) add({ type: 'page_exists', path: `/${page[1]}` })
  if (/readme/.test(s)) add({ type: 'repo_file', path: 'README*' })
  if (/licen[cs]e/.test(s) && kind === 'code') add({ type: 'repo_file', path: 'LICENSE*' })
  if (/build script|npm run build|builds? (successfully|without|cleanly)|production build/.test(s)) add({ type: 'repo_script', name: 'build' })
  if (/npm test|test script|unit tests?|test suite/.test(s)) add({ type: 'repo_script', name: 'test' })
  if (/secret|api key|credential|\.env/.test(s)) add({ type: 'repo_no_secrets' })
  for (const lib of s.matchAll(/\b(vue|react|svelte|next\.?js|nuxt|astro|tailwind(?:css)?|typescript)\b/g)) {
    add({ type: 'repo_dependency', name: { 'next.js': 'next', nextjs: 'next', tailwindcss: 'tailwindcss', tailwind: 'tailwindcss' }[lib[1]] || lib[1] })
  }
  return cleanSpec({ probes, sufficient: false, by: 'rules' })
}

// ---------------------------------------------------------------- plan
/** What the browser and GitHub must collect for these specs — one session serves every probe. */
export function planFor(specs) {
  const plan = { queries: [], paths: [], links: false, axe: false, form: false, repoFiles: [] }
  for (const spec of specs) {
    for (const p of spec.probes) {
      if (p.type === 'element') plan.queries.push(p.selector)
      if (p.type === 'page_exists') plan.paths.push(p.path)
      if (p.type === 'links_work') plan.links = true
      if (p.type === 'accessibility') plan.axe = true
      if (p.type === 'form_submits') plan.form = true
      if (p.type === 'repo_contains') plan.repoFiles.push(p.path)
    }
  }
  plan.queries = [...new Set(plan.queries)].slice(0, 12)
  plan.paths = [...new Set(plan.paths)].slice(0, 4)
  plan.repoFiles = [...new Set(plan.repoFiles)].slice(0, 5)
  return plan
}

// ---------------------------------------------------------------- running
export const norm = (t) => String(t || '').toLowerCase().normalize('NFKD').replace(/[‘’]/g, "'").replace(/[^\p{L}\p{N}'$%&@+#]+/gu, ' ').trim()

/** OCR misreads a letter here and there: a window of the text within ~15% edits of the needle counts. */
export function fuzzyIncludes(haystack, needle) {
  const h = norm(haystack)
  const n = norm(needle)
  if (!n) return false
  if (h.includes(n)) return true
  if (n.length < 5) return false
  const budget = Math.floor(n.length * 0.15)
  const prev = new Array(n.length + 1)
  const cur = new Array(n.length + 1)
  // Sellers' substring edit distance: the needle may start anywhere in the text
  for (let j = 0; j <= n.length; j += 1) prev[j] = j
  for (let i = 1; i <= h.length; i += 1) {
    cur[0] = 0
    for (let j = 1; j <= n.length; j += 1) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (h[i - 1] === n[j - 1] ? 0 : 1))
    }
    if (cur[n.length] <= budget) return true
    for (let j = 0; j <= n.length; j += 1) prev[j] = cur[j]
  }
  return false
}

export function globRe(glob) {
  const re = String(glob).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*\//g, '(?:.*/)?').replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]')
  return new RegExp(`^${re}$`, 'i')
}

const viewsOf = (p, fallback) => {
  const v = p.viewport || fallback
  return v === 'both' ? ['desktop', 'mobile'] : [v]
}
const r = (status, observed, extra = {}) => ({ status, observed, ...extra })
const sameOrigin = (line, origin) => {
  const url = /\s(https?:\/\/\S+)\s/.exec(` ${line} `)?.[1]
  try { return new URL(url).origin === origin } catch { return false }
}
const repoMissing = (repo) => (repo?.error === 'No repository submitted' || repo?.error === 'Not a GitHub repository URL'
  ? r('fail', 'No public GitHub repository was submitted.', { fix: 'Submit the public GitHub repository with the delivery.' })
  : repo?.error ? r('unknown', `The repository could not be read: ${repo.error}.`) : null)
const pkg = (repo) => { try { return JSON.parse(repo.files?.['package.json'] || 'null') } catch { return null } }

/** Each runner: (probe, facts, criterion) → { status: pass | fail | unknown, observed, fix?, via?, wantsOcr? } */
const RUN = {
  loads(p, f) {
    for (const vp of viewsOf(p, 'both')) {
      const v = f.site.views[vp]
      if (!v) return r('unknown', `The ${vp} view was not captured.`)
      // the verifier's own browser went away: that says nothing about the site (inspectSite retries before this)
      if (v.infra) return r('unknown', `The verifier’s browser stopped before the ${VIEWPORT_PX[vp]}px view loaded.`)
      if (v.error) return r('fail', `At ${VIEWPORT_PX[vp]}px the page did not load: ${v.error}.`, { fix: 'Make sure the live URL is public and responds.' })
      if (v.status >= 400) return r('fail', `At ${VIEWPORT_PX[vp]}px the server answered HTTP ${v.status}.`, { fix: 'The live URL must answer with a 2xx status.' })
    }
    const d = f.site.views.desktop
    return r('pass', `HTTP ${d?.status ?? '—'}, loaded in ${d?.loadMs ?? '—'} ms.`)
  },
  no_console_errors(p, f) {
    for (const vp of viewsOf(p, 'both')) {
      const errors = f.site.views[vp]?.consoleErrors || []
      if (errors.length) return r('fail', `${errors.length} console error${errors.length > 1 ? 's' : ''} at ${VIEWPORT_PX[vp]}px: ${errors.slice(0, 2).join(' | ')}`, { fix: 'Fix the errors in the browser console.' })
    }
    return r('pass', 'No console errors.')
  },
  no_failed_requests(p, f) {
    const origin = new URL(f.site.url).origin
    const bad = (f.site.views.desktop?.failedRequests || []).filter((l) => sameOrigin(l, origin))
    if (bad.length) return r('fail', `${bad.length} request${bad.length > 1 ? 's' : ''} to the site failed: ${bad.slice(0, 3).join(' | ')}`, { fix: 'Every file and API call on the site must answer without an error.' })
    return r('pass', 'Every request to the site succeeded.')
  },
  no_horizontal_scroll(p, f) {
    for (const vp of viewsOf(p, 'mobile')) {
      const v = f.site.views[vp]
      if (!v?.layout) return r('unknown', `The ${vp} layout was not measured.`)
      if (v.layout.scrollWidth > v.layout.viewport + 1) {
        const first = v.layout.offenders[0]
        return r('fail', `At ${v.layout.viewport}px the page is ${v.layout.scrollWidth}px wide${first ? `; widest offender: ${first}` : ''}.`, { fix: `Make ${first ? first.split(/\s/)[0] : 'the widest element'} fit a ${v.layout.viewport}px screen.` })
      }
    }
    const v = f.site.views[viewsOf(p, 'mobile')[0]]
    return r('pass', `At ${v.layout.viewport}px the page is exactly ${v.layout.scrollWidth}px wide.`)
  },
  text_present(p, f) {
    const views = viewsOf(p, 'both').map((vp) => f.site.views[vp]).filter(Boolean)
    const dom = views.map((v) => v.text || '').join('\n')
    const missing = p.text.filter((t) => !norm(dom).includes(norm(t)))
    if (!missing.length) return r('pass', `Found ${quote(p.text)} in the page text.`, { via: 'dom' })
    if (f.ocr === undefined) return r('unknown', `${quote(missing)} not in the page text; reading the screenshots.`, { wantsOcr: true })
    if (f.ocr === null) return r('unknown', `${quote(missing)} not in the page text, and the screenshots couldn't be read in time.`)
    const ocrText = Object.values(f.ocr || {}).join('\n')
    const stillMissing = missing.filter((t) => !fuzzyIncludes(ocrText, t))
    if (!stillMissing.length) return r('pass', `Found ${quote(missing)} drawn in the page (read from the screenshot by OCR).`, { via: 'ocr' })
    return r('fail', `${quote(stillMissing)} is not in the page text, and OCR didn't find it in the screenshots either.`, { via: 'ocr', fix: `Show ${quote(stillMissing)} on the page as written in the signed check.` })
  },
  text_absent(p, f) {
    const list = p.text?.length ? p.text : PLACEHOLDERS
    for (const vp of ['desktop', 'mobile']) {
      const t = norm(f.site.views[vp]?.text)
      const hit = list.find((x) => t.includes(norm(x)))
      if (hit) return r('fail', `The page still contains “${hit}” at ${VIEWPORT_PX[vp]}px.`, { fix: `Replace “${hit}” with the real copy.` })
    }
    return r('pass', `None of ${quote(list)} on the page.`)
  },
  element(p, f) {
    const v = f.site.views[viewsOf(p, 'desktop')[0]]
    const q = v?.queries?.[p.selector]
    if (!q) return r('unknown', `\`${p.selector}\` could not be queried.`)
    if (q.invalid) return r('unknown', `\`${p.selector}\` is not a valid selector.`)
    const min = p.min ?? 1
    if (q.visible < min) return r('fail', `Found ${q.visible} visible \`${p.selector}\` (${q.count} in the page); needs at least ${min}.`)
    return r('pass', `${q.visible} visible \`${p.selector}\`${q.samples.length ? `: ${q.samples.slice(0, 3).map((s) => `“${s}”`).join(', ')}` : ''}.`)
  },
  form_submits(p, f) {
    const form = f.site.form
    if (!form) return r('unknown', 'No form with an email field was found to submit.')
    if (form.error) return r('unknown', `The form could not be submitted: ${form.error}`)
    const codes = form.responses.map((x) => Number(/→ (\d{3})/.exec(x)?.[1])).filter(Boolean)
    const bad = form.responses.filter((x) => Number(/→ (\d{3})/.exec(x)?.[1]) >= 400)
    if (bad.length) return r('fail', `Submitting the form failed: ${bad.join(' | ')}.`, { fix: 'The form’s endpoint must accept a valid submission.' })
    const thanks = form.newText.find((l) => /thank|success|subscribed|confirm|received|you'?re (in|on)|welcome|sent/i.test(l))
    if (codes.some((c) => c < 400) || thanks) return r('pass', `Submitted: ${[...form.responses, thanks && `“${thanks}”`].filter(Boolean).join(' · ')}.`)
    return r('unknown', 'The form was submitted but no request or confirmation was seen.')
  },
  lcp_under(p, f) {
    for (const vp of viewsOf(p, 'both')) {
      const v = f.site.views[vp]
      if (!v?.lcpMs) return r('unknown', `Largest paint was not measured at ${VIEWPORT_PX[vp]}px.`)
      if (v.lcpMs > p.ms) return r('fail', `At ${VIEWPORT_PX[vp]}px the main content painted in ${(v.lcpMs / 1000).toFixed(2)} s; the limit is ${(p.ms / 1000).toFixed(1)} s.`, { fix: 'Make the largest element (often the hero image) load faster: compress it, size it, preload it.' })
    }
    const parts = viewsOf(p, 'both').map((vp) => `${(f.site.views[vp].lcpMs / 1000).toFixed(2)} s at ${VIEWPORT_PX[vp]}px`)
    return r('pass', `Painted in ${parts.join(', ')}.`)
  },
  page_exists(p, f) {
    const s = f.site.subpages?.[p.path]
    if (!s) return r('unknown', `${p.path} was not opened.`)
    if (s.error || s.status >= 400) return r('fail', `${p.path} ${s.error ? `did not load: ${s.error}` : `answered HTTP ${s.status}`}.`, { fix: `Publish the ${p.path} page.` })
    const missing = (p.text || []).filter((t) => !norm(s.text).includes(norm(t)))
    if (missing.length) return r('fail', `${p.path} loads but doesn't show ${quote(missing)}.`)
    return r('pass', `${p.path} answered HTTP ${s.status}${s.title ? ` — “${s.title}”` : ''}.`)
  },
  meta(p, f) {
    const m = f.site.views.desktop?.meta
    if (!m) return r('unknown', 'The page head was not read.')
    const value = m[p.name]
    if (!value) return r('fail', `The page has no ${META[p.name]}.`, { fix: `Add a ${META[p.name]} to the page head.` })
    return r('pass', `${META[p.name][0].toUpperCase()}${META[p.name].slice(1)}: “${String(value).slice(0, 80)}”.`)
  },
  images_have_alt(p, f) {
    const img = f.site.views.desktop?.images
    if (!img) return r('unknown', 'Images were not counted.')
    if (img.missingAlt.length) return r('fail', `${img.missingAlt.length} of ${img.total} images have no alt text: ${img.missingAlt.slice(0, 4).join(', ')}.`, { fix: 'Give every image an alt attribute (alt="" for decorative ones).' })
    return r('pass', img.total ? `All ${img.total} images have alt text.` : 'The page has no images.')
  },
  links_work(p, f) {
    const l = f.site.links
    if (!l) return r('unknown', 'Links were not checked.')
    if (l.broken.length) return r('fail', `${l.broken.length} of ${l.checked} links are broken: ${l.broken.slice(0, 3).join(' | ')}.`, { fix: 'Fix or remove the broken links.' })
    return r('pass', l.checked ? `All ${l.checked} links to the site’s own pages answered.` : 'The page links to no other pages on the site.')
  },
  accessibility(p, f) {
    const a = f.site.axe
    if (!a) return r('unknown', 'The accessibility scan did not run.')
    if (a.error) return r('unknown', `The accessibility scan failed: ${a.error}`)
    const serious = a.violations.filter((v) => ['serious', 'critical'].includes(v.impact))
    if (serious.length > (p.min ?? 0)) return r('fail', `axe-core found ${serious.length} serious issue${serious.length > 1 ? 's' : ''}: ${serious.slice(0, 3).map((v) => `${v.id} (${v.nodes}×)`).join(', ')}.`, { fix: serious[0].help })
    return r('pass', `axe-core: no serious or critical WCAG A/AA issues${a.violations.length ? ` (${a.violations.length} minor)` : ''}.`)
  },
  repo_file(p, f) {
    const miss = repoMissing(f.repo)
    if (miss) return miss
    const re = globRe(p.path)
    const hit = f.repo.tree.find((x) => re.test(x) || re.test(x.split('/').pop()))
    if (!hit) return r('fail', `No file matching ${p.path} in ${f.repo.repo}.`, { fix: `Add ${p.path} to the repository.` })
    return r('pass', `${hit} is in ${f.repo.repo}@${f.repo.branch}.`)
  },
  repo_script(p, f) {
    const miss = repoMissing(f.repo)
    if (miss) return miss
    const json = pkg(f.repo)
    if (!json) return r('fail', 'The repository has no readable package.json.', { fix: 'Add a package.json with the scripts.' })
    const cmd = json.scripts?.[p.name]
    if (!cmd) return r('fail', `package.json has no “${p.name}” script.`, { fix: `Add a “${p.name}” script to package.json.` })
    return r('pass', `“${p.name}”: ${cmd}`)
  },
  repo_dependency(p, f) {
    const miss = repoMissing(f.repo)
    if (miss) return miss
    const json = pkg(f.repo)
    const deps = { ...json?.dependencies, ...json?.devDependencies }
    const hit = Object.keys(deps).find((d) => d === p.name || d === `@${p.name}/core` || d.startsWith(`${p.name}/`))
    if (!hit) return r('fail', `${p.name} is not a dependency in package.json.`)
    return r('pass', `${hit} ${deps[hit]} in package.json.`)
  },
  repo_contains(p, f) {
    const miss = repoMissing(f.repo)
    if (miss) return miss
    const re = globRe(p.path)
    const files = Object.entries({ ...f.repo.files, ...f.repo.extraFiles }).filter(([path]) => re.test(path) || re.test(path.split('/').pop()))
    if (!files.length) return r('fail', `No readable file matching ${p.path}.`)
    const hit = files.find(([, body]) => p.text.every((t) => norm(body).includes(norm(t))))
    if (!hit) return r('fail', `${files.map(([x]) => x).join(', ')} ${files.length > 1 ? "don't" : "doesn't"} mention ${quote(p.text)}.`)
    return r('pass', `${hit[0]} mentions ${quote(p.text)}.`)
  },
  repo_no_secrets(p, f) {
    const miss = repoMissing(f.repo)
    if (miss) return miss
    if (f.repo.envFilesCommitted?.length) return r('fail', `Committed env files: ${f.repo.envFilesCommitted.join(', ')}.`, { fix: 'Remove the env files from the repository, rotate those keys, and add .env to .gitignore.' })
    const files = { ...f.repo.files, ...f.repo.extraFiles }
    for (const [path, body] of Object.entries(files)) {
      const re = SECRET.find((x) => x.test(body || ''))
      if (re) return r('fail', `${path} contains what looks like a live key (${re.source.slice(0, 18)}…).`, { fix: 'Remove the key from the code, rotate it, and load it from the environment.' })
    }
    return r('pass', `No env files committed; ${Object.keys(files).length} files scanned for keys.`)
  },
}

export function hardness(probe, criterion) {
  const h = PROBES[probe.type].hard
  // exact copy is decisive only when the signed sentence itself quotes it
  if (h === 'quoted') return (probe.text || []).every((t) => criterion.statement.toLowerCase().includes(t.toLowerCase()))
  return h
}

/**
 * Run one check's probes. → { status: pass | fail | judge | needs_ocr, layer, probes[], fix }
 * pass/fail are final; judge goes to the model with the probe results as facts.
 */
export function evaluate(criterion, spec, facts) {
  const probes = spec.probes.map((p) => {
    let out
    try { out = RUN[p.type](p, facts, criterion) } catch (e) { out = r('unknown', `The probe could not run: ${e.message}`) }
    return { type: p.type, label: PROBES[p.type].label(p), hard: hardness(p, criterion), ...out }
  })
  const decisive = probes.find((x) => x.status === 'fail' && x.hard)
  if (decisive) return { status: 'fail', layer: decisive.via === 'ocr' ? 'ocr' : 'probe', probes, fix: decisive.fix || null }
  if (probes.some((x) => x.wantsOcr)) return { status: 'needs_ocr', probes }
  if (spec.sufficient && probes.every((x) => x.status === 'pass')) {
    return { status: 'pass', layer: probes.some((x) => x.via === 'ocr') ? 'ocr' : 'probe', probes, fix: null }
  }
  const soft = probes.find((x) => x.status === 'fail')
  return { status: 'judge', probes, fix: soft?.fix || null }
}

/** One or two sentences both parties read, built from the probe results alone. */
export function explain(result) {
  if (result.status === 'fail') {
    const f = result.probes.find((x) => x.status === 'fail' && x.hard)
    return `${f.observed}${f.fix ? ` ${f.fix}` : ''}`
  }
  const parts = result.probes.map((x) => x.observed.replace(/\.$/, ''))
  return `Met — ${parts.join('; ')}.`
}
