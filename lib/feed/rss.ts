/**
 * RSS 2.0 + iTunes namespace rendering.
 *
 * Hand-rolled rather than pulled from a package: a podcast feed is a fixed set
 * of elements, and the only genuinely subtle part is escaping — which a library
 * would not do any better and would hide.
 *
 * `renderFeed` is pure. It takes rows and an origin and returns a string, so it
 * can be exercised without a request, a database, or a server.
 */

import { MP3_BYTES_PER_SECOND } from '@/lib/connectors/tts'
import type { Episode } from '@/lib/db/schema'
import {
  SHOW_AUTHOR,
  SHOW_CATEGORY,
  SHOW_COVER_PATH,
  SHOW_DESCRIPTION,
  SHOW_LANGUAGE,
  SHOW_TITLE,
} from './show'

/**
 * Characters XML 1.0 forbids outright — they cannot be escaped into legality,
 * only removed. Tab, newline and carriage return are the allowed exceptions and
 * are deliberately absent from this class.
 *
 * Titles and summaries are model output that came through HTML extraction, so a
 * stray control byte is unlikely but possible — and a single one makes the whole
 * document unparseable, which a client reports as an empty feed rather than as
 * one broken episode.
 */
const INVALID_XML_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g

function escapeXml(value: string): string {
  return value
    .replace(INVALID_XML_CHARS, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * `<pubDate>` must be RFC 822. `toUTCString` emits RFC 1123 — the same shape
 * with a four-digit year, which every reader accepts and the RSS spec allows.
 */
function rfc822(date: Date | string): string {
  return new Date(date).toUTCString()
}

/**
 * Bytes for `<enclosure length>`.
 *
 * Real byte counts are stored for anything generated since the feed landed. For
 * older rows the duration estimate is run backwards, which lands within about a
 * kilobyte — clients use this for download progress, so being slightly off is
 * cosmetic, whereas `0` makes some of them refuse the file outright.
 */
function enclosureBytes(episode: Episode): number {
  if (episode.audioBytes && episode.audioBytes > 0) return episode.audioBytes
  if (episode.durationS && episode.durationS > 0) {
    return Math.round(episode.durationS * MP3_BYTES_PER_SECOND)
  }
  return 0
}

/**
 * A `<guid>` a client can dedupe on forever.
 *
 * Not the audio URL: re-synthesizing an episode in another voice would change
 * it, and every subscriber would be handed what looks like a new episode.
 */
function episodeGuid(episode: Episode): string {
  return `poddie-episode-${episode.id}`
}

function renderItem(episode: Episode): string {
  const title = escapeXml(episode.title)
  // Clients render an item with no description as a blank card, so the title
  // stands in when the script writer returned no summary.
  const description = escapeXml(episode.summary ?? episode.title)
  const duration = Math.max(1, Math.round(episode.durationS ?? 0))

  return `    <item>
      <title>${title}</title>
      <link>${escapeXml(episode.url)}</link>
      <guid isPermaLink="false">${episodeGuid(episode)}</guid>
      <pubDate>${rfc822(episode.createdAt)}</pubDate>
      <description>${description}</description>
      <itunes:title>${title}</itunes:title>
      <itunes:summary>${description}</itunes:summary>
      <itunes:author>${escapeXml(episode.sourceSite ?? SHOW_AUTHOR)}</itunes:author>
      <itunes:duration>${duration}</itunes:duration>
      <itunes:explicit>false</itunes:explicit>
      <itunes:episodeType>full</itunes:episodeType>
      <enclosure url="${escapeXml(episode.audioUrl ?? '')}" length="${enclosureBytes(episode)}" type="audio/mpeg"/>
    </item>`
}

export type FeedContext = {
  /** Scheme and host the feed is being served from, no trailing slash. */
  origin: string
  /** Absolute URL of the feed itself, for `<atom:link rel="self">`. */
  selfUrl: string
}

export function renderFeed(episodes: Episode[], { origin, selfUrl }: FeedContext): string {
  const coverUrl = `${origin}${SHOW_COVER_PATH}`
  // Feeds are newest-first, so the freshest episode dates the channel. An empty
  // library still needs a valid date, or some readers reject the document.
  const lastBuild = rfc822(episodes[0]?.createdAt ?? new Date())

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(SHOW_TITLE)}</title>
    <link>${escapeXml(origin)}</link>
    <description>${escapeXml(SHOW_DESCRIPTION)}</description>
    <language>${SHOW_LANGUAGE}</language>
    <lastBuildDate>${lastBuild}</lastBuildDate>
    <generator>Poddie</generator>
    <atom:link href="${escapeXml(selfUrl)}" rel="self" type="application/rss+xml"/>
    <image>
      <url>${escapeXml(coverUrl)}</url>
      <title>${escapeXml(SHOW_TITLE)}</title>
      <link>${escapeXml(origin)}</link>
    </image>
    <itunes:author>${escapeXml(SHOW_AUTHOR)}</itunes:author>
    <itunes:summary>${escapeXml(SHOW_DESCRIPTION)}</itunes:summary>
    <itunes:image href="${escapeXml(coverUrl)}"/>
    <itunes:category text="${escapeXml(SHOW_CATEGORY)}"/>
    <itunes:explicit>false</itunes:explicit>
    <itunes:type>episodic</itunes:type>
${episodes.map(renderItem).join('\n')}
  </channel>
</rss>
`
}
