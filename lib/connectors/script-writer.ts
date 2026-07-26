/**
 * LLM connector that turns extracted article text into a speakable podcast script.
 *
 * Kept separate from `tts.ts` because it is a different upstream call (chat
 * completions, not audio) and a different model — `tts.ts` speaks the text this
 * one writes. Services inject this; tests pass a fake.
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

/**
 * The model matters more than the prompt here, and it is worth saying why.
 *
 * On `gpt-4o-mini` a whole episode had to be written in several bounded passes
 * over slices of the article, because that model stops near a thousand words
 * whatever you ask for — 971 words against a 1,500 target given the full source,
 * and still only 1,030 given a 1,200-word source, so context was never the
 * constraint. Stitching passes together met the target but cost three sequential
 * calls and invented its own failure modes at the seams.
 *
 * This model holds a long target in one call: asked for 1,500 words on a
 * 13,000-word guide it returns ~1,500, faster than the three passes it replaces
 * and with more specifics per hundred words. Anything that sustains long output
 * works; drop back to a weaker one and the word targets will quietly go unmet.
 */
export const SCRIPT_MODEL = 'gpt-5.4-mini'

/**
 * Source-to-target word ratio above which the article cannot be covered, only
 * selected from.
 *
 * Below it, "cover the substantive points in order" is achievable and produces
 * the tighter script. Above it that instruction fights the word target, and the
 * model resolves the conflict by flattening everything to one shallow altitude —
 * a 13,000-word guide came back as 636 words of brand voice with every case
 * size, caliber and date dropped. So past this ratio the prompt stops asking for
 * coverage and asks for depth on a chosen thread instead.
 */
const SELECTION_RATIO = 1.6

/**
 * Attempts before the episode fails.
 *
 * Covers two transient faults: truncated JSON, which `JSON.parse` rejects, and a
 * script that stops mid-sentence, which parses fine and only looks wrong when
 * you read it. Both clear on a retry.
 */
const MAX_ATTEMPTS = 3

/**
 * Fraction of the target actually asked for.
 *
 * The model runs long by a fairly stable margin — asked for the preset's word
 * count verbatim it returned 117-136% of it across all three presets, and
 * rewording the instruction (a range, "hard target", "count as you go") moved
 * that by a few points at best. Since the presets are really duration promises,
 * a script 20% over is an episode 20% longer than the menu said, so the ask is
 * scaled down to land on the promise instead of the arithmetic.
 *
 * Recalibrate if `SCRIPT_MODEL` changes; the bias is a property of the model.
 */
const TARGET_CALIBRATION = 0.82

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

/**
 * The two rules that have to change together when the source outruns the target.
 *
 * They are a pair: telling the model to select rather than survey is useless if
 * the next line still says going under is fine, and demanding the full word
 * count is how you get padding when the article genuinely has nothing more to
 * give. Which pair applies is decided by `SELECTION_RATIO`.
 */
function coverageRules(sourceWords: number, words: number): string {
  if (sourceWords < words * SELECTION_RATIO) {
    return `- Cover the article's substantive points in its own order. Do not add facts, opinions, or context that is not in the source.
- Aim for about ${words} words. Going somewhat under is fine if the article is thin; do not pad.`
  }

  return `- The article runs about ${sourceWords} words, far more than fits in ${words}. Do not try to summarize all of it. Follow the article's own order and go into the specifics: the names, dates, figures, model designations and measurements that make it worth hearing. Skipping whole sections to stay in depth is correct. A shallow survey of everything is the failure case; a detailed account of part of it is the goal.
- Do not add facts, opinions, or context that is not in the source. Every specific must be traceable to the article text below.
- Length: no fewer than ${Math.round(words * 0.9)} words and no more than ${Math.round(words * 1.1)}. Count as you go. There is far more material than that, so plan which ground you can cover in the budget and stop taking on new material as you approach it — then finish the point you are on and stop. Do not pad past the ceiling with filler, repetition or restatement.`
}

