import type { MetadataRoute } from 'next'
import { APP_BACKGROUND, APP_DESCRIPTION, APP_TITLE } from '@/lib/app-meta'
import { SHOW_TITLE } from '@/lib/feed/show'

/**
 * The web app manifest, served at `/manifest.webmanifest`. Next emits the
 * `<link rel="manifest">` for it on its own — there is nothing to add in the
 * layout.
 *
 * Static: none of this reads a request, so it is generated once at build time.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    // Pins the app's identity across renames. Without it the browser derives an
    // id from `start_url`, and changing that would strand the installed copy.
    id: '/',
    name: APP_TITLE,
    // What fits under a home-screen icon; anything longer gets elided.
    short_name: SHOW_TITLE,
    description: APP_DESCRIPTION,
    start_url: '/',
    display: 'standalone',
    background_color: APP_BACKGROUND,
    theme_color: APP_BACKGROUND,
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      // Kept separate rather than listed as `any maskable` on one file: a
      // launcher shrinks an `any` icon inside its shape and masks a `maskable`
      // one to it, and the two need different amounts of padding to survive.
      {
        src: '/icons/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  }
}
