<template>
  <figure ref="el" class="hm" aria-hidden="true">
    <svg class="hm__art" :viewBox="VIEWBOX" preserveAspectRatio="xMidYMid meet">
      <defs>
        <clipPath id="hm-clip-back" clipPathUnits="userSpaceOnUse"><rect x="-60" y="-10" width="57" height="20" /></clipPath>
        <clipPath id="hm-clip-in" clipPathUnits="userSpaceOnUse"><rect x="-3" y="-10" width="6" height="20" /></clipPath>
        <clipPath id="hm-clip-front" clipPathUnits="userSpaceOnUse"><rect x="3" y="-10" width="57" height="20" /></clipPath>
      </defs>

      <!-- floor guides, the belt and its lane marks (they move with the belt) -->
      <path class="hm-dash" :d="STATIC.guides" />
      <Solid :s="STATIC.belt" />
      <g :transform="topPlane(BELT_Z, S)">
        <line class="hm-lane" x1="-46" y1="0" x2="46" y2="0" :style="{ strokeDashoffset: (-frame.belt).toFixed(2) }" />
      </g>

      <!-- the chassis, then every delivery still outside on the way in -->
      <Solid :s="STATIC.plinth" />
      <g :transform="yFace(3.7, S)">
        <text class="hm-engrave" font-size="0.32" x="-2.4" y="-0.17">verdikt</text>
      </g>
      <path class="hm-tunnel" :d="STATIC.tunnel" />
      <template v-for="it in frame.items" :key="`b${it.i}`">
        <Box v-if="it.back" :it="it" :part="it.back" clip="hm-clip-back" />
      </template>

      <!-- the housing's back walls, seen from inside -->
      <path v-for="(f, k) in STATIC.back" :key="`w${k}`" class="hm-wall" :d="f.d" fill-rule="evenodd" :style="{ fill: shadeWall(f.w), stroke: shadeWall(f.w) }" />

      <!-- inside: the belt runs through, a delivery waits under the press -->
      <path class="hm-floor" :d="STATIC.floor" />
      <g :transform="topPlane(BELT_Z, S)">
        <circle class="hm-pool" r="1.7" :style="{ opacity: (0.06 + frame.glow * 0.18).toFixed(3) }" />
      </g>
      <g :transform="topPlane(BELT_Z, S)" clip-path="url(#hm-clip-in)">
        <line class="hm-lane" x1="-46" y1="0" x2="46" y2="0" :style="{ strokeDashoffset: (-frame.belt).toFixed(2) }" />
      </g>
      <template v-for="it in frame.items" :key="`i${it.i}`">
        <Box v-if="it.inside" :it="it" :part="it.inside" clip="hm-clip-in" />
      </template>
      <!-- the scan: a line of light reads the delivery against its checks -->
      <g v-if="frame.scan >= 0" :transform="topPlane(frame.stationTop + 0.005, S)">
        <line class="hm-scan" :x1="(-HALF + 2 * HALF * frame.scan).toFixed(3)" y1="-0.9" :x2="(-HALF + 2 * HALF * frame.scan).toFixed(3)" y2="0.9" />
      </g>
      <!-- the press: rod, head, ink plate; the V on its back lights up as the checks pass -->
      <Solid :s="frame.press.rod" />
      <Solid :s="frame.press.ink" />
      <Solid :s="frame.press.head" />
      <g :transform="topPlane(frame.press.top, S)">
        <g transform="translate(-0.42 -0.42) scale(0.0105)">
          <path v-for="(d, k) in MARK" :key="k" class="hm-piece" :class="{ 'is-lit': k < frame.lit }" :d="d" />
        </g>
      </g>

      <!-- the front: glass you can see the work through, the frame, the cap -->
      <g :transform="`translate(0 ${frame.shake.toFixed(2)})`">
        <path class="hm-glass" :d="STATIC.glass" fill-rule="evenodd" :style="{ fill: glassFill }" />
        <path class="hm-hairline" :d="STATIC.edges" />
        <g :transform="yFace(HOUSING, S)">
          <path class="hm-sheen" d="M-1.9,-0.62 L-1.35,-0.62 L-0.35,-2.62 L-0.9,-2.62 Z M-1.05,-0.62 L-0.85,-0.62 L0.15,-2.62 L-0.05,-2.62 Z" />
        </g>
        <Solid :s="STATIC.cap" />
        <path v-for="(f, k) in STATIC.capInner" :key="`c${k}`" class="hm-wall" :d="f.d" :style="{ fill: shadeWall(f.w), stroke: shadeWall(f.w) }" />
        <Solid :s="STATIC.bar" />
        <g :transform="topPlane(CAP_Z, S)">
          <g v-for="b in BOLTS" :key="b.join()" :transform="`translate(${b[0]} ${b[1]})`">
            <circle class="hm-bolt-sink" r="0.2" />
            <circle class="hm-bolt" r="0.13" />
            <path class="hm-bolt-slot" d="M-0.075,0 h0.15 M0,-0.075 v0.15" />
          </g>
        </g>
        <g :transform="xFace(CAP_HALF, S)">
          <rect class="hm-bar-track" x="-1.3" y="-2.92" width="2.6" height="0.12" rx="0.06" />
          <rect class="hm-bar" x="-1.3" y="-2.92" :width="(2.6 * frame.glow).toFixed(3)" height="0.12" rx="0.06" />
        </g>
      </g>

      <!-- verdicts, out of the slot -->
      <template v-for="it in frame.items" :key="`f${it.i}`">
        <Box v-if="it.front" :it="it" :part="it.front" clip="hm-clip-front" />
      </template>

      <!-- the panel: checks passed on the dial, the three ways a check is settled, a status light -->
      <Solid :s="STATIC.panel" />
      <g :transform="topPlane(PANEL_Z, S)">
        <path class="hm-plate" d="M-2.75,4.62 h1.62 a0.12,0.12 0 0 1 0.12,0.12 v1.92 a0.12,0.12 0 0 1 -0.12,0.12 h-1.62 a0.12,0.12 0 0 1 -0.12,-0.12 v-1.92 a0.12,0.12 0 0 1 0.12,-0.12 Z" />
        <path class="hm-tick" :d="DIAL_TICKS" />
        <path class="hm-dial" :d="DIAL" />
        <path class="hm-dial is-on" :class="{ 'is-short': frame.short }" :d="DIAL" pathLength="1" :style="{ strokeDasharray: `${frame.dial.toFixed(3)} 1` }" />
        <line class="hm-needle" :x1="DIAL_C[0]" :y1="DIAL_C[1]" :x2="frame.needle[0]" :y2="frame.needle[1]" />
        <circle class="hm-hub" :cx="DIAL_C[0]" :cy="DIAL_C[1]" r="0.07" />
        <text class="hm-value" :class="{ 'is-met': frame.met, 'is-short': frame.short }" font-size="0.36" :x="DIAL_C[0]" :y="DIAL_C[1] + 0.48">{{ frame.reading }}</text>
        <text class="hm-label hm-label--dark" font-size="0.17" :x="DIAL_C[0]" :y="DIAL_C[1] + 0.76">checks</text>
        <g v-for="(v, k) in frame.sliders" :key="k">
          <text class="hm-label hm-label--start" font-size="0.15" x="-0.75" :y="4.92 + k * 0.62">{{ SLIDERS[k] }}</text>
          <rect class="hm-track" x="-0.75" :y="5.02 + k * 0.62" width="2.0" height="0.1" rx="0.05" />
          <rect class="hm-track is-on" x="-0.75" :y="5.02 + k * 0.62" :width="(2.0 * v).toFixed(3)" height="0.1" rx="0.05" />
          <circle class="hm-knob" :cx="(-0.75 + 2.0 * v).toFixed(3)" :cy="5.07 + k * 0.62" r="0.13" />
        </g>
        <circle class="hm-led" :class="{ 'is-on': frame.glow > 0.02 }" cx="1.38" cy="4.7" r="0.07" />
      </g>
    </svg>
  </figure>
