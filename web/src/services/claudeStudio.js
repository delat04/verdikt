/*  ============================================================================
    AG Studio's AI, answered by Claude. Studio hands its adapter one turn of its agent loop at a time
    (the conversation, its instructions and tool schemas); this sends the turn to Verdikt's API, which
    asks Claude and streams the reply back as AG-UI events, one JSON object per line. Studio runs the
    tools itself, here in the browser, against the dashboard.
    `offline` is what to say instead when the API has no Claude for this caller (the demo, unless the
    server gives it a budget): the assistant answers with that one honest line rather than an error.
    ============================================================================ */

// deployed, the API serves this app from the same origin; in development it runs on :4100
const BASE = import.meta.env.VITE_API_URL || (import.meta.env.PROD ? '' : 'http://localhost:4100')
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

export function claudeAdapter({ path, token, offline }) {
  return {
    executeTurn(request, { signal } = {}) {
      let resolve, reject
      const complete = new Promise((res, rej) => { resolve = res; reject = rej })
      complete.catch(() => {})
      async function* events() {
        let response = null
        let error = null
        try {
          const auth = token ? await token() : null
          const res = await fetch(`${BASE}/api${path}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...(auth && { Authorization: `Bearer ${auth}` }) },
            body: JSON.stringify(request),
            signal,
          })
          if (!res.ok) {
            const message = (await res.json().catch(() => ({}))).error || `Request failed (${res.status})`
            if (offline && [403, 404].includes(res.status)) response = yield* say(offline)
            else throw new Error(message)
          } else {
            const reader = res.body.getReader()
            const decoder = new TextDecoder()
            let buffer = ''
            for (;;) {
              const { done, value } = await reader.read()
              if (done) break
              buffer += decoder.decode(value, { stream: true })
              let i
              while ((i = buffer.indexOf('\n')) >= 0) {
                const line = buffer.slice(0, i).trim()
                buffer = buffer.slice(i + 1)
                if (!line) continue
                const msg = JSON.parse(line)
                if (msg.e) yield msg.e
                else if (msg.done) response = msg.done
                else if (msg.error) error = new Error(msg.error)
              }
            }
          }
        } catch (e) {
          // no API at all behind a static demo: the fetch itself fails
          if (offline && e instanceof TypeError && !response) response = yield* say(offline)
          else error ??= e
        }
        if (error) reject(error)
        else if (response) resolve(response)
        else reject(new Error('Claude’s reply ended early'))
      }
      const stream = events()
      return { stream: { [Symbol.asyncIterator]: () => stream }, complete }
    },
  }
}

/** One assistant message, streamed word by word; returns the response it amounts to. */
async function* say(text) {
  const id = `msg_${Math.random().toString(36).slice(2, 10)}`
  yield { type: 'TEXT_MESSAGE_START', messageId: id, role: 'assistant' }
  for (const word of text.split(/(?<= )/)) {
    await wait(18)
    yield { type: 'TEXT_MESSAGE_CONTENT', messageId: id, delta: word }
  }
  yield { type: 'TEXT_MESSAGE_END', messageId: id }
  return {
    id, createdAt: Date.now(), status: 'completed',
    output: [{ id, kind: 'output', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'text', text, annotations: [] }] }],
  }
}
