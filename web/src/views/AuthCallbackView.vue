<script setup>
import { onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AuthLayout from '@/layouts/AuthLayout.vue'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const route = useRoute()
const router = useRouter()

onMounted(async () => {
  // supabase-js reads the session from the URL; give it a moment, then route on
  for (let i = 0; i < 10 && !auth.user; i++) {
    await auth.refresh()
    if (!auth.user) await new Promise((r) => setTimeout(r, 300))
  }
  const next = typeof route.query.next === 'string' ? route.query.next : '/contracts'
  if (!auth.user) return router.replace('/login')
  router.replace(auth.onboarded ? next : { path: '/onboarding', query: { next } })
})
</script>

<template>
  <AuthLayout>
    <p class="wait"><span class="vk-spin" /> Signing you in…</p>
  </AuthLayout>
</template>

<style scoped>
.wait { display: flex; align-items: center; gap: 10px; margin: 0; color: var(--vk-muted); }
</style>
