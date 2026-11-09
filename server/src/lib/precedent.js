/*  ============================================================================
    Precedent — how similar checks were decided before, kept in Elasticsearch. Every verdict's checks are
    indexed (what was agreed, its kind, met or not, what decided it, a short reason). Before Claude judges
    a check the probes couldn't settle, Verdikt finds the most similar past checks on other milestones by
    meaning (semantic_text, Elastic's built-in embedding model, then its Jina reranker) and hands them over as precedent: alike
    evidence should get alike answers, and a departure has to say why. Both sides see the precedent in the
    verdict. Quoted text, URLs, emails and amounts are redacted before indexing, so one contract's details
    never reach another. Off without ELASTIC_URL and ELASTIC_API_KEY; a slow or failing search never holds
    up a verdict.
    ============================================================================ */

import { Client } from '@elastic/elasticsearch'

const NODE = process.env.ELASTIC_URL || ''
const KEY = process.env.ELASTIC_API_KEY || ''
const INDEX = process.env.ELASTIC_INDEX || 'verdikt-checks'
export const precedentOn = () => !!(NODE && KEY)

let es = null
const client = () => (es ??= new Client({ node: NODE, auth: { apiKey: KEY }, requestTimeout: 8000 }))

/** What could identify a contract goes before anything is indexed. */
export function redact(s = '') {
  return String(s)
    .replace(/https?:\/\/\S+/gi, 'the site')
    .replace(/\b[\w-]+(\.[\w-]+)*\.(com|io|app|dev|net|org|co|ai|site|shop|store|xyz|me)\b/gi, 'the site')
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, 'an email')
    .replace(/[“"]([^”"]{1,120})[”"]/g, '“…”')
    .replace(/\$\s?\d[\d,.]*/g, 'an amount')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 400)
}

let ready = null
function ensureIndex() {
  return (ready ??= (async () => {
    if (await client().indices.exists({ index: INDEX })) return
    await client().indices.create({
      index: INDEX,
      mappings: {
        properties: {
          statement: { type: 'semantic_text' },      // searched by meaning
          statement_text: { type: 'text' },          // shown as written
          kind: { type: 'keyword' },
          met: { type: 'boolean' },
          layer: { type: 'keyword' },
          reason: { type: 'text', index: false },
          milestone: { type: 'keyword' },
          at: { type: 'date' },
        },
      },
    })
  })().catch((e) => { ready = null; throw e }))
}

/** Index one verdict's checks. Never throws: precedent is a help, not part of the money path. */
export async function indexVerdict({ verdictId, milestoneId, at, criteria, results }) {
  if (!precedentOn()) return 0
  try {
    await ensureIndex()
    const byId = new Map(criteria.map((c) => [c.id, c]))
    const ops = []
    for (const r of results) {
      const c = byId.get(r.criterion_id)
      if (!c) continue
      const statement = redact(c.statement)
      ops.push({ index: { _index: INDEX, _id: `${verdictId}:${c.id}` } })
      ops.push({ statement, statement_text: statement, kind: c.kind, met: !!r.passed, layer: r.layer, reason: redact(r.explanation).slice(0, 240), milestone: milestoneId, at })
    }
    if (!ops.length) return 0
    const res = await client().bulk({ operations: ops, refresh: false })
    return res.items.filter((i) => !i.index?.error).length
  } catch {
    return 0
  }
}

// Elastic's built-in Jina reranker scores how closely a past check matches; on its scale real matches sat
// at 1.23–1.47 and unrelated filler at 1.20 or below, so anything under the floor is not precedent
const RERANKER = process.env.ELASTIC_RERANKER || '.jina-reranker-v3'
const FLOOR = Number(process.env.ELASTIC_PRECEDENT_MIN || 1.22)

/**
 * The most similar past checks on other milestones, per criterion: Map(criterionId → [{ statement, kind,
 * met, layer, reason, score }]). Found by meaning, reranked, and only above the floor; none → no entry.
 */
export async function precedentFor(criteria, { milestoneId, size = 4 } = {}) {
  const out = new Map()
  if (!precedentOn() || !criteria.length) return out
  try {
    await ensureIndex()
    const res = await client().msearch({
      searches: criteria.flatMap((c) => {
        const q = redact(c.statement)
        return [
          { index: INDEX },
          {
            size,
            _source: ['statement_text', 'kind', 'met', 'layer', 'reason'],
            retriever: {
              text_similarity_reranker: {
                retriever: { standard: { query: { bool: { must: [{ semantic: { field: 'statement', query: q } }], must_not: [{ term: { milestone: milestoneId || '' } }] } } } },
                field: 'statement_text', inference_id: RERANKER, inference_text: q, rank_window_size: 12,
              },
            },
          },
        ]
      }),
    })
    res.responses.forEach((r, i) => {
      const keep = (r.hits?.hits || []).filter((h) => h._score >= FLOOR)
      if (keep.length) out.set(criteria[i].id, keep.map((h) => ({ ...h._source, statement: h._source.statement_text, score: Number(h._score.toFixed(2)) })))
    })
  } catch {
    // no precedent this time; the verdict goes ahead on the evidence alone
  }
  return out
}

/** As evidence on a check's result: counts and the cases, for both sides to read. */
export function precedentEvidence(list) {
  if (!list?.length) return []
  const met = list.filter((p) => p.met).length
  return [{
    type: 'precedent',
    label: `Precedent · ${list.length} similar check${list.length > 1 ? 's' : ''}`,
    met,
    notMet: list.length - met,
    items: list.map((p) => ({ statement: p.statement, met: p.met, reason: p.reason })),
  }]
}

/** For the model, under each criterion it judges. */
export function precedentLines(list) {
  if (!list?.length) return ''
  return list.map((p) => `    PRECEDENT · ${p.met ? 'met' : 'not met'} · [${p.kind}] ${p.statement}${p.reason ? ` — ${p.reason.slice(0, 160)}` : ''}`).join('\n')
}

/** Copies every stored verdict's checks into the index (first setup, or after a reset). */
export async function backfill(db) {
  if (!precedentOn()) return 0
  const { data } = await db.from('verdicts')
    .select('id, created_at, submission:submissions(milestone_id), criterion_results(criterion_id, passed, layer, explanation, criteria(id, statement, kind))')
    .order('created_at', { ascending: true })
  let n = 0
  for (const v of data || []) {
    const rows = (v.criterion_results || []).filter((r) => r.criteria)
    n += await indexVerdict({
      verdictId: v.id, milestoneId: v.submission?.milestone_id, at: v.created_at,
      criteria: rows.map((r) => r.criteria), results: rows,
    })
  }
  return n
}
