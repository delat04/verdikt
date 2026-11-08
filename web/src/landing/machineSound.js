/**
 * The press's stamp, synthesized with Web Audio (no files to load). Ported from the Aeon landing page.
 *
 * Browsers refuse audio until the visitor has interacted with the page, and the hero animates on its
 * own before that, so nothing plays until the first pointer or key press anywhere. After that the
 * stamp plays only while `soundOn` is true.
 */
import { ref } from 'vue'

export const soundOn = ref(true)

let ctx = null
let unlocked = false

if (typeof window !== 'undefined') {
  const unlock = () => {
    unlocked = true
    window.removeEventListener('pointerdown', unlock, true)
    window.removeEventListener('keydown', unlock, true)
  }
  window.addEventListener('pointerdown', unlock, true)
  window.addEventListener('keydown', unlock, true)
}

function audio() {
  if (!soundOn.value || !unlocked) return null
  try {
    ctx ||= new AudioContext()
    if (ctx.state === 'suspended') ctx.resume()
    return ctx
  } catch {
    return null
  }
}

/* a burst of noise through a filter: the bright, metallic part of a hit */
function noise(a, t, { ms, type, freq, q = 1, gain }) {
  const n = Math.floor((a.sampleRate * ms) / 1000)
  const buf = a.createBuffer(1, n, a.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / n) ** 3
  const src = a.createBufferSource()
  src.buffer = buf
  const filter = a.createBiquadFilter()
  filter.type = type
  filter.frequency.value = freq
  filter.Q.value = q
  const g = a.createGain()
  g.gain.value = gain
  src.connect(filter).connect(g).connect(a.destination)
  src.start(t)
}
/* a falling tone: the body of a hit */
function thump(a, t, { from, to, ms, gain }) {
  const osc = a.createOscillator()
  osc.frequency.setValueAtTime(from, t)
  osc.frequency.exponentialRampToValueAtTime(to, t + ms / 1000)
  const g = a.createGain()
  g.gain.setValueAtTime(gain, t)
  g.gain.exponentialRampToValueAtTime(0.001, t + ms / 1000 + 0.02)
  osc.connect(g).connect(a.destination)
  osc.start(t)
  osc.stop(t + ms / 1000 + 0.03)
}

/** the press landing: a heavy thud, a metal clank, then the hiss of it lifting */
export function playStamp() {
  const a = audio()
  if (!a) return
  const t = a.currentTime
  thump(a, t, { from: 110, to: 38, ms: 170, gain: 0.55 })
  noise(a, t, { ms: 70, type: 'bandpass', freq: 1700, q: 2.5, gain: 0.32 })
  noise(a, t + 0.012, { ms: 40, type: 'highpass', freq: 5200, gain: 0.12 })
  noise(a, t + 0.2, { ms: 260, type: 'highpass', freq: 4200, gain: 0.05 })
}
