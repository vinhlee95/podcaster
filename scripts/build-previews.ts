/**
 * Generates the voice samples served from `public/previews/`.
 *
 *     npm run previews
 *
 * These are the only TTS calls the preview feature ever makes, and they happen
 * here rather than at request time: the samples are fixed at author time, so a
 * route synthesizing them on demand would be paying OpenAI to rebuild a build
 * artifact. Run this after changing `VOICE_PREVIEW_TEXT`, `VOICE_INSTRUCTIONS`,
 * `TTS_MODEL`, or the `VOICES` list, and commit the result.
 */

import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { config } from 'dotenv'
import { createTts, TTS_MODEL, VOICE_INSTRUCTIONS } from '@/lib/connectors/tts'
import { VOICES, VOICE_PREVIEW_TEXT } from '@/lib/options'

config({ path: '.env.local' })

const OUT_DIR = path.join(process.cwd(), 'public', 'previews')

async function main() {
  await mkdir(OUT_DIR, { recursive: true })
  const synthesize = createTts()

  // Eight independent calls; no reason to wait for each in turn.
  await Promise.all(
    VOICES.map(async (voice) => {
      const { audio } = await synthesize(VOICE_PREVIEW_TEXT, { voice: voice.id })
      await writeFile(path.join(OUT_DIR, `${voice.id}.mp3`), audio)
      console.log(`${voice.id}.mp3  ${Math.round(audio.length / 1024)} KB`)
    }),
  )

  // Written alongside the audio so a stale regeneration is visible in review:
  // edit the sample text without rerunning this and the diff shows options.ts
  // and this file disagreeing.
  const manifest = {
    model: TTS_MODEL,
    text: VOICE_PREVIEW_TEXT,
    instructions: VOICE_INSTRUCTIONS,
    voices: VOICES.map((v) => v.id),
  }
  await writeFile(path.join(OUT_DIR, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
}

main().catch((err) => {
  console.error('Preview generation failed:', err instanceof Error ? err.message : err)
  process.exitCode = 1
})
