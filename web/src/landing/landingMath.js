// Landing timeline maths, ported from the Aeon landing page.
// A scroll story is a pure function of one number, its progress (0 → 1). These helpers turn that
// number into what a section paints: windows, eases, stages, typed text and counters. No DOM here.

export const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v))

/** 0 before `from`, 1 after `to`, linear in between */
export const range = (p, from, to) => clamp((p - from) / (to - from))

export const easeOut = (t) => 1 - Math.pow(1 - clamp(t), 3)

export const easeInOut = (t) => {
  const x = clamp(t)
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2
}

/**
 * Split [from, to] of a timeline into `n` equal stages.
 * → { index, t }: the stage `p` sits in and how far through it (0 → 1). Before `from` it is stage 0
 * at t 0; after `to` the last stage at t 1.
 */
export function stageAt(p, n, from = 0, to = 1) {
  const x = range(p, from, to) * n
  const index = Math.min(n - 1, Math.floor(x))
  return { index, t: clamp(x - index) }
}

/** The first characters of `text` typed by `t` */
export const typed = (text, t) => text.slice(0, Math.round(clamp(t) * text.length))

/** A counter running from 0 to `to` */
export const countUp = (to, t) => Math.round(to * easeOut(t))
