/*  ============================================================================
    Demo only — precedent without Elastic. In live mode, before Claude judges a check the probes couldn't
    settle, Verdikt searches every check signed on other contracts for the most similar ones and shows how
    each was decided (server/src/lib/precedent.js). The demo has no index, so it keeps a fixed set of sample
    past checks and finds the similar ones by word overlap: plain, deterministic, and the same answer on every
    load. Everything it returns is marked sample, and the stance comes from the same rule the server uses
    (domain/precedent.js, a byte-identical copy of the server's).
    The cases sit on their own sample contracts ('sample-c1'…), not on the dashboard's sample history, whose
    generated outcomes could contradict them. Their reasons read as the live index stores them: redacted,
    with quotes as “…” and no names, links or amounts.
    ============================================================================ */

import { stanceOf } from '../domain/precedent.js'

const DAY = 864e5

/**
 * The sample past checks: { id, contract, kind, statement, met (final), metFirst (on the first try), layer,
 * appeal?, reason, daysAgo }. Each of the drafting templates in demo.js finds at least three; the three the demo
 * judges with Claude find four each: above the fold (3 of 4 met), the cart (3 of 4, one on appeal) and the copy
 * (2 of 4, a split). The Northbrew story's own Claude-judged checks find theirs too: the production domain
 * (2 of 3), the pages loading at both sizes (3 of 3) and the loyalty stamps (2 of 3).
 */
