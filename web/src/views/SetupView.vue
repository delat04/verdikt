<script setup>
import AuthLayout from '@/layouts/AuthLayout.vue'
</script>

<template>
  <AuthLayout>
    <h1 class="title">Almost there</h1>
    <p class="sub">Supabase isn't configured yet. Copy <code>web/.env.example</code> to <code>web/.env</code>, fill in the values, then restart <code>npm run dev</code>.</p>
    <pre class="code">VITE_SUPABASE_URL=…
VITE_SUPABASE_ANON_KEY=…
VITE_API_URL=http://localhost:4100</pre>
  </AuthLayout>
</template>

<style scoped>
.title { margin: 0; font-size: 1.5rem; font-weight: 500; letter-spacing: -0.03em; }
.sub { margin: 0.5rem 0 0; font-size: 0.875rem; color: var(--muted); line-height: 1.6; }
code, .code { font-family: var(--mono); font-size: 0.8125rem; color: var(--accent-2); }
.code {
  margin: 1.25rem 0 0; padding: 0.875rem 1rem; border-radius: var(--r-md);
  background: var(--bg-2); border: 1px solid var(--line); color: var(--muted); white-space: pre-wrap;
}
</style>
