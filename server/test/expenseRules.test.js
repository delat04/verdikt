/*  ============================================================================
    The shopping-list rules (agent/expenseRules.js): when a receipt is for an item both sides agreed on,
    at a store that sells it, at about the agreed price. Table cases, pure, no keys. The list item is the
    recorded Channel3 product run through listing(), so these cases break if the client's shape drifts.
    The receipt text is the only input about the store: a merchant the freelancer typed never is.
    ============================================================================ */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

process.env.ANTHROPIC_API_KEY = ''
process.env.OPENROUTER_API_KEY = ''
const { matchList, itemState, storeAliases, productSignals, listChecks, lineMax, receiptBand, itemLifecycle, outstandingCents, COVER_SUGGESTIONS,
  statusFor, canRemove, canAgree, canDecline, listError, HOLDING } = await import('../src/agent/expenseRules.js')
const { listing } = await import('../src/lib/channel3.js')

const product = JSON.parse(readFileSync(new URL('./fixtures/channel3/product-Rcq3ctM.json', import.meta.url), 'utf8'))
const NETUM = { ...listing(product, { keepOutOfStock: true }), plannedBy: 'client', status: 'terms', asOf: '2026-11-09T12:00:00Z' }
const store = (domain, priceCents) => ({ currency: 'USD', domain, priceCents, offers: [{ domain, priceCents, inStock: true }] })
const ANSELF = { id: 'AnsP01', title: 'Portable Mini Thermal Receipt Printer', brand: 'Anself', ...store('walmart.com', 2869), plannedBy: 'freelancer', status: 'agreed' }
const $ = (c) => `$${(c / 100).toFixed(2)}`
const SCANNER = 'walmart.com order WM-77310\nNetum 2D Barcode Scanner  $34.20\nSales tax  $2.82\nOrder total  $37.02'
const TWO = 'walmart.com order WM-77342\nNetum 2D Barcode Scanner  $34.20\nAnself Mini Thermal Receipt Printer  $28.69\nSales tax  $5.19\nOrder total  $68.08'
const run = (items, text, claimedCents, usedIds) => matchList({ items, text, claimedCents, signed: true, usedIds })

test('the recorded Channel3 product becomes the list item the rules expect', () => {
  assert.equal(NETUM.id, 'Rcq3ctM')
  assert.equal(NETUM.brand, 'Netum')
  assert.equal(NETUM.priceCents, 3420)
  assert.deepEqual(receiptBand(NETUM), { stores: ['walmart.com'], lineMaxCents: 3933, claimMaxCents: 4104 })
  const sig = productSignals(NETUM)
  assert.equal(sig.brand, 'netum')
  assert.deepEqual(sig.words, ['barcode', 'scanner'])
  assert.equal(sig.need, 2)
  assert.deepEqual(sig.models, [])   // '2D' is generic
  assert.deepEqual(productSignals({ ...NETUM, history: { storeTitle: 'Netum 2d Barcode Scanner With Stand Usb 2.0 … -m5s' } }).models.map((m) => m.token), ['M5S'])
})

test('1. an agreed scanner on a Walmart receipt matches, priced within tax', () => {
  const r = run([NETUM], SCANNER, 3702)
  assert.equal(r.kind, 'match')
  assert.equal(r.priceOk, true)
  assert.equal(r.claimMaxCents, 4104)
  assert.equal(r.matches[0].title, 'Netum 2D Barcode Scanner')
  assert.equal(r.matches[0].storeLine, 1)
  assert.equal(r.matches[0].lineIndex, 1)
  assert.equal(r.matches[0].lineCents, 3420)
  assert.deepEqual(r.matches[0].how, ['brand', 'words'])
  const rows = listChecks(r, { $, dateOf: () => 'Nov 9', clientName: 'Maya' })
  assert.deepEqual(rows.map((c) => [c.key, c.status, c.by]), [['list_store', 'pass', 'rules'], ['list_item', 'pass', 'rules'], ['list_price', 'pass', 'rules']])
  assert.equal(rows[0].observed, 'walmart.com is on line 1 of the receipt.')
  assert.equal(rows[1].observed, 'Line 2 names Netum 2D Barcode Scanner (brand, 2 of 2 title words).')
  assert.equal(rows[2].observed, 'Line price $34.20; listed at $34.20 on Nov 9. You claimed $37.02, within $41.04 with tax and shipping.')
  const withHistory = run([{ ...NETUM, history: { stats: { minCents: 3420, maxCents: 3420 } } }], SCANNER, 3702)
  assert.match(listChecks(withHistory, { $, dateOf: () => 'Nov 9' })[2].observed, /on Nov 9 \(30-day range \$34\.20 to \$34\.20, Channel3\)\./)
})

