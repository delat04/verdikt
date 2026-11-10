/*  ============================================================================
    Expense rules, as both sides read them. What a budget's lines cover (the words a receipt shows for a
    domain, hosting, fonts…), and the shopping list: items pinned from real Channel3 listings that both sides
    agreed to. A receipt from a store on the list, on a line that names an agreed item at about its price, is
    reimbursed by these rules alone, with no model. A store on the list with no agreed item named goes to
    the client. Every rule reads the receipt only: what the claimant typed (the merchant field) is never an
    input, so a claim can't talk itself onto the list.
    Shared: server/src/agent/expenseRules.js and web/src/domain/expenseRules.js are byte-identical copies
    (parity.test.js), so the live checker and the demo decide a receipt by the same rule. No imports, no globals.
    Edit the server copy, then copy it to web/src/domain. npm test fails if they differ.
    ============================================================================ */

// ---------------------------------------------------------------- what a budget covers
// words that show up on receipts for each kind of project expense (matched on the receipt only, never on
// what the claimant typed: a claim can't talk itself into coverage)
const KINDS = [
  { label: 'Domain', match: /\b(domain|registrar|dns)\b/, words: ['domain', 'registrar', 'dns', 'namecheap', 'godaddy', 'porkbun', 'gandi', 'dynadot', 'name.com', 'hover', 'google domains', 'squarespace domains', 'cloudflare registrar'] },
  { label: 'Hosting', match: /\b(host|hosting|server|cloud|deploy)/, words: ['hosting', 'vercel', 'netlify', 'render', 'heroku', 'fly.io', 'railway', 'digitalocean', 'linode', 'hetzner', 'amazon web services', 'aws', 'google cloud', 'azure', 'cloudflare', 'supabase', 'firebase', 'hostinger', 'bluehost', 'siteground', 'wp engine', 'vps', 'cdn'] },
  { label: 'Stock photos', match: /\b(stock|photo|image|picture)/, words: ['shutterstock', 'getty images', 'istock', 'adobe stock', 'depositphotos', 'envato', 'stock photo', 'image license', 'unsplash'] },
  { label: 'Fonts', match: /\b(font|type)/, words: ['font', 'fonts', 'typeface', 'myfonts', 'fontspring', 'adobe fonts', 'typekit', 'webfont', 'foundry'] },
  { label: 'Icons & illustrations', match: /\b(icon|illustration|graphic)/, words: ['icons8', 'noun project', 'flaticon', 'streamline', 'iconscout', 'illustration', 'icon pack'] },
  { label: 'API credits', match: /\b(api|credit|usage|token)/, words: ['api', 'credits', 'openai', 'anthropic', 'twilio', 'sendgrid', 'mapbox', 'google maps platform', 'algolia', 'postmark', 'resend', 'mailgun'] },
  { label: 'Software licenses', match: /\b(software|licen[cs]e|plugin|tool|app)/, words: ['license', 'licence', 'plugin', 'figma', 'jetbrains', 'github', 'adobe', 'framer', 'webflow', 'shopify'] },
  { label: 'Email', match: /\b(e-?mail|mailbox|workspace)/, words: ['google workspace', 'zoho mail', 'fastmail', 'microsoft 365', 'mailbox'] },
]
export const COVER_SUGGESTIONS = KINDS.map((k) => k.label)

/** A word or phrase on its own: not inside a longer word or number ("dns" doesn't match "dnssec"). */
export const wordRe = (w) => new RegExp(`(^|[^a-z0-9])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z0-9])`, 'i')

/** Does the receipt name something one of the budget's lines covers? → { cover, word } or null */
export function coveredByRules(covers, text) {
  const t = String(text || '').toLowerCase()
  for (const cover of covers) {
    const c = cover.toLowerCase()
    const kind = KINDS.find((k) => k.label.toLowerCase() === c || k.match.test(c))
    const own = c.split(/[^a-z0-9.]+/).filter((w) => w.length >= 4)
    for (const w of [...(kind?.words || []), ...own]) if (wordRe(w).test(t)) return { cover, word: w }
  }
  return null
}

