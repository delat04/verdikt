import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

const routes = [
  { path: '/', component: () => import('@/views/LandingView.vue'), meta: { public: true } },
  { path: '/design', component: () => import('@/views/DesignSystemView.vue'), meta: { public: true } },
  { path: '/login', component: () => import('@/views/LoginView.vue'), meta: { guest: true } },
  { path: '/auth/callback', component: () => import('@/views/AuthCallbackView.vue'), meta: { public: true } },
  { path: '/u/:handle', component: () => import('@/views/ProofView.vue'), props: true, meta: { public: true } },
  { path: '/join/:code?', component: () => import('@/views/JoinView.vue'), meta: { public: true } },
  { path: '/onboarding', component: () => import('@/views/OnboardingView.vue'), meta: { onboarding: true } },
  { path: '/contracts', component: () => import('@/views/HomeView.vue') },
  { path: '/contracts/new', component: () => import('@/views/NewContractView.vue') },
  { path: '/contracts/:id', component: () => import('@/views/ContractView.vue'), props: true },
  { path: '/jobs', component: () => import('@/views/JobsView.vue') },
  { path: '/ledger', component: () => import('@/views/LedgerView.vue') },
  { path: '/timeline', component: () => import('@/views/TimelineView.vue') },
  { path: '/dashboard', component: () => import('@/views/StudioView.vue') },
  { path: '/settings', component: () => import('@/views/SettingsView.vue') },
  { path: '/:pathMatch(.*)*', redirect: '/' },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior: () => ({ top: 0 }),
})

router.beforeEach((to) => {
  const auth = useAuthStore()
  if (to.meta.public) return true
  if (to.meta.guest) return auth.user ? '/contracts' : true
  if (!auth.user) return { path: '/login', query: { next: to.fullPath } }
  if (!auth.onboarded && !to.meta.onboarding) return { path: '/onboarding', query: { next: to.fullPath } }
  return true
})

export default router
