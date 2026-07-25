/**
 * Episode generation pipeline.
 *
 * URL -> extract -> script -> synthesize -> upload -> persist.
 *
 * Emits a progress event at every stage boundary so the route can stream them
 * to the browser; generation takes 30-90 seconds and a UI that shows only a
 * spinner for that long is indistinguishable from one that has hung.
 *
 * Connectors are injected so this whole pipeline can be exercised with fakes
 * and no network — the same arrangement stonkie uses in `services/recap_audio.py`.
 */

import {
  extractArticle,
  isExtractionError,
  safeParseUrl,
  type ArticleExtractor,
} from '@/lib/connectors/extract'
import { countWords, createScriptWriter, type ScriptWriter } from '@/lib/connectors/script-writer'
import { createTts, type TtsEngine } from '@/lib/connectors/tts'
import { audioKey, uploadAudio, type AudioUploader } from '@/lib/connectors/storage'
import { createEpisode, updateEpisode } from '@/lib/db/episodes'
import type { Episode } from '@/lib/db/schema'
import { DEFAULT_VOICE, EPISODE_STATUS, type GenerationStage, type LengthPreset } from '@/lib/options'

export type ProgressEvent =
  | { type: 'progress'; stage: GenerationStage; message: string; episodeId?: number }
  | { type: 'done'; episode: Episode }
  | { type: 'error'; message: string; episodeId?: number }

export type GenerateOptions = {
  url: string
  voice?: string
  length?: LengthPreset
}

/**
 * The pipeline's four external dependencies, each a plain function.
 *
 * A test supplies literals — `{ extract: async () => article, writeScript: async
 * () => script, ... }` — with no fake classes to define and no interfaces to
 * implement.
 */
export type Connectors = {
  extract: ArticleExtractor
  writeScript: ScriptWriter
  synthesize: TtsEngine
  uploadAudio: AudioUploader
}

/**
 * Production wiring. Called per generation rather than at module load, because
 * building the OpenAI-backed connectors reads OPENAI_API_KEY and throws when it
 * is missing — which would take down every route that imports this module.
 */
function defaultConnectors(): Connectors {
  return {
    extract: extractArticle,
    writeScript: createScriptWriter(),
    synthesize: createTts(),
    uploadAudio,
  }
}

/**
 * Runs the pipeline, yielding progress as it goes.
 *
 * An async generator rather than a callback so the route can `for await` it
 * straight into an SSE stream, and so a thrown error unwinds through normal
 * try/catch instead of a separate error channel.
 */
export async function* generateEpisode(
  options: GenerateOptions,
  connectors: Connectors = defaultConnectors(),
): AsyncGenerator<ProgressEvent> {
  const { extract, writeScript, synthesize, uploadAudio: upload } = connectors
  const voice = options.voice ?? DEFAULT_VOICE

  // Validated before the row is written so a bad URL never leaves a failed
  // episode in the library.
  const parsedUrl = safeParseUrl(options.url)
  const url = parsedUrl.toString()
  const site = parsedUrl.hostname.replace(/^www\./, '')

  const episode = await createEpisode({
    url,
    title: site,
    sourceSite: site,
    voice,
    status: EPISODE_STATUS.generating,
  })

  try {
    yield {
      type: 'progress',
      stage: 'extracting',
      message: `Reading ${site}…`,
      episodeId: episode.id,
    }
    const article = await extract(url)
    await updateEpisode(episode.id, { title: article.title })

    yield {
      type: 'progress',
      stage: 'writing',
      message:
        article.via === 'jina'
          ? 'Page needed rendering — writing the script…'
          : 'Writing the script…',
      episodeId: episode.id,
    }
    const script = await writeScript(article, { length: options.length })
    const wordCount = countWords(script.script)
    await updateEpisode(episode.id, {
      title: script.title,
      summary: script.summary,
      script: script.script,
      wordCount,
    })

    yield {
      type: 'progress',
      stage: 'synthesizing',
      message: `Recording ${wordCount} words in ${voice}…`,
      episodeId: episode.id,
    }
    const synthesis = await synthesize(script.script, { voice })

    yield {
      type: 'progress',
      stage: 'uploading',
      message: 'Saving the audio…',
      episodeId: episode.id,
    }
    const stored = await upload(
      audioKey(episode.id, script.title),
      synthesis.audio,
      synthesis.contentType,
    )

    const saved = await updateEpisode(episode.id, {
      audioUrl: stored.url,
      audioPathname: stored.pathname,
      durationS: synthesis.durationS,
      status: EPISODE_STATUS.ready,
      error: null,
    })

    yield { type: 'done', episode: saved ?? episode }
  } catch (err) {
    const message = toUserMessage(err)
    await updateEpisode(episode.id, { status: EPISODE_STATUS.failed, error: message })
    yield { type: 'error', message, episodeId: episode.id }
  }
}

/**
 * Maps an internal failure to something worth showing a person.
 *
 * `ExtractionError` messages are written for the user already. Everything else
 * gets a generic line per class of failure — upstream SDK errors leak model
 * names, request ids, and occasionally key prefixes.
 */
function toUserMessage(err: unknown): string {
  if (isExtractionError(err)) return err.message

  const raw = err instanceof Error ? err.message : String(err)

  if (/api key|401|unauthorized/i.test(raw)) {
    return 'The OpenAI API key is missing or invalid. Check OPENAI_API_KEY.'
  }
  if (/rate limit|429/i.test(raw)) {
    return 'OpenAI rate-limited the request. Wait a moment and try again.'
  }
  if (/quota|billing|insufficient_quota/i.test(raw)) {
    return 'The OpenAI account is out of quota.'
  }
  if (/BLOB_READ_WRITE_TOKEN|blob/i.test(raw)) {
    return 'Could not save the audio to Vercel Blob. Check BLOB_READ_WRITE_TOKEN.'
  }
  if (/timeout|aborted|ETIMEDOUT/i.test(raw)) {
    return 'The request timed out. Try a shorter episode length.'
  }

  console.error('generate_episode.failed', err)
  return 'Generation failed unexpectedly. Check the server logs for details.'
}