// ---------------------------------------------------------------- the shopping list
export const LIST_MAX = 6        // items per milestone
export const LINE_ROOM = 1.15    // a receipt line may be up to 15% over the listed price (the price moved)
export const TAX_ROOM = 1.2      // the claim may be up to 20% over the items' lines (tax and shipping)

/**
 * Where an item stands. Before both signatures the list is part of the terms; signing agrees to it. After
 * signing, what the client adds is agreed and what the freelancer adds is proposed until the client agrees.
 * @param {object} item     { status?: 'terms' | 'proposed' | 'agreed', plannedBy?: 'client' | 'freelancer' }
 * @param {object} [o]
 * @param {boolean} [o.signed]  both parties signed the contract
 * @returns {'terms' | 'proposed' | 'agreed'}
 */
export function itemState(item, { signed = false } = {}) {
  const s = item?.status
  if (s === 'agreed' || s === 'proposed') return s
  if (s === 'terms') return signed ? 'agreed' : 'terms'
  return item?.plannedBy === 'client' ? 'agreed' : 'proposed'   // planned before statuses existed (0013)
}

/** How an item reads to people: the brand first, unless the title already starts with it. */
export function itemName(item) {
  const title = String(item?.title || '').trim()
  const brand = String(item?.brand || '').trim()
  if (!brand || norm(title).startsWith(norm(brand))) return title || brand
  return `${brand} ${title}`.trim()
}

// receipt text as the rules compare it: lowercase, accents gone, '&' kept (B&H), runs of space as one
const norm = (s) => String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()

// first labels too generic to stand for a store on their own; and the names stores print instead of their domain
const DENY = ['amazon', 'target', 'store', 'shop', 'online', 'buy', 'www', 'app', 'get', 'official', 'the', 'my', 'go', 'us', 'hp']
const STORE_ALIASES = {
  walmart: ['wal-mart'], bestbuy: ['best buy'], bhphotovideo: ['b&h photo', 'b & h photo', 'bh photo'], homedepot: ['home depot'],
  officedepot: ['office depot'], focuscamera: ['focus camera'], microcenter: ['micro center'], cdw: ['cdw'],
  amazon: ['amazon.com'], target: ['target.com'], hp: ['hp.com', 'hp store'],
}
const SECOND_LEVEL = ['co', 'com', 'org', 'net', 'ac']   // amazon.co.uk, not co.uk

/**
 * The names a store goes by on a receipt: its registrable domain (store.google.com → google.com), the name
 * in it when that is specific enough (walmart, mount-it, "mount it"), and what stores print instead
 * ("Best Buy", "Wal-Mart", "B&H Photo"). Matched with wordRe on receipt lines.
 * @param {string} domain  an offer's domain, e.g. 'walmart.com'
 * @returns {string[]}
 */
export function storeAliases(domain) {
  const labels = norm(domain).replace(/^www\./, '').split('.').filter(Boolean)
  if (!labels.length) return []
  const n = labels.length >= 3 && SECOND_LEVEL.includes(labels.at(-2)) && /^[a-z]{2}$/.test(labels.at(-1)) ? 3 : 2
  const reg = labels.slice(-n)
  const out = [reg.join('.')]
  const name = reg[0]
  if (reg.length > 1 && name.length >= 4 && !DENY.includes(name)) out.push(name, name.replace(/-/g, ' '))
  out.push(...(STORE_ALIASES[name] || []))
  return [...new Set(out)]
}