</template>

<script setup>
/**
 * The hero, after the Aeon landing's in/out machine: Verdikt in one picture. Deliveries of every
 * kind Verdikt checks (a live site, a repo, design files, copy, a receipt) ride a belt into a glass
 * press. The belt indexes: it moves one station and stops. Under the press the delivery is scanned
 * against its signed checks (the mark on the press lights up, the dial counts checks passed, the three
 * ways a check is settled fill), then the press comes down and stamps the verdict. It leaves with a
 * cobalt chip and the amount paid, or, one time in four when a check fails, a grey one: held.
 *
 * Runs by itself on a clock, not on scroll: one rAF loop, only while it's on screen; under reduced
 * motion it holds one still frame. Light materials on the page's paper, cobalt the only signal.
 * Drawn as SVG line art with isoKit.js (ported from Aeon, as is the stamp's sound).
 */
import { computed, h, onBeforeUnmount, onMounted, ref } from 'vue'
import { Globe, GitBranch, PenTool, FileText, ReceiptText, Check, X } from 'lucide-vue-next'
import { facets, footprint, iso, poly, solid, topPlane, xFace, yFace } from './isoKit.js'
import { clamp, easeInOut, easeOut } from './landingMath.js'
import { playStamp } from './machineSound.js'
import { MARK as MARK_PATHS } from '@/components/markPaths'

