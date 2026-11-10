/*  Records the demo's beats from the demo build, in step with the voice-over
    Reads demo/out/voice/timeline.json (voiceover.mjs) and plays each beat on http://localhost:5181 (the demo app,
    `vite --mode demo`), with every on-screen action waiting for the line it belongs to (a cue), so the picture
    lands on the words. Frames come from Chrome's screencast and are kept only while the camera rolls; set-up
    between beats happens off camera. Over the app it draws: a cursor and click ring, a "who is acting" chip in the
    corner (violet: the hirer, teal: the freelancer, grey: the verifier, as in the app's role bar) and a short
    switch card whenever the side changes. Encode with assemble.mjs.

    node demo/record.mjs                       every beat, on one fresh demo
    node demo/record.mjs fail guard pass       only these (each re-creates the state it needs off camera)
    APP=http://localhost:5181 overrides the app; frames go to demo/out/frames/<beat>/
*/
import { createRequire } from 'node:module'
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { MARK, ACCENT } from '../web/src/components/markPaths.js'

const { chromium } = createRequire(new URL('../server/package.json', import.meta.url))('playwright-core')
const here = new URL('.', import.meta.url)
const APP = process.env.APP || 'http://localhost:5181'
const FRAMES = fileURLToPath(new URL('out/frames/', here))
const TL = JSON.parse(await readFile(new URL('out/voice/timeline.json', here), 'utf8'))
const only = process.argv.slice(2)
const want = (id) => !only.length || only.includes(id)
const beatOf = (id) => TL.beats.find((b) => b.id === id) || fail(`no beat ${id} in timeline.json`)
if (TL.estimated) console.log('timeline.json is the estimate (no voice yet): a rehearsal')

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] })
const ctx = await browser.newContext({ viewport: { width: 1536, height: 864 }, deviceScaleFactor: 1.25 })
await ctx.addInitScript(() => { try { localStorage.setItem('verdikt-theme', 'light') } catch {} })
await ctx.addInitScript(OVERLAY)
const page = await ctx.newPage()
page.setDefaultTimeout(8000)   // a missing element fails the take fast, instead of freezing it
const errors = []
page.on('pageerror', (e) => errors.push(e.message))

// ---- the camera: CDP screencast frames, kept while rolling; scene time runs slower while a wait is sped up
const cdp = await ctx.newCDPSession(page)
let rolling = false, speed = 1, videoT = 0, wall = 0, frames = [], latest = null, beat = null, events = []
const tick = () => { const now = performance.now(); if (rolling) videoT += (now - wall) / 1000 / speed; wall = now }
cdp.on('Page.screencastFrame', ({ data, sessionId }) => {
  cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {})
  latest = Buffer.from(data, 'base64')
  if (rolling) { tick(); frames.push({ t: videoT, buf: latest }) }
})
await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 })

// Node's own timers: page.waitForTimeout runs through the browser and stalls while the page is busy drawing
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const roll = () => { tick(); rolling = true; wall = performance.now(); if (latest) frames.push({ t: videoT, buf: latest }) }
const cut = () => { tick(); rolling = false }
const fast = async (k) => { tick(); speed = k; await page.evaluate((k) => window.__vk.badge(k > 1 ? `Sped up ${k}×` : ''), k) }
/** wait until the scene clock reaches t seconds (the clock only runs while rolling) */
async function until(t) { for (;;) { tick(); if (videoT >= t || !rolling) return; await wait(Math.min(40, Math.max(5, (t - videoT) * 1000 * speed))) } }
/** wait for a cue of this beat (the start of its line), plus an offset */
const cue = (name, plus = 0) => { const t = beat.cues[name]; if (t == null) fail(`${beat.id}: no cue ${name}`); return until(t + plus) }

/** a sound at this moment of the take (the names are script.json's sfx library; assemble.mjs lays them in) */
const sfx = (name, plus = 0) => { tick(); if (rolling) events.push({ t: +(videoT + plus).toFixed(3), name }) }

