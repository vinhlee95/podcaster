import { listEpisodes } from '@/lib/db/episodes'
import { rootCauseMessage } from '@/lib/db'
import { toDto, type EpisodeDto } from '@/lib/types'
import Studio from '@/components/Studio'
import SetupNotice from '@/components/SetupNotice'

/** The library reflects generations that just happened, so it is never cached. */
export const dynamic = 'force-dynamic'

export default async function Home() {
  let episodes: EpisodeDto[] = []
  let dbError: string | null = null

  // A missing or wrong DATABASE_URL is the first thing anyone hits on a fresh
  // clone. Rendering the setup notice beats a stack trace.
  try {
    episodes = (await listEpisodes()).map(toDto)
  } catch (err) {
    // The full chain goes to the server log; the notice only has room for the
    // reason, which is the innermost message rather than Drizzle's SQL dump.
    console.error('page.episodes_load_failed', err)
    dbError = rootCauseMessage(err)
  }

  if (dbError) return <SetupNotice message={dbError} />

  return <Studio initialEpisodes={episodes} />
}
