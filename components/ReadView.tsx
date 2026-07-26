'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { LyricLine } from '@/lib/player/lyrics'

/**
 * The script as something to read, with no player in it.
 *
 * Voice mode sets the script as lyrics — big type, one sentence lit, everything else
 * dimmed — which is right when the voice is leading and wrong when the eyes are.
 * Reading wants ordinary prose at an ordinary size, full contrast, and a measure short
 * enough to track: the clause-length lines that Voice mode stacks are put back into
 * paragraphs here.
 *
 * It reports the line at the top of the screen as it scrolls, which is what the switch
 * back to Voice mode plays from. That is the whole hand-off: the last thing you read is
 * the first thing you hear. Reporting it through a callback into the parent's ref keeps
 * the scrolling free of re-renders — nothing on screen depends on the value while
 * reading, only the exit does.
 */
export default function ReadView({
  lines,
  startIndex,
  onTopLine,
}: {
  lines: LyricLine[]
  /** Line to open at, put at the top of the screen — where the voice left off. */
  startIndex: number
  onTopLine: (index: number) => void
}) {
  const scrollerRef = useRef<HTMLElement>(null)

  // Frozen at entry: the audio is paused in this mode, so the position cannot move on
  // its own, and re-running the opening scroll later would yank the page mid-paragraph.
  const [entryIndex] = useState(startIndex)

  const paragraphs = useMemo(() => toParagraphs(lines), [lines])

  const measureTop = useCallback(
    (scroller: HTMLElement, spans: HTMLElement[]) => {
      // Binary search rather than a scan: `getBoundingClientRect` is a layout read, and
      // a full script is hundreds of spans on every scroll frame.
      const boxTop = scroller.getBoundingClientRect().top
      let low = 0
      let high = spans.length - 1
      let found = 0
      while (low <= high) {
        const mid = (low + high) >> 1
        if (spans[mid].getBoundingClientRect().bottom > boxTop + 1) {
          found = mid
          high = mid - 1
        } else {
          low = mid + 1
        }
      }
      const index = Number(spans[found].dataset.line)
      if (Number.isFinite(index)) onTopLine(index)
    },
    [onTopLine],
  )

  // Open where the voice stopped, at the top of the screen rather than the middle: the
  // text below it is what has not been heard yet, and that is what there is to read.
  useEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller) return

    const span = scroller.querySelector<HTMLElement>(`[data-line="${entryIndex}"]`)
    if (span) {
      const boxTop = scroller.getBoundingClientRect().top
      scroller.scrollTop += span.getBoundingClientRect().top - boxTop - 12
    }

    const spans = [...scroller.querySelectorAll<HTMLElement>('[data-line]')]
    if (spans.length === 0) return
    measureTop(scroller, spans)

    let frame = 0
    const onScroll = () => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        measureTop(scroller, spans)
      })
    }
    scroller.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      scroller.removeEventListener('scroll', onScroll)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [entryIndex, measureTop])

  return (
    <section
      ref={scrollerRef}
      aria-label="Transcript"
      className="relative min-h-0 flex-1 overflow-y-auto"
    >
      {/* ~65 characters a line at this size, and enough tail padding that the last
          paragraph can be read at the top of the screen like every other one. */}
      <article className="mx-auto max-w-[36rem] px-5 pb-[50vh] pt-1 sm:px-6">
        {paragraphs.map((paragraph) => (
          <p
            key={paragraph[0].index}
            className="mb-6 text-[17px] leading-[1.75] text-foreground/90 sm:text-[18px] sm:leading-[1.8]"
          >
            {paragraph.map((line, position) => (
              // Spans, not blocks: the lines are timing anchors, and the text has to
              // read as prose rather than as a column of fragments.
              <span key={line.index} data-line={line.index}>
                {line.text}
                {position < paragraph.length - 1 ? ' ' : ''}
              </span>
            ))}
          </p>
        ))}
      </article>
    </section>
  )
}

/** Regroups the timed lines into the paragraphs they were split out of. */
function toParagraphs(lines: LyricLine[]): LyricLine[][] {
  const paragraphs: LyricLine[][] = []
  for (const line of lines) {
    if (line.opensParagraph || paragraphs.length === 0) paragraphs.push([line])
    else paragraphs[paragraphs.length - 1].push(line)
  }
  return paragraphs
}
