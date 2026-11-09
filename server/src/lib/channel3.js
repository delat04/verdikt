/*  ============================================================================
    Channel3 — live listings for 100M+ products across thousands of stores, used to plan what an expense
    budget buys: a real product, its price and the store. Verdikt is the MCP client here: it calls
    Channel3's public MCP server (no key on the free tier; CHANNEL3_API_KEY is sent if set).
    Links are Channel3's attributed buy links, so the page that shows them says they may earn a commission.
    ============================================================================ */

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

const SERVER = process.env.CHANNEL3_MCP_URL || 'https://mcp.trychannel3.com/'

/** The cheapest in-stock USD offer for each product, at or under maxCents. */
export async function searchProducts(query, { maxCents } = {}) {
  const client = new Client({ name: 'verdikt', version: '1.0.0' })
  const headers = process.env.CHANNEL3_API_KEY ? { 'X-API-Key': process.env.CHANNEL3_API_KEY } : {}
  await client.connect(new StreamableHTTPClientTransport(new URL(SERVER), { requestInit: { headers } }))
  try {
    // the search reads price limits from plain words ("under $60")
    const q = maxCents ? `${query} under $${Math.floor(maxCents / 100)}` : query
    const r = await client.callTool({ name: 'search_products', arguments: { query: q } }, undefined, { timeout: 30000 })
    if (r.isError) throw new Error((r.content || []).map((c) => c.text || '').join('').slice(0, 200) || 'Channel3 search failed')
    return (r.structuredContent?.products || []).map(listing).filter((p) => p && (!maxCents || p.priceCents <= maxCents)).slice(0, 8)
  } finally {
    await client.close().catch(() => {})
  }
}

function listing(p) {
  const offers = (p.offers || []).filter((o) => o.price?.price != null && (o.price.currency || 'USD') === 'USD' && o.availability !== 'OutOfStock')
  if (!offers.length) return null
  const best = offers.reduce((a, b) => (b.price.price < a.price.price ? b : a))
  const image = (p.images || []).find((i) => i.is_main_image) || p.images?.[0]
  return {
    id: p.id, title: String(p.title || '').slice(0, 160), brand: p.brands?.[0]?.name || '',
    image: image?.cleaned_url || image?.url || '', priceCents: Math.round(best.price.price * 100), currency: 'USD',
    domain: best.domain, url: best.url, inStock: best.availability === 'InStock',
  }
}