const S = 10 // px per world unit
const VIEWBOX = '-104 -80 208 156'
const BELT_Z = 0.6
const WALL_Z = 2.7 // top of the glass walls
const CAP_Z = 3.0
const CAP_HALF = 3.05
const PANEL_Z = 0.45
const HALF = 0.9 // half an item's footprint
const ITEM_H = 1.0

/* the belt indexes: MOVE seconds to advance one station (GAP), then HOLD seconds stopped while the
   delivery under the press is scanned (until SCAN) and stamped (the press lands at IMPACT) */
const GAP = 6.3
const MOVE = 1.5
const HOLD = 2.7
const CYCLE = MOVE + HOLD
const SCAN = 1.5
const DROP = 0.28
const IMPACT = SCAN + DROP
const DWELL = 0.17
const LIFT = 0.45
const STILL_T = CYCLE * 3 + MOVE + IMPACT + 0.5

const IN = [
  { ext: 'site', icon: Globe },
  { ext: 'repo', icon: GitBranch },
  { ext: 'design', icon: PenTool },
  { ext: 'copy', icon: FileText },
  { ext: 'receipt', icon: ReceiptText },
]
const AMOUNTS = ['$600', '$1,200', '$350', '$480', '$90']
const SLIDERS = ['probes', 'vision', 'repo']
const mod = (i, n) => ((i % n) + n) % n
/* what each delivery comes to: its checks, how many pass, the amount it releases */
const outcome = (i) => {
  const total = 4 + mod(i, 2)
  const fail = mod(i, 4) === 3
  return { total, passed: fail ? total - 1 : total, fail, amount: AMOUNTS[mod(i, AMOUNTS.length)] }
}

const FACE = { top: 'var(--m-top)', left: 'var(--m-left)', right: 'var(--m-right)' }
const BELT = { top: 'var(--m-belt-top)', left: 'var(--m-belt-left)', right: 'var(--m-belt-right)' }
const ITEM = { top: 'var(--m-item-top)', left: 'var(--m-item-left)', right: 'var(--m-item-right)' }
const INK = { top: 'var(--m-signal)', left: 'var(--m-signal)', right: 'var(--m-signal-ink)' }

/* the Verdikt mark engraved on the press (viewBox 80): the work lights first, then the money */
const MARK = [MARK_PATHS.work, MARK_PATHS.pay]

/* one box: its shaded side facets, the top face, the ink lines */
const Solid = (props) => [
  ...props.s.sides.map((side) => h('path', { d: side.d, style: { fill: side.fill, stroke: side.fill, strokeWidth: 0.6 } })),
  h('path', { d: props.s.top, 'fill-rule': 'evenodd', style: { fill: props.s.topFill, stroke: 'var(--m-line)', strokeWidth: 1, strokeLinejoin: 'round' }, 'vector-effect': 'non-scaling-stroke' }),
  h('path', { d: props.s.lines, style: { fill: 'none', stroke: 'var(--m-line)', strokeWidth: 1, strokeLinecap: 'round' }, 'vector-effect': 'non-scaling-stroke' }),
]
Solid.props = ['s']

/* a Lucide mark, size × size, centred on (x, y) */
const Glyph = (props) => h(props.icon, {
  x: props.x - props.size / 2, y: props.y - props.size / 2, width: props.size, height: props.size,
  size: props.size, strokeWidth: 2, class: 'hm-glyph',
})
Glyph.props = ['icon', 'x', 'y', 'size']

