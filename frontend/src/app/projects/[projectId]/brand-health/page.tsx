'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import {
  ShieldCheck, Loader2, ChevronDown, ChevronUp,
  AlertTriangle, CheckCircle2, TrendingDown, TrendingUp, Minus,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { api } from '@/lib/api'
import { SidebarToggle } from '@/components/layout/sidebar'
import { BackButton } from '@/components/layout/back-button'
import type { BrandVoiceScore, BrandDriftResult } from '@/types'

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const GRADE_CONFIG: Record<string, { color: string; bg: string; label: string }> = {
  A: { color: 'text-green-600', bg: 'bg-green-500/10 border-green-500/20', label: 'Excellent' },
  B: { color: 'text-blue-600', bg: 'bg-blue-500/10 border-blue-500/20', label: 'Good' },
  C: { color: 'text-amber-600', bg: 'bg-amber-500/10 border-amber-500/20', label: 'Fair' },
  D: { color: 'text-orange-600', bg: 'bg-orange-500/10 border-orange-500/20', label: 'Weak' },
  F: { color: 'text-red-600', bg: 'bg-red-500/10 border-red-500/20', label: 'Off-brand' },
}

const DRIFT_STATUS_CONFIG: Record<BrandDriftResult['status'], { label: string; color: string; bg: string; icon: React.ReactNode }> = {
  on_track:          { label: 'On Track',           color: 'text-emerald-600', bg: 'bg-emerald-500/10 border-emerald-500/20', icon: <CheckCircle2 className="w-4 h-4" /> },
  minor_drift:       { label: 'Minor Drift',        color: 'text-amber-600',   bg: 'bg-amber-500/10 border-amber-500/20',     icon: <TrendingDown className="w-4 h-4" /> },
  significant_drift: { label: 'Significant Drift',  color: 'text-orange-600',  bg: 'bg-orange-500/10 border-orange-500/20',   icon: <AlertTriangle className="w-4 h-4" /> },
  off_brand:         { label: 'Off-Brand',           color: 'text-red-600',     bg: 'bg-red-500/10 border-red-500/20',         icon: <TrendingDown className="w-4 h-4" /> },
  no_data:           { label: 'No Data',             color: 'text-muted-foreground', bg: 'bg-muted border-border',             icon: <Minus className="w-4 h-4" /> },
  error:             { label: 'Error',               color: 'text-destructive', bg: 'bg-destructive/10 border-destructive/20', icon: <AlertTriangle className="w-4 h-4" /> },
}

