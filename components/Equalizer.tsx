/** Three bouncing bars marking whichever episode is currently playing. */
export default function Equalizer({ className = '' }: { className?: string }) {
  return (
    <span className={`inline-flex h-3 items-end gap-[2px] ${className}`} aria-hidden="true">
      {[0, 150, 300].map((delay) => (
        <span
          key={delay}
          className="equalizer-bar w-[3px] rounded-full bg-accent-soft"
          style={{ height: '100%', animationDelay: `${delay}ms` }}
        />
      ))}
    </span>
  )
}
