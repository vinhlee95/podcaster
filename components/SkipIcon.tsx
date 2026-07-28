import { RotateCcw, RotateCw } from 'lucide-react'

/**
 * A skip button's icon with its interval printed inside the arrow, as Apple's
 * players do: the arrow says which way, the number says how far. Without it the
 * two controls are a guess between 10, 15 and 30 seconds that only pressing one
 * can settle.
 *
 * The digits are sized from the icon so the pair stays in proportion at every
 * size this is used at, and the whole thing is hidden from assistive tech —
 * the button around it already carries the interval in its label.
 */
export default function SkipIcon({
  seconds,
  direction,
  size = 22,
}: {
  seconds: number
  direction: 'back' | 'forward'
  size?: number
}) {
  const Arrow = direction === 'back' ? RotateCcw : RotateCw

  return (
    <span
      aria-hidden="true"
      className="relative inline-flex shrink-0 items-center justify-center"
      style={{ width: size, height: size }}
    >
      <Arrow size={size} strokeWidth={1.75} />
      {/* Absolutely centred rather than laid out, so the number sits in the
          arrow's open middle instead of displacing it. */}
      <span
        className="absolute font-semibold leading-none tabular-nums"
        style={{ fontSize: Math.round(size * 0.38) }}
      >
        {seconds}
      </span>
    </span>
  )
}
