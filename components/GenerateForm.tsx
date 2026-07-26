'use client'

import { useRef, useState } from 'react'
import { Link2, Loader2, Sparkles, AlertCircle, ChevronDown } from 'lucide-react'
import {
  DEFAULT_VOICE,
  LENGTH_PRESETS,
  VOICES,
  type GenerationStage,
  type LengthPreset,
} from '@/lib/options'
import type { ProgressEvent } from '@/lib/services/generate-episode'
import type { EpisodeDto } from '@/lib/types'
import VoicePreview from './VoicePreview'

/** Stage order, used to render the progress trail as steps rather than one message. */
const STAGES: { key: GenerationStage; label: string }[] = [
  { key: 'extracting', label: 'Read' },
  { key: 'writing', label: 'Script' },
  { key: 'synthesizing', label: 'Record' },
  { key: 'uploading', label: 'Save' },
]

type Props = {
  onEpisodeCreated: (episode: EpisodeDto) => void
  /** Fires on every stage change so the library can show a placeholder card. */
  onProgress?: (stage: GenerationStage | null) => void
}

export default function GenerateForm({ onEpisodeCreated, onProgress }: Props) {
  const [url, setUrl] = useState('')
  const [voice, setVoice] = useState<string>(DEFAULT_VOICE)
  const [length, setLength] = useState<LengthPreset>('standard')
  const [stage, setStage] = useState<GenerationStage | null>(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const busy = stage !== null

  function setStageAndNotify(next: GenerationStage | null) {
    setStage(next)
    onProgress?.(next)
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (busy || !url.trim()) return

    setError('')
    setMessage('Starting…')
    setStageAndNotify('extracting')

    try {
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: url.trim(), voice, length }),
      })

      if (!response.ok || !response.body) {
        const detail = await response.json().catch(() => null)
        throw new Error(detail?.error ?? `Request failed (${response.status}).`)
      }

      // Manual SSE parse rather than EventSource, which only does GET and so
      // cannot carry the request body.
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
      let buffer = ''

      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += value

        // Events are separated by a blank line; the last piece may be partial.
        const parts = buffer.split('\n\n')
        buffer = parts.pop() ?? ''

        for (const part of parts) {
          const line = part.split('\n').find((l) => l.startsWith('data: '))
          if (!line) continue

          const event = JSON.parse(line.slice('data: '.length)) as ProgressEvent
          if (event.type === 'progress') {
            setStageAndNotify(event.stage)
            setMessage(event.message)
          } else if (event.type === 'done') {
            onEpisodeCreated(event.episode as unknown as EpisodeDto)
            setUrl('')
            inputRef.current?.blur()
          } else if (event.type === 'error') {
            setError(event.message)
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setStageAndNotify(null)
      setMessage('')
    }
  }

  const activeIndex = STAGES.findIndex((s) => s.key === stage)

  return (
    <form onSubmit={handleSubmit} className="w-full">
      <div className="rounded-2xl border border-border bg-surface p-2 shadow-lg shadow-black/5 transition-colors focus-within:border-accent/60">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="flex flex-1 items-center gap-2 px-3">
            <Link2 size={18} className="shrink-0 text-muted" aria-hidden="true" />
            <input
              ref={inputRef}
              type="url"
              inputMode="url"
              required
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              disabled={busy}
              placeholder="Paste an article URL…"
              aria-label="Article URL"
              className="w-full bg-transparent py-3 text-[15px] outline-none placeholder:text-muted disabled:opacity-60"
            />
          </div>

          {/*
            Stacked on mobile, inline from sm up. The controls do not fit on one
            row at phone widths — the longest voice label alone ("Fable ·
            Expressive, British") overruns half a 375px viewport — and letting
            them try pushes the submit button off-screen entirely.
          */}
          <div className="grid grid-cols-1 gap-2 sm:flex sm:items-center">
            {/* Picker and its sample button travel together — the button always
                previews whatever the select currently reads. */}
            <div className="flex items-center gap-2">
              <Select
                value={voice}
                onChange={setVoice}
                disabled={busy}
                label="Voice"
                className="min-w-0 flex-1 sm:flex-none"
                options={VOICES.map((v) => ({ value: v.id, label: `${v.label} · ${v.blurb}` }))}
              />
              <VoicePreview
                voice={voice}
                label={VOICES.find((v) => v.id === voice)?.label ?? voice}
                disabled={busy}
                onError={setError}
              />
            </div>
            <Select
              value={length}
              onChange={(v) => setLength(v as LengthPreset)}
              disabled={busy}
              label="Length"
              options={Object.entries(LENGTH_PRESETS).map(([key, preset]) => ({
                value: key,
                label: `${preset.label} · ${preset.hint}`,
              }))}
            />
            <button
              type="submit"
              disabled={busy || !url.trim()}
              className="inline-flex w-full shrink-0 items-center justify-center gap-2 rounded-xl bg-accent px-4 py-3 text-sm font-medium text-white transition hover:bg-accent-soft disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto sm:py-2.5"
            >
              {busy ? (
                <Loader2 size={16} className="animate-spin" aria-hidden="true" />
              ) : (
                <Sparkles size={16} aria-hidden="true" />
              )}
              {busy ? 'Generating' : 'Generate'}
            </button>
          </div>
        </div>
      </div>

      {busy && (
        <div
          className="mt-3 flex flex-col gap-2 rounded-xl border border-border bg-surface/60 px-4 py-3"
          role="status"
          aria-live="polite"
        >
          <div className="flex items-center gap-2 text-sm text-muted">
            <Loader2 size={14} className="animate-spin text-accent-soft" aria-hidden="true" />
            {message}
          </div>
          <div className="flex items-center gap-1.5">
            {STAGES.map((s, i) => (
              <div key={s.key} className="flex flex-1 flex-col gap-1">
                <div
                  className={`h-1 rounded-full transition-colors ${
                    i < activeIndex
                      ? 'bg-accent'
                      : i === activeIndex
                        ? 'bg-accent-soft animate-pulse'
                        : 'bg-border'
                  }`}
                />
                <span
                  className={`text-[10px] uppercase tracking-wide ${
                    i <= activeIndex ? 'text-accent-soft' : 'text-muted/60'
                  }`}
                >
                  {s.label}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {error && (
        <div
          className="mt-3 flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger"
          role="alert"
        >
          <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}
    </form>
  )
}

/** Native select styled to match, so the mobile picker stays the OS one. */
function Select({
  value,
  onChange,
  options,
  label,
  disabled,
  className = '',
}: {
  value: string
  onChange: (value: string) => void
  options: { value: string; label: string }[]
  label: string
  disabled?: boolean
  className?: string
}) {
  return (
    <div className={`relative w-full sm:w-auto ${className}`}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        aria-label={label}
        className="w-full appearance-none rounded-xl border border-border bg-background py-3 pl-3 pr-8 text-sm text-foreground outline-none transition hover:bg-surface-hover focus:border-accent/60 disabled:opacity-50 sm:w-auto sm:py-2.5"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown
        size={14}
        className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted"
        aria-hidden="true"
      />
    </div>
  )
}
