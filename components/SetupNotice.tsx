import { AlertTriangle } from 'lucide-react'

const REQUIRED_ENV = [
  { key: 'DATABASE_URL', hint: 'Neon connection string (Vercel → Storage → Neon, or neon.tech)' },
  { key: 'BLOB_READ_WRITE_TOKEN', hint: 'Vercel Blob store token (Vercel → Storage → Blob)' },
  { key: 'OPENAI_API_KEY', hint: 'Used for both the script and the voice' },
]

/** Shown instead of the app when the database is unreachable — almost always unset env. */
export default function SetupNotice({ message }: { message: string }) {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-16">
      <div className="flex items-start gap-3 rounded-2xl border border-danger/30 bg-danger/10 p-4">
        <AlertTriangle size={18} className="mt-0.5 shrink-0 text-danger" aria-hidden="true" />
        <div>
          <h1 className="text-sm font-medium text-danger">Database not reachable</h1>
          <p className="mt-1 text-sm leading-relaxed text-muted">{message}</p>
        </div>
      </div>

      <section className="mt-6">
        <h2 className="text-sm font-medium">Set these in .env.local, then restart</h2>
        <dl className="mt-3 flex flex-col gap-3">
          {REQUIRED_ENV.map(({ key, hint }) => (
            <div key={key} className="rounded-xl border border-border bg-surface p-3">
              <dt className="font-mono text-sm text-accent-soft">{key}</dt>
              <dd className="mt-0.5 text-xs text-muted">{hint}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 text-xs leading-relaxed text-muted">
          Once <span className="font-mono">DATABASE_URL</span> is set, create the table with{' '}
          <span className="font-mono text-foreground">npm run db:push</span>.
        </p>
      </section>
    </main>
  )
}
