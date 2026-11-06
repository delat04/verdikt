/*  ============================================================================
    Live backend — Supabase for reads (row-level security) and realtime,
    the Verdikt API for every write (PayPal, the agent, signatures).
    Returns the same shapes as services/demo.js.
    ============================================================================ */

import { supabase } from '@/lib/supabase'

// deployed, the API serves this app from the same origin; in development it runs on :4100
const BASE = import.meta.env.VITE_API_URL || (import.meta.env.PROD ? '' : 'http://localhost:4100')

async function call(path, { method = 'POST', body } = {}) {
  const { data } = await supabase.auth.getSession()
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(data.session && { Authorization: `Bearer ${data.session.access_token}` }),
    },
    // a JSON content type needs a JSON body, even for actions that carry no data (sign, fund, refund…)
    body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`)
  return json
}

// ---------------------------------------------------------------- mapping (snake → UI shape)
const person = (p) => (p ? { id: p.id, name: p.display_name || p.paypal_email || 'Member', email: p.email || '' } : null)
const profileOf = (p, email) => p && ({
  id: p.id, name: p.display_name, email, intent: p.intent, paypalEmail: p.paypal_email || '', onboarded: !!p.onboarded_at,
  handle: p.handle || '', headline: p.headline || '', publicProof: !!p.public_proof,
})

function mapContract(c) {
  const milestones = [...(c.milestones || [])].sort((a, b) => a.position - b.position).map((m) => ({
    id: m.id, position: m.position, title: m.title, description: m.description || '',
    amountCents: m.amount_cents, dueAt: m.due_at, status: m.status,
    fundedAt: m.funded_at, releasedAt: m.released_at, progress: m.progress || undefined,
    authorizedAt: m.authorized_at, holdExpiresAt: m.hold_expires_at, reauthorizedAt: m.reauthorized_at,
    releasedCents: m.released_cents, voidedCents: m.voided_cents, feeCents: m.fee_cents, payoutCents: m.payout_cents,
    payoutEmail: m.payout_email, payoutStatus: m.payout_status, paidOutAt: m.paid_out_at, tranches: m.tranches || [],
    expenseBudgetCents: m.expense_budget_cents || 0, expenseCovers: m.expense_covers || [],
    expenses: [...(m.expenses || [])].sort((a, b) => a.created_at.localeCompare(b.created_at)).map((e) => ({
      id: e.id, amountCents: e.amount_cents, merchant: e.merchant, purpose: e.purpose, receiptName: e.receipt_name, receiptType: e.receipt_type,
      status: e.status, decidedBy: e.decided_by, note: e.note, tokens: e.tokens, checks: e.checks || [], extracted: e.extracted || {},
      viaAgent: !!e.via_agent, captureId: e.paypal_capture_id, payoutStatus: e.payout_status, payoutEmail: e.payout_email,
      paidOutAt: e.paid_out_at, createdAt: e.created_at, decidedAt: e.decided_at,
    })),
    paypal: {
      orderId: m.paypal_order_id, authorizationId: m.paypal_authorization_id, captureId: m.paypal_capture_id,
      payoutBatchId: m.paypal_payout_batch_id, payoutItemId: m.paypal_payout_item_id,
    },
    appeals: [...(m.appeals || [])].sort((a, b) => a.created_at.localeCompare(b.created_at)).map((a) => ({
      id: a.id, filedBy: a.filed_by, reason: a.reason, status: a.status, recommendation: a.recommendation,
      releaseCents: a.release_cents, summary: a.summary, findings: a.findings || [], createdAt: a.created_at, decidedAt: a.decided_at,
    })),
    disputes: [...(m.disputes || [])].sort((a, b) => a.created_at.localeCompare(b.created_at)).map((d) => ({
      id: d.id, paypalDisputeId: d.paypal_dispute_id, reason: d.reason, paypalStatus: d.paypal_status, amountCents: d.amount_cents,
      stance: d.stance, response: d.response, keyPoints: d.key_points || [], state: d.state, error: d.error,
      trace: d.agent_trace || [], createdAt: d.created_at, updatedAt: d.updated_at,
    })),
    criteria: [...(m.criteria || [])].sort((a, b) => a.position - b.position)
      .map((cr) => ({
        id: cr.id, position: cr.position, kind: cr.kind, statement: cr.statement, method: cr.method || '',
        spec: Array.isArray(cr.check_spec?.probes) ? { probes: cr.check_spec.probes, sufficient: !!cr.check_spec.sufficient, by: cr.check_spec.by } : null,
      })),
    thread: [...(m.verifier_thread || [])].sort((a, b) => a.created_at.localeCompare(b.created_at)).map((t) => ({
      id: t.id, author: t.author, viaAgent: !!t.via_agent, kind: t.kind, body: t.body, data: t.data || {}, createdAt: t.created_at,
    })),
    submissions: [...(m.submissions || [])].sort((a, b) => a.attempt - b.attempt).map((s) => {
      const v = [...(s.verdicts || [])].sort((a, b) => b.created_at.localeCompare(a.created_at))[0]
      return {
        id: s.id, attempt: s.attempt, liveUrl: s.live_url, repoUrl: s.repo_url, notes: s.notes, createdAt: s.created_at,
        verdict: v ? {
          id: v.id, outcome: v.outcome, confidence: Number(v.confidence), summary: v.summary, createdAt: v.created_at,
          integrity: v.report?.tamper || null,
          engine: v.report?.engine || null,
          results: (v.criterion_results || []).map((r) => ({
            criterionId: r.criterion_id, passed: r.passed, confidence: Number(r.confidence), explanation: r.explanation, evidence: r.evidence || [],
            layer: r.layer || 'model', probes: r.probes || [],
          })),
        } : null,
      }
    }),
  }))
  return {
    id: c.id, title: c.title, brief: c.brief, currency: c.currency, status: c.status, releaseMode: c.release_mode || 'whole',
    inviteCode: c.invite_code, inviteEmail: c.invite_email || '', createdAt: c.created_at, createdBy: c.created_by,
    client: person(c.client), freelancer: person(c.freelancer),
    clientSignedAt: c.client_signed_at, freelancerSignedAt: c.freelancer_signed_at,
    milestones,
    changes: (c.change_orders || []).map((x) => ({
      id: x.id, requestedBy: x.requested_by, request: x.request, status: x.status, coveredBy: x.covered_by, reply: x.reply,
      title: x.title, doneMeans: x.done_means || [], amountCents: x.amount_cents, dueDays: x.due_days, pricedBy: x.priced_by,
      milestoneId: x.milestone_id, createdAt: x.created_at,
    })),
    room: c.terms ? {
      terms: c.terms, clientV: c.terms_client_v, freelancerV: c.terms_freelancer_v, busy: !!c.mediator_busy,
      messages: [...(c.room_messages || [])].sort((a, b) => a.created_at.localeCompare(b.created_at)).map((x) => ({
        id: x.id, author: x.author, body: x.body, viaAgent: !!x.via_agent, suggestions: x.suggestions || [], changes: x.changes || [], version: x.version, createdAt: x.created_at,
      })),
    } : null,
    activity: [...(c.audit_log || [])].sort((a, b) => b.created_at.localeCompare(a.created_at)).map((a) => ({
      id: a.id, actor: a.actor, event: a.event, payload: a.payload || {}, milestoneId: a.milestone_id, createdAt: a.created_at,
    })),
  }
}

const CONTRACT_SELECT = `
  *, client:profiles!contracts_client_id_fkey(id, display_name, paypal_email),
  freelancer:profiles!contracts_freelancer_id_fkey(id, display_name, paypal_email),
  milestones(*, criteria(*), appeals(*), disputes(*), verifier_thread(*), submissions(*, verdicts(*, criterion_results(*))),
    expenses(id, amount_cents, merchant, purpose, receipt_name, receipt_type, status, decided_by, note, tokens, checks, extracted, via_agent,
      paypal_capture_id, payout_status, payout_email, paid_out_at, created_at, decided_at)),
  room_messages(*), change_orders(*)`

export const live = {
  mode: 'live',

  subscribe(fn) {
    const channel = supabase.channel(`verdikt-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'contracts' }, fn)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'milestones' }, fn)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'verdicts' }, fn)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'appeals' }, fn)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'disputes' }, fn)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'room_messages' }, fn)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'room_mandates' }, fn)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'change_orders' }, fn)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'verifier_thread' }, fn)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'expenses' }, fn)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'jobs' }, fn)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'job_applications' }, fn)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'audit_log' }, fn)
      .subscribe()
    const { data } = supabase.auth.onAuthStateChange(() => fn())
    return () => { supabase.removeChannel(channel); data.subscription.unsubscribe() }
  },

  // ---- session
  async getSession() {
    const { data } = await supabase.auth.getSession()
    const user = data.session?.user
    if (!user) return null
    const { data: p } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle()
    return { user: { id: user.id, email: user.email }, profile: profileOf(p, user.email) }
  },
  personas: () => null,
  async signInWithEmail(email, next = '/contracts') {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}` },
    })
    if (error) throw error
  },
  async signOut() {
    await supabase.auth.signOut()
  },
  async updateProfile(patch) {
    const { data: s } = await supabase.auth.getSession()
    const row = {}
    if ('name' in patch) row.display_name = patch.name
    if ('intent' in patch) row.intent = patch.intent
    if ('paypalEmail' in patch) row.paypal_email = patch.paypalEmail || null
    if (patch.onboarded) row.onboarded_at = new Date().toISOString()
    const { data, error } = await supabase.from('profiles').update(row).eq('id', s.session.user.id).select().single()
    if (error) throw error
    return profileOf(data, s.session.user.email)
  },

  // ---- contracts
  async listContracts() {
    const { data, error } = await supabase.from('contracts').select(`${CONTRACT_SELECT}, audit_log(*)`)
      .order('created_at', { ascending: false })
    if (error) throw error
    return data.map(mapContract)
  },
  async listInvites() {
    return (await call('/invites/mine', { method: 'GET' })).invites
  },
  async getContract(id) {
    const { data, error } = await supabase.from('contracts').select(`${CONTRACT_SELECT}, audit_log(*)`).eq('id', id).single()
    if (error) throw new Error('Contract not found')
    const c = mapContract(data)
    // your negotiating agent's mandate — row-level security returns only your own
    if (c.room) {
      const { data: md } = await supabase.from('room_mandates').select('*').eq('contract_id', id).maybeSingle()
      c.room.mandate = md && {
        role: md.role, limitCents: md.limit_cents, deadlineDays: md.deadline_days, mustHaves: md.must_haves || [], notes: md.notes,
        autoAccept: md.auto_accept, active: md.active, status: md.status, statusNote: md.status_note, turns: md.turns,
      }
    }
    return c
  },
  createContract: (payload) => call('/contracts', { body: payload }),
  previewInvite: (code) => call(`/invites/${encodeURIComponent(code)}`, { method: 'GET' }),
  joinContract: (code) => call('/contracts/join', { body: { code } }),

  // ---- the contract room (terms shaped in conversation with the mediator)
  openRoom: (payload) => call('/rooms', { body: payload }),
  sendRoomMessage: (contractId, body) => call(`/contracts/${contractId}/room/messages`, { body: { body } }),
  askMediator: (contractId) => call(`/contracts/${contractId}/room/ask`),
  acceptTerms: (contractId, version) => call(`/contracts/${contractId}/room/accept`, { body: { version } }),
  setMandate: (contractId, mandate) => call(`/contracts/${contractId}/room/mandate`, { body: mandate }),
  stopMandate: (contractId) => call(`/contracts/${contractId}/room/mandate/stop`),

  // ---- terms
  updateCriteria: (milestoneId, criteria) => call(`/milestones/${milestoneId}/criteria`, { method: 'PUT', body: { criteria } }),
  signTerms: (contractId) => call(`/contracts/${contractId}/sign`),
  setReleaseMode: (contractId, mode) => call(`/contracts/${contractId}/release-mode`, { method: 'PUT', body: { mode } }),

  // ---- escrow (PayPal Orders v2: AUTHORIZE → capture / void)
  createOrder: (milestoneId) => call(`/milestones/${milestoneId}/fund`),
  authorizeOrder: (milestoneId) => call(`/milestones/${milestoneId}/authorize`),
  release: (milestoneId, { amountCents } = {}) => call(`/milestones/${milestoneId}/release`, { body: amountCents ? { amountCents } : {} }),
  refund: (milestoneId) => call(`/milestones/${milestoneId}/refund`),
  retryPayout: (milestoneId) => call(`/milestones/${milestoneId}/payout`),

  // ---- delivery, appeals, disputes
  submitWork: (milestoneId, body) => call(`/milestones/${milestoneId}/submit`, { body }),
  precheck: (milestoneId, body) => call(`/milestones/${milestoneId}/precheck`, { body }),
  askVerifier: (milestoneId, question) => call(`/milestones/${milestoneId}/verifier/ask`, { body: { question } }),

  // ---- jobs: find each other first; hiring opens a contract room
  listJobs: () => call('/jobs', { method: 'GET' }),
  postJob: (body) => call('/jobs', { body }),
  applyToJob: (jobId, body) => call(`/jobs/${jobId}/apply`, { body }),
  hireApplicant: (id) => call(`/applications/${id}/hire`),
  declineApplicant: (id) => call(`/applications/${id}/decline`),
  withdrawApplication: (id) => call(`/applications/${id}/withdraw`),
  closeJob: (id) => call(`/jobs/${id}/close`),
  priceCheck: (body) => call('/price-check', { body }),
  scoutOpportunities: (skills) => call('/opportunities/scout', { body: { skills } }),

  // ---- expenses: a budget agreed with the terms, reimbursed against receipts
  setExpenseBudget: (milestoneId, { budgetCents, covers }) => call(`/milestones/${milestoneId}/expense-budget`, { method: 'PUT', body: { budgetCents, covers } }),
  claimExpense: (milestoneId, body) => call(`/milestones/${milestoneId}/expenses`, { body }),
  approveExpense: (id) => call(`/expenses/${id}/approve`),
  declineExpense: (id, reason = '') => call(`/expenses/${id}/decline`, { body: { reason } }),
  expenseReceipt: (id) => call(`/expenses/${id}/receipt`, { method: 'GET' }),
  retryExpensePayout: (id) => call(`/expenses/${id}/payout`),
  appeal: (milestoneId, reason) => call(`/milestones/${milestoneId}/appeal`, { body: { reason } }),
  acceptAppeal: (appealId) => call(`/appeals/${appealId}/accept`),
  declineAppeal: (appealId) => call(`/appeals/${appealId}/decline`),
  syncDisputes: () => call('/disputes/sync'),
  askLedger: (question, columns) => call('/ledger/ask', { body: { question, columns } }),
  requestChange: (contractId, request) => call(`/contracts/${contractId}/changes`, { body: { request } }),
  acceptChange: (id) => call(`/changes/${id}/accept`),
  counterChange: (id, body) => call(`/changes/${id}/counter`, { body }),
  declineChange: (id) => call(`/changes/${id}/decline`),
  getProof: (handle) => call(`/proof/${encodeURIComponent(handle)}`, { method: 'GET' }),
  setProofSettings: (body) => call('/profile/proof', { method: 'PUT', body }),
  listAgentTokens: () => call('/agent-tokens', { method: 'GET' }),
  createAgentToken: (label) => call('/agent-tokens', { body: { label } }),
  revokeAgentToken: (id) => call(`/agent-tokens/${id}/revoke`),
  simulateDispute: null,

  loadSample: null,
  loadRoomSample: null,
  reset: null,
}