async function scene(id, run) {
  if (!want(id)) return
  beat = beatOf(id)
  frames = []; videoT = 0; speed = 1; events = []
  try {
    await run()
    await until(beat.length)
  } catch (e) {
    await page.screenshot({ path: `${FRAMES}/${id}-fail.png` }).catch(() => {})
    console.log(`FAIL ${id}: ${e.message.split('\n')[0]}\n`, (await page.evaluate(() => document.querySelector('main')?.innerText || document.body.innerText).catch(() => '')).replace(/\n+/g, ' / ').slice(0, 1500))
    await browser.close()
    process.exit(1)
  }
  cut()
  if (speed !== 1) await fast(1)
  const over = videoT - beat.length
  const dir = `${FRAMES}/${id}`
  await rm(dir, { recursive: true, force: true }); await mkdir(dir, { recursive: true })
  for (const [i, f] of frames.entries()) await writeFile(`${dir}/${String(i).padStart(5, '0')}.jpg`, f.buf)
  await writeFile(`${dir}/times.json`, JSON.stringify({ length: videoT, times: frames.map((f) => f.t), events }))
  console.log(`${id.padEnd(7)} ${String(frames.length).padStart(4)} frames  ${videoT.toFixed(1)} s of ${beat.length.toFixed(1)} s${over > 0.4 ? `  OVER by ${over.toFixed(1)} s` : ''}`)
}

// ---- a visible cursor, and the in-page helpers
async function point(target, ms = 600) {
  // a pointer that can't find its target gives up in 2 s: on camera, a long wait shows as a freeze
  const box = await target.boundingBox({ timeout: 2000 })
  if (!box) throw new Error('nothing to point at')
  await page.evaluate(({ x, y, ms }) => window.__vk.move(x, y, ms), { x: box.x + box.width / 2, y: box.y + box.height / 2, ms })
  await wait(ms + 40)
}
async function click(target, { after = 350, ms = 600, dispatch = false } = {}) {
  await target.scrollIntoViewIfNeeded()
  await point(target, ms)
  await page.evaluate(() => window.__vk.press())
  sfx('click')
  // dispatch: the click goes straight to the element, for one a passing toast or animation keeps 'not stable'
  if (dispatch) await target.dispatchEvent('click'); else await target.click()
  await wait(after)
}
async function type(target, text, { delay = 45, ms = 600 } = {}) {
  await click(target, { after: 100, ms })
  await target.fill('')
  sfx('type')
  await target.pressSequentially(text, { delay })
}
const cursor = (on) => page.evaluate((on) => window.__vk.show(on), on)
const btn = (text) => page.locator('button:visible').filter({ hasText: text }).first()
const glide = async (to, ms) => { await page.evaluate(([to, ms]) => window.__vk.scroll(to, ms), [to, ms]); await wait(ms + 80) }
const center = async (target, ms = 800) => glide(await target.evaluate((el) => window.__vk.centerOf(el)), ms)
const toTop = () => page.evaluate(() => window.__vk.scroll(0, 0))
const slate = (html, tone) => page.evaluate(([html, tone]) => window.__vk.slate(html, tone), [html, tone])
/** the corner chip: who is acting on screen */
const actor = (role, text) => page.evaluate(([role, text]) => window.__vk.actor(role, text), [role, text])
/** the switch card, over the first moment of a beat whose side differs from the last one */
const card = (role, title, sub, sound = 'swoosh') => { if (sound) sfx(sound); return page.evaluate(([role, title, sub]) => window.__vk.card(role, title, sub), [role, title, sub]) }
const as = async (key) => { // off camera: the persona switch, through the role bar's own button when it's there
  await page.evaluate(async (key) => {
    const bar = document.querySelector(`.persona [data-role="${key}"]`)
    if (bar && !bar.classList.contains('is-active')) bar.click()
  }, key)
  await page.waitForFunction((key) => document.querySelector('.role')?.classList.contains(`role--${key}`), key, { timeout: 8000 })
  await wait(500)
}
const tab = async (name) => { await btn(new RegExp(`^${name}`)).click(); await wait(500) }
async function palette(text) { // off camera: the command palette
  await page.keyboard.press('Control+k'); await wait(400)
  await page.keyboard.type(text, { delay: 20 }); await wait(400)
  await page.keyboard.press('Enter'); await wait(1500)
}
const ROLE = { client: ['client', 'Maya · the hirer'], freelancer: ['freelancer', 'Sam · the freelancer'], verifier: ['verifier', "Verdikt's verifier · on neither side"], both: ['both', 'Both agents, each inside its own limits'] }
const chip = (b) => (b.role === 'none' ? actor(null, '') : actor(b.role, b.actor || ROLE[b.role]?.[1] || ''))

