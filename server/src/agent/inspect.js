/*  ============================================================================
    Evidence gathering — everything the verdict is allowed to rely on.
    Site: a real browser at 1440px and 375px (screenshots, status, console errors,
    failed requests, layout overflow, LCP, visible text, page head, images, links, optional
    form test), plus whatever the signed checks' probes ask for: selectors to count, sub-pages
    to open, an axe-core accessibility scan, a link check. One browser session serves them all.
    Repo: the public GitHub repository (tree, README, manifest, key source files, files probes name).
    ============================================================================ */

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { chromium } from 'playwright-core'
import { globRe } from './probes.js'

const AXE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8')

const VIEWS = [
  { name: 'desktop', width: 1440, height: 900, isMobile: false },
  { name: 'mobile', width: 375, height: 812, isMobile: true },
]
const MAX_TEXT = 15000
const MAX_FILE = 12000

function launchOptions() {
  // CHROME_PATH (Docker: /usr/bin/chromium) wins; locally fall back to the installed Chrome
  return process.env.CHROME_PATH
    ? { executablePath: process.env.CHROME_PATH, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] }
    : { channel: 'chrome' }
}

// a browser is the heaviest thing the server runs: verifications and pre-checks take turns
const MAX_BROWSERS = Number(process.env.VERDIKT_MAX_BROWSERS || 1)
let open = 0
const waiting = []
async function slot() {
  if (open >= MAX_BROWSERS) await new Promise((resolve) => waiting.push(resolve))
  open += 1
  return () => { open -= 1; waiting.shift()?.() }
}

