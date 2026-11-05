/*  ============================================================================
    Evidence gathering — everything the verdict is allowed to rely on.
    Site: a real browser at 1440px and 375px (screenshots, status, console errors,
    failed requests, layout overflow, LCP, visible text, optional form test).
    Repo: the public GitHub repository (tree, README, manifest, key source files).
    ============================================================================ */

import { chromium } from 'playwright-core'

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

async function collect(page) {
  return page.evaluate(() => {
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
    return {
      viewport: vw,
      scrollWidth: document.documentElement.scrollWidth,
      offenders,
      concealed,
      text: document.body?.innerText || '',
      title: document.title,
      hasForm: !!document.querySelector('form'),
    }
  })
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

/** @returns {Promise<object>} site evidence; never throws for a broken site — that is evidence too */
export async function inspectSite(url, { testForm = false } = {}) {
  const browser = await chromium.launch(launchOptions())
  const out = { url, views: {}, form: null, error: null }
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
        const facts = await collect(page)
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
          screenshot: await page.screenshot({ type: 'png', fullPage: true, clip: { x: 0, y: 0, width: v.width, height: Math.min(height, v.isMobile ? 2400 : 2700) } }),
        }
        if (testForm && v.name === 'desktop' && facts.hasForm) out.form = await tryForm(page).catch((e) => ({ error: e.message }))
      } catch (e) {
        out.views[v.name] = { error: e.message.split('\n')[0], consoleErrors, failedRequests }
      } finally {
        await context.close()
      }
    }
  } catch (e) {
    out.error = e.message.split('\n')[0]
  } finally {
    await browser.close()
  }
  return out
}

// ---------------------------------------------------------------- repository
const KEY_FILES = [/^index\.html$/, /^src\/(App|main|index)\.(vue|jsx?|tsx?)$/, /^(app|src\/app)\/page\.(jsx?|tsx?)$/, /^pages\/index\.(jsx?|tsx?|vue)$/, /^src\/pages\/index\.(astro|jsx?|tsx?)$/, /^vite\.config\.(js|ts)$/]

export async function inspectRepo(repoUrl) {
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
    return {
      repo: `${owner}/${repo}`,
      branch,
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
