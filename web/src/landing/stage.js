/*  ============================================================================
    The landing's WebGL stage: a near-white grid of tiles with one object on it, the hold.
    The hold is a dark glass card. A line of cobalt light runs through it while
    PayPal holds the money; a scan reads down the signed checks; when the last
    one passes the line turns green and runs off the card: the money moves.

    The page drives it. Each frame it passes where the card should sit (a DOM
    rect, so CSS owns the layout), how far the intro and the scroll story are,
    and the pointer, whose arrow the glass reflects where a mirror would show
    it. Everything the card says is drawn on a 2D canvas and only redrawn when
    the story changes state.
    ============================================================================ */

import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'

const W = 3.2, H = 2.0, D = 0.14, R = 0.11            // the card, in world units
const SEAM = { x: 0.86, y: 0.22 }                      // where the two lines of light cross (face uv)
const FOV = 30, CAM_Z = 10

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v))
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t) }
const lerp = (a, b, t) => a + (b - a) * t
const bump = (a, b, v, edge = 0.04) => smooth(a, a + edge, v) * (1 - smooth(b - edge, b, v))

// ---- the paper: a near-white grid of square tiles, tinted unevenly near the card ----------
// Each tile takes the light at its own centre, so the faint blue around the card reads as pixels;
// a few tiles split into four, some brighten on their own slow clocks, and the grid fades out
// away from the card. It drifts slower than the page. Colour stays in the card itself.
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

    // tiles arrive outward from the card, and the grid fades out far from it
    float dist = length((centre - uGlow) / uGlowR);
    float appear = smoothstep(0.0, 0.18, uIntro * 4.2 - dist - r * 0.9);
    float reach = 1.0 - smoothstep(0.7, 2.6, length((px - uGlow) / uGlowR));
    fill *= appear * reach;

    float edge = max(step(size - 1.0, sf.x * size), step(size - 1.0, sf.y * size));
    float hair = max(step(cell - 1.0, mod(gp.x, cell)), step(cell - 1.0, mod(gp.y, cell)));

    vec3 paper = mix(vec3(0.969, 0.973, 0.980), vec3(0.955, 0.963, 0.980), uv.y);       // #F7F8FA, a touch cooler up top
    vec3 col = mix(paper, vec3(0.905, 0.928, 1.0), glowAt(px) * 0.5);                  // the faint cool light behind the card
    vec3 tint = mix(vec3(0.925, 0.942, 1.0), vec3(0.80, 0.85, 1.0), clamp(fill * 1.4, 0.0, 1.0));
    col = mix(col, tint, clamp(fill * 1.7, 0.0, 1.0) * (1.0 - edge * 0.5));
    float lineA = max(hair, edge * split * 0.6) * (0.26 + 0.45 * glowAt(px)) * appear * mix(0.4, 1.0, quietAt(px)) * (0.3 + 0.7 * reach);
    col = mix(col, vec3(0.80, 0.82, 0.86), lineA);

    gl_FragColor = vec4(mix(paper, col, smoothstep(0.0, 0.3, uIntro)), 1.0);
  }
