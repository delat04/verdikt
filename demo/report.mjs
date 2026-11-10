/*  The submission's PDF: a short project report with the gallery
    Builds an A4 report from demo/gallery.md (captions) and demo/out/gallery (images), and prints it with Chrome:
    a cover, how it works, the tools, then the gallery two to a page. Writes demo/out/verdikt-report.pdf.
    node demo/report.mjs
*/
import { createRequire } from 'node:module'
import { readFile, writeFile } from 'node:fs/promises'
import { pathToFileURL, fileURLToPath } from 'node:url'

const { chromium } = createRequire(new URL('../server/package.json', import.meta.url))('playwright-core')
const here = new URL('.', import.meta.url)
const p = (rel) => fileURLToPath(new URL(rel, here))
const { MARK } = await import('../web/src/components/markPaths.js')

const md = await readFile(new URL('gallery.md', here), 'utf8')
const shots = [...md.matchAll(/### (\d+) · ([\w-]+\.png)\s+```text\n([^\n]+)\n```/g)].map(([, n, file, cap]) => ({ n: +n, file, cap }))
const img = (file) => pathToFileURL(p(`out/gallery/${file}`)).href
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
const mark = (size, dark) => `<svg width="${size}" height="${size}" viewBox="0 0 80 80"><path d="${MARK.work}" fill="${dark ? '#fff' : '#0B0D13'}"/><path d="${MARK.pay}" fill="#295CFF"/></svg>`

const STEPS = [
  ['Approve once', 'The hirer approves one PayPal hold (Orders v2, intent=AUTHORIZE) as a spending limit: a total, the most for one job, an end date. Their agent hires within it.'],
  ['Agents hire and bargain', 'Claude, over Verdikt’s MCP server, prices the job from live web prices, posts it and reviews applications. In the contract room both agents negotiate inside private limits enforced in code.'],
  ['Terms become tests', 'Every “done means” line compiles into deterministic probes, such as no horizontal scroll at 375px or the form submits. Both sides see them before they sign.'],
  ['The work is checked', 'The verifier opens the delivery in Kernel’s cloud browser and records it. Probes, axe-core and OCR settle most checks; Claude judges the rest, with Elastic precedent from similar checks.'],
  ['The verdict moves the money', 'Pass: PayPal captures the hold and Payouts pays the freelancer. Fail: the money stays held, with the failures on camera. Expenses from a Channel3 shopping list are reimbursed by rules.'],
]
const TOOLS = [
  ['PayPal', 'Orders v2 holds, partial captures, voids and reauthorization; Payouts; the JS SDK; webhooks; Disputes API and PayPal’s MCP server; every ledger row checked against PayPal.'],
  ['Claude', 'Opus 5.5 mediates, negotiates within a mandate, drafts checks, judges what probes can’t, reviews appeals and applications, prices jobs with web search and drives the dashboard.'],
  ['MCP', '31 tools, so any agent can price, post, hire, fund from a spending limit, deliver, read verdicts and claim expenses. Only a person approves money.'],
  ['Kernel', 'Every verification runs in a recorded cloud browser: chapters, jump-to-failure, and the MP4’s sha-256 kept with the verdict.'],
  ['Elastic', 'Hybrid semantic search with a reranker finds how similar checks were decided elsewhere, anonymised, one case per contract, fingerprinted into the receipt.'],
  ['Channel3', 'Real store listings for the expense shopping list; a receipt naming a listed item, store and price is reimbursed by rules in seconds.'],
  ['AG Grid and AG Studio', 'The ledger with every PayPal ID, filtered by plain-language questions, and a dashboard with Claude as its assistant.'],
  ['Bryntum', 'A timeline of each milestone and what PayPal is doing; drag a due date to propose it to the other side.'],
]

const pages = []
for (let i = 0; i < shots.length; i += 2) pages.push(shots.slice(i, i + 2))

const html = `<!doctype html><html><head><meta charset="utf-8"><title>Verdikt report</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500&family=JetBrains+Mono:wght@400&display=swap">
<style>
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; margin: 0; }
  body { font-family: 'Poppins', 'Segoe UI', sans-serif; color: #0E0F12; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .page { width: 210mm; height: 297mm; padding: 16mm 16mm 14mm; position: relative; page-break-after: always; overflow: hidden; }
  .foot { position: absolute; left: 16mm; right: 16mm; bottom: 9mm; display: flex; justify-content: space-between; font: 400 8pt/1 'Poppins'; color: #8A8F9C; }
  .head { display: flex; align-items: center; gap: 8px; font: 400 10pt/1 'Poppins'; color: #4B505B; margin-bottom: 7mm; }
  h2 { font: 400 22pt/1.15 'Poppins'; letter-spacing: -0.01em; margin-bottom: 5mm; }
  .lead { font: 300 11pt/1.55 'Poppins'; color: #2B2E35; max-width: 160mm; margin-bottom: 8mm; }
  /* cover */
  .cover { background: #000; color: #fff; padding: 0; }
  .cover img { width: 100%; display: block; }
  .cover .body { padding: 14mm 16mm; }
  .cover h1 { font: 300 30pt/1.15 'Poppins'; letter-spacing: -0.015em; margin-bottom: 6mm; }
  .cover p { font: 300 11.5pt/1.6 'Poppins'; color: rgba(255,255,255,.72); max-width: 165mm; margin-bottom: 4mm; }
  .cover .links { margin-top: 8mm; font: 400 10pt/1.8 'JetBrains Mono', monospace; color: #8FA9FF; }
  .cover .foot { color: rgba(255,255,255,.4); }
  /* steps */
  .steps { display: grid; gap: 5mm; }
  .step { display: grid; grid-template-columns: 11mm 1fr; gap: 4mm; padding: 5mm 0; border-top: 1px solid #D9DCE2; }
  .step b { font: 400 13pt/1 'JetBrains Mono', monospace; color: #295CFF; }
  .step h3 { font: 400 12.5pt/1.3 'Poppins'; margin-bottom: 1.5mm; }
  .step p { font: 300 10pt/1.55 'Poppins'; color: #4B505B; }
  .roles { margin-top: 7mm; display: flex; gap: 4mm; }
  .role { flex: 1; padding: 4mm 5mm; border-radius: 4mm; border: 1px solid; font: 300 9.5pt/1.5 'Poppins'; color: #2B2E35; }
  .role strong { display: block; font-weight: 400; font-size: 10.5pt; margin-bottom: 1mm; }
  .role.c { background: #F4F0FF; border-color: #DCD3FF; } .role.c strong { color: #5B3FC4; }
  .role.f { background: #E6F6F7; border-color: #B7E3E7; } .role.f strong { color: #0B6A73; }
  .role.v { background: #F1F3F6; border-color: #D9DCE2; } .role.v strong { color: #2B2E35; }
  /* tools */
  .tools { display: grid; grid-template-columns: 1fr 1fr; gap: 4mm; }
  .tool { padding: 4.5mm 5mm; border: 1px solid #D9DCE2; border-radius: 4mm; }
  .tool h3 { font: 400 11.5pt/1.3 'Poppins'; margin-bottom: 1.5mm; }
  .tool p { font: 300 9.3pt/1.55 'Poppins'; color: #4B505B; }
  .facts { margin-top: 7mm; display: grid; grid-template-columns: repeat(3, 1fr); gap: 4mm; }
  .fact { padding: 4mm 5mm; background: #F7F8FA; border-radius: 4mm; }
  .fact b { display: block; font: 400 17pt/1.1 'JetBrains Mono', monospace; color: #0E0F12; margin-bottom: 1.5mm; }
  .fact span { font: 300 8.8pt/1.45 'Poppins'; color: #4B505B; }
  /* gallery */
  .shot { width: 160mm; margin: 0 auto 6mm; }
  .shot img { width: 100%; border: 1px solid #D9DCE2; border-radius: 3mm; display: block; }
  .shot .cap { display: flex; gap: 4mm; margin-top: 3mm; font: 300 10pt/1.5 'Poppins'; color: #2B2E35; }
  .shot .cap b { font: 400 10pt/1.5 'JetBrains Mono', monospace; color: #295CFF; flex: none; }
</style></head><body>

<section class="page cover">
  <img src="${pathToFileURL(p('../thumbnail/verdikt-thumbnail.png')).href}">
  <div class="body">
    <h1>Escrow on PayPal for people and their AI agents</h1>
    <p>AI agents can already shop for us. Next, they’ll hire for us, and nobody is watching the work when the money moves. Verdikt turns a freelance contract into checks a machine can run. PayPal holds the money, an agent tests the delivery against the checks both sides signed, and the payment is released only when they pass.</p>
    <p>A person approves the money once. PayPal holds it, and the checks release it.</p>
    <div class="links">Live demo, no account: verdikt-leg2.onrender.com<br>MCP server: verdikt-leg2.onrender.com/mcp</div>
  </div>
  <div class="foot"><span>Verdikt · project report</span><span>PayPal sandbox only: no real money moves</span></div>
</section>

<section class="page">
  <div class="head">${mark(18)} Verdikt</div>
  <h2>How it works</h2>
  <p class="lead">One story runs through the product: Maya, who owns a coffee shop, hires Sam, a freelance developer, through her AI agent. Each step is something a person or an agent can do, and only a person ever approves money.</p>
  <div class="steps">${STEPS.map(([t, d], i) => `<div class="step"><b>0${i + 1}</b><div><h3>${esc(t)}</h3><p>${esc(d)}</p></div></div>`).join('')}</div>
  <div class="roles">
    <div class="role c"><strong>The hirer</strong>Funds the work and approves the money. Violet in the app and the video.</div>
    <div class="role f"><strong>The freelancer</strong>Does the work and is paid when the checks pass. Teal.</div>
    <div class="role v"><strong>The verifier</strong>On neither side: decides from the signed checks. Grey.</div>
  </div>
  <div class="foot"><span>Verdikt · project report</span><span>2</span></div>
</section>

<section class="page">
  <div class="head">${mark(18)} Verdikt</div>
  <h2>What it’s built with</h2>
  <p class="lead">Vue 3 and Vite on the web, Fastify and Supabase behind it, one Docker service on Render, and 184 server tests that run with no keys. Every sponsor tool does a job in the product, not only in the demo.</p>
  <div class="tools">${TOOLS.map(([t, d]) => `<div class="tool"><h3>${esc(t)}</h3><p>${esc(d)}</p></div>`).join('')}</div>
  <div class="facts">
    <div class="fact"><b>4 of 6</b><span>checks decided by probes, with no model; the resubmission used 0 tokens</span></div>
    <div class="fact"><b>5–7 s</b><span>to check a receipt by rules and pay it from the same PayPal hold</span></div>
    <div class="fact"><b>31</b><span>MCP tools, the same API routes a person uses</span></div>
  </div>
  <div class="foot"><span>Verdikt · project report</span><span>3</span></div>
</section>

${pages.map((pair, k) => `<section class="page">
  <div class="head">${mark(18)} Verdikt · gallery</div>
  ${pair.map((s) => `<div class="shot"><img src="${img(s.file)}"><div class="cap"><b>${String(s.n).padStart(2, '0')}</b><span>${esc(s.cap)}</span></div></div>`).join('')}
  <div class="foot"><span>Verdikt · project report</span><span>${k + 4}</span></div>
</section>`).join('\n')}
</body></html>`

const htmlFile = p('out/report.html')
await writeFile(htmlFile, html)
const browser = await chromium.launch({ channel: 'chrome' })
const page = await browser.newPage()
await page.goto(pathToFileURL(htmlFile).href, { waitUntil: 'networkidle' })
await page.evaluate(() => document.fonts.ready)
await page.pdf({ path: p('out/verdikt-report.pdf'), format: 'A4', printBackground: true, preferCSSPageSize: true })
await browser.close()
console.log(`demo/out/verdikt-report.pdf: ${3 + pages.length} pages, ${shots.length} images`)
