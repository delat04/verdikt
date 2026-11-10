/*  ============================================================================
    Evidence gathering — everything the verdict is allowed to rely on.
    Site: a real browser at 1440px and 375px (screenshots, status, console errors,
    failed requests, layout overflow, LCP, visible text, page head, images, links, optional
    form test), plus whatever the signed checks' probes ask for: selectors to count, sub-pages
    to open, an axe-core accessibility scan, a link check. One browser session serves them all.
    Every page renders in a pinned environment (en-US, UTC, light). On Kernel the session is recorded, and
    marks say where in the video each view opens and where its measurements were taken. Where it ran (env)
    and the recording (replay) come back beside the evidence, never inside the views the receipt hashes.
    Repo: the public GitHub repository (tree, README, manifest, key source files, files probes name).
    ============================================================================ */

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { chromium } from 'playwright-core'
import { globRe } from './probes.js'
import { kernelOn, cloudBrowser, fillScreen, phoneWindow, focusPage } from '../lib/kernel.js'

const AXE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8')

// label: the view's chapter in the recording
const VIEWS = [
  { name: 'desktop', label: 'Desktop · 1440px', width: 1440, height: 900, isMobile: false },
  { name: 'mobile', label: 'Phone · 375px', width: 375, height: 812, isMobile: true },
]
// every page renders the same wherever its browser runs (Kernel's region or this server): dates, number
// formats and prefers-color-scheme don't depend on the machine
const PINNED = { locale: 'en-US', timezoneId: 'UTC', colorScheme: 'light' }
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

