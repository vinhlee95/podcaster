import type { Metadata, Viewport } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import { SHOW_COVER_PATH, SHOW_TITLE } from '@/lib/feed/show'
import './globals.css'

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] })
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] })

const DESCRIPTION =
  'Paste an article link and get a spoken episode you can listen to now or save for later.'

/**
 * Absolute base for the social-card URLs. `SITE_URL` is the same override the
 * feed route uses; without it Next resolves the relative paths below against
 * the deployment's own URL, and localhost in dev.
 */
const siteUrl =
  process.env.SITE_URL?.trim().replace(/\/+$/, '') ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : undefined)

export const metadata: Metadata = {
  ...(siteUrl ? { metadataBase: new URL(siteUrl) } : {}),
  title: `${SHOW_TITLE} — turn any URL into a podcast`,
  description: DESCRIPTION,
  applicationName: SHOW_TITLE,
  // The tab icon itself comes from the `app/icon.png`, `app/apple-icon.png` and
  // `app/favicon.ico` file conventions — Next emits those `<link>` tags on its
  // own, and all three are generated from the cover art by `npm run cover`.
  openGraph: {
    type: 'website',
    siteName: SHOW_TITLE,
    title: `${SHOW_TITLE} — turn any URL into a podcast`,
    description: DESCRIPTION,
    // The square show artwork, which is what a link to this app should preview
    // as: it is the same image every podcast client shows for the feed.
    images: [{ url: SHOW_COVER_PATH, width: 3000, height: 3000, alt: `${SHOW_TITLE} cover art` }],
  },
  twitter: {
    card: 'summary',
    title: `${SHOW_TITLE} — turn any URL into a podcast`,
    description: DESCRIPTION,
    images: [SHOW_COVER_PATH],
  },
}

export const viewport: Viewport = {
  // Matches the dark-first palette so the mobile browser chrome does not flash white.
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#0b0b0f' },
    { media: '(prefers-color-scheme: light)', color: '#fafafa' },
  ],
  // Required for `env(safe-area-inset-*)` to report anything but 0 on iOS —
  // without it the player bar's home-indicator padding silently does nothing.
  viewportFit: 'cover',
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  )
}