async function collect(page, selectors = []) {
  return page.evaluate((selectors) => {
    const vw = document.documentElement.clientWidth
    const offenders = []
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect()
      if (r.width > 0 && r.right > vw + 1) {
        const cls = typeof el.className === 'string' && el.className.trim() ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}` : ''
        offenders.push(`${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${cls}  width ${Math.round(r.width)}px, right edge ${Math.round(r.right)}px > viewport ${vw}px`)
        if (offenders.length >= 10) break
      }
    }
    // text a person can't see but a model reading the page would: white-on-white, 1px type, off-screen, transparent
    const bgOf = (el) => {
      for (let n = el; n; n = n.parentElement) {
        const c = getComputedStyle(n).backgroundColor
        if (c && c !== 'transparent' && !/rgba\(.*,\s*0\)$/.test(c)) return c
      }
      return 'rgb(255, 255, 255)'
    }
    const concealed = []
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    while (walker.nextNode() && concealed.length < 25) {
      const text = walker.currentNode.textContent.replace(/\s+/g, ' ').trim()
      const el = walker.currentNode.parentElement
      if (text.length < 12 || !el || ['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE'].includes(el.tagName)) continue
      const cs = getComputedStyle(el)
      const r = el.getBoundingClientRect()
      const hidden = el.checkVisibility ? !el.checkVisibility({ opacityProperty: true, visibilityProperty: true }) : cs.visibility === 'hidden'
      const tiny = parseFloat(cs.fontSize) < 4 || (r.width < 2 && r.height < 2)
      const offscreen = r.right < 0 || r.bottom < -50 || r.left > document.documentElement.scrollWidth + 50
      const camouflaged = cs.color === bgOf(el)
      if (hidden || tiny || offscreen || camouflaged) concealed.push(text.slice(0, 300))
    }
    const shown = (el) => {
      const r = el.getBoundingClientRect()
      return r.width > 0 && r.height > 0 && (el.checkVisibility ? el.checkVisibility({ opacityProperty: true, visibilityProperty: true }) : true)
    }
    const queries = {}
    for (const sel of selectors) {
      try {
        const els = [...document.querySelectorAll(sel)]
        const vis = els.filter(shown)
        queries[sel] = { count: els.length, visible: vis.length, samples: vis.map((e) => (e.innerText || e.getAttribute('aria-label') || e.getAttribute('alt') || '').replace(/\s+/g, ' ').trim().slice(0, 60)).filter(Boolean).slice(0, 5) }
      } catch {
        queries[sel] = { invalid: true }
      }
    }
    const metaOf = (sel, attr = 'content') => document.querySelector(sel)?.getAttribute(attr)?.trim() || null
    const imgs = [...document.images]
    return {
      viewport: vw,
      scrollWidth: document.documentElement.scrollWidth,
      offenders,
      concealed,
      text: document.body?.innerText || '',
      title: document.title,
      hasForm: !!document.querySelector('form'),
      meta: {
        title: document.title.trim() || null,
        description: metaOf('meta[name="description" i]'),
        viewport: metaOf('meta[name="viewport" i]'),
        og_image: metaOf('meta[property="og:image" i]') || metaOf('meta[name="og:image" i]'),
        favicon: metaOf('link[rel~="icon" i]', 'href'),
        lang: document.documentElement.getAttribute('lang') || null,
      },
      images: {
        total: imgs.length,
        missingAlt: imgs.filter((i) => !i.hasAttribute('alt') && i.getAttribute('role') !== 'presentation').map((i) => { const src = i.currentSrc || i.src || ''; return src.startsWith('data:') ? '(inline image)' : src.split('/').pop().split('?')[0].slice(0, 60) || '(image)' }).slice(0, 10),
      },
      links: [...new Set([...document.querySelectorAll('a[href]')].map((a) => a.href).filter((h) => {
        try { const u = new URL(h); return u.origin === location.origin && !(u.pathname === location.pathname && u.hash) } catch { return false }
      }).map((h) => h.split('#')[0]))].slice(0, 25),
      queries,
    }
  }, selectors)
}

async function runAxe(page) {
  try {
    await page.evaluate(AXE)
    const res = await page.evaluate(() => window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] }, resultTypes: ['violations'] }))
    return { violations: res.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length, targets: v.nodes.slice(0, 3).map((n) => String(n.target?.[0] || '')) })) }
  } catch (e) {
    return { error: e.message.split('\n')[0] }
  }
}

async function checkLinks(urls) {
  const broken = []
  const one = async (u) => {
    let res = await fetch(u, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(8000) }).catch(() => null)
    if (!res || res.status === 405 || res.status === 403) res = await fetch(u, { redirect: 'follow', signal: AbortSignal.timeout(8000) }).catch((e) => ({ status: 0, err: e.name }))
    if (!res.status || res.status >= 400) broken.push(`GET ${new URL(u).pathname} → ${res.status || res.err || 'no answer'}`)
  }
  for (let i = 0; i < urls.length; i += 5) await Promise.all(urls.slice(i, i + 5).map(one))
  return { checked: urls.length, broken }
}

async function lcp(page) {
  return page.evaluate(() => new Promise((resolve) => {
    let value = null
    try {
      new PerformanceObserver((list) => {
        const entries = list.getEntries()
        value = entries[entries.length - 1]?.startTime ?? value
      }).observe({ type: 'largest-contentful-paint', buffered: true })
    } catch {}
    setTimeout(() => resolve(value), 400)
  }))
}

async function tryForm(page) {
  const form = page.locator('form').filter({ has: page.locator('input[type=email], input[name*=mail i]') }).first()
  if (!(await form.count())) return null
  const responses = []
  const onResponse = (r) => { if (['POST', 'PUT'].includes(r.request().method())) responses.push(`${r.request().method()} ${new URL(r.url()).pathname} → ${r.status()}`) }
  page.on('response', onResponse)
  const before = await page.evaluate(() => document.body.innerText)
  await form.locator('input[type=email], input[name*=mail i]').first().fill(`verdikt-check+${Date.now()}@example.com`)
  for (const input of await form.locator('input[required]:not([type=email]):not([type=hidden]):not([type=checkbox]), textarea[required]').all()) {
    await input.fill('Verdikt automated check').catch(() => {})
  }
  await form.locator('[type=submit], button:not([type=button])').first().click({ timeout: 4000 }).catch(() => form.evaluate((f) => f.requestSubmit()))
  await page.waitForTimeout(2500)
  page.off('response', onResponse)
  const after = await page.evaluate(() => document.body.innerText)
  const added = after.split('\n').filter((line) => line.trim() && !before.includes(line)).slice(0, 8)
  return { responses, newText: added, screenshot: await page.screenshot({ type: 'png' }) }
}

/**
 * @param {object} [plan] from probes.planFor: { queries, paths, links, axe, form }
 * @returns {Promise<object>} site evidence; never throws for a broken site — that is evidence too
 */
export async function inspectSite(url, plan = {}) {
  const release = await slot()
  const browser = await chromium.launch(launchOptions()).catch((e) => { release(); throw e })
  const out = { url, views: {}, form: null, subpages: {}, links: null, axe: null, error: null }
  try {
    for (const v of VIEWS) {
      const context = await browser.newContext({ viewport: { width: v.width, height: v.height }, isMobile: v.isMobile, deviceScaleFactor: 1 })
      const page = await context.newPage()
      const consoleErrors = []
      const failedRequests = []
      page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 300)) })
      page.on('pageerror', (e) => consoleErrors.push(String(e.message).slice(0, 300)))
      page.on('response', (r) => { if (r.status() >= 400) failedRequests.push(`${r.request().method()} ${r.url()} → ${r.status()}`) })
      page.on('requestfailed', (r) => failedRequests.push(`${r.method()} ${r.url()} → ${r.failure()?.errorText}`))

      try {
        const started = Date.now()
        const res = await page.goto(url, { waitUntil: 'load', timeout: 30000 })
        await page.waitForTimeout(1200)
        const facts = await collect(page, plan.queries || [])
        const height = await page.evaluate(() => document.documentElement.scrollHeight)
        out.views[v.name] = {
          status: res?.status() ?? null,
          loadMs: Date.now() - started,
          lcpMs: await lcp(page),
          consoleErrors: consoleErrors.slice(0, 15),
          failedRequests: failedRequests.slice(0, 15),
          layout: { viewport: facts.viewport, scrollWidth: facts.scrollWidth, offenders: facts.offenders },
          title: facts.title,
          text: facts.text,
          concealed: facts.concealed,
          meta: facts.meta,
          images: facts.images,
          links: facts.links,
          queries: facts.queries,
          screenshot: await page.screenshot({ type: 'png', fullPage: true, clip: { x: 0, y: 0, width: v.width, height: Math.min(height, v.isMobile ? 2400 : 2700) } }),
        }
        if (v.name === 'desktop' && plan.axe) out.axe = await runAxe(page)
        // the form test changes the page, so it runs after everything else has been read
        if (plan.form && v.name === 'desktop' && facts.hasForm) out.form = await tryForm(page).catch((e) => ({ error: e.message }))
      } catch (e) {
        out.views[v.name] = { error: e.message.split('\n')[0], consoleErrors, failedRequests }
      } finally {
        await context.close()
      }
    }
    // sub-pages the checks name, same site only
    const origin = new URL(url).origin
    for (const path of plan.paths || []) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
      const page = await context.newPage()
      try {
        const res = await page.goto(new URL(path, origin).href, { waitUntil: 'load', timeout: 20000 })
        await page.waitForTimeout(600)
        out.subpages[path] = { status: res?.status() ?? null, title: await page.title(), text: (await page.evaluate(() => document.body?.innerText || '')).slice(0, 6000) }
      } catch (e) {
        out.subpages[path] = { error: e.message.split('\n')[0] }
      } finally {
        await context.close()
      }
    }
  } catch (e) {
    out.error = e.message.split('\n')[0]
  } finally {
    await browser.close()
    release()
  }
  if (plan.links) out.links = await checkLinks(out.views.desktop?.links || [])
  return out
}

// ---------------------------------------------------------------- repository
const KEY_FILES = [/^index\.html$/, /^src\/(App|main|index)\.(vue|jsx?|tsx?)$/, /^(app|src\/app)\/page\.(jsx?|tsx?)$/, /^pages\/index\.(jsx?|tsx?|vue)$/, /^src\/pages\/index\.(astro|jsx?|tsx?)$/, /^vite\.config\.(js|ts)$/]

export async function inspectRepo(repoUrl, { files: wanted = [] } = {}) {
  const m = /github\.com\/([^/\s]+)\/([^/\s#?]+)/i.exec(repoUrl || '')
  if (!m) return { error: repoUrl ? 'Not a GitHub repository URL' : 'No repository submitted' }
  const [owner, repo] = [m[1], m[2].replace(/\.git$/, '')]
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'verdikt-verifier', ...(process.env.GITHUB_TOKEN && { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }) }
  const gh = async (path) => {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}${path}`, { headers })
    if (!res.ok) throw new Error(`GitHub ${res.status} for ${path || '/'}`)
    return res.json()
  }
  const raw = async (branch, path) => {
    const res = await fetch(`https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`)
    if (!res.ok) return null
    const text = await res.text()
    return text.length > MAX_FILE ? `${text.slice(0, MAX_FILE)}\n… [file truncated at ${MAX_FILE} characters of ${text.length}]` : text
  }
  try {
    const meta = await gh('')
    const branch = meta.default_branch
    const tree = await gh(`/git/trees/${branch}?recursive=1`)
    const paths = tree.tree.filter((t) => t.type === 'blob').map((t) => t.path)
    const files = {}
    for (const p of ['README.md', 'package.json']) if (paths.includes(p)) files[p] = await raw(branch, p)
    for (const p of paths.filter((x) => KEY_FILES.some((re) => re.test(x))).slice(0, 5)) files[p] = await raw(branch, p)
    // files the signed checks name (repo_contains probes)
    const extraFiles = {}
    for (const glob of wanted) {
      const re = globRe(glob)
      for (const p of paths.filter((x) => (re.test(x) || re.test(x.split('/').pop())) && !(x in files)).slice(0, 3)) extraFiles[p] = await raw(branch, p)
    }
    return {
      repo: `${owner}/${repo}`,
      branch,
      treeSha: tree.sha,
      extraFiles,
      private: meta.private,
      fileCount: paths.length,
      tree: paths.slice(0, 300),
      treeTruncated: paths.length > 300,
      envFilesCommitted: paths.filter((p) => /(^|\/)\.env(\.|$)/.test(p) && !p.endsWith('.example')),
      files,
    }
  } catch (e) {
    return { repo: `${owner}/${repo}`, error: e.message }
  }
}

export function clipText(text) {
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}\n… [page text truncated at ${MAX_TEXT} of ${text.length} characters]` : text
}
