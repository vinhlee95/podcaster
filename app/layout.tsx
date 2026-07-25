import type { Metadata, Viewport } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import './globals.css'

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] })
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Podcaster — turn any URL into a podcast',
  description:
    'Paste an article link and get a spoken episode you can listen to now or save for later.',
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
