/**
 * Generates the podcast cover art served from `public/cover.png`.
 *
 *     npm run cover
 *
 * Apple requires square artwork of at least 1400x1400, JPEG or PNG, and most
 * other clients show a placeholder without it. The image is authored as SVG here
 * and rasterized once, then committed — same arrangement as
 * `scripts/build-previews.ts`: a build artifact, not something a route rebuilds
 * per request. Re-run it after changing `SHOW_TITLE` or the palette.
 */

import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { SHOW_TITLE } from '@/lib/feed/show'

const OUT = path.join(process.cwd(), 'public', 'cover.png')

/**
 * 3000px is Apple's preferred size. The artwork is flat colour plus two smooth
 * gradients, which PNG compresses hard — the file lands well under the 512KB
 * that would make committing it annoying.
 */
const SIZE = 3000

// Straight from `app/globals.css` so the cover matches the app it came from.
const BACKGROUND = '#0b0b0f'
const ACCENT = '#8b5cf6'
const ACCENT_SOFT = '#a78bfa'
const FOREGROUND = '#ededf2'

/**
 * A headphone glyph: one arc for the band, two rounded rectangles for the cups.
 * Drawn on a 1000-unit grid and scaled up, so the numbers stay readable.
 */
function coverSvg(title: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 1000 1000">
  <defs>
    <linearGradient id="glow" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${ACCENT}"/>
      <stop offset="100%" stop-color="${ACCENT_SOFT}"/>
    </linearGradient>
    <radialGradient id="halo" cx="0.5" cy="0.42" r="0.55">
      <stop offset="0%" stop-color="${ACCENT}" stop-opacity="0.42"/>
      <stop offset="100%" stop-color="${ACCENT}" stop-opacity="0"/>
    </radialGradient>
  </defs>

  <rect width="1000" height="1000" fill="${BACKGROUND}"/>
  <rect width="1000" height="1000" fill="url(#halo)"/>

  <g transform="translate(0,-40)">
    <path d="M 290 470 a 210 210 0 0 1 420 0"
          fill="none" stroke="url(#glow)" stroke-width="46" stroke-linecap="round"/>
    <rect x="244" y="452" width="112" height="196" rx="56" fill="url(#glow)"/>
    <rect x="644" y="452" width="112" height="196" rx="56" fill="url(#glow)"/>
  </g>

  <text x="500" y="812" text-anchor="middle"
        font-family="Helvetica Neue, Helvetica, Arial, sans-serif"
        font-size="132" font-weight="600" letter-spacing="-4" fill="${FOREGROUND}">${title}</text>
  <text x="500" y="884" text-anchor="middle"
        font-family="Helvetica Neue, Helvetica, Arial, sans-serif"
        font-size="42" font-weight="400" letter-spacing="8" fill="${ACCENT_SOFT}">URL TO PODCAST</text>
</svg>`
}

async function main() {
  // `<text>` is rasterized against the host's fonts. The stack above is all
  // system faces, so this renders the same on any machine likely to run it.
  // Palette-encoded rather than truecolor: the artwork is two gradients and some
  // text, so 256 colours plus dithering is visually identical here and less than
  // half the bytes (511KB -> ~230KB) for a file that gets committed. Dropping to
  // 128 colours is counterproductive — the extra dither noise encodes larger.
  const png = await sharp(Buffer.from(coverSvg(SHOW_TITLE)))
    .png({ palette: true, colours: 256, dither: 1.0, compressionLevel: 9 })
    .toBuffer()

  await writeFile(OUT, png)
  const kb = Math.round(png.length / 1024)
  console.log(`cover.png  ${SIZE}x${SIZE}  ${kb}KB  ->  ${path.relative(process.cwd(), OUT)}`)

  if (kb > 512) {
    console.warn(`Larger than expected for flat artwork — consider dropping SIZE to 1500.`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
