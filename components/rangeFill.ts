import type { CSSProperties } from 'react'

/**
 * The style that tells a `.range-fill` slider how far along it is.
 *
 * A cast is unavoidable: `CSSProperties` is a fixed set of known properties and a
 * custom property is by definition not in it. Keeping the cast here means the two
 * players share one spelling of the variable name rather than each guessing it.
 */
export function rangeFill(fraction: number): CSSProperties {
  // Rounded because the raw division carries float noise all the way into the
  // markup, where `28.999999999999996%` is no more accurate and much harder to read.
  const percent = Math.round(Math.min(Math.max(fraction, 0), 1) * 10000) / 100
  return { '--fill': `${percent}%` } as CSSProperties
}
