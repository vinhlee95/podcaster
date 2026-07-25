import { listEpisodes } from '@/lib/db/episodes'

export const runtime = 'nodejs'
/** The library changes on every generation, so it is never cached. */
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    return Response.json({ episodes: await listEpisodes() })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Could not load episodes.'
    return Response.json({ error: message, episodes: [] }, { status: 500 })
  }
}
