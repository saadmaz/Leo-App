'use client'

import { useState } from 'react'
import { ShieldCheck, Loader2, X, ChevronDown, ChevronUp } from 'lucide-react'
import { cn } from '@/lib/utils'
import { api } from '@/lib/api'
import { toast } from 'sonner'
import type { BrandVoiceScore } from '@/types'

interface BrandVoiceScorerProps {
  projectId: string
  onClose: () => void
}

const GRADE_CONFIG: Record<string, { color: string; bg: string; label: string }> = {
  A: { color: 'text-green-600', bg: 'bg-green-500/10 border-green-500/20', label: 'Excellent' },
  B: { color: 'text-blue-600', bg: 'bg-blue-500/10 border-blue-500/20', label: 'Good' },
  C: { color: 'text-amber-600', bg: 'bg-amber-500/10 border-amber-500/20', label: 'Fair' },
  D: { color: 'text-orange-600', bg: 'bg-orange-500/10 border-orange-500/20', label: 'Weak' },
  F: { color: 'text-red-600', bg: 'bg-red-500/10 border-red-500/20', label: 'Off-brand' },
}

export function BrandVoiceScorer({ projectId, onClose }: BrandVoiceScorerProps) {
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<BrandVoiceScore | null>(null)
  const [showDetails, setShowDetails] = useState(true)

  async function handleScore() {
    if (!text.trim() || text.trim().length < 10) {
      toast.error('Enter at least 10 characters to score.')
      return
    }

    setLoading(true)
    setResult(null)
    try {
      const score = await api.brandVoice.score(projectId, text.trim())
      setResult(score)
    } catch (err) {
      const msg = String(err)
      if (msg.includes('Brand Core not set up') || msg.includes('400')) {
        toast.error('Brand Core not set up yet. Run brand ingestion first to use the Voice Scorer.', { duration: 5000 })
      } else {
        toast.error('Scoring failed. Try again.')
      }
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const grade = result ? GRADE_CONFIG[result.grade] ?? GRADE_CONFIG.C : null

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-primary" />
          <span className="text-sm font-semibold">Brand Voice Scorer</span>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Input */}
        <div className="space-y-2">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Paste your content
          </label>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Paste a caption, ad copy, email, or any text to score against your brand voice..."
            rows={6}
            className="w-full text-sm bg-muted/50 border border-border rounded-lg px-3 py-2.5 resize-none focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-colors placeholder:text-muted-foreground/50"
          />
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">{text.length} characters</span>
            <button
              onClick={handleScore}
              disabled={loading || text.trim().length < 10}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? (
                <>
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Scoring...
                </>
              ) : (
                <>
                  <ShieldCheck className="w-3 h-3" />
                  Score it
                </>
              )}
            </button>
          </div>
        </div>

        {/* Result */}
        {result && grade && (
          <div className="space-y-3">
            {/* Score card */}
            <div className={cn('rounded-xl border p-4 space-y-3', grade.bg)}>
              <div className="flex items-center justify-between">
                <div>
                  <div className={cn('text-4xl font-bold tabular-nums', grade.color)}>
                    {result.score}
                    <span className="text-lg font-normal text-muted-foreground">/100</span>
                  </div>
                  <div className={cn('text-sm font-medium mt-0.5', grade.color)}>
                    Grade {result.grade} - {grade.label}
                  </div>
                </div>
                {/* Score ring */}
                <div className="relative w-16 h-16">
                  <svg className="w-full h-full -rotate-90" viewBox="0 0 36 36">
                    <circle cx="18" cy="18" r="15.9" fill="none" stroke="currentColor" strokeWidth="3" className="text-border" />
                    <circle
                      cx="18" cy="18" r="15.9" fill="none" strokeWidth="3"
                      strokeDasharray={`${result.score} 100`}
                      strokeLinecap="round"
                      className={grade.color}
                      stroke="currentColor"
                    />
                  </svg>
                  <div className={cn('absolute inset-0 flex items-center justify-center text-lg font-bold', grade.color)}>
                    {result.grade}
                  </div>
                </div>
              </div>

              <p className="text-sm text-foreground/80">{result.summary}</p>
            </div>

            {/* Details toggle */}
            <button
              onClick={() => setShowDetails(!showDetails)}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors w-full"
            >
              {showDetails ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              {showDetails ? 'Hide' : 'Show'} detailed breakdown
            </button>

            {showDetails && (
              <div className="space-y-3">
                {/* On-brand words */}
                {result.on_brand_words.length > 0 && (
                  <div className="space-y-1.5">
                    <div className="text-xs font-medium text-green-600 uppercase tracking-wide">On-brand</div>
                    <div className="flex flex-wrap gap-1.5">
                      {result.on_brand_words.map((w, i) => (
                        <span key={i} className="text-xs px-2 py-0.5 rounded-full bg-green-500/10 text-green-700 border border-green-500/20">
                          {w}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Off-brand words */}
                {result.off_brand_words.length > 0 && (
                  <div className="space-y-1.5">
                    <div className="text-xs font-medium text-red-600 uppercase tracking-wide">Off-brand</div>
                    <div className="flex flex-wrap gap-1.5">
                      {result.off_brand_words.map((w, i) => (
                        <span key={i} className="text-xs px-2 py-0.5 rounded-full bg-red-500/10 text-red-700 border border-red-500/20">
                          {w}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Strengths */}
                {result.strengths.length > 0 && (
                  <div className="space-y-1.5">
                    <div className="text-xs font-medium text-foreground uppercase tracking-wide">Strengths</div>
                    <ul className="space-y-1">
                      {result.strengths.map((s, i) => (
                        <li key={i} className="flex gap-2 text-xs text-foreground/80">
                          <span className="text-green-500 mt-0.5 shrink-0">✓</span>
                          {s}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Issues */}
                {result.issues.length > 0 && (
                  <div className="space-y-1.5">
                    <div className="text-xs font-medium text-foreground uppercase tracking-wide">Issues</div>
                    <ul className="space-y-1">
                      {result.issues.map((issue, i) => (
                        <li key={i} className="flex gap-2 text-xs text-foreground/80">
                          <span className="text-amber-500 mt-0.5 shrink-0">⚠</span>
                          {issue}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Suggestions */}
                {result.suggestions.length > 0 && (
                  <div className="space-y-1.5">
                    <div className="text-xs font-medium text-foreground uppercase tracking-wide">How to improve</div>
                    <ul className="space-y-1">
                      {result.suggestions.map((s, i) => (
                        <li key={i} className="flex gap-2 text-xs text-foreground/80">
                          <span className="text-primary mt-0.5 shrink-0">→</span>
                          {s}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
