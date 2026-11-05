/*  ============================================================================
    Live backend — Supabase for reads (row-level security) and realtime,
    the Verdikt API for every write (PayPal, the agent, signatures).
    Returns the same shapes as services/demo.js.
    ============================================================================ */

import { supabase } from '@/lib/supabase'

const BASE = import.meta.env.VITE_API_URL || 'http://localhost:4100'

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
})

function mapContract(c) {
  const milestones = [...(c.milestones || [])].sort((a, b) => a.position - b.position).map((m) => ({
    id: m.id, position: m.position, title: m.title, description: m.description || '',
    amountCents: m.amount_cents, dueAt: m.due_at, status: m.status,
    fundedAt: m.funded_at, releasedAt: m.released_at, progress: m.progress || undefined,
    authorizedAt: m.authorized_at, holdExpiresAt: m.hold_expires_at, reauthorizedAt: m.reauthorized_at,
    releasedCents: m.released_cents, voidedCents: m.voided_cents, feeCents: m.fee_cents, payoutCents: m.payout_cents,
    payoutEmail: m.payout_email, payoutStatus: m.payout_status, paidOutAt: m.paid_out_at,
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
      .map((cr) => ({ id: cr.id, position: cr.position, kind: cr.kind, statement: cr.statement, method: cr.method || '' })),
    submissions: [...(m.submissions || [])].sort((a, b) => a.attempt - b.attempt).map((s) => {
      const v = [...(s.verdicts || [])].sort((a, b) => b.created_at.localeCompare(a.created_at))[0]
      return {
        id: s.id, attempt: s.attempt, liveUrl: s.live_url, repoUrl: s.repo_url, notes: s.notes, createdAt: s.created_at,
        verdict: v ? {
          id: v.id, outcome: v.outcome, confidence: Number(v.confidence), summary: v.summary, createdAt: v.created_at,
          integrity: v.report?.tamper || null,
          results: (v.criterion_results || []).map((r) => ({
            criterionId: r.criterion_id, passed: r.passed, confidence: Number(r.confidence), explanation: r.explanation, evidence: r.evidence || [],
          })),
        } : null,
      }
    }),
  }))
  return {
    id: c.id, title: c.title, brief: c.brief, currency: c.currency, status: c.status,
    inviteCode: c.invite_code, inviteEmail: c.invite_email || '', createdAt: c.created_at, createdBy: c.created_by,
    client: person(c.client), freelancer: person(c.freelancer),
    clientSignedAt: c.client_signed_at, freelancerSignedAt: c.freelancer_signed_at,
    milestones,
    activity: [...(c.audit_log || [])].sort((a, b) => b.created_at.localeCompare(a.created_at)).map((a) => ({
      id: a.id, actor: a.actor, event: a.event, payload: a.payload || {}, milestoneId: a.milestone_id, createdAt: a.created_at,
    })),
  }
}

const CONTRACT_SELECT = `
  *, client:profiles!contracts_client_id_fkey(id, display_name, paypal_email),
  freelancer:profiles!contracts_freelancer_id_fkey(id, display_name, paypal_email),
  milestones(*, criteria(*), appeals(*), disputes(*), submissions(*, verdicts(*, criterion_results(*))))`

export const live = {
  mode: 'live',

  subscribe(fn) {
    const channel = supabase.channel(`verdikt-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'contracts' }, fn)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'milestones' }, fn)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'verdicts' }, fn)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'appeals' }, fn)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'disputes' }, fn)
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
    return mapContract(data)
  },
  createContract: (payload) => call('/contracts', { body: payload }),
  previewInvite: (code) => call(`/invites/${encodeURIComponent(code)}`, { method: 'GET' }),
  joinContract: (code) => call('/contracts/join', { body: { code } }),

  // ---- terms
  updateCriteria: (milestoneId, criteria) => call(`/milestones/${milestoneId}/criteria`, { method: 'PUT', body: { criteria } }),
  signTerms: (contractId) => call(`/contracts/${contractId}/sign`),

  // ---- escrow (PayPal Orders v2: AUTHORIZE → capture / void)
  createOrder: (milestoneId) => call(`/milestones/${milestoneId}/fund`),
  authorizeOrder: (milestoneId) => call(`/milestones/${milestoneId}/authorize`),
  release: (milestoneId, { amountCents } = {}) => call(`/milestones/${milestoneId}/release`, { body: amountCents ? { amountCents } : {} }),
  refund: (milestoneId) => call(`/milestones/${milestoneId}/refund`),
  retryPayout: (milestoneId) => call(`/milestones/${milestoneId}/payout`),

  // ---- delivery, appeals, disputes
  submitWork: (milestoneId, body) => call(`/milestones/${milestoneId}/submit`, { body }),
  appeal: (milestoneId, reason) => call(`/milestones/${milestoneId}/appeal`, { body: { reason } }),
  acceptAppeal: (appealId) => call(`/appeals/${appealId}/accept`),
  declineAppeal: (appealId) => call(`/appeals/${appealId}/decline`),
  syncDisputes: () => call('/disputes/sync'),
  simulateDispute: null,

  loadSample: null,
  reset: null,
}
