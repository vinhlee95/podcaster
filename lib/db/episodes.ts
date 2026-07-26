import { and, desc, eq, isNotNull, lt } from 'drizzle-orm'
import { getDb, rootCauseMessage } from './index'
import { EPISODE_STATUS, episodes, type Episode, type NewEpisode } from './schema'

/**
 * How long a row may sit in `generating` before it is treated as dead.
 *
 * Generation runs inside a single request, so a row only stays `generating`
 * while that request is alive. Vercel caps functions at 300s, and the client
 * disconnecting kills the function without running the failure handler — so
 * anything older than the cap plus a margin can never recover.
 */
const STALE_GENERATING_MS = 6 * 60 * 1000

/**
 * Rewrites long-dead `generating` rows to `failed` so the UI stops spinning.
 *
 * Best-effort. This is housekeeping the caller did not ask for, and it is the
 * first statement `listEpisodes` runs — so letting it throw means any transient
 * write failure takes down the whole library, and the reader never even gets
 * attempted. Swallow it: the worst case is a dead row spinning one page load
 * longer. A database that is genuinely unreachable still surfaces, because the
 * select below fails on its own.
 */
async function reapStale(): Promise<void> {
  try {
    const db = getDb()
    await db
      .update(episodes)
      .set({
        status: EPISODE_STATUS.failed,
        error: 'Generation was interrupted before it finished.',
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(episodes.status, EPISODE_STATUS.generating),
          lt(episodes.createdAt, new Date(Date.now() - STALE_GENERATING_MS)),
        ),
      )
  } catch (err) {
    console.warn('episodes.reap_stale_failed', { reason: rootCauseMessage(err) })
  }
}

export async function listEpisodes(): Promise<Episode[]> {
  await reapStale()
  return getDb().select().from(episodes).orderBy(desc(episodes.createdAt))
}

/**
 * How many episodes the RSS feed carries.
 *
 * Feeds are polled forever and grow forever, so the window is capped rather than
 * left to match the library. Clients keep episodes they have already seen, so
 * anything falling off the end stays in the subscriber's app.
 */
const FEED_LIMIT = 300

/**
 * Playable episodes, newest first, for the RSS feed.
 *
 * Deliberately not `listEpisodes` — that one calls `reapStale`, which *writes*.
 * Podcast clients poll every few hours forever, and none of them should be
 * driving an UPDATE. This is a pure read.
 *
 * Rows without audio are excluded rather than rendered as empty items: an
 * `<enclosure>` with no URL is what makes a client show a broken episode.
 */
export async function listFeedEpisodes(limit: number = FEED_LIMIT): Promise<Episode[]> {
  return getDb()
    .select()
    .from(episodes)
    .where(and(eq(episodes.status, EPISODE_STATUS.ready), isNotNull(episodes.audioUrl)))
    .orderBy(desc(episodes.createdAt))
    .limit(limit)
}

export async function getEpisode(id: number): Promise<Episode | null> {
  const rows = await getDb().select().from(episodes).where(eq(episodes.id, id)).limit(1)
  return rows[0] ?? null
}

export async function createEpisode(values: NewEpisode): Promise<Episode> {
  const rows = await getDb().insert(episodes).values(values).returning()
  return rows[0]
}

export async function updateEpisode(
  id: number,
  values: Partial<NewEpisode>,
): Promise<Episode | null> {
  const rows = await getDb()
    .update(episodes)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(episodes.id, id))
    .returning()
  return rows[0] ?? null
}

export async function deleteEpisode(id: number): Promise<Episode | null> {
  const rows = await getDb().delete(episodes).where(eq(episodes.id, id)).returning()
  return rows[0] ?? null
}

/** Most recent episode for `url`, used to offer "already generated" instead of re-spending on TTS. */
export async function findEpisodeByUrl(url: string): Promise<Episode | null> {
  const rows = await getDb()
    .select()
    .from(episodes)
    .where(and(eq(episodes.url, url), eq(episodes.status, EPISODE_STATUS.ready)))
    .orderBy(desc(episodes.createdAt))
    .limit(1)
  return rows[0] ?? null
}