// boxes: where the recording's outlines go (narrate), in document coordinates. Only for the video: the caller
// takes them out before anything is stored, so they never reach the views the receipt hashes
async function collect(page, selectors = []) {
  return page.evaluate((selectors) => {
    const vw = document.documentElement.clientWidth
    const boxes = []
    const boxed = []
    const box = (el, label, tone) => {
      const r = el.getBoundingClientRect()
      if (!r.width || !r.height) return false
      boxes.push({ x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height, label, tone })
      boxed.push(el)
      return true
    }
    const offenders = []
    let outlined = 0
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect()
      if (r.width > 0 && r.right > vw + 1) {
        const cls = typeof el.className === 'string' && el.className.trim() ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}` : ''
        offenders.push(`${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${cls}  width ${Math.round(r.width)}px, right edge ${Math.round(r.right)}px > viewport ${vw}px`)
        // one outline per too-wide block: what's inside the card is the card's overflow, not five more labels on it
        if (outlined < 5 && !boxed.some((b) => b.contains(el)) && box(el, `${Math.round(r.width)}px wide · screen ${vw}px`, 'fail')) outlined += 1
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
    let hiddenBoxes = 0
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
      if (hidden || tiny || offscreen || camouflaged) {
        concealed.push(text.slice(0, 300))
        if (hiddenBoxes < 5 && !boxed.includes(el) && box(el, 'Hidden text', 'hidden')) hiddenBoxes += 1
      }
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
      boxes,
    }
  }, selectors)
}

/** Outlines for what axe flagged: the first target of up to 3 violations, skipping selectors the page can't resolve. */
async function axeBoxes(page, axe) {
  const targets = (axe?.violations || []).slice(0, 3).map((v) => ({ id: v.id, sel: v.targets?.[0] })).filter((t) => t.sel)
  if (!targets.length) return []
  return page.evaluate((targets) => targets.flatMap(({ id, sel }) => {
    let el = null
    try { el = document.querySelector(sel) } catch { return [] }
    const r = el?.getBoundingClientRect()
    return r?.width && r.height ? [{ x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height, label: `axe: ${id}`, tone: 'note' }] : []
  }), targets).catch(() => [])
}

const TONE = {
  fail: { border: '2px solid #E5484D', tag: '#E5484D' },
  hidden: { border: '2px dashed #E5484D', tag: '#E5484D' },
  note: { border: '2px solid #111', tag: '#111' },
}

/**
 * The recording's commentary on one view: a caption bar saying what was measured, and outlines around what it
 * was measured on. Runs only after the view's evidence (facts, screenshot, axe) is taken, and leaves nothing
 * behind: the overlay is a closed shadow root on <html> (never inside body, so body.innerText can't see it),
 * removed before anything else reads the page. A page that refuses it (CSP, odd DOM) just isn't narrated.
 * @param {object} page
 * @param {object} what  { caption, boxes: [{ x, y, w, h, label, tone: 'fail' | 'hidden' | 'note' }] }
 */
async function narrate(page, { caption, boxes = [] }) {
  let host = null
  try {
    host = await page.evaluateHandle(({ caption, boxes, TONE }) => {
      const el = (style, text) => {
        const d = document.createElement('div')
        d.style.cssText = style
        if (text) d.textContent = text
        return d
      }
      const host = el('position:absolute;left:0;top:0;width:0;height:0;z-index:2147483647;pointer-events:none')
      host.setAttribute('aria-hidden', 'true')
      const root = host.attachShadow({ mode: 'closed' })
      for (const b of boxes) {
        const t = TONE[b.tone] || TONE.note
        const frame = el(`position:absolute;box-sizing:border-box;left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px;border:${t.border}`)
        // the tag sits above the outline, or inside it when the outline starts at the top of the page. Sizes are for
        // the video: a 1440px frame is watched about 800px wide, so 16px here reads as about 9px there
        frame.append(el(`position:absolute;left:-2px;${b.y >= 26 ? 'bottom:100%' : 'top:0'};background:${t.tag};color:#fff;font:400 16px/1.4 system-ui, sans-serif;padding:1px 6px;white-space:nowrap`, b.label))
        root.append(frame)
      }
      // as wide as the screen: on a phone, a page wider than the screen widens what right:0 means
      root.append(el(`position:fixed;top:0;left:0;right:0;max-width:${document.documentElement.clientWidth}px;box-sizing:border-box;padding:10px 14px;background:#111;color:#fff;font:400 20px/1.35 system-ui, sans-serif`, caption))
      document.documentElement.append(host)
      return host
    }, { caption, boxes: boxes.slice(0, 10), TONE })
    const first = boxes[0]
    if (first && await page.evaluate((y) => y > scrollY + innerHeight - 60, first.y)) {
      await page.evaluate((top) => window.scrollTo({ top, behavior: 'smooth' }), Math.max(0, first.y - 120))
      await page.waitForTimeout(900)
    }
    await page.waitForTimeout(1400)
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
  } catch {
    // narration is for the viewer: it never fails a check
  } finally {
    await host?.evaluate((h) => h.remove()).catch(() => {})
    await host?.dispose().catch(() => {})
  }
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
 * What one view measured, in a line: the label of its 'measure' mark in the recording.
 * @param {object} view  an entry of VIEWS
 * @param {object} [v]   what inspectSite stored for that view (out.views[view.name])
 * @returns {string} e.g. 'Measured at 1440px: HTTP 200 in 1.2 s', 'Measured at 375px: page is 412px wide, screen is 375px'
 */
export function measureLabel(view, v) {
  const at = `Measured at ${view.width}px`
  if (!v || v.error) return `${at}: the page didn’t load`
  const fact = view.isMobile
    ? v.layout.scrollWidth > v.layout.viewport + 1 ? `page is ${v.layout.scrollWidth}px wide, screen is ${v.layout.viewport}px` : 'nothing wider than the screen'
    : `${v.status ? `HTTP ${v.status}` : 'no HTTP status'} in ${(v.loadMs / 1000).toFixed(1)} s`
  const n = v.concealed?.length || 0
  return `${at}: ${fact}${n ? ` · ${n} hidden text block${n > 1 ? 's' : ''}` : ''}`
}