/* a delivery on the belt (one part of it: outside, inside or out of the slot) with its label on top */
const Box = (props) => {
  const { it, part } = props
  const label = it.out
    ? [
        h('rect', { class: ['hm-chip', it.result.fail && 'is-held'], x: -0.68, y: -0.68, width: 1.36, height: 1.36, rx: 0.18 }),
        h(Glyph, { icon: it.result.fail ? X : Check, x: 0, y: -0.14, size: 0.58 }),
        h('text', { class: 'hm-tag', 'font-size': 0.21, x: 0, y: 0.48 }, it.result.fail ? 'held' : it.result.amount),
      ]
    : [
        h(Glyph, { icon: it.type.icon, x: 0, y: -0.16, size: 0.62 }),
        h('text', { class: 'hm-ext', 'font-size': 0.24, x: 0, y: 0.5 }, it.type.ext),
      ]
  if (it.ripple > 0) {
    const r = 0.68 + (1 - it.ripple) * 0.7
    label.push(h('rect', { class: 'hm-ripple', x: -r, y: -r, width: 2 * r, height: 2 * r, rx: 0.2 + (1 - it.ripple) * 0.3, style: { opacity: it.ripple } }))
  }
  return [
    h(Solid, { s: part }),
    h('g', { transform: topPlane(it.z, S), 'clip-path': `url(#${props.clip})` }, [
      h('g', { class: it.out ? 'is-out' : 'is-in', transform: `translate(${it.x.toFixed(3)} 0)` }, label),
    ]),
  ]
}
Box.props = ['it', 'part', 'clip']

const line = (a, b) => {
  const p = iso(...a, S)
  const q = iso(...b, S)
  return `M${p[0].toFixed(2)},${p[1].toFixed(2)}L${q[0].toFixed(2)},${q[1].toFixed(2)}`
}
const opening = (x) => [[x, -1.25, BELT_Z], [x, 1.25, BELT_Z], [x, 1.25, 2.05], [x, -1.25, 2.05]]
/* the housing: one rounded glass box. Its back walls are seen from inside (the intake cut into the
   flat −x wall), its front walls are glass (the exit cut into the flat +x wall). */
const HOUSING = 2.95
const HOUSING_R = 0.8
const housing = (side) => facets(-HOUSING, -HOUSING, HOUSING, HOUSING, HOUSING_R, BELT_Z, WALL_Z, S, side)
const cutFlat = (list, nx, hole) =>
  list.map((f) => (Math.abs(f.nx - nx) < 1e-6 && Math.abs(f.ny) < 1e-6 ? { ...f, d: f.d + poly(hole, S) } : f))
const front = cutFlat(housing('front'), 1, opening(HOUSING))
const STATIC = {
  guides:
    line([-46, -2.1, 0], [-4.4, -2.1, 0]) + line([4.4, -2.1, 0], [46, -2.1, 0]) +
    line([-46, 2.1, 0], [-4.4, 2.1, 0]) + line([4.4, 2.1, 0], [46, 2.1, 0]) +
    footprint(-4.25, -4.25, 4.25, 4.25, 0.8, 0, S) +
    footprint(-3.3, 4.1, 1.95, 7.3, 0.5, 0, S),
  belt: solid({ x0: -46, y0: -1.4, x1: 46, y1: 1.4, z0: 0, z1: BELT_Z }, S, BELT),
  plinth: solid({ x0: -3.7, y0: -3.7, x1: 3.7, y1: 3.7, z0: 0, z1: BELT_Z, r: 1.0 }, S, FACE),
  back: cutFlat(housing('back'), -1, opening(-HOUSING)),
  floor: poly([[-HOUSING, -1.4, BELT_Z + 0.002], [HOUSING, -1.4, BELT_Z + 0.002], [HOUSING, 1.4, BELT_Z + 0.002], [-HOUSING, 1.4, BELT_Z + 0.002]], S),
  glass: front.map((f) => f.d).join(''),
  edges: footprint(-HOUSING, -HOUSING, HOUSING, HOUSING, HOUSING_R, BELT_Z, S) + poly(opening(HOUSING), S),
  tunnel: poly(opening(-HOUSING), S),
  cap: solid({ x0: -CAP_HALF, y0: -CAP_HALF, x1: CAP_HALF, y1: CAP_HALF, z0: WALL_Z, z1: CAP_Z, r: 0.95, hole: [-2.3, -2.3, 2.3, 2.3, 0.6] }, S, FACE),
  capInner: facets(-2.3, -2.3, 2.3, 2.3, 0.6, WALL_Z, CAP_Z, S, 'back'),
  bar: solid({ x0: -0.2, y0: -2.3, x1: 0.2, y1: 2.3, z0: 2.66, z1: 2.9, r: 0.08 }, S, FACE),
  panel: solid({ x0: -2.95, y0: 4.45, x1: 1.6, y1: 6.95, z0: 0, z1: PANEL_Z, r: 0.32 }, S, FACE),
}
const BOLTS = [[2.52, 2.52], [-2.52, 2.52], [2.52, -2.52], [-2.52, -2.52]]