// sizes, ports and versions: they name no product ("2D", "64GB", "USB2", "1920x1080")
const GENERIC = /^(\d+(d|mm|cm|in|ft|gb|tb|w|v|mah|hz|ghz|mhz|wh|oz|lbs?|kg|ml|pcs?|pk|p|k)|\d+x\d+|usb\d*|wifi\d*|2\.0)$/
const STOP = ['with', 'for', 'and', 'the', 'from', 'your', 'this', 'that', 'black', 'white', 'gray', 'grey', 'silver', 'pack', 'new',
  'universal', 'portable', 'mini', 'small', 'business', 'size', 'inch', 'edition', 'model', 'series', 'version', 'compatible']
// brands that are no brand (compared letters only: 'N/A' is 'na')
const NO_BRAND = ['generic', 'unbranded', 'nobrand', 'brandless', 'other', 'na', 'none', 'unknown', 'oem', 'various', 'assorted']
const letters = (s) => norm(s).replace(/[^a-z]/g, '')
const compact = (s) => s.replace(/[-.]/g, '')
// the tokens of a line for model numbers: '-' and '.' stay inside a token (DS9308-SR, 2.0), not at its ends
const tokensOf = (s) => norm(s).split(/[^a-z0-9.-]+/).map((t) => t.replace(/^[.-]+|[.-]+$/g, '')).filter(Boolean)

/** The stores an item can be bought at: its offers' domains (up to 4), else its own domain. */
const storesOf = (item) => {
  const offers = (Array.isArray(item?.offers) ? item.offers : []).map((o) => norm(o?.domain).replace(/^www\./, '')).filter(Boolean)
  const list = [...new Set(offers)].slice(0, 4)
  return list.length ? list : [norm(item?.domain).replace(/^www\./, '')].filter(Boolean)
}

/**
 * What on a receipt line names this item: its brand, a model number, or most of its title's words.
 * @param {object} item  a list item: { title, storeTitle, brand, domain, offers, history? }
 * @returns {{ brand: string, models: Array<{ token: string, key: string }>, words: string[], need: number }}
 */
export function productSignals(item) {
  // the brand, unless it is the store's own name (Mount-It at mount-it.com names the store, not the item)
  // and never a placeholder ('Generic', 'Unbranded'), which names nothing
  const storeLabels = storesOf(item).flatMap((d) => d.split('.')).map(letters).filter(Boolean)
  let brand = norm(item?.brand)
  if (brand.length < 3 || storeLabels.includes(letters(brand)) || NO_BRAND.includes(letters(brand))) brand = ''

  // model numbers: a letter and a digit, 3–20 characters once '-' and '.' are dropped
  const models = []
  for (const t of tokensOf(`${item?.title || ''} ${item?.storeTitle || ''} ${item?.history?.storeTitle || ''}`)) {
    const key = compact(t)
    if (key.length < 3 || key.length > 20 || !/[a-z]/.test(key) || !/\d/.test(key)) continue
    if (GENERIC.test(t) || GENERIC.test(key) || models.some((m) => m.key === key)) continue
    models.push({ token: t.toUpperCase(), key })
  }

  // the title's own words, without colours, sizes and filler
  const words = [...new Set(norm(item?.title).split(/[^a-z0-9]+/).filter((w) => /^[a-z]{4,}$/.test(w) && !STOP.includes(w)))].slice(0, 8)
  const need = words.length >= 2 ? Math.max(2, Math.ceil((2 / 3) * words.length)) : Infinity
  // with the brand on the line, half as many title words do (at least one): "Netum barcode reader"
  const brandNeed = words.length ? Math.max(1, Math.ceil(Math.min(need, words.length) / 2)) : Infinity
  return { brand, models, words, need, brandNeed }
}

/** Does this (normalized) receipt line name the item? A model number, most of the title's words, or the
 *  brand with some of them; the brand alone never does (a Netum cable is not the Netum scanner).
 *  → { how, model, hit, of } or null */
