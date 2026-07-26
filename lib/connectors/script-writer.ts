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
 * Words to ask for in a single call.
 *
 * The model will not write a long script no matter how the ask is phrased. Given
 * the full 13,000-word guide and a 1,500-word target it returns ~970; given only
 * the first 1,200 words of that source and the same target it still returns
 * ~1,030. Context size is not the constraint — one completion simply tops out
 * near a thousand words. Asked for 400 words on a single section it returns 485.
 *
 * So a long target is met by writing several bounded passes and joining them,
 * not by asking harder. This value sits where the model is accurate rather than
 * where it saturates.
 */
const SEGMENT_TARGET_WORDS = 500

/** Words of the previous segment shown to the next, so the seam does not restate. */
const CONTINUITY_TAIL_WORDS = 90

/**
 * Attempts per pass before the episode fails.
 *
 * The model occasionally returns truncated JSON, which `JSON.parse` rejects and
 * which a plain retry fixes. That was survivable when a script was one call; a
 * three-pass script is three chances to hit it, and losing the whole episode to
 * one of them is not.
 */
const MAX_ATTEMPTS = 3

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

  return `- The article runs about ${sourceWords} words, far more than fits in ${words}. Do not try to summarize all of it. Pick the most substantive through-line and cover it properly, in the article's own order, following it into the specifics: the names, dates, figures, model designations and measurements that make it worth hearing. Skipping whole sections to do this is correct. A shallow survey of everything is the failure case; a detailed account of part of it is the goal.
- Do not add facts, opinions, or context that is not in the source. Every specific must be traceable to the article text below.
- Write about ${words} words. The source has far more material than that, so falling short means you stopped early, not that you ran out — go further into the detail you are already covering rather than wrapping up. Do not pad with filler, repetition, or restatement.`
}

/**
 * Rules that hold for every pass.
 *
 * The year example is not redundant with the currency and percentage ones: years
 * are by far the most common numeral in an article and the model leaves them as
 * digits unless it is shown one being spoken.
 */
function scriptRules(): string {
  return `- Plain spoken prose only. No headings, no markdown, no bullet points, no stage directions, no speaker labels.
- Expand every abbreviation, symbol and numeral for the ear: "AI" -> "A.I.", "$4.2B" -> "four point two billion dollars", "-2.21%" -> "down two point two one percent", "1926" -> "nineteen twenty-six", "41mm" -> "forty-one millimeters". No digits anywhere in the script.
- Keep every figure exactly as the article gives it. Never round, never approximate, never invent a number.`
}

const META_RULES = `Rules for the title and summary:
- Title: what the episode is about, under 80 characters, no clickbait.
- Summary: one sentence, under 200 characters, describing what the listener will learn.`

/** Where a segment sits in the finished script — decides how it opens and closes. */
type SegmentPosition = { index: number; total: number; previousTail?: string }

function positionRules(article: { site: string }, { index, total, previousTail }: SegmentPosition): string {
  const opening =
    index === 0
      ? `- Start immediately with the most interesting thing in the section. NO greeting, NO "welcome back", NO "today we're looking at", NO scene-setting preamble. The first sentence must carry real information.
- Attribute the source naturally once, within the first three sentences — for example "${article.site} reports that ...". Do not attribute it again.`
      : `- This continues a script already in progress. Pick up mid-flow: no greeting, no recap of what came before, no "as we saw", no restating the topic. The first sentence must carry new information.
- Do not attribute the source again; that was already done.
- The previous part ended with the text quoted below. Continue naturally from where it stops and do not repeat its content. The quote is context only — do not copy it, and do not open with an ellipsis or any other continuation marker. Begin with a complete sentence.

Previous part ended:
"""
${previousTail}
"""`

  const closing =
    index === total - 1
      ? `- End on the last substantive point. NO sign-off, NO "thanks for listening", NO call to action, NO summing up.`
      : `- More parts follow this one. Stop when you reach the word count, mid-thread if need be. NO concluding sentence, NO summing up, NO teaser for what is next.`

  return `${opening}\n${closing}`
}