// ---------------------------------------------------------------- the story
await scene('hook', async () => {
  // a first load off camera compiles the landing's 3D shaders, so the recorded load runs without a stall
  await page.goto(APP + '/', { waitUntil: 'load' }); await wait(5000)
  await page.goto('about:blank')
  await page.goto(APP + '/', { waitUntil: 'domcontentloaded' })
  await cursor(false); await actor(null, '')
  await wait(250)
  roll()
  await until(2.4)
  const pin = await page.evaluate(() => {
    const el = document.getElementById('how'); const box = el.parentElement.classList.contains('pin-spacer') ? el.parentElement : el
    return { top: box.getBoundingClientRect().top + scrollY, h: innerHeight }
  })
  await glide(pin.top, 1500)
  sfx('riser', Math.max(0, beat.length - videoT - 3.4))
  await glide(pin.top + 0.93 * 3 * pin.h, Math.max(2500, (beat.length - videoT - 0.8) * 1000))
})

// off camera: Maya signs in
if (only.some((s) => s !== 'hook') || !only.length) {
  await page.goto(APP + '/login'); await btn(/Maya Chen/).click(); await page.waitForURL(/contracts|onboarding/); await wait(800)
}

await scene('limit', async () => {
  await page.goto(APP + '/settings'); await wait(900)
  await center(page.locator('#sl-cap'), 0); await wait(300)
  await cursor(true); await chip(beat)
  roll()
  await card('client', 'Maya, the hirer', 'Northbrew Coffee · funds the work and approves the money', 'impact')
  await until(1.6)
  await type(page.locator('#sl-cap'), '1000')
  await type(page.locator('#sl-job'), '700')
  await click(btn('28 days'), { after: 200 })
  await type(page.locator('#sl-note'), 'Website work for Northbrew', { delay: 32 })
  await cue('approve', 2.2)
  await click(btn(/Approve \$1,000\.00 on PayPal/), { after: 1800 })
  await click(btn('Approve the limit'), { after: 600 })
  sfx('ok')
})

await scene('hire', async () => {
  // the beat opens on the replay of a real Claude run over MCP (demo/mcp), timed to end as "Applications" starts
  const end = beat.cues.apps - 0.25
  await page.goto(pathToFileURL(await consoleHtml(end)).href)
  await page.evaluate(() => document.fonts.ready); await wait(300)
  await cursor(false); await chip(beat)
  roll()
  await page.evaluate(() => window.__play())
  await until(end)
  cut()
  await page.goto(APP + '/jobs'); await wait(1400); await toTop()
  await cursor(true); await chip(beat)
  roll()
  await cue('apps', 0.3)
  await point(page.getByText('agent', { exact: true }).first(), 600).catch(() => {})
  await cue('flag')
  const quick = page.locator('text=QuickBuild Studio').first()
  await center(quick, 900)
  sfx('alert', 0.3)
  await point(page.locator('text=Asks to pay or talk off Verdikt').first(), 600)
  await cue('hireSam', -0.6)
  await glide(0, 700)
  await click(btn('Hire and open the room'), { after: 300 })
})

// off camera, before the room is filmed: Sam hands his side to his own agent, so once Maya's starts the two bargain
// on screen and settle on their line
if (want('terms')) {
  await page.waitForSelector('text=Set up my agent', { timeout: 15000 })
  await as('freelancer')
  await btn('Set up my agent').click(); await wait(400)
  await page.locator('#mlimit').fill('540'); await page.locator('#mdays').fill('6')
  await page.locator('.mandate__auto input').check()
  await btn('Start negotiating').click()
  await page.waitForSelector('text=Your agent is negotiating', { timeout: 15000 }); await wait(300)
  await as('client')
  await page.waitForSelector('text=Set up my agent', { timeout: 15000 })
}

