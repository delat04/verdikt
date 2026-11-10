/*  Precedent calibrate — is the reranker floor where it should be? Read-only: a few inference calls and three
    searches, nothing written, no model, no database.

    npm run precedent:calibrate          (from server/, reads ELASTIC_* from server/.env)

    · Floor: test/fixtures/rerank-pairs.json holds labelled pairs of already-redacted check statements: the same
      check worded another way (a match) and a different check on the same kind of page (a non-match). Each query
      is reranked twice: against its own two statements, and among every statement in the file, as in a retriever
      window (this reranker reads its input as a list, so a score depends on what it is listed with). PASS when,
      both ways, the highest non-match < FLOOR <= the lowest match, with a margin of at least 0.02.
    · Scale: one retriever query, built by buildSearch as the verifier builds it, for a statement already in the
      index and narrowed to that one document, so the reranker sees exactly what a direct call sees. The reported
      _score - 1 must equal the direct rerank within 0.02, and min_score just above it must return nothing: the
      floor is applied in Elastic, on the raw score. It also prints how far the same case moves in a full window.
    · Mapping: the alias's write index pins EMBED on the statement field.
    Exits 1 on any FAIL.
*/

import { readFileSync } from 'node:fs'
import {
  INDEX, EMBED, RERANKER, FLOOR, REDACTION, precedentOn, esClient, buildSearch,
} from '../src/lib/precedent.js'

const SLOW = { requestTimeout: 30_000 }   // an inference call over two dozen statements takes longer than a search
const MARGIN = 0.02
const SCALE = 0.02
const n3 = (n) => n.toFixed(3)
const pad = (s, w) => String(s).padStart(w)

if (!precedentOn()) {
  console.error('Precedent is off: set ELASTIC_URL and ELASTIC_API_KEY in server/.env (and leave ELASTIC_PRECEDENT unset or on).')
  process.exit(1)
}
const es = esClient()

/** Raw relevance for each input, in input order. */
async function rerank(query, input) {
  const { rerank: out } = await es.inference.rerank({ inference_id: RERANKER, query, input }, SLOW)
  const by = new Map((out || []).map((r) => [r.index, r.relevance_score]))
  return input.map((_, i) => by.get(i))
}

// ---- the floor, against labelled pairs ----------------------------------------------------------------

async function floorCheck() {
  const { pairs } = JSON.parse(readFileSync(new URL('../test/fixtures/rerank-pairs.json', import.meta.url), 'utf8'))
  const queries = [...new Set(pairs.map((p) => p.query))]
  const pool = [...new Set(pairs.map((p) => p.text))]
  console.log(`Reranker floor check · ${RERANKER} · ${pairs.length} labelled pairs\n`)
  console.log(`  ${'in pairs'.padEnd(18)}among all ${pool.length}`)
  console.log(`  ${'match'.padEnd(7)}${'non-match'.padEnd(11)}${'match'.padEnd(7)}${'non-match'.padEnd(11)}query`)

  const scored = { pairs: [], pool: [] }
  // per query: its lowest match and its highest non-match, the two that bound the gap
  const worst = (list, q, match) => {
    const s = list.filter((p) => p.query === q && p.match === match).map((p) => p.score)
    return s.length ? n3(match ? Math.min(...s) : Math.max(...s)) : '-'
  }
  for (const q of queries) {
    const own = pairs.filter((p) => p.query === q)
    const alone = await rerank(q, own.map((p) => p.text))
    const among = await rerank(q, pool)
    own.forEach((p, i) => {
      scored.pairs.push({ ...p, score: alone[i] })
      scored.pool.push({ ...p, score: among[pool.indexOf(p.text)] })
    })
    const cells = [worst(scored.pairs, q, true), worst(scored.pairs, q, false), worst(scored.pool, q, true), worst(scored.pool, q, false)]
    console.log(`  ${pad(cells[0], 6)} ${pad(cells[1], 9)}  ${pad(cells[2], 6)} ${pad(cells[3], 9)}  ${q}`)
  }

  const rows = Object.entries(scored).map(([how, list]) => {
    const lowest = Math.min(...list.filter((p) => p.match).map((p) => p.score))
    const highest = Math.max(...list.filter((p) => !p.match).map((p) => p.score))
    const margin = lowest - highest
    return { how, lowest, highest, margin, pass: highest < FLOOR && FLOOR <= lowest && margin >= MARGIN }
  })
  console.log(`\n  ${''.padEnd(16)}${pad('lowest match', 14)}${pad('highest non-match', 19)}${pad('margin', 8)}${pad('floor', 7)}  result`)
  for (const r of rows) {
    const label = r.how === 'pairs' ? 'in pairs' : `among all ${pool.length}`
    console.log(`  ${label.padEnd(16)}${pad(n3(r.lowest), 14)}${pad(n3(r.highest), 19)}${pad(n3(r.margin), 8)}${pad(FLOOR, 7)}  ${r.pass ? 'PASS' : 'FAIL'}`)
  }
  const lowest = Math.min(...rows.map((r) => r.lowest))
  const highest = Math.max(...rows.map((r) => r.highest))
  const pass = rows.every((r) => r.pass)
  console.log(pass ? `PASS: the floor ${FLOOR} sits between ${n3(highest)} and ${n3(lowest)}` : 'FAIL: the floor is outside the gap; see README')
  return pass
}

