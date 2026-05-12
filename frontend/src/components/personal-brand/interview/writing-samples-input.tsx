'use client'

import { useState } from 'react'
import { ArrowRight } from 'lucide-react'

interface WritingSamplesInputProps {
  onSubmit: (combined: string) => void
  loading?: boolean
}

export function WritingSamplesInput({ onSubmit, loading }: WritingSamplesInputProps) {
  const [samples, setSamples] = useState(['', '', ''])

  function handleChange(idx: number, val: string) {
    setSamples((prev) => prev.map((s, i) => (i === idx ? val : s)))
  }

  function handleSubmit() {
    const combined = samples
      .map((s, i) => {
        const trimmed = s.trim()
        return trimmed ? `--- Sample ${i + 1} ---\n${trimmed}` : null
      })
      .filter(Boolean)
      .join('\n\n')
    if (!combined) return
    onSubmit(combined)
  }

  const hasAtLeastOne = samples.some((s) => s.trim().length > 0)

  return (
    <div className="space-y-4 w-full">
      <p className="text-xs text-muted-foreground leading-relaxed">
        Paste 2–3 pieces of writing that felt authentically like you - posts, emails, messages, anything.
        The more real, the better. LEO will use these to learn your voice patterns.
      </p>
      {samples.map((s, i) => (
        <div key={i} className="space-y-1">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-muted-foreground">Sample {i + 1}{i === 0 ? ' *' : ' (optional)'}</label>
            <span className={`text-[10px] ${s.length > 1500 ? 'text-amber-500' : 'text-muted-foreground'}`}>
              {s.length} chars
            </span>
          </div>
          <textarea
            value={s}
            onChange={(e) => handleChange(i, e.target.value)}
            placeholder={
              i === 0
                ? 'Paste a LinkedIn post, tweet, email, or anything you wrote that felt like you…'
                : 'Another example (optional)…'
            }
            rows={4}
            className="w-full rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-sm placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-primary/40 resize-none"
          />
        </div>
      ))}
      <button
        onClick={handleSubmit}
        disabled={!hasAtLeastOne || loading}
        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {loading ? 'Saving…' : 'Save my writing samples'}
        {!loading && <ArrowRight className="w-4 h-4" />}
      </button>
    </div>
  )
}
