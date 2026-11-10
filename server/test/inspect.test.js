/*  ============================================================================
    The verifier's browser (agent/inspect.js) on a local Chrome against a local fixture: evidence is
    deterministic, narrating the recording changes none of it, and a browser lost mid-run is run again
    instead of becoming a failed check. No keys, no Kernel session: the Kernel path's own failures are in
    kernel.test.js. Needs Chrome (or CHROME_PATH); without one every test here is skipped, not failed.
    About 30-60 s: each view waits for the page to settle, and narration holds each view on screen.
    ============================================================================ */

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { chromium } from 'playwright-core'
import { inspectSite } from '../src/agent/inspect.js'

const OVERFLOW = readFileSync(new URL('./fixtures/overflow.html', import.meta.url))
const plan = { axe: true, form: true }

// the same browser inspect.js launches: CHROME_PATH (Docker), else the installed Chrome
const launchOptions = () => (process.env.CHROME_PATH
  ? { executablePath: process.env.CHROME_PATH, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] }
  : { channel: 'chrome' })
const launchChrome = () => chromium.launch({ ...launchOptions(), headless: true })

let server, base
let chrome = true
before(async () => {
  try {
    await (await launchChrome()).close()
  } catch {
    chrome = false
  }
  // GET / is the fixture; everything else, the form's POST /api/subscribe included, is a 404
  server = http.createServer((req, res) => {
    if (req.method === 'GET' && (req.url === '/' || req.url === '/pricing')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      return res.end(OVERFLOW)
    }
    res.writeHead(404, { 'content-type': 'text/plain' })
    res.end('not found')
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${server.address().port}`
})
after(() => server?.close())

const sha = (buf) => createHash('sha256').update(buf).digest('hex')

/** Closed shadow roots on the page: narration draws in one, and nothing else on the fixture has any. */
async function closedShadows(page) {
  const cdp = await page.context().newCDPSession(page)
  const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true })
  let n = 0
  const walk = (node) => {
    for (const s of node.shadowRoots || []) { if (s.shadowRootType === 'closed') n += 1; walk(s) }
    for (const c of node.children || []) walk(c)
    if (node.contentDocument) walk(node.contentDocument)
  }
  walk(root)
  await cdp.detach().catch(() => {})
  return n
}

/**
 * A local Chrome whose pages report what narration left on them: during the 1.4 s each narrated view is held
 * on screen, the overlay count; just before each context closes, the overlay count left behind.
 */
function watchedLaunch() {
  const seen = { during: [], left: [], held: 0 }
  const launch = async () => {
    const browser = await launchChrome()
    const newContext = browser.newContext.bind(browser)
    browser.newContext = async (...args) => {
      const context = await newContext(...args)
      const close = context.close.bind(context)
      context.close = async () => {
        for (const p of context.pages()) seen.left.push(await closedShadows(p).catch(() => -1))
        return close()
      }
      const newPage = context.newPage.bind(context)
      context.newPage = async () => {
        const page = await newPage()
        const wait = page.waitForTimeout.bind(page)
        page.waitForTimeout = async (ms) => {
          if (ms === 1400) {
            seen.held += 1
            seen.during.push(await closedShadows(page))
          }
          return wait(ms)
        }
        return page
      }
      return context
    }
    return browser
  }
  return { launch, seen }
}

/** launches[i] = the newContext call (1-based) on which the i-th browser closes itself first, or 0 to live. */
function dyingLaunch(plan) {
  const launched = []
  const launch = async () => {
    const browser = await launchChrome()
    const dieAt = plan[launched.length] ?? 0
    launched.push(browser)
    let calls = 0
    const real = browser.newContext.bind(browser)
    browser.newContext = async (...args) => {
      calls += 1
      if (calls === dieAt) await browser.close()
      return real(...args)
    }
    return browser
  }
  return { launch, launched }
}

test('the fixture shows what it says: overflow at 375px, concealed text, a form answered 404', async (t) => {
  if (!chrome) return t.skip('Chrome not available')
  const out = await inspectSite(`${base}/`, plan, { launch: launchChrome })
  assert.equal(out.error, null)
  assert.equal(out.env.kind, 'local')
  assert.equal(out.replay, null)
  assert.equal(out.views.desktop.status, 200)
  assert.equal(out.views.mobile.status, 200)
  assert.ok(out.views.mobile.layout.offenders.some((o) => o.includes('pricing-card')), out.views.mobile.layout.offenders.join('\n'))
  assert.ok(out.views.desktop.concealed.some((s) => s.includes('Hidden fixture paragraph')), JSON.stringify(out.views.desktop.concealed))
  assert.ok(out.form?.responses.some((r) => r.includes('/api/subscribe → 404')), JSON.stringify(out.form?.responses))
  assert.ok(out.axe.violations.some((v) => v.id === 'color-contrast'))
})

test('two plain runs give the same layout, offenders, concealed text and form responses', async (t) => {
  if (!chrome) return t.skip('Chrome not available')
  const a = await inspectSite(`${base}/`, plan, { launch: launchChrome })
  const b = await inspectSite(`${base}/`, plan, { launch: launchChrome })
  assert.deepEqual(b.views.mobile.layout, a.views.mobile.layout)
  assert.deepEqual(b.views.mobile.layout.offenders, a.views.mobile.layout.offenders)
  for (const name of ['desktop', 'mobile']) assert.deepEqual(b.views[name].concealed, a.views[name].concealed, `${name} concealed`)
  assert.deepEqual(b.form.responses, a.form.responses)
})

test('narration changes no evidence, is drawn on both views, and leaves nothing behind', async (t) => {
  if (!chrome) return t.skip('Chrome not available')
  const plain = watchedLaunch()
  const told = watchedLaunch()
  const a = await inspectSite(`${base}/`, plan, { launch: plain.launch, narrate: false })
  const b = await inspectSite(`${base}/`, plan, { launch: told.launch, narrate: true })

  for (const out of [a, b]) {
    assert.equal(out.error, null)
    for (const name of ['desktop', 'mobile']) {
      assert.ok(!out.views[name].error, out.views[name].error)
      assert.ok(!('boxes' in out.views[name]), 'the outlines\' boxes never reach the views')
    }
  }
  for (const name of ['desktop', 'mobile']) {
    assert.equal(sha(b.views[name].screenshot), sha(a.views[name].screenshot), `${name} screenshot`)
    assert.equal(b.views[name].text, a.views[name].text, `${name} text`)
    assert.deepEqual(b.views[name].layout.offenders, a.views[name].layout.offenders, `${name} offenders`)
    assert.deepEqual(b.views[name].concealed, a.views[name].concealed, `${name} concealed`)
  }
  assert.deepEqual(b.form.responses, a.form.responses)
  assert.deepEqual(b.form.newText, a.form.newText)
  assert.ok(!b.form.newText.join('\n').includes('Verdikt verifier'), 'the caption leaked into the form test')
  assert.equal(sha(b.form.screenshot), sha(a.form.screenshot), 'form screenshot')
  assert.deepEqual(b.axe.violations.map((v) => v.id), a.axe.violations.map((v) => v.id))

  // drawn on both views when asked, never otherwise; removed before the form test and before each context closed
  assert.equal(plain.seen.held, 0)
  assert.equal(told.seen.held, 2)
  assert.deepEqual(told.seen.during, [1, 1])
  assert.deepEqual(told.seen.left, [0, 0])
  assert.deepEqual(plain.seen.left, [0, 0])
})

test('a view is narrated only after its evidence, never on a sub-page', () => {
  const src = readFileSync(new URL('../src/agent/inspect.js', import.meta.url), 'utf8')
  const body = src.slice(src.indexOf('async function collectAll'), src.indexOf('// sub-pages the checks name'))
  const at = (s) => { const i = body.indexOf(s); assert.ok(i > 0, `${s} is not in collectAll`); return i }
  assert.ok(at('page.screenshot(') < at('runAxe('))
  assert.ok(at('runAxe(') < at("cloud?.mark('measure'"))
  assert.ok(at("cloud?.mark('measure'") < at('narrate('))
  assert.ok(at('narrate(') < at('tryForm('))
  assert.ok(!src.slice(src.indexOf('// sub-pages the checks name'), src.indexOf('export async function inspectSite')).includes('narrate('))
})

test('the browser lost on the phone view: the whole check runs again in a new one, nothing fails', async (t) => {
  if (!chrome) return t.skip('Chrome not available')
  t.mock.method(console, 'warn', () => {})
  // the first browser closes itself on its second newContext call: the 375px view
  const { launch, launched } = dyingLaunch([2, 0])
  const steps = []
  const out = await inspectSite(`${base}/`, { paths: ['/pricing'] }, { launch, onStep: (d) => steps.push(d.step) })
  assert.equal(launched.length, 2)
  assert.deepEqual(out.env.retry, { at: 'mobile', reason: 'browser_lost' })
  assert.equal(out.env.kind, 'local')
  assert.equal(out.error, null)
  assert.equal(out.views.desktop.status, 200)
  assert.equal(out.views.mobile.status, 200)
  assert.equal(out.subpages['/pricing'].status, 200)
  for (const v of Object.values(out.views)) assert.ok(!('infra' in v))
  // the second run starts over from 'open'
  assert.deepEqual(steps, ['open', 'desktop', 'mobile', 'open', 'desktop', 'mobile', 'page'])
  for (const b of launched) assert.equal(b.isConnected(), false, 'every browser is closed')
})

test('both browsers lost: inspectSite rejects with infra, never a verdict about the site', async (t) => {
  if (!chrome) return t.skip('Chrome not available')
  t.mock.method(console, 'warn', () => {})
  const { launch, launched } = dyingLaunch([2, 1])
  await assert.rejects(inspectSite(`${base}/`, {}, { launch }), (e) => {
    assert.equal(e.infra, true)
    assert.equal(e.message, 'The verifier’s browser stopped twice')
    return true
  })
  assert.equal(launched.length, 2)
  for (const b of launched) assert.equal(b.isConnected(), false)
})

test('serve answers the published address from a map: the sample page, its form POST as a 404, nothing else', async (t) => {
  if (!chrome) return t.skip('Chrome not available')
  // nothing listens at this origin: every answer the run gets comes from the map (record-samples.js does this)
  const origin = 'https://samples.verdikt.invalid'
  const page = readFileSync(new URL('../../web/public/samples/northbrew-shop-v1.html', import.meta.url))
  const serve = new Map([
    [`${origin}/samples/northbrew-shop-v1.html`, { status: 200, contentType: 'text/html; charset=utf-8', body: page }],
    [`POST ${origin}/api/subscribe`, { status: 404, contentType: 'application/json', body: '{"error":"Not found"}' }],
  ])
  const out = await inspectSite(`${origin}/samples/northbrew-shop-v1.html`, { ...plan, queries: ['[class*=cart i]'] }, { launch: launchChrome, serve })
  assert.equal(out.error, null)
  assert.equal(out.views.desktop.status, 200)
  assert.equal(out.views.mobile.layout.scrollWidth, 412)
  assert.ok(out.views.mobile.layout.offenders[0].startsWith('div.pricing-card'), out.views.mobile.layout.offenders[0])
  assert.deepEqual(out.form.responses, ['POST /api/subscribe → 404'])
  assert.equal(out.views.desktop.queries['[class*=cart i]'].visible, 7)
  assert.deepEqual(out.views.desktop.consoleErrors, [])
})