// ---- the scale: what the retriever reports against a direct call -------------------------------------

/** The verifier's search body, narrowed to one document so the reranker's window holds exactly that statement. */
function narrowed(body, criterion, minScore = FLOOR) {
  const b = structuredClone(body)
  const tsr = b.retriever.text_similarity_reranker
  for (const r of tsr.retriever.rrf.retrievers) {
    const bool = r.standard.query.bool
    bool.filter = [...bool.filter, { term: { criterion } }]
  }
  tsr.min_score = minScore
  return b
}

async function scaleCheck() {
  console.log(`\nScale check · one retriever query on ${INDEX}`)
  const pick = await es.search({ index: INDEX, size: 1, sort: [{ criterion: 'asc' }], _source: ['statement_text', 'criterion'], query: { term: { redaction: REDACTION } } }, SLOW)
  const doc = pick.hits.hits[0]?._source
  if (!doc) { console.log('  FAIL: the index has no documents yet. Run npm run precedent:sync'); return false }

  // the same body the verifier sends (its own check left out by id, so this one stays in)
  const body = buildSearch({ id: 'calibrate', statement: doc.statement_text }, {})
  const q = body.retriever.text_similarity_reranker.inference_text
  const one = await es.search({ index: INDEX, ...narrowed(body, doc.criterion) }, SLOW)
  const hit = one.hits.hits[0]
  const [direct] = await rerank(q, [doc.statement_text])
  console.log(`  query            ${q}`)
  if (!hit) { console.log(`  FAIL: the retriever found nothing above the floor for its own statement (direct rerank ${n3(direct)})`); return false }
  const reported = hit._score - 1
  const diff = Math.abs(reported - direct)
  const scaleOk = diff <= SCALE
  console.log(`  reported - 1     ${n3(reported)}`)
  console.log(`  direct rerank    ${n3(direct)}`)
  console.log(`  difference       ${diff.toFixed(4)} · ${scaleOk ? 'PASS' : 'FAIL'} (at most ${SCALE})`)

  // just above that score, min_score must leave nothing: Elastic compares it with the raw score, not _score
  const above = Math.round((reported + 0.01) * 1000) / 1000
  const none = await es.search({ index: INDEX, ...narrowed(body, doc.criterion, above) }, SLOW)
  const minOk = none.hits.hits.length === 0
  console.log(`  min_score ${above}  ${none.hits.hits.length} hits · ${minOk ? 'PASS: the floor is applied in Elastic, on the raw score' : 'FAIL: min_score is not on the raw scale'}`)

  // the same case in a full window: how much the other candidates move it (informational)
  const full = await es.search({ index: INDEX, ...body, collapse: undefined, size: 20, _source: ['criterion'] }, SLOW)
  const same = full.hits.hits.find((h) => h._source?.criterion === doc.criterion)
  if (same) {
    const moved = Math.abs(same._score - 1 - direct)
    console.log(`  full window      ${n3(same._score - 1)} among ${full.hits.hits.length} cases above the floor (moved ${n3(moved)} by the other candidates: the reranker reads a list)`)
  }
  return scaleOk && minOk
}

// ---- the mapping --------------------------------------------------------------------------------------

async function mappingCheck() {
  const aliases = await es.indices.getAlias({ name: INDEX }).catch((e) => { if (e?.meta?.statusCode === 404) return null; throw e })
  const names = Object.keys(aliases || {})
  const write = names.find((n) => aliases[n]?.aliases?.[INDEX]?.is_write_index) || (names.length === 1 ? names[0] : null)
  if (!write) { console.log(`\nMapping check · FAIL: ${INDEX} is not an alias with a write index. Run npm run precedent:sync -- --rebuild --yes`); return false }
  const embed = (await es.indices.getMapping({ index: write }, SLOW))[write]?.mappings?.properties?.statement?.inference_id
  const ok = embed === EMBED
  console.log(`\nMapping check · ${write} · ${ok ? `mapping pins ${EMBED} · PASS` : `FAIL: it embeds with ${embed || 'no pinned model'}, not ${EMBED}`}`)
  return ok
}

let code = 0
try {
  const results = [await floorCheck(), await scaleCheck(), await mappingCheck()]
  code = results.every(Boolean) ? 0 : 1
  console.log(`\n${code ? 'FAIL' : 'PASS'}: floor, scale and mapping`)
} catch (e) {
  // never the error's text: it can carry the cluster's address
  console.error(`Calibration stopped: ${e?.name || 'Error'}${e?.meta?.statusCode ? ` ${e.meta.statusCode}` : ''}`)
  code = 1
}
process.exit(code)
