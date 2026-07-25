import type { Episode } from '@/lib/db/schema'

/**
 * Wire shape of an episode.
 *
 * The DB row carries `Date` objects. Those survive the RSC boundary but arrive
 * as strings over `fetch`, so both paths are normalized to ISO strings here and
 * the client only ever deals with one shape.
 */
export type EpisodeDto = Omit<Episode, 'createdAt' | 'updatedAt'> & {
  createdAt: string
  updatedAt: string
}

export function toDto(episode: Episode): EpisodeDto {
  return {
    ...episode,
    createdAt: new Date(episode.createdAt).toISOString(),
    updatedAt: new Date(episode.updatedAt).toISOString(),
  }
}
