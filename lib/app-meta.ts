/**
 * How the app describes itself.
 *
 * The `<head>` metadata in `app/layout.tsx` and the web app manifest in
 * `app/manifest.ts` are two renderings of the same facts — an installed PWA
 * shows the manifest's name and colours where the browser shows the tag's — so
 * both read these constants rather than restating them.
 *
 * The brand name itself is not here: `SHOW_TITLE` in `lib/feed/show.ts` already
 * owns it, because the cover art burns it in.
 */

import { SHOW_TITLE } from '@/lib/feed/show'

export const APP_TITLE = `${SHOW_TITLE} — turn any URL into a podcast`

export const APP_DESCRIPTION =
  'Paste an article link and get a spoken episode you can listen to now or save for later.'

/**
 * The dark-first background, straight from `--background` in `app/globals.css`.
 * Painted behind the app while an installed launch is still starting up, so a
 * mismatch here shows as a white flash before the first frame.
 */
export const APP_BACKGROUND = '#0b0b0f'

/** `--background` from the light-scheme block, for the browser chrome only. */
export const APP_BACKGROUND_LIGHT = '#fafafa'
