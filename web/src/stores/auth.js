import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { api } from '@/services'

/* The signed-in person and their profile, from whichever backend is active. */
export const useAuthStore = defineStore('auth', () => {
  const user = ref(null)
  const profile = ref(null)
  const ready = ref(false)

  const name = computed(() => profile.value?.name || user.value?.email?.split('@')[0] || '')
  const onboarded = computed(() => !!profile.value?.onboarded)

  async function refresh() {
    const s = await api.getSession()
    user.value = s?.user ?? null
    profile.value = s?.profile ?? null
    ready.value = true
  }

  async function init() {
    await refresh()
    api.subscribe(() => refresh())
  }

  async function signInAs(key) {
    await api.signInAs(key)
    await refresh()
  }

  async function updateProfile(patch) {
    profile.value = await api.updateProfile(patch)
  }

  async function signOut() {
    await api.signOut()
    user.value = null
    profile.value = null
  }

  return { user, profile, ready, name, onboarded, init, refresh, signInAs, updateProfile, signOut }
})
