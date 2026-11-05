/*  ============================================================================
    Dispute defense — after a milestone is paid, the client may still open a PayPal dispute.
    Claude reads the dispute itself through PayPal's MCP server (get_dispute, list_transactions),
    compares the claim with Verdikt's record (the signed checks, the verdict, its evidence, the
    timeline) and writes the answer PayPal's reviewer will read. The dispute is also fetched over REST
    and put in front of it, so a PayPal MCP outage never leaves the agent blind.
      contest → submitted to PayPal as evidence right away (no money moves)
      accept  → never automatic: it waits for a person, because accepting refunds the buyer
    ============================================================================ */

import { callAgent } from './claude.js'
import * as paypal from '../lib/paypal.js'
import { db, audit } from '../lib/supabase.js'
import { money } from '../lib/money.js'

const MCP_URL = paypal.sandbox ? 'https://mcp.sandbox.paypal.com/sse' : 'https://mcp.paypal.com/sse'

const SYSTEM = `You answer PayPal disputes for Verdikt, an escrow service. Verdikt released this payment only after an
AI verifier checked the delivery against acceptance criteria both parties signed (or after the client chose to
release it). The buyer has now opened a PayPal dispute.

1. Read the dispute with the PayPal tools (get_dispute): its reason, the buyer's messages, what PayPal asks for.
   If the tools return an error, rely on the dispute details given below.
2. Compare the claim with Verdikt's record below.
3. Choose a stance:
   - contest: the record shows the work was delivered as signed;
   - accept: the record supports the buyer (for example the client released despite failed checks, or the
     claim concerns something the checks show is missing).
4. Write the response PayPal's reviewer will read: factual and specific, under 1,800 characters, citing the
   signed checks, the verdict and the evidence links. No threats, no promises, nothing the record doesn't show.`

const TOOL = {
  name: 'record_defense',
  description: 'Record the stance, the response to send to PayPal, and the key points behind it.',
  input_schema: {
    type: 'object',
    properties: {
      stance: { type: 'string', enum: ['contest', 'accept'] },
      response: { type: 'string' },
      key_points: { type: 'array', items: { type: 'string' } },
    },
    required: ['stance', 'response', 'key_points'],
    additionalProperties: false,
  },
}

const cents = (amount) => (amount?.value ? Math.round(Number(amount.value) * 100) : null)

/** Find disputes PayPal has opened on Verdikt captures and answer the new ones. Safe to call often. */
export async function syncDisputes() {
  const list = await paypal.listDisputes()
  let added = 0
  for (const d of list.items || []) {
    const { data: known } = await db().from('disputes').select('id, paypal_status').eq('paypal_dispute_id', d.dispute_id).maybeSingle()
    if (known) {
      if (known.paypal_status !== d.status) await db().from('disputes').update({ paypal_status: d.status, updated_at: new Date().toISOString() }).eq('id', known.id)
      continue
    }
    const detail = await paypal.getDispute(d.dispute_id)
    const captureIds = (detail.disputed_transactions || []).map((t) => t.seller_transaction_id).filter(Boolean)
    const { data: m } = captureIds.length
      ? await db().from('milestones').select('id, contract_id').in('paypal_capture_id', captureIds).maybeSingle()
      : { data: null }
    if (!m) continue // not one of ours
    const { data: row } = await db().from('disputes').insert({
      milestone_id: m.id, contract_id: m.contract_id, paypal_dispute_id: d.dispute_id,
      reason: detail.reason || d.reason, paypal_status: detail.status || d.status, amount_cents: cents(detail.dispute_amount || d.dispute_amount),
    }).select().single()
    await audit({ contractId: m.contract_id, milestoneId: m.id, actor: 'paypal', event: 'dispute.opened', payload: { disputeId: d.dispute_id, reason: row.reason } })
    added += 1
    defendInBackground(row.id)
  }
  return { checked: (list.items || []).length, added }
}

const running = new Set()
export function defendInBackground(disputeRowId) {
  if (running.has(disputeRowId)) return
  running.add(disputeRowId)
  defend(disputeRowId)
    .catch(async (e) => {
      console.error('dispute defense failed', e)
      const { data: d } = await db().from('disputes').update({ state: 'error', error: e.message, updated_at: new Date().toISOString() }).eq('id', disputeRowId).select().single()
      await audit({ contractId: d?.contract_id, milestoneId: d?.milestone_id, actor: 'agent', event: 'dispute.error', payload: { message: e.message } })
    })
    .finally(() => running.delete(disputeRowId))
}