await scene('terms', async () => {
  await cursor(true); await chip(beat)
  roll()
  await click(btn('Set up my agent'), { after: 250, ms: 420 })
  await type(page.locator('#mlimit'), '560', { delay: 30, ms: 380 })
  await type(page.locator('#mdays'), '7', { delay: 30, ms: 320 })
  await type(page.locator('#mmust'), 'QR sign-up, stamp scanning', { delay: 14, ms: 320 })
  await page.locator('.mandate__auto input').check()
  await click(btn('Start negotiating'), { after: 150, ms: 380 })
  const typed = videoT
  await fast(12)
  await page.waitForSelector('text=Signing terms', { timeout: 90000 })
  // the signing view finishes drawing a moment after the agents settle: still sped up while it does
  await btn("How it's checked").waitFor({ timeout: 30000 })
  await fast(1)
  sfx('ok')
  console.log(`  terms: mandate typed by ${typed.toFixed(1)} s, settled at ${videoT.toFixed(1)} s (settle cue ${beat.cues.settle.toFixed(1)} s)`)
  await cue('settle', 1.2)
  // the settled price in the header
  await point(page.getByText('$550', { exact: false }).filter({ visible: true }).first(), 500).catch(() => {})
  await cue('checks', 0.2)
  // centred first: at the bottom of the screen the 'Terms locked' toast sits over it
  const how = btn("How it's checked")
  await center(how, 600)
  await click(how, { after: 300, dispatch: true })
  // off camera: the domain budget goes on before signing
  await cue('sign', -1.6)
  cut()
  await tab('Expenses')
  await page.locator('#xp-budget').fill('40')
  await page.locator('.xp__chip').filter({ hasText: 'Domain' }).first().click()
  await btn('Add expense budget').click(); await wait(1000)
  await toTop(); await wait(300)
  roll()
  await click(btn('Review & sign'), { after: 700, ms: 420 })
  await click(btn(/Sign as Maya/), { after: 400, ms: 420 })
  sfx('stamp', -0.3)
})

// off camera: Sam signs
if (want('fund')) {
  await as('freelancer'); await btn('Review & sign').click(); await wait(600); await btn(/Sign as Sam/).click(); await wait(1500)
  await as('client'); await toTop(); await wait(800)
}

await scene('fund', async () => {
  await cursor(true); await chip(beat)
  roll()
  await cue('fund', 0.4)
  await click(btn('Fund with PayPal'), { after: 1800 })
  await point(btn(/from my limit/), 500)
  await click(btn(/from my limit/), { after: 400 })
  sfx('money', 0.2)
})

// off camera: the shop contract, already running (the demo's sample contract), as Maya
if (want('list') || want('claim') || want('fail') || want('guard') || want('pass')) {
  await as('client').catch(() => {})
  await palette('Load a sample contract')
  await page.waitForURL(/\/contracts\/c_/)
  await wait(1200); await toTop()
}

await scene('list', async () => {
  await cursor(true); await chip(beat)
  roll()
  await until(1.2)
  await point(page.locator('text=Your move').first(), 700).catch(() => {})
  await cue('review', 0.2)
  await click(btn('Review the item'), { after: 700 })
  const printer = page.locator('text=Portable Mini Thermal Receipt Printer').first()
  await center(printer, 800)
  await point(printer, 600)
  await cue('agree', -0.2)
  await click(btn(/^Agree$/), { after: 300 })
  sfx('ok')
})

await scene('claim', async () => {
  cut()
  await as('freelancer')
  await tab('Expenses')
  await center(page.locator('text=2D Barcode Scanner').first(), 0); await wait(300)
  await cursor(true); await chip(beat)
  roll()
  await card('freelancer', "Sam's side, the freelancer", 'Okafor Studio · does the work and is paid when the checks pass')
  await until(2.0)
  await point(page.locator('text=2D Barcode Scanner').first(), 600)
  await cue('claim', -0.4)
  const sample = page.locator('button.link').filter({ hasText: /^scanner from the list$/ }).first()
  await center(sample, 600)
  await click(sample, { after: 300 })
  await click(btn(/^Claim/), { after: 900 })
  await cue('paid')
  sfx('money')
  await center(page.locator('text=/Reimbursed \\$37\\.02/').first(), 800)
  await point(page.locator('text=/Reimbursed \\$37\\.02/').first(), 500)
})