export const SAMPLE_CASES = [
  // above the fold
  { id: 'case-01', contract: 'sample-c1', kind: 'visual', statement: 'Above the fold shows the headline, call to action and logo', met: true, metFirst: true, layer: 'model', reason: 'The headline, the call to action and the logo were all in the desktop screenshot above the fold.', daysAgo: 214 },
  { id: 'case-02', contract: 'sample-c2', kind: 'visual', statement: 'The hero shows the headline and a call to action above the fold on desktop', met: true, metFirst: true, layer: 'model', reason: 'Both sat in the first screen at 1440px, the button directly under the headline.', daysAgo: 167 },
  { id: 'case-03', contract: 'sample-c3', kind: 'visual', statement: 'The brand mark and headline are visible above the fold', met: false, metFirst: false, layer: 'model', reason: 'The logo sat below the hero image, under the fold at 1440px.', daysAgo: 121 },
  { id: 'case-04', contract: 'sample-c4', kind: 'visual', statement: 'The primary call to action is visible without scrolling on desktop', met: true, metFirst: true, layer: 'ocr', reason: 'The button text “…” was read from the desktop screenshot, inside the first screen.', daysAgo: 58 },

  // the cart
  { id: 'case-05', contract: 'sample-c5', kind: 'functional', statement: 'A product can be added to the cart and the total updates', met: true, metFirst: true, layer: 'model', reason: 'Adding one product raised the cart total by exactly its listed price.', daysAgo: 233 },
  { id: 'case-06', contract: 'sample-c6', kind: 'functional', statement: 'Adding a product to the cart updates the cart total', met: true, metFirst: false, layer: 'appeal', appeal: 'overturned', reason: 'On second review the total matched once the selected size was counted; the first read compared it with the smaller size.', daysAgo: 142 },
  { id: 'case-07', contract: 'sample-c7', kind: 'functional', statement: 'The cart total matches the listed price after adding a product', met: false, metFirst: false, layer: 'model', reason: 'The total showed twice the listed price after a single add.', daysAgo: 96 },
  { id: 'case-08', contract: 'sample-c8', kind: 'functional', statement: 'Products can be added to the cart from the shop page', met: true, metFirst: true, layer: 'model', reason: 'Each product card had a working add button and the cart count went up by one.', daysAgo: 31 },

  // the copy
  { id: 'case-09', contract: 'sample-c9', kind: 'content', statement: 'The copy from the brief is on the page with no placeholder text', met: true, metFirst: true, layer: 'model', reason: 'Every section of the brief was on the page, word for word, with no stand-in text.', daysAgo: 188 },
  { id: 'case-10', contract: 'sample-c10', kind: 'content', statement: 'No lorem ipsum or placeholder text left on the page', met: false, metFirst: false, layer: 'probe', reason: 'Two product descriptions still read “…”.', daysAgo: 132 },
  { id: 'case-11', contract: 'sample-c11', kind: 'content', statement: 'All copy from the brief is present', met: false, metFirst: false, layer: 'model', reason: 'One section of the brief, the delivery terms, was left out of the page.', daysAgo: 77 },
  { id: 'case-12', contract: 'sample-c12', kind: 'content', statement: 'The about section uses the copy from the brief', met: true, metFirst: false, layer: 'model', reason: 'The about section matched the brief after the second delivery, one heading reworded.', daysAgo: 22 },

  // the live URL
  { id: 'case-13', contract: 'sample-c1', kind: 'functional', statement: 'The live URL loads with no errors on desktop and mobile', met: true, metFirst: true, layer: 'probe', reason: 'HTTP 200 at both sizes, with a clean console.', daysAgo: 214 },
  { id: 'case-14', contract: 'sample-c3', kind: 'functional', statement: 'The live site loads without console errors at 1440px and 375px', met: false, metFirst: false, layer: 'probe', reason: 'Two console errors at 375px from a script that answered 404.', daysAgo: 121 },

  // the form (one also asks for the live URL, one for sign-up)
  { id: 'case-15', contract: 'sample-c2', kind: 'functional', statement: 'The form accepts a valid email and shows a confirmation', met: true, metFirst: true, layer: 'probe', reason: 'The request answered 200 and the page showed “…”.', daysAgo: 167 },
  { id: 'case-16', contract: 'sample-c7', kind: 'functional', statement: 'The live URL loads with no errors and the signup form shows a confirmation', met: false, metFirst: false, layer: 'probe', reason: 'The page loaded, but the form posted to an endpoint that answered 404.', daysAgo: 96 },
  { id: 'case-17', contract: 'sample-c10', kind: 'functional', statement: 'A new user can sign up with a valid email and sees a confirmation', met: true, metFirst: false, layer: 'probe', reason: 'On the second delivery the sign-up answered 201 and showed “…”.', daysAgo: 132 },

  // sign-up and sign-in
  { id: 'case-18', contract: 'sample-c4', kind: 'functional', statement: 'A new account can sign in and reach the dashboard', met: true, metFirst: true, layer: 'probe', reason: 'A throwaway account signed in and landed on the dashboard.', daysAgo: 58 },
  { id: 'case-19', contract: 'sample-c11', kind: 'functional', statement: 'Sign up and sign in work with a fresh account', met: false, metFirst: false, layer: 'model', reason: 'After a valid sign-in the page went back to the login form.', daysAgo: 77 },

  // horizontal scrolling
  { id: 'case-20', contract: 'sample-c5', kind: 'visual', statement: 'No horizontal scrolling at 375px', met: true, metFirst: true, layer: 'probe', reason: 'At 375px the page was exactly 375px wide.', daysAgo: 233 },
  { id: 'case-21', contract: 'sample-c6', kind: 'visual', statement: 'Nothing wider than the screen at 375px, no horizontal scrolling', met: false, metFirst: false, layer: 'probe', reason: 'A pricing table ran past the right edge at 375px.', daysAgo: 142 },
  { id: 'case-22', contract: 'sample-c9', kind: 'visual', statement: 'The page has no horizontal scrolling on phones', met: true, metFirst: false, layer: 'probe', reason: 'The second delivery fit the screen at 375px.', daysAgo: 188 },

  // paint time
  { id: 'case-23', contract: 'sample-c8', kind: 'performance', statement: 'Largest Contentful Paint under 2.5 s on mobile', met: true, metFirst: true, layer: 'probe', reason: 'The main content painted in 1.9 s at 375px.', daysAgo: 31 },
  { id: 'case-24', contract: 'sample-c2', kind: 'performance', statement: 'Largest Contentful Paint under 2.5 s at 375px and 1440px', met: false, metFirst: false, layer: 'probe', reason: 'The hero image painted in 3.4 s at 375px.', daysAgo: 167 },
  { id: 'case-25', contract: 'sample-c12', kind: 'performance', statement: 'The main content paints under 2.5 s at 375px', met: true, metFirst: true, layer: 'probe', reason: 'Painted in 1.6 s at 375px, median of three loads.', daysAgo: 22 },

  // the repository
  { id: 'case-26', contract: 'sample-c6', kind: 'code', statement: 'Repository has a README with setup steps', met: true, metFirst: true, layer: 'model', reason: 'The README explains how to install, run and build.', daysAgo: 142 },
  { id: 'case-27', contract: 'sample-c9', kind: 'code', statement: 'No secrets or .env files committed', met: false, metFirst: false, layer: 'probe', reason: 'An env file with live keys was in the repository.', daysAgo: 188 },
  { id: 'case-28', contract: 'sample-c11', kind: 'code', statement: 'The repository has a build script and a README', met: true, metFirst: true, layer: 'probe', reason: 'Both were there, and the build ran clean.', daysAgo: 77 },

  // the production domain (one on sample-c3, so its console-error case isn't taken for this one)
  { id: 'case-29', contract: 'sample-c3', kind: 'functional', statement: 'The site is served over HTTPS on its production domain', met: true, metFirst: true, layer: 'probe', reason: 'The production domain answered over HTTPS with a valid certificate.', daysAgo: 121 },
  { id: 'case-30', contract: 'sample-c8', kind: 'functional', statement: 'The live site runs on the production domain with a valid HTTPS certificate', met: true, metFirst: true, layer: 'probe', reason: 'The certificate was valid, and the plain address redirected to HTTPS.', daysAgo: 31 },
  { id: 'case-31', contract: 'sample-c11', kind: 'functional', statement: 'The site is live on its own domain over HTTPS, not a preview address', met: false, metFirst: false, layer: 'model', reason: 'The delivery linked a preview address; the production domain still showed the old site.', daysAgo: 77 },

  // pages load at both sizes
  { id: 'case-32', contract: 'sample-c5', kind: 'visual', statement: 'The pages load with no console errors on desktop and mobile', met: true, metFirst: true, layer: 'probe', reason: 'Both sizes loaded with a clean console.', daysAgo: 233 },
  { id: 'case-33', contract: 'sample-c10', kind: 'visual', statement: 'Pages load at desktop and phone sizes with no console errors', met: true, metFirst: false, layer: 'probe', reason: 'The second delivery loaded clean at 1440px and 375px.', daysAgo: 132 },
  { id: 'case-34', contract: 'sample-c12', kind: 'visual', statement: 'Every page loads at 1440px and 375px with a clean console', met: true, metFirst: true, layer: 'probe', reason: 'Each page answered 200 at both sizes, with nothing in the console.', daysAgo: 22 },

  // loyalty stamps
  { id: 'case-35', contract: 'sample-c2', kind: 'functional', statement: 'Scanning the customer QR adds a stamp; the tenth stamp unlocks the reward', met: true, metFirst: true, layer: 'model', reason: 'A test scan added one stamp, and the tenth showed the reward screen.', daysAgo: 167 },
  { id: 'case-36', contract: 'sample-c6', kind: 'functional', statement: 'Staff scanning a loyalty QR code adds one stamp to the card', met: true, metFirst: true, layer: 'model', reason: 'Each scan on the staff screen added exactly one stamp.', daysAgo: 142 },
  { id: 'case-37', contract: 'sample-c9', kind: 'functional', statement: 'The reward shows after the tenth stamp on the loyalty card', met: false, metFirst: false, layer: 'model', reason: 'The tenth stamp was counted, but the reward screen only appeared after a reload.', daysAgo: 188 },
]