test('2. a receipt that never names the store is none (the typed merchant is no input)', () => {
  const r = run([NETUM], 'Order WM-77310\nNetum 2D Barcode Scanner  $34.20\nOrder total  $37.02', 3702)
  assert.equal(r.kind, 'none')
  assert.deepEqual(listChecks(r, { $ }), [])
  assert.equal(matchList.length, 1)   // one object; there is no merchant field to pass
})

test('3. a Walmart receipt for another item is store_only', () => {
  const r = run([NETUM], 'walmart.com order WM-77388\nBluetooth Speaker  $34.88\nSales tax  $2.79\nOrder total  $37.67', 3767)
  assert.equal(r.kind, 'store_only')
  const rows = listChecks(r, { $ })
  assert.deepEqual(rows.map((c) => [c.key, c.status, c.label]), [['list', 'info', 'On the shopping list']])
  assert.equal(rows[0].observed, 'walmart.com sells items on the list, but no line names Netum 2D Barcode Scanner.')
})

test('4. store.google.com is google, never "store"', () => {
  assert.deepEqual(storeAliases('store.google.com'), ['google.com', 'google'])
  const pixel = { id: 'Px1', title: 'Pixel Tablet Charging Speaker Dock', brand: 'Google', ...store('store.google.com', 3420), status: 'agreed' }
  assert.equal(productSignals(pixel).brand, '')   // the brand is the store's name
  assert.equal(run([pixel], 'Store pickup … $34.20', 3420).kind, 'none')
})

test('5. Amazon Web Services is not amazon.com', () => {
  const echo = { id: 'Am1', title: 'Echo Show Smart Display', brand: 'Amazon', ...store('amazon.com', 3420), status: 'agreed' }
  assert.equal(run([echo], 'Amazon Web Services … EC2 $34.20', 3420).kind, 'none')
})

test('6. hp.com: "Shipping" holds no store', () => {
  const hp = { id: 'Hp1', title: 'DeskJet Wireless Printer', brand: 'HP', ...store('hp.com', 5999), status: 'agreed' }
  assert.equal(run([hp], 'Shipping $5.00', 500).kind, 'none')
  assert.deepEqual(storeAliases('hp.com'), ['hp.com', 'hp store'])
})

test('7. scanner and printer both agreed on one receipt', () => {
  const r = run([NETUM, ANSELF], TWO, 6808)
  assert.equal(r.kind, 'match')
  assert.equal(r.matches.length, 2)
  assert.equal(r.listedCents, 6289)
  assert.equal(r.priceOk, true)
  const rows = listChecks(r, { $, dateOf: () => 'Nov 9' })
  assert.match(rows[1].observed, /^Line 2 names Netum 2D Barcode Scanner \(brand, 2 of 2 title words\)\. Line 3 names Anself Portable Mini Thermal Receipt Printer \(brand, 3 of 3 title words\)\.$/)
})

test('8. the printer only proposed: one match and the claim is over', () => {
  const r = run([NETUM, { ...ANSELF, status: 'proposed' }], TWO, 6808)
  assert.equal(r.kind, 'match')
  assert.equal(r.matches.length, 1)
  assert.equal(r.claimOk, false)
  assert.equal(r.priceOk, false)
  const price = listChecks(r, { $, clientName: 'Maya' })[2]
  assert.equal(price.status, 'unknown')
  assert.equal(price.observed, 'You claimed $68.08; the agreed items come to $34.20, up to $41.04 with tax and shipping.')
  assert.equal(price.fix, 'Maya decides.')
})

test('9. a sale price under the listing is fine', () => {
  const r = run([NETUM], 'walmart.com\nNetum 2D Barcode Scanner  $29.99\nOrder total  $32.39', 3239)
  assert.equal(r.kind, 'match')
  assert.equal(r.matches[0].lineCents, 2999)
  assert.equal(r.priceOk, true)
})

