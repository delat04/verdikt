/*  ============================================================================
    Compiling checks — once per contract, when the terms lock (or a check is edited), Claude turns each
    signed sentence into probes from the fixed catalogue in probes.js and says whether passing them proves
    the sentence. The result is stored on the check (criteria.check_spec), shown to both parties as
    "how it's checked", and run deterministically at every delivery and pre-check after that.
    If the model can't be reached, rules read the sentence instead (never sufficient on their own).
    ============================================================================ */

import { callTool } from './claude.js'
import { PROBE_TYPES, cleanSpec, rulesSpec } from './probes.js'
import { db, audit } from '../lib/supabase.js'

const SYSTEM = `You compile acceptance checks for an escrow verifier into deterministic probes.
A browser opens the delivered live URL at 1440px (desktop) and 375px (mobile) and GitHub serves the repository; each
probe is a fixed test over what they collect:

- loads(viewport) — HTTP 2xx and the page renders
- no_console_errors(viewport) — no JavaScript errors in the console
- no_failed_requests — no 4xx/5xx or failed requests to the site's own origin
- no_horizontal_scroll(viewport) — nothing wider than the screen (use mobile for "375px", "phone", "responsive")
- text_present(text[], viewport) — every string appears in the page text, or in the screenshot via OCR
- text_absent(text[]) — none of the strings appear (omit text for the standard placeholder list: lorem ipsum…)
- element(selector, min, viewport) — at least min visible elements match the CSS selector
- form_submits — the email form on the page submits and the site accepts it
- lcp_under(ms, viewport) — largest contentful paint below ms
- page_exists(path, text[]) — a same-site path such as /about loads (and shows the strings)
- meta(name: title | description | viewport | og_image | favicon | lang)
- images_have_alt — every <img> has an alt attribute
- links_work — every link to the site's own pages answers below 400
- accessibility(min) — axe-core finds no more than min serious/critical WCAG A/AA violations (min defaults to 0)
- repo_file(path glob, e.g. README*, LICENSE*, src/**/*.test.*) — a file exists in the repository
- repo_script(name) — package.json has that script, e.g. build, test
- repo_dependency(name) — package.json depends on it, e.g. vue, react, tailwindcss
- repo_contains(path glob, text[]) — that file mentions every string
- repo_no_secrets — no committed .env files and no live keys in the files read

Rules:
- Use only probes that directly test what the sentence says. Never add requirements the sentence doesn't state.
- text_present only for exact copy the sentence names (usually quoted). Don't invent wording.
- element selectors must be robust and generic (nav, header, footer, form, a[href^="mailto:"], [class*=pricing i]).
- sufficient = true only when passing every probe means the sentence is true with no judgment left
  ("No horizontal scrolling at 375px" → no_horizontal_scroll(mobile), sufficient). Anything about appearance,
  quality, clarity, tone, or content you can't list exactly → sufficient = false; the probes are then facts for the
  judging model, and a hard failure still fails the check.
- A check with nothing a probe can test gets an empty probes list (the model judges it).
- Give each probe only the arguments its signature lists above.
- 0 to 4 probes per check.`

const TOOL = {
  name: 'record_probes',
  description: 'Record the compiled probes for every check.',
  input_schema: {
    type: 'object',
    properties: {
      checks: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            criterion_id: { type: 'string' },
            probes: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  type: { type: 'string', enum: PROBE_TYPES },
                  viewport: { type: 'string', enum: ['desktop', 'mobile', 'both'] },
                  text: { type: 'array', items: { type: 'string' } },
                  selector: { type: 'string' },
                  min: { type: 'integer' },
                  ms: { type: 'integer' },
                  path: { type: 'string' },
                  name: { type: 'string' },
                },
                required: ['type'],
                additionalProperties: false,
              },
            },
            sufficient: { type: 'boolean' },
          },
          required: ['criterion_id', 'probes', 'sufficient'],
          additionalProperties: false,
        },
      },
    },
    required: ['checks'],
    additionalProperties: false,
  },
}

/** → Map(criterionId → spec). Throws if the model can't be reached. */
export async function compileChecks(contract, criteria) {
  const out = await callTool({
    system: SYSTEM,
    effort: 'medium',
    tool: TOOL,
    content: [{
      type: 'text',
      text: [
        `Contract: ${contract.title}`,
        contract.brief ? `Brief: ${contract.brief}` : '',
        '',
        'Checks to compile:',
        ...criteria.map((c) => `- id ${c.id} [${c.kind}] ${c.statement}`),
        '',
        'Call record_probes with one entry per id.',
      ].filter((l) => l !== '').join('\n'),
    }],
  })
  return new Map(out.checks.map((x) => [x.criterion_id, cleanSpec({ ...x, by: 'agent' })]))
}

/**
 * Every check of these milestones gets a spec; ones already compiled are left alone.
 * @returns {Promise<Map<string, object>>} criterionId → clean spec, for all the given criteria
 */
export async function ensureSpecs(contract, criteria) {
  const missing = criteria.filter((c) => !Array.isArray(c.check_spec?.probes))
  if (missing.length) {
    let compiled = null
    try {
      compiled = await compileChecks(contract, missing)
    } catch (e) {
      console.error('compiling checks failed', e.message)
      await audit({ contractId: contract.id, actor: 'agent', event: 'checks.compile_failed', payload: { message: e.message } })
    }
    for (const c of missing) {
      c.check_spec = { ...(compiled?.get(c.id) || rulesSpec(c)), compiledAt: new Date().toISOString() }
      await db().from('criteria').update({ check_spec: c.check_spec }).eq('id', c.id)
    }
    const probes = missing.reduce((s, c) => s + c.check_spec.probes.length, 0)
    await audit({ contractId: contract.id, actor: 'agent', event: 'checks.compiled', payload: { checks: missing.length, probes, by: compiled ? 'agent' : 'rules' } })
  }
  return new Map(criteria.map((c) => [c.id, cleanSpec(c.check_spec)]))
}

/** After terms lock or checks change: compile in the background so both parties see how each check runs. */
export function compileInBackground(contractId) {
  ;(async () => {
    const { data: c } = await db().from('contracts').select('id, title, brief, milestones(id, criteria(*))').eq('id', contractId).single()
    const criteria = (c?.milestones || []).flatMap((m) => m.criteria)
    if (criteria.length) await ensureSpecs(c, criteria)
  })().catch((e) => console.error('compile in background failed', e))
}