// ---- similarity: word overlap, plain enough to read off the statements ---------------------------------
const STOP = new Set(['a', 'an', 'and', 'any', 'are', 'as', 'at', 'be', 'by', 'can', 'each', 'for', 'from', 'has', 'have', 'in', 'into', 'is', 'it', 'its', 'no', 'of', 'on', 'or', 'than', 'that', 'the', 'there', 'this', 'to', 'with', 'all', 'after', 'every'])
export const FLOOR = 0.25   // below it a case isn't shown
export const CLOSE = 0.5    // at or above: a close match
const CAP = 4

/** A statement's words: lowercase, punctuation stripped, stopwords and single characters dropped. */
function words(text) {
  return new Set(String(text || '').toLowerCase().replace(/[^\p{L}\p{N}\s]+/gu, ' ').split(/\s+/).filter((w) => w.length > 1 && !STOP.has(w)))
}
/** Jaccard over the two word sets, plus 0.1 for a check of the same kind. */
function similarity(a, b, sameKind) {
  let shared = 0
  for (const w of a) if (b.has(w)) shared += 1
  const union = a.size + b.size - shared
  return (union ? shared / union : 0) + (sameKind ? 0.1 : 0)
}
const CASE_WORDS = new Map(SAMPLE_CASES.map((c) => [c.id, words(c.statement)]))

