import { pgTable, serial, text, real, integer, timestamp, index } from 'drizzle-orm/pg-core'

/**
 * A generated episode: one source URL in, one mp3 out.
 *
 * The row is written before generation starts so the library can render the
 * episode with a progress state, then patched as each stage completes. A row
 * left in `generating` means the request died mid-flight (function timeout,
 * client disconnect) — `staleGeneratingCutoff` in the query layer surfaces
 * those as failed rather than leaving them spinning forever.
 */
export const episodes = pgTable(
  'episodes',
  {
    id: serial('id').primaryKey(),
    url: text('url').notNull(),
    /** Article title from extraction; falls back to the hostname. */
    title: text('title').notNull(),
    /** Hostname of `url`, denormalized so the UI can show it without parsing. */
    sourceSite: text('source_site'),
    /** One-line hook written alongside the script, shown on the episode card. */
    summary: text('summary'),
    /** The spoken script, kept so an episode can be re-synthesized in another voice. */
    script: text('script'),
    /** Public Vercel Blob URL. Null until synthesis finishes. */
    audioUrl: text('audio_url'),
    /** Blob pathname, needed to delete the object when the episode is deleted. */
    audioPathname: text('audio_pathname'),
    /** Exact length in seconds, so the player can lay out before metadata loads. */
    durationS: real('duration_s'),
    /** OpenAI voice id used for synthesis. */
    voice: text('voice'),
    /** Words in the script — drives the "~N min read" style hint. */
    wordCount: integer('word_count'),
    /** 'generating' | 'ready' | 'failed' */
    status: text('status').notNull().default('generating'),
    /** User-facing failure reason when status is 'failed'. */
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('episodes_created_at_idx').on(table.createdAt)],
)

export type Episode = typeof episodes.$inferSelect
export type NewEpisode = typeof episodes.$inferInsert

// Defined in lib/options.ts so client components can read them without pulling
// Drizzle into the browser bundle. Re-exported here for server-side ergonomics.
export { EPISODE_STATUS, type EpisodeStatus } from '@/lib/options'
