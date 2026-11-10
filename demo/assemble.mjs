/*  The finished demo video from record.mjs's frames and voiceover.mjs's clips
    Writes demo/out/verdikt-demo.mp4 (1080p30 H.264, AAC) and verdikt-demo-captions.mp4 (captions burned in),
    plus contact.jpg, a sheet of stills every few seconds for a quick look.
      · picture: each beat's frames at 30 fps for exactly the beat's length on the timeline; a take that ran long
        is sped up evenly to fit (record.mjs warns past 0.4 s), one that ran short holds its last frame
      · sound: every voice line at its own moment (timeline.json), a music bed when out/voice/music.mp3 exists,
        ducked under the voice, then levelled to -16 LUFS (YouTube's loudness), peaks under -1.5 dBTP
    FFMPEG=path/to/ffmpeg.exe node demo/assemble.mjs        (a full ffmpeg build: libx264, aac, libass)
*/
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const FFMPEG = process.env.FFMPEG || 'ffmpeg'
const FPS = 30
const here = new URL('.', import.meta.url)
const p = (rel) => fileURLToPath(new URL(rel, here)).replace(/\\/g, '/')
const OUT = p('out/verdikt-demo.mp4')
const TL = JSON.parse(await readFile(new URL('out/voice/timeline.json', here), 'utf8'))
const music = existsSync(p('out/voice/music.mp3')) ? p('out/voice/music.mp3') : null
const voiced = !TL.estimated
const total = TL.length

// ---- sound, three buses: the voice (every line at its own moment, through a broadcast chain), the score (its
// sections already turn where the acts do, ducked under the voice) and the effects record.mjs marked
const SCRIPT = JSON.parse(await readFile(new URL('script.json', here), 'utf8'))
const LIB = SCRIPT.sfx || {}
const lines = voiced ? TL.beats.flatMap((b) => b.lines.map((l) => ({ file: l.file, at: b.start + l.at }))) : []
const marked = []
for (const b of TL.beats) {
  const f = p(`out/frames/${b.id}/times.json`)
  if (!existsSync(f)) continue
  const { length, events = [] } = JSON.parse(await readFile(f, 'utf8'))
  const scale = length > b.length ? length / b.length : 1     // a sped-up take's moments move with it
  for (const e of events) {
    const file = p(`out/sfx/${e.name}.mp3`)
    const at = b.start + e.t / scale
    if (LIB[e.name] && existsSync(file) && at >= 0 && at < total - 0.2) marked.push({ ...e, file, at, gain: LIB[e.name].gain ?? -15 })
  }
}
// one sound per moment: a click right on top of another sound is dropped, and so is a click 120 ms after a click
const effects = marked.sort((a, b) => a.at - b.at).filter((e, i, all) => e.name !== 'click'
  || !all.some((o, j) => j !== i && ((o.name !== 'click' && Math.abs(o.at - e.at) < 0.25) || (o.name === 'click' && j < i && e.at - o.at < 0.12))))
// generated effects arrive at very different levels (a click peaking at -12 dB, typing at -28): each is brought to
// a 0 dB peak first, so the library's gain is simply how far under the voice's peak it sits
const peaks = {}
for (const name of new Set(effects.map((e) => e.name))) peaks[name] = await peakOf(p(`out/sfx/${name}.mp3`))
for (const e of effects) e.gain = +(e.gain - peaks[e.name]).toFixed(1)
const inputs = [...lines.flatMap((l) => ['-i', l.file]), ...(music ? ['-stream_loop', '-1', '-i', music] : []), ...effects.flatMap((e) => ['-i', e.file])]
const n = lines.length
const m = n + 1                                   // the music's input
const fx0 = n + 1 + (music ? 1 : 0)               // the first effect's input
let audio = ''
if (n) {
  // voice: the lines laid in, then a gentle broadcast chain: rumble cut, de-ess, a little less mud and a little
  // more presence, and an even compressor
  audio += lines.map((l, i) => `[${i + 1}:a]aresample=48000,adelay=${Math.round(l.at * 1000)}:all=1[v${i}]`).join(';')
  audio += `;${lines.map((_, i) => `[v${i}]`).join('')}amix=inputs=${n}:normalize=0:duration=longest,highpass=f=80,deesser=i=0.35,equalizer=f=220:t=q:w=1.2:g=-1.5,equalizer=f=3200:t=q:w=1.4:g=1.8,acompressor=threshold=-21dB:ratio=3:attack=6:release=140:makeup=2.5,apad=whole_dur=${total}[voice]`
  const buses = ['[vo]']
  audio += ';[voice]asplit=2[vo][key]'
  if (music) {
    audio += `;[${m}:a]aresample=48000,atrim=0:${total},volume=-12dB,afade=t=in:d=1.2,afade=t=out:st=${Math.max(0, total - 4)}:d=4[bed];[bed][key]sidechaincompress=threshold=0.025:ratio=5:attack=30:release=520[ducked]`
    buses.push('[ducked]')
  } else audio += ';[key]anullsink'
  if (effects.length) {
    audio += ';' + effects.map((e, j) => `[${fx0 + j}:a]aresample=48000,volume=${e.gain}dB,adelay=${Math.round(e.at * 1000)}:all=1[f${j}]`).join(';')
    audio += `;${effects.map((_, j) => `[f${j}]`).join('')}amix=inputs=${effects.length}:normalize=0:duration=longest,apad=whole_dur=${total}[fx]`
    buses.push('[fx]')
  }
  audio += `;${buses.join('')}amix=inputs=${buses.length}:normalize=0:duration=first,loudnorm=I=-16:TP=-1.5:LRA=11,alimiter=limit=0.85:level=false,aresample=48000[a]`
}
if (effects.length) console.log(`effects: ${effects.length} (${[...new Set(effects.map((e) => e.name))].map((k) => `${k} ×${effects.filter((e) => e.name === k).length}`).join(', ')})`)

