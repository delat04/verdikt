/*  ============================================
    PayPal Orders v2 — escrow via authorize → capture / void
    Funding a milestone = create an AUTHORIZE order; the buyer approves it;
    we authorize (funds held). The verdict then captures (release) or voids (refund).
    ============================================ */

import { randomUUID } from 'node:crypto'
import { config } from '../config.js'

const BASE = config.paypal.env === 'live'
  ? 'https://api-m.paypal.com'
  : 'https://api-m.sandbox.paypal.com'

export class PayPalError extends Error {
  constructor(status, body) {
    super(body?.message || `PayPal request failed (${status})`)
    this.status = status
    this.body = body
    this.debugId = body?.debug_id
  }
}

// ---- OAuth token (cached until shortly before expiry) ----
let cachedToken = null

async function accessToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value

  const basic = Buffer.from(`${config.paypal.clientId}:${config.paypal.clientSecret}`).toString('base64')
  const res = await fetch(`${BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  })
  const body = await res.json()
  if (!res.ok) throw new PayPalError(res.status, body)

  cachedToken = { value: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 }
  return cachedToken.value
}

async function call(method, path, body, { requestId } = {}) {
  const headers = {
    Authorization: `Bearer ${await accessToken()}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  }
  // Idempotency: retrying a money-moving call with the same id never double-charges
  if (method !== 'GET') headers['PayPal-Request-Id'] = requestId || randomUUID()

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  const json = text ? JSON.parse(text) : {}
  if (!res.ok) throw new PayPalError(res.status, json)
  return json
}

export function centsToValue(cents) {
  return (cents / 100).toFixed(2)
}

// ---- Orders ----
export function createAuthorizeOrder({ amountCents, currency = 'USD', referenceId, description, requestId, returnUrl, cancelUrl }) {
  return call('POST', '/v2/checkout/orders', {
    intent: 'AUTHORIZE',
    purchase_units: [{
      reference_id: referenceId,
      description: description?.slice(0, 127),
      amount: { currency_code: currency, value: centsToValue(amountCents) },
    }],
    payment_source: {
      paypal: {
        experience_context: {
          brand_name: 'Verdikt Escrow',
          user_action: 'CONTINUE',
          shipping_preference: 'NO_SHIPPING',
          ...(returnUrl && { return_url: returnUrl, cancel_url: cancelUrl || returnUrl }),
        },
      },
    },
  }, { requestId })
}

export function getOrder(orderId) {
  return call('GET', `/v2/checkout/orders/${orderId}`)
}

/** Places the hold. Returns the order; the authorization id is pulled out for convenience. */
export async function authorizeOrder(orderId, { requestId } = {}) {
  const order = await call('POST', `/v2/checkout/orders/${orderId}/authorize`, {}, { requestId })
  const authorization = order.purchase_units?.[0]?.payments?.authorizations?.[0]
  return { order, authorization }
}

// ---- Authorizations ----
export function getAuthorization(authorizationId) {
  return call('GET', `/v2/payments/authorizations/${authorizationId}`)
}

/**
 * Release: move held funds to the platform. With `amountCents` below the hold it's a partial release —
 * final_capture tells PayPal no more captures follow, so the rest of the hold goes back to the client.
 */
export function captureAuthorization(authorizationId, { requestId, noteToPayer, amountCents, currency = 'USD' } = {}) {
  return call('POST', `/v2/payments/authorizations/${authorizationId}/capture`, {
    final_capture: true,
    note_to_payer: noteToPayer?.slice(0, 255),
    ...(amountCents ? { amount: { currency_code: currency, value: centsToValue(amountCents) } } : {}),
  }, { requestId })
}

/** Refund before capture: drop the hold, the buyer is never charged. */
export function voidAuthorization(authorizationId, { requestId } = {}) {
  return call('POST', `/v2/payments/authorizations/${authorizationId}/void`, undefined, { requestId })
}

/** Extend a hold that is close to its 3-day honor period (valid up to 29 days). */
export function reauthorize(authorizationId, { requestId } = {}) {
  return call('POST', `/v2/payments/authorizations/${authorizationId}/reauthorize`, {}, { requestId })
}

// ---- Payouts: the platform pays the freelancer once a release is captured ----
/** One payout per release. PayPal refuses a reused sender_batch_id, which makes retries safe. */
export function createPayout({ senderBatchId, email, amountCents, currency = 'USD', note, subject, itemId }) {
  return call('POST', '/v1/payments/payouts', {
    sender_batch_header: { sender_batch_id: senderBatchId, email_subject: subject, email_message: note },
    items: [{
      recipient_type: 'EMAIL',
      receiver: email,
      amount: { value: centsToValue(amountCents), currency },
      note: note?.slice(0, 4000),
      sender_item_id: itemId,
    }],
  }, { requestId: senderBatchId })
}

export function getPayout(batchId) {
  return call('GET', `/v1/payments/payouts/${batchId}`)
}

// ---- Disputes (the agent reads them through PayPal's MCP server; answers go through REST) ----
export function listDisputes({ startTime } = {}) {
  const qs = new URLSearchParams({ page_size: '50', ...(startTime ? { start_time: startTime } : {}) })
  return call('GET', `/v1/customer/disputes?${qs}`)
}

export function getDispute(disputeId) {
  return call('GET', `/v1/customer/disputes/${disputeId}`)
}

/** Seller's evidence for a dispute — multipart, with the JSON in an `input` part. */
export async function provideEvidence(disputeId, { notes, type = 'OTHER' }) {
  const form = new FormData()
  const input = { evidences: [{ evidence_type: type, notes: notes.slice(0, 2000) }] }
  form.append('input', new Blob([JSON.stringify(input)], { type: 'application/json' }), 'input.json')
  const res = await fetch(`${BASE}/v1/customer/disputes/${disputeId}/provide-evidence`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await accessToken()}`, 'PayPal-Request-Id': `evidence-${disputeId}` },
    body: form,
  })
  const text = await res.text()
  const json = text ? JSON.parse(text) : {}
  if (!res.ok) throw new PayPalError(res.status, json)
  return json
}

/** A message on the dispute — works while it is still an inquiry, when evidence isn't accepted yet. */
export function sendDisputeMessage(disputeId, message) {
  return call('POST', `/v1/customer/disputes/${disputeId}/send-message`, { message: message.slice(0, 2000) }, { requestId: `message-${disputeId}` })
}

/** A short-lived access token, for handing PayPal's MCP server to the agent. */
export const mcpToken = () => accessToken()
export const sandbox = BASE.includes('sandbox')

// ---- Webhooks ----
export async function verifyWebhook(headers, event) {
  if (!config.paypal.webhookId) return false
  const result = await call('POST', '/v1/notifications/verify-webhook-signature', {
    auth_algo: headers['paypal-auth-algo'],
    cert_url: headers['paypal-cert-url'],
    transmission_id: headers['paypal-transmission-id'],
    transmission_sig: headers['paypal-transmission-sig'],
    transmission_time: headers['paypal-transmission-time'],
    webhook_id: config.paypal.webhookId,
    webhook_event: event,
  })
  return result.verification_status === 'SUCCESS'
}

export function approveLink(order) {
  return order.links?.find((l) => l.rel === 'payer-action' || l.rel === 'approve')?.href
}
