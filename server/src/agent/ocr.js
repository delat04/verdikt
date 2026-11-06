/*  ============================================================================
    OCR — reads the text a person sees in the screenshots, for copy the DOM doesn't carry: words drawn
    into a hero image, a canvas, an SVG banner. Runs only when a text probe misses in the page text,
    after the browser has closed (one small worker, then it's gone). Local and free: Tesseract (WASM)
    with the English model bundled in the image, so nothing leaves the server.
    ============================================================================ */

import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { createWorker } from 'tesseract.js'

const require = createRequire(import.meta.url)
const LANG_PATH = join(dirname(require.resolve('@tesseract.js-data/eng')), '4.0.0_best_int')

/** @param {Record<string, Buffer>} shots name → png  @returns {Promise<Record<string, string>|null>} null if it couldn't run in time */
export async function readScreens(shots, { timeoutMs = 45000 } = {}) {
  let worker
  let late = false
  const run = (async () => {
    worker = await createWorker('eng', 1, { langPath: LANG_PATH, gzip: true, cacheMethod: 'none' })
    const out = {}
    for (const [name, png] of Object.entries(shots)) {
      if (late) break
      if (png) out[name] = (await worker.recognize(png)).data.text
    }
    return out
  })()
  run.catch(() => {})
  let timer
  const deadline = new Promise((resolve) => { timer = setTimeout(() => { late = true; resolve(null) }, timeoutMs) })
  try {
    return await Promise.race([run, deadline])
  } catch (e) {
    console.error('ocr failed', e.message)
    return null
  } finally {
    clearTimeout(timer)
    // a worker still starting when time ran out is stopped as soon as it exists
    if (worker) worker.terminate().catch(() => {})
    else run.finally(() => worker?.terminate().catch(() => {}))
  }
}
