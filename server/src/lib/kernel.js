/*  ============================================================================
    Kernel — the verifier's browser in the cloud, recorded. With KERNEL_API_KEY set, an official
    verification opens its browser on Kernel instead of this server, and Kernel records the session as a
    video: both sides can watch exactly what the verifier saw, at desktop and phone sizes, before the
    money moved. Kernel's own replay page needs a Kernel login, so the video is downloaded here and stored
    with the screenshots. Without a key, or if Kernel can't start a browser, the verifier runs locally.
    ============================================================================ */

import { chromium } from 'playwright-core'

const KEY = process.env.KERNEL_API_KEY || ''
export const kernelOn = () => !!KEY

let client = null
async function kernel() {
  if (client) return client
  const { default: Kernel } = await import('@onkernel/sdk')
  client = new Kernel({ apiKey: KEY })
  return client
}

/**
 * A recorded browser on Kernel. Returns the Playwright browser and `finish()`, which stops the recording,
 * downloads it and deletes the cloud browser; finish() never throws (a missing video is not a failed check).
 */
export async function cloudBrowser() {
  const k = await kernel()
  const session = await k.browsers.create({ timeout_seconds: 300, viewport: { width: 1440, height: 900 }, start_url: 'about:blank' })
  let replay = null
  try {
    replay = await k.browsers.replays.start(session.session_id, { framerate: 12, max_duration_in_seconds: 240 })
  } catch {
    replay = null   // the check still runs; it just has no video
  }
  let browser
  try {
    browser = await chromium.connectOverCDP(session.cdp_ws_url)
  } catch (e) {
    await k.browsers.deleteByID(session.session_id).catch(() => {})
    throw e
  }
  const started = Date.now()

  async function finish() {
    await browser.close().catch(() => {})
    let video = null
    if (replay) {
      try {
        await k.browsers.replays.stop(replay.replay_id, { id_or_name: session.session_id })
        const res = await k.browsers.replays.download(replay.replay_id, { id_or_name: session.session_id })
        video = Buffer.from(await res.arrayBuffer())
      } catch {
        video = null
      }
    }
    await k.browsers.deleteByID(session.session_id).catch(() => {})
    return { video, seconds: Math.round((Date.now() - started) / 1000), sessionId: session.session_id }
  }

  return { browser, finish }
}

/** In the recording, each view's window fills the screen instead of opening at Chrome's default size. */
export async function fillScreen(page) {
  try {
    const cdp = await page.context().newCDPSession(page)
    const { windowId } = await cdp.send('Browser.getWindowForTarget')
    await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'maximized' } })
    await cdp.detach()
  } catch {
    // cosmetic: the evidence is the same either way
  }
}
