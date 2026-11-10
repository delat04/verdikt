import { test } from 'node:test'
import assert from 'node:assert/strict'

// Stand-in secrets, set before the report (and config.js) load: whatever an integration adds to /health,
// none of these, and none of their hosts, may come back
const SECRETS = {
  PAYPAL_CLIENT_ID: 'test-paypal-client-4f1c0a',
  PAYPAL_CLIENT_SECRET: 'test-paypal-secret-9b27e3',
  PAYPAL_WEBHOOK_ID: 'test-paypal-webhook-2c71',
  SUPABASE_URL: 'https://test-project-ref.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'test-supabase-service-0d8e',
  KERNEL_API_KEY: 'test-kernel-key-61af',
  ELASTIC_URL: 'https://test-cluster.es.example.cloud:443',
  ELASTIC_API_KEY: 'test-elastic-key-c3d9',
  CHANNEL3_API_KEY: 'test-channel3-key-7e52',
  ANTHROPIC_API_KEY: 'test-anthropic-key-a1b0',
  OPENROUTER_API_KEY: 'test-openrouter-key-55c4',
}
Object.assign(process.env, SECRETS, { PAYPAL_ENV: 'sandbox' })
const { healthReport } = await import('../src/lib/health.js')

test('reports the service up and which PayPal it talks to', async () => {
  const report = await healthReport()
  assert.equal(report.ok, true)
  assert.equal(report.paypalEnv, 'sandbox')
})

test('says whether checks record on Kernel, from env alone', async () => {
  const report = await healthReport()
  assert.equal(report.kernel, true)
})

test('says how Channel3 is set up, from env alone', async () => {
  const report = await healthReport()
  assert.deepEqual(report.channel3, { on: true, search: 'rest', cap: 900 })
})

test('is plain JSON: states and counts, nothing left undefined', async () => {
  const report = await healthReport()
  assert.deepEqual(JSON.parse(JSON.stringify(report)), report)
})

test('never carries a URL, a host or a key', async () => {
  const json = JSON.stringify(await healthReport())
  for (const [name, value] of Object.entries(SECRETS)) {
    assert.ok(!json.includes(value), `/health echoes ${name}`)
    if (value.includes('://')) assert.ok(!json.includes(new URL(value).hostname), `/health echoes the host of ${name}`)
  }
  assert.ok(!json.includes('://'), '/health carries a URL')
})
