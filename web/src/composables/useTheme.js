import { ref } from 'vue'

const KEY = 'verdikt-theme'
const theme = ref(document.documentElement.dataset.theme === 'light' ? 'light' : 'dark')

export function useTheme() {
  function setTheme(next) {
    theme.value = next
    document.documentElement.dataset.theme = next
    try { localStorage.setItem(KEY, next) } catch {}
  }
  const toggle = () => setTheme(theme.value === 'dark' ? 'light' : 'dark')
  return { theme, setTheme, toggle }
}