/**
 * Prompt for one bounded pass over one slice of the article.
 *
 * A single-segment script is just the `index 0 of 1` case, so the one-call path
 * and the segmented path share this and cannot drift apart.
 */
function buildSegmentPrompt(
  article: ArticleInput,
  slice: string,
  words: number,
  position: SegmentPosition,
): string {
  const { index, total } = position
  const part = total > 1 ? ` This is part ${index + 1} of ${total}.` : ''

  return `Turn the article section below into a script for a single host to read aloud.${part}

Rules for the script:
${scriptRules()}
${positionRules(article, position)}
${coverageRules(countWords(slice), words)}

${META_RULES}
${total > 1 ? '\nThe title and summary must describe the whole article, not just this section.\n' : ''}
Source: ${article.site}
Article title: ${article.title}

Article ${total > 1 ? 'section' : 'text'}:
${slice}`
}

/**
 * Splits the source into one contiguous slice per segment.
 *
 * Contiguous and in order because the prompt asks the model to follow the
 * article's own order — slicing by position is what makes "part 3 of 3" line up
 * with the end of the article rather than covering the same ground again.
 */
function sliceSource(text: string, segments: number): string[] {
  if (segments <= 1) return [text]

  const words = text.split(/\s+/).filter(Boolean)
  const per = Math.ceil(words.length / segments)
  return Array.from({ length: segments }, (_, i) => words.slice(i * per, (i + 1) * per).join(' '))
}

/**
 * How many passes a target needs.
 *
 * Capped by what the source can sustain: splitting a thin article into three
 * passes just asks the model to pad three times instead of once.
 */
function planSegments(targetWords: number, sourceWords: number): number {
  const wanted = Math.max(1, Math.round(targetWords / SEGMENT_TARGET_WORDS))
  const affordable = Math.floor(sourceWords / (SEGMENT_TARGET_WORDS * SELECTION_RATIO))
  return Math.max(1, Math.min(wanted, affordable))
}

function lastWords(text: string, count: number): string {
  return text.split(/\s+/).filter(Boolean).slice(-count).join(' ')
}

/**
 * Drops a leading ellipsis from a continuing segment.
 *
 * The prompt tells the model not to write one, and mostly it does not — but the
 * quoted tail invites it, and a stray "..." is read aloud as a stumble rather
 * than ignored. Cheap to strip, so it is not left to the prompt alone.
 */
function stripContinuationMarker(script: string): string {
  return script.replace(/^\s*(?:\.{3}|…)\s*/, '')
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

  const complete = async (prompt: string, fallbackTitle: string): Promise<ScriptResult> => {
    let lastError: unknown
    for (let n = 0; n < MAX_ATTEMPTS; n++) {
      try {
        return await attempt(prompt, fallbackTitle)
      } catch (err) {
        lastError = err
      }
    }
    throw lastError
  }

  return async (article, options = {}) => {
    const preset = LENGTH_PRESETS[options.length ?? 'standard']
    const total = planSegments(preset.words, countWords(article.text))
    const slices = sliceSource(article.text, total)
    const perSegment = Math.round(preset.words / total)

    // Sequential, not parallel: each pass is shown the tail of the one before so
    // the seams do not restate or re-open. The added latency is the cost of a
    // script that reads as one take.
    const parts: string[] = []
    let title = article.title
    let summary = ''

    for (let index = 0; index < total; index++) {
      const result = await complete(
        buildSegmentPrompt(article, slices[index], perSegment, {
          index,
          total,
          previousTail: index > 0 ? lastWords(parts[index - 1], CONTINUITY_TAIL_WORDS) : undefined,
        }),
        article.title,
      )
      // The first pass is the one that saw the article's opening, so its title
      // and summary are the ones worth keeping.
      if (index === 0) {
        title = result.title
        summary = result.summary
      }
      parts.push(index === 0 ? result.script : stripContinuationMarker(result.script))
    }

    return { title, summary, script: parts.join('\n\n') }
  }
}

export function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length
}
