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

/**
 * The innermost message in an error chain.
 *
 * Drizzle wraps every driver failure in a `DrizzleQueryError` whose `message`
 * is only the SQL and its parameters — the reason the query actually failed
 * (bad credentials, unreachable host, missing table, aborted request) is on
 * `cause`. Reporting the wrapper alone makes every distinct failure look like
 * the same unreadable SQL dump, so unwrap to the message that explains why.
 */
export function rootCauseMessage(err: unknown): string {
  const seen = new Set<unknown>()
  let current: unknown = err
  let message = ''

  while (current instanceof Error && !seen.has(current)) {
    seen.add(current)
    if (current.message) message = current.message
    current = current.cause
  }

  return message || 'Could not reach the database.'
}

export { schema }
