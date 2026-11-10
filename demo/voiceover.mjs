/*  The demo's sound, from ElevenLabs: the narration (line by line), the sound library and the score
    Reads demo/script.json and writes into demo/out:
      voice/<beat>-<n>.mp3 / .json   one clip per line, and ElevenLabs' character timing for it
      voice/timeline.json            when every line, cue and beat starts in the finished video (the recorder and
                                     the assembler both read it), from each clip's real length plus the pauses
      voice/voiceover.srt            captions on that timeline (the delivery tags are never shown)
      voice/music.mp3 / music-plan.json   the score: one composition-plan chunk per act, each exactly as long as
                                     the beats it covers, so the music turns where the story does
      sfx/<name>.mp3                 the sound library record.mjs places (clicks, chimes, the money sound…)

    Narration: Eleven v4 by default, each line its own request with the lines either side as context (request
    stitching), a delivery tag where the script asks for one ([warm], [curious]…), and a set pause after it, so
    the pace is even and every on-screen action has an exact moment. Every clip is then transcribed (Scribe v2)
    and compared with its line; one that drifted (v4 is not deterministic) is generated again, twice at most.

    The API key: ELEVENLABS_API_KEY (this repo keeps it in server/.env). Optional: ELEVENLABS_VOICE (name or id),
    ELEVENLABS_MODEL (overrides script.voice.model).
      node --env-file=server/.env demo/voiceover.mjs               every line, checked
      node --env-file=server/.env demo/voiceover.mjs hire fund     only these beats' lines (timeline redone)
      node --env-file=server/.env demo/voiceover.mjs --sfx         the sound library (--force to redo it)
      node --env-file=server/.env demo/voiceover.mjs --music       the score, from timeline.json
      node --env-file=server/.env demo/voiceover.mjs --check       transcribe the clips on disk, report drift
      node --env-file=server/.env demo/voiceover.mjs --voices      the voices this account can use
      node --env-file=server/.env demo/voiceover.mjs --audition    the opening in four voices, demo/out/audition
      node demo/voiceover.mjs --timeline                           redo the timeline from the clips on disk
      node demo/voiceover.mjs --estimate [--write]                 read-aloud estimate, no API call
*/

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'

const here = new URL('.', import.meta.url)
const out = new URL('out/voice/', here)
const sfxDir = new URL('out/sfx/', here)
const API = 'https://api.elevenlabs.io/v1'
const FORMAT = 'mp3_44100_128'            // every plan; 192 kbps needs Creator
const PREFERRED = ['Eric', 'Brian', 'Chris', 'Will', 'George']
const AUDITION = ['Eric', 'Brian', 'Sarah', 'Will']
const WPM = 150
const LIMIT = 180
// Scribe writes amounts as figures ("$550") and spells the product names its own way: amounts and number words
// drop out of both sides of the check, and the names map to one spelling, so only real drift counts
const NUMBERISH = /^(\d+|a|and|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|dollars?)$/
const NAMES = [[/^verdi[ck]t$/, 'verdikt'], [/^br[aeiy]n?t[aeiou]m$/, 'bryntum'], [/^channel\d*$/, 'channel'], [/^kern[ae]l$/, 'kernel'], [/^elastics?$/, 'elastic']]

const script = JSON.parse(await readFile(new URL('script.json', here), 'utf8'))
const { beats } = script
const V = { model: 'eleven_v4', stability: 0.45, similarity: 0.8, pause: 0.42, lead: 0.35, tail: 0.9, ...script.voice }
const MODEL = process.env.ELEVENLABS_MODEL || V.model
const args = process.argv.slice(2)
const flags = new Set(args.filter((a) => a.startsWith('--')))
const only = args.filter((a) => !a.startsWith('--'))
const words = (s) => s.trim().split(/\s+/).length
const lines = beats.flatMap((b) => b.lines.map((l, n) => ({ ...l, beat: b, n })))
const clip = (l, ext) => new URL(`${l.beat.id}-${l.n + 1}.${ext}`, out)
/** what is sent: the delivery tag, then the line; captions and checks use the line alone */
const spoken = (l) => (l.tags ? `${l.tags} ${l.say}` : l.say)

