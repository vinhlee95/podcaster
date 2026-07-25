'use client'

import { AlertCircle, Pause, Play, RotateCcw, RotateCw, X } from 'lucide-react'
import {
  cycleRate,
  formatTime,
  pause,
  play,
  seek,
  skip,
  stop,
  usePlayer,
} from '@/lib/player/store'

/**
 * Sticky transport for whatever is playing.
 *
 * Renders nothing until a track is loaded, so the page has no reserved dead
 * space before the first play.
 */
export default function PlayerBar() {
  const { track, isPlaying, currentTime, duration, rate, errored } = usePlayer()

  if (!track) return null

  const total = duration || track.duration || 0

  return (
    // `env(safe-area-inset-bottom)` keeps the scrubber clear of the iOS home
    // indicator, which otherwise overlaps the bottom row on a notched phone.
    <div
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface/95 backdrop-blur-lg"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="mx-auto flex max-w-4xl flex-col gap-2 px-4 py-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => (isPlaying ? pause() : void play(track))}
            aria-label={errored ? 'Retry' : isPlaying ? 'Pause' : 'Play'}
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent text-white transition hover:scale-105 hover:bg-accent-soft active:scale-95"
          >
            {errored ? (
              <AlertCircle size={18} aria-hidden="true" />
            ) : isPlaying ? (
              <Pause size={18} fill="currentColor" aria-hidden="true" />
            ) : (
              <Play size={18} fill="currentColor" className="ml-0.5" aria-hidden="true" />
            )}
          </button>

          <div className="hidden shrink-0 items-center gap-1 sm:flex">
            <SkipButton delta={-15} label="Back 15 seconds">
              <RotateCcw size={16} aria-hidden="true" />
            </SkipButton>
            <SkipButton delta={15} label="Forward 15 seconds">
              <RotateCw size={16} aria-hidden="true" />
            </SkipButton>
          </div>

          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{track.title}</p>
            <p className="truncate text-xs text-muted">
              {errored ? 'Could not load this audio.' : (track.site ?? 'Podcaster')}
            </p>
          </div>

          <button
            type="button"
            onClick={() => cycleRate()}
            aria-label="Change playback speed"
            className="shrink-0 rounded-lg border border-border px-2 py-1 font-mono text-xs text-muted transition hover:bg-surface-hover hover:text-foreground"
          >
            {rate}x
          </button>

          <button
            type="button"
            onClick={() => stop()}
            aria-label="Close player"
            className="shrink-0 rounded-lg p-2 text-muted transition hover:bg-surface-hover hover:text-foreground"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        <div className="flex items-center gap-3">
          <span className="w-10 shrink-0 text-right font-mono text-[11px] tabular-nums text-muted">
            {formatTime(currentTime)}
          </span>
          <input
            type="range"
            min={0}
            max={total || 1}
            step={0.5}
            value={Math.min(currentTime, total)}
            onChange={(e) => seek(Number(e.target.value))}
            aria-label="Seek"
            className="min-w-0 flex-1"
          />
          <span className="w-10 shrink-0 font-mono text-[11px] tabular-nums text-muted">
            {formatTime(total)}
          </span>
        </div>
      </div>
    </div>
  )
}

function SkipButton({
  delta,
  label,
  children,
}: {
  delta: number
  label: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={() => skip(delta)}
      aria-label={label}
      className="rounded-lg p-2 text-muted transition hover:bg-surface-hover hover:text-foreground"
    >
      {children}
    </button>
  )
}
