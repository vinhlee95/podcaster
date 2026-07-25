import { listEpisodes } from '@/lib/db/episodes'
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
    dbError = err instanceof Error ? err.message : 'Could not reach the database.'
  }

  if (dbError) return <SetupNotice message={dbError} />

  return <Studio initialEpisodes={episodes} />
}