if (flags.has('--estimate')) {
  let total = 0
  for (const b of beats) {
    const len = beatLength(b, b.lines.map((l) => (words(l.say) / WPM) * 60))
    total += len
    console.log(`${b.id.padEnd(8)} ${String(b.lines.reduce((n, l) => n + words(l.say), 0)).padStart(3)} words  ~${len.toFixed(1).padStart(5)} s`)
  }
  console.log(`about ${clock(total)} of ${clock(LIMIT)} · ${lines.reduce((n, l) => n + words(l.say), 0)} words`)
  if ((flags.has('--write') && !existsSync(new URL('timeline.json', out))) || flags.has('--force')) {
    await mkdir(out, { recursive: true })
    await writeTimeline(null, true)
    console.log('wrote a provisional out/voice/timeline.json')
  }
  process.exit(0)
}
if (flags.has('--timeline')) {
  const prev = existsSync(new URL('timeline.json', out)) ? JSON.parse(await readFile(new URL('timeline.json', out), 'utf8')) : {}
  await writeTimeline(prev.voice || null, false)
  process.exit(0)
}

const KEY = process.env.ELEVENLABS_API_KEY
if (!KEY) fail('No ELEVENLABS_API_KEY. This repo keeps it in server/.env: node --env-file=server/.env demo/voiceover.mjs')
const headers = { 'xi-api-key': KEY, 'content-type': 'application/json' }
await mkdir(out, { recursive: true })

if (flags.has('--voices')) {
  for (const v of await voices()) console.log(`${v.voice_id}  ${v.name.padEnd(28)} ${[v.labels?.gender, v.labels?.accent, v.labels?.description || v.labels?.descriptive, v.labels?.use_case].filter(Boolean).join(' · ')}`)
  process.exit(0)
}
if (flags.has('--audition')) {
  const dir = new URL('../audition/', out)
  await mkdir(dir, { recursive: true })
  const all = await voices()
  const text = `${beats[0].lines.map(spoken).join(' ')} ${spoken(beats[1].lines[0])}`
  for (const name of AUDITION) {
    const v = all.find((x) => x.name.toLowerCase().startsWith(name.toLowerCase()))
    if (!v) continue
    const { audio_base64 } = await speak(v.voice_id, text)
    await writeFile(new URL(`${name.toLowerCase()}.mp3`, dir), Buffer.from(audio_base64, 'base64'))
    console.log(`audition: ${name} (${v.voice_id})`)
  }
  process.exit(0)
}
if (flags.has('--sfx')) {
  await mkdir(sfxDir, { recursive: true })
  for (const [name, s] of Object.entries(script.sfx || {})) {
    const file = new URL(`${name}.mp3`, sfxDir)
    if (existsSync(file) && !flags.has('--force')) { console.log(`sfx ${name}: kept`); continue }
    const res = await fetch(`${API}/sound-generation?output_format=${FORMAT}`, {
      method: 'POST', headers,
      body: JSON.stringify({ text: s.prompt, duration_seconds: s.seconds, prompt_influence: s.influence ?? 0.5, model_id: 'eleven_text_to_sound_v3' }),
    })
    if (!res.ok) fail(`sfx ${name}: ElevenLabs answered ${res.status}: ${(await res.text()).slice(0, 300)}`)
    await writeFile(file, Buffer.from(await res.arrayBuffer()))
    console.log(`sfx ${name}: ${s.seconds} s`)
  }
  process.exit(0)
}
if (flags.has('--music')) {
  if (!existsSync(new URL('timeline.json', out))) fail('No timeline.json yet: voice the lines first')
  const tl = JSON.parse(await readFile(new URL('timeline.json', out), 'utf8'))
  const M = script.music
  const lenOf = (ids) => ids.reduce((s, id) => s + (tl.beats.find((b) => b.id === id)?.length || 0), 0)
  // one chunk per act, as long as its beats; the last runs on 2.5 s for the ending to ring out
  const chunks = M.acts.map((a, i) => ({
    text: a.text,
    duration_ms: Math.max(3000, Math.round((lenOf(a.beats) + (i === M.acts.length - 1 ? 2.5 : 0)) * 1000)),
    positive_styles: i === 0 ? [...M.styles, ...a.styles] : a.styles,
    negative_styles: [...M.negative, ...(a.negative || [])],
    context_adherence: 'high',
  }))
  const plan = { chunks }
  await writeFile(new URL('music-plan.json', out), JSON.stringify(plan, null, 2))
  const res = await fetch(`${API}/music?output_format=${FORMAT}`, {
    method: 'POST', headers, body: JSON.stringify({ composition_plan: plan, model_id: M.model || 'music_v2_5', respect_sections_durations: true }),
  })
  if (!res.ok) fail(`music: ElevenLabs answered ${res.status}: ${(await res.text()).slice(0, 400)}`)
  await writeFile(new URL('music.mp3', out), Buffer.from(await res.arrayBuffer()))
  console.log(`music.mp3: ${M.acts.map((a, i) => `${a.name} ${(chunks[i].duration_ms / 1000).toFixed(1)} s`).join(' · ')}`)
  process.exit(0)
}

