/**
 * Turns a spoken script into timed lines for the full-screen player.
 *
 * OpenAI TTS returns audio and nothing else — no alignment, no word marks — so
 * this timeline is *derived* rather than measured. A narrator's pace is close to
 * constant, so a line's share of the script's characters is a good proxy for its
 * share of the running time. Punctuation earns extra weight because a reader
 * pauses there, spending time without spending characters.
 *
 * Two properties worth knowing:
 *
 * - It cannot drift out the far end. The whole timeline is fitted to the audio's
 *   real duration, so an error in the middle is absorbed by the lines after it
 *   rather than accumulating to the end.
 * - The error in the middle is real, and its dominant cause is not this model. A
 *   long script is synthesized as several independent TTS calls (see `chunkScript`),
 *   and each call sets its own pace: measured across this project's episodes, the
 *   same voice reads at anywhere from 15.7 to 17.5 characters a second. A single
 *   rate cannot follow pacing that changes between chunks, which is worth about
 *   ±5% — half a minute into a chunk, several seconds.
 *
 * That last point is why the view lights a whole sentence rather than one clause,
 * and why the fix that would actually earn word-level accuracy is anchoring the
 * timeline at the chunk boundaries (their durations are known at synthesis time) or
 * aligning against a transcription with word timestamps.
 *
 * No React and no DOM here: this is arithmetic over a string, and keeping it
 * separate is what lets the view stay a rendering concern.
 */

/**
 * Lines longer than this are broken at the nearest clause boundary.
 *
 * Short lines are the whole reason the view is readable while it moves — the
 * same reason song lyrics are set a phrase at a time and not a paragraph at a
 * time. A podcast script is written in full sentences, so most of the breaking
 * work happens here rather than at the sentence splitter.
 */
const MAX_LINE_CHARS = 96

/**
 * How long the voice rests at each kind of break, in seconds.
 *
 * Seconds rather than a share of the reading, because that is what a pause is: a
 * comma does not get shorter because the narrator is quick. They come out of the
 * duration first, and the speaking rate is then whatever fits the characters into
 * what is left — which also makes these numbers checkable against a recording
 * instead of being tuning knobs.
 */
const CLAUSE_PAUSE_S = 0.25
const SENTENCE_PAUSE_S = 0.6
const PARAGRAPH_PAUSE_S = 1.1

/**
 * Ceiling on the share of the audio that pauses may claim.
 *
 * A short clip of very choppy text can ask for more silence than it has room for,
 * and a negative speaking rate would put every line at once.
 */
const MAX_PAUSE_SHARE = 0.4

/**
 * The highlight is held this far behind the estimate.
 *
 * Error is unavoidable here (see the note on pacing above), so the point is to
 * choose which way it falls. A highlight that trails the voice reads as following
 * it; one that leads gives away the line before it is spoken and reads as broken.
 * Half a second is enough to put the common case on the safe side of that.
 */
export const LYRIC_LAG_S = 0.5