function names(sig, line) {
  const how = []
  // token by token, and two neighbours joined ("DS9308 SR" is DS9308-SR)
  const toks = tokensOf(line).map(compact).filter(Boolean)
  const seen = new Set([...toks, ...toks.slice(1).map((t, i) => toks[i] + t)])
  const model = sig.models.find((m) => seen.has(m.key))
  const hit = sig.words.filter((w) => wordRe(w).test(line)).length
  const brand = !!sig.brand && wordRe(sig.brand).test(line)
  if (!model && hit < sig.need && !(brand && hit >= (sig.brandNeed ?? Infinity))) return null
  if (brand) how.push('brand')
  if (model) how.push('model')
  if (hit >= sig.need) how.push('words')
  return { how, model: model?.token || null, hit, of: sig.words.length }
}

/** The most a receipt line may show for the item: 15% over the listed price, or the 30-day high plus 2%. */
export function lineMax(item) {
  const price = Number(item?.priceCents) || 0
  const high = Number(item?.history?.stats?.maxCents) || 0
  return Math.max(Math.round(price * LINE_ROOM), high ? Math.round(high * 1.02) : 0)
}

/** What a receipt for this item may look like: where from, the most per line, the most for the claim. */
export function receiptBand(item) {
  return { stores: storesOf(item), lineMaxCents: lineMax(item), claimMaxCents: Math.round((Number(item?.priceCents) || 0) * TAX_ROOM) }
}

// an amount with cents in dollars: "$34.20", "34.20", "1,234.56"; not part of a date or a version, not € or £
const AMOUNT = /(?<![\d.,])\$?\s?(\d{1,3}(?:,\d{3})*\.\d{2}|\d+\.\d{2})(?!\d|\.\d)/g
function amountsOf(line) {
  const out = []
  for (const m of line.matchAll(AMOUNT)) {
    if (/[€£]\s?$/.test(line.slice(0, m.index))) continue
    out.push(Math.round(Number(m[1].replace(/,/g, '')) * 100))
  }
  return out
}

/**
 * Match a receipt against the shopping list. Only the receipt's text is read: the store must be printed on
 * it, and a line must name an agreed item that no other claim bought.
 * @param {object} p
 * @param {Array}  p.items         the milestone's list (expense_products)
 * @param {string} p.text          the receipt's text
 * @param {number} p.claimedCents  what the claim asks for
 * @param {boolean} p.signed       both parties signed (claims exist only on funded, so signed, milestones)
 * @param {string[]} [p.usedIds]   items another live claim already bought
 * @returns {{ kind: 'match' | 'store_only' | 'none', matches: Array, storeHits: Array, listedCents: number,
 *   claimedCents: number, claimMaxCents: number, claimOk: boolean, priceOk: boolean }}
 *   matches: { id, title, brand, domain, image, alias, storeLine (1-based), lineIndex (0-based), line,
 *   how: ('brand' | 'model' | 'words')[], model, words: { hit, of }, lineCents | null, listedCents, listedAt,
 *   range: { minCents, maxCents } | null, lineMaxCents, lineOk }
 *   storeHits: { id, title, domain, alias, line (1-based), state, used }
 */
