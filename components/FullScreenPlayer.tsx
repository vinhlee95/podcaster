'use client'

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AudioLines,
  BookOpenText,
  ChevronDown,
  Headphones,
  Pause,
  Play,
  Volume1,
  Volume2,
  VolumeX,
} from 'lucide-react'
import {
  currentTimeNow,
  cycleRate,
  formatTime,
  pause,
  play,
  seek,
  setVolume,
  skip,
  usePlayer,
  SKIP_SECONDS,
  type Track,
} from '@/lib/player/store'
import {
  buildLyrics,
  lineIndexAt,
  wordsIn,
  LYRIC_LAG_S,
  type LyricLine,
  type SpokenWord,
} from '@/lib/player/lyrics'
import ReadView from './ReadView'
import SkipIcon from './SkipIcon'
import { rangeFill } from './rangeFill'

/**
 * The now-playing surface, in two modes.
 *
 * **Voice** is the player: artwork, transport, and the script as lyrics — modelled on
 * Apple Music, one sentence lit at a time and filling word by word as it is spoken.
 * The timing behind that is estimated rather than measured; see `lib/player/lyrics.ts`
 * for what it does and does not buy.
 *
 * **Read** is the same script as prose, with the player taken away.
 *
 * The two are exclusive on purpose. Trying to serve both at once is what produced the
 * earlier design, where the player quietly guessed from scroll position which one the
 * listener meant and hedged the difference with a floating button. One button that
 * says which mode you are in is easier to trust — and the switch itself carries the
 * position across, in the only two directions it can go: Read opens where the voice
 * stopped, and Voice starts from the top line on screen. Leave in the middle of a
 * paragraph, come back, press play, and the sentence you were reading is the one you
 * hear.
 *
 * Mounted by `PlayerBar` only while expanded, so none of the frame-by-frame work below
 * runs for a listener who never opens it.
 */
