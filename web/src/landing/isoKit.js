// Ported from the Aeon landing page (src/components/landing/isoKit.js).
/**
 * A small isometric drawing kit for SVG line art: world units (x, y on the floor, z up) projected
 * at 30°, rounded boxes extruded with faceted shading, and the SVG matrices that lay flat
 * things (labels, dials, the mark) onto a box's top or side faces.
 *
 * Seen from the front: +x runs down to the right, +y down to the left, so the faces you see are
 * the top, the +y face (on the left) and the +x face (on the right).
 */
export const COS30 = Math.cos(Math.PI / 6)

export const iso = (x, y, z, S = 1) => [(x - y) * COS30 * S, ((x + y) * 0.5 - z) * S]

const f = (n) => (Math.abs(n) < 1e-9 ? 0 : n).toFixed(2)
const pt = (p) => `${f(p[0])},${f(p[1])}`

/** SVG matrix for the floor-parallel plane at height z: plane (u, v) = world (x, y) */
export const topPlane = (z, S = 1) =>
  `matrix(${f(COS30 * S)} ${f(0.5 * S)} ${f(-COS30 * S)} ${f(0.5 * S)} 0 ${f(-z * S)})`
/** The right-hand face at x: plane u runs along -y (left to right on screen), plane v down (-z) */
export const xFace = (x, S = 1) =>
  `matrix(${f(COS30 * S)} ${f(-0.5 * S)} 0 ${f(S)} ${f(x * COS30 * S)} ${f(x * 0.5 * S)})`
/** The left-hand face at y: plane u runs along x, plane v down (-z) */
export const yFace = (y, S = 1) =>
  `matrix(${f(COS30 * S)} ${f(0.5 * S)} 0 ${f(S)} ${f(-y * COS30 * S)} ${f(y * 0.5 * S)})`

/**
 * The outline of a rounded rectangle on the floor plane, counter-clockwise from the (x1, y0)
 * corner. r is one radius or four, for the corners (x1,y0), (x1,y1), (x0,y1), (x0,y0).
 */
export function outline(x0, y0, x1, y1, r = 0, seg = 6) {
  const radii = Array.isArray(r) ? r : [r, r, r, r]
  const max = Math.min(x1 - x0, y1 - y0) / 2
  const corners = [
    [x1, y0, -1, 1, -90],
    [x1, y1, -1, -1, 0],
    [x0, y1, 1, -1, 90],
    [x0, y0, 1, 1, 180]
  ]
  const pts = []
  corners.forEach(([cx, cy, sx, sy, a0], k) => {
    const rk = Math.max(0, Math.min(radii[k], max))
    if (rk === 0) return pts.push([cx, cy])
    const ox = cx + sx * rk
    const oy = cy + sy * rk
    for (let i = 0; i <= seg; i++) {
        const a = ((a0 + (90 * i) / seg) * Math.PI) / 180
        pts.push([ox + rk * Math.cos(a), oy + rk * Math.sin(a)])
    }
  })
  return pts
}

/**
 * A rounded box from z0 to z1, ready to draw: the side facets you can see, each with its shade
 * (a mix between the left and right face colours by which way it faces), the top face, and the
 * ink lines (the visible bottom edge and the two vertical silhouette edges).
 */
export function solid({ x0, y0, x1, y1, z0, z1, r = 0, hole = null }, S, shade) {
  const pts = outline(x0, y0, x1, y1, r)
  const n = pts.length
  const sides = []
  let rim = ''
  for (let k = 0; k < n; k++) {
    const p = pts[k]
    const q = pts[(k + 1) % n]
    const dx = q[0] - p[0]
    const dy = q[1] - p[1]
    const len = Math.hypot(dx, dy)
    if (len < 1e-9) continue
    const nx = dy / len
    const ny = -dx / len
    if (nx + ny <= 1e-6) continue
    const w = Math.min(1, Math.max(0, Math.atan2(ny, nx) / (Math.PI / 2)))
    const a = iso(p[0], p[1], z0, S)
    const b = iso(q[0], q[1], z0, S)
    const c = iso(q[0], q[1], z1, S)
    const d = iso(p[0], p[1], z1, S)
    sides.push({
        d: `M${pt(a)}L${pt(b)}L${pt(c)}L${pt(d)}Z`,
        fill: `color-mix(in srgb, ${shade.left} ${Math.round(w * 100)}%, ${shade.right})`
    })
    rim += `M${pt(a)}L${pt(b)}`
  }
  /* silhouettes: the outline points furthest left and right on screen */
  let lo = pts[0]
  let hi = pts[0]
  for (const p of pts) {
    if (p[0] - p[1] < lo[0] - lo[1]) lo = p
    if (p[0] - p[1] > hi[0] - hi[1]) hi = p
  }
  const sil = [lo, hi].map((p) => `M${pt(iso(p[0], p[1], z0, S))}L${pt(iso(p[0], p[1], z1, S))}`).join('')
  let top = `M${pts.map((p) => pt(iso(p[0], p[1], z1, S))).join('L')}Z`
  /* a hollow top (a frame round an opening): draw it with fill-rule evenodd */
  if (hole) top += footprint(...hole, z1, S)
  return { sides, top, topFill: shade.top, lines: rim + sil }
}

/** A flat polygon through world points [x, y, z] */
export const poly = (points, S) => `M${points.map((p) => pt(iso(p[0], p[1], p[2], S))).join('L')}Z`

/** The same outline flat on the floor (for dashed footprints) */
export function footprint(x0, y0, x1, y1, r, z, S) {
  return `M${outline(x0, y0, x1, y1, r).map((p) => pt(iso(p[0], p[1], z, S))).join('L')}Z`
}

/**
 * The upright walls of a rounded box, facet by facet: 'front' gives the facets that face the
 * viewer, 'back' the ones facing away, which you see from inside (through glass, or down an
 * opening). Each facet has its path, its outward normal and w, how far it turns from the right-hand
 * light (0) to the left-hand light (1), for shading.
 */
export function facets(x0, y0, x1, y1, r, z0, z1, S, side = 'front') {
  const pts = outline(x0, y0, x1, y1, r)
  const out = []
  for (let k = 0; k < pts.length; k++) {
    const p = pts[k]
    const q = pts[(k + 1) % pts.length]
    const dx = q[0] - p[0]
    const dy = q[1] - p[1]
    const len = Math.hypot(dx, dy)
    if (len < 1e-9) continue
    const nx = dy / len
    const ny = -dx / len
    const facing = nx + ny
    if (side === 'front' ? facing <= 1e-6 : facing >= -1e-6) continue
    /* seen from inside, a back facet is lit by its inward side */
    const [lx, ly] = side === 'front' ? [nx, ny] : [-nx, -ny]
    const w = Math.min(1, Math.max(0, Math.atan2(ly, lx) / (Math.PI / 2)))
    out.push({ d: poly([[p[0], p[1], z0], [q[0], q[1], z0], [q[0], q[1], z1], [p[0], p[1], z1]], S), nx, ny, w })
  }
  return out
}