test('10. a line over the listing, unless the 30-day high covers it', () => {
  const text = 'walmart.com\nNetum 2D Barcode Scanner  $44.00\nOrder total  $47.52'
  const r = run([NETUM], text, 4752)
  assert.equal(r.matches[0].lineOk, false)
  assert.equal(listChecks(r, { $, clientName: 'Maya' })[2].observed, 'Line price $44.00 is above the agreed $34.20 (up to $39.33).')
  assert.equal(lineMax({ ...NETUM, history: { stats: { maxCents: 4500 } } }), 4590)
  assert.equal(run([{ ...NETUM, history: { stats: { maxCents: 4500 } } }], text, 4752).matches[0].lineOk, true)
})

test('11. an item another claim bought: store_only, and the row says so', () => {
  const r = run([NETUM], SCANNER, 3702, ['Rcq3ctM'])
  assert.equal(r.kind, 'store_only')
  assert.equal(listChecks(r, { $ })[0].observed, 'walmart.com sells items on the list. Netum 2D Barcode Scanner was already bought on another claim.')
  const both = run([NETUM, { ...ANSELF, status: 'proposed' }], 'walmart.com\nBluetooth Speaker  $34.88', 3767)
  assert.equal(listChecks(both, { $ })[0].observed, 'walmart.com sells items on the list, but no line names Netum 2D Barcode Scanner. Anself Portable Mini Thermal Receipt Printer is proposed and not agreed yet.')
})

test('12. OCR split the price onto the next line', () => {
  const r = run([NETUM], 'walmart.com\nNETUM 2D BARCODE SCANNER M5S\n34.20\nTOTAL 37.02', 3702)
  assert.equal(r.kind, 'match')
  assert.equal(r.matches[0].lineCents, 3420)
})

test('13. B&H prints its name, not bhphotovideo.com', () => {
  const adesso = { id: 'Ad1', title: 'NuScan 2D Wireless Barcode Scanner', brand: 'Adesso', ...store('bhphotovideo.com', 11499), status: 'agreed' }
  const r = run([adesso], 'B&H Photo Video\nADESSO NUSCAN 2D WIRELESS SCANNER $114.99\nTotal $124.19', 12419)
  assert.equal(r.kind, 'match')
  assert.equal(r.matches[0].alias, 'b&h photo')
  assert.equal(r.priceOk, true)
})

test('14. "BEST BUY #1234" is bestbuy.com', () => {
  const r = run([{ id: 'Bb1', title: 'Rocketfish Tablet Stand', brand: 'Rocketfish', ...store('bestbuy.com', 2999), status: 'agreed' }], 'BEST BUY #1234\nInsignia HDMI cable 12.99', 1299)
  assert.equal(r.storeHits.length, 1)
  assert.equal(r.storeHits[0].alias, 'best buy')
})

test('15. "Wal-Mart Stores, Inc." is walmart.com', () => {
  const r = run([NETUM], 'Wal-Mart Stores, Inc.\nNetum 2D Barcode Scanner 34.20', 3420)
  assert.equal(r.storeHits[0].alias, 'wal-mart')
  assert.equal(r.kind, 'match')
})

test('17. the brand alone never names the item: a Netum cable is not the Netum scanner', () => {
  const cable = 'Walmart.com\nNetum USB charging cable 3ft  12.99\nTotal $14.03'
  const r = run([NETUM], cable, 1403)
  assert.equal(r.kind, 'store_only')
  assert.equal(listChecks(r, { $ })[0].status, 'info')
  // the brand with one of the two title words still does, and says how many
  const reader = run([NETUM], 'walmart.com\nNetum barcode reader  $34.20\nTotal $37.02', 3702)
  assert.equal(reader.kind, 'match')
  assert.deepEqual(reader.matches[0].how, ['brand'])
  assert.equal(listChecks(reader, { $ })[1].observed, 'Line 2 names Netum 2D Barcode Scanner (brand, 1 of 2 title words).')
  // a placeholder brand names nothing
  const generic = { id: 'Gn1', title: 'Silicone Phone Case', brand: 'Generic', ...store('walmart.com', 999), status: 'agreed' }
  assert.equal(productSignals(generic).brand, '')
  assert.equal(run([generic], 'walmart.com\nGeneric charging cable 9.99', 999).kind, 'store_only')
  assert.equal(productSignals({ ...generic, brand: 'N/A' }).brand, '')
})

