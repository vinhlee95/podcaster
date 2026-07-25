'use client'

import { useSyncExternalStore } from 'react'

/**
 * Single-player store for episode audio.
 *
 * One module-level `<audio>` element is shared by the whole app, so starting a
 * track inherently stops the previous one — the "only one plays at a time" rule
 * needs no coordination between components.
 *
 * Ported from stonkie's `useRecapAudio.ts`, minus the signed-URL expiry
 * handling: Vercel Blob URLs are public and permanent, so a load failure here
 * is a genuine error rather than a routine "refetch for a fresh URL".
 *
 * `crossOrigin` is deliberately left unset and the bytes are never `fetch`ed.
 * Setting it (or piping the element into the Web Audio API) would trigger a CORS
 * preflight against the blob host — a failure that only shows up at runtime.
 */

export type Track = {
  id: string
  url: string
  title: string
  /** Exact length from the DB, used for layout before metadata loads. */
  duration: number
  /** Shown as the artist in the OS media notification. */
  site?: string | null
}

export type PlayerState = {
  trackId: string | null
  track: Track | null
  isPlaying: boolean
  currentTime: number
  duration: number
  rate: number
  /** True when the last load failed. */
  errored: boolean
}

export const PLAYBACK_RATES = [1, 1.25, 1.5, 1.75, 2] as const

const INITIAL_STATE: PlayerState = {
  trackId: null,
  track: null,
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  rate: 1,
  errored: false,
}

let state: PlayerState = INITIAL_STATE
const listeners = new Set<() => void>()

function setState(patch: Partial<PlayerState>) {
  state = { ...state, ...patch }
  listeners.forEach((l) => l())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

const getSnapshot = () => state
const getServerSnapshot = () => INITIAL_STATE

let audio: HTMLAudioElement | null = null

function ensureAudio(): HTMLAudioElement {
  if (audio) return audio

  const el = new Audio()
  el.preload = 'none'
  el.playbackRate = state.rate

  // Read `paused` rather than inferring from the event name. Swapping `src`
  // mid-playback fires a `pause` *after* the new `play()` has been issued, so
  // trusting the event alone leaves the new track stuck showing as paused.
  el.addEventListener('play', () => setState({ isPlaying: !el.paused, errored: false }))
  el.addEventListener('pause', () => setState({ isPlaying: !el.paused }))
  el.addEventListener('timeupdate', () => setState({ currentTime: el.currentTime }))
  el.addEventListener('ended', () => setState({ isPlaying: false, currentTime: 0 }))
  el.addEventListener('error', () => setState({ isPlaying: false, errored: true }))
  // The element's own metadata wins once loaded; the stored duration was only a
  // seed, and it is an estimate from file size rather than a decoded length.
  el.addEventListener('loadedmetadata', () => {
    if (Number.isFinite(el.duration) && el.duration > 0) setState({ duration: el.duration })
  })

  audio = el
  return el
}

function applyMediaSession(track: Track) {
  if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return
  if (typeof MediaMetadata !== 'undefined') {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title,
      artist: track.site ?? 'Podcaster',
      album: 'Podcaster',
    })
  }

  // Browsers throw for actions they don't support, so each is set defensively.
  const handle = (action: MediaSessionAction, fn: MediaSessionActionHandler) => {
    try {
      navigator.mediaSession.setActionHandler(action, fn)
    } catch {
      // Unsupported action — the lock-screen control degrades, playback is fine.
    }
  }

  handle('play', () => void resume())
  handle('pause', () => pause())
  handle('seekto', (details) => {
    if (typeof details.seekTime === 'number') seek(details.seekTime)
  })
  handle('seekbackward', () => seek(state.currentTime - 15))
  handle('seekforward', () => seek(state.currentTime + 15))
}

/** Starts `track`, replacing whatever was playing. Re-selecting the loaded track resumes it. */
export async function play(track: Track) {
  const el = ensureAudio()

  if (state.trackId !== track.id || el.src !== track.url) {
    // Pause first so the swap's own pause/abort events settle against the old
    // track instead of racing the new one.
    el.pause()
    el.src = track.url
    el.currentTime = 0
    setState({
      trackId: track.id,
      track,
      currentTime: 0,
      duration: track.duration,
      errored: false,
    })
    applyMediaSession(track)
  }

  el.playbackRate = state.rate
  try {
    await el.play()
  } catch {
    // Autoplay rejections and aborted loads both land here; the element's own
    // `error` event covers the cases worth surfacing.
  }
  // Reconcile once the promise settles, in case a stale event landed in between.
  setState({ isPlaying: !el.paused })
}

export function pause() {
  audio?.pause()
}

async function resume() {
  if (!audio) return
  try {
    await audio.play()
  } catch {
    // See note in `play`.
  }
}

/** Play/pause `track`, loading it first if a different one is current. */
export function toggle(track: Track) {
  if (state.trackId === track.id && state.isPlaying) {
    pause()
    return
  }
  void play(track)
}

export function seek(seconds: number) {
  if (!audio) return
  const max = state.duration || audio.duration || 0
  const clamped = Math.min(Math.max(seconds, 0), max)
  audio.currentTime = clamped
  setState({ currentTime: clamped })
}

export function skip(delta: number) {
  seek(state.currentTime + delta)
}

export function setRate(rate: number) {
  if (audio) audio.playbackRate = rate
  setState({ rate })
}

/** Cycles to the next rate in `PLAYBACK_RATES` and returns it. */
export function cycleRate(): number {
  const idx = PLAYBACK_RATES.indexOf(state.rate as (typeof PLAYBACK_RATES)[number])
  const next = PLAYBACK_RATES[(idx + 1) % PLAYBACK_RATES.length]
  setRate(next)
  return next
}

/** Stops playback and clears the loaded track — used when its episode is deleted. */
export function stop() {
  if (audio) {
    audio.pause()
    audio.removeAttribute('src')
    audio.load()
  }
  setState({ trackId: null, track: null, isPlaying: false, currentTime: 0, duration: 0, errored: false })
}

/** Stops only if `trackId` is the one loaded. */
export function stopIfPlaying(trackId: string) {
  if (state.trackId === trackId) stop()
}

export function usePlayer(): PlayerState {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

/** Formats seconds as m:ss. */
export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const total = Math.round(seconds)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}
