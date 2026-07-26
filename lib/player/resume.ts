/**
 * Where each episode was left off.
 *
 * This is what makes the hand-off survive leaving. Read the script at your desk, shut
 * the laptop, and hours later press play — the position it starts from is the one
 * recorded here, not the top of the episode. Without it the hand-off only works
 * inside a single page view, which is the one situation where it is least needed.
 *
 * There is one position per episode, and it means "where playback starts next".
 * Everything that moves that point writes it: playing, scrubbing, and reading the
 * script while paused. Keeping it a single number is what stops the player from
 * disagreeing with itself about where "here" is.
 *
 * `localStorage`, not the database. It needs no round trip on the path where it
 * matters (`play` has to know the position before the first byte is fetched), and the
 * app has no user model, so a per-episode column would be per-device in effect
 * anyway. The trade is real, though: the position does not follow you from the laptop
 * you read on to the phone you listen on. Moving it server-side is a change to the
 * three functions below and nothing else — no caller knows where it is kept.
 */

const KEY = 'podcaster:resume'

/**
 * Below this, resuming is worse than starting over: a couple of seconds in, the
 * listener has heard nothing they would miss, and the jump only looks like a bug.
 */
const MIN_RESUME_S = 5

/**
 * This close to the end, the episode counts as finished and the next play starts
 * from the top — the convention every podcast app follows, and the reason a finished
 * episode does not park you three seconds from its own outro forever.
 */
const FINISHED_TAIL_S = 15

type Positions = Record<string, number>

function load(): Positions {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(KEY)
    const parsed = raw ? (JSON.parse(raw) as unknown) : null
    return parsed && typeof parsed === 'object' ? (parsed as Positions) : {}
  } catch {
    // Unreadable or not JSON — a corrupt entry is not worth failing playback over.
    return {}
  }
}

function save(positions: Positions) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(KEY, JSON.stringify(positions))
  } catch {
    // Private mode and a full quota both throw here. Losing the position is a
    // smaller problem than losing the click that triggered the write.
  }
}

/** Records where `trackId` is, in seconds. */
export function savePosition(trackId: string, seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return
  const positions = load()
  positions[trackId] = Math.round(seconds * 10) / 10
  save(positions)
}

export function clearPosition(trackId: string) {
  const positions = load()
  if (!(trackId in positions)) return
  delete positions[trackId]
  save(positions)
}

/**
 * Where a fresh load of `trackId` should start — 0 when there is nothing worth
 * resuming. `durationS` may be the estimate from the row; it is only used to decide
 * whether the position is close enough to the end to count as finished.
 */
export function resumePosition(trackId: string, durationS: number): number {
  const at = load()[trackId]
  if (typeof at !== 'number' || !Number.isFinite(at)) return 0
  if (at < MIN_RESUME_S) return 0
  if (durationS > 0 && at > durationS - FINISHED_TAIL_S) return 0
  return at
}