export function matchList({ items, text, claimedCents, signed, usedIds = [] }) {
  const list = Array.isArray(items) ? items.filter((x) => x && x.id) : []
  const rows = String(text ?? '').split(/\r?\n/).map((raw) => ({ raw: raw.trim(), n: norm(raw) })).filter((r) => r.n)
  const used = new Set((usedIds || []).map(String))

  // the first line printing one of the item's stores
  const storeHits = []
  const hitOf = new Map()
  for (const item of list) {
    const aliases = storesOf(item).flatMap((domain) => storeAliases(domain).map((alias) => ({ domain, alias, re: wordRe(alias) })))
    let hit = null
    for (let i = 0; i < rows.length && !hit; i++) {
      const a = aliases.find((x) => x.re.test(rows[i].n))
      if (a) hit = { domain: a.domain, alias: a.alias, line: i + 1 }
    }
    if (!hit) continue
    hitOf.set(item.id, hit)
    storeHits.push({ id: item.id, title: itemName(item), ...hit, state: itemState(item, { signed }), used: used.has(String(item.id)) })
  }

  // each agreed, unbought USD item at a store on the receipt: the first line not yet taken that names it
  const taken = new Set()
  const matches = []
  for (const item of list) {
    const store = hitOf.get(item.id)
    if (!store || itemState(item, { signed }) !== 'agreed' || used.has(String(item.id)) || (item.currency || 'USD') !== 'USD') continue
    const sig = productSignals(item)
    let found = null
    for (let i = 0; i < rows.length && !found; i++) {
      if (taken.has(i)) continue
      const named = names(sig, rows[i].n)
      if (named) found = { i, named }
    }
    if (!found) continue
    taken.add(found.i)
    // the line's price: its last amount, else the first on the next line when that holds no words (OCR splits columns)
    const own = amountsOf(rows[found.i].n)
    const next = rows[found.i + 1]
    const lineCents = own.length ? own.at(-1) : next && !/[a-z]{3,}/.test(next.n) ? (amountsOf(next.n)[0] ?? null) : null
    const listed = Math.round(Number(item.priceCents) || 0)
    const max = lineMax(item)
    const stats = item.history?.stats
    matches.push({
      id: item.id, title: itemName(item), brand: String(item.brand || ''), domain: store.domain, image: item.image || '',
      alias: store.alias, storeLine: store.line, lineIndex: found.i, line: rows[found.i].raw.slice(0, 160),
      how: found.named.how, model: found.named.model, words: { hit: found.named.hit, of: found.named.of },
      lineCents, listedCents: listed, listedAt: item.asOf || item.at || null,
      range: stats?.minCents && stats?.maxCents ? { minCents: stats.minCents, maxCents: stats.maxCents } : null,
      lineMaxCents: max, lineOk: lineCents != null && lineCents <= max,   // no price on the line: the client decides
    })
  }

  const listedCents = matches.reduce((s, m) => s + (m.lineCents ?? m.listedCents), 0)
  const claimMaxCents = Math.round(listedCents * TAX_ROOM)
  const claimed = Math.round(Number(claimedCents) || 0)
  const claimOk = matches.length > 0 && claimed <= claimMaxCents
  return {
    kind: matches.length ? 'match' : storeHits.length ? 'store_only' : 'none',
    matches, storeHits, listedCents, claimedCents: claimed, claimMaxCents, claimOk,
    priceOk: claimOk && matches.every((m) => m.lineOk),
  }
}

