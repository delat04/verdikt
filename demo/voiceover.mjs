/*  Demo voice-over with ElevenLabs
    Reads the beats in script.json and writes, into demo/out:
      NN-<beat>.mp3   one clip per beat, to lay at the beat's start in the edit
      NN-<beat>.json  ElevenLabs' timing for that clip (kept, so one beat can be redone alone)
      voiceover.srt   captions, each beat placed at its planned start
      timing.txt      how long each clip runs against its slot

    1. Put ELEVENLABS_API_KEY=… in demo/.env (gitignored). Optional: ELEVENLABS_VOICE_ID, ELEVENLABS_MODEL,
       ELEVENLABS_SPEED (0.7 to 1.2).
    2. node --env-file=demo/.env demo/voiceover.mjs              → every beat
       node --env-file=demo/.env demo/voiceover.mjs hire fund    → only these beats
       node demo/voiceover.mjs --estimate                        → read-aloud estimate, no API call
*/

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'

const here = new URL('.', import.meta.url)
const out = new URL('out/', here)
const VOICE = process.env.ELEVENLABS_VOICE_ID || 'JBFqnCBsd6RMkjVDRZzb' // "George", the voice in ElevenLabs' own examples
const MODEL = process.env.ELEVENLABS_MODEL || 'eleven_multilingual_v2'
const SETTINGS = { stability: 0.5, similarity_boost: 0.75, style: 0.1, use_speaker_boost: true, speed: Number(process.env.ELEVENLABS_SPEED || 1) }
const WPM = 150 // a calm narrator; ElevenLabs voices at speed 1 land near it
const LIMIT = 180

const { beats } = JSON.parse(await readFile(new URL('script.json', here), 'utf8'))
const args = process.argv.slice(2)
const words = (s) => s.trim().split(/\s+/).length
const file = (b, ext) => new URL(`${String(beats.indexOf(b) + 1).padStart(2, '0')}-${b.id}.${ext}`, out)

let at = 0
for (const b of beats) { b.start = at; at += b.slot }

if (args.includes('--estimate')) {
  for (const b of beats) {
    const s = words(b.say) / WPM * 60
    console.log(`${b.id.padEnd(8)} ${String(words(b.say)).padStart(3)} words  ~${s.toFixed(1).padStart(4)} s of ${b.slot} s  ${fit(s, b.slot)}`)
  }
  console.log(`planned ${clock(at)} of ${clock(LIMIT)} · ${beats.reduce((n, b) => n + words(b.say), 0)} words`)
  process.exit(0)
}

const KEY = process.env.ELEVENLABS_API_KEY
if (!KEY) {
  console.error('No ELEVENLABS_API_KEY. Put it in demo/.env, then: node --env-file=demo/.env demo/voiceover.mjs')
  process.exit(1)
}

const unknown = args.filter((a) => !beats.some((b) => b.id === a))
if (unknown.length) {
  console.error(`No beat named ${unknown.join(', ')}. Beats: ${beats.map((b) => b.id).join(', ')}`)
  process.exit(1)
}

await mkdir(out, { recursive: true })
for (const [i, b] of beats.entries()) {
  if (args.length && !args.includes(b.id)) continue
  // the neighbouring lines keep the delivery even from clip to clip (v2 models; v3 doesn't take them)
  const stitch = MODEL.startsWith('eleven_v3') ? {} : { previous_text: beats[i - 1]?.say, next_text: beats[i + 1]?.say }
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE}/with-timestamps?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'xi-api-key': KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ text: b.say, model_id: MODEL, voice_settings: SETTINGS, ...stitch }),
  })
  if (!res.ok) {
    console.error(`${b.id}: ElevenLabs answered ${res.status}: ${(await res.text()).slice(0, 300)}`)
    process.exit(1)
  }
  const { audio_base64, alignment } = await res.json()
  await writeFile(file(b, 'mp3'), Buffer.from(audio_base64, 'base64'))
  await writeFile(file(b, 'json'), JSON.stringify(alignment))
  console.log(`${b.id}: ${file(b, 'mp3').pathname.split('/').pop()}`)
}

// timing and captions from every clip on disk, so redoing one beat keeps the others
const report = [], cues = []
for (const b of beats) {
  if (!existsSync(file(b, 'json'))) { report.push(`${b.id.padEnd(8)} no clip yet`); continue }
  const a = JSON.parse(await readFile(file(b, 'json'), 'utf8'))
  const ends = a.character_end_times_seconds, starts = a.character_start_times_seconds
  const len = ends.at(-1)
  report.push(`${b.id.padEnd(8)} ${len.toFixed(1).padStart(4)} s of ${b.slot} s  ${fit(len, b.slot)}`)
  // the alignment is one entry per character of the text sent; scale if it ever differs
  const k = a.characters.length / b.say.length
  for (const [from, to] of chunks(b.say)) {
    const s = starts[Math.min(starts.length - 1, Math.floor(from * k))]
    const e = ends[Math.min(ends.length - 1, Math.ceil(to * k) - 1)]
    cues.push([b.start + s, b.start + e, lines(b.say.slice(from, to).trim())])
  }
}
report.push(`planned ${clock(at)} of ${clock(LIMIT)}`)
await writeFile(new URL('timing.txt', out), report.join('\n') + '\n')
await writeFile(new URL('voiceover.srt', out), cues.map(([s, e, t], i) => `${i + 1}\n${srt(s)} --> ${srt(e)}\n${t}\n`).join('\n'))
console.log('\n' + report.join('\n'))

function fit(s, slot) { return s > slot ? 'over' : s > slot - 1.5 ? 'tight' : 'ok' }
function clock(s) { return `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}` }
function srt(s) {
  const ms = Math.round(s * 1000), p = (n, w = 2) => String(n).padStart(w, '0')
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`
}

// caption spans: sentences, split again at commas or colons past 84 characters (two lines of 42)
function chunks(text) {
  const spans = []
  const sentence = /[^.?!]+[.?!]*\s*/g
  for (const m of text.matchAll(sentence)) {
    let from = m.index
    const end = m.index + m[0].length
    while (end - from > 84) {
      const piece = text.slice(from, from + 84)
      const cut = Math.max(piece.lastIndexOf(', '), piece.lastIndexOf(': '))
      const step = cut > 20 ? cut + 2 : piece.lastIndexOf(' ') + 1
      spans.push([from, from + step])
      from += step
    }
    spans.push([from, end])
  }
  return spans
}

function lines(t) {
  if (t.length <= 42) return t
  const mid = t.length / 2
  let best = -1
  for (let i = t.indexOf(' '); i !== -1; i = t.indexOf(' ', i + 1)) if (best < 0 || Math.abs(i - mid) < Math.abs(best - mid)) best = i
  return best < 0 ? t : `${t.slice(0, best)}\n${t.slice(best + 1)}`
}