test('18. a line that names the item but shows no price: the client decides', () => {
  const r = run([NETUM], 'walmart.com\nNetum 2D Barcode Scanner\nShipped to Sam\nOrder total  $37.02', 3702)
  assert.equal(r.kind, 'match')
  assert.equal(r.matches[0].lineCents, null)
  assert.equal(r.matches[0].lineOk, false)
  assert.equal(r.priceOk, false)
  const price = listChecks(r, { $, clientName: 'Maya' })[2]
  assert.equal(price.status, 'unknown')
  assert.equal(price.observed, 'No price on its line, so the agreed $34.20 wasn\'t checked.')
})

test('19. a failed capture (error) still holds its item and budget, so no second claim buys it', () => {
  const failed = { status: 'error', created_at: '2026-11-10T10:00:00Z', extracted: { planned: [{ id: 'Rcq3ctM' }] } }
  assert.equal(itemLifecycle(NETUM, [failed]).state, 'needs_client')
  assert.equal(outstandingCents([NETUM], [failed]), 0)
  assert.ok(HOLDING.includes('error') && HOLDING.includes('approved') && !HOLDING.includes('declined'))
})

test('16. itemState: consent before and after signing, and legacy rows', () => {
  assert.equal(itemState({ status: 'terms' }, { signed: true }), 'agreed')
  assert.equal(itemState({ status: 'terms' }, { signed: false }), 'terms')
  assert.equal(itemState({ plannedBy: 'client' }), 'agreed')
  assert.equal(itemState({ plannedBy: 'freelancer' }), 'proposed')
  assert.equal(itemState({ status: 'proposed', plannedBy: 'client' }, { signed: true }), 'proposed')
  assert.equal(run([{ ...NETUM, status: 'terms' }], SCANNER, 3702).kind, 'match')
  assert.equal(matchList({ items: [NETUM], text: SCANNER, claimedCents: 3702, signed: false }).kind, 'store_only')
})

test('lifecycle and what the list still holds for', () => {
  const claims = [
    { status: 'declined', extracted: { planned: [{ id: 'Rcq3ctM' }] }, created_at: '2026-11-10T01:00:00Z' },
    { status: 'needs_client', extracted: { planned: [{ id: 'AnsP01' }] }, created_at: '2026-11-10T02:00:00Z' },
  ]
  assert.equal(itemLifecycle(NETUM, claims).state, 'open')
  assert.equal(itemLifecycle(ANSELF, claims).state, 'needs_client')
  assert.equal(itemLifecycle(ANSELF, [...claims, { status: 'approved', extracted: { planned: [{ id: 'AnsP01' }] }, created_at: '2026-11-10T03:00:00Z' }]).state, 'reimbursed')
  assert.equal(outstandingCents([NETUM, ANSELF], claims), 3420)
})

test('non-USD items, store aliases and the 8 budget lines', () => {
  assert.equal(run([{ ...NETUM, currency: 'EUR' }], SCANNER, 3702).kind, 'store_only')
  assert.deepEqual(COVER_SUGGESTIONS, ['Domain', 'Hosting', 'Stock photos', 'Fonts', 'Icons & illustrations', 'API credits', 'Software licenses', 'Email'])
  assert.deepEqual(storeAliases('mount-it.com'), ['mount-it.com', 'mount-it', 'mount it'])
  assert.equal(productSignals({ title: 'Monitor Arm', brand: 'Mount-It!', domain: 'mount-it.com' }).brand, '')
  assert.deepEqual(storeAliases('www.amazon.co.uk'), ['amazon.co.uk', 'amazon.com'])
})

// ---- who may change the list (C3-4): every row of the permission table, as the routes and the demo apply it
test('statusFor: before signing the list is terms; after, the client agrees and the freelancer proposes', () => {
  assert.equal(statusFor({ signedBoth: false, role: 'client' }), 'terms')
  assert.equal(statusFor({ signedBoth: false, role: 'freelancer' }), 'terms')
  assert.equal(statusFor({ signedBoth: true, role: 'client' }), 'agreed')
  assert.equal(statusFor({ signedBoth: true, role: 'freelancer' }), 'proposed')
  assert.equal(statusFor(), 'terms')
})