// 'A', 'A and B', 'A, B and C'
const and = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`)

/**
 * The check rows a list match adds to a claim (by: 'rules'). 'info' rows explain and never decide.
 * @param {object} r            matchList's result
 * @param {object} o
 * @param {(cents: number) => string} o.$       money, e.g. 3420 → '$34.20'
 * @param {(iso: string) => string} [o.dateOf]  a listing date as people read it, e.g. 'Nov 9'
 * @param {string} [o.clientName]               who decides what the rules can't, e.g. 'Maya'
 * @returns {Array<{ key, label, status, observed, fix, by }>}
 */
export function listChecks(r, { $, dateOf = (iso) => String(iso || '').slice(0, 10), clientName = 'The client' } = {}) {
  const row = (key, label, status, observed, fix = '') => ({ key, label, status, observed, fix, by: 'rules' })
  if (r?.kind === 'store_only') {
    const domains = [...new Set(r.storeHits.map((h) => h.domain))]
    const open = r.storeHits.filter((h) => h.state === 'agreed' && !h.used).map((h) => h.title)
    const parts = [`${and(domains)} ${domains.length > 1 ? 'sell' : 'sells'} items on the list${open.length ? `, but no line names ${and(open)}` : ''}.`]
    for (const h of r.storeHits) {
      if (h.used) parts.push(`${h.title} was already bought on another claim.`)
      else if (h.state === 'proposed') parts.push(`${h.title} is proposed and not agreed yet.`)
      else if (h.state === 'terms') parts.push(`${h.title} is on terms not signed yet.`)
    }
    return [row('list', 'On the shopping list', 'info', parts.join(' '))]
  }
  if (r?.kind !== 'match') return []

  const many = r.matches.length > 1
  const lineWord = (m) => (many ? `Line ${m.lineIndex + 1} price` : 'Line price')
  const stores = [...new Map(r.matches.map((m) => [`${m.domain}|${m.storeLine}`, `${m.domain} is on line ${m.storeLine} of the receipt.`])).values()]
  const named = r.matches.map((m) => {
    const how = [
      m.how.includes('brand') && 'brand',
      m.how.includes('model') && `model ${m.model}`,
      m.words.hit > 0 && `${m.words.hit} of ${m.words.of} title words`,
    ].filter(Boolean)
    return `Line ${m.lineIndex + 1} names ${m.title} (${how.join(', ')}).`
  })

  let price
  if (r.priceOk) {
    const each = r.matches.map((m) => {
      const when = m.listedAt ? dateOf(m.listedAt) : ''
      const range = m.range ? ` (30-day range ${$(m.range.minCents)} to ${$(m.range.maxCents)}, Channel3)` : ''
      return `${lineWord(m)} ${$(m.lineCents)}; listed at ${$(m.listedCents)}${when ? ` on ${when}` : ''}${range}.`
    })
    price = row('list_price', 'At the agreed price', 'pass',
      `${each.join(' ')} You claimed ${$(r.claimedCents)}, within ${$(r.claimMaxCents)} with tax and shipping.`)
  } else {
    const over = r.matches.filter((m) => !m.lineOk)
      .map((m) => (m.lineCents == null
        ? `No price on ${many ? `line ${m.lineIndex + 1}` : 'its line'}, so the agreed ${$(m.listedCents)} wasn't checked.`
        : `${lineWord(m)} ${$(m.lineCents)} is above the agreed ${$(m.listedCents)} (up to ${$(m.lineMaxCents)}).`))
    if (!r.claimOk) over.push(`You claimed ${$(r.claimedCents)}; the agreed items come to ${$(r.listedCents)}, up to ${$(r.claimMaxCents)} with tax and shipping.`)
    price = row('list_price', 'At the agreed price', 'unknown', over.join(' '), `${clientName} decides.`)
  }
  return [
    row('list_store', 'Bought at a store on the list', 'pass', stores.join(' ')),
    row('list_item', 'The item on the list', 'pass', named.join(' ')),
    price,
  ]
}

// a claim whose capture failed ('error') still holds its items: the client can approve it later
const LIFECYCLE = { checking: 'checking', needs_client: 'needs_client', error: 'needs_client', approved: 'reimbursed' }
/** Claim statuses that hold the list items their receipt matched: none of them is bought twice. */
export const HOLDING = Object.keys(LIFECYCLE)

/**
 * Has a claim bought this item? The latest live claim (checking, waiting for the client, a failed capture
 * the client can still approve, or reimbursed) whose receipt matched it decides; declined, rejected and
 * closed claims give the item back.
 * @param {object} item
 * @param {Array} expenses  claims: { status, extracted: { planned: [{ id }] }, created_at | createdAt }
 * @returns {{ state: 'open' | 'checking' | 'needs_client' | 'reimbursed', expense: object | null }}
 */
