function required(name) {
  const value = process.env[name]
  if (!value) throw new Error(`Missing env var ${name} — see server/.env.example`)
  return value
}

export const config = {
  port: Number(process.env.PORT || 4100),
  corsOrigin: (process.env.CORS_ORIGIN || 'http://localhost:5173').split(',').map((s) => s.trim()),

  paypal: {
    env: process.env.PAYPAL_ENV === 'live' ? 'live' : 'sandbox',
    get clientId() { return required('PAYPAL_CLIENT_ID') },
    get clientSecret() { return required('PAYPAL_CLIENT_SECRET') },
    webhookId: process.env.PAYPAL_WEBHOOK_ID || '',
  },

  supabase: {
    get url() { return required('SUPABASE_URL') },
    get serviceRoleKey() { return required('SUPABASE_SERVICE_ROLE_KEY') },
  },
}
