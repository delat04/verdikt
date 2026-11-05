<script setup>
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'
import AuthLayout from '@/layouts/AuthLayout.vue'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'

const router = useRouter()
const auth = useAuthStore()

onMounted(async () => {
  // supabase-js picks the session up from the URL; wait for it to land
  const { data } = await supabase.auth.getSession()
  auth.session = data.session
  router.replace(data.session ? '/contracts' : '/login')
})
</script>

<template>
  <AuthLayout>
    <p class="eyebrow">Signing you in…</p>
  </AuthLayout>
</template>