/** Every case above the floor, best first (score desc, then id); one per contract, never the caller's; a
 *  related case of another kind is left out, as the live search does. */
function ranked(statement, kind, contractId = null) {
  const q = words(statement)
  const best = new Map()
  for (const c of SAMPLE_CASES) {
    if (c.contract === contractId) continue
    const score = Math.round(similarity(q, CASE_WORDS.get(c.id), c.kind === kind) * 1000) / 1000
    if (score < FLOOR || (score < CLOSE && c.kind !== kind)) continue   // as live: only a close match crosses kinds
    const held = best.get(c.contract)
    if (!held || score > held.score || (score === held.score && c.id < held.case.id)) best.set(c.contract, { case: c, score })
  }
  return [...best.values()].sort((x, y) => y.score - x.score || (x.case.id < y.case.id ? -1 : 1))
}

const item = ({ case: c, score }, now) => ({
  id: c.id, contract: c.contract, statement: c.statement, kind: c.kind, met: c.met, metFirst: c.metFirst, layer: c.layer,
  appeal: c.appeal ?? null, reason: c.reason, at: new Date(now - c.daysAgo * DAY).toISOString(), score, band: score >= CLOSE ? 'close' : 'related',
})

/**
 * The precedent for one check the demo's Claude judged, as the server stores it on a result (v2 evidence),
 * marked sample. null when no case clears the floor.
 * @param {string} statement
 * @param {string} kind
 * @param {{ contractId?: string, passed: boolean, departsBecause?: string }} opts
 */
export function samplePrecedent(statement, kind, { contractId = null, passed, departsBecause = '' } = {}) {
  const top = ranked(statement, kind, contractId).slice(0, CAP)
  if (!top.length) return null
  const now = Date.now()
  const items = top.map((x) => item(x, now))
  return {
    type: 'precedent',
    v: 2,
    sample: true,
    label: `Similar checks · ${items.length} · sample history`,
    ...stanceOf(items, passed),
    departsBecause: String(departsBecause || '').trim(),
    items,
  }
}

/**
 * How checks like this one have gone across the sample cases, for a check that isn't judged yet (the sign
 * sheet): every case above the floor, one per contract, counted; and the closest three.
 * → { n, met, notMet, top: [items] }
 */
export function sampleTrackRecord(statement, kind) {
  const all = ranked(statement, kind)
  const now = Date.now()
  const met = all.filter((x) => x.case.met).length
  return { sample: true, n: all.length, met, notMet: all.length - met, top: all.slice(0, 3).map((x) => item(x, now)) }
}