/**
 * Rules that hold whatever the source length.
 *
 * The year and reference-number examples are not redundant with the currency and
 * percentage ones. Years are the most common numeral in an article and are the
 * first thing left as digits; catalogue numbers like "7924" are the second, and
 * TTS reads those as one number rather than a designation.
 */
function scriptRules(): string {
  return `- Plain spoken prose only. No headings, no markdown, no bullet points, no stage directions, no speaker labels.
- Write every number as words, with no digits anywhere in the script — years, measurements, model names and reference numbers included: "AI" -> "A.I.", "$4.2B" -> "four point two billion dollars", "-2.21%" -> "down two point two one percent", "1926" -> "nineteen twenty-six", "41mm" -> "forty-one millimeters", "Reference 7924" -> "Reference seventy-nine twenty-four".
- Keep every figure exactly as the article gives it. Never round, never approximate, never invent a number.
- Start immediately with the most interesting thing in the article. NO greeting, NO "welcome back", NO "today we're looking at", NO scene-setting preamble. The first sentence must carry real information.
- End on the last substantive point, with a complete sentence. NO sign-off, NO "thanks for listening", NO call to action.`
}

const META_RULES = `Rules for the title and summary:
- Title: what the episode is about, under 80 characters, no clickbait.
- Summary: one sentence, under 200 characters, describing what the listener will learn.`

function buildPrompt(article: ArticleInput, words: number): string {
  return `Turn the article below into a script for a single host to read aloud.

Rules for the script:
${scriptRules()}
- Attribute the source naturally once, within the first three sentences — for example "${article.site} reports that ...". Do not attribute it again at the end.
${coverageRules(countWords(article.text), words)}

${META_RULES}

Source: ${article.site}
Article title: ${article.title}

Article text:
${article.text}`
}

/**
 * Whether the script came back as finished prose rather than a fragment.
 *
 * A script that stops mid-sentence is the failure this guards: one came back at
 * 83 words ending "complemented by the signature", and nothing else in the
 * pipeline would have caught it — the text parses, stores and synthesizes
 * perfectly well, and only sounds wrong once it is read aloud.
 */
function endsCleanly(script: string): boolean {
  return /[.!?]["'”’)]?$/.test(script.trim())
}

/**
 * Cuts a fragment back to its last complete sentence.
 *
 * The last resort after the retries are spent. Losing a half-sentence is a
 * strictly better outcome than reading one aloud, and returning the fragment
 * unchanged is not an option — this text goes straight to TTS.
 */
function trimToLastSentence(script: string): string {
  const trimmed = script.trim()
  const end = Math.max(trimmed.lastIndexOf('.'), trimmed.lastIndexOf('!'), trimmed.lastIndexOf('?'))
  return end === -1 ? trimmed : trimmed.slice(0, end + 1)
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

  const attempt = async (prompt: string, fallbackTitle: string): Promise<ScriptResult> => {
    const response = await client.chat.completions.create({
      model,
      messages: [{ role: 'user', content: prompt }],
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
      title: parsed.title?.trim() || fallbackTitle,
      summary: parsed.summary?.trim() || '',
      script,
    }
  }

  return async (article, options = {}) => {
    const preset = LENGTH_PRESETS[options.length ?? 'standard']
    const prompt = buildPrompt(article, Math.round(preset.words * TARGET_CALIBRATION))

    let lastError: unknown
    let best: ScriptResult | undefined

    for (let n = 0; n < MAX_ATTEMPTS; n++) {
      try {
        const result = await attempt(prompt, article.title)
        if (endsCleanly(result.script)) return result
        // Truncated: keep the fullest one in case every attempt comes back short.
        if (!best || result.script.length > best.script.length) best = result
      } catch (err) {
        lastError = err
      }
    }

    if (best) return { ...best, script: trimToLastSentence(best.script) }
    throw lastError
  }
}

export function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length
}