await scene('fail', async () => {
  cut()
  await as('freelancer')
  // the verdict report heads the Delivery tab
  await tab('Delivery')
  await toTop(); await wait(400)
  await cursor(true); await chip(beat)
  roll()
  await card('verifier', 'The verifier', 'on neither side · decides from the signed checks')
  await until(1.6)
  await point(page.locator('text=/3 of 6 checks not met/').first(), 600).catch(() => {})
  await cue('watch', 0.5)
  const watch = btn('Watch what the verifier saw')
  await center(watch, 700)
  await click(watch, { after: 100 })
  sfx('record')
  await wait(1400)
  await cue('phone', 0.1)
  // the failures' own moments (the 'Not met' list): the phone view with its caption and red outline, then the form
  await click(page.locator('[role=dialog] button').filter({ hasText: /^0:26$/ }).first(), { after: 2800 })
  await click(page.locator('[role=dialog] button').filter({ hasText: /^0:11$/ }).first(), { after: 900 })
  await cue('precedent', -0.4)
  await page.keyboard.press('Escape'); await wait(400)
  const prec = btn(/Decided differently from 3 of 4 similar checks/)
  await center(prec, 800)
  await click(prec, { after: 600 })
  await center(page.getByText(/similar checks on other contracts/i).last(), 900).catch(() => {})
  await cue('held', 0.1)
  sfx('fail', 0.2)
  await glide(0, 800)
  await point(page.locator('text=/money stays held/i').first(), 600).catch(() => {})
})

await scene('guard', async () => {
  cut()
  await as('freelancer')
  await tab('Delivery')
  await center(btn('Pre-check'), 0); await wait(300)
  await cursor(true); await chip(beat)
  roll()
  await cue('tamper', 0.3)
  await click(page.locator('button.link').filter({ hasText: 'build that tries to fool the AI' }).first(), { after: 250 })
  await click(btn(/^Pre-check$/), { after: 300 })
  await page.waitForSelector('text=Hidden text on the page addresses the verifier', { timeout: 15000 })
  sfx('alert')
  await cue('caught', -0.2)
  const hidden = page.locator('text=Hidden text on the page addresses the verifier').first()
  await center(hidden, 700)
  await point(hidden, 500)
})

await scene('pass', async () => {
  cut()
  await as('freelancer')
  if (!want('guard')) await tab('Delivery')
  await center(btn('Pre-check'), 0); await wait(200)
  await cursor(true); await chip(beat)
  roll()
  await card('freelancer', "Sam's side, the freelancer", 'the fixed build')
  await cue('precheck', 0.6)
  await click(page.locator('button.link').filter({ hasText: /^complete build$/ }).first(), { after: 200 })
  await click(btn(/^Pre-check$/), { after: 300 })
  await page.waitForSelector('text=/0 not met/', { timeout: 15000 })
  sfx('ok')
  await point(page.locator('text=/0 not met/').first(), 500)
  await cue('submit', 0.2)
  await click(btn('Resubmit for checking'), { after: 300 })
  await glide(0, 600)
  await fast(2)
  await page.waitForSelector('text=/released ·/', { timeout: 60000 })
  await fast(1)
  await cue('paid', -0.3)
  sfx('money', 0.4)
  await glide(0, 700)
  await point(page.locator('text=/landed in the freelancer/').first(), 600).catch(() => {})
})

// off camera: back to Maya
if (want('money')) { await as('client'); await page.goto(APP + '/ledger'); await wait(1600) }

await scene('money', async () => {
  await cursor(true); await chip(beat)
  roll()
  await card('client', 'Back to Maya, the hirer', 'her money, end to end')
  await cue('check', 2.0)
  await click(btn('Check against PayPal'), { after: 900 })
  sfx('ok')
  await wait(900)
  await cue('studio', -0.5)
  cut()
  await page.goto(APP + '/dashboard'); await wait(2500)
  await page.waitForFunction(() => !document.body.innerText.includes('Loading...'), null, { timeout: 15000 }).catch(() => {}); await wait(500)
  roll()
  await click(btn('Ask Claude'), { after: 600 })
  await cue('timeline', -0.5)
  cut()
  await page.goto(APP + '/timeline'); await wait(2500)
  roll()
})

