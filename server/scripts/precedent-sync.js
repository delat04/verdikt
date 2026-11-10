/*  Precedent sync — brings the Elastic precedent index up to date with Postgres. The index is a projection:
    one document per signed check, keyed by its criterion id, so this is safe to run any time and a second
    run writes nothing.

    npm run precedent:sync                         sync every milestone into the alias (only what changed)
    npm run precedent:sync -- --rebuild            dry run: build every document, print the counts and the plan
    npm run precedent:sync -- --rebuild --yes      new index verdikt-precedent-v2-<yyyyMMddHHmm>, fill it, then move
                                                   the alias onto it in one atomic call
    (from server/, reads ELASTIC_* and Supabase from server/.env; precedent:backfill is the same script)

    · Never deletes an index: the old ones are printed so you can delete them by hand once you're sure.
    · Redaction runs before anything leaves the database (lib/precedent.js).
*/

import {
  INDEX, EMBED, RERANKER, precedentOn, ensureReady, esClient, createIndex, syncAll, projectAll,
} from '../src/lib/precedent.js'

const args = process.argv.slice(2)
const rebuild = args.includes('--rebuild')
const yes = args.includes('--yes')

if (!precedentOn()) {
  console.error('Precedent is off: set ELASTIC_URL and ELASTIC_API_KEY in server/.env (and leave ELASTIC_PRECEDENT unset or on).')
  process.exit(1)
}

const counts = (r) => `Indexed ${r.indexed} · unchanged ${r.unchanged} · skipped ${r.flagged} flagged · ${r.failed} failed`

// which concrete indices the alias points at now (none when it doesn't exist yet)
async function aliasTargets() {
  const es = esClient()
  if (!(await es.indices.existsAlias({ name: INDEX }))) return []
  return Object.keys(await es.indices.getAlias({ name: INDEX })).sort()
}

if (!rebuild) {
  const ready = await ensureReady()
  if (ready.state !== 'on') {
    console.error(`Precedent ${ready.state}: ${ready.reason}. Run npm run precedent:sync -- --rebuild --yes`)
    process.exit(1)
  }
  const r = await syncAll()
  console.log(`${counts(r)} (${r.milestones} milestones, ${INDEX} → ${ready.index})`)
  process.exit(r.failed ? 1 : 0)
}

const es = esClient()
if (!(await es.indices.existsAlias({ name: INDEX })) && (await es.indices.exists({ index: INDEX }))) {
  console.error(`${INDEX} is a concrete index, so an alias can't take its name. Set ELASTIC_INDEX to a new name, or remove that index by hand.`)
  process.exit(1)
}
const target = `${INDEX}-v2-${new Date().toISOString().replace(/\D/g, '').slice(0, 12)}`
const before = await aliasTargets()
const plan = before.length
  ? `move the alias ${INDEX} from ${before.join(', ')} to ${target} in one atomic call`
  : `create the alias ${INDEX} on ${target}`

if (!yes) {
  const { docs, flagged, milestones } = await projectAll()
  const table = new Map()
  for (const d of docs) {
    const k = `${d.kind}\t${d.layer}`
    const row = table.get(k) || { checks: 0, met: 0 }
    row.checks++
    if (d.met) row.met++
    table.set(k, row)
  }
  console.log(`Precedent rebuild (dry run) · embed ${EMBED} · reranker ${RERANKER}\n`)
  console.log('  kind         layer      checks  met')
  for (const [k, row] of [...table].sort(([a], [b]) => a.localeCompare(b))) {
    const [kind, layer] = k.split('\t')
    console.log(`  ${kind.padEnd(12)} ${layer.padEnd(10)} ${String(row.checks).padStart(6)}  ${String(row.met).padStart(3)}`)
  }
  if (flagged) console.log(`\n  ${flagged} check${flagged === 1 ? '' : 's'} skipped: the text addresses the verifier`)
  console.log(`\nPlan: ${plan}. Old indices are kept.`)
  console.log(`Dry run: would index ${docs.length} checks from ${milestones} milestones into ${target} and move the alias ${INDEX}. Nothing written. Add --yes to do it.`)
  process.exit(0)
}

if (await es.indices.exists({ index: target })) {
  console.error(`${target} already exists (a rebuild in the same minute). Wait a minute and run it again.`)
  process.exit(1)
}
await createIndex(target)
console.log(`Created ${target} (strict mapping, schema 2, ${EMBED})`)
const r = await syncAll({ index: target, refresh: 'wait_for' })
console.log(`${counts(r)} (${r.milestones} milestones)`)
if (r.failed) {
  console.error(`Some checks failed to index, so the alias stays where it was. ${target} is kept for a look.`)
  process.exit(1)
}

// what went in, by kind and by what decided it (ES|QL on the new index)
try {
  const q = await es.esql.query({
    query: `FROM ${target} | STATS checks = COUNT(*), met = SUM(CASE(met, 1, 0)), contracts = COUNT_DISTINCT(contract) BY kind, layer | SORT kind, layer`,
  }, { requestTimeout: 30_000 })
  const cols = q.columns.map((c) => c.name)
  const width = cols.map((c, i) => Math.max(c.length, ...q.values.map((v) => String(v[i] ?? '').length)))
  console.log(`\n  ${cols.map((c, i) => c.padEnd(width[i])).join('  ')}`)
  for (const v of q.values) console.log(`  ${v.map((x, i) => String(x ?? '').padEnd(width[i])).join('  ')}`)
  console.log('')
} catch (e) {
  console.warn(`(ES|QL summary unavailable: ${e.name}${e.meta?.statusCode ? ` ${e.meta.statusCode}` : ''})`)
}

await es.indices.updateAliases({
  actions: [
    ...before.map((index) => ({ remove: { index, alias: INDEX } })),
    { add: { index: target, alias: INDEX, is_write_index: true } },
  ],
}, { requestTimeout: 30_000 })
console.log(`Alias ${INDEX} → ${target}.`)
if (before.length) console.log(`Old indices kept: ${before.join(', ')}. Delete them by hand once you're sure.`)
process.exit(0)