/**
 * Scripts only: answer some requests from a fixed map instead of the network, in one browser context. Lets
 * record-samples.js check the demo's sample pages at the address they're published at, before that address
 * serves them. A key is a URL (GET) or 'METHOD URL'; every other request goes to the network as usual.
 * @param {object} context  a Playwright BrowserContext
 * @param {Map|object} [serve]  { [key]: { status, contentType, body } }
 */
async function serveFrom(context, serve) {
  const map = serve instanceof Map ? serve : new Map(Object.entries(serve || {}))
  if (!map.size) return
  await context.route('**/*', (route) => {
    const req = route.request()
    const hit = map.get(`${req.method()} ${req.url()}`) || (req.method() === 'GET' ? map.get(req.url()) : null)
    const done = hit ? route.fulfill({ status: hit.status ?? 200, contentType: hit.contentType, body: hit.body }) : route.continue()
    return done.catch(() => {})   // the context closed first: nothing is waiting for this request any more
  })
}

// a browser that went away mid-run (Kernel's session ended, the CDP socket dropped, the local Chrome died) says
// nothing about the site. A renderer crash with the browser still up ('Target crashed', a page 'crash' event)
// is the site's doing, and stays evidence
const LOST = /browser has disconnected|Browser has been closed|WebSocket|ECONNRESET|socket hang up/i

/**
 * Every view and sub-page of one run, on one browser, into out. Stops at the first sign the browser itself is
 * gone: what it collected up to then is never used, so a lost browser can't become a page that "did not load".
 * @param {object} browser  a connected Playwright Browser
 * @param {object} [cloud]  the Kernel session (cloudBrowser), null when local
 * @param {object} out      the run's evidence, filled in place
 * @param {object} ctx      { url, plan, step, narrate, serve }
 * @returns {Promise<{ infra: { at: string, reason: 'browser_lost' } } | null>} infra when the browser was lost,
 *   at naming the view or sub-page it was on
 */
