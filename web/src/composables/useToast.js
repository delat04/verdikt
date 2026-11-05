import { reactive } from 'vue'

/* One toast stack for the app. tone: info | ok | danger. Rendered by VToaster in App.vue. */
export const toasts = reactive([])
let seq = 0

export function toast(message, { tone = 'info', ms = 4200 } = {}) {
  const id = ++seq
  toasts.push({ id, message, tone })
  setTimeout(() => {
    const i = toasts.findIndex((t) => t.id === id)
    if (i !== -1) toasts.splice(i, 1)
  }, ms)
}
