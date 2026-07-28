/**
 * Generates the Poddie artwork: the podcast cover served from `public/cover.png`
 * and the browser/home-screen icons in `app/`.
 *
 *     npm run cover
 *
 * Apple requires square artwork of at least 1400x1400, JPEG or PNG, and most
 * other clients show a placeholder without it. The images are authored as SVG
 * here and rasterized once, then committed — same arrangement as
 * `scripts/build-previews.ts`: a build artifact, not something a route rebuilds
 * per request. Re-run it after changing `SHOW_TITLE` or the palette.
 *
 * Cover and icons share one `headphone()` so the tab icon and the artwork a
 * podcast client shows cannot drift apart. The icons drop the wordmark: at 16px
 * the letters are mud, and the glyph alone is what reads.
 */

import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { SHOW_TITLE } from '@/lib/feed/show'

const COVER_OUT = path.join(process.cwd(), 'public', 'cover.png')
const APP_DIR = path.join(process.cwd(), 'app')
/** Manifest icons need stable URLs of their own, so they go in `public/`. */
const PWA_DIR = path.join(process.cwd(), 'public', 'icons')

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

/** Gradients both artworks paint with, on the shared 1000-unit grid. */
const DEFS = `<defs>
    <linearGradient id="glow" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${ACCENT}"/>
      <stop offset="100%" stop-color="${ACCENT_SOFT}"/>
    </linearGradient>
    <radialGradient id="halo" cx="0.5" cy="0.42" r="0.55">
      <stop offset="0%" stop-color="${ACCENT}" stop-opacity="0.42"/>
      <stop offset="100%" stop-color="${ACCENT}" stop-opacity="0"/>
    </radialGradient>
  </defs>`

/**
 * A headphone glyph: one arc for the band, two rounded rectangles for the cups.
 * Drawn on a 1000-unit grid, so the numbers stay readable at any output size.
 *
 * Including the 46-wide stroke and its round caps, the drawn shape spans
 * x 244..756 and y 237..648 — the numbers `ICON_FIT` scales against.
 */
function headphone(transform: string): string {
  return `<g transform="${transform}">
    <path d="M 290 470 a 210 210 0 0 1 420 0"
          fill="none" stroke="url(#glow)" stroke-width="46" stroke-linecap="round"/>
    <rect x="244" y="452" width="112" height="196" rx="56" fill="url(#glow)"/>
    <rect x="644" y="452" width="112" height="196" rx="56" fill="url(#glow)"/>
  </g>`
}

function coverSvg(title: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 1000 1000">
  ${DEFS}

  <rect width="1000" height="1000" fill="${BACKGROUND}"/>
  <rect width="1000" height="1000" fill="url(#halo)"/>

  ${headphone('translate(0,-40)')}

  <text x="500" y="812" text-anchor="middle"
        font-family="Helvetica Neue, Helvetica, Arial, sans-serif"
        font-size="132" font-weight="600" letter-spacing="-4" fill="${FOREGROUND}">${title}</text>
  <text x="500" y="884" text-anchor="middle"
        font-family="Helvetica Neue, Helvetica, Arial, sans-serif"
        font-size="42" font-weight="400" letter-spacing="8" fill="${ACCENT_SOFT}">URL TO PODCAST</text>
</svg>`
}

/**
 * Centres the glyph's 512x411 bounding box on the grid and scales it in place.
 */
function fit(scale: number): string {
  return `translate(500,500) scale(${scale}) translate(-500,-442.5)`
}

/**
 * ~76% of the frame — tight enough to stay legible at 16px, with margin left
 * for the rounded mask iOS applies to `apple-icon`.
 */
const ICON_SCALE = 1.48

/**
 * Android masks a `maskable` icon to whatever shape the launcher uses, and only
 * guarantees the centre circle of 80% diameter survives. The glyph's corners sit
 * `scale * hypot(256, 205.5)` from the centre, so anything above 1.21 risks
 * having the cups shaved off; 1.15 leaves a margin.
 */
const MASKABLE_SCALE = 1.15

/**
 * Corner radius on the 1000-unit grid, so 20% of the tile — a hair softer than
 * the ~22% iOS uses, which still reads as rounded at 16px (3px there) without
 * eating into the glyph.
 *
 * Only the browser icons get it. `apple-icon` stays square: iOS applies its own
 * mask, and pre-rounding it just shows the wallpaper through the corners.
 */
const ICON_RADIUS = 200

type IconSpec = {
  /** Absolute path to write to. */
  out: string
  size: number
  /** Corner radius on the 1000-unit grid; 0 for icons something else masks. */
  radius: number
  scale: number
}

function iconSvg({ size, radius, scale }: Omit<IconSpec, 'out'>): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 1000 1000">
  ${DEFS}

  <rect width="1000" height="1000" rx="${radius}" fill="${BACKGROUND}"/>
  <rect width="1000" height="1000" rx="${radius}" fill="url(#halo)"/>

  ${headphone(fit(scale))}
</svg>`
}

