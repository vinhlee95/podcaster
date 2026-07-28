import type { Metadata, Viewport } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import RegisterServiceWorker from '@/components/RegisterServiceWorker'
import { APP_BACKGROUND, APP_BACKGROUND_LIGHT, APP_DESCRIPTION, APP_TITLE } from '@/lib/app-meta'
import { SHOW_COVER_PATH, SHOW_TITLE } from '@/lib/feed/show'
import './globals.css'

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] })
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] })

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
  title: APP_TITLE,
  description: APP_DESCRIPTION,
  applicationName: SHOW_TITLE,
  // The tab icon itself comes from the `app/icon.png`, `app/apple-icon.png` and
  // `app/favicon.ico` file conventions, and the `<link rel="manifest">` from
  // `app/manifest.ts` — Next emits all of those tags on its own.
  appleWebApp: {
    // iOS ignores the manifest's `display`, and reads this instead: it is what
    // makes a home-screen launch open without Safari's chrome.
    capable: true,
    title: SHOW_TITLE,
    // `black`, not `black-translucent`: the translucent bar puts content under
    // the clock, which only works if every page pads for the top inset. Today
    // only `FullScreenPlayer` does.
    statusBarStyle: 'black',
  },
  openGraph: {
    type: 'website',
    siteName: SHOW_TITLE,
    title: APP_TITLE,
    description: APP_DESCRIPTION,
    // The square show artwork, which is what a link to this app should preview
    // as: it is the same image every podcast client shows for the feed.
    images: [{ url: SHOW_COVER_PATH, width: 3000, height: 3000, alt: `${SHOW_TITLE} cover art` }],
  },
  twitter: {
    card: 'summary',
    title: APP_TITLE,
    description: APP_DESCRIPTION,
    images: [SHOW_COVER_PATH],
  },
}

export const viewport: Viewport = {
  // Matches the dark-first palette so the mobile browser chrome does not flash white.
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: APP_BACKGROUND },
    { media: '(prefers-color-scheme: light)', color: APP_BACKGROUND_LIGHT },
  ],
  // Required for `env(safe-area-inset-*)` to report anything but 0 on iOS —
  // without it the player bar's home-indicator padding silently does nothing.
  viewportFit: 'cover',
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        {children}
        <RegisterServiceWorker />
      </body>
    </html>
  )
}
