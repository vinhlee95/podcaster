'use client'

import { useEffect } from 'react'

/**
 * Registers `public/sw.js`, which is what makes the app installable. Renders
 * nothing.
 *
 * Production only. In development the build output is not content-hashed and
 * HMR rewrites it constantly, so the worker's cache-first rule would serve
 * chunks that no longer match the page.
 */
export default function RegisterServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return
    if (!('serviceWorker' in navigator)) return

    const register = () => {
      navigator.serviceWorker.register('/sw.js').catch((err) => {
        // Not worth surfacing: a failed registration costs the install prompt
        // and the offline fallback, and nothing else stops working.
        console.error('sw.register_failed', err)
      })
    }

    // Waiting for `load` keeps the worker's install off the critical path, where
    // it would compete with the first render for bandwidth.
    if (document.readyState === 'complete') {
      register()
      return
    }
    window.addEventListener('load', register)
    return () => window.removeEventListener('load', register)
  }, [])

  return null
}
