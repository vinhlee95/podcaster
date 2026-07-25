/**
 * LLM connector that turns extracted article text into a speakable podcast script.
 *
 * Kept separate from `tts.ts` because it is a different upstream call (chat
 * completions, not audio) and will want a different model as quality is tuned.
 * Services inject this; tests pass a fake.
 *
 * Prompt rules follow stonkie's `script_writer.py`: spoken prose only, numbers
 * and abbreviations expanded for the ear, no greeting and no sign-off — a
 * generated clip that opens with "welcome back to the show" is the single most
 * obvious tell that nobody wrote it.
 */

import OpenAI from 'openai'
import { LENGTH_PRESETS, type LengthPreset } from '@/lib/options'

// Re-exported so server code can reach them from the connector it already imports.
export { LENGTH_PRESETS, type LengthPreset } from '@/lib/options'

export const SCRIPT_MODEL = 'gpt-4o-mini'

export type ScriptResult = {
  /** Episode title — the article's own, tightened for a podcast feed. */
  title: string
  /** One-sentence hook shown on the episode card. */
  summary: string
  /** The script to synthesize. */
  script: string
}

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', description: 'Episode title, under 80 characters.' },
    summary: { type: 'string', description: 'One-sentence hook, under 200 characters.' },
    script: { type: 'string', description: 'The spoken script.' },
  },
  required: ['title', 'summary', 'script'],
  additionalProperties: false,
} as const

function buildPrompt(article: { title: string; text: string; site: string }, words: number): string {
  return `Turn the article below into a script for a single host to read aloud.

Rules for the script:
- Plain spoken prose only. No headings, no markdown, no bullet points, no stage directions, no speaker labels.
- Expand abbreviations and symbols for the ear: "AI" -> "A.I.", "$4.2B" -> "four point two billion dollars", "-2.21%" -> "down two point two one percent".
- Keep every figure exactly as the article gives it. Never round, never approximate, never invent a number.
- Cover the article's substantive points in its own order. Do not add facts, opinions, or context that is not in the source.
- Start immediately with the most interesting thing in the article. NO greeting, NO "welcome back", NO "today we're looking at", NO scene-setting preamble. The first sentence must carry real information.
- End on the last substantive point. NO sign-off, NO "thanks for listening", NO call to action.
- Attribute the source naturally once, early — for example "${article.site} reports that ...".
- Aim for about ${words} words. Going somewhat under is fine if the article is thin; do not pad.

Rules for the title and summary:
- Title: what the episode is about, under 80 characters, no clickbait.
- Summary: one sentence, under 200 characters, describing what the listener will learn.

Source: ${article.site}
Article title: ${article.title}

Article text:
${article.text}`
}

export type ArticleInput = { title: string; text: string; site: string }

/** The script-writing seam. A test passes any function of this shape. */
export type ScriptWriter = (
  article: ArticleInput,
  options?: { length?: LengthPreset },
) => Promise<ScriptResult>

/**
 * Builds a script writer bound to an OpenAI client and model.
 *
 * The config lives in the closure instead of on `this`, so the returned value is
 * just a function — callers depend on the call signature, not on a type that
 * happens to have a `.write` method.
 *
 * `new OpenAI()` reads OPENAI_API_KEY and throws when it is unset, so the client
 * is created here (at wiring time) rather than at module load.
 */
export function createScriptWriter(config: { client?: OpenAI; model?: string } = {}): ScriptWriter {
  const client = config.client ?? new OpenAI()
  const model = config.model ?? SCRIPT_MODEL

  return async (article, options = {}) => {
    const preset = LENGTH_PRESETS[options.length ?? 'standard']

    const response = await client.chat.completions.create({
      model,
      messages: [{ role: 'user', content: buildPrompt(article, preset.words) }],
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'podcast_script', strict: true, schema: RESPONSE_SCHEMA },
      },
    })

    const raw = response.choices[0]?.message?.content
    if (!raw) throw new Error('The script model returned an empty response.')

    let parsed: ScriptResult
    try {
      parsed = JSON.parse(raw) as ScriptResult
    } catch {
      throw new Error('The script model returned malformed JSON.')
    }

    const script = parsed.script?.trim()
    if (!script) throw new Error('The script model returned an empty script.')

    return {
      title: parsed.title?.trim() || article.title,
      summary: parsed.summary?.trim() || '',
      script,
    }
  }
}

export function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length
}
