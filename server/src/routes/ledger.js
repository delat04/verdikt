/*  ============================================================================
    Ask the ledger — a question in plain words becomes a view of the AG Grid ledger: which money
    (in / out), column filters and a sort. Claude only sees the column schema and the question,
    never the rows: the numbers stay in the browser, read through row-level security.
    ============================================================================ */

import { requireUser } from '../lib/auth.js'
import { callTool } from '../agent/claude.js'

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
}
