# Add an RSS feed

Turn the library into a podcast you can subscribe to in Pocket Casts / Overcast /
AntennaPod / Apple Podcasts, instead of opening the web app on your phone.

**Not Spotify.** Spotify's consumer app has no "add by RSS URL"; the only way in is
submitting the show to Spotify for Creators, which lists it in their public catalog.
Wrong shape for a personal read-it-later feed.

## Decisions

| Question | Choice |
| --- | --- |
| Feed privacy | Unguessable token in the path, `FEED_TOKEN` env var |
| Cover art | Authored SVG, rasterized to PNG by a script, committed |
| Item `<link>` | The source article URL, not an episode page |

## Why each piece exists

### 1. `audioBytes` column

RSS `<enclosure>` requires `length` in **bytes**. The pipeline has `audio.length` at
synthesis time (`tts.ts:147`) but only persists `durationS`, which was *derived from*
the byte length at an assumed 128kbps — so reversing it is circular and rounds badly
(`durationS` is stored to 1 decimal ≈ ±800 bytes).

- `schema.ts`: `audioBytes: integer('audio_bytes')`, nullable for existing rows.
- `generate-episode.ts`: persist `synthesis.audio.length` alongside `durationS`.
  **No connector change** — `SynthesisResult` already carries the Buffer, so the
  `TtsEngine` seam and every fake stay exactly as they are.
- `scripts/backfill-audio-bytes.ts`: HEAD each existing blob URL, read
  `content-length`, patch the row.
- The feed falls back to `durationS * 16000` if bytes are still null, so a
  half-backfilled database still produces a valid feed.

### 2. Show metadata — `lib/feed/show.ts`

Channel-level constants (title, author, description, category, language, explicit).
Shared by the feed route and the cover-art script so the artwork and the feed can
never disagree about the show's name.

Deliberately *not* in `lib/options.ts`: that file exists to keep server-only deps out
of the browser bundle, and none of this is needed client-side.

Show title defaults to **Poddie**. One constant to change.

### 3. Read-only feed query

`listEpisodes()` calls `reapStale()`, which **writes**. Podcast clients poll every few
hours, forever — that should not drive an UPDATE. Add `listFeedEpisodes(limit)`:
`status = 'ready' AND audio_url IS NOT NULL`, newest first, capped at 300 items so the
feed can't grow unbounded.

### 4. The route — `app/feed/[token]/route.ts`

- `RouteContext<'/feed/[token]'>` for params. This is the Next 16 idiom from the
  bundled docs; the older hand-rolled `{ params: Promise<...> }` in
  `api/episodes/[id]/route.ts` still works and is left alone.
- Accepts `/feed/<token>` and `/feed/<token>.xml` — strip one optional `.xml`.
- Token compared with `crypto.timingSafeEqual` after a length check.
- `FEED_TOKEN` unset → **404**, not 500. Feature simply off.
- Mismatch → **404**, not 403, so the response never confirms the path exists.
- `X-Robots-Tag: noindex, nofollow` in case the URL ever leaks into a referrer.
- `Content-Type: application/rss+xml; charset=utf-8`.
- `Cache-Control: public, max-age=0, s-maxage=300` — the URL is the secret, and a
  5-minute shared cache absorbs polling.
- Node runtime, `dynamic = 'force-dynamic'` (Cache Components is off; route handlers
  are uncached by default anyway, this is explicit).

### 5. XML generation — `lib/feed/rss.ts`

Hand-rolled, no new dependency. A pure function `renderFeed(episodes, { origin })` →
string, so it can be exercised without a request.

Escaping matters: titles and summaries are **LLM output** and routinely contain `&`
and quotes. Escape the five XML entities and strip control characters rather than
wrapping in CDATA — CDATA still breaks on `]]>`.

Channel: `<atom:link rel="self">` (validators require it), `<itunes:image>`, RSS 2.0
`<image>` fallback, `<language>`, `<lastBuildDate>`, `<itunes:category>`,
`<itunes:explicit>`, `<itunes:type>episodic`.

Item: `<title>`, `<link>` = source article, `<description>` = summary (falls back to
title), `<pubDate>` RFC-822 via `toUTCString()`, `<guid isPermaLink="false">` =
`poddie-episode-<id>` (stable forever — clients dedupe on it), `<enclosure>`,
`<itunes:duration>` in whole seconds, `<itunes:episodeType>full`.

### 6. Origin derivation

Feeds need absolute URLs. Derive from `x-forwarded-proto` / `x-forwarded-host`,
falling back to the `host` header, falling back to `new URL(request.url).origin`.
Optional `SITE_URL` env override wins when set, for pinning the canonical host.

### 7. Cover art — `scripts/build-cover.ts`

Apple requires square, ≥1400px, JPEG or PNG. Authored SVG → `sharp` → 3000×3000
`public/cover.png`, committed. Mirrors `scripts/build-previews.ts`: a build artifact
generated at author time, not per request.

`sharp@0.34.5` is already present transitively via Next, but gets declared as an
explicit `devDependency` rather than relied on by accident.

Design: `#0b0b0f` ground, `#8b5cf6 → #a78bfa` accent gradient, headphone glyph,
wordmark. Smooth gradients compress well; if the PNG lands over ~500KB, drop to
1500×1500, still above Apple's floor.

### 8. Copy-the-URL affordance

Without this you have to hand-assemble the URL from an env var. `app/page.tsx` (server
component) reads `FEED_TOKEN` and passes the path down; `Studio` renders a "Copy feed
URL" button, hidden entirely when no token is configured.

## Files

| File | Change |
| --- | --- |
| `lib/db/schema.ts` | + `audioBytes` |
| `lib/db/episodes.ts` | + `listFeedEpisodes` |
| `lib/services/generate-episode.ts` | persist `audio.length` |
| `lib/feed/show.ts` | new — channel metadata |
| `lib/feed/rss.ts` | new — `renderFeed`, escaping, RFC-822 |
| `app/feed/[token]/route.ts` | new — auth, headers, response |
| `app/page.tsx` | pass feed path |
| `components/Studio.tsx` | copy-URL button |
| `scripts/build-cover.ts` | new |
| `scripts/backfill-audio-bytes.ts` | new |
| `public/cover.png` | new artifact |
| `package.json` | + `cover`, `backfill:bytes` scripts, + `sharp` devDep |

README is deliberately **not** touched — the reasoning lives in the files themselves.

## Verification

1. `npm run type-check && npm run build` (AGENTS.md gate).
2. `npm run db:push` for the new column.
3. Dev server: fetch the feed, parse with cheerio in `xmlMode` to prove
   well-formedness, assert one `<item>` per ready episode and that every
   `<enclosure>` has a non-zero `length`.
4. Wrong token → 404. No `FEED_TOKEN` → 404.
5. Confirm `Content-Type` and that the mp3 URLs answer a Range request (clients seek).

## Out of scope

Episode pages, accounts, per-user feeds, chapters. Noted in the earlier discussion.