const unknown = only.filter((a) => !beats.some((b) => b.id === a))
if (unknown.length) fail(`No beat named ${unknown.join(', ')}. Beats: ${beats.map((b) => b.id).join(', ')}`)

if (flags.has('--check')) {
  let bad = 0
  for (const l of lines) {
    if (only.length && !only.includes(l.beat.id)) continue
    const score = await check(l)
    if (score < 0.86) bad++
    console.log(`${`${l.beat.id}-${l.n + 1}`.padEnd(9)} ${score.toFixed(2)}${score < 0.86 ? '  DRIFTED' : ''}`)
  }
  console.log(bad ? `${bad} line(s) drifted: run those beats again` : 'every line says what the script says')
  process.exit(bad ? 1 : 0)
}

const voice = await pickVoice()
console.log(`voice: ${voice.name} (${voice.voice_id}) · ${MODEL} · stability ${V.stability}`)
for (const [i, l] of lines.entries()) {
  if (only.length && !only.includes(l.beat.id)) continue
  let tries = 0, score = 0
  do {
    const { audio_base64, alignment } = await speak(voice.voice_id, spoken(l), lines[i - 1]?.say, lines[i + 1]?.say, l.speed)
    await writeFile(clip(l, 'mp3'), Buffer.from(audio_base64, 'base64'))
    await writeFile(clip(l, 'json'), JSON.stringify(alignment))
    score = await check(l)
    tries++
  } while (score < 0.86 && tries < 3)
  process.stdout.write(`${l.beat.id}-${l.n + 1}${tries > 1 ? `(${tries}×)` : ''}${score < 0.86 ? '!' : ''} `)
}
console.log()
await writeTimeline(voice.name, false)

// ---------------------------------------------------------------- the pieces
async function voices() {
  const res = await fetch(`${API}/voices`, { headers })
  if (!res.ok) fail(`voices: ElevenLabs answered ${res.status}: ${(await res.text()).slice(0, 200)}`)
  return (await res.json()).voices || []
}
async function pickVoice() {
  const all = await voices()
  const want = process.env.ELEVENLABS_VOICE
  const v = want
    ? all.find((x) => x.voice_id === want || x.name.toLowerCase().startsWith(want.toLowerCase()))
    : PREFERRED.map((n) => all.find((x) => x.name.toLowerCase().startsWith(n.toLowerCase()))).find(Boolean)
  if (!v) fail(`No voice ${want ? `"${want}"` : `among ${PREFERRED.join(', ')}`} on this account. List them: --voices`)
  return v
}
async function speak(voiceId, text, prev, next, speed) {
  const voice_settings = { stability: V.stability, similarity_boost: V.similarity, ...(speed ? { speed } : {}), ...(MODEL.startsWith('eleven_v4') ? {} : { style: 0.18, use_speaker_boost: true }) }
  const res = await fetch(`${API}/text-to-speech/${voiceId}/with-timestamps?output_format=${FORMAT}`, {
    method: 'POST', headers,
    body: JSON.stringify({ text, model_id: MODEL, voice_settings, apply_text_normalization: 'on', previous_text: prev, next_text: next }),
  })
  if (!res.ok) fail(`ElevenLabs answered ${res.status}: ${(await res.text()).slice(0, 300)}`)
  return res.json()
}
/** Scribe v2 on the clip, against the line: the share of the line's words heard, in order (0..1) */
async function check(l) {
  const form = new FormData()
  form.append('model_id', 'scribe_v2')
  form.append('language_code', 'en')
  form.append('file', new Blob([await readFile(clip(l, 'mp3'))], { type: 'audio/mpeg' }), 'line.mp3')
  const res = await fetch(`${API}/speech-to-text`, { method: 'POST', headers: { 'xi-api-key': KEY }, body: form })
  if (!res.ok) { console.warn(`check ${l.beat.id}-${l.n + 1}: Scribe answered ${res.status}`); return 1 }
  const heard = norm((await res.json()).text || '')
  const want = norm(l.say)
  // longest common subsequence of words, over the line's length: a skipped, swapped or invented word costs
  const dp = Array.from({ length: want.length + 1 }, () => new Array(heard.length + 1).fill(0))
  for (let i = 1; i <= want.length; i++) for (let j = 1; j <= heard.length; j++) dp[i][j] = want[i - 1] === heard[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1])
  const extra = Math.max(0, heard.length - want.length)
  return Math.max(0, (dp[want.length][heard.length] - extra * 0.5) / want.length)
}
function norm(s) {
  return s.toLowerCase().replace(/\[[^\]]*\]/g, ' ').replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim().split(' ')
    .filter((w) => w && !NUMBERISH.test(w))
    .map((w) => NAMES.find(([re]) => re.test(w))?.[1] || w)
}

