function required(name) {
  const value = process.env[name]
  if (!value) throw new Error(`Missing env var ${name} — see server/.env.example`)
  return value
}

export const config = {
  port: Number(process.env.PORT || 4100),
  corsOrigin: (process.env.CORS_ORIGIN || 'http://localhost:5180').split(',').map((s) => s.trim()),

  paypal: {
    env: process.env.PAYPAL_ENV === 'live' ? 'live' : 'sandbox',
    get clientId() { return required('PAYPAL_CLIENT_ID') },
    get clientSecret() { return required('PAYPAL_CLIENT_SECRET') },
    webhookId: process.env.PAYPAL_WEBHOOK_ID || '',
  },

  // Verdikt's cut, taken from the freelancer's payout (marketplace-style); 0 turns it off
  fees: { percent: Math.max(0, Number(process.env.PLATFORM_FEE_PERCENT ?? 2)) },

  supabase: {
    get url() { return required('SUPABASE_URL') },
    get serviceRoleKey() { return required('SUPABASE_SERVICE_ROLE_KEY') },
  },
}
