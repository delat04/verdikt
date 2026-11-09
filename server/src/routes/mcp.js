/*  ============================================================================
    Verdikt over MCP — any AI agent can hire, or work, through verified PayPal escrow.
    POST /mcp (Streamable HTTP, stateless, JSON responses) with `Authorization: Bearer vk_…`
    (a personal agent token from Settings). Every tool runs through the same API routes a person
    uses, as that person, so the rules are identical; what the agent says is labelled as theirs.
    Money needs the person once: either they approve each hold on PayPal (fund_milestone returns the link), or
    they set a spending limit in the app — one PayPal hold — and fund_milestone holds each job from it directly,
    within the total, the most per job and the end date they chose. Either way money moves only on passing checks.
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
(authorize, not charge). The freelancer delivers a live URL + public repo; the verifier runs every check and
PayPal releases the money only when they pass.

Each signed check compiles into deterministic probes (layout at 375px, exact copy, HTTP status, console errors,
axe-core accessibility, repo files and scripts…). Probes decide most checks with no model call; only what they
can't decide goes to Claude. So the checks work like a test suite your coding agent can run before delivering.

Finding each other: a client's agent can price_check a brief (fair price + what it costs online, from live web prices),
post_job, then review_applications (each ranked with Verdikt's record of the freelancer and red flags) and
hire_applicant — that opens a contract room with both sides. A freelancer's agent can find_jobs and apply_to_job, or
scout_opportunities for public posts elsewhere and offer to do them through Verdikt; check_portfolio_project adds past
work that Verdikt opens and checks live, which clients see beside the paid record. Either side can check_against_paypal:
every hold, release and payout read back from PayPal and compared with Verdikt's numbers.

Client agent: open_contract_room → share the invite → read_room / say_in_room (or delegate_negotiation) →
accept_terms → sign_terms → fund_milestone → wait_for_verdict.

Money: call get_spending_limit first. If your person set a spending limit (one PayPal hold they approved once in the
app), fund_milestone holds the milestone from it at once — no link, no waiting — as long as the job fits: the total
left, the most for one job, and the end date. Their note says what the limit is for: stay inside it. Without a limit
(or when a job doesn't fit), fund_milestone returns a PayPal link your person must approve, then call confirm_hold.
Either way the money is held, not paid: PayPal captures it only when the signed checks pass; a failed job frees its
share of the limit, and whatever the limit never spends is voided, never charged. You can't create or raise a limit.
Freelancer (coding) agent: get_checks → build → precheck_delivery (free dry run; repeat until nothing fails) →
ask_verifier if a check is unclear → submit_delivery → wait_for_verdict → if a check fails, fix it and submit again.

Expenses: a milestone may carry an expense budget (set_expense_budget, before signing) held in the same PayPal hold.
The freelancer's agent buys what the project needs (a domain, hosting…) and calls claim_expense with the receipt:
deterministic checks read it and, when they all pass, PayPal reimburses it at once — the budget is the limit the
client already agreed to. get_expenses shows what's left. Unused budget goes back to the client when the milestone settles.
Never invent amounts: ask your person for budget and dates.`

const json = (data) => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 1) }] })
const fail = (e) => ({ isError: true, content: [{ type: 'text', text: e.message || String(e) }] })

function buildServer(app, auth, user) {
  const server = new McpServer({ name: 'verdikt', version: '1.0.0' }, { instructions: INSTRUCTIONS })

  // every write goes through the real API, as this person
  const api = async (method, url, payload) => {
    const res = await app.inject(method === 'GET'
      ? { method, url: `/api${url}`, headers: { authorization: auth } }
      : { method, url: `/api${url}`, headers: { authorization: auth, 'content-type': 'application/json' }, payload: payload ?? {} })
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
          expense_budget: m.expense_budget_cents ? { up_to: money(m.expense_budget_cents), covers: m.expense_covers } : null,
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

  tool('get_spending_limit', 'Client side: the spending limit your person approved for you (one PayPal hold): how much is left, the most for any one job, when it ends, what it is for, and every job it is holding or has paid for. null when there is none — then each hold needs your person’s approval on PayPal.', {}, async () => {
    const { current } = await api('GET', '/spend-limits')
    if (!current || current.status === 'closed') return { limit: null, note: 'No spending limit: fund_milestone returns a PayPal link your person approves for each hold. They can set a limit in the app (Settings → Spending limit).' }
    const cur = current.currency
    return {
      status: current.status, left: money(current.availableCents, cur), left_cents: current.availableCents, total: money(current.capCents, cur),
      most_per_job: money(current.perJobCents, cur), ends: current.endsAt, for: current.note || null,
      paid_for_passing_work: money(current.capturedCents, cur), held_for_jobs: money(current.reservedCents, cur),
      jobs: current.holds.map((h) => ({ contract: h.contract, milestone: h.title, held: money(h.holdCents, cur), paid: money(h.capturedCents, cur), status: h.status })),
      ...(current.status !== 'active' && { note: current.status === 'awaiting_approval' ? 'Your person hasn’t approved it on PayPal yet.' : 'It is ending: no new holds; it closes once its jobs settle.' }),
    }
  }, { readOnlyHint: true })

  tool('fund_milestone', 'Client only: put a milestone into PayPal escrow. With an active spending limit that fits the job (total left, most per job, end date), the hold is placed from it at once and nothing else is needed. Otherwise returns a PayPal link the PERSON must open to approve the hold — an agent can’t approve money — then call confirm_hold.', {
    milestone_id: z.string(),
    use_limit: z.boolean().optional().describe('Default true: hold from the spending limit when there is one and the job fits it. false always asks the person on PayPal.'),
  }, async ({ milestone_id, use_limit = true }) => {
    let why = null
    if (use_limit) {
      try {
        const r = await api('POST', `/milestones/${milestone_id}/fund-from-limit`)
        return { held: true, from: 'your person’s spending limit', held_cents: r.holdCents, limit_left_cents: r.leftCents, next: 'Nothing to approve: the money is held. The freelancer can deliver; call wait_for_verdict after they submit.' }
      } catch (e) {
        why = e.message
      }
    }
    const r = await api('POST', `/milestones/${milestone_id}/fund`)
    return {
      ...(why && why !== 'No spending limit is set up' && { not_from_limit: why }),
      paypal_order: r.orderId, approve_link: r.approveUrl, next: 'Give this link to your person. After they approve on PayPal, call confirm_hold (the app also confirms it when they return).',
    }
  })

  tool('confirm_hold', 'Client only: after the person approved on PayPal, place the hold (PayPal authorization). The money is held, not charged.', {
    milestone_id: z.string(),
  }, async ({ milestone_id }) => api('POST', `/milestones/${milestone_id}/authorize`))

  tool('get_checks', 'The signed checks for a milestone as a test suite: each check, the deterministic probes it compiles to (what exactly is measured, which failures are decisive), and whether probes alone decide it or the model judges the rest.', {
    milestone_id: z.string(),
  }, async ({ milestone_id }) => api('GET', `/milestones/${milestone_id}/checks`), { readOnlyHint: true })

  tool('check_portfolio_project', 'Freelancer: add a past project to your portfolio (or re-check one already there by project_id) and open it live with Verdikt\'s portfolio checks — loads on desktop and phone, fits 375px, paints under 2.5 s, axe-core accessibility, title/description/favicon, working links, and for a GitHub repo a README and no committed secrets. No model, no tokens. Results show on your public proof page and in application reviews. Up to 12 projects, 10 checks an hour.', {
    project_id: z.string().optional(), title: z.string().optional(), live_url: z.string().url().optional(),
    repo_url: z.string().url().optional(), summary: z.string().optional(),
  }, async ({ project_id, title, live_url, repo_url, summary }) => {
    const id = project_id || (await api('POST', '/portfolio', { title, liveUrl: live_url, repoUrl: repo_url || '', summary: summary || '' })).id
    const p = await api('POST', `/portfolio/${id}/check`)
    return {
      project_id: p.id, title: p.title, site: p.liveUrl, passed: `${p.check.counts.pass} of ${p.check.total}`, took_ms: p.check.ms,
      checks: p.check.checks.map((c) => ({ check: c.statement, status: c.status, measured: c.explanation, ...(c.fix && { fix: c.fix }) })),
      next: p.check.counts.fail ? 'Fix what fails on the live site and check again — clients see the latest result.' : 'Every check passes. Clients see this on your proof page and next to your applications.',
    }
  })

  tool('check_against_paypal', 'Read every hold, release and payout behind this person’s ledger back from PayPal itself and say, per milestone, whether Verdikt and PayPal agree — catches a refund made in PayPal, a chargeback, a returned or unclaimed payout. Read-only, nothing moves. Up to 60 recent milestones, 12 checks an hour.', {}, async () => {
    const r = await api('POST', '/ledger/reconcile')
    const count = (st) => r.milestones.filter((m) => m.state === st).length
    return {
      checked_at: r.checkedAt,
      matches: count('matches'), differs: count('differs'), waiting_on_paypal: count('waiting'),
      attention: r.milestones.filter((m) => m.state !== 'matches').map((m) => ({
        milestone: m.title, state: m.state,
        checks: m.checks.filter((c) => c.met !== true).map((c) => ({ what: c.what, paypal_id: c.id, verdikt: c.verdikt, paypal: c.paypal, note: c.note })),
      })),
    }
  }, { readOnlyHint: true })

  tool('precheck_delivery', 'Freelancer only: dry-run every deterministic probe against a live URL (and repo) before delivering. No verdict, no money, no model tokens. Returns each check as pass, fail (with what was measured and how to fix it) or judge (left for the verifier). Both parties see that a pre-check ran. Up to 12 an hour per milestone.', {
    milestone_id: z.string(), live_url: z.string().url(), repo_url: z.string().url().optional(),
  }, async ({ milestone_id, live_url, repo_url }) => {
    const r = await api('POST', `/milestones/${milestone_id}/precheck`, { liveUrl: live_url, repoUrl: repo_url || '' })
    return {
      ready: r.ready, counts: r.counts, took_ms: r.ms,
      integrity_warning: r.integrity ? `Hidden text on the page addresses the verifier — remove it or the verdict fails: ${r.integrity.quotes.join(' | ')}` : undefined,
      checks: r.checks.map((c) => ({
        id: c.id, check: c.statement, status: c.status, decided_by: c.by || undefined,
        ...(c.status === 'fail' && { measured: c.observed, fix: c.fix }),
        probes: c.probes.map((p) => `${p.status.toUpperCase()} ${p.label} — ${p.observed}`),
      })),
      next: r.ready ? 'Nothing fails deterministically. Checks marked judge are decided by the verifier at delivery: submit_delivery when ready.' : 'Fix the failing checks, redeploy, and pre-check again.',
    }
  }, { readOnlyHint: true })

  tool('ask_verifier', 'Ask the verifier how a check is tested or why it failed. It explains and never decides: the verifier that judges never reads this thread, and both parties see every question and answer.', {
    milestone_id: z.string(), question: z.string(),
  }, async ({ milestone_id, question }) => api('POST', `/milestones/${milestone_id}/verifier/ask`, { question }))

  tool('submit_delivery', 'Freelancer only: deliver a funded milestone. The verifier opens the live URL at desktop and mobile size, reads the public repo and runs every signed check; then call wait_for_verdict.', {
    milestone_id: z.string(), live_url: z.string().url(), repo_url: z.string().url(), notes: z.string().optional(),
  }, async ({ milestone_id, live_url, repo_url, notes }) => {
    const r = await api('POST', `/milestones/${milestone_id}/submit`, { liveUrl: live_url, repoUrl: repo_url, notes: notes || '' })
    return { ...r, next: 'Call wait_for_verdict: it returns as soon as the verdict is in.' }
  })

  // ---- the job board: find each other, then the room does the rest
  tool('price_check', 'A fair price for a job and a plan of everything it costs online (domain, hosting, fonts…), from current public prices found by web search — each cost with its source, the suggested expense budget, and Verdikt’s fee. Use it before posting a job, applying, or setting an expense budget. Cached per brief.', {
    title: z.string(), brief: z.string(), currency: z.string().default('USD'),
  }, async ({ title, brief, currency }) => {
    const r = await api('POST', '/price-check', { title, brief, currency })
    const $ = (c) => money(c, r.currency)
    return {
      fair_price: `${$(r.work.lowCents)}–${$(r.work.highCents)}, typically ${$(r.work.typicalCents)} · ${r.days} working days`, basis: r.work.basis,
      payments: r.milestones.map((m) => `${m.title}: ${m.sharePct}%`),
      online_costs: r.costs.map((c) => `${c.item}: ${$(c.cents)}${c.period === 'once' ? '' : `/${c.period}`}${c.optional ? ' (optional)' : ''}${c.source ? ` — ${c.source}` : ''}`),
      plan: {
        work: $(r.plan.workCents), bought_during_the_build: $(r.plan.upfrontCents), suggested_expense_budget: r.plan.expenseBudgetCents ? `${$(r.plan.expenseBudgetCents)} for ${r.plan.covers.join(', ')}` : 'none',
        after_launch: `${$(r.plan.monthlyCents)}/month + ${$(r.plan.yearlyCents)}/year`, verdikt_fee: `${r.plan.feePercent}% of the work (${$(r.plan.feeCents)}), taken from the freelancer’s payout`,
      },
      notes: r.notes || undefined, sources: r.sources.map((s) => s.url), cached: r.cached,
    }
  }, { readOnlyHint: true })

  tool('post_job', 'Post a job so freelancers (and their agents) can apply. This person becomes the client. Ask your person for the budget range and timing; price_check first if unsure.', {
    title: z.string(), brief: z.string().describe('What should exist when it’s done — pages, features, devices'),
    budget_min_usd: z.number().optional(), budget_max_usd: z.number().optional(), due_days: z.number().int().optional(),
    skills: z.array(z.string()).optional(),
  }, async ({ title, brief, budget_min_usd, budget_max_usd, due_days, skills }) => {
    const r = await api('POST', '/jobs', {
      title, brief, budgetMinCents: budget_min_usd ? Math.round(budget_min_usd * 100) : null, budgetMaxCents: budget_max_usd ? Math.round(budget_max_usd * 100) : null,
      dueDays: due_days ?? null, skills: skills || [],
    })
    return { job_id: r.id, url: `${config.appUrl}/jobs`, next: 'Call review_applications later: each application arrives with a review. hire_applicant opens a contract room with them.' }
  })

  tool('find_jobs', 'Open jobs on Verdikt posted by others (newest first), optionally matching words like a stack or a kind of work.', {
    query: z.string().optional(),
  }, async ({ query }) => {
    const r = await api('GET', `/jobs${query ? `?q=${encodeURIComponent(query)}` : ''}`)
    return r.open.map((j) => ({
      id: j.id, title: j.title, brief: j.brief.slice(0, 600), skills: j.skills, posted_by: j.client?.name,
      budget: j.budgetMinCents || j.budgetMaxCents ? `${j.budgetMinCents ? money(j.budgetMinCents, j.currency) : '?'}–${j.budgetMaxCents ? money(j.budgetMaxCents, j.currency) : '?'}` : 'not stated',
      wanted_in_days: j.dueDays, applications: j.applications, you_applied: j.applied,
    }))
  }, { readOnlyHint: true })

  tool('apply_to_job', 'Freelancer side: apply to an open job with a price, a timeline and a concrete pitch (how you would do it). The client sees it with a review: Verdikt’s record of your paid work, red flags (asking to pay off the platform caps the score), and Claude’s read of the pitch. Never invent the price: ask your person.', {
    job_id: z.string(), price_usd: z.number().positive(), days: z.number().int().optional(), pitch: z.string(),
  }, async ({ job_id, price_usd, days, pitch }) => api('POST', `/jobs/${job_id}/apply`, { priceCents: Math.round(price_usd * 100), days: days ?? null, pitch }))

  tool('review_applications', 'Client side: your posted jobs with every application ranked — price, timeline, the pitch, Verdikt’s record of the freelancer’s PayPal-settled work, red flags, and a fit score with strengths, risks and a question to ask. Also lists the jobs you applied to.', {}, async () => {
    const r = await api('GET', '/jobs')
    return {
      posted: r.posted.map((j) => ({
        job_id: j.id, title: j.title, status: j.status, contract_id: j.contractId || undefined,
        applications: j.candidates.map((a) => ({
          application_id: a.id, from: a.freelancer?.name + (a.viaAgent ? ' (agent)' : ''), price: money(a.priceCents, j.currency), days: a.days, status: a.status,
          fit: a.review?.fit ?? 'reviewing', summary: a.review?.summary, flags: a.review?.flags?.map((f) => f.text), risks: a.review?.risks, ask_them: a.review?.ask || undefined,
          pitch: a.pitch.slice(0, 500),
        })),
      })),
      applied: r.applied.map((a) => ({ job: a.job?.title, status: a.status, price: money(a.priceCents, a.job?.currency || 'USD'), contract_id: a.job?.contractId || undefined })),
    }
  }, { readOnlyHint: true })

  tool('hire_applicant', 'Client side: hire an applicant. A contract room opens with both of you, seeded with the job brief and their accepted price; the mediator drafts terms from there. Nothing is charged: after the terms lock and both sign, your person approves the PayPal hold.', {
    application_id: z.string(),
  }, async ({ application_id }) => {
    const r = await api('POST', `/applications/${application_id}/hire`)
    return { ...r, url: `${config.appUrl}/contracts/${r.contractId}` }
  })

  tool('scout_opportunities', 'Freelancer side: search the public web for recent posts from people looking to hire for work that fits these skills. Each result is a real page the search returned, with why it fits and a drafted first message that offers to do it through Verdikt’s escrow. It finds and drafts — your person decides whether to reach out.', {
    skills: z.string().describe('What you do: stack, kind of work, e.g. "Vue and Supabase web apps, landing pages"'),
  }, async ({ skills }) => api('POST', '/opportunities/scout', { skills }), { readOnlyHint: true })

  tool('plan_budget_purchase', 'Either side, once a milestone has an expense budget: search live listings from thousands of stores (Channel3) for something the work needs to buy, in stock and within what is left of the budget. Pass plan_product_id (from a search result) to pin it as a planned purchase: a receipt from that store at about the listed price is then reimbursed without waiting for the client; anything off the plan waits for them. Links are Channel3 buy links.', {
    milestone_id: z.string(), query: z.string().optional(), plan_product_id: z.string().optional(),
  }, async ({ milestone_id, query, plan_product_id }) => {
    if (plan_product_id) {
      const r = await api('POST', `/milestones/${milestone_id}/expenses/plan`, { productId: plan_product_id })
      return { planned: r.planned.map((p) => ({ product_id: p.id, title: p.title, listed: money(p.priceCents), store: p.domain, url: p.url })) }
    }
    const r = await api('POST', `/milestones/${milestone_id}/expenses/products`, { query: query || '' })
    return {
      left_in_budget: money(r.leftCents),
      products: r.products.map((p) => ({ product_id: p.id, title: p.title, brand: p.brand || undefined, price: money(p.priceCents), store: p.domain, url: p.url })),
      next: r.products.length ? 'Pass plan_product_id to pin the one to buy, then buy it from that store and claim_expense with the receipt.' : 'Nothing in stock within the budget — try other words.',
    }
  })

  tool('set_expense_budget', 'Before signing: give a milestone an expense budget — money the freelancer may spend on what the project needs (a domain, hosting, fonts, API credits), held in the same PayPal hold and reimbursed against receipts. Changing it resets both signatures. 0 removes it. Ask your person for the amount.', {
    milestone_id: z.string(),
    up_to_usd: z.number().min(0).max(10000),
    covers: z.array(z.string()).max(8).describe('What it may be spent on, e.g. ["Domain", "Hosting"]'),
  }, async ({ milestone_id, up_to_usd, covers }) => {
    await api('PUT', `/milestones/${milestone_id}/expense-budget`, { budgetCents: Math.round(up_to_usd * 100), covers })
    return { ok: true, next: 'Both sides sign the terms again (sign_terms).' }
  })

  tool('get_expenses', 'A milestone’s expense budget: what it covers, what’s spent, waiting and left, and every claim with its checks and PayPal capture.', {
    milestone_id: z.string(),
  }, async ({ milestone_id }) => api('GET', `/milestones/${milestone_id}/expenses`), { readOnlyHint: true })

  tool('claim_expense', 'Freelancer only: claim a project expense from the milestone’s budget with its receipt (PDF, PNG, JPG or WebP, base64, up to 5 MB). Deterministic checks read the receipt — amount on it, fits the budget, dated during the contract, not claimed before, something the budget covers. All pass → PayPal captures that amount from the hold and pays it to the freelancer at once, no fee. One fails → rejected with the reason and the fix. Unreadable → the client decides.', {
    milestone_id: z.string(),
    amount_usd: z.number().positive().describe('Exactly what the receipt shows (or one line of it)'),
    merchant: z.string().describe('Who was paid'),
    purpose: z.string().describe('What it was for, in a few words'),
    receipt_base64: z.string().describe('The receipt file, base64-encoded'),
    receipt_type: z.enum(['application/pdf', 'image/png', 'image/jpeg', 'image/webp']),
    receipt_filename: z.string().optional(),
  }, async ({ milestone_id, amount_usd, merchant, purpose, receipt_base64, receipt_type, receipt_filename }) => {
    const r = await api('POST', `/milestones/${milestone_id}/expenses`, {
      amountCents: Math.round(amount_usd * 100), merchant, purpose,
      receipt: { data: receipt_base64, type: receipt_type, name: receipt_filename || '' },
    })
    return {
      ...r,
      next: {
        approved: 'Reimbursed: PayPal captured it from the hold and the payout is on its way.',
        rejected: 'Not reimbursed — see the failed check and its fix. A corrected claim can be sent again.',
        needs_client: 'The checks could not settle it; the client approves or declines it in Verdikt.',
        error: 'The checks passed but PayPal did not capture it; the client can retry from Verdikt.',
      }[r.status] || undefined,
    }
  })

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

  tool('wait_for_verdict', 'Wait (up to ~50 s per call) until the verifier finishes a milestone, then return the verdict, what decided each check, and the money that moved through PayPal. Call again if it is still checking.', {
    milestone_id: z.string(), timeout_seconds: z.number().int().min(5).max(55).default(50),
  }, async ({ milestone_id, timeout_seconds }) => {
    const until = Date.now() + timeout_seconds * 1000
    for (;;) {
      const { data: m } = await db().from('milestones').select('id, title, status, contract_id, progress, amount_cents, released_cents, tranches, criteria(id, statement, position), submissions(attempt, verdicts(outcome, summary, created_at, report, criterion_results(criterion_id, passed, layer, explanation)))').eq('id', milestone_id).maybeSingle()
      if (!m) throw new Error('Milestone not found')
      await mine(m.contract_id)
      if (!['submitted', 'verifying'].includes(m.status) || Date.now() > until) {
        const sub = [...m.submissions].sort((a, b) => b.attempt - a.attempt)[0]
        const v = [...(sub?.verdicts || [])].sort((a, b) => b.created_at.localeCompare(a.created_at))[0]
        if (['submitted', 'verifying'].includes(m.status)) {
          const done = Object.entries(m.progress || {}).filter(([k, s]) => k !== '@' && ['pass', 'fail'].includes(s)).length
          return { status: m.status, still_checking: true, stage: m.progress?.['@']?.stage || null, decided_so_far: `${done} of ${m.criteria.length}`, next: 'Call wait_for_verdict again.' }
        }
        if (!v) return { status: m.status, verdict: null }
        const e = v.report?.engine
        return {
          status: m.status, outcome: v.outcome, summary: v.summary,
          engine: e ? { decided: e.decided, model_tokens: (e.tokens?.input || 0) + (e.tokens?.output || 0), took_ms: e.ms?.total, receipt: e.receipt } : undefined,
          money: { held: money(m.amount_cents - (m.released_cents || 0)), released: money(m.released_cents || 0), paypal_captures: (m.tranches || []).length },
          checks: [...m.criteria].sort((a, b) => a.position - b.position).map((c) => {
            const r = v.criterion_results.find((x) => x.criterion_id === c.id)
            return { id: c.id, check: c.statement, met: r?.passed ?? null, decided_by: r?.layer, why: r?.explanation || '' }
          }),
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 2500))
    }
  }, { readOnlyHint: true })

  return server
}

export default async function mcpRoutes(app) {
  // a receipt rides along base64 in claim_expense
  app.post('/mcp', { bodyLimit: 8 * 1024 * 1024 }, async (request, reply) => {
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
