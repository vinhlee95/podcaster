/**
 * Text-to-speech connector.
 *
 * All TTS I/O lives here; services inject this connector and never touch the
 * OpenAI SDK directly. The engine is swappable behind `TtsEngine` (ElevenLabs
 * or a local model can be added as sibling classes).
 *
 * Ported from stonkie's `connectors/tts.py`, with one addition it did not need:
 * chunking. Stonkie synthesizes short market recaps that always fit in a single
 * call, but a full-article episode routinely exceeds OpenAI's per-request input
 * limit, so long scripts are split on sentence boundaries and the resulting mp3
 * buffers are concatenated.
 */

import OpenAI from 'openai'
import { DEFAULT_VOICE } from '@/lib/options'

// Re-exported so server code can reach them from the connector it already imports.
export { DEFAULT_VOICE, VOICES, type VoiceId } from '@/lib/options'

export const TTS_MODEL = 'gpt-4o-mini-tts'

/**
 * OpenAI rejects input over 4096 characters. Splitting a little below the limit
 * leaves room for the sentence splitter to land on a natural boundary rather
 * than being forced to cut mid-sentence.
 */
const MAX_CHUNK_CHARS = 3800

/**
 * Roughly 128kbps CBR mp3 -> bytes/sec, used to estimate duration without
 * pulling in an audio-decoding dependency just to read frame headers. It is a
 * seed only: the browser replaces it with the element's real `duration` on
 * `loadedmetadata` (see `lib/player/store.ts`).
 */
const MP3_BYTES_PER_SECOND = 128_000 / 8

export const VOICE_INSTRUCTIONS =
  'You are a warm, engaging podcast host. Speak naturally and conversationally, ' +
  'professional but friendly, with an enthusiastic yet relaxed pace. Let sentences ' +
  'breathe and use natural transitions between ideas.'

export type SynthesisResult = {
  audio: Buffer
  contentType: string
  durationS: number
}

/**
 * Splits `text` into pieces no longer than `maxChars`, preferring sentence
 * boundaries so a chunk seam never lands mid-word.
 *
 * A single sentence longer than `maxChars` (rare, but possible with a run-on
 * quote) is hard-split at the limit rather than dropped.
 */
export function chunkScript(text: string, maxChars: number = MAX_CHUNK_CHARS): string[] {
  const trimmed = text.trim()
  if (trimmed.length <= maxChars) return trimmed ? [trimmed] : []

  const sentences = trimmed.match(/[^.!?…]+(?:[.!?…]+["'”’)]*|\s*$)/g) ?? [trimmed]
  const chunks: string[] = []
  let current = ''

  for (const sentence of sentences) {
    if (sentence.length > maxChars) {
      if (current.trim()) {
        chunks.push(current.trim())
        current = ''
      }
      for (let i = 0; i < sentence.length; i += maxChars) {
        chunks.push(sentence.slice(i, i + maxChars).trim())
      }
      continue
    }

    if ((current + sentence).length > maxChars) {
      if (current.trim()) chunks.push(current.trim())
      current = sentence
    } else {
      current += sentence
    }
  }

  if (current.trim()) chunks.push(current.trim())
  return chunks.filter(Boolean)
}

export interface TtsEngine {
  synthesize(
    text: string,
    options?: { voice?: string; onChunk?: (done: number, total: number) => void },
  ): Promise<SynthesisResult>
}

export class OpenAITts implements TtsEngine {
  private client: OpenAI
  private model: string

  constructor(client?: OpenAI, model: string = TTS_MODEL) {
    this.client = client ?? new OpenAI()
    this.model = model
  }

  private async synthesizeChunk(text: string, voice: string): Promise<Buffer> {
    const response = await this.client.audio.speech.create({
      model: this.model,
      voice,
      input: text,
      instructions: VOICE_INSTRUCTIONS,
      response_format: 'mp3',
    })
    return Buffer.from(await response.arrayBuffer())
  }

  async synthesize(
    text: string,
    options: { voice?: string; onChunk?: (done: number, total: number) => void } = {},
  ): Promise<SynthesisResult> {
    const voice = options.voice ?? DEFAULT_VOICE
    const chunks = chunkScript(text)
    if (chunks.length === 0) throw new Error('Nothing to synthesize — the script was empty.')

    // Chunks are independent, so they are synthesized concurrently and
    // reassembled in order. A long script is 2-4 calls, which is well inside
    // rate limits and turns a serial minute into a parallel twenty seconds —
    // this runs inside a single request with a hard 300s ceiling.
    let done = 0
    options.onChunk?.(0, chunks.length)
    const buffers = await Promise.all(
      chunks.map(async (chunk) => {
        const buffer = await this.synthesizeChunk(chunk, voice)
        done += 1
        options.onChunk?.(done, chunks.length)
        return buffer
      }),
    )

    // Concatenating mp3 frame streams is valid: each frame carries its own
    // header, so a decoder reads straight through the seam. The joins are
    // audible only as a very short pause, which reads as a natural beat.
    const audio = Buffer.concat(buffers)

    return {
      audio,
      contentType: 'audio/mpeg',
      durationS: Math.round((audio.length / MP3_BYTES_PER_SECOND) * 10) / 10,
    }
  }
}
