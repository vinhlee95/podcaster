import { listEpisodes } from '@/lib/db/episodes'
import { rootCauseMessage } from '@/lib/db'

export const runtime = 'nodejs'
/** The library changes on every generation, so it is never cached. */
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    return Response.json({ episodes: await listEpisodes() })
  } catch (err) {
    console.error('api.episodes_list_failed', err)
    return Response.json({ error: rootCauseMessage(err), episodes: [] }, { status: 500 })
  }
}
