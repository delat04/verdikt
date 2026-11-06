/*  ============================================================================
    Change orders — the guard against scope creep. After the terms are signed, either side can ask
    for something new. Claude reads the request against the signed terms: if a signed check (or the
    agreed scope) already covers it, it says which one — no extra charge, no argument. If it's new
    work, it drafts a priced milestone with testable "done means" lines, priced from this contract's
    own rates. The other side accepts, counters or declines; an accepted change becomes the next
    milestone, funded through PayPal escrow and verified like the rest.
    ============================================================================ */

import { db, audit } from '../lib/supabase.js'
import { requireUser } from '../lib/auth.js'
import { callTool } from '../agent/claude.js'
import { money } from '../lib/money.js'
import { compileInBackground } from '../agent/compile.js'

const SYSTEM = `You guard a signed freelance software contract against scope creep, neutrally for both sides.
Given the signed terms (brief, scope, out-of-scope, milestones with their testable checks) and a new request,
decide whether the request is already covered by what was signed.
- in_scope = true only if a signed check or the agreed scope clearly covers it; quote that line in covered_by.
  Then the work is owed at no extra cost.
- Otherwise it's new work: draft one milestone — a short title (the deliverable only), 2 to 4 "done means"
  lines an AI verifier can test from the live site, page text and public repo, a fair price in US cents and
  due_days. Price it from this contract's own rates (given below); round to $10. Explicitly out-of-scope items
  are new work by definition.
- reply: at most 50 words, plain and neutral, addressed to both parties by first name.`

const TOOL = {
  name: 'assess_change',
  description: 'Record whether the request is covered by the signed terms, or the priced change order for it.',
  input_schema: {
    type: 'object',
    properties: {
      in_scope: { type: 'boolean' },
      covered_by: { type: 'string' },
      reply: { type: 'string' },
      title: { type: 'string' },
      done_means: { type: 'array', items: { type: 'string' } },
      amount_cents: { type: 'integer' },
      due_days: { type: 'integer' },
    },
    required: ['in_scope', 'covered_by', 'reply', 'title', 'done_means', 'amount_cents', 'due_days'],
    additionalProperties: false,
  },
}

async function contractFor(request, reply) {
  const { data: c } = await db().from('contracts')
    .select('*, client:profiles!contracts_client_id_fkey(display_name), freelancer:profiles!contracts_freelancer_id_fkey(display_name), milestones(*, criteria(*))')
    .eq('id', request.params.id).maybeSingle()
  if (!c) { reply.code(404).send({ error: 'Contract not found' }); return null }
  const role = c.client_id === request.user.id ? 'client' : c.freelancer_id === request.user.id ? 'freelancer' : null
  if (!role) { reply.code(403).send({ error: 'You are not a party to this contract' }); return null }
  return { c, role }
}

async function review(changeId) {
  const { data: ch } = await db().from('change_orders').select('*').eq('id', changeId).single()
  const { data: c } = await db().from('contracts')
    .select('*, client:profiles!contracts_client_id_fkey(display_name), freelancer:profiles!contracts_freelancer_id_fkey(display_name), milestones(*, criteria(*))')
    .eq('id', ch.contract_id).single()
  const ms = [...c.milestones].sort((a, b) => a.position - b.position)
  const checks = ms.reduce((s, m) => s + m.criteria.length, 0) || 1
  const total = ms.reduce((s, m) => s + m.amount_cents, 0)
  const days = Math.max(1, ...ms.map((m) => (m.due_at ? Math.ceil((new Date(m.due_at) - new Date(c.created_at)) / 864e5) : 0)))
  const first = (n) => (n || '').split(' ')[0]
  try {
    const out = await callTool({
      system: SYSTEM,
      effort: 'medium',
      tool: TOOL,
      content: [{
        type: 'text',
        text: [
          `Contract: ${c.title} · client ${first(c.client?.display_name)} · freelancer ${first(c.freelancer?.display_name)}`,
          `Brief: ${c.brief}`,
          c.terms?.scope?.length ? `Agreed scope: ${c.terms.scope.join('; ')}` : '',
          c.terms?.out_of_scope?.length ? `Agreed OUT of scope: ${c.terms.out_of_scope.join('; ')}` : '',
          '',
          'Signed milestones and checks:',
          ...ms.flatMap((m) => [`M${m.position} "${m.title}" ${money(m.amount_cents)} — ${m.status}`, ...m.criteria.map((x) => `   - ${x.statement}`)]),
          '',
          `This contract's rates: ${money(total)} for ${checks} checks (≈ ${money(Math.round(total / checks))} per check), about ${days} days in total.`,
          '',
          `New request from the ${ch.requested_by}: ${ch.request}`,
          '',
          'Call assess_change.',
        ].filter((l) => l !== '').join('\n'),
      }],
    })
    const patch = out.in_scope
      ? { status: 'in_scope', covered_by: out.covered_by.slice(0, 400), reply: out.reply.slice(0, 600) }
      : {
          status: 'proposed', reply: out.reply.slice(0, 600), title: out.title.slice(0, 120),
          done_means: out.done_means.slice(0, 4), amount_cents: Math.max(100, Math.round(out.amount_cents / 1000) * 1000),
          due_days: Math.min(120, Math.max(1, out.due_days)), priced_by: 'agent',
        }
    await db().from('change_orders').update(patch).eq('id', changeId)
    await audit({ contractId: c.id, actor: 'agent', event: out.in_scope ? 'change.in_scope' : 'change.proposed', payload: { amountCents: patch.amount_cents, title: patch.title } })
  } catch (e) {
    console.error('change review failed', e)
    await db().from('change_orders').update({ status: 'error', reply: 'The agent could not review this request just now. Try again in a minute.' }).eq('id', changeId)
  }
}

