/**
 * Article extraction connector: URL in, readable text out.
 *
 * Mirrors what the chrome-reader-extension does in-browser — grab the page's
 * visible text wholesale and let the model sort it out — but a server has no
 * rendered DOM to read `innerText` from. So:
 *
 *   1. Fetch the HTML and parse it with cheerio, stripping the elements that
 *      carry no article content (script, style, nav, header, footer, aside).
 *      The text of what remains is the closest static equivalent to the
 *      extension's `document.body.innerText`.
 *   2. If that yields too little text — a client-rendered SPA, a consent
 *      interstitial, an anti-bot page — retry through r.jina.ai, which renders
 *      JavaScript and returns clean markdown.
 *
 * Like the extension, the text is not truncated here; the script writer decides
 * how much of it to spend.
 *
 * cheerio rather than jsdom: this only ever needs selectors and text, and
 * cheerio parses without constructing a browser environment — so it is faster,
 * and it structurally cannot execute the untrusted scripts on the page.
 */

import * as cheerio from 'cheerio'

/** Below this many characters, step 1 is assumed to have failed and Jina takes over. */
const MIN_USABLE_CHARS = 600

const FETCH_TIMEOUT_MS = 20_000

/**
 * Sent as the User-Agent. Some sites serve a stub to unrecognized clients, and a
 * plain `node-fetch`-looking agent is the fastest way to a 403.
 */
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'

/** Elements whose text is chrome, not content. */
const STRIP_SELECTOR =
  'script, style, noscript, nav, header, footer, aside, form, iframe, svg, ' +
  'button, [aria-hidden="true"], [role="navigation"], [role="banner"], ' +
  '[role="contentinfo"], .advertisement, .ad, .cookie-banner, .newsletter'

/** Containers likely to hold the article body, best candidate first. */
const CONTENT_SELECTORS = ['article', 'main', '[role="main"]', '.post-content', '.article-body']

export type ExtractedArticle = {
  title: string
  text: string
  /** Which path produced the text — surfaced in progress output and useful when debugging. */
  via: 'direct' | 'jina'
  /** Hostname of the resolved URL. */
  site: string
}

export class ExtractionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ExtractionError'
  }
}

/** Collapses the runs of whitespace that `textContent` leaves between block elements. */
function normalizeWhitespace(raw: string): string {
  return raw
    .replace(/\r/g, '')
    .replace(/[ \t ]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

async function fetchWithTimeout(url: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: { 'user-agent': USER_AGENT, ...(init.headers ?? {}) },
      redirect: 'follow',
    })
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Block-level elements that should read as separate lines.
 *
 * cheerio's `.text()` concatenates descendant text with no separator, so
 * `<p>one</p><p>two</p>` would otherwise come back as "onetwo" — which
 * silently welds the last word of every paragraph to the first word of the
 * next, and the model then reads the result aloud.
 */
const BLOCK_SELECTOR =
  'p, div, section, article, li, tr, blockquote, pre, h1, h2, h3, h4, h5, h6, figcaption'

/** Step 1: static HTML → text via cheerio. */
async function extractDirect(url: string): Promise<{ title: string; text: string } | null> {
  let html: string
  try {
    const response = await fetchWithTimeout(url)
    if (!response.ok) return null
    const contentType = response.headers.get('content-type') ?? ''
    // Parsing a PDF or an image as HTML produces garbage rather than an error.
    if (contentType && !contentType.includes('html') && !contentType.includes('text/plain')) {
      return null
    }
    html = await response.text()
  } catch {
    return null
  }

  try {
    const $ = cheerio.load(html)

    const title =
      $('meta[property="og:title"]').attr('content')?.trim() ||
      $('title').first().text().trim() ||
      $('h1').first().text().trim() ||
      ''

    $(STRIP_SELECTOR).remove()

    $('br').replaceWith('\n')
    $(BLOCK_SELECTOR).append('\n')

    // Prefer a real article container; fall back to the whole body.
    let best = ''
    for (const selector of CONTENT_SELECTORS) {
      const text = normalizeWhitespace($(selector).first().text())
      if (text.length > best.length) best = text
    }
    const bodyText = normalizeWhitespace($('body').text())
    const text = best.length >= MIN_USABLE_CHARS ? best : bodyText

    return { title, text }
  } catch {
    return null
  }
}

/** Step 2: r.jina.ai renders the page and returns markdown. */
async function extractViaJina(url: string): Promise<{ title: string; text: string } | null> {
  const headers: Record<string, string> = { accept: 'text/plain' }
  // Optional — raises the anonymous rate limit. The endpoint works without it.
  if (process.env.JINA_API_KEY) {
    headers.authorization = `Bearer ${process.env.JINA_API_KEY}`
  }

  try {
    const response = await fetchWithTimeout(`https://r.jina.ai/${url}`, { headers })
    if (!response.ok) return null
    const raw = await response.text()

    // Jina prefixes the body with `Title: ...`, `URL Source: ...`, then
    // `Markdown Content:`. Split the title off and keep the rest as the text.
    const titleMatch = raw.match(/^Title:\s*(.+)$/m)
    const contentIndex = raw.indexOf('Markdown Content:')
    const body = contentIndex >= 0 ? raw.slice(contentIndex + 'Markdown Content:'.length) : raw

    return { title: titleMatch?.[1]?.trim() ?? '', text: normalizeWhitespace(body) }
  } catch {
    return null
  }
}

export interface ArticleExtractor {
  extract(url: string): Promise<ExtractedArticle>
}

export class HttpArticleExtractor implements ArticleExtractor {
  async extract(url: string): Promise<ExtractedArticle> {
    const parsed = safeParseUrl(url)
    const site = parsed.hostname.replace(/^www\./, '')

    const direct = await extractDirect(parsed.toString())
    if (direct && direct.text.length >= MIN_USABLE_CHARS) {
      return { title: direct.title || site, text: direct.text, via: 'direct', site }
    }

    const jina = await extractViaJina(parsed.toString())
    if (jina && jina.text.length >= MIN_USABLE_CHARS) {
      return { title: jina.title || direct?.title || site, text: jina.text, via: 'jina', site }
    }

    // Both paths ran; report the better of the two attempts in the message.
    const best = Math.max(direct?.text.length ?? 0, jina?.text.length ?? 0)
    throw new ExtractionError(
      best === 0
        ? 'Could not read that page — it may be behind a login, a paywall, or blocking automated requests.'
        : `That page only yielded ${best} characters of text, which is too short to make an episode from.`,
    )
  }
}

/**
 * Parses and validates a user-supplied URL.
 *
 * Rejects non-http(s) schemes and hosts that resolve to the local network. The
 * server fetches whatever it is handed, so without this check a `file://` or
 * `http://169.254.169.254/` input would turn this route into an SSRF primitive.
 */
export function safeParseUrl(input: string): URL {
  let parsed: URL
  try {
    parsed = new URL(input.trim())
  } catch {
    throw new ExtractionError('That does not look like a valid URL.')
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ExtractionError('Only http and https URLs are supported.')
  }

  const host = parsed.hostname.toLowerCase()
  const isPrivate =
    host === 'localhost' ||
    host === '0.0.0.0' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    host === '[::1]' ||
    host.startsWith('[fc') ||
    host.startsWith('[fd')

  if (isPrivate) {
    throw new ExtractionError('That URL points at a private address.')
  }

  return parsed
}
