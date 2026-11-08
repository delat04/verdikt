/*  ============================================================================
    The landing's WebGL stage: a near-white grid of tiles with one object on it, the Verdikt mark in 3D.
    The mark is two pieces: the white stroke is the work, the cobalt one that crosses it is the money. Through
    the story it changes with the deal. Agreed: both pieces are a cobalt line drawing that draws itself in,
    drifting together. Held: the money is there but locked, cobalt glass. Checked: a band of light runs down
    the mark's own surfaces and the work turns solid behind it. Paid: the band runs back up, green while the
    money moves, and the money turns solid behind it; then a slow glint crosses it now and then.

    The page drives it. Each frame it passes where the mark should sit (a DOM rect, so CSS owns the
    layout), how far the intro and the scroll story are, and the pointer, which carries a small light
    across the mark so its glossy faces catch it.
    ============================================================================ */

import * as THREE from 'three'
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { MARK, ACCENT } from '@/components/markPaths'

const FOV = 30, CAM_Z = 10
const DEPTH = 7, BEVEL = 0.9, BEVEL_SIZE = 0.45     // the mark's thickness and the round on its edges (mark units, of 80)
const U = 2 / 57.2                                   // world units per mark unit: the mark stands 2 units tall
const COBALT = 0x315efb, GREEN = 0x12b76a

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v))
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t) }
const lerp = (a, b, t) => a + (b - a) * t
const bump = (a, b, v, edge = 0.04) => smooth(a, a + edge, v) * (1 - smooth(b - edge, b, v))

// ---- the paper: a near-white grid of square tiles, tinted unevenly near the mark ----------
// Each tile takes the light at its own centre, so the faint blue around the mark reads as pixels;
// a few tiles split into four, some brighten on their own slow clocks, and the grid fades out
// away from the mark. It drifts slower than the page. Colour stays in the mark itself.
const FULLSCREEN_VERT = /* glsl */`
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`
const PAPER_FRAG = /* glsl */`
  precision highp float;
  uniform vec2 uRes; uniform float uDpr; uniform float uTime; uniform float uIntro; uniform float uScroll;
  uniform vec2 uPointer; uniform float uPointerOn; uniform vec2 uGlow; uniform float uGlowR; uniform vec4 uQuiet;

  float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float glowAt(vec2 p) { vec2 d = (p - uGlow) / uGlowR; return exp(-dot(d, d) * 1.15); }
  float quietAt(vec2 p) {
    float qx = smoothstep(uQuiet.x - 80.0, uQuiet.x + 20.0, p.x) * (1.0 - smoothstep(uQuiet.z - 20.0, uQuiet.z + 80.0, p.x));
    float qy = smoothstep(uQuiet.y - 80.0, uQuiet.y + 20.0, p.y) * (1.0 - smoothstep(uQuiet.w - 20.0, uQuiet.w + 80.0, p.y));
    return 1.0 - 0.85 * qx * qy;
  }

  void main() {
    vec2 px = gl_FragCoord.xy / uDpr;                 // css pixels, origin bottom-left
    vec2 uv = px / uRes;
    float cell = uRes.x < 700.0 ? 46.0 : 68.0;
    float drift = uScroll * 0.18;
    vec2 gp = px - vec2(0.0, drift);                  // grid space

    vec2 id = floor(gp / cell);
    vec2 f = fract(gp / cell);
    float split = step(0.8, hash(id + 17.3));         // one tile in five splits into four
    vec2 q = floor(f * 2.0);
    vec2 sid = mix(id, id * 2.0 + q + 1000.0, split);
    float size = mix(cell, cell * 0.5, split);
    vec2 sf = mix(f, fract(f * 2.0), split);
    vec2 centre = id * cell + mix(vec2(0.5 * cell), (q + 0.5) * cell * 0.5, split) + vec2(0.0, drift);

    float r = hash(sid + 3.1);
    float g = pow(glowAt(centre), 1.3);

    // its own slow clock: on, hold, off, then another random level
    float t = uTime * (0.07 + 0.11 * r) + r * 17.0;
    float epoch = floor(t), ph = fract(t);
    float lit = step(0.72, hash(sid + epoch * 1.37)) * (0.35 + 0.65 * hash(sid + epoch * 2.91)) * smoothstep(0.0, 0.2, ph) * (1.0 - smoothstep(0.8, 1.0, ph));

    float fill = g * (0.1 + 0.3 * r) + (0.1 + g * 0.6) * lit * 0.45;
    vec2 dp = (centre - uPointer) / 150.0;
    fill += uPointerOn * 0.3 * exp(-dot(dp, dp)) * (0.4 + 0.6 * r);
    fill *= quietAt(centre);

    // tiles arrive outward from the mark, and the grid fades out far from it
    float dist = length((centre - uGlow) / uGlowR);
    float appear = smoothstep(0.0, 0.18, uIntro * 4.2 - dist - r * 0.9);
    float reach = 1.0 - smoothstep(0.7, 2.6, length((px - uGlow) / uGlowR));
    fill *= appear * reach;

    float edge = max(step(size - 1.0, sf.x * size), step(size - 1.0, sf.y * size));
    float hair = max(step(cell - 1.0, mod(gp.x, cell)), step(cell - 1.0, mod(gp.y, cell)));

    vec3 paper = mix(vec3(0.969, 0.973, 0.980), vec3(0.955, 0.963, 0.980), uv.y);       // #F7F8FA, a touch cooler up top
    vec3 col = mix(paper, vec3(0.905, 0.928, 1.0), glowAt(px) * 0.5);                  // the faint cool light behind the mark
    vec3 tint = mix(vec3(0.925, 0.942, 1.0), vec3(0.80, 0.85, 1.0), clamp(fill * 1.4, 0.0, 1.0));
    col = mix(col, tint, clamp(fill * 1.7, 0.0, 1.0) * (1.0 - edge * 0.5));
    float lineA = max(hair, edge * split * 0.6) * (0.26 + 0.45 * glowAt(px)) * appear * mix(0.4, 1.0, quietAt(px)) * (0.3 + 0.7 * reach);
    col = mix(col, vec3(0.80, 0.82, 0.86), lineA);

    gl_FragColor = vec4(mix(paper, col, smoothstep(0.0, 0.3, uIntro)), 1.0);
  }
`

