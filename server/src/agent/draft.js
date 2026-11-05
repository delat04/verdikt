/*  ============================================================================
    Drafting terms — turn a plain-language brief into acceptance criteria the
    verifier can actually test against a live URL and a public repository.
    ============================================================================ */

import { callTool } from './claude.js'

const SYSTEM = `You write acceptance criteria for freelance software contracts held in escrow.
An automated verifier will later judge each criterion using only: screenshots of the live URL at 1440px and 375px wide,
the page's visible text, HTTP status, console errors, failed network requests, a layout scan for elements wider than the
viewport, a scripted form submission when the page has one, and the public GitHub repository (file tree, README, manifest, key source files).

Write criteria that:
- are objective and checkable with that evidence — never taste ("looks modern", "feels premium");
- come straight from the brief and the milestone; don't invent scope the client didn't ask for;
- are each one sentence, specific, and phrased as a fact that is true when the work is done;
- cover what matters for that milestone: usually 4-6 criteria spanning functional, visual, content, performance and code.

For each criterion, also say how the verifier checks it, in one plain sentence a non-technical client understands.
Both parties will read and sign these before money is held, so prefer clarity over cleverness.`

const TOOL = {
  name: 'record_criteria',
  description: 'Record the acceptance criteria for every milestone of the contract.',
  input_schema: {
    type: 'object',
    properties: {
      milestones: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            position: { type: 'integer', description: 'The milestone position, starting at 1' },
            criteria: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  kind: { type: 'string', enum: ['visual', 'functional', 'code', 'performance', 'content'] },
                  statement: { type: 'string' },
                  method: { type: 'string' },
                },
                required: ['kind', 'statement', 'method'],
                additionalProperties: false,
              },
            },
          },
          required: ['position', 'criteria'],
          additionalProperties: false,
        },
      },
    },
    required: ['milestones'],
    additionalProperties: false,
  },
}

/** → Map(position → [{ kind, statement, method }]) */
export async function draftCriteria({ title, brief, milestones }) {
  const list = milestones
    .map((m) => `M${m.position}${m.position === milestones.length && milestones.length > 1 ? ' (final)' : ''}: ${m.title}${m.description ? ` — ${m.description}` : ''}`)
    .join('\n')

  const input = await callTool({
    system: SYSTEM,
    effort: 'high',
    tool: TOOL,
    content: [{
      type: 'text',
      text: `Contract: ${title}\n\nBrief from the parties:\n${brief}\n\nMilestones:\n${list}\n\nDraft the criteria for every milestone by calling record_criteria.`,
    }],
  })

  return new Map(input.milestones.map((m) => [m.position, m.criteria.slice(0, 8)]))
}

/** Used only if the model can't be reached: generic checks so the contract is never stuck. */
export function fallbackCriteria(milestone) {
  return [
    { kind: 'functional', statement: `The live URL for "${milestone.title}" loads without errors on desktop (1440px) and mobile (375px)`, method: 'The browser opens the URL at both sizes and fails on HTTP or console errors.' },
    { kind: 'visual', statement: 'No horizontal scrolling or overlapping elements at 375px wide', method: 'Mobile screenshot plus a scan for elements wider than the screen.' },
    { kind: 'content', statement: 'All copy described in the brief is present and there is no placeholder text', method: 'Page text is compared with the brief; placeholder text is flagged.' },
    { kind: 'code', statement: 'The repository is public, has a README and a working build script', method: 'The repository is read: README, manifest and build script.' },
  ]
}
