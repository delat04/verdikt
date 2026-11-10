/*  ============================================================================
    Is this a whole MP4, and how long is it? Kernel's replay download can hand back an error page, or a
    file that isn't finished yet, and a verdict should only point at a video that plays. This reads the
    box headers and the movie header (mvhd) and nothing else: no decoding, no dependencies. The length is
    the file's own, not the wall clock around the recording.
    ============================================================================ */

const MIN_BYTES = 10_000        // a second of 12 fps video is already more; anything smaller is an error body
const MAX_BYTES = 60_000_000    // 240 s at 12 fps is a few MB; past this something is wrong, and too big to store

/**
 * The boxes in buf[start, end), in order: { type, body, end }, where body is where the payload starts.
 * A box is a u32 BE size and a 4-character type. Size 1 means a 64-bit size follows the type, size 0 runs to
 * `end`, and a size smaller than its own header stops the walk (the rest can't be trusted).
 */
function* boxes(buf, start, end) {
  let at = start
  while (at + 8 <= end) {
    let size = buf.readUInt32BE(at)
    const type = buf.toString('latin1', at + 4, at + 8)
    let body = at + 8
    if (size === 1) {
      if (at + 16 > end) return
      size = Number(buf.readBigUInt64BE(at + 8))
      body = at + 16
    } else if (size === 0) {
      size = end - at
    }
    if (size < body - at) return
    yield { type, body, end: at + size }
    at += size
  }
}

const fail = (reason) => ({ ok: false, seconds: null, reason })

/**
 * @param {Buffer} buf a downloaded recording
 * @returns {{ ok: boolean, seconds: number|null, reason: string|null }} seconds to the hundredth, from mvhd.
 *   reason: 'size' (not a buffer, under 10 KB or over 60 MB), 'not_mp4' (no ftyp), 'no_mvhd' (no movie header
 *   inside the top-level moov), 'no_duration' (the header states no length), 'truncated' (a box runs past the
 *   end of the file: the download stopped early)
 */
export function mp4Info(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < MIN_BYTES || buf.length > MAX_BYTES) return fail('size')
  if (buf.toString('latin1', 4, 8) !== 'ftyp') return fail('not_mp4')

  let mvhd = null
  let cut = false
  for (const box of boxes(buf, 0, buf.length)) {
    if (box.end > buf.length) cut = true
    if (box.type !== 'moov' || mvhd) continue
    for (const child of boxes(buf, box.body, Math.min(box.end, buf.length))) {
      if (child.type === 'mvhd') { mvhd = child; break }
    }
  }
  if (!mvhd) return fail('no_mvhd')

  // mvhd is a full box: version byte, 3 flag bytes, then creation and modification times (u32 in v0, u64 in v1)
  const p = mvhd.body
  const room = Math.min(mvhd.end, buf.length) - p
  let timescale, duration
  if (buf[p] === 0 && room >= 20) {
    timescale = buf.readUInt32BE(p + 12)
    duration = buf.readUInt32BE(p + 16)
    if (duration === 0xFFFFFFFF) duration = 0              // all ones: "unknown"
  } else if (buf[p] === 1 && room >= 32) {
    timescale = buf.readUInt32BE(p + 20)
    duration = Number(buf.readBigUInt64BE(p + 24))
    if (!Number.isSafeInteger(duration)) duration = 0      // all ones ("unknown"), or past any real length
  } else {
    return fail('no_mvhd')
  }
  if (!timescale || !duration) return fail('no_duration')
  if (cut) return fail('truncated')
  return { ok: true, seconds: Math.round(duration / timescale * 100) / 100, reason: null }
}