// ---- the shine: a band of light that runs across the mark's own surfaces, and only there ---------
// Patched into the pieces' materials: the band sits along SHINE_DIR (tilted a little, like light raking across),
// at uShineY, in the mark's own space. Where it passes, the surface takes its colour; on glass it also turns
// opaque, so the band reads even where the piece is still clear.
const SHINE_DIR = new THREE.Vector2(-0.32, 0.95).normalize()
function withShine(mat, shine, glass = false) {
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, { uShineY: shine.y, uShineOn: shine.on, uShineColor: shine.color })
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vMarkPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvMarkPos = transformed;')
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vMarkPos; uniform float uShineY; uniform float uShineOn; uniform vec3 uShineColor;`)
      .replace('#include <opaque_fragment>', `
        float shineD = dot(vMarkPos.xy, vec2(${SHINE_DIR.x.toFixed(4)}, ${SHINE_DIR.y.toFixed(4)})) - uShineY;
        float shineCore = exp(-shineD * shineD / 0.0003) * 0.95 * uShineOn;    // white-hot at its centre
        float shineGlow = exp(-shineD * shineD / 0.009) * 0.62 * uShineOn;      // in its colour around it
        outgoingLight = mix(outgoingLight, uShineColor, clamp(shineGlow, 0.0, 1.0));
        outgoingLight = mix(outgoingLight, mix(uShineColor, vec3(1.0), 0.72), clamp(shineCore, 0.0, 1.0));
        ${glass ? 'diffuseColor.a = max(diffuseColor.a, clamp(shineGlow + shineCore, 0.0, 1.0));' : ''}
        #include <opaque_fragment>`)
  }
  mat.customProgramCacheKey = () => (glass ? 'vk-shine-glass' : 'vk-shine')
  return mat
}

// ---- the mark, as solid pieces ----------------------------------------------------------
/* one piece: its outline (SVG y flipped to point up), extruded with rounded edges */
function pieceShapes(d) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg"><path d="${d}" transform="scale(1 -1)"/></svg>`
  return new SVGLoader().parse(svg).paths[0].toShapes(true)
}

