/*  ============================================================================
    Kernel — the verifier's browser in the cloud, recorded. With KERNEL_API_KEY set, an official
    verification opens its browser on Kernel instead of this server, and Kernel records the session as a
    video: both sides can watch exactly what the verifier saw, at desktop and phone sizes, before the
    money moved. Kernel's own replay page needs a Kernel login, so the video is downloaded here and stored
    with the screenshots. Without a key, or if Kernel can't start a browser, the verifier runs locally.

    Each session can be audited afterwards. It is named and tagged in Kernel's dashboard (app, env, kind,
    ref). The video is checked to be a whole MP4 and its length is read from the file, not the wall clock.
    Marks say where in the video each view was opened and measured. Whatever went missing comes back as a
    reason instead of a silent null:
      kernel_busy                     KERNEL_MAX_BROWSERS sessions already open and none freed in time (thrown)
      create_failed, connect_failed   no Kernel browser (thrown as KernelUnavailable): the run goes local
      no_recording                    a Kernel browser, but the recorder didn't start
      no_video                        it recorded, but no whole MP4 came back
    ============================================================================ */

import { createHash } from 'node:crypto'
import { chromium } from 'playwright-core'
import { mp4Info } from './mp4.js'

const KEY = process.env.KERNEL_API_KEY || ''
export const kernelOn = () => !!KEY

/** No Kernel browser for this run. `reason` is kernel_busy, create_failed or connect_failed; the caller checks locally instead. */
export class KernelUnavailable extends Error {
  constructor(reason, detail = '') {
    super(detail ? `Kernel unavailable (${reason}): ${detail}` : `Kernel unavailable (${reason})`)
    this.name = 'KernelUnavailable'
    this.reason = reason
  }
}

// At most KERNEL_MAX_BROWSERS sessions at once, server-wide: every recorded run opens one (two on a lost-browser
// retry), and a plan's quota or the bill shouldn't be what decides. Above it a run waits up to `wait` ms for a
// slot, then goes local with kernel_busy. A slot is held from create until finish() or a failed create/connect
const MAX_SESSIONS = Math.max(1, Number(process.env.KERNEL_MAX_BROWSERS) || 3)
let inUse = 0
const queue = []
/** True when a new session would start at once (no wait). */
export const kernelSlotFree = () => inUse < MAX_SESSIONS

function slotFor(wait) {
  const granted = () => {
    inUse += 1
    let freed = false
    return () => {
      if (freed) return
      freed = true
      inUse -= 1
      queue.shift()?.()
    }
  }
  if (inUse < MAX_SESSIONS) return Promise.resolve(granted())
  const busy = () => new KernelUnavailable('kernel_busy', `${MAX_SESSIONS} sessions already open`)
  if (!(wait > 0)) return Promise.reject(busy())
  return new Promise((resolve, reject) => {
    const next = () => {
      clearTimeout(timer)
      resolve(granted())
    }
    const timer = setTimeout(() => {
      const i = queue.indexOf(next)
      if (i >= 0) queue.splice(i, 1)
      reject(busy())
    }, wait)
    queue.push(next)
  })
}

let shared = null
async function kernel() {
  if (shared) return shared
  const { default: Kernel } = await import('@onkernel/sdk')
  // the SDK's default (60 s a request, 2 retries) could hold the browser stage for about 3 min before the fallback
  shared = new Kernel({ apiKey: KEY, timeout: 20_000, maxRetries: 1 })
  return shared
}

const connectCDP = (url) => chromium.connectOverCDP(url, { timeout: 15_000 })
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const MAX_MARKS = 40
// before each download attempt: the file is finished just after the stop; a slow one gets about 6 s in all
const DOWNLOAD_WAITS = [500, 1500, 4000]