test('canRemove, canAgree and canDecline: the whole table', () => {
  const terms = { id: 'T', status: 'terms', plannedBy: 'client' }
  const signedTerms = { id: 'S', status: 'terms', plannedBy: 'freelancer' }   // agreed by signing
  const agreed = { id: 'A', status: 'agreed', plannedBy: 'client', agreedBy: 'client' }
  const proposed = { id: 'P', status: 'proposed', plannedBy: 'freelancer' }
  const legacyF = { id: 'LF', plannedBy: 'freelancer' }   // before statuses: proposed
  const legacyC = { id: 'LC', plannedBy: 'client' }       // before statuses: agreed
  const ok = { ok: true }
  const no = (code) => ({ ok: false, code })
  // [rule, item, role, signedBoth, lifecycle, expected]
  const rows = [
    // remove, before signing: either side, anything open
    [canRemove, terms, 'client', false, 'open', ok],
    [canRemove, terms, 'freelancer', false, 'open', ok],
    [canRemove, legacyF, 'client', false, 'open', ok],
    // remove, after signing: the freelancer any open item, the client only a proposed one
    [canRemove, signedTerms, 'freelancer', true, 'open', ok],
    [canRemove, agreed, 'freelancer', true, 'open', ok],
    [canRemove, proposed, 'freelancer', true, 'open', ok],
    [canRemove, proposed, 'client', true, 'open', ok],
    [canRemove, legacyF, 'client', true, 'open', ok],
    [canRemove, signedTerms, 'client', true, 'open', no('signed')],
    [canRemove, agreed, 'client', true, 'open', no('signed')],
    [canRemove, legacyC, 'client', true, 'open', no('signed')],
    // remove: a claim bought it, so nobody does, before or after signing
    [canRemove, agreed, 'freelancer', true, 'checking', no('bought')],
    [canRemove, agreed, 'client', true, 'needs_client', no('bought')],
    [canRemove, agreed, 'freelancer', true, { state: 'reimbursed' }, no('bought')],
    [canRemove, terms, 'client', false, 'reimbursed', no('bought')],
    // agree: the client, after signing, a proposed item
    [canAgree, proposed, 'client', true, 'open', ok],
    [canAgree, legacyF, 'client', true, 'open', ok],
    [canAgree, proposed, 'freelancer', true, 'open', no('client_only')],
    [canAgree, proposed, 'client', false, 'open', no('not_signed')],
    [canAgree, terms, 'client', false, 'open', no('not_signed')],
    [canAgree, agreed, 'client', true, 'open', no('not_proposed')],
    [canAgree, signedTerms, 'client', true, 'open', no('not_proposed')],
    [canAgree, proposed, 'client', true, 'checking', no('bought')],
    // decline: the client, a proposed item
    [canDecline, proposed, 'client', true, 'open', ok],
    [canDecline, legacyF, 'client', false, 'open', ok],
    [canDecline, proposed, 'freelancer', true, 'open', no('client_only')],
    [canDecline, agreed, 'client', true, 'open', no('not_proposed')],
    [canDecline, terms, 'client', false, 'open', no('not_proposed')],
    [canDecline, proposed, 'client', true, 'needs_client', no('bought')],
  ]
  for (const [rule, item, role, signedBoth, lifecycle, want] of rows) {
    assert.deepEqual(rule(item, { role, signedBoth, lifecycle }), want, `${rule.name}(${item.id}, ${role}, signed ${signedBoth}, ${JSON.stringify(lifecycle)})`)
  }
  // lifecycle defaults to open; itemLifecycle's answer goes in as is
  assert.deepEqual(canRemove(agreed, { role: 'freelancer', signedBoth: true }), ok)
  const bought = itemLifecycle(agreed, [{ status: 'approved', extracted: { planned: [{ id: 'A' }] }, created_at: '2026-11-10T03:00:00Z' }])
  assert.deepEqual(canRemove(agreed, { role: 'freelancer', signedBoth: true, lifecycle: bought }), no('bought'))
})