export default async function changeRoutes(app) {
  app.addHook('preHandler', requireUser)

  app.post('/contracts/:id/changes', async (request, reply) => {
    const found = await contractFor(request, reply)
    if (!found) return
    const { c, role } = found
    if (!(c.client_signed_at && c.freelancer_signed_at)) return reply.code(409).send({ error: 'Change orders start once both of you have signed the terms' })
    const text = String(request.body?.request || '').trim()
    if (text.length < 8) return reply.code(400).send({ error: 'Describe the change in a sentence' })
    const { data: ch, error } = await db().from('change_orders').insert({ contract_id: c.id, requested_by: role, request: text.slice(0, 1000) }).select().single()
    if (error) throw error
    await audit({ contractId: c.id, actor: role, event: 'change.requested', payload: { request: text.slice(0, 120) } })
    review(ch.id)
    return { id: ch.id }
  })

  // the side that didn't set the current price decides
  const decider = (ch) => (ch.priced_by === 'agent' ? (ch.requested_by === 'client' ? 'freelancer' : 'client') : ch.priced_by === 'client' ? 'freelancer' : 'client')
  async function changeFor(request, reply) {
    const { data: ch } = await db().from('change_orders').select('*').eq('id', request.params.id).maybeSingle()
    if (!ch) { reply.code(404).send({ error: 'Change order not found' }); return null }
    request.params.id = ch.contract_id
    const found = await contractFor(request, reply)
    if (!found) return null
    if (ch.status !== 'proposed') { reply.code(409).send({ error: `This change is ${ch.status.replace('_', ' ')}` }); return null }
    return { ...found, ch }
  }

  app.post('/changes/:id/accept', async (request, reply) => {
    const found = await changeFor(request, reply)
    if (!found) return
    const { c, role, ch } = found
    if (role !== decider(ch)) return reply.code(409).send({ error: 'Waiting for the other side to respond to this price' })
    const ms = [...c.milestones].sort((a, b) => a.position - b.position)
    const open = ms.some((m) => !['released', 'refunded'].includes(m.status))
    const { data: m, error } = await db().from('milestones').insert({
      contract_id: c.id, position: (ms.at(-1)?.position || 0) + 1, title: ch.title,
      description: ch.done_means.map((d) => d.replace(/\.?$/, '.')).join(' '), amount_cents: ch.amount_cents,
      due_at: new Date(Date.now() + ch.due_days * 864e5).toISOString(), status: open ? 'draft' : 'awaiting_funding',
    }).select().single()
    if (error) throw error
    await db().from('criteria').insert(ch.done_means.map((d, i) => ({
      milestone_id: m.id, position: i + 1, kind: /375px|1440px|visible|layout|header/i.test(d) ? 'visual' : /second|LCP|fast|load/i.test(d) ? 'performance' : 'functional',
      statement: d.replace(/\.$/, ''), method: 'Agreed as a change order; checked against the live URL and repository.',
    })))
    await db().from('change_orders').update({ status: 'accepted', milestone_id: m.id, decided_at: new Date().toISOString() }).eq('id', ch.id)
    compileInBackground(c.id)
    if (c.status === 'completed') await db().from('contracts').update({ status: 'active' }).eq('id', c.id)
    await audit({ contractId: c.id, milestoneId: m.id, actor: role, event: 'change.accepted', payload: { amountCents: ch.amount_cents, title: ch.title, position: m.position } })
    return { ok: true, milestoneId: m.id }
  })

  app.post('/changes/:id/counter', async (request, reply) => {
    const found = await changeFor(request, reply)
    if (!found) return
    const { c, role, ch } = found
    if (role !== decider(ch)) return reply.code(409).send({ error: 'Waiting for the other side to respond to this price' })
    const cents = Math.round(Number(request.body?.amountCents))
    const days = Math.round(Number(request.body?.dueDays ?? ch.due_days))
    if (!(cents >= 100) || !(days >= 1)) return reply.code(400).send({ error: 'A price of at least $1 and at least 1 day' })
    await db().from('change_orders').update({ amount_cents: cents, due_days: days, priced_by: role }).eq('id', ch.id)
    await audit({ contractId: c.id, actor: role, event: 'change.countered', payload: { amountCents: cents, dueDays: days } })
    return { ok: true }
  })

  app.post('/changes/:id/decline', async (request, reply) => {
    const found = await changeFor(request, reply)
    if (!found) return
    const { c, role, ch } = found
    await db().from('change_orders').update({ status: 'declined', decided_at: new Date().toISOString() }).eq('id', ch.id)
    await audit({ contractId: c.id, actor: role, event: 'change.declined', payload: { title: ch.title } })
    return { ok: true }
  })
}