export function itemLifecycle(item, expenses) {
  let latest = null
  let latestAt = -Infinity
  for (const e of Array.isArray(expenses) ? expenses : []) {
    if (!LIFECYCLE[e?.status]) continue
    const planned = Array.isArray(e.extracted?.planned) ? e.extracted.planned : []
    if (!planned.some((p) => String(p?.id) === String(item?.id))) continue
    const t = Date.parse(e.created_at || e.createdAt || e.at || '')
    const at = Number.isNaN(t) ? latestAt : t   // undated: the list's order decides
    if (at >= latestAt) { latest = e; latestAt = at }
  }
  return latest ? { state: LIFECYCLE[latest.status], expense: latest } : { state: 'open', expense: null }
}

/** What the list still holds for: the listed price of every item no live claim has bought. */
export function outstandingCents(items, expenses) {
  return (Array.isArray(items) ? items : [])
    .filter((x) => itemLifecycle(x, expenses).state === 'open')
    .reduce((s, x) => s + (Math.round(Number(x.priceCents)) || 0), 0)
}

// ---------------------------------------------------------------- who may change the list
// Before both signatures the list is part of the terms: either side edits it, and every edit resets the
// signatures. After signing, the client's additions are agreed at once and the freelancer's wait for the
// client. A signed item stays unless the freelancer drops it (that only narrows their own automatic
// reimbursement); an item a live claim bought stays for everyone. Each rule answers { ok } or { ok: false, code }.

const YES = { ok: true }
const no = (code) => ({ ok: false, code })
const lifeOf = (lifecycle) => (typeof lifecycle === 'string' ? lifecycle : lifecycle?.state) || 'open'

/**
 * The status an item starts in when it's added.
 * @param {object} o
 * @param {boolean} o.signedBoth  both parties signed the contract
 * @param {'client' | 'freelancer'} o.role  who adds it
 * @returns {'terms' | 'agreed' | 'proposed'}
 */
export function statusFor({ signedBoth = false, role } = {}) {
  if (!signedBoth) return 'terms'
  return role === 'client' ? 'agreed' : 'proposed'
}

/**
 * May this party take the item off the list?
 * @param {object} item
 * @param {object} o
 * @param {'client' | 'freelancer'} o.role
 * @param {boolean} o.signedBoth
 * @param {string | { state: string }} [o.lifecycle]  itemLifecycle's answer (or its state): 'open' unless a claim bought it
 * @returns {{ ok: true } | { ok: false, code: 'bought' | 'signed' }}
 */
export function canRemove(item, { role, signedBoth = false, lifecycle = 'open' } = {}) {
  if (lifeOf(lifecycle) !== 'open') return no('bought')
  if (!signedBoth || role === 'freelancer') return YES
  return itemState(item, { signed: true }) === 'proposed' ? YES : no('signed')
}

/**
 * May this party agree to the item? Only the client, after signing, to an item the freelancer proposed.
 * @returns {{ ok: true } | { ok: false, code: 'client_only' | 'not_signed' | 'not_proposed' | 'bought' }}
 */
export function canAgree(item, { role, signedBoth = false, lifecycle = 'open' } = {}) {
  if (role !== 'client') return no('client_only')
  if (!signedBoth) return no('not_signed')
  if (lifeOf(lifecycle) !== 'open') return no('bought')
  return itemState(item, { signed: true }) === 'proposed' ? YES : no('not_proposed')
}

/**
 * May this party decline the item? Only the client, and only an item still proposed.
 * @returns {{ ok: true } | { ok: false, code: 'client_only' | 'not_proposed' | 'bought' }}
 */
export function canDecline(item, { role, signedBoth = false, lifecycle = 'open' } = {}) {
  if (role !== 'client') return no('client_only')
  if (lifeOf(lifecycle) !== 'open') return no('bought')
  return itemState(item, { signed: !!signedBoth }) === 'proposed' ? YES : no('not_proposed')
}

