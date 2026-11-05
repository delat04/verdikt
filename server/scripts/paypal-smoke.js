/*  PayPal escrow smoke test (sandbox)
    1. creates an AUTHORIZE order for $24.00
    2. you approve it in the browser with your sandbox *personal* account
    3. authorizes it (funds held), then captures (release) or voids (refund)

    npm run paypal:smoke            → release path
    npm run paypal:smoke -- --void  → refund path
*/

import { createInterface } from 'node:readline/promises'
import {
  createAuthorizeOrder, getOrder, authorizeOrder, captureAuthorization, voidAuthorization, approveLink, PayPalError,
} from '../src/lib/paypal.js'

const refund = process.argv.includes('--void')
const step = (n, msg) => console.log(`\n[${n}] ${msg}`)

try {
  step(1, 'Creating AUTHORIZE order for $24.00…')
  const order = await createAuthorizeOrder({
    amountCents: 2400,
    referenceId: 'smoke-test',
    description: 'Verdikt smoke test — milestone 1',
  })
  console.log(`    order ${order.id} → ${order.status}`)

  step(2, 'Approve it with your sandbox personal account:')
  console.log(`    ${approveLink(order)}`)
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  await rl.question('\n    Press Enter once approved… ')
  rl.close()

  const approved = await getOrder(order.id)
  console.log(`    order status → ${approved.status}`)
  if (approved.status !== 'APPROVED') throw new Error('Order was not approved — open the link and log in with the sandbox buyer')

  step(3, 'Authorizing (placing the hold)…')
  const { authorization } = await authorizeOrder(order.id)
  console.log(`    authorization ${authorization.id} → ${authorization.status}, expires ${authorization.expiration_time}`)

  if (refund) {
    step(4, 'Voiding the hold (refund path)…')
    await voidAuthorization(authorization.id)
    console.log('    voided — the buyer is never charged')
  } else {
    step(4, 'Capturing the hold (release path)…')
    const capture = await captureAuthorization(authorization.id, { noteToPayer: 'Verdikt smoke test release' })
    console.log(`    capture ${capture.id} → ${capture.status}`)
  }

  console.log('\n✓ PayPal escrow flow works.\n')
} catch (err) {
  if (err instanceof PayPalError) {
    console.error(`\n✗ PayPal ${err.status}: ${err.message} (debug_id ${err.debugId})`)
    console.error(JSON.stringify(err.body?.details ?? err.body, null, 2))
  } else {
    console.error(`\n✗ ${err.message}`)
  }
  process.exit(1)
}
