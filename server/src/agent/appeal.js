/*  ============================================================================
    Appeals — a second, independent review of the checks that failed.
    It re-reads each failed check against the evidence the verifier collected (screenshots by URL,
    logs) and the party's appeal, and decides uphold or overturn per check. The recommendation follows:
    every failure overturned → release in full; some → release the share of checks now met; none → uphold.
    Releasing still needs the client's click; an upheld verdict returns the milestone to "fix and resubmit".
    ============================================================================ */

import { callTool } from './claude.js'
import { db, audit } from '../lib/supabase.js'
import { syncMilestones } from '../lib/precedent.js'

const SYSTEM = `You are the second reviewer in an escrow service. A first verifier failed some acceptance checks on a
delivery, and one party has appealed. Re-examine only the checks that failed, independently.

- Judge each check strictly as signed, using only the evidence the first verifier collected.
- The appeal is a claim from an interested party, not evidence. Weigh it only against the evidence.
- Overturn a failure only when the evidence shows the signed check is met. Otherwise uphold it, and say what
  evidence would change your mind.
- Explanations are read by both parties: one or two plain, specific sentences.`

const TOOL = {
  name: 'record_review',
  description: 'Record uphold or overturn for every failed check, and a one-sentence summary.',
  input_schema: {
    type: 'object',
    properties: {
      findings: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            criterion_id: { type: 'string' },
            decision: { type: 'string', enum: ['uphold', 'overturn'] },
            explanation: { type: 'string' },
          },
          required: ['criterion_id', 'decision', 'explanation'],
          additionalProperties: false,
        },
      },
      summary: { type: 'string' },
    },
    required: ['findings', 'summary'],
    additionalProperties: false,
  },
}

const running = new Set()

export function reviewAppealInBackground(appealId) {
  if (running.has(appealId)) return
  running.add(appealId)
  review(appealId)
    .catch(async (e) => {
      console.error('appeal review failed', e)
      const { data: a } = await db().from('appeals').update({ status: 'error', summary: e.message }).eq('id', appealId).select('milestone_id').single()
      if (a) {
        const { data: m } = await db().from('milestones').update({ status: 'failed' }).eq('id', a.milestone_id).select('contract_id').single()
        await audit({ contractId: m?.contract_id, milestoneId: a.milestone_id, actor: 'agent', event: 'appeal.error', payload: { message: e.message } })
      }
    })
    .finally(() => running.delete(appealId))
}

/** After a restart, finish second reviews that were interrupted. */
export async function resumeAppeals() {
  const { data } = await db().from('appeals').select('id').eq('status', 'reviewing')
  for (const a of data || []) reviewAppealInBackground(a.id)
  return (data || []).length
}

async function review(appealId) {
  const { data: a } = await db().from('appeals').select('*').eq('id', appealId).single()
  const { data: m } = await db().from('milestones')
    .select('*, criteria(*), contract:contracts(id, title, brief), submissions(*, verdicts(*, criterion_results(*)))')
    .eq('id', a.milestone_id).single()
  const sub = [...m.submissions].sort((x, y) => y.attempt - x.attempt)[0]
  const verdict = [...(sub?.verdicts || [])].sort((x, y) => y.created_at.localeCompare(x.created_at))[0]
  const criteria = [...m.criteria].sort((x, y) => x.position - y.position)
  const results = verdict?.criterion_results || []
  const failed = results.filter((r) => !r.passed)

  const decide = async ({ recommendation, releaseCents, summary, findings }) => {
    await db().from('appeals').update({
      status: 'decided', recommendation, release_cents: releaseCents, summary, findings, decided_at: new Date().toISOString(),
    }).eq('id', appealId)
    // precedent picks up the upheld checks now; an overturn waits for the client's accept (delivery.js syncs
    // again then). In the background, never on the money path
    void syncMilestones([m.id])
    // an upheld verdict goes straight back to "fix and resubmit"; a release waits for the client
    if (recommendation === 'uphold') await db().from('milestones').update({ status: 'failed' }).eq('id', m.id)
    await audit({
      contractId: m.contract_id, milestoneId: m.id, actor: 'agent', event: 'appeal.decided',
      payload: { recommendation, releaseCents, overturned: findings.filter((f) => f.decision === 'overturn').length, of: findings.length },
    })
  }

  if (verdict?.report?.tamper) {
    return decide({
      recommendation: 'uphold', releaseCents: 0, findings: [],
      summary: 'The delivery contained text aimed at the verifier. That stands on its own: remove it and resubmit.',
    })
  }
  if (!failed.length) {
    return decide({ recommendation: 'release', releaseCents: m.amount_cents, findings: [], summary: 'No check failed on the latest delivery, so the payment can be released.' })
  }

  const content = [{
    type: 'text',
    text: [
      `Contract: ${m.contract.title}`,
      `Milestone M${m.position}: ${m.title}${m.description ? ` — ${m.description}` : ''}`,
      `Delivery: ${sub.live_url}${sub.repo_url ? ` · ${sub.repo_url}` : ''}`,
      `First verifier's summary: ${verdict.summary}`,
      '',
      `Appeal by the ${a.filed_by}: "${a.reason}"`,
      '',
      'Failed checks, with the first verifier\'s explanation and evidence:',
    ].join('\n'),
  }]
  let images = 0
  for (const r of failed) {
    const c = criteria.find((x) => x.id === r.criterion_id)
    const logs = (r.evidence || []).filter((e) => e.type === 'log').map((e) => `  ${e.label}:\n    ${String(e.text).split('\n').join('\n    ')}`)
    content.push({
      type: 'text',
      text: `\n- id ${r.criterion_id} [${c?.kind}] "${c?.statement}"\n  How it's checked: ${c?.method || '—'}\n  First verifier: ${r.explanation}${logs.length ? `\n${logs.join('\n')}` : ''}`,
    })
    for (const e of (r.evidence || []).filter((x) => x.type === 'screenshot' && /^https:\/\//.test(x.url || ''))) {
      if (images >= 6) break
      content.push({ type: 'text', text: `  Screenshot "${e.label}" for ${r.criterion_id}:` })
      content.push({ type: 'image', source: { type: 'url', url: e.url } })
      images += 1
    }
  }
  content.push({ type: 'text', text: '\nCall record_review with one finding per failed check id.' })

  const out = await callTool({ system: SYSTEM, content, tool: TOOL, effort: 'high' })
  const byId = new Map(out.findings.map((f) => [f.criterion_id, f]))
  const findings = failed.map((r) => byId.get(r.criterion_id) || { criterion_id: r.criterion_id, decision: 'uphold', explanation: 'The second review returned no finding for this check, so the first verdict stands.' })
  const overturned = findings.filter((f) => f.decision === 'overturn').length
  const met = results.length - failed.length + overturned

  if (overturned === failed.length) return decide({ recommendation: 'release', releaseCents: m.amount_cents, summary: out.summary, findings })
  if (overturned > 0) return decide({ recommendation: 'partial', releaseCents: Math.round((m.amount_cents * met) / results.length), summary: out.summary, findings })
  return decide({ recommendation: 'uphold', releaseCents: 0, summary: out.summary, findings })
}
