'use client'

import { useState } from 'react'
import { AlertCircle, ExternalLink, FileText, Loader2, Pause, Play, Trash2 } from 'lucide-react'
import { formatTime, toggle, usePlayer, type Track } from '@/lib/player/store'
import { EPISODE_STATUS } from '@/lib/options'
import type { EpisodeDto } from '@/lib/types'
import Equalizer from './Equalizer'

type Props = {
  episode: EpisodeDto
  onDelete: (id: number) => void
}

function relativeDate(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const minutes = Math.round(diffMs / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days}d ago`
  return new Date(iso).toLocaleDateString()
}

export default function EpisodeCard({ episode, onDelete }: Props) {
  const player = usePlayer()
  const [showScript, setShowScript] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const trackId = `episode:${episode.id}`
  const isActive = player.trackId === trackId
  const isPlaying = isActive && player.isPlaying
  const isReady = episode.status === EPISODE_STATUS.ready && !!episode.audioUrl
  const isFailed = episode.status === EPISODE_STATUS.failed

  const track: Track | null = episode.audioUrl
    ? {
        id: trackId,
        url: episode.audioUrl,
        title: episode.title,
        duration: episode.durationS ?? 0,
        site: episode.sourceSite,
      }
    : null

  async function handleDelete() {
    if (deleting) return
    setDeleting(true)
    try {
      await onDelete(episode.id)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <article
      className={`group flex flex-col gap-3 rounded-2xl border bg-surface p-4 transition-colors ${
        isActive ? 'border-accent/50' : 'border-border hover:border-border/80 hover:bg-surface-hover'
      }`}
    >
      <div className="flex items-start gap-3">
        {/* Play button, or a status indicator when there is nothing to play. */}
        {isReady && track ? (
          <button
            type="button"
            onClick={() => toggle(track)}
            aria-label={isPlaying ? `Pause ${episode.title}` : `Play ${episode.title}`}
            className="mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-white transition hover:scale-105 hover:bg-accent-soft active:scale-95"
          >
            {isPlaying ? (
              <Pause size={16} fill="currentColor" aria-hidden="true" />
            ) : (
              <Play size={16} fill="currentColor" className="ml-0.5" aria-hidden="true" />
            )}
          </button>
        ) : (
          <div
            className={`mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
              isFailed ? 'bg-danger/15 text-danger' : 'bg-border/60 text-muted'
            }`}
          >
            {isFailed ? (
              <AlertCircle size={16} aria-hidden="true" />
            ) : (
              <Loader2 size={16} className="animate-spin" aria-hidden="true" />
            )}
          </div>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-[15px] font-medium leading-snug">{episode.title}</h3>
            {isPlaying && <Equalizer className="shrink-0" />}
          </div>

          {episode.summary && (
            <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-muted">
              {episode.summary}
            </p>
          )}

          {isFailed && episode.error && (
            <p className="mt-1 text-sm leading-relaxed text-danger">{episode.error}</p>
          )}

          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
            <a
              href={episode.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 hover:text-foreground"
            >
              {episode.sourceSite ?? 'source'}
              <ExternalLink size={11} aria-hidden="true" />
            </a>
            {episode.durationS != null && (
              <span className="font-mono tabular-nums">{formatTime(episode.durationS)}</span>
            )}
            {episode.voice && <span className="capitalize">{episode.voice}</span>}
            <span>{relativeDate(episode.createdAt)}</span>
          </div>
        </div>

        <div className="hover-reveal flex shrink-0 items-center gap-0.5 transition-opacity">
          {episode.script && (
            <button
              type="button"
              onClick={() => setShowScript((v) => !v)}
              aria-expanded={showScript}
              aria-label={showScript ? 'Hide transcript' : 'Show transcript'}
              className={`inline-flex h-10 w-10 items-center justify-center rounded-lg transition hover:bg-surface-hover ${
                showScript ? 'text-accent-soft' : 'text-muted hover:text-foreground'
              }`}
            >
              <FileText size={15} aria-hidden="true" />
            </button>
          )}
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleting}
            aria-label={`Delete ${episode.title}`}
            className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-muted transition hover:bg-surface-hover hover:text-danger disabled:opacity-50"
          >
            {deleting ? (
              <Loader2 size={15} className="animate-spin" aria-hidden="true" />
            ) : (
              <Trash2 size={15} aria-hidden="true" />
            )}
          </button>
        </div>
      </div>

      {showScript && episode.script && (
        <p className="max-h-72 overflow-y-auto whitespace-pre-wrap rounded-xl border border-border bg-background/60 p-3 text-sm leading-relaxed text-muted">
          {episode.script}
        </p>
      )}
    </article>
  )
}