const DIAL_C = [-1.94, 5.45]
const DIAL_R = 0.56
const DIAL = `M${DIAL_C[0] - DIAL_R},${DIAL_C[1]} A${DIAL_R},${DIAL_R} 0 0 1 ${DIAL_C[0] + DIAL_R},${DIAL_C[1]}`
const DIAL_TICKS = Array.from({ length: 6 }, (_, k) => {
  const a = Math.PI * (1 + k / 5)
  const p = (r) => `${(DIAL_C[0] + Math.cos(a) * r).toFixed(3)},${(DIAL_C[1] + Math.sin(a) * r).toFixed(3)}`
  return `M${p(DIAL_R + 0.12)}L${p(DIAL_R + 0.2)}`
}).join('')
const seeded = (i, salt = 1) => { const x = Math.sin((i + 1) * 12.9898 * salt + salt * 78.233) * 43758.5453; return x - Math.floor(x) }
const lerp = (a, b, t) => a + (b - a) * t

/* a delivery from x0 to x1 (cut flat where it crosses a wall) */
function part(x0, x1, z1, cutLeft, cutRight) {
  const r = [0.24, 0.24, 0.24, 0.24]
  if (cutRight) r[0] = r[1] = 0
  if (cutLeft) r[2] = r[3] = 0
  return solid({ x0, y0: -HALF, x1, y1: HALF, z0: BELT_Z, z1, r }, S, ITEM)
}
function press(bottom) {
  return {
    rod: solid({ x0: -0.1, y0: -0.1, x1: 0.1, y1: 0.1, z0: bottom + 0.44, z1: 2.66 }, S, FACE),
    ink: solid({ x0: -0.64, y0: -0.64, x1: 0.64, y1: 0.64, z0: bottom, z1: bottom + 0.08, r: 0.12 }, S, INK),
    head: solid({ x0: -0.66, y0: -0.66, x1: 0.66, y1: 0.66, z0: bottom + 0.08, z1: bottom + 0.44, r: 0.14 }, S, FACE),
    top: bottom + 0.44,
  }
}

const el = ref(null)
const reduced = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches
const clock = ref(STILL_T)

