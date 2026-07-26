/**
 * Asserts the RSS feed's invariants against the real database.
 *
 *     npm run check:feed
 *
 * The route handler is a plain function, so this exercises the actual auth,
 * origin resolution, headers and rendering without standing up a server — the
 * connectors-as-functions arrangement paying off in a place that has nothing to
 * do with the pipeline.
 *
 * Reaches for the live `DATABASE_URL`, so it is an integration check rather than
 * a unit test. Needs `FEED_TOKEN` set in `.env.local`.
 */

import { config } from 'dotenv'
config({ path: '.env.local' })

import * as cheerio from 'cheerio'

const configuredToken = process.env.FEED_TOKEN
if (!configuredToken) {
  console.error('FEED_TOKEN is not set — add one to .env.local (openssl rand -hex 16).')
  process.exit(1)
}
const TOKEN: string = configuredToken

async function call(path: string, headers: Record<string, string> = {}) {
  const { GET } = await import('@/app/feed/[token]/route')
  const token = path.split('/').pop()!
  const request = new Request(`http://localhost:3000${path}`, { headers })
  return GET(request, { params: Promise.resolve({ token }) })
}

function check(label: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`)
  if (!ok) process.exitCode = 1
}

async function main() {
  // --- auth -----------------------------------------------------------------
  const wrong = await call('/feed/' + 'f'.repeat(TOKEN.length))
  check('wrong token of equal length -> 404', wrong.status === 404)

  const shortTok = await call('/feed/short')
  check('wrong token of different length -> 404', shortTok.status === 404)

  const saved = process.env.FEED_TOKEN
  delete process.env.FEED_TOKEN
  const unset = await call(`/feed/${TOKEN}`)
  check('FEED_TOKEN unset -> 404', unset.status === 404)
  process.env.FEED_TOKEN = saved

  // --- happy path -----------------------------------------------------------
  const res = await call(`/feed/${TOKEN}.xml`)
  check('correct token -> 200', res.status === 200, `got ${res.status}`)
  check(
    'content-type',
    res.headers.get('content-type') === 'application/rss+xml; charset=utf-8',
    res.headers.get('content-type') ?? 'missing',
  )
  check('noindex header', res.headers.get('x-robots-tag') === 'noindex, nofollow')
  check('cache-control', (res.headers.get('cache-control') ?? '').includes('s-maxage=300'))

  const xml = await res.text()

  // --- well-formedness ------------------------------------------------------
  const $ = cheerio.load(xml, { xmlMode: true })
  check('parses as XML', $('rss').length === 1)
  check('has channel', $('channel').length === 1)
  check('declares itunes ns', xml.includes('xmlns:itunes='))
  const selfLinks = $('channel')
    .children()
    .filter((_, el) => 'tagName' in el && el.tagName === 'atom:link')
    .filter((_, el) => $(el).attr('rel') === 'self')
  check('has atom self link', selfLinks.length === 1, selfLinks.attr('href') ?? 'missing')

  const items = $('item')
  check('has items', items.length > 0, `${items.length} items`)

  let badEnclosure = 0
  let badGuid = 0
  let badDate = 0
  items.each((_, el) => {
    const item = $(el)
    const enc = item.find('enclosure')
    const len = Number(enc.attr('length'))
    if (!enc.attr('url') || !Number.isInteger(len) || len <= 0) badEnclosure += 1
    if (!item.find('guid').text().startsWith('poddie-episode-')) badGuid += 1
    if (Number.isNaN(Date.parse(item.find('pubDate').text()))) badDate += 1
  })
  check('every enclosure has url + non-zero byte length', badEnclosure === 0, `${badEnclosure} bad`)
  check('every guid is stable', badGuid === 0)
  check('every pubDate parses as a date', badDate === 0)

  // --- origin from forwarded headers ---------------------------------------
  const fwd = await call(`/feed/${TOKEN}`, {
    'x-forwarded-proto': 'https',
    'x-forwarded-host': 'poddie.example.com',
  })
  const fwdXml = await fwd.text()
  check(
    'honours x-forwarded-* for absolute URLs',
    fwdXml.includes('https://poddie.example.com/cover.png'),
  )

  // --- escaping -------------------------------------------------------------
  const { renderFeed } = await import('@/lib/feed/rss')
  const hostile = renderFeed(
    [
      {
        id: 1,
        url: 'https://example.com/a?x=1&y=2',
        title: 'Tom & Jerry <script>alert("x")</script>',
        sourceSite: 'example.com',
        summary: "It's a 5 > 3 situation",
        script: null,
        audioUrl: 'https://blob.example.com/a.mp3',
        audioPathname: 'a.mp3',
        durationS: 60,
        audioBytes: 960000,
        voice: 'nova',
        wordCount: 150,
        status: 'ready',
        error: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ],
    { origin: 'https://x.test', selfUrl: 'https://x.test/feed/t' },
  )
  const $$ = cheerio.load(hostile, { xmlMode: true })
  check('hostile title still parses', $$('item > title').length === 1)
  check('no raw script tag survives', !hostile.includes('<script>'))
  check('ampersand escaped in link', hostile.includes('x=1&amp;y=2'))
  check('title round-trips', $$('item > title').text().includes('Tom & Jerry'))

  console.log(process.exitCode ? '\nFAILED' : '\nAll checks passed.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
