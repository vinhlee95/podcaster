'use client'

import { useCallback, useEffect, useState } from 'react'
import { Check, Headphones, Loader2, Rss } from 'lucide-react'
import { stopIfPlaying } from '@/lib/player/store'
import type { GenerationStage } from '@/lib/options'
import type { EpisodeDto } from '@/lib/types'
import EpisodeCard from './EpisodeCard'
import GenerateForm from './GenerateForm'
import PlayerBar from './PlayerBar'

/**
 * Owns the episode list.
 *
 * The list is seeded from the server on first render and then mutated locally as
 * episodes are created and deleted — generation streams the finished row back on
 * its `done` event, so there is nothing a refetch would add.
 */
export default function Studio({
  initialEpisodes,
  feedPath,
}: {
  initialEpisodes: EpisodeDto[]
  /** Path to the RSS feed, or null when no `FEED_TOKEN` is configured. */
  feedPath: string | null
}) {
  const [episodes, setEpisodes] = useState<EpisodeDto[]>(initialEpisodes)
  const [generating, setGenerating] = useState<GenerationStage | null>(null)

  const handleCreated = useCallback((episode: EpisodeDto) => {
    // Generation may have reused an id that is already listed (a retry of a row
    // that failed), so replace rather than blindly prepend.
    setEpisodes((prev) => [episode, ...prev.filter((e) => e.id !== episode.id)])
  }, [])

  const handleDelete = useCallback(async (id: number) => {
    const response = await fetch(`/api/episodes/${id}`, { method: 'DELETE' })
    if (!response.ok) return
    // Nothing on screen could pause it once the card is gone.
    stopIfPlaying(`episode:${id}`)
    setEpisodes((prev) => prev.filter((e) => e.id !== id))
  }, [])

  return (
    <>
      {/* Bottom padding clears the fixed player bar. */}
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 pb-40 pt-10 sm:pt-16">
        <header className="mb-8">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 text-xs text-muted">
            <Headphones size={13} className="text-accent-soft" aria-hidden="true" />
            URL to podcast
          </div>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            Turn any article into
            <span className="bg-gradient-to-r from-accent to-accent-soft bg-clip-text text-transparent">
              {' '}
              something to listen to
            </span>
          </h1>
          <p className="mt-2 max-w-xl text-[15px] leading-relaxed text-muted">
            Paste a link. It gets read, rewritten as a spoken script, and recorded — then saved to
            your library for later.
          </p>
        </header>

        <GenerateForm onEpisodeCreated={handleCreated} onProgress={setGenerating} />

        <section className="mt-10">
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h2 className="text-sm font-medium uppercase tracking-wide text-muted">Library</h2>
            <div className="flex items-baseline gap-3">
              {episodes.length > 0 && (
                <span className="text-xs text-muted">
                  {episodes.length} episode{episodes.length === 1 ? '' : 's'}
                </span>
              )}
              {feedPath && <SubscribeButton feedPath={feedPath} />}
            </div>
          </div>

          {episodes.length === 0 && !generating ? (
            <EmptyState />
          ) : (
            <div className="flex flex-col gap-2">
              {generating && <GeneratingCard stage={generating} />}
              {episodes.map((episode) => (
                <EpisodeCard key={episode.id} episode={episode} onDelete={handleDelete} />
              ))}
            </div>
          )}
        </section>
      </main>

      <PlayerBar />
    </>
  )
}

/**
 * Copies the absolute feed URL for pasting into a podcast app.
 *
 * The URL is only assembled after mount: the server does not know which host the
 * browser used to reach it, and rendering a guess would mismatch on hydration.
 *
 * Not Spotify — its app has no "add by URL". Pocket Casts, Overcast, AntennaPod
 * and Apple Podcasts all take a raw feed URL.
 */
function SubscribeButton({ feedPath }: { feedPath: string }) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(timer)
  }, [copied])

  const copy = useCallback(async () => {
    // Built here rather than held in state: the server cannot know which host
    // the browser used, so any value rendered ahead of the click would either
    // be wrong or have to be reconciled after hydration.
    const feedUrl = `${window.location.origin}${feedPath}`
    try {
      await navigator.clipboard.writeText(feedUrl)
      setCopied(true)
    } catch {
      // Clipboard access needs a secure context and can be denied outright.
      // Selecting the text by hand is the fallback, so surface it.
      window.prompt('Copy the feed URL:', feedUrl)
    }
  }, [feedPath])

  return (
    <button
      type="button"
      onClick={copy}
      title="Copy the RSS feed URL for your podcast app"
      className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs text-muted transition-colors hover:border-accent/50 hover:text-accent-soft"
    >
      {copied ? (
        <Check size={12} aria-hidden="true" />
      ) : (
        <Rss size={12} aria-hidden="true" />
      )}
      {copied ? 'Copied' : 'Feed URL'}
    </button>
  )
}

const STAGE_COPY: Record<GenerationStage, string> = {
  extracting: 'Reading the page',
  writing: 'Writing the script',
  synthesizing: 'Recording the audio',
  uploading: 'Saving',
  done: 'Finishing up',
}

/** Placeholder card so a new episode occupies its slot in the list while it builds. */
function GeneratingCard({ stage }: { stage: GenerationStage }) {
  return (
    <article className="flex items-center gap-3 rounded-2xl border border-dashed border-accent/40 bg-surface/50 p-4">
      <div className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent-soft">
        <Loader2 size={16} className="animate-spin" aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="h-3 w-2/5 animate-pulse rounded-full bg-border" />
        <p className="mt-2 text-xs text-muted">{STAGE_COPY[stage]}…</p>
      </div>
    </article>
  )
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border px-6 py-14 text-center">
      <Headphones size={24} className="text-muted" aria-hidden="true" />
      <p className="text-sm text-muted">Nothing here yet.</p>
      <p className="max-w-xs text-xs leading-relaxed text-muted/70">
        Paste a link to a blog post, a news article, or documentation — anything you would rather
        hear than read.
      </p>
    </div>
  )
}