const frame = computed(() => {
  const t = reduced ? STILL_T : clock.value
  const n = Math.floor(t / CYCLE)
  const ph = t - n * CYCLE
  const moving = ph < MOVE
  const e = moving ? easeInOut(ph / MOVE) : 1
  const hold = moving ? -1 : ph - MOVE
  const belt = (n + e) * GAP

  /* the press: up while the belt moves and through the scan, slams down, dwells, lifts */
  const scan = hold < 0 ? 0 : clamp(hold / SCAN, 0, 1)
  let down = 0
  if (hold >= SCAN && hold < IMPACT) down = ((hold - SCAN) / DROP) ** 2
  else if (hold >= IMPACT && hold < IMPACT + DWELL) down = 1
  else if (hold >= IMPACT + DWELL) down = 1 - easeOut(clamp((hold - IMPACT - DWELL) / LIFT, 0, 1))
  const stamped = hold >= IMPACT
  const flash = stamped ? Math.max(0, 1 - (hold - IMPACT) / 0.4) : 0

  const items = []
  let stationTop = BELT_Z + ITEM_H
  for (let i = n - 6; i <= n + 8; i++) {
    const x = belt - i * GAP
    if (Math.abs(x) > 44) continue
    const atStation = !moving && i === n + 1
    const out = i <= n || (atStation && stamped)
    const z = BELT_Z + ITEM_H * (atStation && stamped ? 1 - 0.12 * flash : 1)
    if (atStation) stationTop = z
    const x0 = x - HALF
    const x1 = x + HALF
    items.push({
      i, x, z, out,
      ripple: atStation ? flash : 0,
      type: IN[mod(i, IN.length)],
      result: outcome(i),
      back: x0 < -3 ? part(x0, Math.min(x1, -3), z, false, x1 > -3) : null,
      inside: x1 > -3 && x0 < 3 ? part(Math.max(x0, -3), Math.min(x1, 3), z, x0 < -3, x1 > 3) : null,
      front: x1 > 3 ? part(Math.max(x0, 3), x1, z, x0 < 3, false) : null,
    })
  }
  items.sort((a, b) => a.x - b.x)

  /* the dial reads the delivery under the press, or the one just stamped while the belt moves */
  const glow = moving ? 1 - e : scan
  const proc = easeInOut(moving ? 1 : scan)
  const now = outcome(moving ? n : n + 1)
  const frac = (proc * now.passed) / now.total
  const angle = Math.PI * (1 + frac)
  const seed = moving ? n : n + 1
  const bottom = lerp(2.1, stationTop, down)
  return {
    belt, items, glow, stationTop, flash,
    lit: glow * MARK.length,
    scan: !moving && hold < SCAN ? scan : -1,
    shake: flash > 0.6 ? (flash - 0.6) * 1.6 : 0,
    press: press(bottom),
    dial: frac,
    needle: [DIAL_C[0] + Math.cos(angle) * DIAL_R * 0.86, DIAL_C[1] + Math.sin(angle) * DIAL_R * 0.86],
    reading: `${Math.round(proc * now.passed)}/${now.total}`,
    met: proc >= 1 && !now.fail,
    short: proc >= 1 && now.fail,
    sliders: [0, 1, 2].map((k) => lerp(0.15 + seeded(seed, k + 3) * 0.15, 0.55 + seeded(seed, k + 9) * 0.45, easeInOut(clamp(proc * 1.4 - k * 0.15, 0, 1)))),
  }
})
/* inner walls: the one facing right a shade lighter than the back wall */
const shadeWall = (w) => `color-mix(in srgb, var(--m-wall-lit) ${Math.round(w * 100)}%, var(--m-wall))`
/* the glass catches the flash of each stamp */
const glassFill = computed(() => `color-mix(in srgb, var(--m-signal) ${Math.round(frame.value.flash * 16)}%, var(--m-glass))`)

/* the clock runs only while the machine is on screen (and never under reduced motion) */
let raf = 0
let last = 0
let visible = false
let observer = null
const impactOf = (t) => Math.floor(t / CYCLE) * CYCLE + MOVE + IMPACT
function tick(now) {
  raf = 0
  if (!visible || reduced) return
  if (last) {
    const before = clock.value
    clock.value += Math.min(0.1, (now - last) / 1000)
    const hitAt = impactOf(clock.value)
    if (before < hitAt && clock.value >= hitAt) playStamp()
  }
  last = now
  raf = requestAnimationFrame(tick)
}
onMounted(() => {
  observer = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting
    last = 0
    if (visible && !raf) raf = requestAnimationFrame(tick)
  })
  observer.observe(el.value)
})
onBeforeUnmount(() => {
  observer?.disconnect()
  cancelAnimationFrame(raf)
})
defineExpose({ el })
</script>

<style scoped>
.hm {
  /* light materials on the page's paper: white tops, faces shaded cool grey, ink hairlines; cobalt the one signal */
  --m-line: color-mix(in srgb, var(--vk-ink) 34%, transparent);
  --m-faint: color-mix(in srgb, var(--vk-ink) 13%, transparent);
  --m-glass: rgba(214, 224, 250, .32);
  --m-top: #FFFFFF; --m-left: #ECEFF4; --m-right: #D8DDE6;
  --m-belt-top: #E7EAF0; --m-belt-left: #D3D8E1; --m-belt-right: #C1C7D2;
  --m-item-top: #FFFFFF; --m-item-left: #F0F2F6; --m-item-right: #DCE0E8;
  --m-wall: #E3E7EE; --m-wall-lit: #F2F4F8;
  --m-signal: var(--vk-accent); --m-signal-ink: #1E3FB8;
  --m-screen: #0E1424;
  position: relative; margin: 0;
}
.hm__art { display: block; width: 100%; height: auto; overflow: visible; }

