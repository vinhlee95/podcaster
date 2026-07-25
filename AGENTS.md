<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Podcaster

URL-to-podcast app. See README.md for the architecture; this file covers only what
is easy to get wrong.

## Verify before committing

```bash
npm run type-check && npm run build
```

## Conventions

- **One file per external boundary** in `lib/connectors/`. Services inject connectors
  and never touch an SDK directly — this is what keeps the pipeline testable with fakes.
- **Functions, not classes.** There are no `class`, `interface`, or `this` declarations
  anywhere in `app/`, `components/`, or `lib/`, and new code should not add any. A seam
  is a function *type* (`ArticleExtractor`, `ScriptWriter`, `TtsEngine`, `AudioUploader`);
  a connector that needs config is a `createX()` factory holding it in a closure; one
  that needs none is a plain exported function. Fakes are then literals, not classes.
  Errors carry a `kind` tag with a predicate (`isExtractionError`) instead of subclassing
  `Error`. The only `new` expressions left are platform built-ins and `new OpenAI()`.
- **Client components must not import from `lib/connectors/` or `lib/db/`.** Shared
  constants (voices, length presets, episode statuses, stage names) live in
  `lib/options.ts` precisely so the OpenAI SDK and Drizzle stay out of the browser
  bundle. Type-only imports are fine — they are erased.
- **Node runtime, not edge**, on any route touching the pipeline: it uses Buffer and
  cheerio.

## Gotchas

- `jsdom` cannot be used here. Its dependency chain `require()`s an ES module, which
  fails Next's build on Node below 22.12. cheerio replaced it — and cheerio's `.text()`
  concatenates with no separator, so block elements get an explicit `\n` appended
  before text is read (see `BLOCK_SELECTOR` in `lib/connectors/extract.ts`).
- OpenAI TTS rejects input over 4096 characters. Long scripts must go through
  `chunkScript`; do not pass a raw script to `synthesize` assuming it fits.
- Stored `durationS` is estimated from byte length, not decoded. Treat it as a layout
  seed only — the player overrides it on `loadedmetadata`.
- Any new user-supplied URL must go through `safeParseUrl` before it is fetched.