/** One line of an error for a log or a reason: no stack, each URL cut to its origin (a CDP URL carries a token), never the key. */
function firstLine(e) {
  let line = String(e?.message || e || 'unknown error').split('\n')[0]
  line = line.replace(/\b((?:wss?|https?):\/\/[^\s/?#'"<>]+)[^\s'"<>]*/gi, '$1')
  if (KEY) line = line.split(KEY).join('[key]')
  return line.trim().slice(0, 200)
}

/**
 * A recorded browser on Kernel, for one run.
 * @param {object}   [o]
 * @param {boolean}  [o.record]   record the session as video (official checks do)
 * @param {string}   [o.kind]     what the run is ('verify', 'smoke', 'sample'): in the session's name and tags
 * @param {string}   [o.ref]      what it is for, usually the submission id: in the name (8 chars) and tags (36)
 * @param {number}   [o.wait]     ms to wait for a free session slot (KERNEL_MAX_BROWSERS) before kernel_busy; 0 = don't
 * @param {object}   [o.client]   tests only: stands in for the Kernel SDK client
 * @param {Function} [o.connect]  tests only: (cdpUrl) => a Playwright Browser
 * @param {Function} [o.sleep]    tests only: (ms) => Promise
 * @returns {Promise<{ browser, sessionId, region, chrome, recording, mark, finish }>} mark(kind, label, extra)
 *   notes where in the video something happens; finish() ends the session and never throws: a missing video
 *   is a reason, not a failed check
 * @throws {KernelUnavailable} kernel_busy, create_failed or connect_failed, with no session left running either way
 */
export async function cloudBrowser({ record = true, kind = 'verify', ref = '', wait = 0, client, connect = connectCDP, sleep = pause } = {}) {
  const ms = { create: null, connect: null, stop: null, download: null }
  const freeSlot = await slotFor(wait)
  let k, id, cdpUrl, region
  let at = Date.now()
  try {
    k = client || await kernel()
    const session = await k.browsers.create({
      timeout_seconds: 90,
      viewport: { width: 1440, height: 900 },
      start_url: 'about:blank',
      name: `verdikt-${kind}-${String(ref).slice(0, 8)}-${Date.now().toString(36)}`,
      tags: { app: 'verdikt', env: process.env.NODE_ENV || 'dev', kind, ...(ref ? { ref: String(ref).slice(0, 36) } : {}) },
    })
    // Only these three are kept. The answer also carries browser_live_view_url, which is never requested, stored
    // or logged here: read-only is just a flag in Kernel's client page, so anyone holding that URL could drive
    // the verifier's browser in the middle of a check. The CDP URL is used once to connect and never logged.
    id = session.session_id
    cdpUrl = session.cdp_ws_url
    region = session.region || null
    if (!id) throw new Error('Kernel answered without a session id')
  } catch (e) {
    freeSlot()
    throw new KernelUnavailable('create_failed', firstLine(e))
  }
  ms.create = Date.now() - at

  let browser
  at = Date.now()
  try {
    browser = await connect(cdpUrl)
  } catch (e) {
    await deleteSession(k, id, sleep)
    freeSlot()
    throw new KernelUnavailable('connect_failed', firstLine(e))
  }
  ms.connect = Date.now() - at
  const chrome = String(browser.version()).split('.')[0] || null
  // the session's own about:blank window would sit behind the centred phone window for the whole phone chapter
  if (record) await minimizeStartPage(browser)

  // the recorder starts once the backdrop is up, so the video never opens on about:blank; marks count from the
  // moment it did
  let replay = null
  let t0 = Date.now()
  if (record) {
    try {
      replay = await k.browsers.replays.start(id, { framerate: 12, max_duration_in_seconds: 240 })
      if (!replay?.replay_id) throw new Error('Kernel answered without a replay id')
      t0 = Date.now()
    } catch (e) {
      replay = null   // the check still runs; finish() reports no_recording
      console.warn('kernel: replay did not start', id, firstLine(e))
    }
  }
  const recordedAt = replay ? replay.started_at || new Date(t0).toISOString() : null

  const marks = []
  let finishing = null

  /** Where in the video something happens, to a tenth of a second. Nothing without a recording, or once finish() began. */
  function mark(type, label, extra = {}) {
    if (!replay || finishing || marks.length >= MAX_MARKS) return
    marks.push({ t: Math.max(0, Math.round((Date.now() - t0) / 100) / 10), kind: type, label, ...extra })
  }

  /** Stop, close, download, delete: in that order, once (a second call gets the same result). */
  function finish() {
    finishing ||= wrapUp().finally(freeSlot)
    return finishing
  }

  async function wrapUp() {
    let video = null
    let seconds = null
    // a) stop while the last page is still on screen: closing first left about 5 s of blank tail in the video
    if (replay) {
      at = Date.now()
      try {
        await k.browsers.replays.stop(replay.replay_id, { id_or_name: id })
      } catch (e) {
        // it stops by itself at max_duration_in_seconds, and the file can still be there: download anyway
        console.warn('kernel: replay did not stop', id, firstLine(e))
      }
      ms.stop = Date.now() - at
    }
    // b)
    try {
      await browser.close()
    } catch (e) {
      console.warn('kernel: browser did not close', id, firstLine(e))
    }
    // c) the first download that is a whole MP4: an error page or an unfinished file is fetched again
    if (replay) {
      at = Date.now()
      let why = null
      for (const wait of DOWNLOAD_WAITS) {
        try {
          await sleep(wait)
          const res = await k.browsers.replays.download(replay.replay_id, { id_or_name: id })
          const buf = Buffer.from(await res.arrayBuffer())
          const info = mp4Info(buf)
          if (info.ok) { video = buf; seconds = info.seconds; break }
          why = info.reason
        } catch (e) {
          why = firstLine(e)
        }
      }
      ms.download = Date.now() - at
      if (!video) console.warn('kernel: no valid video', id, why)
    }
    // d)
    await deleteSession(k, id, sleep)
    // e) a mark the video ends before (the 240 s cap, a cut file) can't be watched; keep it, say so
    for (const m of marks) m.inVideo = seconds != null && m.t <= seconds - 0.2
    return {
      video,
      seconds,
      bytes: video ? video.length : null,
      sha256: video ? createHash('sha256').update(video).digest('hex') : null,
      sessionId: id,
      replayId: replay?.replay_id ?? null,
      region,
      chrome,
      recordedAt,
      marks,
      truncated: marks.some((m) => !m.inVideo),
      reason: video ? null : replay ? 'no_video' : record ? 'no_recording' : null,
      ms,
    }
  }

  return { browser, sessionId: id, region, chrome, recording: !!replay, mark, finish }
}

/** Delete a cloud browser, once more a second later if that fails, then a warning with its id (Kernel's idle timeout ends it anyway). */
async function deleteSession(k, id, sleep) {
  let error = null
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      if (attempt > 1) await sleep(1000)
      await k.browsers.deleteByID(id)
      return true
    } catch (e) {
      error = e   // the first failure gets one retry
    }
  }
  console.warn('kernel: session not deleted', id, firstLine(error))
  return false
}

/** Window bounds over CDP, for the recording only: Chrome may clamp them, and the evidence is the same either way. */
async function setWindow(page, steps) {
  try {
    const cdp = await page.context().newCDPSession(page)
    const { windowId } = await cdp.send('Browser.getWindowForTarget')
    for (const bounds of steps) await cdp.send('Browser.setWindowBounds', { windowId, bounds })
    await cdp.detach()
  } catch (e) {
    console.warn('kernel: window not resized', firstLine(e))
  }
}

/**
 * The window the session started with (start_url about:blank), turned into a plain full-screen backdrop: each view
 * opens its own window, and the centred phone window would otherwise sit in front of an empty about:blank window.
 * Kernel's display has no window manager, so minimizing does nothing; fullscreen hides the tab strip and address
 * bar. The page is local markup only (no network) and is never measured.
 */
const BACKDROP = '<!doctype html><title>Verdikt verifier</title><style>html,body{margin:0;height:100%;background:#0d1b33}'
  + 'p{position:fixed;left:32px;bottom:24px;margin:0;color:#8a9bb8;font:400 18px/1.4 system-ui,sans-serif}</style>'
  + '<p>Verdikt verifier · Kernel cloud browser</p>'
async function minimizeStartPage(browser) {
  const page = typeof browser.contexts === 'function' ? browser.contexts()[0]?.pages()[0] : null
  if (!page) return
  await page.setContent(BACKDROP).catch((e) => console.warn('kernel: backdrop not drawn', firstLine(e)))
  await setWindow(page, [{ windowState: 'fullscreen' }])
  // Chrome shows 'To exit full screen, press and hold Esc' for a few seconds; the recorder starts after it's gone
  await page.waitForTimeout(BACKDROP_SETTLE_MS).catch(() => {})
}
const BACKDROP_SETTLE_MS = 3500

/**
 * Chrome leaves focus, and the selected URL, in a new window's address bar: for the recording, focus goes to the
 * page instead (Page.bringToFront focuses the web contents). Nothing on the page is focused or changed.
 */
export const focusPage = (page) => page.bringToFront().catch((e) => console.warn('kernel: page not focused', firstLine(e)))

/** In the recording, each view's window fills the screen instead of opening at Chrome's default size. */
export const fillScreen = (page) => setWindow(page, [{ windowState: 'maximized' }])

/**
 * The phone pass, centred in the recording instead of a 375px strip at the left of a maximized window. A window
 * must be 'normal' before it takes bounds; Chrome may enforce a wider minimum, and whatever it applies is fine.
 */
export const phoneWindow = (page) =>
  setWindow(page, [{ windowState: 'normal' }, { left: Math.round((1440 - 391) / 2), top: 0, width: 391, height: 900 }])