await scene('close', async () => {
  await actor(null, '')
  roll()
  sfx('impact', 0.1)
  await slate(`<div class="end">
      <svg width="88" height="88" viewBox="0 0 80 80" fill="none"><path d="${MARK.work}" fill="#0E0F12"/><path d="${MARK.pay}" fill="${ACCENT}"/></svg>
      <h1>Verdikt</h1>
      <p class="line">A person approves the money once. PayPal holds it, and the checks release it.</p>
      <p class="url">verdikt-leg2.onrender.com</p>
      <p class="try">Try the demo, no account needed</p>
      <p class="built">Built with PayPal, Claude, Kernel, Elastic, Channel3, AG Grid, Bryntum and Render</p>
    </div>`, 'light')
})

console.log('page errors', errors.length ? errors : 'none')
await browser.close()

// ---- the MCP console replay, its steps stretched to end at `end` seconds
async function consoleHtml(end) {
  const run = JSON.parse(await readFile(new URL('mcp/run.json', here), 'utf8'))
  const ev = run.events
  const of = (type, name, n = 0) => ev.filter((e) => e.type === type && (!name || e.name === name))[n]
  const price = JSON.parse(of('result', 'price_check').text)
  const post = JSON.parse(of('result', 'post_job').text)
  const postIn = of('call', 'post_job').input
  const domain = price.online_costs[0].split(' — ')
  const took = (name) => `${(of('result', name).ms / 1000).toFixed(1)} s`
  const k = Math.max(0.8, (end - 0.9) / 10.4)   // the original pacing spans 10.4 s
  const steps = [
    { kind: 'user', at: 0.3, text: of('user').text },
    { kind: 'call', at: 1.5, name: 'price_check', arg: `"${of('call', 'price_check').input.title}"`, rows: [['fair_price', price.fair_price], ['online_costs', domain[0]], ['', domain[1] || '', 'src'], ['suggested_expense_budget', price.plan.suggested_expense_budget]] },
    { kind: 'done', at: 3.9, took: took('price_check') },
    { kind: 'claude', at: 4.5, text: of('claude').text, stream: 1700 },
    { kind: 'user', at: 6.9, text: of('user', null, 1).text },
    { kind: 'call', at: 7.9, name: 'post_job', arg: `"${postIn.title}" · $${postIn.budget_min_usd}–$${postIn.budget_max_usd} · ${postIn.due_days} days`, rows: [['job_id', post.job_id], ['next', post.next.split(':')[0]]] },
    { kind: 'done', at: 8.5, took: took('post_job') },
    { kind: 'claude', at: 9.0, text: of('claude', null, 1).text, stream: 1400 },
  ].map((s) => ({ ...s, at: +(s.at * k).toFixed(2), ...(s.stream ? { stream: Math.round(s.stream * k) } : {}) }))
  const html = (await readFile(new URL('mcp/console.html', here), 'utf8')).replace('/*RUN*/null', JSON.stringify({ seconds: run.seconds, steps }))
  const dir = fileURLToPath(new URL('out/mcp/', here))
  await mkdir(dir, { recursive: true })
  await writeFile(`${dir}/index.html`, html)
  return `${dir}/index.html`
}

function fail(msg) { console.error(msg); process.exit(1) }

