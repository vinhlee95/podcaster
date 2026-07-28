/**
 * The listener's volume, remembered between sessions.
 *
 * Volume is a property of the person, not of the episode — someone who turned it
 * down once meant it for everything they play after, so unlike a resume position
 * there is a single value here rather than one per track.
 *
 * `localStorage`, for the same reason as `resume.ts`: it has to be readable before
 * the element is handed its first source, with no round trip in the way.
 */

const KEY = 'podcaster:volume'

/** Two decimals is finer than the ear or the slider; the rest is drag noise. */
function round(volume: number): number {
  return Math.round(volume * 100) / 100
}

export function loadVolume(): number {
  if (typeof window === 'undefined') return 1
  try {
    const raw = window.localStorage.getItem(KEY)
    const parsed = raw === null ? NaN : Number(raw)
    if (!Number.isFinite(parsed)) return 1
    return Math.min(Math.max(round(parsed), 0), 1)
  } catch {
    // Unreadable storage is not worth failing playback over — full volume is a
    // safe answer, and the next change will try to write it again.
    return 1
  }
}

export function saveVolume(volume: number) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(KEY, String(round(volume)))
  } catch {
    // Private mode and a full quota both throw here; see `resume.ts`.
  }
}
