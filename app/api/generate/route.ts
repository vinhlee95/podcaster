import { generateEpisode, type ProgressEvent } from '@/lib/services/generate-episode'
import { LENGTH_PRESETS, VOICES, type LengthPreset } from '@/lib/options'

/**
 * Streams episode generation as Server-Sent Events.
 *
 * The whole pipeline runs inside this one request. A deep-dive episode takes
 * 60-90s of that budget, which is why `maxDuration` is raised to the platform
 * ceiling rather than left at the default.
 */
export const maxDuration = 300

/** Node runtime: jsdom and Buffer in the pipeline are not available on edge. */
export const runtime = 'nodejs'

function sse(event: ProgressEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`
}

export async function POST(request: Request) {
  let body: { url?: string; voice?: string; length?: string }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Expected a JSON body.' }, { status: 400 })
  }

  const url = body.url?.trim()
  if (!url) {
    return Response.json({ error: 'A url is required.' }, { status: 400 })
  }

  // Validate the enums here rather than trusting them into the prompt and the
  // TTS call, where an unknown value would surface as an opaque 400 from OpenAI.
  const voice = VOICES.some((v) => v.id === body.voice) ? body.voice : undefined
  const length =
    body.length && body.length in LENGTH_PRESETS ? (body.length as LengthPreset) : undefined

  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of generateEpisode({ url, voice, length })) {
          controller.enqueue(encoder.encode(sse(event)))
        }
      } catch (err) {
        // `generateEpisode` handles its own failures; reaching here means
        // something threw before the pipeline's try block — a bad URL, or the
        // initial insert failing because DATABASE_URL is wrong.
        const message = err instanceof Error ? err.message : 'Generation failed.'
        controller.enqueue(encoder.encode(sse({ type: 'error', message })))
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      // Tells any intermediary proxy not to buffer, which would defeat the
      // point of streaming progress.
      'x-accel-buffering': 'no',
    },
  })
}