`

// ---- the card's face: glass, what it says, and the light -------------------------
const FACE_VERT = /* glsl */`
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`
const FACE_FRAG = /* glsl */`
  precision highp float;
  uniform sampler2D uMap; uniform vec2 uSize; uniform float uRadius; uniform vec2 uSeamAt;
  uniform float uSeamH; uniform float uSeamV; uniform float uFlare; uniform float uGreen;
  uniform float uScan; uniform float uScanOn; uniform float uShow; uniform float uTime;
  uniform vec2 uCursor; uniform vec2 uCursor2; uniform float uCursorOn; uniform sampler2D uCursorTex; uniform vec2 uCursorSize;
  varying vec2 vUv;

  float sdRoundBox(vec2 p, vec2 b, float r) { vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
  // one line of light: a white-hot centre, a sharp core, a bloom, and the light it throws on the glass
  vec4 beam(float d) {
    float d2 = d * d;
    return vec4(exp(-d2 / 0.0000022), exp(-d2 / 0.000012), exp(-d2 / 0.0045), exp(-d2 / 0.06));
  }

  // the pointer's arrow with its tip at tip (face uv), sampled softer with blur (a mip bias)
  vec4 cursorAt(vec2 tip, vec2 p, float blur) {
    vec2 q = (p - (tip - 0.5) * uSize) / uCursorSize;
    q = vec2(q.x, -q.y) + 0.094;                       // the sprite's tip sits 12px into its 128px square
    if (q.x < 0.0 || q.y < 0.0 || q.x > 1.0 || q.y > 1.0) return vec4(0.0);
    return texture2D(uCursorTex, vec2(q.x, 1.0 - q.y), blur);
  }

  void main() {
    vec2 p = (vUv - 0.5) * uSize;
    float d = sdRoundBox(p, uSize * 0.5, uRadius);
    float aa = fwidth(d);
    float mask = 1.0 - smoothstep(-aa, aa, d);

    vec3 col = mix(vec3(0.010, 0.014, 0.030), vec3(0.040, 0.058, 0.125), smoothstep(0.0, 1.0, vUv.y * 0.75 + (1.0 - vUv.x) * 0.25));
    vec4 tex = texture2D(uMap, vUv);
    col = mix(col, tex.rgb, tex.a);

    vec3 tint = mix(vec3(0.16, 0.36, 1.0), vec3(0.20, 0.90, 0.46), uGreen);
    vec3 hot = mix(vec3(0.80, 0.90, 1.0), vec3(0.85, 1.0, 0.90), uGreen);
    vec2 s = (uSeamAt - 0.5) * uSize;

    // pulses run along both lines toward the crossing, like the money travelling to it
    float ph = fract(uTime * 0.23);
    float hPulse = exp(-pow((vUv.x - (ph * 1.25 - 0.15) * uSeamAt.x) * 7.0, 2.0));
    float vPulse = exp(-pow((vUv.y - (1.0 - (ph * 1.25 - 0.15) * (1.0 - uSeamAt.y))) * 7.0, 2.0));

    vec4 h = beam(p.y - s.y) * smoothstep(uSeamH + 0.002, uSeamH - 0.012, vUv.x);
    vec4 v = beam(p.x - s.x) * smoothstep(1.0 - uSeamV - 0.002, 1.0 - uSeamV + 0.012, vUv.y);
    float hk = 1.0 + 1.4 * hPulse, vk = 1.0 + 1.4 * vPulse;
    col += tint * (h.y * 1.5 * hk + h.z * 0.55 * hk + h.w * 0.16) + hot * h.x * 1.3 * hk;
    col += tint * (v.y * 1.5 * vk + v.z * 0.55 * vk + v.w * 0.16) + hot * v.x * 1.3 * vk;

    // where they cross: a hot point, a halo, and a star
    vec2 q = p - s;
    float qq = dot(q, q);
    float flare = exp(-qq / 0.0018) * 1.8 + exp(-qq / 0.03) * 0.4
      + exp(-q.y * q.y / 0.0001) * exp(-abs(q.x) * 1.5) * 0.75
      + exp(-q.x * q.x / 0.0001) * exp(-abs(q.y) * 2.8) * 0.45;
    col += mix(tint, hot, 0.6) * flare * uFlare;

    // the scan that reads down the checks
    float sd = vUv.y - uScan;
    float left = 1.0 - smoothstep(uSeamAt.x - 0.06, uSeamAt.x - 0.02, vUv.x);
    col += vec3(0.42, 0.58, 1.0) * uScanOn * left * (exp(-sd * sd / 0.000018) * 0.9 + exp(-sd * sd / 0.0018) * 0.10 * step(0.0, sd));

    // the pointer, reflected in the glass: its own arrow, faint and a touch soft, and a fainter, softer ghost
    // off the glass's back face (glass has two surfaces, so a real reflection doubles)
    vec4 r1 = cursorAt(uCursor, p, 0.6);
    vec4 r2 = cursorAt(uCursor2, p, 2.0);
    vec3 cool = vec3(0.86, 0.9, 1.0);
    col = mix(col, r2.rgb * cool, r2.a * 0.11 * uCursorOn);
    col = mix(col, r1.rgb * cool, r1.a * 0.32 * uCursorOn);

    // a 1px rim where the glass meets the edge
    float rim = 1.0 - smoothstep(0.0, aa * 1.6, abs(d + aa * 1.3));
    col += vec3(0.17, 0.21, 0.34) * rim;

    gl_FragColor = vec4(col, mask * uShow);
  }
`

// ---- light leaving the card along the seam (a stub while held, the payout at the end)
const BEAM_FRAG = /* glsl */`
  precision highp float;
  uniform float uLen; uniform float uHeight; uniform float uLeak; uniform float uReach; uniform float uEscape; uniform float uGreen; uniform float uShow; uniform float uTime;
  varying vec2 vUv;
  void main() {
    float y = (vUv.y - 0.5) * uHeight;
    float x = vUv.x * uLen;                                   // world units from the card's edge
    float y2 = y * y;
    float core = exp(-y2 / 0.000012), glow = exp(-y2 / 0.0045) * 0.18;
    float leak = uLeak * exp(-x / uReach);
    float run = smoothstep(uEscape * uLen + 0.01, uEscape * uLen - 0.25, x) * (1.0 - smoothstep(uLen * 0.3, uLen, x)) * step(0.001, uEscape);
    // once it's paid, packets keep running outward along the line
    float packets = 1.0 + 1.4 * exp(-pow((fract(x / 2.6 - uTime * 0.55) - 0.5) * 6.0, 2.0)) * step(0.001, uEscape);
    vec3 tint = mix(vec3(0.19, 0.37, 0.98), vec3(0.07, 0.72, 0.42), uGreen);
    gl_FragColor = vec4(tint, clamp((core * 0.95 + glow) * packets * max(leak, run) * uShow, 0.0, 1.0));
  }
`
// the card sits on the paper: a wide soft shadow and a tighter one near its edge
const SHADOW_FRAG = /* glsl */`
  precision highp float;
  uniform vec2 uSize; uniform vec2 uCard; uniform float uPower; varying vec2 vUv;
  float sdRoundBox(vec2 p, vec2 b, float r) { vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
  void main() {
    float d = max(sdRoundBox((vUv - 0.5) * uSize, uCard * 0.5, 0.14), 0.0);
    float a = exp(-d * d / 0.012) * 0.45 + exp(-d * d / 0.16) * 0.55;
    gl_FragColor = vec4(0.04, 0.07, 0.16, a * uPower);
  }
`

// ---- what the card says --------------------------------------------------------------
const CHECKS = ['Shop loads on desktop and mobile', 'Add to cart updates the total', 'No sideways scroll at 375px', 'Largest paint under 2.5 seconds']
const ROW0 = 492, ROW_GAP = 70                          // check rows on the 1600×1000 face
export const rowScanY = (i) => 1 - (ROW0 + i * ROW_GAP - 14) / 1000

const STATUS = {
  hero: ['Held by PayPal', '#9DB2FF'],
  agree: ['4 checks signed', '#A3AEC2'],
  hold: ['Held by PayPal', '#9DB2FF'],
  check: ['Checking', '#9DB2FF'],
  paid: ['Paid', '#5BEA8F'],
}
const CAPTION = {
  hero: ['held until 4 signed checks pass', '#A3AEC2'],
  agree: ['released only when these 4 checks pass', '#A3AEC2'],
  hold: ['a PayPal hold, not a charge', '#9DB2FF'],
  check: ['released when all 4 pass', '#A3AEC2'],
  paid: ['$1,764.00 sent to Sam’s PayPal', '#5BEA8F'],
}

function drawFace(ctx, { emph, passed }) {
  const c = ctx.canvas
  ctx.clearRect(0, 0, c.width, c.height)
  const sans = '"Inter Tight Variable", "Inter Tight", system-ui, sans-serif'
  const mono = '"JetBrains Mono Variable", "JetBrains Mono", ui-monospace, monospace'
  ctx.textBaseline = 'alphabetic'

  ctx.font = `400 42px ${sans}`
  ctx.fillStyle = '#A3AEC2'
  ctx.textAlign = 'left'
  ctx.fillText('Northbrew online shop', 110, 150)
  const [status, statusColor] = STATUS[emph]
  ctx.textAlign = 'right'
  ctx.fillStyle = statusColor
  ctx.fillText(emph === 'check' ? `Checking ${Math.min(4, passed + 1)} of 4` : status, 1290, 150)

  ctx.textAlign = 'left'
  ctx.font = `400 150px ${mono}`
  ctx.fillStyle = emph === 'agree' ? '#6E7A91' : '#EEF1F7'
  ctx.fillText('$1,800.00', 104, 318)
  const [caption, captionColor] = CAPTION[emph]
  ctx.font = `400 38px ${sans}`
  ctx.fillStyle = captionColor
  ctx.fillText(caption, 110, 384)

  CHECKS.forEach((text, i) => {
    const y = ROW0 + i * ROW_GAP
    const ok = i < passed
    ctx.beginPath()
    ctx.arc(128, y - 13, 17, 0, Math.PI * 2)
    if (ok) {
      ctx.fillStyle = '#3BE37A'; ctx.fill()
      ctx.strokeStyle = '#04210F'; ctx.lineWidth = 5; ctx.lineCap = 'round'; ctx.lineJoin = 'round'
      ctx.beginPath(); ctx.moveTo(119, y - 13); ctx.lineTo(126, y - 6); ctx.lineTo(138, y - 20); ctx.stroke()
    } else {
      ctx.strokeStyle = emph === 'agree' ? '#7C8AA8' : '#3C4760'; ctx.lineWidth = 3; ctx.stroke()
    }
    ctx.font = `400 38px ${sans}`
    ctx.fillStyle = ok || emph === 'agree' ? '#EEF1F7' : '#C2CADA'
    ctx.fillText(text, 172, y)
  })

  ctx.font = `400 34px ${mono}`
  ctx.fillStyle = '#6E7A91'
  ctx.textAlign = 'center'
  ctx.fillText('M2', 1488, 150)
}

// ---- the stage -----------------------------------------------------------------------
export function createStage(canvas, { reduced = false } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
  const small = Math.min(window.innerWidth, window.innerHeight) < 700
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, small ? 1.5 : 1.75))
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
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

  // the card
  const scene = new THREE.Scene()
  scene.add(new THREE.HemisphereLight(0xe4eaff, 0x0a0f1e, 1.3))
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 100)
  camera.position.set(0, 0, CAM_Z)

  const card = new THREE.Group()
  scene.add(card)

  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(W * 1.9, H * 2.1),
    new THREE.ShaderMaterial({
      vertexShader: FACE_VERT, fragmentShader: SHADOW_FRAG, transparent: true, depthWrite: false,
      uniforms: { uSize: { value: new THREE.Vector2(W * 1.9, H * 2.1) }, uCard: { value: new THREE.Vector2(W * 0.97, H * 0.95) }, uPower: { value: 0 } },
    }),
  )
  shadow.position.set(0.06, -0.3, -0.55)
  card.add(shadow)

  const body = new THREE.Mesh(
    new RoundedBoxGeometry(W, H, D, 6, R),
    new THREE.MeshStandardMaterial({ color: 0x0b1326, metalness: 0.2, roughness: 0.38, transparent: true }),
  )
  card.add(body)

  // the pointer as glass would show it: the usual arrow, white with a dark edge, already a touch soft
  const cursorCanvas = document.createElement('canvas')
  cursorCanvas.width = cursorCanvas.height = 128
  const cc = cursorCanvas.getContext('2d')
  cc.filter = 'blur(1px)'
  cc.translate(12, 12)
  cc.scale(4, 4)
  cc.beginPath()
  const ARROW = [[0, 0], [0, 17.5], [4.1, 13.6], [6.9, 20], [9.6, 18.9], [6.9, 12.6], [12.4, 12.6]]
  ARROW.forEach(([x, y], i) => (i ? cc.lineTo(x, y) : cc.moveTo(x, y)))
  cc.closePath()
  cc.fillStyle = '#ffffff'
  cc.fill()
  cc.lineJoin = 'round'
  cc.lineWidth = 1.1
  cc.strokeStyle = 'rgba(8, 12, 26, .85)'
  cc.stroke()
  const cursorTex = new THREE.CanvasTexture(cursorCanvas)
  cursorTex.generateMipmaps = true
  cursorTex.minFilter = THREE.LinearMipmapLinearFilter

  const faceCanvas = document.createElement('canvas')
  faceCanvas.width = 1600; faceCanvas.height = 1000
  const faceCtx = faceCanvas.getContext('2d')
  const faceTex = new THREE.CanvasTexture(faceCanvas)
  faceTex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy())
  faceTex.generateMipmaps = true
  faceTex.minFilter = THREE.LinearMipmapLinearFilter
  const face = new THREE.Mesh(
    new THREE.PlaneGeometry(W, H),
    new THREE.ShaderMaterial({
      vertexShader: FACE_VERT, fragmentShader: FACE_FRAG, transparent: true, depthWrite: false,
      uniforms: {
        uMap: { value: faceTex }, uSize: { value: new THREE.Vector2(W, H) }, uRadius: { value: R },
        uSeamAt: { value: new THREE.Vector2(SEAM.x, SEAM.y) }, uSeamH: { value: 0 }, uSeamV: { value: 0 },
        uFlare: { value: 0 }, uGreen: { value: 0 }, uScan: { value: 0 }, uScanOn: { value: 0 }, uShow: { value: 0 }, uTime: { value: 0 },
        uCursor: { value: new THREE.Vector2(-9, -9) }, uCursor2: { value: new THREE.Vector2(-9, -9) }, uCursorOn: { value: 0 },
        uCursorTex: { value: cursorTex }, uCursorSize: { value: new THREE.Vector2(0.15, 0.15) },
      },
    }),
  )
  face.position.z = D / 2 + 0.002
  card.add(face)

  const beamLen = 9
  // the line runs on past the card's edges: far to the right (where the payout goes), briefly to the left (toward the copy)
  const beamMat = (reach) => new THREE.ShaderMaterial({
    vertexShader: FACE_VERT, fragmentShader: BEAM_FRAG, transparent: true, depthWrite: false,
    uniforms: { uLen: { value: beamLen }, uHeight: { value: 0.5 }, uLeak: { value: 0 }, uReach: { value: reach }, uEscape: { value: 0 }, uGreen: { value: 0 }, uShow: { value: 0 }, uTime: { value: 0 } },
  })
  const seamY = (SEAM.y - 0.5) * H
  const beamOut = new THREE.Mesh(new THREE.PlaneGeometry(beamLen, 0.5), beamMat(1.0))
  beamOut.position.set(W / 2 + beamLen / 2 - 0.005, seamY, face.position.z)
  const beamIn = new THREE.Mesh(new THREE.PlaneGeometry(beamLen, 0.5), beamMat(0.38))
  beamIn.position.set(-W / 2 - beamLen / 2 + 0.005, seamY, face.position.z)
  beamIn.scale.x = -1
  card.add(beamOut, beamIn)

  const glint = new THREE.PointLight(0x315efb, 0, 6, 1.6)
  glint.position.set((SEAM.x - 0.5) * W, seamY, 0.9)
  card.add(glint)
  const rim = new THREE.DirectionalLight(0xffffff, 2.4)
  rim.position.set(-4, 5, 2)
  const fill = new THREE.DirectionalLight(0xdfe6ff, 0.9)
  fill.position.set(5, -2, 4)
  scene.add(rim, fill)

  // ---- state
  let key = ''
  const last = { emph: 'hero', passed: 0 }
  const redraw = (emph, passed) => {
    const k = `${emph}|${passed}`
    if (k === key) return
    key = k
    drawFace(faceCtx, { emph, passed })
    faceTex.needsUpdate = true
  }
  redraw('hero', 0)
  document.fonts?.ready.then(() => { key = ''; redraw(last.emph, last.passed) })

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
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), plane = new THREE.Plane(), sight = new THREE.Ray()
  const hit = new THREE.Vector3(), normal = new THREE.Vector3(), origin = new THREE.Vector3()
  const above = new THREE.Vector3(), image = new THREE.Vector3(), seen = new THREE.Vector3()
  const HOVER = 0.2, GLASS = 0.06    // how far the pointer floats in front of the glass, and the glass's thickness (face units)
  let cursorOn = 0

  /* Where the pointer's reflection shows on the glass, in face uv: the front surface's and the back surface's.
     The pointer floats a little in front of the glass on its line of sight; its mirror image sits as far behind each
     surface; we see the image where the line from the eye to it crosses the glass. Head on, that's right under the
     pointer; as the card turns, the reflection slides away from it, as it would. */
  function reflection() {
    card.updateMatrixWorld(true)
    ndc.set(pointer.x * 2 - 1, 1 - pointer.y * 2)
    ray.setFromCamera(ndc, camera)
    normal.set(0, 0, 1).transformDirection(face.matrixWorld)
    plane.setFromNormalAndCoplanarPoint(normal, face.getWorldPosition(origin))
    if (!ray.ray.intersectPlane(plane, hit)) return null
    const facing = -ray.ray.direction.dot(normal)
    if (facing < 0.05) return null
    const h = HOVER * card.scale.x
    above.copy(hit).addScaledVector(ray.ray.direction, -h / facing)
    return [h, h + GLASS * card.scale.x].map((d) => {
      image.copy(above).addScaledVector(normal, -2 * d)
      sight.set(camera.position, image.sub(camera.position).normalize())
      if (!sight.intersectPlane(plane, seen)) return { u: -9, v: -9 }
      face.worldToLocal(seen)
      return { u: seen.x / W + 0.5, v: seen.y / H + 0.5 }
    })
  }

  /**
   * One frame. rect: where the card sits on screen (css px); glow: where the paper's light sits (defaults to the card);
   * quiet: the text column to keep calm; blend: 0 before the story, 1 once it has the card; story: 0–1 through the
   * four steps; intro: 0–1 the card's arrival; paper: 0–1 the tiles' arrival; time in seconds; scroll: the page's scroll in px.
   */
  function frame({ rect, glow = rect, quiet, blend, story, intro, paper: paperIn = intro, time, scroll = 0 }) {
    const u = face.material.uniforms
    pointer.sx = lerp(pointer.sx, pointer.x, reduced ? 1 : 0.06)
    pointer.sy = lerp(pointer.sy, pointer.y, reduced ? 1 : 0.06)

    // placement: the rect's centre and width, in world units at z = 0
    const k = visH / view.h
    const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2
    const rise = reduced ? 0 : (1 - smooth(0.05, 0.75, intro)) * -0.9
    const float = reduced ? 0 : Math.sin(time * 0.7) * 0.035 * (1 - blend * 0.7)
    card.position.set((cx - view.w / 2) * k, -(cy - view.h / 2) * k + rise + float, 0)
    card.scale.setScalar((rect.width * k) / W)

    const px = reduced ? 0 : pointer.sx - 0.5, py = reduced ? 0 : pointer.sy - 0.5
    const heroRot = { x: 0.16 + py * 0.1, y: -0.4 + px * 0.16, z: 0.02 }
    const storyRot = { x: lerp(0.08, 0.02, story) + py * 0.04, y: lerp(-0.24, 0.06, story) + px * 0.06, z: 0 }
    const introTurn = reduced ? 0 : (1 - smooth(0.0, 0.9, intro)) * 0.5
    card.rotation.set(lerp(heroRot.x, storyRot.x, blend) + introTurn * 0.4, lerp(heroRot.y, storyRot.y, blend) - introTurn, lerp(heroRot.z, storyRot.z, blend))

    // the story's four quarters: agree, hold, check, paid
    const s = blend > 0.6 ? story : -1
    const emph = s < 0 ? 'hero' : s < 0.25 ? 'agree' : s < 0.5 ? 'hold' : s < 0.78 ? 'check' : 'paid'
    const scan = lerp(rowScanY(0) + 0.05, rowScanY(3) - 0.05, smooth(0.5, 0.72, s))
    const scanning = s >= 0.5
    const passed = s >= 0.78 ? 4 : scanning ? [0, 1, 2, 3].filter((i) => scan < rowScanY(i)).length : 0
    last.emph = emph; last.passed = passed
    redraw(emph, passed)

    const show = smooth(0.08, 0.5, intro)
    const green = smooth(0.76, 0.81, s)
    u.uShow.value = show
    u.uSeamH.value = smooth(0.42, 0.82, intro)
    u.uSeamV.value = smooth(0.62, 0.92, intro)
    u.uFlare.value = smooth(0.78, 1.0, intro) * (1 + 0.7 * bump(0.25, 0.5, s) * (0.75 + 0.25 * Math.sin(time * 3)) + 0.6 * green)
    u.uGreen.value = green
    u.uScan.value = scan
    u.uScanOn.value = bump(0.5, 0.75, s)
    u.uTime.value = reduced ? 0 : time
    body.material.opacity = show

    // the pointer's reflection: exactly where it would show, with no lag; none without a mouse (touch has no pointer)
    const refl = pointer.seen ? reflection() : null
    if (refl) { u.uCursor.value.set(refl[0].u, refl[0].v); u.uCursor2.value.set(refl[1].u, refl[1].v) }
    cursorOn = lerp(cursorOn, refl ? 1 : 0, 0.2)
    u.uCursorOn.value = show * cursorOn
    u.uCursorSize.value.setScalar((32 * W) / Math.max(rect.width, 1))   // the 128px sprite holds a ~20px arrow, at ~32px

    const escape = smooth(0.79, 0.95, s)
    for (const b of [beamOut, beamIn]) {
      b.material.uniforms.uShow.value = show
      b.material.uniforms.uLeak.value = u.uSeamH.value * smooth(0.85, 1, intro) * 0.8
      b.material.uniforms.uGreen.value = green
      b.material.uniforms.uTime.value = reduced ? 0 : time
    }
    beamOut.material.uniforms.uEscape.value = escape
    shadow.material.uniforms.uPower.value = show * 0.34
    glint.color.set(green > 0.5 ? 0x3be37a : 0x315efb)
    glint.intensity = u.uFlare.value * 2.2

    // the paper: tinted from behind the card
    paper.uniforms.uTime.value = reduced ? 0 : time
    paper.uniforms.uScroll.value = reduced ? 0 : scroll
    paper.uniforms.uIntro.value = reduced ? 1 : smooth(0, 0.85, paperIn)
    paper.uniforms.uGlow.value.set(glow.left + glow.width / 2, view.h - (glow.top + glow.height / 2))
    paper.uniforms.uGlowR.value = Math.max(glow.width * 1.1, 320)
    if (pointer.seen) paper.uniforms.uPointer.value.set(pointer.sx * view.w, view.h - pointer.sy * view.h)
    if (quiet) paper.uniforms.uQuiet.value.set(quiet.left, view.h - quiet.top - quiet.height, quiet.left + quiet.width, view.h - quiet.top)

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
    cursorTex.dispose()
    window.removeEventListener('resize', resize)
    scene.traverse((o) => { o.geometry?.dispose(); o.material?.dispose() })
    paperScene.traverse((o) => { o.geometry?.dispose(); o.material?.dispose() })
    faceTex.dispose()
    renderer.dispose()
  }

  // compile every shader up front (in parallel where the driver allows) so the intro never stalls
  const ready = Promise.all([renderer.compileAsync(scene, camera), renderer.compileAsync(paperScene, paperCam)]).catch(() => {})

  return { frame, resize, dispose, ready }
}
