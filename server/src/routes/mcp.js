/*  ============================================================================
    Verdikt over MCP — any AI agent can hire, or work, through verified PayPal escrow.
    POST /mcp (Streamable HTTP, stateless, JSON responses) with `Authorization: Bearer vk_…`
    (a personal agent token from Settings). Every tool runs through the same API routes a person
    uses, as that person, so the rules are identical; what the agent says is labelled as theirs.
    Money still needs the person: fund_milestone returns a PayPal link the person approves.
    ============================================================================ */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { z } from 'zod'
import { db, userFromRequest } from '../lib/supabase.js'
import { config } from '../config.js'
import { money } from '../lib/money.js'

const INSTRUCTIONS = `Verdikt is AI-verified escrow on PayPal for freelance software work.
A contract is agreed in a contract room (a neutral AI mediator keeps a versioned terms sheet), locked into
milestones with testable checks, signed by both sides, then each milestone is held in PayPal escrow
(authorize, not charge). The freelancer delivers a live URL + public repo; an AI verifier tests every check
and PayPal releases the money only when they pass. Typical flow for a client agent: open_contract_room →
share the invite → read_room / say_in_room (or delegate_negotiation) → accept_terms → sign_terms →
fund_milestone (the person approves the PayPal hold) → confirm_hold → get_verdict. Never invent amounts:
ask your person for budget and dates.`

const json = (data) => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 1) }] })
const fail = (e) => ({ isError: true, content: [{ type: 'text', text: e.message || String(e) }] })

