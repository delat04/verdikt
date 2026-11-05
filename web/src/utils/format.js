export function formatCents(cents = 0, currency = 'USD') {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100)
}

export function timeAgo(iso) {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

/* ---- Milestone statuses → label + tone (tone maps to a token) ---- */
export const MILESTONE_STATUS = {
  draft:            { label: 'Draft',            tone: 'faint' },
  awaiting_funding: { label: 'Awaiting funding', tone: 'faint' },
  funded:           { label: 'Held in escrow',   tone: 'accent' },
  submitted:        { label: 'Submitted',        tone: 'accent' },
  verifying:        { label: 'Verifying',        tone: 'warn' },
  passed:           { label: 'Passed',           tone: 'ok' },
  failed:           { label: 'Held — failed',    tone: 'danger' },
  released:         { label: 'Released',         tone: 'ok' },
  refunded:         { label: 'Refunded',         tone: 'faint' },
  disputed:         { label: 'In appeal',        tone: 'warn' },
}

/* The journey a milestone walks through, for the step tracker */
export const MILESTONE_STEPS = ['funded', 'submitted', 'verifying', 'released']

export function stepIndex(status) {
  if (status === 'passed') return 2
  if (status === 'failed' || status === 'disputed') return 2
  return MILESTONE_STEPS.indexOf(status)
}
