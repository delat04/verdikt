import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { isConfigured } from '@/lib/supabase'

const routes = [
  { path: '/', redirect: '/contracts' },
  { path: '/login', component: () => import('@/views/LoginView.vue'), meta: { guest: true } },
  { path: '/auth/callback', component: () => import('@/views/AuthCallbackView.vue'), meta: { guest: true } },
  { path: '/setup', component: () => import('@/views/SetupView.vue'), meta: { guest: true } },
  { path: '/contracts', component: () => import('@/views/DashboardView.vue') },
  { path: '/contracts/new', component: () => import('@/views/NewContractView.vue') },
]

const router = createRouter({ history: createWebHistory(), routes })

router.beforeEach((to) => {
  if (!isConfigured && to.path !== '/setup') return '/setup'
  if (to.meta.guest) return true
  if (!useAuthStore().user) return { path: '/login', query: { next: to.fullPath } }
  return true
})

export default router