function buildServer(app, auth, user) {
  const server = new McpServer({ name: 'verdikt', version: '1.0.0' }, { instructions: INSTRUCTIONS })

  // every write goes through the real API, as this person
  const api = async (method, url, payload) => {
    const res = await app.inject({ method, url: `/api${url}`, headers: { authorization: auth, 'content-type': 'application/json' }, payload: payload ?? {} })
    const body = res.json()
    if (res.statusCode >= 400) throw new Error(body.error || `Request failed (${res.statusCode})`)
    return body
  }
  const tool = (name, description, inputSchema, run, annotations = {}) =>
    server.registerTool(name, { description, inputSchema, annotations }, async (args) => {
      try { return json(await run(args)) } catch (e) { return fail(e) }
    })
  const mine = async (contractId) => {
    const { data: c } = await db().from('contracts')
      .select('*, client:profiles!contracts_client_id_fkey(display_name), freelancer:profiles!contracts_freelancer_id_fkey(display_name), milestones(*, criteria(*), submissions(*, verdicts(*, criterion_results(*))))')
      .eq('id', contractId).maybeSingle()
    if (!c || ![c.client_id, c.freelancer_id].includes(user.id)) throw new Error('Contract not found')
    return c
  }
  const roleIn = (c) => (c.client_id === user.id ? 'client' : 'freelancer')
  const link = (c) => `${config.appUrl}/contracts/${c.id}`

  tool('whoami', 'Who this token acts for, and whether their PayPal payout email is set.', {}, async () => {
    const { data: p } = await db().from('profiles').select('display_name, intent, paypal_email').eq('id', user.id).single()
    return { name: p?.display_name, email: user.email, usually: p?.intent, paypalPayoutEmail: p?.paypal_email || null, token: user.tokenLabel }
  }, { readOnlyHint: true })

  tool('list_contracts', 'Every contract this person is part of, with status, role, total and the counterparty.', {}, async () => {
    const { data } = await db().from('contracts')
      .select('id, title, status, created_at, client_id, freelancer_id, terms, client:profiles!contracts_client_id_fkey(display_name), freelancer:profiles!contracts_freelancer_id_fkey(display_name), milestones(amount_cents, status)')
      .or(`client_id.eq.${user.id},freelancer_id.eq.${user.id}`).order('created_at', { ascending: false }).limit(30)
    return (data || []).map((c) => {
      const total = c.status === 'scoping' ? (c.terms?.milestones || []).reduce((s, m) => s + m.amount_cents, 0) : c.milestones.reduce((s, m) => s + m.amount_cents, 0)
      return { id: c.id, title: c.title, status: c.status, role: roleIn(c), with: (roleIn(c) === 'client' ? c.freelancer : c.client)?.display_name || 'not joined yet', total: money(total), url: link(c) }
    })
  }, { readOnlyHint: true })

  tool('get_contract', 'One contract: milestones with amounts, PayPal escrow status, checks and the latest verdicts.', { contract_id: z.string() }, async ({ contract_id }) => {
    const c = await mine(contract_id)
    return {
      id: c.id, title: c.title, status: c.status, role: roleIn(c), url: link(c), invite_code: c.invite_code,
      signed: { client: !!c.client_signed_at, freelancer: !!c.freelancer_signed_at },
      terms: c.status === 'scoping' ? c.terms : undefined,
      milestones: [...c.milestones].sort((a, b) => a.position - b.position).map((m) => {
        const sub = [...m.submissions].sort((a, b) => b.attempt - a.attempt)[0]
        const v = [...(sub?.verdicts || [])].sort((a, b) => b.created_at.localeCompare(a.created_at))[0]
        return {
          id: m.id, position: m.position, title: m.title, amount: money(m.amount_cents), status: m.status, due: m.due_at?.slice(0, 10) || null,
          checks: [...m.criteria].sort((a, b) => a.position - b.position).map((x) => x.statement),
          verdict: v ? { outcome: v.outcome, summary: v.summary } : null,
        }
      }),
    }
  }, { readOnlyHint: true })

  tool('open_contract_room', 'Open a contract room: the mediator drafts the first terms from the idea. Returns the invite link for the other side.', {
    title: z.string().describe('Short project title'),
    idea: z.string().describe('What is needed, budget and timing in a sentence or two — in the person’s words'),
    role: z.enum(['client', 'freelancer']).default('client'),
    counterpart_email: z.string().optional(),
  }, async ({ title, idea, role, counterpart_email }) => {
    const r = await api('POST', '/rooms', { title, idea, role, counterpartEmail: counterpart_email || '' })
    return { contract_id: r.id, invite_code: r.inviteCode, invite_link: `${config.appUrl}/join/${r.inviteCode}`, url: `${config.appUrl}/contracts/${r.id}`, next: 'Share the invite link; then read_room after a few seconds to see the mediator’s first terms sheet.' }
  })

  tool('read_room', 'The contract room: the current terms sheet (version, payments, done-means, open questions), who accepted which version, and the latest messages.', { contract_id: z.string() }, async ({ contract_id }) => {
    const c = await mine(contract_id)
    const { data: msgs } = await db().from('room_messages').select('author, body, via_agent, version, suggestions, created_at').eq('contract_id', c.id).order('created_at', { ascending: false }).limit(20)
    return {
      status: c.status, you_are: roleIn(c), mediator_busy: c.mediator_busy, terms: c.terms,
      accepted: { client_version: c.terms_client_v, freelancer_version: c.terms_freelancer_v },
      messages: [...(msgs || [])].reverse().map((m) => ({ from: m.author + (m.via_agent ? ' (agent)' : ''), text: m.body, at: m.created_at, ...(m.suggestions?.length && { suggested_replies: m.suggestions.filter((s) => s.for === roleIn(c) || s.for === 'both').map((s) => s.text) }) })),
    }
  }, { readOnlyHint: true })

  tool('say_in_room', 'Say something in the contract room for this person (labelled as their agent). The mediator updates the terms sheet after each message.', {
    contract_id: z.string(), message: z.string(),
  }, async ({ contract_id, message }) => api('POST', `/contracts/${contract_id}/room/messages`, { body: message }))

  tool('accept_terms', 'Accept a version of the terms sheet. When both sides accept the same version the terms lock into milestones and checks are drafted.', {
    contract_id: z.string(), version: z.number().int(),
  }, async ({ contract_id, version }) => api('POST', `/contracts/${contract_id}/room/accept`, { version }))

  tool('delegate_negotiation', 'Hand the room to Verdikt’s negotiating agent with a private mandate (the other side never sees it). It accepts only terms within the limits.', {
    contract_id: z.string(),
    limit_usd: z.number().optional().describe('Client: the most to pay in total · freelancer: the least to take'),
    deadline_days: z.number().int().optional().describe('Client: live within N days · freelancer: needs at least N days'),
    must_haves: z.array(z.string()).optional().describe('Client: must be in scope · freelancer: must stay out of scope'),
    auto_accept: z.boolean().default(true),
  }, async ({ contract_id, limit_usd, deadline_days, must_haves, auto_accept }) => api('POST', `/contracts/${contract_id}/room/mandate`, {
    limitCents: limit_usd ? Math.round(limit_usd * 100) : null, deadlineDays: deadline_days ?? null, mustHaves: must_haves || [], autoAccept: auto_accept,
  }))

  tool('sign_terms', 'Sign the locked terms (every milestone and its checks). When both have signed, the first milestone can be funded.', {
    contract_id: z.string(),
  }, async ({ contract_id }) => api('POST', `/contracts/${contract_id}/sign`))

  tool('fund_milestone', 'Client only: create the PayPal escrow order for a milestone. Returns a PayPal link the PERSON must open to approve the hold — an agent can’t approve money.', {
    milestone_id: z.string(),
  }, async ({ milestone_id }) => {
    const r = await api('POST', `/milestones/${milestone_id}/fund`)
    return { paypal_order: r.orderId, approve_link: r.approveUrl, next: 'Give this link to your person. After they approve on PayPal, call confirm_hold (the app also confirms it when they return).' }
  })

  tool('confirm_hold', 'Client only: after the person approved on PayPal, place the hold (PayPal authorization). The money is held, not charged.', {
    milestone_id: z.string(),
  }, async ({ milestone_id }) => api('POST', `/milestones/${milestone_id}/authorize`))

  tool('submit_delivery', 'Freelancer only: deliver a funded milestone. The AI verifier opens the live URL at desktop and mobile size, reads the public repo and tests every signed check.', {
    milestone_id: z.string(), live_url: z.string().url(), repo_url: z.string().url(), notes: z.string().optional(),
  }, async ({ milestone_id, live_url, repo_url, notes }) => api('POST', `/milestones/${milestone_id}/submit`, { liveUrl: live_url, repoUrl: repo_url, notes: notes || '' }))

  tool('get_verdict', 'The latest verdict on a milestone: pass/fail, and for each check whether it was met and why.', { milestone_id: z.string() }, async ({ milestone_id }) => {
    const { data: m } = await db().from('milestones').select('id, title, status, contract_id, criteria(id, statement), submissions(attempt, live_url, verdicts(outcome, summary, created_at, criterion_results(criterion_id, passed, explanation)))').eq('id', milestone_id).maybeSingle()
    if (!m) throw new Error('Milestone not found')
    await mine(m.contract_id)
    const sub = [...m.submissions].sort((a, b) => b.attempt - a.attempt)[0]
    const v = [...(sub?.verdicts || [])].sort((a, b) => b.created_at.localeCompare(a.created_at))[0]
    if (!v) return { status: m.status, verdict: null }
    return {
      status: m.status, outcome: v.outcome, summary: v.summary,
      checks: m.criteria.map((c) => { const r = v.criterion_results.find((x) => x.criterion_id === c.id); return { check: c.statement, met: r?.passed ?? null, why: r?.explanation || '' } }),
    }
  }, { readOnlyHint: true })

  return server
}

export default async function mcpRoutes(app) {
  app.post('/mcp', async (request, reply) => {
    const user = await userFromRequest(request)
    if (!user) {
      return reply.code(401).send({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Add a Verdikt agent token (Settings → AI agents): Authorization: Bearer vk_…' } })
    }
    const server = buildServer(app, request.headers.authorization, user)
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
    reply.hijack()
    reply.raw.on('close', () => { transport.close(); server.close() })
    await server.connect(transport)
    await transport.handleRequest(request.raw, reply.raw, request.body)
  })
  // stateless server: no stream to resume and no session to end
  const notHere = async (request, reply) => reply.code(405).header('allow', 'POST').send({ jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Method not allowed' } })
  app.get('/mcp', notHere)
  app.delete('/mcp', notHere)
}
