/**
 * Channel-level metadata for the RSS feed.
 *
 * Shared by the feed route and `scripts/build-cover.ts` so the wordmark burned
 * into the artwork and the `<title>` a podcast client displays cannot drift
 * apart — they read the same constant.
 *
 * Not in `lib/options.ts`: that file exists so client components can read shared
 * constants without pulling server-only dependencies into the browser bundle,
 * and none of this is needed on the client.
 */

/** Shown as the podcast name in every client. Also the wordmark on the cover. */
export const SHOW_TITLE = 'Poddie'

export const SHOW_AUTHOR = 'Poddie'

export const SHOW_DESCRIPTION =
  'Articles worth reading, turned into something worth listening to. Every episode ' +
  'is a link that got extracted, rewritten as a spoken script, and recorded.'

/**
 * Must be one of Apple's published categories, spelled exactly — clients match
 * on the string, and an unrecognized one is silently dropped.
 */
export const SHOW_CATEGORY = 'Technology'

/** RFC 5646 language tag. Scripts are written in English by the prompt. */
export const SHOW_LANGUAGE = 'en'

/** Cover art, served from `public/`. Built by `npm run cover`. */
export const SHOW_COVER_PATH = '/cover.png'
