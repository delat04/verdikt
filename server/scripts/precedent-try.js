/*  Precedent try — one live precedent search, read-only: what the verifier would see for a check.

    npm run precedent:try -- "No horizontal scrolling at 375px wide" [--kind visual] [--contract <contract id>]
    npm run precedent:try -- --milestone <milestone id>

    · --contract leaves out that contract's own checks, as a real verdict does.
    · Prints the status, the time, the corpus size, each case (raw reranker score, band, contract hash, what
      decided it, met or not) and the stance a pass and a fail would take. Writes nothing; no model is called.
    · --milestone loads a milestone the way the verifier does and searches for every compiled check its probes
      can't settle alone (the ones the model may judge), with that contract's own redaction. It prints the exact
      block the model would be shown and a preview of report.precedent. Its checks must be compiled already: it
      never compiles them. No browser, no model, no database writes, no money.
*/

import {
  precedentFor, precedentBlock, precedentReport, contractKey, partiesKey, denyListFor, redact, stanceOf, FLOOR, INDEX,
} from '../src/lib/precedent.js'

const args = process.argv.slice(2)
const valueOf = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null }

if (args.includes('--milestone')) {
  const id = valueOf('--milestone')
  if (!id || id.startsWith('--')) console.error('Usage: npm run precedent:try -- --milestone <milestone id>')
  // no process.exit right after a Supabase read: on Windows it can abort while a socket is closing. Node
  // exits on its own once the reads are done
  process.exitCode = id && !id.startsWith('--') ? await tryMilestone(id) : 1
} else await tryStatement()

/** One statement's search, as the verifier would run it for a check on another contract. */
async function tryStatement() {
  const statement = args.find((a, i) => !a.startsWith('--') && !['--kind', '--contract'].includes(args[i - 1]))
  if (!statement) {
    console.error('Usage: npm run precedent:try -- "<check statement>" [--kind visual|functional|code|performance|content] [--contract <contract id>]')
    console.error('       npm run precedent:try -- --milestone <milestone id>')
    process.exit(1)
  }
  const kind = valueOf('--kind') || 'visual'
  const contract = valueOf('--contract')

  const criterion = { id: 'try', statement, kind }
  const r = await precedentFor([criterion], { contract: contract ? contractKey(contract) : undefined })
  const cases = r.map.get('try') || []

  console.log(`status ${r.status} · ${r.ms} ms · corpus ${r.corpus ?? 'unknown'} · ${INDEX} · floor ${FLOOR}`)
  console.log(`query  [${kind}] ${redact(statement)}${contract ? ` · excluding contract ${contractKey(contract)}` : ''}\n`)
  if (!cases.length) console.log(r.status === 'ok' ? '  no case above the floor' : '  no search')
  for (const p of cases) {
    console.log(`  ${p.score.toFixed(3)}  ${p.band.padEnd(7)}  ${p.contract}  ${String(p.layer).padEnd(6)}  ${p.met ? 'met    ' : 'not met'}  [${p.kind}] ${p.statement}`)
    if (p.reason) console.log(`${' '.repeat(44)}— ${p.reason}`)
  }
  if (cases.length) {
    const say = (s) => s.stance === 'none' ? 'none' : `${s.stance} (${s.same} of ${s.n})`
    console.log(`\n  if this check passes: ${say(stanceOf(cases, true))}`)
    console.log(`  if it fails:          ${say(stanceOf(cases, false))}`)
  }
  process.exit(0)
}

/**
 * The verifier's precedent step for one milestone, read-only: the block the model would see and report.precedent.
 * → the exit code.
 */
async function tryMilestone(id) {
  const { db } = await import('../src/lib/supabase.js')
  const { cleanSpec } = await import('../src/agent/probes.js')
  // the same milestone select as agent/verify.js, plus the latest delivery's links for the deny list
  const { data: m, error } = await db().from('milestones').select(`*, criteria(*), contract:contracts(id, title, brief, currency, release_mode, client_id, freelancer_id,
    client:profiles!contracts_client_id_fkey(display_name), freelancer:profiles!contracts_freelancer_id_fkey(display_name)),
    submissions(attempt, live_url, repo_url)`).eq('id', id).maybeSingle()
  if (error) { console.error(`Could not read milestone ${id}: ${error.message}`); return 1 }
  if (!m) { console.error(`No milestone ${id}`); return 1 }

  const criteria = [...(m.criteria || [])].sort((a, b) => a.position - b.position)
  if (!criteria.length) { console.error('This milestone has no checks.'); return 1 }
  if (criteria.some((c) => !Array.isArray(c.check_spec?.probes))) {
    console.error('Compile the checks first: npm run precedent:try only reads compiled checks.')
    return 1
  }
  const sub = [...(m.submissions || [])].sort((a, b) => b.attempt - a.attempt)[0] || {}
  const ctx = {
    contract: contractKey(m.contract.id),
    parties: partiesKey(m.contract.client_id, m.contract.freelancer_id),
    deny: denyListFor({
      title: m.contract.title,
      clientName: m.contract.client?.display_name,
      freelancerName: m.contract.freelancer?.display_name,
      liveUrls: [sub.live_url].filter(Boolean),
      repoUrls: [sub.repo_url].filter(Boolean),
    }),
  }
  // what the verifier asks for: every check its probes can't settle alone. Here they all count as judged by the
  // model; in a real verdict only those the probes leave open (and that weren't reused) are
  const asked = criteria.filter((c) => !cleanSpec(c.check_spec).sufficient)
  console.log(`milestone M${m.position} · ${criteria.length} checks · ${asked.length} the model may judge · contract ${ctx.contract} · deny ${ctx.deny.length} words\n`)
  if (!asked.length) {
    console.log('Every check is settled by its probes alone: a verdict here asks for no precedent (report.precedent is null).')
    return 0
  }
  const pre = await precedentFor(asked, ctx)
  const { map, report } = precedentReport(pre, asked)
  console.log(precedentBlock(asked, map) || 'No precedent for these checks')
  console.log(`\nreport.precedent (preview):\n${JSON.stringify(report, null, 2)}`)
  return 0
}