export default function FullScreenPlayer({
  track,
  onClose,
}: {
  track: Track
  onClose: () => void
}) {
  const { isPlaying, currentTime, duration, rate, volume, canSetVolume, errored } = usePlayer()
  const total = duration || track.duration || 0

  // Rebuilt when the element reports its real duration, which replaces the
  // estimate the row was seeded with and shifts every line with it.
  const lines = useMemo(() => buildLyrics(track.script, total), [track.script, total])

  const [mode, setMode] = useState<'voice' | 'read'>('voice')
  const canRead = lines.length > 0

  const time = useLiveTime(isPlaying, currentTime)
  const lyricTime = Math.max(time - LYRIC_LAG_S, 0)
  const activeIndex = lineIndexAt(lines, lyricTime)
  const activeLine = activeIndex >= 0 ? (lines[activeIndex] ?? null) : null

  const words = useMemo(() => (activeLine ? wordsIn(activeLine) : []), [activeLine])
  // Passed to the memoized list as a count rather than a timestamp: it changes a
  // few times a second instead of sixty, so the lines below re-render only when
  // something about them actually looks different.
  const spokenCount = words.filter((word) => word.startS <= lyricTime).length

  const scrollerRef = useRef<HTMLElement>(null)
  useCenterActiveLine(scrollerRef, activeIndex, mode)

  /** Top line of the reading view, kept in a ref so scrolling costs no renders. */
  const topLine = useRef(0)
  const noteTopLine = useCallback((index: number) => {
    topLine.current = index
  }, [])

  /** Reading is silent: there would be no way to stop the voice once the transport goes. */
  const startReading = useCallback(() => {
    pause()
    topLine.current = Math.max(activeIndex, 0)
    setMode('read')
  }, [activeIndex])

  /**
   * Hand back to the voice from the last thing that was read.
   *
   * The seek lands the position on that line before playing, so the player, the bar
   * behind this view, and the resume point saved for next time all agree — and it plays
   * without further asking, because the reason to press this is that you are leaving.
   */
  const startListening = useCallback(() => {
    const from = lines[topLine.current]
    if (from) seek(from.startS + SEEK_NUDGE_S)
    setMode('voice')
    void play(track)
  }, [lines, track])

  /**
   * Closing while reading leaves the position where the reading stopped.
   *
   * Otherwise the one exit that is not the Voice button — shutting the player to go
   * and do something else, which is exactly the moment this feature is for — would
   * throw the reading away and start the next play from wherever the audio was paused.
   */
  const close = useCallback(() => {
    if (mode === 'read') {
      const from = lines[topLine.current]
      if (from) seek(from.startS + SEEK_NUDGE_S)
    }
    onClose()
  }, [mode, lines, onClose])

  // Escape closes, and the page behind must not scroll while this is over it.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    document.addEventListener('keydown', onKeyDown)

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [close])

  const seekToLine = useCallback((line: LyricLine) => seek(line.startS + SEEK_NUDGE_S), [])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Now playing: ${track.title}`}
      className="player-rise fixed inset-0 z-50 flex flex-col overflow-hidden bg-background"
    >
      <Ambience />

      <header
        className="flex shrink-0 items-center gap-2 px-4"
        style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))', paddingBottom: '0.5rem' }}
      >
        <button
          type="button"
          onClick={close}
          aria-label="Close full screen player"
          className="inline-flex h-10 w-10 items-center justify-center rounded-full text-muted transition hover:bg-surface-hover hover:text-foreground"
        >
          <ChevronDown size={20} aria-hidden="true" />
        </button>

        <p className="min-w-0 flex-1 truncate text-center text-[11px] uppercase tracking-[0.18em] text-muted">
          {mode === 'read'
            ? 'Reading'
            : errored
              ? 'Unavailable'
              : isPlaying
                ? 'Now playing'
                : 'Paused'}
        </p>

        {/* Anchored right in both modes: a toggle that moves when you use it is a
            toggle you have to find again. */}
        {canRead && (
          <button
            type="button"
            onClick={mode === 'read' ? startListening : startReading}
            className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full border border-border px-3 text-xs font-medium text-muted transition hover:border-accent/50 hover:bg-surface-hover hover:text-foreground"
          >
            {mode === 'read' ? (
              <>
                <AudioLines size={14} aria-hidden="true" />
                Voice
              </>
            ) : (
              <>
                <BookOpenText size={14} aria-hidden="true" />
                Read
              </>
            )}
          </button>
        )}
      </header>

      {mode === 'read' ? (
        <ReadView lines={lines} startIndex={activeIndex} onTopLine={noteTopLine} />
      ) : (
        // Both children are stretched, deliberately: the lyric column needs a height to
        // scroll inside, and `items-center` would leave it as tall as the whole script
        // instead. The artwork column centres itself.
        <div className="flex min-h-0 flex-1 flex-col gap-5 px-5 pt-2 lg:flex-row lg:gap-12 lg:px-12">
          <div className="flex shrink-0 items-center gap-4 lg:w-72 lg:flex-col lg:items-start lg:justify-center lg:gap-6">
            <Artwork />
            <div className="min-w-0 lg:w-full">
              <h2 className="truncate text-[15px] font-semibold leading-snug lg:whitespace-normal lg:text-2xl lg:tracking-tight">
                {track.title}
              </h2>
              <p className="truncate text-sm text-muted lg:mt-1">{track.site ?? 'Podcaster'}</p>
            </div>
          </div>

          {lines.length === 0 ? (
            <NoLyrics errored={errored} />
          ) : (
            // A labelled region rather than a bare div: the lines are the episode's
            // transcript, and that is worth announcing as somewhere you arrived.
            <section
              ref={scrollerRef}
              aria-label="Transcript"
              className="lyrics-scroll relative min-h-0 flex-1 overflow-y-auto"
            >
              <LyricLines
                lines={lines}
                activeIndex={activeIndex}
                words={words}
                spokenCount={spokenCount}
                onSeek={seekToLine}
              />
            </section>
          )}
        </div>
      )}

      {/* The transport is the voice's, and Read mode is silent — so it goes entirely,
          rather than sitting there greyed out implying something is broken. */}
      {mode === 'voice' && (
        <footer
          className="shrink-0 px-5 lg:px-12"
          style={{ paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom))' }}
        >
          <div className="mx-auto w-full max-w-xl">
            <input
              type="range"
              min={0}
              max={total || 1}
              step={0.5}
              value={Math.min(currentTime, total)}
              onChange={(event) => seek(Number(event.target.value))}
              aria-label="Seek"
              className="range-fill w-full"
              style={rangeFill(total > 0 ? currentTime / total : 0)}
            />
            <div className="mt-1.5 flex justify-between font-mono text-[11px] tabular-nums text-muted">
              <span>{formatTime(currentTime)}</span>
              <span>-{formatTime(Math.max(total - currentTime, 0))}</span>
            </div>

            <div className="mt-3 flex items-center justify-center gap-8">
              <button
                type="button"
                onClick={() => skip(-SKIP_SECONDS)}
                aria-label={`Back ${SKIP_SECONDS} seconds`}
                className="inline-flex h-12 w-12 items-center justify-center rounded-full text-muted transition hover:bg-surface-hover hover:text-foreground active:scale-95"
              >
                <SkipIcon seconds={SKIP_SECONDS} direction="back" size={26} />
              </button>

              <button
                type="button"
                onClick={() => (isPlaying ? pause() : void play(track))}
                aria-label={isPlaying ? 'Pause' : 'Play'}
                className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-accent text-white shadow-lg shadow-accent/25 transition hover:scale-105 hover:bg-accent-soft active:scale-95"
              >
                {isPlaying ? (
                  <Pause size={26} fill="currentColor" aria-hidden="true" />
                ) : (
                  <Play size={26} fill="currentColor" className="ml-1" aria-hidden="true" />
                )}
              </button>

              <button
                type="button"
                onClick={() => skip(SKIP_SECONDS)}
                aria-label={`Forward ${SKIP_SECONDS} seconds`}
                className="inline-flex h-12 w-12 items-center justify-center rounded-full text-muted transition hover:bg-surface-hover hover:text-foreground active:scale-95"
              >
                <SkipIcon seconds={SKIP_SECONDS} direction="forward" size={26} />
              </button>
            </div>

            <Volume volume={volume} canSetVolume={canSetVolume} />

            {/* The bottom row, where Apple keeps the controls that are settings rather
                than transport: reached deliberately, and out of the way of the thumb
                that is aiming for play. */}
            <div className="mt-4 flex items-center justify-center">
              <button
                type="button"
                onClick={() => cycleRate()}
                aria-label={`Change playback speed, currently ${rate}x`}
                className="inline-flex h-9 min-w-14 items-center justify-center rounded-full border border-border px-3 font-mono text-xs text-muted transition hover:bg-surface-hover hover:text-foreground active:scale-95"
              >
                {rate}x
              </button>
            </div>
          </div>
        </footer>
      )}
    </div>
  )
}

/**
 * Follows the element frame by frame while it plays.
 *
 * The store's `currentTime` is sampled from `timeupdate` — right for a scrubber,
 * too coarse for a highlight that has to land on a word. While paused there is
 * nothing to animate, so state is the source again and a seek still moves the
 * highlight. Animation frames stop on their own in a hidden tab, so a
 * backgrounded listener costs nothing.
 */
function useLiveTime(isPlaying: boolean, currentTime: number): number {
  const [frameTime, setFrameTime] = useState(currentTime)

  useEffect(() => {
    if (!isPlaying) return
    let frame = 0
    const tick = () => {
      setFrameTime(currentTimeNow())
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [isPlaying])

  // Paused, the store is the better answer and the sampled value is left to go
  // stale: nothing is animating, and a seek has to move the highlight with no
  // frame loop running to notice it.
  return isPlaying ? frameTime : currentTime
}

/** How long autoscroll stands down after a nudge that left the voice on screen. */
const SCROLL_YIELD_MS = 5000

/**
 * Tapping a line seeks a hair past where it starts.
 *
 * `currentTime` snaps to a position the decoder can resume from, which can land
 * a few milliseconds *before* the line begins — leaving the highlight on the line
 * above the one that was tapped, which reads as a tap that missed.
 */
const SEEK_NUDGE_S = 0.05

/**
 * Keeps the active line centred, and gets out of the way when the listener scrolls by
 * hand — the same courtesy Apple Music extends.
 *
 * Intent is read from the input that caused the scroll rather than from `scroll`
 * events, because those are not all a person's doing: the browser re-anchors the
 * column as the active line re-renders under it, and treating that as "they are
 * reading ahead" stands autoscroll down for good. A wheel and a finger, though, only
 * ever come from someone who meant it. Anyone who wants to read rather than glance has
 * a mode for it, so this only has to survive the glance.
 */
function useCenterActiveLine(
  scrollerRef: React.RefObject<HTMLElement | null>,
  activeIndex: number,
  mode: 'voice' | 'read',
) {
  const yieldUntil = useRef(0)
  const hasCentered = useRef(false)

  const center = useCallback(
    (index: number) => {
      const scroller = scrollerRef.current
      if (!scroller || index < 0) return
      if (Date.now() < yieldUntil.current) return

      const line = scroller.querySelector<HTMLElement>(`[data-line="${index}"]`)
      if (!line) return

      // The first placement is not animated: arriving on an episode already halfway
      // through should not scroll past everything to get there. Read mode unmounts the
      // column, so coming back from it counts as arriving again.
      const smooth =
        hasCentered.current && !window.matchMedia('(prefers-reduced-motion: reduce)').matches
      hasCentered.current = true

      scroller.scrollTo({
        top: line.offsetTop - scroller.clientHeight / 2 + line.offsetHeight / 2,
        behavior: smooth ? 'smooth' : 'auto',
      })
    },
    [scrollerRef],
  )

  useEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller) return

    const yieldToReader = () => {
      yieldUntil.current = Date.now() + SCROLL_YIELD_MS
    }
    scroller.addEventListener('wheel', yieldToReader, { passive: true })
    scroller.addEventListener('touchmove', yieldToReader, { passive: true })
    return () => {
      scroller.removeEventListener('wheel', yieldToReader)
      scroller.removeEventListener('touchmove', yieldToReader)
    }
  }, [scrollerRef, mode])

  useEffect(() => {
    if (mode !== 'voice') {
      hasCentered.current = false
      return
    }
    center(activeIndex)
  }, [center, activeIndex, mode])

  // A rotated phone re-wraps every line, so where the centre was is not where it is
  // now, and the next line is seconds away from correcting it.
  useEffect(() => {
    if (mode !== 'voice') return
    const onResize = () => center(activeIndex)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [center, activeIndex, mode])
}

/**
 * The lyric column.
 *
 * The lit unit is the sentence, not the line. Lines are clause-length because that
 * is what reads at a glance while the column moves, but the timing is not accurate
 * to a clause — so lighting one would be claiming precision the estimate does not
 * have, and being a line out would show. Lighting the sentence the voice is inside
 * absorbs that error: within the sentence the words still fill one at a time, so
 * there is no loss of detail, only a claim that is true.
 *
 * Memoized because the parent re-renders on every animation frame while the word
 * fill advances, and reconciling several hundred lines sixty times a second is
 * exactly the kind of work a phone notices. Every prop here changes at most a few
 * times a second, so the list holds still in between.
 */
const LyricLines = memo(function LyricLines({
  lines,
  activeIndex,
  words,
  spokenCount,
  onSeek,
}: {
  lines: LyricLine[]
  activeIndex: number
  words: SpokenWord[]
  spokenCount: number
  onSeek: (line: LyricLine) => void
}) {
  const activeSentence = activeIndex >= 0 ? lines[activeIndex]?.sentenceIndex : -1

  return (
    // Half a viewport of padding at each end so the first and last lines can
    // reach the middle of the column like every line between them.
    <div className="flex flex-col py-[42vh]">
      {lines.map((line) => {
        const isActive = line.index === activeIndex
        const inActiveSentence = line.sentenceIndex === activeSentence
        const distance = Math.abs(line.index - activeIndex)

        return (
          <button
            key={line.index}
            type="button"
            data-line={line.index}
            onClick={() => onSeek(line)}
            className={`origin-left rounded-lg py-2 text-left text-[22px] font-semibold leading-snug tracking-tight transition-all duration-500 sm:text-3xl ${
              line.opensParagraph ? 'mt-5 first:mt-0' : ''
            } ${
              inActiveSentence
                ? // Earlier lines of this sentence have been read; later ones carry
                  // the same tone as its words that are still to come.
                  line.index <= activeIndex
                  ? 'scale-100 text-foreground'
                  : 'scale-100 text-foreground/50'
                : distance > 3
                  ? 'scale-[0.97] text-muted/35 blur-[1.5px] hover:text-muted hover:blur-0'
                  : 'scale-[0.97] text-muted/60 hover:text-muted'
            }`}
          >
            {isActive && words.length > 0
              ? words.map((word, wordIndex) => (
                  <span
                    key={`${line.index}:${wordIndex}`}
                    className={
                      wordIndex < spokenCount
                        ? 'text-foreground transition-colors duration-200'
                        : 'text-foreground/50 transition-colors duration-200'
                    }
                  >
                    {word.text}
                    {wordIndex < words.length - 1 ? ' ' : ''}
                  </span>
                ))
              : line.text}
          </button>
        )
      })}
    </div>
  )
})

/**
 * The volume row: a slider between a quiet speaker and a loud one.
 *
 * The icons are decoration, not controls — the same arrangement Apple Music uses,
 * where the ends of the slider say which way is which and the slider is the only
 * thing to hit. The left one does report a silenced player, though, because a
 * slider dragged to zero and an episode that failed to load look identical
 * otherwise.
 *
 * Absent entirely where the browser will not take a volume: see `canSetVolume`.
 */
function Volume({ volume, canSetVolume }: { volume: number; canSetVolume: boolean }) {
  if (!canSetVolume) return null

  const Quiet = volume === 0 ? VolumeX : Volume1

  return (
    <div className="mt-5 flex items-center gap-3">
      <Quiet size={16} className="shrink-0 text-muted" aria-hidden="true" />
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={volume}
        onChange={(event) => setVolume(Number(event.target.value))}
        aria-label="Volume"
        aria-valuetext={`${Math.round(volume * 100)} percent`}
        className="range-fill min-w-0 flex-1"
        style={rangeFill(volume)}
      />
      <Volume2 size={16} className="shrink-0 text-muted" aria-hidden="true" />
    </div>
  )
}

/**
 * Artwork.
 *
 * The show's cover art is a committed 3000px PNG (`public/cover.png`) built for
 * podcast clients; drawing the same gradient and glyph in CSS costs no bytes and
 * scales to the desktop column, where a fixed raster would not.
 */
function Artwork() {
  return (
    <div
      aria-hidden="true"
      className="grid aspect-square w-14 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-accent to-accent-soft shadow-lg shadow-accent/25 lg:w-full lg:rounded-3xl"
    >
      <Headphones className="h-1/2 w-1/2 text-white/90" strokeWidth={1.5} />
    </div>
  )
}

/** Two slow accent washes, so the page behind the lyrics is not flat black. */
function Ambience() {
  return (
    // Negative z-index so the washes sit over the backdrop but under the chrome,
    // which is in normal flow and would otherwise be painted on top of.
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      {/* Sized on the short side of the viewport: a tall phone screen would take
          `vh` and tint the whole page rather than glow at a corner of it. */}
      <div className="ambient-blob absolute -left-1/4 -top-1/4 h-[65vmin] w-[65vmin] rounded-full bg-accent/20 blur-[120px]" />
      <div
        className="ambient-blob absolute -bottom-1/4 -right-1/4 h-[55vmin] w-[55vmin] rounded-full bg-accent-soft/15 blur-[120px]"
        style={{ animationDelay: '-9s' }}
      />
    </div>
  )
}

function NoLyrics({ errored }: { errored: boolean }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 text-center">
      <p className="text-sm text-muted">
        {errored ? 'This audio could not be loaded.' : 'No transcript for this episode.'}
      </p>
      {!errored && (
        <p className="max-w-xs text-xs leading-relaxed text-muted/70">
          Nothing to follow along with — the audio plays just the same.
        </p>
      )}
    </div>
  )
}