async function collectAll(browser, cloud, out, { url, plan, step, narrate: narrateOpt = false, serve = null }) {
  // the recording is narrated; a local run only when a test asks (to prove narration changes no evidence)
  const narrating = !!cloud?.recording || narrateOpt === true
  const runStart = Date.now()
  let lost = false
  browser.on('disconnected', () => { lost = true })
  const infra = (e, crashed = false) => lost || !browser.isConnected() || (!crashed && LOST.test(e?.message || ''))
  const stopped = (at) => ({ infra: { at, reason: 'browser_lost' } })
  let at = null
  try {
    for (const v of VIEWS) {
      at = v.name
      await step({ step: v.name })
      const consoleErrors = []
      const failedRequests = []
      let context = null
      let crashed = false
      let measured = false
      try {
        context = await browser.newContext({ viewport: { width: v.width, height: v.height }, isMobile: v.isMobile, deviceScaleFactor: 1, ...PINNED })
        await serveFrom(context, serve)
        const page = await context.newPage()
        page.on('crash', () => { crashed = true })
        // in the recording: the desktop window fills the screen, the phone one is centred; the chapter starts once it's up
        if (cloud) await (v.isMobile ? phoneWindow(page) : fillScreen(page))
        cloud?.mark('view', v.label, { view: v.name })
        page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 300)) })
        page.on('pageerror', (e) => consoleErrors.push(String(e.message).slice(0, 300)))
        page.on('response', (r) => { if (r.status() >= 400) failedRequests.push(`${r.request().method()} ${r.url()} → ${r.status()}`) })
        page.on('requestfailed', (r) => failedRequests.push(`${r.method()} ${r.url()} → ${r.failure()?.errorText}`))

        const started = Date.now()
        const res = await page.goto(url, { waitUntil: 'load', timeout: 30000 })
        if (cloud) await focusPage(page)
        await page.waitForTimeout(1200)
        const { boxes, ...facts } = await collect(page, plan.queries || [])
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
        // this view's evidence is complete: the moment in the recording that shows what was measured
        const label = measureLabel(v, out.views[v.name])
        cloud?.mark('measure', label, { view: v.name })
        measured = true
        // ...and that moment points at it. Drawn only now, so no outline is in any screenshot or fact above. Not
        // past 180 s of the run: the recording stops at 240 s, and the rest of the check needs the time
        if (narrating && Date.now() - runStart <= 180000) {
          const shown = v.name === 'desktop' ? [...boxes, ...await axeBoxes(page, out.axe)] : boxes
          await narrate(page, { caption: `Verdikt verifier · ${v.label} · ${label.replace(/^Measured at \d+px: /, '')}`, boxes: shown })
        }
        // the form test changes the page, so it runs after everything else has been read
        if (plan.form && v.name === 'desktop' && facts.hasForm) {
          await step({ step: 'form' })
          cloud?.mark('form', 'Form test', { view: 'desktop' })
          out.form = await tryForm(page).catch((e) => {
            if (infra(e, crashed)) throw e
            return { error: e.message }
          })
        }
      } catch (e) {
        if (infra(e, crashed)) return stopped(v.name)
        out.views[v.name] = { error: e.message.split('\n')[0], consoleErrors, failedRequests }
        // a page that didn't load gets its moment in the recording too: what was on screen when it gave up
        if (!measured) cloud?.mark('measure', measureLabel(v, out.views[v.name]), { view: v.name })
      } finally {
        await context?.close().catch(() => {})
      }
      // a disconnect can land between two calls without failing either: never start the next view on it
      if (lost || !browser.isConnected()) return stopped(v.name)
    }
    // sub-pages the checks name, same site only
    const origin = new URL(url).origin
    for (const path of plan.paths || []) {
      at = path
      await step({ step: 'page', path })
      let context = null
      let crashed = false
      try {
        context = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...PINNED })
        await serveFrom(context, serve)
        const page = await context.newPage()
        page.on('crash', () => { crashed = true })
        if (cloud) await fillScreen(page)
        cloud?.mark('page', path, { path })
        const res = await page.goto(new URL(path, origin).href, { waitUntil: 'load', timeout: 20000 })
        if (cloud) await focusPage(page)
        await page.waitForTimeout(600)
        out.subpages[path] = { status: res?.status() ?? null, title: await page.title(), text: (await page.evaluate(() => document.body?.innerText || '')).slice(0, 6000) }
      } catch (e) {
        if (infra(e, crashed)) return stopped(path)
        out.subpages[path] = { error: e.message.split('\n')[0] }
      } finally {
        await context?.close().catch(() => {})
      }
      if (lost || !browser.isConnected()) return stopped(path)
    }
  } catch (e) {
    if (infra(e)) return stopped(at)
    out.error = e.message.split('\n')[0]
  }
  return null
}

/**
 * @param {object}   [plan]          from probes.planFor: { queries, paths, links, axe, form }
 * @param {object}   [opts]
 * @param {boolean}  [opts.record]   an official verification: it runs on Kernel and is recorded (lib/kernel.js)
 * @param {string}   [opts.kind]     what the run is ('verify', 'precheck', 'smoke'): names and tags the Kernel session
 * @param {string}   [opts.ref]      what it is for, usually the submission id: names and tags the Kernel session
 * @param {Function} [opts.onStep]   (detail) as the run moves on, for live progress: { step: 'open', browser, recording }
 *   (on Kernel once while its browser starts, again once it has), then { step: 'desktop' }, { step: 'mobile' },
 *   { step: 'form' }, { step: 'page', path }. Awaited, one call at a view boundary; its errors are ignored. After a
 *   lost browser the sequence starts again from 'open'.
 * @param {boolean}  [opts.narrate]  tests only: narrate a local run too (a recorded one always is): caption and
 *   outlines drawn after each view's evidence, which must leave that evidence unchanged
 * @param {Map|object} [opts.serve] scripts only: requests answered from a map instead of the network, in every
 *   context the run opens ({ [url | 'METHOD url']: { status, contentType, body } }; see serveFrom)
 * @param {Function} [opts.launch]   tests only: () => a local Playwright Browser
 * @returns {Promise<object>} site evidence; never throws for a broken site — that is evidence too. Where it ran is
 *   in env ({ kind, region, chrome, fallback, retry }) and the recording, with its marks, in replay (null when local).
 *   Neither is in views, which the receipt hashes. When the browser itself is lost mid-run, the whole check runs
 *   once more in a new one and env.retry says where the first stopped ({ at, reason: 'browser_lost' }).
 * @throws {Error} with infra: true when the second browser is lost too: nothing about the site was decided
 */
