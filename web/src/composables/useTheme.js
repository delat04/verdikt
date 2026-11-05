import { ref } from 'vue'

/* 'light' | 'dark' | 'system' — system removes the attribute so tokens.css follows the device */
const KEY = 'verdikt-theme'

function read() {
  try {
    const t = localStorage.getItem(KEY)
    return t === 'light' || t === 'dark' ? t : 'system'
  } catch {
    return 'system'
  }
}

const theme = ref(read())

function apply(t) {
  if (t === 'system') delete document.documentElement.dataset.theme
  else document.documentElement.dataset.theme = t
}

export function useTheme() {
  function setTheme(next) {
    theme.value = next
    apply(next)
    try { localStorage.setItem(KEY, next) } catch {}
  }
  const isDark = () =>
    theme.value === 'dark' || (theme.value === 'system' && window.matchMedia?.('(prefers-color-scheme: dark)').matches)
  return { theme, setTheme, isDark }
}