test('listError: the words, the status and only the extras that apply', () => {
  const e = (code, o) => listError(code, o)
  assert.deepEqual(e('no_budget'), { http: 409, code: 'no_budget', error: 'Add an expense budget first.' })
  assert.equal(e('settled').error, 'This milestone is settled, so its list is closed.')
  assert.equal(e('currency', { currency: 'EUR' }).error, 'Store listings are in US dollars and this contract pays in EUR, so the shopping list isn’t available here.')
  assert.deepEqual(e('search_limit', { limit: 30, after: 'after 10:41', retryAt: '2026-11-10T10:41:00.000Z' }),
    { http: 429, code: 'search_limit', error: 'That’s 30 store searches on this milestone this hour. Try again after 10:41.', retryAt: '2026-11-10T10:41:00.000Z' })
  assert.equal(e('search_limit', { limit: 60, scope: 'user', after: 'in 5 minutes' }).error, 'That’s 60 store searches from you this hour. Try again in 5 minutes.')
  assert.equal(e('no_room').error, 'The list already uses what’s left of the budget.')
  assert.deepEqual(e('gone'), { http: 409, code: 'gone', error: 'That listing is gone from the store. Search again.' })
  assert.deepEqual(e('stale'), { http: 409, code: 'stale', error: 'That listing is from an earlier search. Search again, then add it.' })
  assert.equal(e('search_limit', { limit: 20, what: 'store lookups', after: 'in 3 minutes' }).error, 'That’s 20 store lookups on this milestone this hour. Try again in 3 minutes.')
  assert.equal(e('out_of_stock', { domain: 'walmart.com' }).error, 'Out of stock at walmart.com now. Pick another listing.')
  assert.equal(e('over_budget', { priceCents: 5999, roomCents: 3711 }).error, 'That adds $59.99 to a list with $37.11 of room. Remove something first.')
  assert.equal(e('over_budget', { priceCents: 5999, roomCents: -200 }).error, 'That adds $59.99 to a list with $0.00 of room. Remove something first.')
  assert.equal(e('list_full').error, 'A list holds up to 6 items.')
  assert.deepEqual(e('signed', { freelancerName: 'Sam' }), { http: 403, code: 'signed', error: 'Signed items stay on the list. Sam can take it off.' })
  assert.equal(e('bought').error, 'This item is on a claim already, so it stays on the list.')
  assert.deepEqual(e('below_list', { listCents: 6289 }), { http: 400, code: 'below_list', error: 'The shopping list comes to $62.89. Set at least that, or remove items first.' })
  assert.equal(e('below_list', { listCents: 123456 }).error, 'The shopping list comes to $1,234.56. Set at least that, or remove items first.')
  assert.deepEqual(e('quota', { resetsOn: '2026-12-01' }), { http: 503, code: 'quota', error: 'Store search is paused until Dec 1. Your list and claims still work.', resetsOn: '2026-12-01' })
  assert.deepEqual(e('unavailable'), { http: 503, code: 'unavailable', error: 'Store search isn’t answering. Try again in a minute.' })
  assert.deepEqual(e('rate_limited', { retryAfterSec: 30 }), { http: 429, code: 'rate_limited', error: 'Store search is busy. Try again in 30 seconds.', retryAfterSec: 30 })
  assert.equal(e('rate_limited', { retryAfterSec: 2 }).error, 'Store search is busy. Try again in a few seconds.')
  assert.equal(e('client_only').http, 403)
  assert.equal(e('not_signed').http, 409)
  assert.equal(e('not_on_list').http, 404)
  assert.equal(e('no_product').http, 400)
  assert.equal(e('invalid').http, 400)
  // a caller's money format wins; an unknown code reads as unavailable; extras never leak onto other codes
  assert.equal(e('over_budget', { priceCents: 100, roomCents: 50, $: (c) => `USD ${c}` }).error, 'That adds USD 100 to a list with USD 50 of room. Remove something first.')
  assert.equal(e('teapot').code, 'unavailable')
  assert.deepEqual(Object.keys(e('gone', { retryAt: 'x', resetsOn: 'y', retryAfterSec: 1 })), ['http', 'code', 'error'])
})
