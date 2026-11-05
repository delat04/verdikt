import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { supabase, isConfigured } from '@/lib/supabase'

export const useAuthStore = defineStore('auth', () => {
  const session = ref(null)
  const profile = ref(null)

  const user = computed(() => session.value?.user ?? null)
  const displayName = computed(() =>
    profile.value?.display_name || user.value?.email?.split('@')[0] || 'Guest')

  async function loadProfile() {
    if (!user.value) { profile.value = null; return }
    const { data } = await supabase.from('profiles').select('*').eq('id', user.value.id).maybeSingle()
    profile.value = data
  }

  async function init() {
    if (!isConfigured) return
    const { data } = await supabase.auth.getSession()
    session.value = data.session
    await loadProfile()
    supabase.auth.onAuthStateChange((_event, next) => {
      session.value = next
      loadProfile()
    })
  }

  async function signInWithEmail(email) {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    })
    if (error) throw error
  }

  async function signOut() {
    await supabase.auth.signOut()
  }

  return { session, profile, user, displayName, init, signInWithEmail, signOut }
})
