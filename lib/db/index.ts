import { neon } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-http'
import * as schema from './schema'

/**
 * Neon HTTP client. Every query is a stateless fetch, which is what makes this
 * safe to call from a serverless function without a connection pool.
 *
 * Resolved lazily so importing this module (and therefore any route that
 * touches the DB) does not blow up at build time when DATABASE_URL is absent.
 */
let cached: ReturnType<typeof drizzle<typeof schema>> | null = null

export function getDb() {
  if (cached) return cached
  const url = process.env.DATABASE_URL
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. Copy .env.example to .env.local and add your Neon connection string.',
    )
  }
  cached = drizzle(neon(url), { schema })
  return cached
}

export { schema }
