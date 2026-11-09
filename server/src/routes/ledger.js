/*  ============================================================================
    Ask the ledger — a question in plain words becomes a view of the AG Grid ledger: which money
    (in / out), column filters and a sort. Claude only sees the column schema and the question,
    never the rows: the numbers stay in the browser, read through row-level security.
    PayPal check — POST /ledger/reconcile reads every hold, release and payout behind the person's
    ledger back from PayPal and says, per milestone, whether Verdikt and PayPal agree (lib/reconcile.js).
    ============================================================================ */

import { db } from '../lib/supabase.js'
import { requireUser } from '../lib/auth.js'
import { callTool } from '../agent/claude.js'
import { checkMany } from '../lib/reconcile.js'

const SYSTEM = `You turn a question about a freelancer escrow ledger into a grid view. Each row is one milestone
(a payment held in PayPal escrow). Use only the columns you are given. Money values are in US dollars.
Pick the smallest view that answers the question: the side ("in" = money the user earns as freelancer,
"out" = money the user pays as client, "all"), filters, and a sort. For "biggest / largest" sort that money
column descending; for "latest / recent" sort the date descending. "answer" says in one short sentence what the
view shows, without inventing numbers (e.g. "Held milestones over $500, largest first").
If the question can't be answered with these columns, return no filters and say so in answer.`

const TOOL = {
  name: 'set_view',
  description: 'Set the ledger view that answers the question.',
  input_schema: {
    type: 'object',
    properties: {
      answer: { type: 'string' },
      side: { type: 'string', enum: ['all', 'in', 'out'] },
      filters: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            field: { type: 'string' },
            op: { type: 'string', enum: ['equals', 'notEqual', 'contains', 'greaterThan', 'lessThan', 'inRange', 'blank', 'notBlank'] },
            value: { type: 'string' },
            value_to: { type: 'string' },
          },
          required: ['field', 'op', 'value', 'value_to'],
          additionalProperties: false,
        },
      },
      sort: {
        type: 'array',
        items: {
          type: 'object',
          properties: { field: { type: 'string' }, dir: { type: 'string', enum: ['asc', 'desc'] } },
          required: ['field', 'dir'],
          additionalProperties: false,
        },
      },
    },
    required: ['answer', 'side', 'filters', 'sort'],
    additionalProperties: false,
  },
}

export default async function ledgerRoutes(app) {
  app.addHook('preHandler', requireUser)

  app.post('/ledger/ask', async (request, reply) => {
    const question = String(request.body?.question || '').trim().slice(0, 300)
    const columns = Array.isArray(request.body?.columns) ? request.body.columns.slice(0, 30) : []
    if (question.length < 3) return reply.code(400).send({ error: 'Ask a question about your money' })
    const fields = new Set(columns.map((c) => c.field))
    const out = await callTool({
      system: SYSTEM,
      effort: 'low',
      tool: TOOL,
      content: [{
        type: 'text',
        text: [
          `Today: ${new Date().toISOString().slice(0, 10)}`,
          'Columns (field · type · meaning · known values):',
          ...columns.map((c) => `- ${c.field} · ${c.type} · ${c.label}${c.values?.length ? ` · ${c.values.join(', ')}` : ''}`),
          '',
          `Question: ${question}`,
        ].join('\n'),
      }],
    })
    // only columns that exist reach the grid
    return {
      answer: out.answer,
      side: out.side,
      filters: out.filters.filter((f) => fields.has(f.field)),
      sort: out.sort.filter((s) => fields.has(s.field)).slice(0, 2),
    }
  })

  app.post('/ledger/reconcile', async (request, reply) => {
    if (!allow(`reconcile:${request.user.id}`, 12)) return reply.code(429).send({ error: 'That’s 12 PayPal checks this hour — try again later' })
    return reconcileFor(request.user.id)
  })
}

const recent = new Map()
function allow(key, perHour) {
  const now = Date.now()
  const list = (recent.get(key) || []).filter((t) => now - t < 3600e3)
  if (list.length >= perHour) return false
  list.push(now)
  recent.set(key, list)
  return true
}

/** The PayPal check for everything one person is party to: the 60 most recently funded milestones. */
export async function reconcileFor(userId) {
  const checkedAt = new Date().toISOString()
  const { data: contracts } = await db().from('contracts').select('id').or(`client_id.eq.${userId},freelancer_id.eq.${userId}`)
  const ids = (contracts || []).map((c) => c.id)
  if (!ids.length) return { checkedAt, milestones: [] }
  const { data: ms } = await db().from('milestones')
    .select('id, title, position, status, amount_cents, expense_budget_cents, spend_limit_id, released_cents, payout_cents, payout_status, paypal_authorization_id, paypal_capture_id, paypal_payout_batch_id, tranches, contract:contracts(title), expenses(paypal_capture_id, amount_cents, merchant)')
    .in('contract_id', ids)
    .not('paypal_authorization_id', 'is', null)
    .order('funded_at', { ascending: false })
    .limit(60)
  const name = new Map((ms || []).map((m) => [m.id, `${m.contract?.title} · M${m.position} ${m.title}`]))
  const milestones = (await checkMany(ms || [])).map((r) => ({ ...r, title: name.get(r.milestoneId) }))
  return { checkedAt, milestones }
}
