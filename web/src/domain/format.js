export function money(cents = 0, currency = 'USD', { whole = false } = {}) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  }).format((cents || 0) / 100)
}

export function toCents(value) {
  const n = Number(String(value ?? '').replace(/[^0-9.]/g, ''))
  return Number.isFinite(n) ? Math.round(n * 100) : 0
}

export function timeAgo(iso) {
  if (!iso) return ''
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 45) return 'just now'
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d ago`
  return shortDate(iso)
}

export function shortDate(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function dueLabel(iso) {
  if (!iso) return 'No due date'
  const days = Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000)
  if (days < 0) return `${-days}d overdue`
  if (days === 0) return 'Due today'
  if (days === 1) return 'Due tomorrow'
  return `Due ${shortDate(iso)}`
}

export function firstName(name = '') {
  return name.trim().split(/\s+/)[0] || name
}

export function hostOf(url = '') {
  try { return new URL(url).host } catch { return url }
}

// Verdikt's cut, taken from the freelancer's payout (marketplace-style). Matches PLATFORM_FEE_PERCENT on the server.
export const FEE_PERCENT = Math.max(0, Number(import.meta.env.VITE_PLATFORM_FEE_PERCENT ?? 2))
export function split(cents) {
  const fee = Math.round(((cents || 0) * FEE_PERCENT) / 100)
  return { fee, net: (cents || 0) - fee }
}