const args = ['-y', '-hide_banner', '-loglevel', 'error',
  '-f', 'image2pipe', '-c:v', 'mjpeg', '-framerate', String(FPS), '-i', 'pipe:0',
  ...inputs,
  '-filter_complex', `[0:v]scale=1920:1080:flags=lanczos:out_color_matrix=bt709:out_range=tv,format=yuv420p[v]${audio ? `;${audio}` : ''}`,
  '-map', '[v]', ...(audio ? ['-map', '[a]', '-c:a', 'aac', '-b:a', '192k', '-ac', '2'] : []),
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-r', String(FPS), '-pix_fmt', 'yuv420p',
  // screen frames are full-range JPEGs: tagged and converted to broadcast range so every player shows the same colours
  '-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
  '-t', String(total), '-movflags', '+faststart', OUT]
const ff = spawn(FFMPEG, args, { stdio: ['pipe', 'inherit', 'inherit'] })
const done = new Promise((res, rej) => ff.on('close', (code) => (code ? rej(new Error(`ffmpeg exited ${code}`)) : res())))
const write = (buf) => (ff.stdin.write(buf) ? null : new Promise((r) => ff.stdin.once('drain', r)))

let written = 0
for (const b of TL.beats) {
  const dir = p(`out/frames/${b.id}`)
  if (!existsSync(`${dir}/times.json`)) throw new Error(`no frames for ${b.id}: run record.mjs`)
  const { length, times } = JSON.parse(await readFile(`${dir}/times.json`, 'utf8'))
  const files = (await readdir(dir)).filter((f) => f.endsWith('.jpg')).sort()
  // frames for this beat, so the picture never drifts from the sound: the beat ends at its timeline end
  const count = Math.round((b.start + b.length) * FPS) - written
  const scale = length > b.length ? length / b.length : 1
  let k = 0, cached = -1, buf = null
  for (let i = 0; i < count; i++) {
    const t = (i / FPS) * scale
    while (k + 1 < times.length && times[k + 1] <= t) k++
    if (k !== cached) { buf = await readFile(`${dir}/${files[k]}`); cached = k }
    await write(buf)
  }
  written += count
  console.log(`${b.id.padEnd(7)} ${(count / FPS).toFixed(1).padStart(5)} s${scale > 1.001 ? `  (take sped up ${scale.toFixed(2)}×)` : ''}`)
}
ff.stdin.end()
await done
console.log(`${OUT}: ${total.toFixed(1)} s${voiced ? '' : ' (silent rehearsal: no voice yet)'}${music ? ', with the music bed' : ''}`)

// ---- captions burned in, for viewers with the sound off
if (voiced && existsSync(p('out/voice/voiceover.srt'))) {
  const srt = p('out/voice/voiceover.srt').replace(/^(\w):/, '$1\\:')
  const style = "FontName=Segoe UI,FontSize=17,PrimaryColour=&H00FFFFFF,OutlineColour=&H00121212,BackColour=&H96121212,BorderStyle=4,Outline=0,Shadow=0,MarginV=34,Alignment=2"
  await run(['-y', '-hide_banner', '-loglevel', 'error', '-i', OUT, '-vf', `subtitles='${srt}':force_style='${style}'`, '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-c:a', 'copy', '-movflags', '+faststart', OUT.replace('.mp4', '-captions.mp4')])
  console.log('captions version written')
}

// ---- a contact sheet: one still every 6 s, 6 across
await run(['-y', '-hide_banner', '-loglevel', 'error', '-i', OUT, '-vf', 'fps=1/6,scale=480:-1,tile=6x5:padding=6:margin=6', '-frames:v', '1', '-q:v', '3', p('out/contact.jpg')])
console.log(`${p('out/contact.jpg')}`)

/** a file's sample peak in dBFS (ffmpeg's volumedetect) */
function peakOf(file) {
  return new Promise((res, rej) => {
    let err = ''
    const x = spawn(FFMPEG, ['-hide_banner', '-i', file, '-af', 'volumedetect', '-f', 'null', '-'], { stdio: ['ignore', 'ignore', 'pipe'] })
    x.stderr.on('data', (d) => { err += d })
    x.on('close', () => { const m = err.match(/max_volume:\s*(-?[\d.]+) dB/); m ? res(+m[1]) : rej(new Error(`no peak for ${file}`)) })
  })
}

function run(a) {
  return new Promise((res, rej) => { const x = spawn(FFMPEG, a, { stdio: 'inherit' }); x.on('close', (c) => (c ? rej(new Error(`ffmpeg exited ${c}`)) : res())) })
}