async function defend(disputeRowId) {
  await db().from('disputes').update({ state: 'drafting', updated_at: new Date().toISOString() }).eq('id', disputeRowId)
  const { data: d } = await db().from('disputes').select('*').eq('id', disputeRowId).single()
  const { data: m } = await db().from('milestones')
    .select('*, criteria(*), contract:contracts(id, title, brief, currency, client_signed_at, freelancer_signed_at), submissions(*, verdicts(*, criterion_results(*)))')
    .eq('id', d.milestone_id).single()
  const { data: log } = await db().from('audit_log').select('event, actor, created_at, payload').eq('milestone_id', m.id).order('created_at')
  // terms shaped in a contract room: the buyer's own words and the version both parties accepted
  const { data: roomLog } = await db().from('audit_log').select('event, actor, created_at, payload').eq('contract_id', m.contract.id).in('event', ['room.accepted', 'room.locked']).order('created_at')
  const { data: roomSaid } = await db().from('room_messages').select('author, body, created_at').eq('contract_id', m.contract.id).in('author', ['client', 'freelancer']).order('created_at').limit(30)
  const sub = [...m.submissions].sort((x, y) => y.attempt - x.attempt)[0]
  const verdict = [...(sub?.verdicts || [])].sort((x, y) => y.created_at.localeCompare(x.created_at))[0]
  const criteria = [...m.criteria].sort((x, y) => x.position - y.position)
  const cur = m.contract.currency || 'USD'
  const pd = await paypal.getDispute(d.paypal_dispute_id).catch(() => null)
  const buyerSays = (pd?.messages || []).filter((x) => x.posted_by === 'BUYER').map((x) => `  "${String(x.content).slice(0, 400)}"`)

  const record = [
    pd ? `PayPal's dispute record: status ${pd.status}, stage ${pd.dispute_life_cycle_stage || '—'}, reason ${pd.reason}, seller response due ${pd.seller_response_due_date || '—'}.` : '',
    buyerSays.length ? `The buyer wrote:\n${buyerSays.join('\n')}` : '',
    `PayPal dispute: ${d.paypal_dispute_id} · reason ${d.reason || 'unknown'}${d.amount_cents ? ` · ${money(d.amount_cents, cur)}` : ''}`,
    `Contract "${m.contract.title}" — brief: ${m.contract.brief}`,
    `Terms signed by the client ${m.contract.client_signed_at} and the freelancer ${m.contract.freelancer_signed_at}.`,
    roomLog?.length ? `The terms were negotiated in Verdikt's contract room and accepted by both parties: ${roomLog.map((e) => `${e.actor} ${e.event.replace('room.', '')} v${e.payload?.version} at ${e.created_at}`).join('; ')}.` : '',
    roomSaid?.length ? `What the parties wrote in the contract room (client = buyer):\n${roomSaid.map((x) => `  ${x.created_at} ${x.author}: "${x.body.slice(0, 300)}"`).join('\n')}` : '',
    `Milestone M${m.position} "${m.title}": ${money(m.amount_cents, cur)} held by PayPal on ${m.funded_at}, released ${money(m.released_cents || m.amount_cents, cur)} on ${m.released_at} (capture ${m.paypal_capture_id}).`,
    `Delivery: ${sub?.live_url || '—'}${sub?.repo_url ? ` · ${sub.repo_url}` : ''} (attempt ${sub?.attempt ?? '—'})`,
    `Verdict: ${verdict ? `${verdict.outcome.toUpperCase()} · ${verdict.summary}` : 'none — the client released without a passing verdict'}`,
    '',
    'Signed checks and results:',
    ...criteria.map((c) => {
      const r = verdict?.criterion_results?.find((x) => x.criterion_id === c.id)
      const shots = (r?.evidence || []).filter((e) => e.type === 'screenshot' && /^https:/.test(e.url || '')).map((e) => `${e.label}: ${e.url}`)
      return `- [${r ? (r.passed ? 'MET' : 'NOT MET') : 'unchecked'}] ${c.statement}${r ? ` — ${r.explanation}` : ''}${shots.length ? `\n    evidence: ${shots.join(' · ')}` : ''}`
    }),
    '',
    'Timeline:',
    ...(log || []).map((e) => `- ${e.created_at} ${e.actor} ${e.event}`),
  ].filter(Boolean).join('\n')

  const { input, trace } = await callAgent({
    system: SYSTEM,
    content: [{ type: 'text', text: `${record}\n\nRead dispute ${d.paypal_dispute_id} with the PayPal tools, then call record_defense.` }],
    tool: TOOL,
    effort: 'high',
    mcpServers: [{ type: 'url', url: MCP_URL, name: 'paypal', authorization_token: await paypal.mcpToken() }],
    // allowlist: the agent may read disputes and transactions — nothing that moves money
    toolsets: [{
      type: 'mcp_toolset', mcp_server_name: 'paypal',
      default_config: { enabled: false },
      configs: { get_dispute: { enabled: true }, list_disputes: { enabled: true }, list_transactions: { enabled: true } },
    }],
  })

  let state = 'needs_review'
  let error = null
  if (input.stance === 'contest') {
    try {
      await paypal.provideEvidence(d.paypal_dispute_id, { notes: input.response })
      state = 'submitted'
    } catch (e) {
      // early in a dispute (inquiry) PayPal takes a message rather than evidence
      try {
        await paypal.sendDisputeMessage(d.paypal_dispute_id, input.response)
        state = 'submitted'
      } catch (e2) {
        error = `PayPal didn't accept the response: ${e2.message}`
      }
    }
  }
  await db().from('disputes').update({
    stance: input.stance, response: input.response, key_points: input.key_points, agent_trace: trace,
    state: error ? 'error' : state, error, updated_at: new Date().toISOString(),
  }).eq('id', disputeRowId)
  await audit({
    contractId: d.contract_id, milestoneId: d.milestone_id, actor: 'agent',
    event: error ? 'dispute.error' : input.stance === 'contest' ? 'dispute.answered' : 'dispute.needs_review',
    payload: { disputeId: d.paypal_dispute_id, stance: input.stance, tools: trace.map((t) => t.tool), message: error },
  })
}