/** Rasterized from the SVG at the final size, so the glyph is hinted per size. */
function iconPng(spec: Omit<IconSpec, 'out'>): Promise<Buffer> {
  return sharp(Buffer.from(iconSvg(spec))).png({ compressionLevel: 9 }).toBuffer()
}

/**
 * Wraps already-encoded PNGs in an ICO container.
 *
 * `.ico` is the one format sharp will not write, and it is still worth shipping:
 * browsers request `/favicon.ico` on their own, whatever the `<link>` tags say.
 * PNG-compressed entries (rather than BMP) are understood by every browser that
 * has shipped this decade, and the header is 6 bytes plus 16 per image.
 */
function icoContainer(images: { size: number; png: Buffer }[]): Buffer {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // Reserved.
  header.writeUInt16LE(1, 2) // 1 = icon (2 would be a cursor).
  header.writeUInt16LE(images.length, 4)

  let offset = header.length + images.length * 16
  const directory: Buffer[] = []

  for (const { size, png } of images) {
    const entry = Buffer.alloc(16)
    // One byte per dimension, so 256 is encoded as 0. Nothing here is that big.
    entry.writeUInt8(size, 0)
    entry.writeUInt8(size, 1)
    entry.writeUInt8(0, 2) // Palette size; 0 for truecolor.
    entry.writeUInt8(0, 3) // Reserved.
    entry.writeUInt16LE(1, 4) // Colour planes.
    entry.writeUInt16LE(32, 6) // Bits per pixel.
    entry.writeUInt32LE(png.length, 8)
    entry.writeUInt32LE(offset, 12)
    offset += png.length
    directory.push(entry)
  }

  return Buffer.concat([header, ...directory, ...images.map((image) => image.png)])
}

function report(label: string, bytes: number, out: string) {
  console.log(
    `${label.padEnd(22)} ${String(Math.round(bytes / 1024)).padStart(4)}KB  ->  ${path.relative(process.cwd(), out)}`
  )
}

async function main() {
  // `<text>` is rasterized against the host's fonts. The stack above is all
  // system faces, so this renders the same on any machine likely to run it.
  // Palette-encoded rather than truecolor: the artwork is two gradients and some
  // text, so 256 colours plus dithering is visually identical here and less than
  // half the bytes (511KB -> ~230KB) for a file that gets committed. Dropping to
  // 128 colours is counterproductive — the extra dither noise encodes larger.
  const cover = await sharp(Buffer.from(coverSvg(SHOW_TITLE)))
    .png({ palette: true, colours: 256, dither: 1.0, compressionLevel: 9 })
    .toBuffer()

  await writeFile(COVER_OUT, cover)
  report(`cover.png ${SIZE}x${SIZE}`, cover.length, COVER_OUT)

  if (cover.length > 512 * 1024) {
    console.warn(`Larger than expected for flat artwork — consider dropping SIZE to 1500.`)
  }

  await mkdir(PWA_DIR, { recursive: true })

  const icons: IconSpec[] = [
    // Next's file conventions. `icon.png` becomes the `<link rel="icon">` a
    // modern browser prefers; `apple-icon.png` is the iOS home-screen tile at
    // its native 180px, left square because iOS applies its own mask.
    { out: path.join(APP_DIR, 'icon.png'), size: 512, radius: ICON_RADIUS, scale: ICON_SCALE },
    { out: path.join(APP_DIR, 'apple-icon.png'), size: 180, radius: 0, scale: ICON_SCALE },
    // Referenced by `app/manifest.ts`. Android wants both a 192 and a 512, plus
    // a full-bleed `maskable` variant it can cut its own shape out of.
    { out: path.join(PWA_DIR, 'icon-192.png'), size: 192, radius: ICON_RADIUS, scale: ICON_SCALE },
    { out: path.join(PWA_DIR, 'icon-512.png'), size: 512, radius: ICON_RADIUS, scale: ICON_SCALE },
    {
      out: path.join(PWA_DIR, 'icon-maskable-512.png'),
      size: 512,
      radius: 0,
      scale: MASKABLE_SCALE,
    },
  ]

  for (const { out, ...spec } of icons) {
    const png = await iconPng(spec)
    await writeFile(out, png)
    report(`${path.basename(out)} ${spec.size}x${spec.size}`, png.length, out)
  }

  const ico = icoContainer(
    await Promise.all(
      [32, 16].map(async (size) => ({
        size,
        png: await iconPng({ size, radius: ICON_RADIUS, scale: ICON_SCALE }),
      }))
    )
  )
  const icoOut = path.join(APP_DIR, 'favicon.ico')
  await writeFile(icoOut, ico)
  report('favicon.ico 32+16', ico.length, icoOut)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
