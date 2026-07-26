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

### Two modes — `components/FullScreenPlayer.tsx`

Tapping the player bar raises a full-screen view with a **Read** / **Voice** toggle in
its header. Voice mode is the player: artwork, transport, and the script as lyrics.
Read mode is the same script as prose with the player taken away — the transport goes
entirely rather than sitting there greyed out, and the audio pauses, since there would
be no way to stop it otherwise.

The switch carries the position across, which is the point of having modes rather than
one view that tries to do both. Read opens at the line the voice reached; Voice starts
from the line at the top of the screen and plays. So the common trip — read at a desk,
get up, press play — lands on the sentence you stopped at. Closing the player while
reading writes the same position, because leaving to go somewhere is exactly the moment
the feature is for and it is not the button anyone would think to press first.

That position is a single number per episode, held in `localStorage` by
`lib/player/resume.ts` and applied by `play()` before the first byte is fetched.
Everything that moves it writes it — playing, scrubbing, the mode switch — so the
transport, the bar, and the play button on the episode card never disagree about where
"here" is. It is per-device, though: the laptop you read on does not tell the phone you
listen on. Moving it server-side is a change to those three functions and nothing else.

### Lyrics — `lib/player/lyrics.ts`

Voice mode scrolls the script against the voice, a sentence lit at a time with its
words filling as they are spoken. OpenAI TTS
returns audio and nothing else, so those timings are derived rather than measured:
pauses are subtracted from the duration at a fixed cost per break, and the speaking
rate is whatever fits the remaining characters into the time left. The timeline is
fitted to the real duration, so it cannot drift out the far end.

It does drift in the middle, and the dominant cause is not the model. A long script is
synthesized as several independent TTS calls, and each call picks its own pace — across
this project's episodes the same voice reads at 15.7 to 17.5 characters a second, and
that spread exists *within* an episode too. One global rate cannot follow it, which is
worth several seconds by the middle of a chunk. Two things absorb that: the lit unit is
the sentence rather than the clause-length line, so an error of a line or so lands
inside the sentence already lit, and the highlight is held half a second behind — a
highlight that trails reads as following the voice, one that leads reads as broken.

Closing the gap properly means recording where the chunks actually fell (their
durations are known at synthesis time, so the timeline could be pinned at each seam) or
aligning against a transcription with word timestamps. Neither is in place; the seams
cannot be recovered afterwards, since OpenAI returns headerless mp3 frames that leave
no marker at the joins.

The view samples `audio.currentTime` on an animation frame rather than subscribing to
the store, whose `timeupdate` cadence of ~4 Hz would light a word up to a quarter of a
second late.

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
components/                     Studio, GenerateForm, EpisodeCard, PlayerBar,
                                FullScreenPlayer, ReadView
lib/
  connectors/                   one file per external boundary
  services/generate-episode.ts  pipeline, connectors injected
  db/                           Drizzle schema + queries
  player/store.ts               shared audio element
  player/lyrics.ts              script -> timed lines
  player/resume.ts              where each episode was left off
  options.ts                    constants shared by server and client
```

Connectors are injected into the pipeline, so it can be exercised with fakes and no
network — the arrangement stonkie uses in `services/recap_audio.py`, but built from
functions rather than classes. Each seam is a function type, so a test supplies four
literals:

```ts
generateEpisode(options, {
  extract: async () => article,
  writeScript: async () => script,
  synthesize: async () => ({ audio, contentType, durationS }),
  uploadAudio: async (key) => ({ url, pathname: key }),
})
```

Connectors that need configuration (an OpenAI client, a model id) are `createX()`
factories that close over it; the rest are plain exported functions.

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