.hm-dash { fill: none; stroke: var(--m-faint); stroke-width: 1; stroke-dasharray: 3 4; vector-effect: non-scaling-stroke; }
.hm-lane { stroke: color-mix(in srgb, var(--vk-ink) 22%, transparent); stroke-width: 0.14; stroke-dasharray: 0.5 1.6; stroke-linecap: round; }
.hm-engrave { font-family: var(--vk-font); letter-spacing: -0.02em; fill: var(--m-line); }
.hm-wall { stroke-width: 1; vector-effect: non-scaling-stroke; }
.hm-sheen { fill: rgba(255, 255, 255, .55); }
.hm-floor, .hm-tunnel { fill: #D9DEE7; }
.hm-pool { fill: var(--m-signal); }
.hm-scan { stroke: var(--m-signal); stroke-width: 0.07; stroke-linecap: round; }
.hm-glass { stroke: none; }
.hm-hairline { fill: none; stroke: var(--m-line); stroke-width: 1; vector-effect: non-scaling-stroke; }
.hm-bolt-sink { fill: #E3E7EE; stroke: var(--m-faint); stroke-width: 0.02; }
.hm-bolt { fill: #FFFFFF; stroke: var(--m-line); stroke-width: 0.02; }
.hm-bolt-slot { stroke: color-mix(in srgb, var(--vk-ink) 45%, transparent); stroke-width: 0.03; stroke-linecap: round; }
.hm-piece { fill: color-mix(in srgb, var(--vk-ink) 16%, transparent); transition: fill .3s cubic-bezier(.16, 1, .3, 1); }
.hm-piece.is-lit { fill: var(--m-signal); }
.hm-bar-track { fill: var(--m-faint); }
.hm-bar { fill: var(--m-signal); }
/* the dial sits on a small dark screen */
.hm-plate { fill: var(--m-screen); stroke: var(--m-line); stroke-width: 0.02; }
.hm-tick { stroke: rgba(255, 255, 255, .28); stroke-width: 0.03; stroke-linecap: round; }
.hm-dial { fill: none; stroke: rgba(255, 255, 255, .16); stroke-width: 0.1; stroke-linecap: round; }
.hm-dial.is-on { stroke: #7C97FF; }
.hm-dial.is-short { stroke: #F87171; }
.hm-needle { stroke: #FFFFFF; stroke-width: 0.04; stroke-linecap: round; }
.hm-hub { fill: #FFFFFF; }
.hm-value { font-family: var(--vk-mono); fill: #FFFFFF; text-anchor: middle; }
.hm-value.is-met { fill: #9DB2FF; }
.hm-value.is-short { fill: #FCA5A5; }
.hm-label { font-family: var(--vk-mono); fill: var(--vk-faint); text-anchor: middle; }
.hm-label--dark { fill: rgba(255, 255, 255, .55); }
.hm-label--start { text-anchor: start; }
.hm-track { fill: var(--m-faint); }
.hm-track.is-on { fill: color-mix(in srgb, var(--m-signal) 75%, transparent); }
.hm-knob { fill: #FFFFFF; stroke: var(--m-line); stroke-width: 0.03; }
.hm-led { fill: var(--m-faint); }
.hm-led.is-on { fill: var(--m-signal); }
</style>

<style>
/* the boxes' labels are drawn by render functions (Box, Glyph), which scoped styles don't reach */
.hm .hm-glyph { color: var(--vk-ink); fill: none; }
.hm .is-out .hm-glyph { color: #FFFFFF; }
.hm .hm-ext { font-family: var(--vk-mono); fill: var(--vk-muted); text-anchor: middle; }
.hm .hm-chip { fill: var(--vk-accent); }
.hm .hm-chip.is-held { fill: #8A93A6; }
.hm .hm-tag { font-family: var(--vk-mono); fill: #FFFFFF; text-anchor: middle; }
.hm .hm-ripple { fill: none; stroke: var(--vk-accent); stroke-width: 0.06; }
</style>
