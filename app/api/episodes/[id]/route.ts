import { deleteEpisode, getEpisode } from '@/lib/db/episodes'
import { removeAudio } from '@/lib/connectors/storage'

export const runtime = 'nodejs'

type Context = { params: Promise<{ id: string }> }

function parseId(raw: string): number | null {
  const id = Number(raw)
  return Number.isInteger(id) && id > 0 ? id : null
}

export async function GET(_request: Request, { params }: Context) {
  const id = parseId((await params).id)
  if (id === null) return Response.json({ error: 'Invalid episode id.' }, { status: 400 })

  const episode = await getEpisode(id)
  if (!episode) return Response.json({ error: 'Episode not found.' }, { status: 404 })
  return Response.json({ episode })
}

export async function DELETE(_request: Request, { params }: Context) {
  const id = parseId((await params).id)
  if (id === null) return Response.json({ error: 'Invalid episode id.' }, { status: 400 })

  const episode = await deleteEpisode(id)
  if (!episode) return Response.json({ error: 'Episode not found.' }, { status: 404 })

  // The row is already gone; a failed blob delete leaves an orphaned object but
  // must not fail the request, or the UI would report a delete that did happen
  // as an error.
  if (episode.audioUrl) {
    try {
      await removeAudio(episode.audioUrl)
    } catch (err) {
      console.error('episode.blob_delete_failed', { id, err })
    }
  }

  return Response.json({ ok: true })
}
