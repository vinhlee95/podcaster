# Podcaster

Paste an article URL, get a podcast episode. Single TypeScript stack, deploys to Vercel.

```
URL → extract → script → synthesize → upload → play
```

## Stack

| Concern     | Choice                                        |
| ----------- | --------------------------------------------- |
| App         | Next.js 16 (App Router), React 19, Tailwind 4 |
| Database    | Neon Postgres via Drizzle                     |
| Audio files | Vercel Blob (public, non-expiring URLs)       |
| Script      | OpenAI `gpt-4o-mini`                          |
| Voice       | OpenAI `gpt-4o-mini-tts`                      |
| Extraction  | cheerio, falling back to r.jina.ai            |

No Python, no separate backend — the pipeline runs in a Next.js route handler.

## Setup

```bash
npm install
cp .env.example .env.local   # fill in the three required values
npm run db:push              # creates the episodes table
npm run dev
```

Required env: `DATABASE_URL` (Neon), `BLOB_READ_WRITE_TOKEN` (Vercel Blob), `OPENAI_API_KEY`.
Optional: `JINA_API_KEY`, which only raises the rate limit on the extraction fallback.

If `DATABASE_URL` is missing the app renders a setup screen instead of crashing.

## Deploying

Push to a repo, import it on Vercel, then add a Neon database and a Blob store from
**Storage** — both inject their env vars automatically. Add `OPENAI_API_KEY` yourself
and run `npm run db:push` once against the production database.

## How it works

### Extraction — `lib/connectors/extract.ts`

Two tiers, because one is not enough:

1. `fetch` the HTML, parse with cheerio, strip non-content elements, take the text.
   Free, fast, no external service. This is the server-side equivalent of what
   chrome-reader-extension does with `document.body.innerText` — except a server has
   no rendered DOM, so JavaScript-rendered pages come back nearly empty.
2. When tier 1 yields under 600 characters, retry through `r.jina.ai`, which renders
   the page and returns markdown.

Hacker News is the canonical tier-2 case; most blogs and news sites resolve on tier 1.

URLs are validated before any fetch — non-http(s) schemes and private/link-local
addresses are rejected, so the endpoint cannot be used as an SSRF pivot.

### Script — `lib/connectors/script-writer.ts`

One structured-output call returns `{ title, summary, script }`. The prompt is adapted
from stonkie's `script_writer.py`: spoken prose only, figures preserved exactly,
abbreviations expanded for the ear, and explicitly no greeting and no sign-off —
"welcome back to the show" is the fastest way to sound machine-generated.

Length presets (`quick` / `standard` / `deep`) map to word targets, ~150 words per minute.

### Voice — `lib/connectors/tts.ts`

OpenAI caps TTS input at 4096 characters, and a full episode exceeds that. The script
is split on sentence boundaries into sub-limit chunks, synthesized concurrently, and
the mp3 buffers concatenated — valid because each mp3 frame carries its own header,
so a decoder reads straight through the seam.

Duration is estimated from byte length at 128kbps rather than by decoding the file.
It is a seed for layout only; the browser replaces it with the real duration on
`loadedmetadata`.

### Playback — `lib/player/store.ts`

A single module-level `<audio>` element shared by the whole app, exposed through
`useSyncExternalStore`. Because there is only one element, starting a track inherently
stops the previous one — "only one plays at a time" needs no coordination between
components. Ported from stonkie's `useRecapAudio.ts`, minus the signed-URL expiry
handling that Vercel Blob's permanent URLs make unnecessary.

### Progress — `app/api/generate/route.ts`

Generation takes 30–90 seconds, so the route streams Server-Sent Events and the form
renders a four-stage progress trail. It uses `fetch` + a manual SSE parse rather than
`EventSource`, which cannot send a request body.

`maxDuration` is set to 300s, the platform ceiling. A row is written before generation
starts and patched as stages complete; rows left in `generating` past that ceiling are
reaped as failed on the next list query, so nothing spins forever.

## Layout

```
app/
  page.tsx                      server component, seeds the library
  api/generate/route.ts         SSE generation
  api/episodes/                 list, get, delete
components/                     Studio, GenerateForm, EpisodeCard, PlayerBar
lib/
  connectors/                   one file per external boundary
  services/generate-episode.ts  pipeline, connectors injected
  db/                           Drizzle schema + queries
  player/store.ts               shared audio element
  options.ts                    constants shared by server and client
```

Connectors are injected into the pipeline, so it can be exercised with fakes and no
network — the arrangement stonkie uses in `services/recap_audio.py`.

`lib/options.ts` exists so client components can read voice, length, and status
constants without pulling the OpenAI SDK and Drizzle into the browser bundle.

## Scripts

| Command              | Does                        |
| -------------------- | --------------------------- |
| `npm run dev`        | Dev server                  |
| `npm run build`      | Production build            |
| `npm run type-check` | `tsc --noEmit`              |
| `npm run db:push`    | Sync schema to the database |
| `npm run db:studio`  | Drizzle Studio              |
