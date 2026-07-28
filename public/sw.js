/**
 * Poddie's service worker. Registered by `components/RegisterServiceWorker.tsx`,
 * in production only.
 *
 * Deliberately small. It exists so the app is installable and so a launch with
 * no connection shows the last library instead of the browser's error page — it
 * is not an offline mode. Two rules, and everything else is left alone:
 *
 *   - navigations      network first, falling back to the last cached HTML
 *   - `/_next/static/` cache first (the URLs are content-hashed, so a hit can
 *                      never be stale — a rebuilt chunk is a different URL)
 *
 * Anything not matched is never passed to `respondWith`, so the browser handles
 * it natively. That matters most for episode audio: it lives on another origin
 * and is fetched with `Range` headers, and a service worker that mishandles a
 * 206 breaks seeking.
 */

/**
 * Bumping this drops everything: `activate` deletes every cache that is not
 * this one. Worth doing if the rules below ever change shape.
 */
const CACHE = 'poddie-v1'

/** The cached response a navigation falls back to when the network is gone. */
const SHELL = '/'

self.addEventListener('install', () => {
  // Nothing to precache — the shell is `/`, which is server-rendered per request
  // and so is only worth storing once a real navigation has produced one.
  // Taking over immediately: a stale worker serving the previous rules is worse
  // than the tab swapping controllers mid-session, which content-hashed assets
  // make harmless.
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys()
      await Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name)))
      await self.clients.claim()
    })()
  )
})

/** True for the build output, whose URLs carry a content hash. */
function isImmutableAsset(url) {
  return url.pathname.startsWith('/_next/static/')
}

/**
 * Everything the worker must not touch. The API and the feed are dynamic, and a
 * `Range` request is a media seek — the browser's own handling of those is both
 * correct and faster than anything worth writing here.
 */
function isBypassed(request, url) {
  return (
    request.method !== 'GET' ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/feed/') ||
    request.headers.has('range')
  )
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE)
  try {
    const response = await fetch(request)
    // Only a plain 200 is worth keeping. Redirects especially: replaying a
    // cached redirect against a navigation throws.
    if (response.status === 200 && !response.redirected) {
      cache.put(SHELL, response.clone())
    }
    return response
  } catch (err) {
    const cached = await cache.match(SHELL)
    if (cached) return cached
    throw err
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE)
  const cached = await cache.match(request)
  if (cached) return cached

  const response = await fetch(request)
  if (response.status === 200) cache.put(request, response.clone())
  return response
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)

  if (isBypassed(request, url)) return

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request))
    return
  }

  if (isImmutableAsset(url)) {
    event.respondWith(cacheFirst(request))
  }
})