/** A beat: the lead-in, each line and the pause after it, then a tail long enough for the last line to land. */
function beatLength(b, durs) {
  return V.lead + durs.reduce((s, d) => s + d, 0) + b.lines.slice(0, -1).reduce((s, l) => s + (l.pause ?? V.pause), 0) + Math.max(V.tail, b.lines.at(-1).pause ?? 0)
}
async function writeTimeline(voiceName, estimated) {
  const timeline = { voice: voiceName, model: estimated ? null : MODEL, ...(estimated ? { estimated: true } : {}), beats: [], length: 0 }
  const cues = []
  let at = 0
  for (const b of beats) {
    const beat = { id: b.id, role: b.role, actor: b.actor || null, start: at, lines: [], cues: {} }
    let t = V.lead
    for (const [n, l] of b.lines.entries()) {
      const file = clip({ beat: b, n }, 'json')
      let dur, a = null
      if (estimated) dur = (words(l.say) / WPM) * 60
      else {
        if (!existsSync(file)) fail(`${b.id}-${n + 1} has no clip yet: run without beat names once`)
        a = JSON.parse(await readFile(file, 'utf8'))
        dur = a.character_end_times_seconds.at(-1)
      }
      beat.lines.push({ n: n + 1, file: estimated ? null : clip({ beat: b, n }, 'mp3').pathname.replace(/^\/(\w:)/, '$1'), at: t, dur, say: l.say })
      if (l.cue) beat.cues[l.cue] = t
      if (a) for (const [s, e, text] of captions(l, a)) cues.push([at + t + s, at + t + e, text])
      t += dur + (n < b.lines.length - 1 ? (l.pause ?? V.pause) : 0)
    }
    beat.voiceEnd = t
    beat.length = +(t + Math.max(V.tail, b.lines.at(-1).pause ?? 0)).toFixed(3)
    timeline.beats.push(beat)
    at += beat.length
  }
  timeline.length = +at.toFixed(3)
  await writeFile(new URL('timeline.json', out), JSON.stringify(timeline, null, 2))
  if (!estimated) await writeFile(new URL('voiceover.srt', out), cues.map(([s, e, t], i) => `${i + 1}\n${srt(s)} --> ${srt(e)}\n${t}\n`).join('\n'))
  for (const b of timeline.beats) console.log(`${b.id.padEnd(8)} ${clock(b.start)}  ${b.length.toFixed(1).padStart(5)} s`)
  console.log(`total ${clock(timeline.length)} of ${clock(LIMIT)}${timeline.length > LIMIT ? '  OVER' : ''}`)
}

function fail(msg) { console.error(msg); process.exit(1) }
function clock(s) { const r = Math.round(s); return `${Math.floor(r / 60)}:${String(r % 60).padStart(2, '0')}` }
function srt(s) {
  const ms = Math.round(s * 1000), p = (n, w = 2) => String(n).padStart(w, '0')
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`
}
// caption spans inside one line, timed from the clip's alignment (which also covers the tag sent before the line):
// the whole line, or split at a comma, colon or full stop when it runs past 84 characters
function captions(l, a) {
  const sent = spoken(l)
  const off = sent.length - l.say.length
  const k = a.characters.length / sent.length
  const at = (i, end) => (end ? a.character_end_times_seconds : a.character_start_times_seconds)[Math.min(a.characters.length - 1, Math.max(0, Math.round((i + off) * k) - (end ? 1 : 0)))]
  const text = l.say.replace(/\.\.\./g, '…')
  const spans = []
  let from = 0
  while (text.length - from > 84) {
    const piece = text.slice(from, from + 84)
    const cut = Math.max(piece.lastIndexOf(', '), piece.lastIndexOf(': '), piece.lastIndexOf('. '))
    const step = cut > 20 ? cut + 2 : piece.lastIndexOf(' ') + 1
    spans.push([from, from + step]); from += step
  }
  spans.push([from, text.length])
  // the ellipsis is one character in the caption and three in the clip: map back by the same ratio
  const r = l.say.length / text.length
  return spans.map(([f, t]) => [at(Math.round(f * r), false), at(Math.round(t * r), true), wrap(text.slice(f, t).trim())])
}
function wrap(t) {
  if (t.length <= 42) return t
  const mid = t.length / 2
  let best = -1
  for (let i = t.indexOf(' '); i !== -1; i = t.indexOf(' ', i + 1)) if (best < 0 || Math.abs(i - mid) < Math.abs(best - mid)) best = i
  return best < 0 ? t : `${t.slice(0, best)}\n${t.slice(best + 1)}`
}
