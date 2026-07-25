'use client'

import { useEffect, useRef, useState } from 'react'
import { Loader2, Play, Square } from 'lucide-react'
import { pause as pauseEpisode, usePlayer } from '@/lib/player/store'

/**
 * Plays a sample of the selected voice.
 *
 * The samples are static files under `public/previews/`, generated once by
 * `npm run previews` — so this is a cached GET against the CDN and never a TTS
 * call, and it works with no API key and no blob store.
 *
 * Its own `<audio>` element rather than the shared player store: a sample is not
 * a track — it has no episode, and putting it through the store would take over
 * the player bar with a scrubber and a rate control for ten seconds of speech.
 * The "one thing plays at a time" rule is kept by hand instead: starting a
 * sample pauses the episode player, and an episode starting stops the sample.
 *
 * Status is read off the element's own events rather than assigned alongside the
 * calls that cause them, so silencing a sample is always just `el.pause()` — the
 * resulting `pause` event puts the button back on its own.
 */

type Props = {
  voice: string
  /** Label of the selected voice, for the accessible name. */
  label: string
  disabled?: boolean
  onError: (message: string) => void
}

export default function VoicePreview({ voice, label, disabled, onError }: Props) {
  const [status, setStatus] = useState<'idle' | 'loading' | 'playing'>('idle')
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const episodePlaying = usePlayer().isPlaying

  // A different voice invalidates whatever is loaded and sounding.
  useEffect(() => {
    audioRef.current?.pause()
  }, [voice])

  // Yield to the episode player, and to a generation run taking the form over.
  useEffect(() => {
    if (!episodePlaying && !disabled) return
    audioRef.current?.pause()
  }, [episodePlaying, disabled])

  useEffect(() => () => audioRef.current?.pause(), [])

  function start() {
    pauseEpisode()
    setStatus('loading')

    const el = (audioRef.current ??= new Audio())
    el.onplaying = () => setStatus('playing')
    el.onpause = () => setStatus('idle')
    el.onended = () => setStatus('idle')
    el.onerror = () => {
      setStatus('idle')
      onError(`The ${label} sample is missing. Run \`npm run previews\` to generate it.`)
    }

    const src = `/previews/${voice}.mp3`
    // Reassigning the same src would refetch and re-decode; only the rewind is
    // wanted when the voice has not changed.
    if (el.src.endsWith(src)) el.currentTime = 0
    else el.src = src

    el.play().catch((err: unknown) => {
      // Pausing mid-start rejects with AbortError — that is our own doing (a
      // voice switch, an episode taking over), and the `pause` event has
      // already reset the button.
      if (err instanceof DOMException && err.name === 'AbortError') return
      setStatus('idle')
      onError(err instanceof Error ? err.message : 'Could not play the sample.')
    })
  }

  function stop() {
    const el = audioRef.current
    if (el) {
      el.pause()
      el.currentTime = 0
    }
    setStatus('idle')
  }

  const playing = status === 'playing'

  return (
    <button
      type="button"
      onClick={() => (status === 'idle' ? start() : stop())}
      disabled={disabled}
      aria-label={playing ? `Stop the ${label} sample` : `Hear a sample of the ${label} voice`}
      title={playing ? 'Stop' : `Hear a sample of the ${label} voice`}
      className={`inline-flex shrink-0 items-center justify-center rounded-xl border px-3 py-3 transition disabled:cursor-not-allowed disabled:opacity-50 sm:py-2.5 ${
        playing
          ? 'border-accent/60 bg-accent/10 text-accent-soft'
          : 'border-border bg-background text-muted hover:bg-surface-hover hover:text-foreground'
      }`}
    >
      {status === 'loading' ? (
        <Loader2 size={16} className="animate-spin" aria-hidden="true" />
      ) : playing ? (
        <Square size={16} fill="currentColor" aria-hidden="true" />
      ) : (
        <Play size={16} aria-hidden="true" />
      )}
    </button>
  )
}
