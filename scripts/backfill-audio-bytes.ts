/**
 * Fills in `episodes.audio_bytes` for rows generated before the RSS feed existed.
 *
 *     npm run backfill:bytes
 *
 * The column feeds `<enclosure length>`, which is measured in bytes. Older rows
 * only carry `durationS`, and that was derived *from* the byte count at an
 * assumed bitrate, so it cannot be inverted without losing precision. The real
 * number is still available: ask the blob store for it with a HEAD request.
 *
 * Safe to re-run — rows that already have a byte count are skipped.
 */

import { config } from 'dotenv'
import { isNull, and, eq, isNotNull } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { episodes, EPISODE_STATUS } from '@/lib/db/schema'

config({ path: '.env.local' })

async function contentLength(url: string): Promise<number | null> {
  const response = await fetch(url, { method: 'HEAD' })
  if (!response.ok) return null
  const header = response.headers.get('content-length')
  if (!header) return null
  const bytes = Number(header)
  return Number.isInteger(bytes) && bytes > 0 ? bytes : null
}

async function main() {
  const db = getDb()

  const pending = await db
    .select()
    .from(episodes)
    .where(
      and(
        eq(episodes.status, EPISODE_STATUS.ready),
        isNotNull(episodes.audioUrl),
        isNull(episodes.audioBytes),
      ),
    )

  if (pending.length === 0) {
    console.log('Nothing to backfill.')
    return
  }

  console.log(`Backfilling ${pending.length} episode(s)…`)
  let filled = 0

  // Serial rather than concurrent: this is a one-off over a handful of rows, and
  // a burst of HEAD requests against the blob store buys nothing here.
  for (const episode of pending) {
    try {
      const bytes = await contentLength(episode.audioUrl!)
      if (bytes === null) {
        console.warn(`  #${episode.id} — no content-length, left null`)
        continue
      }
      await db.update(episodes).set({ audioBytes: bytes }).where(eq(episodes.id, episode.id))
      filled += 1
      console.log(`  #${episode.id} — ${bytes} bytes`)
    } catch (err) {
      // One unreachable blob must not abandon the rest of the run; the feed
      // falls back to the duration estimate for whatever stays null.
      console.warn(`  #${episode.id} — ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  console.log(`Done. ${filled}/${pending.length} filled.`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
