/*  ============================================================================
    The contract room's shared moves — used by the routes (people), the negotiating agents and the
    MCP server (outside AI agents), so every path accepts and locks terms the same way.
    ============================================================================ */

import { db, audit } from './supabase.js'
import { draftCriteria, fallbackCriteria } from '../agent/draft.js'
import { compileInBackground } from '../agent/compile.js'

const KINDS = ['visual', 'functional', 'code', 'performance', 'content']

/** The agent drafts testable checks for each milestone (standard ones if it is unavailable). */
export async function draftInBackground(contract, milestones) {
  let drafted
  try {
    drafted = await draftCriteria({ title: contract.title, brief: contract.brief, milestones })
  } catch (e) {
    console.error('drafting failed', e)
    await audit({ contractId: contract.id, actor: 'agent', event: 'terms.draft_failed', payload: { message: e.message } })
  }
  const rows = milestones.flatMap((m) => (drafted?.get(m.position) || fallbackCriteria(m)).map((c, i) => ({
    milestone_id: m.id, position: i + 1, kind: KINDS.includes(c.kind) ? c.kind : 'functional', statement: c.statement, method: c.method || '',
  })))
  await db().from('criteria').insert(rows)
  await db().from('contracts').update({ status: 'negotiating' }).eq('id', contract.id)
  await audit({ contractId: contract.id, actor: 'agent', event: 'terms.drafted', payload: { criteria: rows.length } })
  // each check becomes probes both parties can see before they sign
  compileInBackground(contract.id)
}

export class RoomError extends Error {
  constructor(status, message) { super(message); this.statusCode = status }
}

export const say = (contractId, author, body, extra = {}) =>
  db().from('room_messages').insert({ contract_id: contractId, author, body, ...extra })

export const ROOM_SELECT = '*, client:profiles!contracts_client_id_fkey(display_name), freelancer:profiles!contracts_freelancer_id_fkey(display_name)'

export async function loadRoom(contractId) {
  const { data: c } = await db().from('contracts').select(ROOM_SELECT).eq('id', contractId).maybeSingle()
  return c
}

export const roleOf = (c, userId) => (c.client_id === userId ? 'client' : c.freelancer_id === userId ? 'freelancer' : null)
export const nameOf = (c, role) => (role === 'client' ? c.client : c.freelancer)?.display_name || role

export const totalOf = (terms) => (terms?.milestones || []).reduce((s, m) => s + (m.amount_cents || 0), 0)
export const lastDueOf = (terms) => Math.max(0, ...(terms?.milestones || []).map((m) => m.due_days || 0))

/** Accept `version` of the terms for `role`; when the other side accepted the same one, lock the room. */
export async function acceptVersion(c, role, version, { viaAgent = false } = {}) {
  const terms = c.terms
  if (c.status !== 'scoping') throw new RoomError(409, 'The terms are already locked')
  if (!terms || version !== terms.version) throw new RoomError(409, 'The terms changed while you were reading — check the latest version')
  if (!c.client_id || !c.freelancer_id) throw new RoomError(409, 'Both of you need to be in the room first')
  const ms = terms.milestones || []
  if (!ms.length || ms.length > 6 || ms.some((m) => !m.title?.trim() || !Number.isInteger(m.amount_cents) || m.amount_cents < 100)) {
    throw new RoomError(409, 'The terms need 1–6 milestones, each with a title and at least $1.00')
  }
  const name = nameOf(c, role)
  const field = role === 'client' ? 'terms_client_v' : 'terms_freelancer_v'
  await db().from('contracts').update({ [field]: version }).eq('id', c.id)
  await say(c.id, 'system', `${viaAgent ? `${name}'s agent` : name} accepted version ${version}.`, { version })
  await audit({ contractId: c.id, actor: role, event: 'room.accepted', payload: { version, viaAgent } })

  const otherAccepted = (role === 'client' ? c.terms_freelancer_v : c.terms_client_v) === version
  if (!otherAccepted) return { locked: false }

  // ---- lock: the sheet becomes milestones and a brief; the checks are drafted from them
  const brief = [
    terms.summary,
    terms.scope?.length ? `In scope: ${terms.scope.join('; ')}.` : '',
    terms.out_of_scope?.length ? `Out of scope: ${terms.out_of_scope.join('; ')}.` : '',
  ].filter(Boolean).join(' ')
  const { data: rows, error } = await db().from('milestones').insert(ms.map((m, i) => ({
    contract_id: c.id, position: i + 1, title: m.title.trim(),
    description: (m.done_means || []).map((d) => d.replace(/\.?$/, '.')).join(' '), amount_cents: m.amount_cents,
    due_at: m.due_days > 0 ? new Date(Date.now() + m.due_days * 864e5).toISOString() : null, status: 'draft',
  }))).select()
  if (error) throw error
  await db().from('contracts').update({ status: 'drafting', brief: brief || c.brief }).eq('id', c.id)
  await db().from('room_mandates').update({ status: 'accepted', active: false, updated_at: new Date().toISOString() }).eq('contract_id', c.id).eq('active', true)
  await say(c.id, 'system', `Both of you accepted version ${version}. The terms are locked — the agent is turning each milestone into checks you'll sign.`, { version })
  await audit({ contractId: c.id, actor: 'system', event: 'room.locked', payload: { version, milestones: rows.length } })
  draftInBackground({ ...c, brief: brief || c.brief }, rows.sort((a, b) => a.position - b.position))
  return { locked: true }
}
