/**
 * Object storage connector for generated episode audio.
 *
 * Stonkie's equivalent (`connectors/audio_storage.py`) uploads to GCS and mints
 * a fresh signed URL on every read, because the objects are private and the
 * URLs expire after six hours — which forces the client to detect expiry and
 * refetch. Vercel Blob's public URLs never expire, so the stored `audioUrl` is
 * playable forever and all of that machinery disappears.
 *
 * The interface is kept narrow (upload / delete) so swapping in GCS later is a
 * single-file change.
 */

import { del, put } from '@vercel/blob'

export type StoredAudio = {
  /** Public, non-expiring URL for the `<audio>` element. */
  url: string
  /** Blob pathname, persisted so the object can be deleted with the episode. */
  pathname: string
}

export interface AudioStorage {
  upload(key: string, data: Buffer, contentType?: string): Promise<StoredAudio>
  remove(url: string): Promise<void>
}

export class BlobAudioStorage implements AudioStorage {
  async upload(
    key: string,
    data: Buffer,
    contentType: string = 'audio/mpeg',
  ): Promise<StoredAudio> {
    const blob = await put(key, data, {
      access: 'public',
      contentType,
      // Blob appends a random suffix by default to avoid collisions. Keys here
      // already carry the episode id, so the suffix would only make the
      // filename uglier in the browser's download dialog.
      addRandomSuffix: false,
      // Immutable once written — the URL is stable, so let it cache hard.
      cacheControlMaxAge: 31_536_000,
    })
    return { url: blob.url, pathname: blob.pathname }
  }

  async remove(url: string): Promise<void> {
    await del(url)
  }
}

/** Object key for an episode's audio. Slug is cosmetic — it shows up in the URL. */
export function audioKey(episodeId: number, title: string): string {
  const slug =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60) || 'episode'
  return `episodes/${episodeId}-${slug}.mp3`
}