/* a soft shadow of one piece, drawn from its own path, for a plane behind it */
function shadowTexture(d) {
  const c = document.createElement('canvas')
  c.width = c.height = 256
  const ctx = c.getContext('2d')
  ctx.filter = 'blur(9px)'
  ctx.scale(256 / 80, 256 / 80)
  ctx.fillStyle = '#000'
  ctx.fill(new Path2D(d))
  return new THREE.CanvasTexture(c)
}

// ---- the stage -----------------------------------------------------------------------
export function createStage(canvas, { reduced = false } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
  const small = Math.min(window.innerWidth, window.innerHeight) < 700
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, small ? 1.5 : 1.75))
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.NeutralToneMapping   // keeps the cobalt cobalt
  renderer.localClippingEnabled = true
  renderer.autoClear = false
  renderer.setClearColor(0xf7f8fa, 1)

  // the paper
  const paperScene = new THREE.Scene()
  const paperCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  const paper = new THREE.ShaderMaterial({
    vertexShader: FULLSCREEN_VERT, fragmentShader: PAPER_FRAG, depthTest: false, depthWrite: false,
    uniforms: {
      uRes: { value: new THREE.Vector2(1, 1) }, uDpr: { value: 1 }, uTime: { value: 0 }, uIntro: { value: 0 }, uScroll: { value: 0 },
      uPointer: { value: new THREE.Vector2(-999, -999) }, uPointerOn: { value: reduced ? 0 : 1 },
      uGlow: { value: new THREE.Vector2(0, 0) }, uGlowR: { value: 500 }, uQuiet: { value: new THREE.Vector4(-1, -1, -1, -1) },
    },
  })
  paperScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), paper))

  // the mark's room: a soft studio for its glossy faces to reflect, a key light, and the pointer's light
  const scene = new THREE.Scene()
  const pmrem = new THREE.PMREMGenerator(renderer)
  const room = new RoomEnvironment()
  const env = pmrem.fromScene(room, 0.04).texture
  room.traverse((o) => { o.geometry?.dispose(); o.material?.dispose() })
  pmrem.dispose()
  scene.environment = env
  scene.environmentIntensity = 0.85
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 100)
  camera.position.set(0, 0, CAM_Z)
  const key = new THREE.DirectionalLight(0xffffff, 1.5)
  key.position.set(-3, 5, 6)
  const fill = new THREE.DirectionalLight(0xdfe6ff, 0.45)
  fill.position.set(5, -2, 4)
  const lamp = new THREE.PointLight(0xffffff, 0, 5, 1.4)
  scene.add(key, fill, lamp)

  const mark = new THREE.Group()
  scene.add(mark)
  const shine = { y: { value: 9 }, on: { value: 0 }, color: { value: new THREE.Color(COBALT) } }

  // both pieces' outlines, centred on the mark as a whole
  const shapes = { work: pieceShapes(MARK.work), pay: pieceShapes(MARK.pay) }
  const box = new THREE.Box2()
  for (const list of Object.values(shapes)) for (const sh of list) for (const p of sh.getPoints(8)) box.expandByPoint(p)
  const centre = box.getCenter(new THREE.Vector2())
  const capZ = (DEPTH / 2 + BEVEL) * U

  function piece(name, d, solidMat, glassColor) {
    const geo = new THREE.ExtrudeGeometry(shapes[name], { depth: DEPTH, bevelEnabled: true, bevelThickness: BEVEL, bevelSize: BEVEL_SIZE, bevelSegments: 5, curveSegments: 18 })
    geo.translate(-centre.x, -centre.y, -DEPTH / 2)
    geo.scale(U, U, U)
    geo.computeBoundingBox()

    const group = new THREE.Group()
    const solid = new THREE.Mesh(geo, withShine(solidMat, shine))
    const glass = new THREE.Mesh(geo, withShine(new THREE.MeshPhysicalMaterial({ color: glassColor, roughness: 0.06, clearcoat: 1, transparent: true, opacity: 0, depthWrite: false }), shine, true))
    glass.renderOrder = 1

    // the line drawing: the outline on both faces, just proud of them, drawn in from its first point
    const lineMat = new THREE.LineBasicMaterial({ color: COBALT, transparent: true, opacity: 0 })
    const lines = []
    for (const sh of shapes[name]) {
      const pts = sh.getPoints(18).map((p) => new THREE.Vector3((p.x - centre.x) * U, (p.y - centre.y) * U, 0))
      pts.push(pts[0].clone())
      const lineGeo = new THREE.BufferGeometry().setFromPoints(pts)
      for (const z of [capZ + 0.004, -capZ - 0.004]) {
        const line = new THREE.Line(lineGeo, lineMat)
        line.position.z = z
        line.renderOrder = 2
        lines.push(line)
      }
    }

    // its shadow on the paper behind it, from the light up and to the left
    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(80 * U, 80 * U),
      new THREE.MeshBasicMaterial({ map: shadowTexture(d), color: 0x0a1230, transparent: true, opacity: 0, depthWrite: false, toneMapped: false }),
    )
    shadow.position.set((40 - centre.x) * U + 0.1, (-40 - centre.y) * U - 0.2, -capZ - 0.55)
    shadow.renderOrder = -1

    group.add(shadow, solid, glass, ...lines)
    mark.add(group)
    return { group, solid, glass, lineMat, lines, shadow, bounds: geo.boundingBox, local: new THREE.Plane() }
  }

  const workCut = new THREE.Plane(), payCut = new THREE.Plane()
  const work = piece('work', MARK.work,
    new THREE.MeshPhysicalMaterial({ color: 0xf2f4f8, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.08, clippingPlanes: [workCut] }), 0xffffff)
  const pay = piece('pay', MARK.pay,
    // its albedo is the accent taken down, so lit it lands on the accent instead of washing out to lavender
    new THREE.MeshPhysicalMaterial({ color: new THREE.Color(ACCENT).multiplyScalar(0.42), roughness: 0.34, envMapIntensity: 0.4, clearcoat: 0.4, clearcoatRoughness: 0.16, emissive: ACCENT, emissiveIntensity: 0, clippingPlanes: [payCut] }),
    new THREE.Color(ACCENT).multiplyScalar(0.6))
  work.cut = workCut; pay.cut = payCut

  // how far the shine has to travel to cross a piece, and the whole mark
  const along = (b) => {
    const v = [[b.min.x, b.min.y], [b.max.x, b.min.y], [b.min.x, b.max.y], [b.max.x, b.max.y]].map(([x, y]) => x * SHINE_DIR.x + y * SHINE_DIR.y)
    return { lo: Math.min(...v) - 0.06, hi: Math.max(...v) + 0.06 }
  }
  work.span = along(work.bounds); pay.span = along(pay.bounds)
  const all = { lo: Math.min(work.span.lo, pay.span.lo), hi: Math.max(work.span.hi, pay.span.hi) }
  const height = Math.max(work.bounds.max.y, pay.bounds.max.y) - Math.min(work.bounds.min.y, pay.bounds.min.y)

  const view = { w: 1, h: 1, dpr: 1 }
  function resize() {
    view.w = window.innerWidth; view.h = window.innerHeight
    renderer.setSize(view.w, view.h, false)
    view.dpr = renderer.getPixelRatio()
    camera.aspect = view.w / view.h
    camera.updateProjectionMatrix()
    paper.uniforms.uRes.value.set(view.w, view.h)
    paper.uniforms.uDpr.value = view.dpr
  }
  resize()

  const pointer = { x: 0.5, y: 0.5, sx: 0.5, sy: 0.5, seen: false }
  const visH = 2 * Math.tan(THREE.MathUtils.degToRad(FOV / 2)) * CAM_Z
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), front = new THREE.Plane(new THREE.Vector3(0, 0, 1), -1.4), at = new THREE.Vector3()
  const dir3 = new THREE.Vector3(SHINE_DIR.x, SHINE_DIR.y, 0)
  let lampOn = 0

  /* a piece's cut, along the shine: keep what's ahead of the band (keepAbove) or behind it; in world space */
  function cutAt(p, y, keepAbove) {
    p.local.normal.copy(dir3).multiplyScalar(keepAbove ? 1 : -1)
    p.local.constant = keepAbove ? -y : y
    p.cut.copy(p.local).applyMatrix4(p.group.matrixWorld)
  }
  /* the piece's offset while the two are still apart */
  function apart(p, e, [x, y, z], [rx, ry, rz]) {
    p.group.position.set(x * e, y * e, z * e)
    p.group.rotation.set(rx * e, ry * e, rz * e)
  }
  /* the line drawing, drawn in to t (0–1) */
  function drawTo(p, t) {
    for (const l of p.lines) l.geometry.setDrawRange(0, Math.ceil(l.geometry.attributes.position.count * t))
  }

  /**
   * One frame. rect: where the mark sits on screen (css px); glow: where the paper's light sits (defaults to the
   * mark); quiet: the text column to keep calm; blend: 0 before the story, 1 once it has the mark; story: 0–1
   * through the four steps; intro: 0–1 the mark's arrival; paper: 0–1 the tiles' arrival; time in seconds;
   * scroll: the page's scroll in px.
   */
  function frame({ rect, glow = rect, quiet, blend, story, intro, paper: paperIn = intro, time, scroll = 0 }) {
    pointer.sx = lerp(pointer.sx, pointer.x, reduced ? 1 : 0.06)
    pointer.sy = lerp(pointer.sy, pointer.y, reduced ? 1 : 0.06)
    const s = blend > 0.6 ? story : 0

    // placement: centred in the rect, a little high to leave room for the caption under it
    const k = visH / view.h
    const cx = rect.left + rect.width / 2, cy = rect.top + rect.height * 0.46
    const rise = reduced ? 0 : (1 - smooth(0.05, 0.75, intro)) * -0.6
    const float = reduced ? 0 : Math.sin(time * 0.7) * 0.03
    mark.position.set((cx - view.w / 2) * k, -(cy - view.h / 2) * k + rise + float, 0)
    mark.scale.setScalar(Math.min(rect.height * 0.72, rect.width * 0.62) * k / height)

    // it turns to face you as the deal comes together, and follows the pointer a little
    const px = reduced ? 0 : pointer.sx - 0.5, py = reduced ? 0 : pointer.sy - 0.5
    const settle = smooth(0, 0.85, s)
    const introTurn = reduced ? 0 : (1 - smooth(0.0, 0.9, intro)) * 0.5
    mark.rotation.set(lerp(0.2, 0.05, settle) + py * 0.12 + introTurn * 0.3, lerp(-0.5, -0.04, settle) + px * 0.2 - introTurn, 0)

    // agreed: two line drawings, drawing themselves in, apart and coming together
    const e = 1 - smooth(0.0, 0.22, s)
    apart(work, e, [-0.55, -0.3, 0.25], [0.3, 0.55, -0.22])
    apart(pay, e, [0.6, 0.42, 0.55], [-0.25, -0.65, 0.28])
    mark.updateMatrixWorld(true)
    const drawn = reduced ? 1 : smooth(0.1, 0.95, intro)
    drawTo(work, drawn)
    drawTo(pay, reduced ? 1 : smooth(0.25, 1, intro))

    const show = smooth(0.08, 0.5, intro)
    const held = smooth(0.25, 0.42, s)
    const checked = smooth(0.5, 0.72, s)            // the shine runs down the mark, the work solid behind it
    const paid = smooth(0.75, 0.86, s)              // and back up, green while the money moves, the money solid behind it
    const flash = bump(0.75, 0.97, s, 0.06)

    const checkY = lerp(all.hi, all.lo, checked)
    const payY = lerp(pay.span.lo, all.hi, paid)
    cutAt(work, checkY, true)
    cutAt(pay, payY, false)
    work.solid.visible = checked > 0.001 && show > 0.01
    pay.solid.visible = paid > 0.001 && show > 0.01

    // the shine: down the mark while it's checked (cobalt), up it while it pays (green), then a slow glint now and then
    let shineY = 9, shineOn = 0
    const checking = bump(0.5, 0.74, s, 0.03), paying = bump(0.75, 0.88, s, 0.03)
    if (checking > 0) { shineY = checkY; shineOn = checking; shine.color.value.set(COBALT) }
    else if (paying > 0) { shineY = payY; shineOn = paying; shine.color.value.set(GREEN) }
    else if (s > 0.9 && !reduced) {
      const ph = (time / 6.5) % 1
      shineY = lerp(all.hi + 0.3, all.lo - 0.3, smooth(0, 0.28, ph)); shineOn = 0.55 * smooth(0.9, 0.95, s); shine.color.value.set(0xffffff)
    }
    shine.y.value = shineY
    shine.on.value = shineOn * show

    // the line drawing stays as a faint inked edge once each piece is solid; the glass holds the rest
    work.lineMat.opacity = show * lerp(0.9, 0.28, smooth(0.5, 1, checked))
    pay.lineMat.opacity = show * lerp(0.9, 0.5, held) * lerp(1, 0.4, paid)
    work.glass.material.opacity = show * (0.1 + 0.14 * held) * (1 - checked)
    const breathe = reduced ? 0 : Math.sin(time * 2.2) * 0.04 * held * (1 - paid)
    pay.glass.material.opacity = show * (0.06 + 0.24 * held + breathe) * (1 - paid)
    work.glass.visible = work.glass.material.opacity > 0.002 || shine.on.value > 0.01
    pay.glass.visible = pay.glass.material.opacity > 0.002 || shine.on.value > 0.01
    pay.solid.material.emissiveIntensity = 0.06 + 0.4 * flash
    work.shadow.material.opacity = show * (0.04 + 0.2 * checked)
    pay.shadow.material.opacity = show * (0.04 + 0.06 * held + 0.14 * paid)

    // the pointer's light, floating just in front of the mark where the pointer is
    if (pointer.seen && !reduced) {
      ndc.set(pointer.x * 2 - 1, 1 - pointer.y * 2)
      ray.setFromCamera(ndc, camera)
      if (ray.ray.intersectPlane(front, at)) lamp.position.lerp(at, 0.35)
    }
    lampOn = lerp(lampOn, pointer.seen && !reduced ? 1 : 0, 0.1)
    lamp.intensity = lampOn * show * 3.2

    // the paper: tinted from behind the mark
    paper.uniforms.uTime.value = reduced ? 0 : time
    paper.uniforms.uScroll.value = reduced ? 0 : scroll
    paper.uniforms.uIntro.value = reduced ? 1 : smooth(0, 0.85, paperIn)
    paper.uniforms.uGlow.value.set(glow.left + glow.width / 2, view.h - (glow.top + glow.height / 2))
    paper.uniforms.uGlowR.value = Math.max(glow.width * 1.1, 320)
    if (pointer.seen) paper.uniforms.uPointer.value.set(pointer.sx * view.w, view.h - pointer.sy * view.h)
    if (quiet) paper.uniforms.uQuiet.value.set(quiet.left, view.h - quiet.top - quiet.height, quiet.left + quiet.width, view.h - quiet.top)

    mark.visible = show > 0.002
    renderer.clear()
    renderer.render(paperScene, paperCam)
    renderer.render(scene, camera)
  }

  function onPointer(e) {
    if (e.pointerType === 'touch') return
    pointer.x = e.clientX / view.w; pointer.y = e.clientY / view.h; pointer.seen = true
  }
  const onLeave = (e) => { if (!e.relatedTarget) pointer.seen = false }
  window.addEventListener('pointermove', onPointer, { passive: true })
  document.addEventListener('pointerout', onLeave)
  window.addEventListener('resize', resize)

  function dispose() {
    window.removeEventListener('pointermove', onPointer)
    document.removeEventListener('pointerout', onLeave)
    window.removeEventListener('resize', resize)
    scene.traverse((o) => { o.geometry?.dispose(); o.material?.map?.dispose(); o.material?.dispose() })
    paperScene.traverse((o) => { o.geometry?.dispose(); o.material?.dispose() })
    env.dispose()
    renderer.dispose()
  }

  // compile every shader up front (in parallel where the driver allows) so the intro never stalls
  const ready = Promise.all([renderer.compileAsync(scene, camera), renderer.compileAsync(paperScene, paperCam)]).catch(() => {})

  return { frame, resize, dispose, ready }
}
