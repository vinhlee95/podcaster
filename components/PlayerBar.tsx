'use client'

import { useCallback, useState } from 'react'
import { AlertCircle, ChevronUp, Pause, Play, RotateCcw, RotateCw, X } from 'lucide-react'
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
import FullScreenPlayer from './FullScreenPlayer'

/**
 * Sticky transport for whatever is playing.
 *
 * Renders nothing until a track is loaded, so the page has no reserved dead
 * space before the first play. Tapping the bar — anywhere the controls are not —
 * raises the full-screen player over it, the way a mini player does on a phone.
 */
export default function PlayerBar() {
  const { track, isPlaying, currentTime, duration, rate, errored } = usePlayer()

  // Which track is expanded, rather than whether one is: closing the player or
  // starting a different episode then cannot inherit an open full-screen view
  // from the track before it, and no effect has to reset anything.
  const [expandedTrackId, setExpandedTrackId] = useState<string | null>(null)

  // Stable, because `FullScreenPlayer` keys an effect on it and this component
  // re-renders several times a second while playing.
  const collapse = useCallback(() => setExpandedTrackId(null), [])

  if (!track) return null

  const expanded = expandedTrackId === track.id
  const expand = () => setExpandedTrackId(track.id)
  const total = duration || track.duration || 0

  return (
    <>
      {expanded && <FullScreenPlayer track={track} onClose={collapse} />}

      {/* `env(safe-area-inset-bottom)` keeps the scrubber clear of the iOS home
          indicator, which otherwise overlaps the bottom row on a notched phone. */}
      <div
        onClick={expand}
        className="fixed inset-x-0 bottom-0 z-40 cursor-pointer border-t border-border bg-surface/95 backdrop-blur-lg"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        {/* The controls stop their clicks here rather than the container testing
            what was hit: each one knows it is a control, and the container does
            not have to be taught the list. */}
        <div className="mx-auto flex max-w-4xl flex-col gap-2 px-4 py-3">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                if (isPlaying) pause()
                else void play(track)
              }}
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

            {/* A real button as well as the container's click, so the full-screen
                view is reachable from the keyboard. Spans, not paragraphs — a
                button may only contain phrasing content. */}
            <button
              type="button"
              onClick={expand}
              aria-label={`Open full screen player for ${track.title}`}
              className="group flex min-w-0 flex-1 items-center gap-2 text-left"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{track.title}</span>
                <span className="block truncate text-xs text-muted">
                  {errored ? 'Could not load this audio.' : (track.site ?? 'Podcaster')}
                </span>
              </span>
              <ChevronUp
                size={14}
                className="shrink-0 text-muted transition-transform group-hover:-translate-y-0.5 group-hover:text-foreground"
                aria-hidden="true"
              />
            </button>

            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                cycleRate()
              }}
              aria-label="Change playback speed"
              className="shrink-0 rounded-lg border border-border px-2 py-1 font-mono text-xs text-muted transition hover:bg-surface-hover hover:text-foreground"
            >
              {rate}x
            </button>

            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                stop()
              }}
              aria-label="Close player"
              className="shrink-0 rounded-lg p-2 text-muted transition hover:bg-surface-hover hover:text-foreground"
            >
              <X size={16} aria-hidden="true" />
            </button>
          </div>

          <div
            onClick={(e) => e.stopPropagation()}
            className="flex cursor-default items-center gap-3"
          >
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
    </>
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
      onClick={(e) => {
        e.stopPropagation()
        skip(delta)
      }}
      aria-label={label}
      className="rounded-lg p-2 text-muted transition hover:bg-surface-hover hover:text-foreground"
    >
      {children}
    </button>
  )
}
