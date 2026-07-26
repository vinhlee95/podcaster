/**
 * The podcast feed.
 *
 * Podcast clients are unauthenticated HTTP fetchers — no cookies, no headers,
 * no login — so the feed has to be reachable by anyone who has the URL. The URL
 * *is* the credential: a random `FEED_TOKEN` sits in the path, which is the same
 * capability-URL arrangement private podcast hosts use.
 *
 * The audio itself was already public (Vercel Blob, non-expiring URLs); what
 * this adds is enumerability, which is exactly why the token is here.
 */

import { timingSafeEqual } from 'node:crypto'
import { listFeedEpisodes } from '@/lib/db/episodes'
import { renderFeed } from '@/lib/feed/rss'

export const runtime = 'nodejs'
/** A new episode must appear on the next poll, so nothing here is prerendered. */
export const dynamic = 'force-dynamic'

// Hand-rolled rather than the generated `RouteContext<'/feed/[token]'>` helper,
// matching `api/episodes/[id]/route.ts`. Those types only exist after `next dev`
// or `next build` has run, and `npm run type-check` is expected to pass on a
// clean checkout before either has.
type Context = { params: Promise<{ token: string }> }

/**
 * A 404 for both "wrong token" and "no token configured".
 *
 * Not 403: distinguishing them would confirm the route exists and that the
 * secret is the only thing missing.
 */
function notFound(): Response {
  return new Response('Not found', {
    status: 404,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  })
}

function tokenMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, 'utf8')
  const b = Buffer.from(expected, 'utf8')
  // `timingSafeEqual` throws on a length mismatch, so length is checked first —
  // which leaks the token's length and nothing else.
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

/**
 * Absolute origin to build feed URLs from.
 *
 * A feed's URLs must be absolute, and the host Next sees is the internal one
 * behind Vercel's proxy — so the forwarded headers win when present. `SITE_URL`
 * overrides everything, for pinning the canonical host from a preview deploy.
 */
function resolveOrigin(request: Request): string {
  const configured = process.env.SITE_URL?.trim().replace(/\/+$/, '')
  if (configured) return configured

  const url = new URL(request.url)
  // These headers are comma-joined lists when more than one proxy is involved;
  // the first entry is the client-facing one.
  const forwardedProto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim()
  const forwardedHost = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim()

  const proto = forwardedProto || url.protocol.replace(/:$/, '')
  const host = forwardedHost || request.headers.get('host') || url.host
  return `${proto}://${host}`
}

export async function GET(request: Request, { params }: Context) {
  const expected = process.env.FEED_TOKEN?.trim()
  const { token } = await params
  // Both `/feed/<token>` and `/feed/<token>.xml` resolve; the extension is
  // cosmetic, but people expect a feed URL to look like a file.
  const provided = token.replace(/\.xml$/i, '')

  if (!expected || !tokenMatches(provided, expected)) return notFound()

  try {
    const episodes = await listFeedEpisodes()
    const origin = resolveOrigin(request)
    const xml = renderFeed(episodes, { origin, selfUrl: `${origin}/feed/${token}` })

    return new Response(xml, {
      headers: {
        'content-type': 'application/rss+xml; charset=utf-8',
        // The URL is the secret, so a shared cache keyed on it is fine — and it
        // absorbs the polling every subscribed client does forever.
        'cache-control': 'public, max-age=0, s-maxage=300',
        // Belt and braces for the day the URL ends up in a referrer header.
        'x-robots-tag': 'noindex, nofollow',
      },
    })
  } catch (err) {
    console.error('feed.render_failed', err)
    // Plain text, not the reason: this response is public. A 500 makes clients
    // retry on their next poll, which is the right behaviour for a blip.
    return new Response('Feed temporarily unavailable', {
      status: 500,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    })
  }
}