/** Sentence terminators, plus any closing quote or bracket that trails them. */
const SENTENCE_RE = /[^.!?…]+(?:[.!?…]+["'”’)\]]*|\s*$)/g

/** Clause boundaries, used only when a sentence is too long to set as one line. */
const CLAUSE_RE = /[^,;:—–]+[,;:—–]*\s*/g

/** A fragment opening in lower case or a digit continues the fragment before it. */
const CONTINUES_SENTENCE = /^\s*[a-z0-9]/

/** A lone letter and a period: the `A.` of `A.I.`, not the end of a sentence. */
const ENDS_IN_INITIAL = /(?:^|[^A-Za-z])[A-Za-z]\.$/

export type LyricLine = {
  index: number
  text: string
  /** When the voice reaches this line. */
  startS: number
  /** When the voice finishes it — before whatever pause follows. */
  endS: number
  /**
   * Which sentence the line belongs to.
   *
   * Lines are clause-length so they read at a glance, but a clause is a finer unit
   * than the timing can resolve. The view lights a whole sentence at once, so the
   * common error — being a line or so out — usually lands inside the sentence
   * already lit and never shows.
   */
  sentenceIndex: number
  /** First line of a paragraph. The view sets extra space above it. */
  opensParagraph: boolean
}

export type SpokenWord = {
  text: string
  startS: number
  endS: number
}

/**
 * Lays `script` out as lines spanning `durationS` seconds.
 *
 * Returns an empty list for an empty script or a duration that is not yet known,
 * which is the view's cue to fall back to plain artwork.
 */
export function buildLyrics(
  script: string | null | undefined,
  durationS: number,
): LyricLine[] {
  if (!script?.trim()) return []
  if (!Number.isFinite(durationS) || durationS <= 0) return []

  const drafts = layOutLines(script)
  const totalChars = drafts.reduce((sum, draft) => sum + draft.text.length, 0)
  if (totalChars === 0) return []

  // Silence first, characters second. Both are then fixed, so the walk below lands
  // exactly on `durationS` — the estimate is wrong in the middle, never at the end.
  const wantedPause = drafts.reduce((sum, draft) => sum + draft.pauseS, 0)
  const pauseBudget = Math.min(wantedPause, durationS * MAX_PAUSE_SHARE)
  const pauseScale = wantedPause > 0 ? pauseBudget / wantedPause : 0
  const rate = totalChars / (durationS - pauseBudget)

  let at = 0
  return drafts.map((draft, index) => {
    // `endS` covers the spoken characters only, so the pause after a line belongs
    // to neither it nor the next one — the highlight holds where it is while the
    // narrator breathes, which is what a listener expects to see.
    const startS = at
    const endS = startS + draft.text.length / rate
    at = endS + draft.pauseS * pauseScale
    return {
      index,
      text: draft.text,
      startS,
      endS,
      sentenceIndex: draft.sentenceIndex,
      opensParagraph: draft.opensParagraph,
    }
  })
}

/** Index of the line being spoken at `timeS`, or -1 when there are no lines. */
export function lineIndexAt(lines: LyricLine[], timeS: number): number {
  if (lines.length === 0) return -1

  // Binary search rather than a scan: this runs on every animation frame while
  // playing, and a full-article script is several hundred lines.
  let low = 0
  let high = lines.length - 1
  let found = 0
  while (low <= high) {
    const mid = (low + high) >> 1
    if (lines[mid].startS <= timeS) {
      found = mid
      low = mid + 1
    } else {
      high = mid - 1
    }
  }
  return found
}

/**
 * Times the words inside one line, so the active line can fill word by word
 * instead of switching on all at once.
 *
 * The same character-share model, applied inside a line where it is at its most
 * accurate: there is no sentence pause in the middle of one to account for. The
 * `+ 1` per word pays for the space after it.
 */
export function wordsIn(line: LyricLine): SpokenWord[] {
  const words = line.text.split(/\s+/).filter(Boolean)
  if (words.length === 0) return []

  const span = Math.max(line.endS - line.startS, 0)
  const totalWeight = words.reduce((sum, word) => sum + word.length + 1, 0)

  let spent = 0
  return words.map((text) => {
    const startS = line.startS + (spent / totalWeight) * span
    spent += text.length + 1
    return { text, startS, endS: line.startS + (spent / totalWeight) * span }
  })
}

type LineDraft = {
  text: string
  /** Silence following the line, in seconds. */
  pauseS: number
  sentenceIndex: number
  opensParagraph: boolean
}

/** Splits the script into display lines, each with the pause that follows it. */
function layOutLines(script: string): LineDraft[] {
  const drafts: LineDraft[] = []
  let sentenceIndex = 0

  for (const paragraph of script.split(/\n\s*\n+/)) {
    // A single newline inside a paragraph is wrapping, not structure.
    const body = paragraph.replace(/\s+/g, ' ').trim()
    if (!body) continue

    const sentences = splitSentences(body)
    sentences.forEach((sentence, sentenceIdx) => {
      const pieces = sentence.length > MAX_LINE_CHARS ? splitClauses(sentence) : [sentence]
      const lastSentence = sentenceIdx === sentences.length - 1

      pieces.forEach((text, pieceIdx) => {
        const lastPiece = pieceIdx === pieces.length - 1
        const pauseS = !lastPiece
          ? CLAUSE_PAUSE_S
          : lastSentence
            ? PARAGRAPH_PAUSE_S
            : SENTENCE_PAUSE_S

        drafts.push({
          text,
          pauseS,
          sentenceIndex,
          opensParagraph: sentenceIdx === 0 && pieceIdx === 0,
        })
      })

      sentenceIndex += 1
    })
  }

  return drafts
}

/**
 * Splits a paragraph into sentences.
 *
 * Same regex as `chunkScript` in the TTS connector, which has the same problem to
 * solve — but a wrong answer costs more here. There, a bad split only moves a
 * request boundary; here it becomes a line on screen, so `A.I.` must not read as
 * two sentences called "A." and "I.", and `4.5` must not read as one called "4."
 *
 * Two rules put those back together. A fragment opening in lower case or a digit
 * cannot be the start of a sentence, so it belongs to the fragment before it. And
 * a fragment ending in a lone letter and a period is sitting inside an initialism,
 * so whatever follows belongs to it. Merging happens before trimming, so the
 * original spacing survives.
 */
function splitSentences(text: string): string[] {
  const matches = text.match(SENTENCE_RE) ?? [text]
  const merged: string[] = []

  for (const piece of matches) {
    const previous = merged[merged.length - 1]
    const continues =
      previous !== undefined &&
      (CONTINUES_SENTENCE.test(piece) || ENDS_IN_INITIAL.test(previous))

    if (continues) {
      merged[merged.length - 1] = previous + piece
      continue
    }
    merged.push(piece)
  }

  return merged.map((piece) => piece.trim()).filter(Boolean)
}

/** Breaks an over-long sentence at clause boundaries, packing greedily. */
function splitClauses(sentence: string): string[] {
  const segments = sentence.match(CLAUSE_RE) ?? [sentence]
  const lines: string[] = []
  let current = ''

  for (const segment of segments) {
    if (current && (current + segment).trim().length > MAX_LINE_CHARS) {
      lines.push(current.trim())
      current = segment
    } else {
      current += segment
    }
  }
  if (current.trim()) lines.push(current.trim())

  // A clause with no internal punctuation can still overrun; words are the last
  // boundary available before cutting mid-word, which is never worth doing.
  return lines.flatMap((line) => (line.length > MAX_LINE_CHARS ? packWords(line) : [line]))
}

function packWords(text: string): string[] {
  const lines: string[] = []
  let current = ''

  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (current && `${current} ${word}`.length > MAX_LINE_CHARS) {
      lines.push(current)
      current = word
    } else {
      current = current ? `${current} ${word}` : word
    }
  }
  if (current) lines.push(current)

  return lines
}
