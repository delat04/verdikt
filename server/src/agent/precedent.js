/*  ============================================================================
    Precedent, as both sides read it. Before Claude judges a check the probes couldn't settle, Verdikt finds
    how the most similar checks on other contracts were decided (Elastic in live mode, a fixed sample in the
    demo). These are the rules that turn those cases into words: whether this outcome follows them, how each
    case was decided, and how close it is.
    Shared: server/src/agent/precedent.js and web/src/domain/precedent.js are byte-identical copies
    (parity.test.js), so the verifier, the report and the demo call the same stance by the same rule.
    No imports, no globals.
    ============================================================================ */

/**
 * How this check's outcome sits with its cases: follows (most agree), split (half), departs, or none.
 * @param {Array<{ met: boolean }>} items  the cases
 * @param {boolean} passed  this check's outcome
 * @returns {{ stance: 'follows'|'split'|'departs'|'none', same: number, n: number, met: number, notMet: number }}
 */
export function stanceOf(items = [], passed) {
  const n = items?.length || 0
  const met = (items || []).filter((i) => i.met).length
  const notMet = n - met
  const same = passed ? met : notMet
  const stance = n === 0 ? 'none' : same * 2 > n ? 'follows' : same * 2 === n ? 'split' : 'departs'
  return { stance, same, n, met, notMet }
}

// how a case was finally decided: a second review outranks the layer that first decided it
const LAYER = { probe: 'decided by a probe', ocr: 'read by OCR', model: 'judged by Claude', reused: 'unchanged since the last try' }
const APPEAL = { overturned: 'overturned on second review', upheld: 'held on second review' }

/**
 * How one case was decided, in a few words.
 * @param {{ layer?: string, appeal?: string|null }} item
 * @returns {string} e.g. 'decided by a probe', 'overturned on second review'; '' for an unknown layer
 */
export function decidedBy(item) {
  return APPEAL[item?.appeal] || LAYER[item?.layer] || (item?.layer === 'appeal' ? APPEAL.overturned : '')
}

const BAND = { close: 'close match', related: 'related' }

/**
 * How close a case is to this check, in words.
 * @param {'close'|'related'} band
 * @returns {string} 'close match' or 'related'
 */
export function bandLabel(band) {
  return BAND[band] || BAND.related
}

/**
 * The first sentence of a reason or an explanation. A period inside a number or a file name ("2.5 s",
 * ".env") is not an end: a sentence ends at . ! or ?, after any closing quote, before a space or the end.
 * @param {string} text
 * @returns {string}
 */
export function firstSentence(text) {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim()
  const m = /^.*?[.!?]["'”’)]*(?=\s|$)/.exec(s)
  return m ? m[0] : s
}
