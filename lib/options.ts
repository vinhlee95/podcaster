/**
 * Constants shared by the server pipeline and the client UI.
 *
 * These live apart from the connectors on purpose. The form needs the voice and
 * length lists, and the episode card needs the status values — importing them
 * from `connectors/tts.ts` or `db/schema.ts` would pull the OpenAI SDK and
 * Drizzle into the client bundle for the sake of a few string literals.
 *
 * Nothing in this file may import a server-only module.
 */

export const VOICES = [
  { id: 'nova', label: 'Nova', blurb: 'Warm, brisk' },
  { id: 'alloy', label: 'Alloy', blurb: 'Neutral, even' },
  { id: 'echo', label: 'Echo', blurb: 'Calm, low' },
  { id: 'fable', label: 'Fable', blurb: 'Expressive, British' },
  { id: 'onyx', label: 'Onyx', blurb: 'Deep, authoritative' },
  { id: 'shimmer', label: 'Shimmer', blurb: 'Bright, upbeat' },
  { id: 'sage', label: 'Sage', blurb: 'Measured, thoughtful' },
  { id: 'coral', label: 'Coral', blurb: 'Friendly, animated' },
] as const

export type VoiceId = (typeof VOICES)[number]['id']

export const DEFAULT_VOICE: VoiceId = 'nova'

/**
 * The line every voice reads in a preview.
 *
 * Deliberately the same text for all of them — the point is to compare voices,
 * and that only works if the only variable is the voice. It is generic enough
 * to carry no article-specific content, and short enough (a few seconds) that
 * sampling all eight is quick.
 *
 * The audio lives in `public/previews/`. Editing this string changes nothing
 * until `npm run previews` regenerates it.
 */
export const VOICE_PREVIEW_TEXT =
  "Here's how I sound. This is the voice that would read your article to you — " +
  'the pacing, the tone, the way one sentence settles before the next one starts.'

/**
 * Episode lengths.
 *
 * `words` is a target and assumes ~150 spoken words per minute; `hint` is what
 * the menu shows. A `words` of null means no target at all — the article is
 * carried over in full rather than condensed to fit a duration, so the episode
 * is as long as the source makes it and no minute count can be promised in
 * advance. That is the point of the mode: depth is not traded for length.
 */
export const LENGTH_PRESETS = {
  quick: { label: 'Quick', hint: '~2 min', words: 300 },
  standard: { label: 'Standard', hint: '~5 min', words: 750 },
  deep: { label: 'Full', hint: 'whole article', words: null },
} as const

export type LengthPreset = keyof typeof LENGTH_PRESETS

export const EPISODE_STATUS = {
  generating: 'generating',
  ready: 'ready',
  failed: 'failed',
} as const

export type EpisodeStatus = (typeof EPISODE_STATUS)[keyof typeof EPISODE_STATUS]

/** Stages the generation pipeline reports as it advances. */
export type GenerationStage = 'extracting' | 'writing' | 'synthesizing' | 'uploading' | 'done'