// ---- in-page: cursor, click ring, "sped up" badge, the actor chip, the switch card, smooth scroll, the end slate
function OVERLAY() {
  if (location.protocol === 'about:') return
  const state = JSON.parse(sessionStorage.getItem('vk-rec') || '{"x":1300,"y":760,"show":true,"role":null,"actor":""}')
  const save = () => sessionStorage.setItem('vk-rec', JSON.stringify(state))
  let c, ring, badge, sl, chip, card
  const css = `
    #vk-cur{position:fixed;left:0;top:0;z-index:2147483646;pointer-events:none;will-change:transform}
    #vk-ring{position:fixed;left:0;top:0;width:34px;height:34px;margin:-17px 0 0 -17px;border:2px solid #315EFB;border-radius:50%;z-index:2147483645;pointer-events:none;opacity:0}
    #vk-ring.on{animation:vkring .5s ease-out}
    @keyframes vkring{from{opacity:.9;transform:var(--p) scale(.4)}to{opacity:0;transform:var(--p) scale(1.5)}}
    #vk-badge{position:fixed;right:24px;bottom:24px;z-index:2147483646;font:400 13px/1 'JetBrains Mono Variable','JetBrains Mono',monospace;color:#fff;background:#0E0F12;border-radius:999px;padding:9px 14px;opacity:0;transition:opacity .25s;pointer-events:none}
    #vk-chip{position:fixed;left:24px;bottom:24px;z-index:2147483644;display:flex;align-items:center;gap:10px;padding:10px 16px 10px 12px;border-radius:999px;background:#0E0F12;color:#fff;font:400 15px/1 'Inter Tight Variable','Inter Tight',system-ui,sans-serif;box-shadow:0 10px 30px -12px rgba(14,15,18,.45);opacity:0;transform:translateY(6px);transition:opacity .3s,transform .3s;pointer-events:none}
    #vk-chip.on{opacity:1;transform:none}
    #vk-chip i{width:12px;height:12px;border-radius:50%;background:var(--r,#8C93A5);box-shadow:0 0 0 3px rgba(255,255,255,.14)}
    #vk-card{position:fixed;inset:0;z-index:2147483643;display:grid;place-items:center;background:rgba(247,248,250,.86);backdrop-filter:blur(7px);opacity:0;transition:opacity .22s ease-out;pointer-events:none}
    #vk-card.on{opacity:1}
    #vk-card .b{display:grid;gap:12px;padding:30px 40px 32px;border-radius:24px;background:#fff;border:1px solid #D9DCE2;box-shadow:0 24px 60px -18px rgba(14,15,18,.30);transform:translateY(10px);transition:transform .35s cubic-bezier(.16,1,.3,1)}
    #vk-card.on .b{transform:none}
    #vk-card h2{margin:0;display:flex;align-items:center;gap:16px;font:400 44px/1.05 'Inter Tight Variable','Inter Tight',sans-serif;letter-spacing:-.01em;color:var(--ri)}
    #vk-card h2::before{content:'';flex:none;width:16px;height:16px;border-radius:50%;background:var(--r);box-shadow:0 0 0 5px color-mix(in srgb,var(--r) 18%,transparent)}
    #vk-card p{margin:0;font:400 19px/1.4 'Inter Tight Variable','Inter Tight',sans-serif;color:#4B505B}
    #vk-slate{position:fixed;inset:0;z-index:2147483640;display:grid;place-items:center;background:#0E0F12;color:#E9ECF3;font-family:'Inter Tight Variable','Inter Tight',system-ui,sans-serif;opacity:0;transition:opacity .45s;pointer-events:none}
    #vk-slate.light{background:#fff;color:#0E0F12}
    #vk-slate .box{max-width:880px;padding:0 48px;display:grid;gap:22px}
    #vk-slate .end{display:grid;justify-items:center;gap:14px;text-align:center}
    #vk-slate .end h1{font:400 72px/1 'Inter Tight Variable','Inter Tight',sans-serif;letter-spacing:-.02em;margin:8px 0 6px}
    #vk-slate .end .line{font:400 28px/1.35 'Inter Tight Variable','Inter Tight',sans-serif;max-width:24ch;margin:0 0 18px;color:#2A3040}
    #vk-slate .end .url{font:400 24px/1 'JetBrains Mono Variable','JetBrains Mono',monospace;color:#315EFB;margin:0}
    #vk-slate .end .try{font:400 18px/1 'Inter Tight Variable','Inter Tight',sans-serif;color:#5B6274;margin:0}
    #vk-slate .end .built{font:400 15px/1.4 'Inter Tight Variable','Inter Tight',sans-serif;color:#5B6274;margin:26px 0 0;max-width:46ch}`
  // the same colours as the app's role bar (tokens.css --vk-role-*), and grey for the verifier
  const ROLE = { client: ['#6E56CF', '#5B3FC4'], freelancer: ['#0E8F9A', '#0B6A73'], verifier: ['#8C93A5', '#2B2E35'], both: ['linear-gradient(90deg,#6E56CF 50%,#0E8F9A 50%)', '#2B2E35'] }
  const put = (x, y, ms) => { c.style.transition = `transform ${ms}ms cubic-bezier(.3,.7,.25,1)`; c.style.transform = `translate(${x - 4}px,${y - 3}px)` }
  const paintChip = () => {
    if (!chip) return
    const r = ROLE[state.role]
    chip.innerHTML = `<i style="--r:${r ? r[0] : '#8C93A5'}"></i><span></span>`
    chip.querySelector('span').textContent = state.actor || ''
    chip.classList.toggle('on', !!(state.role && state.actor))
  }
  function mount() {
    if (document.getElementById('vk-cur')) return
    const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st)
    c = document.createElement('div'); c.id = 'vk-cur'
    c.innerHTML = '<svg width="24" height="28" viewBox="0 0 24 28"><path d="M3 2v20.5l5.6-5.2 3.6 8.3 3.7-1.6-3.6-8.2H20z" fill="#0E0F12" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>'
    ring = document.createElement('div'); ring.id = 'vk-ring'
    badge = document.createElement('div'); badge.id = 'vk-badge'
    chip = document.createElement('div'); chip.id = 'vk-chip'
    card = document.createElement('div'); card.id = 'vk-card'
    sl = document.createElement('div'); sl.id = 'vk-slate'
    document.documentElement.append(sl, card, chip, ring, badge, c)
    put(state.x, state.y, 0); c.style.opacity = state.show ? '1' : '0'
    paintChip()
  }
  window.__vk = {
    move(x, y, ms) { mount(); Object.assign(state, { x, y }); save(); put(x, y, ms) },
    press() { mount(); ring.style.setProperty('--p', `translate(${state.x}px,${state.y}px)`); ring.style.transform = `translate(${state.x}px,${state.y}px)`; ring.classList.remove('on'); void ring.offsetWidth; ring.classList.add('on') },
    show(on) { mount(); state.show = on; save(); c.style.opacity = on ? '1' : '0' },
    badge(text) { mount(); badge.textContent = text; badge.style.opacity = text ? '1' : '0' },
    actor(role, text) { mount(); Object.assign(state, { role, actor: text }); save(); paintChip() },
    card(role, title, sub, ms = 1250) {
      mount()
      const r = ROLE[role] || ROLE.verifier
      card.innerHTML = `<div class="b" style="--r:${r[0].startsWith('linear') ? '#8C93A5' : r[0]};--ri:${r[1]}"><h2></h2><p></p></div>`
      card.querySelector('h2').textContent = title; card.querySelector('p').textContent = sub
      card.classList.add('on'); setTimeout(() => card.classList.remove('on'), ms)
    },
    slate(html, tone) { mount(); if (html) { sl.className = tone || ''; sl.innerHTML = `<div class="box">${html}</div>`; sl.style.opacity = '1'; c.style.opacity = '0'; chip.classList.remove('on') } else { sl.style.opacity = '0'; c.style.opacity = state.show ? '1' : '0' } },
    scroller() { const m = document.querySelector('main.content'); return m && m.scrollHeight > m.clientHeight ? m : document.scrollingElement },
    centerOf(el) {
      const sc = this.scroller(), r = el.getBoundingClientRect()
      const box = sc === document.scrollingElement ? { top: 0, height: innerHeight } : sc.getBoundingClientRect()
      return Math.max(0, sc.scrollTop + r.top - box.top - box.height / 2 + r.height / 2)
    },
    scroll(to, ms) {
      const sc = this.scroller(), from = sc.scrollTop, t0 = performance.now(), ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
      if (!ms) { sc.scrollTop = to; return }
      const step = (now) => { const t = Math.min(1, (now - t0) / ms); sc.scrollTop = from + (to - from) * ease(t); if (t < 1) requestAnimationFrame(step) }
      requestAnimationFrame(step)
    },
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount()
}