export async function inspectSite(url, plan = {}, { record = false, kind = 'verify', ref = '', onStep = () => {}, narrate = false, serve = null, launch = () => chromium.launch(launchOptions()) } = {}) {
  const step = async (d) => {
    try {
      await onStep(d)
    } catch {
      // live progress is cosmetic: it never stops a check
    }
  }

  // a recorded run happens in Kernel's cloud, so it doesn't wait for this server's browser slot. When Kernel
  // can't start a browser, the run goes local and the reason is kept (env.fallback): the evidence is the same
  const start = async (onKernel) => {
    let cloud = null
    let fallback = null
    if (onKernel) {
      await step({ step: 'open', browser: 'kernel', recording: false })
      try {
        // an official check waits up to a minute for a Kernel slot (KERNEL_MAX_BROWSERS); anything else doesn't
        cloud = await cloudBrowser({ record: true, kind, ref, wait: kind === 'verify' ? 60_000 : 0 })
      } catch (e) {
        fallback = e.reason || 'create_failed'
        console.warn('inspect: checking locally,', e.message)
      }
    }
    const release = cloud ? () => {} : await slot()
    let browser
    try {
      browser = cloud ? cloud.browser : await launch()
    } catch (e) {
      release()
      throw e
    }
    return { cloud, browser, release, fallback }
  }
  // finish() never throws: a missing video comes back as replay.reason, never as a failed check
  const stop = async ({ cloud, browser, release }) => {
    try {
      if (cloud) return await cloud.finish()
      await browser.close().catch((e) => console.warn('inspect: browser did not close,', e.message.split('\n')[0]))
      return null
    } finally {
      release()
    }
  }
  // one run's evidence, from scratch: a retry never carries anything over from the browser that was lost
  const run = async (att, { fallback = att.fallback, retry = null } = {}) => {
    const env = {
      kind: att.cloud ? 'kernel' : 'local',
      region: att.cloud?.region ?? null,
      chrome: String(att.browser.version()).split('.')[0] || null,
      fallback,
      retry,
    }
    // browser repeats env.kind: the verdict's report.site still reads it
    const out = { url, views: {}, form: null, subpages: {}, links: null, axe: null, error: null, browser: env.kind, env, replay: null }
    await step({ step: 'open', browser: env.kind, recording: !!att.cloud?.recording })
    let stopped = null
    try {
      stopped = await collectAll(att.browser, att.cloud, out, { url, plan, step, narrate, serve })
    } finally {
      const replay = await stop(att)
      if (!stopped) out.replay = replay
    }
    return { out, stopped }
  }

  const first = await start(record && kernelOn())
  let { out, stopped } = await run(first)
  if (stopped) {
    // one verdict, one session: the first run's evidence and recording are dropped, and the whole check runs
    // again in a new browser, on Kernel again when the first was (locally if Kernel can't start one now)
    const retry = stopped.infra
    console.warn(`inspect: the browser was lost at ${retry.at}, running the check again`)
    const second = await start(!!first.cloud && kernelOn())
    ;({ out, stopped } = await run(second, { fallback: second.cloud ? null : second.fallback ?? first.fallback, retry }))
    if (stopped) throw Object.assign(new Error('The verifier’s browser stopped twice'), { infra: true, at: [retry.at, stopped.infra.at] })
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
