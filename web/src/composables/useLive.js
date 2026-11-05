import { ref, onMounted, onUnmounted, watch } from 'vue'
import { api } from '@/services'

/**
 * Loads data and keeps it fresh: re-runs `loader` whenever the backend reports a change
 * (realtime in live mode, local events in demo). Coalesces bursts into one reload.
 *   const { data, loading, error, reload } = useLive(() => api.getContract(id), { watch: () => id })
 */
export function useLive(loader, { watch: source } = {}) {
  const data = ref(null)
  const loading = ref(true)
  const error = ref('')
  let timer = null
  let alive = true

  async function reload() {
    try {
      const value = await loader()
      if (!alive) return
      data.value = value
      error.value = ''
    } catch (e) {
      if (alive) error.value = e.message
    } finally {
      if (alive) loading.value = false
    }
  }

  const schedule = () => {
    clearTimeout(timer)
    timer = setTimeout(reload, 60)
  }

  let off = null
  onMounted(() => {
    reload()
    off = api.subscribe(schedule)
  })
  onUnmounted(() => {
    alive = false
    clearTimeout(timer)
    off?.()
  })
  if (source) watch(source, () => { loading.value = true; reload() })

  return { data, loading, error, reload }
}
