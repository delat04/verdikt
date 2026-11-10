/*  ============================================================================
    Is a downloaded recording a whole MP4, and how long is it (lib/mp4.js)? The shipped replays, the error
    bodies Kernel's download can hand back, and synthetic files for each box layout. No keys, no network.
    ============================================================================ */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { mp4Info } from '../src/lib/mp4.js'

const REPLAYS = new URL('../../web/public/replays/', import.meta.url)
const shipped = readdirSync(REPLAYS).filter((f) => f.endsWith('.mp4')).sort()
const SAMPLE = new URL('kernel-sample.mp4', REPLAYS)

test('the first shipped replay is a whole MP4', () => {
  assert.ok(shipped.length > 0, 'web/public/replays has no .mp4')
  const info = mp4Info(readFileSync(new URL(shipped[0], REPLAYS)))
  assert.equal(info.ok, true, `${shipped[0]}: ${info.reason}`)
  assert.ok(info.seconds > 0)
})

test('every shipped replay is a whole MP4', () => {
  for (const name of shipped) assert.equal(mp4Info(readFileSync(new URL(name, REPLAYS))).ok, true, name)
})

test('kernel-sample.mp4 is 26.58 s long, read from the file', { skip: !existsSync(SAMPLE) && 'kernel-sample.mp4 is gone' }, () => {
  const info = mp4Info(readFileSync(SAMPLE))
  assert.equal(info.ok, true)
  assert.ok(Math.abs(info.seconds - 26.58) <= 0.05, `${info.seconds} s`)
})

test('what is not a video says why', () => {
  assert.equal(mp4Info(Buffer.from('<!doctype html><title>Not ready</title>')).reason, 'size')
  assert.equal(mp4Info(Buffer.from('<!doctype html>'.padEnd(12_000, ' '))).reason, 'not_mp4')
  assert.equal(mp4Info('a string').reason, 'size')
  assert.equal(mp4Info(Buffer.alloc(60_000_001)).reason, 'size')
  assert.equal(mp4Info(Buffer.alloc(20 * 1024)).reason, 'not_mp4')
  const ftypOnly = Buffer.alloc(20_000)
  ftypOnly.writeUInt32BE(32, 0); ftypOnly.write('ftyp', 4, 'latin1')
  assert.deepEqual(mp4Info(ftypOnly), { ok: false, seconds: null, reason: 'no_mvhd' })
})

test('a download that stopped early is truncated', { skip: !existsSync(SAMPLE) && 'kernel-sample.mp4 is gone' }, () => {
  assert.equal(mp4Info(readFileSync(SAMPLE).subarray(0, 200_000)).reason, 'truncated')
})

/** A minimal faststart MP4: ftyp, moov > mvhd (v0 or v1), then mdat padding up to `total` bytes. */
function synthetic({ version = 0, timescale = 1000, duration = 12_340, total = 20_000, mdatSize } = {}) {
  const buf = Buffer.alloc(total)
  buf.writeUInt32BE(24, 0); buf.write('ftypisom', 4, 'latin1')
  const mvhdLen = version ? 8 + 32 : 8 + 20
  buf.writeUInt32BE(8 + mvhdLen, 24); buf.write('moov', 28, 'latin1')
  const m = 32
  buf.writeUInt32BE(mvhdLen, m); buf.write('mvhd', m + 4, 'latin1')
  buf[m + 8] = version
  if (version) { buf.writeUInt32BE(timescale, m + 8 + 20); buf.writeBigUInt64BE(BigInt(duration), m + 8 + 24) }
  else { buf.writeUInt32BE(timescale, m + 8 + 12); buf.writeUInt32BE(duration, m + 8 + 16) }
  const d = m + mvhdLen
  buf.writeUInt32BE(mdatSize ?? total - d, d); buf.write('mdat', d + 4, 'latin1')
  return buf
}

test('mvhd v0 and v1, 64-bit box sizes, and a length the header cannot state', () => {
  assert.deepEqual(mp4Info(synthetic()), { ok: true, seconds: 12.34, reason: null })
  assert.deepEqual(mp4Info(synthetic({ version: 1, timescale: 90_000, duration: 90_000 * 61.5 })), { ok: true, seconds: 61.5, reason: null })
  assert.equal(mp4Info(synthetic({ mdatSize: 0 })).ok, true)                      // size 0 runs to the end
  assert.equal(mp4Info(synthetic({ mdatSize: 30_000 })).reason, 'truncated')      // claims more than arrived
  assert.equal(mp4Info(synthetic({ timescale: 0 })).reason, 'no_duration')
  assert.equal(mp4Info(synthetic({ duration: 0xFFFFFFFF })).reason, 'no_duration')
  const large = synthetic()   // the mdat header rewritten as size 1 + 64-bit largesize
  const d = 32 + 28
  large.writeUInt32BE(1, d); large.writeBigUInt64BE(BigInt(20_000 - d), d + 8)
  assert.deepEqual(mp4Info(large), { ok: true, seconds: 12.34, reason: null })
  const tiny = synthetic(); tiny.writeUInt32BE(4, 32 + 28)                        // size < 8 stops the walk, mvhd already read
  assert.equal(mp4Info(tiny).ok, true)
})