// ---------------------------------------------------------------- what a refusal says
// The live routes and the demo answer a refused list action with the same { http, code, error }, so the
// two read the same. Listings are always US dollars, so money here is USD.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const usd = (cents) => `$${(Math.round(Number(cents) || 0) / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`
// '2026-12-01' → 'Dec 1'
const dayOf = (iso) => {
  const m = /^\d{4}-(\d{2})-(\d{2})/.exec(String(iso || ''))
  return m && MONTHS[Number(m[1]) - 1] ? `${MONTHS[Number(m[1]) - 1]} ${Number(m[2])}` : 'next month'
}

const LIST_ERRORS = {
  no_budget: [409, () => 'Add an expense budget first.'],
  settled: [409, () => 'This milestone is settled, so its list is closed.'],
  currency: [409, (o) => `Store listings are in US dollars and this contract pays in ${o.currency || 'another currency'}, so the shopping list isn’t available here.`],
  query: [400, () => 'Say what to look for in 3 to 120 characters, e.g. “2D barcode scanner”.'],
  search_limit: [429, (o) => `That’s ${o.limit || 30} ${o.what || 'store searches'} ${o.scope === 'user' ? 'from you' : 'on this milestone'} this hour. Try again ${o.after || 'later'}.`],
  no_room: [409, () => 'The list already uses what’s left of the budget.'],
  not_on_list: [404, () => 'That item isn’t on the list.'],
  no_product: [400, () => 'Pick a listing from the store search.'],
  list_full: [409, () => `A list holds up to ${LIST_MAX} items.`],
  gone: [409, () => 'That listing is gone from the store. Search again.'],
  stale: [409, () => 'That listing is from an earlier search. Search again, then add it.'],
  out_of_stock: [409, (o) => `Out of stock at ${o.domain || 'the store'} now. Pick another listing.`],
  over_budget: [409, (o) => `That adds ${o.$(o.priceCents)} to a list with ${o.$(Math.max(0, o.roomCents || 0))} of room. Remove something first.`],
  signed: [403, (o) => `Signed items stay on the list. ${o.freelancerName || 'The freelancer'} can take it off.`],
  bought: [409, () => 'This item is on a claim already, so it stays on the list.'],
  client_only: [403, () => 'Only the client agrees to or declines a proposed item.'],
  not_signed: [409, () => 'Before signing, the list is part of the terms: signing agrees to it.'],
  not_proposed: [409, () => 'Only a proposed item waits for the client.'],
  below_list: [400, (o) => `The shopping list comes to ${o.$(o.listCents)}. Set at least that, or remove items first.`],
  invalid: [400, () => 'Store search couldn’t read that. Try other words.'],
  quota: [503, (o) => `Store search is paused until ${dayOf(o.resetsOn)}. Your list and claims still work.`],
  rate_limited: [429, (o) => `Store search is busy. Try again in ${o.retryAfterSec > 5 ? `${o.retryAfterSec} seconds` : 'a few seconds'}.`],
  unavailable: [503, () => 'Store search isn’t answering. Try again in a minute.'],
}

/**
 * The answer to a refused list action.
 * @param {string} code  one of the keys above (an unknown code reads as 'unavailable')
 * @param {object} [o]   what the sentence names: currency, limit, scope ('milestone' | 'user'), what, after
 *   ('in 12 minutes'), domain, priceCents, roomCents, freelancerName, listCents, resetsOn, retryAfterSec,
 *   retryAt, and $ (cents → '$34.20', USD by default)
 * @returns {{ http: number, code: string, error: string, retryAfterSec?: number, retryAt?: string, resetsOn?: string }}
 */
export function listError(code, o = {}) {
  const known = LIST_ERRORS[code] ? code : 'unavailable'
  const [http, say] = LIST_ERRORS[known]
  const out = { http, code: known, error: say({ $: usd, ...o }) }
  if (known === 'rate_limited' && o.retryAfterSec != null) out.retryAfterSec = o.retryAfterSec
  if (known === 'search_limit' && o.retryAt) out.retryAt = o.retryAt
  if (known === 'quota' && o.resetsOn) out.resetsOn = o.resetsOn
  return out
}