type OuterTab = 'scorer' | 'drift'

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function BrandHealthPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const [outerTab, setOuterTab] = useState<OuterTab>('scorer')

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Top bar */}
      <div className="flex items-center gap-3 px-3 sm:px-4 py-3 border-b border-border shrink-0">
        <SidebarToggle />
        <BackButton />
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-primary" />
          <span className="text-sm font-semibold">Brand Health</span>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-0.5 rounded-lg border border-border p-0.5 bg-muted/40 ml-2">
          <button
            onClick={() => setOuterTab('scorer')}
            className={cn(
              'px-3 py-1 rounded-md text-xs font-medium transition-colors',
              outerTab === 'scorer'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            Voice Scorer
          </button>
          <button
            onClick={() => setOuterTab('drift')}
            className={cn(
              'px-3 py-1 rounded-md text-xs font-medium transition-colors',
              outerTab === 'drift'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            Drift Report
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {outerTab === 'scorer'
          ? <VoiceScorerTab projectId={projectId} />
          : <DriftReportTab projectId={projectId} />
        }
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Voice Scorer tab
// ---------------------------------------------------------------------------

function VoiceScorerTab({ projectId }: { projectId: string }) {
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
        toast.error('Brand Core not set up yet. Run brand ingestion first.', { duration: 5000 })
      } else {
        toast.error('Scoring failed. Try again.')
      }
    } finally {
      setLoading(false)
    }
  }

  const grade = result ? GRADE_CONFIG[result.grade] ?? GRADE_CONFIG.C : null

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      <div>
        <h2 className="text-base font-semibold mb-1">Brand Voice Scorer</h2>
        <p className="text-sm text-muted-foreground">
          Paste any content - caption, email, ad copy - and get an instant score against your Brand Core.
        </p>
      </div>

      <div className="space-y-3">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Paste a caption, ad copy, email, or any text to score against your brand voice..."
          rows={7}
          className="w-full text-sm bg-muted/50 border border-border rounded-lg px-3 py-2.5 resize-none focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-colors placeholder:text-muted-foreground/50"
        />
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">{text.length} characters</span>
          <button
            onClick={handleScore}
            disabled={loading || text.trim().length < 10}
            className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? (
              <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Scoring…</>
            ) : (
              <><ShieldCheck className="w-3.5 h-3.5" /> Score it</>
            )}
          </button>
        </div>
      </div>

      {result && grade && (
        <div className="space-y-4">
          <div className={cn('rounded-xl border p-5 space-y-3', grade.bg)}>
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

          <button
            onClick={() => setShowDetails(!showDetails)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {showDetails ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            {showDetails ? 'Hide' : 'Show'} detailed breakdown
          </button>

          {showDetails && (
            <div className="space-y-4">
              {result.on_brand_words.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-green-600 uppercase tracking-wide">On-brand</p>
                  <div className="flex flex-wrap gap-1.5">
                    {result.on_brand_words.map((w, i) => (
                      <span key={i} className="text-xs px-2 py-0.5 rounded-full bg-green-500/10 text-green-700 border border-green-500/20">{w}</span>
                    ))}
                  </div>
                </div>
              )}
              {result.off_brand_words.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-red-600 uppercase tracking-wide">Off-brand</p>
                  <div className="flex flex-wrap gap-1.5">
                    {result.off_brand_words.map((w, i) => (
                      <span key={i} className="text-xs px-2 py-0.5 rounded-full bg-red-500/10 text-red-700 border border-red-500/20">{w}</span>
                    ))}
                  </div>
                </div>
              )}
              {result.strengths.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs font-medium uppercase tracking-wide">Strengths</p>
                  <ul className="space-y-1">
                    {result.strengths.map((s, i) => (
                      <li key={i} className="flex gap-2 text-xs text-foreground/80">
                        <span className="text-green-500 mt-0.5 shrink-0">✓</span>{s}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {result.issues.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs font-medium uppercase tracking-wide">Issues</p>
                  <ul className="space-y-1">
                    {result.issues.map((issue, i) => (
                      <li key={i} className="flex gap-2 text-xs text-foreground/80">
                        <span className="text-amber-500 mt-0.5 shrink-0">⚠</span>{issue}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {result.suggestions.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs font-medium uppercase tracking-wide">How to improve</p>
                  <ul className="space-y-1">
                    {result.suggestions.map((s, i) => (
                      <li key={i} className="flex gap-2 text-xs text-foreground/80">
                        <span className="text-primary mt-0.5 shrink-0">→</span>{s}
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
  )
}

// ---------------------------------------------------------------------------
// Drift Report tab
// ---------------------------------------------------------------------------

function DriftReportTab({ projectId }: { projectId: string }) {
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<BrandDriftResult | null>(null)

  async function handleCheck() {
    const lines = content.split('\n').map(l => l.trim()).filter(Boolean)
    if (lines.length === 0) {
      toast.error('Add at least one piece of content to check.')
      return
    }
    setLoading(true)
    setResult(null)
    try {
      const data = await api.drift.check(projectId, lines)
      setResult(data)
    } catch (err) {
      const msg = String(err)
      if (msg.includes('400')) {
        toast.error('Brand Core not set up yet. Run brand ingestion first.', { duration: 5000 })
      } else {
        toast.error('Drift check failed. Try again.')
      }
    } finally {
      setLoading(false)
    }
  }

  const statusCfg = result ? DRIFT_STATUS_CONFIG[result.status] : null

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      <div>
        <h2 className="text-base font-semibold mb-1">Brand Drift Report</h2>
        <p className="text-sm text-muted-foreground">
          Paste recent content (one piece per line) to detect if your brand voice is drifting from its core identity.
        </p>
      </div>

      <div className="space-y-3">
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder={"Paste one piece of content per line:\n\nWe're disrupting the space with cutting-edge solutions.\nOur product is a game-changer for modern teams.\nExperience next-level performance today."}
          rows={8}
          className="w-full text-sm bg-muted/50 border border-border rounded-lg px-3 py-2.5 resize-none focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-colors placeholder:text-muted-foreground/50"
        />
        <div className="flex justify-end">
          <button
            onClick={handleCheck}
            disabled={loading || !content.trim()}
            className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? (
              <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Checking…</>
            ) : (
              <><TrendingUp className="w-3.5 h-3.5" /> Check drift</>
            )}
          </button>
        </div>
      </div>

      {result && statusCfg && (
        <div className="space-y-4">
          {/* Status card */}
          <div className={cn('rounded-xl border p-5', statusCfg.bg)}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className={statusCfg.color}>{statusCfg.icon}</span>
                <span className={cn('text-base font-semibold', statusCfg.color)}>{statusCfg.label}</span>
              </div>
              <div className="text-right">
                <div className={cn('text-3xl font-bold tabular-nums', statusCfg.color)}>
                  {result.drift_score}
                  <span className="text-sm font-normal text-muted-foreground">/100</span>
                </div>
                <div className="text-xs text-muted-foreground">drift score</div>
              </div>
            </div>

            {/* Drift indicators */}
            <div className="flex flex-wrap gap-2">
              <DriftIndicator label="Tone" drifted={result.tone_drift} />
              <DriftIndicator label="Themes" drifted={result.theme_drift} />
              <DriftIndicator label="Voice" drifted={result.voice_drift} />
            </div>
          </div>

          {/* Issues */}
          {result.issues.length > 0 && (
            <div className="rounded-xl border border-border p-4 space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-foreground">Issues detected</p>
              <ul className="space-y-1.5">
                {result.issues.map((issue, i) => (
                  <li key={i} className="flex gap-2 text-sm text-foreground/80">
                    <span className="text-amber-500 mt-0.5 shrink-0">⚠</span>{issue}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Positive observations */}
          {result.positive_observations.length > 0 && (
            <div className="rounded-xl border border-border p-4 space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-foreground">What&apos;s working</p>
              <ul className="space-y-1.5">
                {result.positive_observations.map((obs, i) => (
                  <li key={i} className="flex gap-2 text-sm text-foreground/80">
                    <span className="text-green-500 mt-0.5 shrink-0">✓</span>{obs}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Recommendations */}
          {result.recommendations.length > 0 && (
            <div className="rounded-xl border border-border p-4 space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-foreground">Recommendations</p>
              <ul className="space-y-1.5">
                {result.recommendations.map((rec, i) => (
                  <li key={i} className="flex gap-2 text-sm text-foreground/80">
                    <span className="text-primary mt-0.5 shrink-0">→</span>{rec}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function DriftIndicator({ label, drifted }: { label: string; drifted: boolean }) {
  return (
    <span className={cn(
      'flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border',
      drifted
        ? 'bg-red-500/10 text-red-600 border-red-500/20'
        : 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
    )}>
      {drifted ? <TrendingDown className="w-3 h-3" /> : <CheckCircle2 className="w-3 h-3" />}
      {label} {drifted ? 'drifted' : 'on track'}
    </span>
  )
}
