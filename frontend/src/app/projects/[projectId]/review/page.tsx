'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import {
  ClipboardCheck, Loader2, RefreshCw, Check, X, RotateCcw,
  ChevronDown, ChevronUp, Clock, Sparkles, TrendingUp,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { api } from '@/lib/api'
import { useAppStore } from '@/stores/app-store'
import { SidebarToggle } from '@/components/layout/sidebar'
import { BackButton } from '@/components/layout/back-button'
import type { ContentLibraryItem, ReviewDecision, ReviewHistoryEntry, ContentPrediction } from '@/types'

const PLATFORM_COLORS: Record<string, string> = {
  instagram: 'bg-pink-500/10 text-pink-600',
  facebook:  'bg-blue-500/10 text-blue-600',
  tiktok:    'bg-neutral-500/10 text-neutral-600',
  linkedin:  'bg-blue-700/10 text-blue-700',
  x:         'bg-neutral-500/10 text-neutral-600',
  email:     'bg-violet-500/10 text-violet-600',
}

const DECISION_CONFIG: Record<ReviewDecision | 'submitted', { icon: React.ReactNode; label: string; color: string }> = {
  submitted:          { icon: <Clock className="w-3 h-3" />,     label: 'Submitted',          color: 'text-muted-foreground' },
  approved:           { icon: <Check className="w-3 h-3" />,     label: 'Approved',           color: 'text-green-600' },
  rejected:           { icon: <X className="w-3 h-3" />,         label: 'Rejected',           color: 'text-red-500' },
  changes_requested:  { icon: <RotateCcw className="w-3 h-3" />, label: 'Changes Requested',  color: 'text-amber-600' },
}

export default function ReviewPage() {
  const params = useParams<{ projectId: string }>()
  const { activeProject } = useAppStore()

  const [items, setItems]   = useState<ContentLibraryItem[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.approval.queue(params.projectId)
      setItems(data.items)
    } catch (err) { console.error(err) }
    finally { setLoading(false) }
  }, [params.projectId])

  useEffect(() => { load() }, [load])

  function handleDecision(itemId: string, decision: ReviewDecision) {
    setItems((prev) => prev.filter((i) => i.id !== itemId))
    if (decision === 'approved') toast.success('Approved ✓')
    else if (decision === 'rejected') toast.success('Rejected')
    else toast.success('Changes requested - sent back to draft')
  }

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="flex items-center gap-3 px-3 sm:px-4 py-3 border-b border-border shrink-0">
        <SidebarToggle />
        <BackButton />
        <ClipboardCheck className="w-4 h-4 text-primary" />
        <span className="text-sm font-semibold">Review Queue</span>
        {activeProject && <span className="text-xs text-muted-foreground">- {activeProject.name}</span>}
        <div className="ml-auto flex items-center gap-3">
          {!loading && (
            <span className={cn(
              'text-xs font-medium px-2 py-0.5 rounded-full',
              items.length > 0 ? 'bg-amber-500/10 text-amber-600' : 'bg-muted text-muted-foreground',
            )}>
              {items.length} awaiting review
            </span>
          )}
          <button onClick={load} className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4">
        {loading ? (
          <div className="flex items-center justify-center h-40">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-60 gap-3 text-center">
            <ClipboardCheck className="w-10 h-10 text-green-500/40" />
            <p className="text-sm font-medium text-green-600">All clear - nothing awaiting review</p>
            <p className="text-xs text-muted-foreground">Submit content from the Library to start the review workflow.</p>
          </div>
        ) : (
          <div className="max-w-2xl mx-auto space-y-3">
            {items.map((item) => (
              <ReviewCard
                key={item.id}
                item={item}
                projectId={params.projectId}
                onDecision={handleDecision}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// ReviewCard
// ---------------------------------------------------------------------------

function ReviewCard({ item, projectId, onDecision }: {
  item: ContentLibraryItem
  projectId: string
  onDecision: (itemId: string, decision: ReviewDecision) => void
}) {
  const [expanded, setExpanded]       = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [history, setHistory]         = useState<ReviewHistoryEntry[]>([])
  const [histLoading, setHistLoading] = useState(false)
  const [note, setNote]               = useState('')
  const [deciding, setDeciding]       = useState<ReviewDecision | null>(null)
  const [prediction, setPrediction]   = useState<ContentPrediction | null>(null)
  const [predicting, setPredicting]   = useState(false)
  const [showPrediction, setShowPrediction] = useState(false)

  const platformKey = item.platform?.toLowerCase() ?? ''

  async function loadHistory() {
    if (history.length > 0) { setShowHistory(!showHistory); return }
    setHistLoading(true)
    try {
      const data = await api.approval.history(projectId, item.id)
      setHistory(data.history)
      setShowHistory(true)
    } catch { toast.error('Failed to load history') }
    finally { setHistLoading(false) }
  }

  async function handlePredict() {
    if (prediction) { setShowPrediction((v) => !v); return }
    setPredicting(true)
    try {
      const data = await api.contentPredict.predict(projectId, item.content, item.platform ?? 'Instagram')
      setPrediction(data)
      setShowPrediction(true)
    } catch { toast.error('Prediction failed - Brand Core required') }
    finally { setPredicting(false) }
  }

  async function handleDecide(decision: ReviewDecision) {
    setDeciding(decision)
    try {
      await api.approval.decide(projectId, item.id, decision, note || undefined)
      onDecision(item.id, decision)
    } catch { toast.error('Failed to record decision') }
    finally { setDeciding(null) }
  }

  return (
    <div className="border border-border rounded-xl bg-card overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3">
        <span className={cn('text-[10px] font-semibold px-2 py-0.5 rounded-full capitalize', PLATFORM_COLORS[platformKey] ?? 'bg-muted text-muted-foreground')}>
          {item.platform}
        </span>
        <span className="text-xs text-muted-foreground capitalize">{item.type}</span>
        {(() => {
          const submittedAt = (item as unknown as Record<string, unknown>).submittedAt
          return submittedAt ? (
            <span className="text-[10px] text-muted-foreground ml-auto">
              Submitted {new Date(String(submittedAt)).toLocaleDateString()}
            </span>
          ) : null
        })()}
      </div>

      {/* Content */}
      <div className="px-4 pb-3">
        <p className={cn('text-sm text-foreground/80 whitespace-pre-wrap leading-relaxed', !expanded && 'line-clamp-4')}>
          {item.content}
        </p>
        {item.content.length > 300 && (
          <button onClick={() => setExpanded(!expanded)} className="mt-1 text-xs text-primary hover:opacity-80 flex items-center gap-1">
            {expanded ? <><ChevronUp className="w-3 h-3" />Show less</> : <><ChevronDown className="w-3 h-3" />Show more</>}
          </button>
        )}
        {item.hashtags?.length > 0 && (
          <p className="mt-2 text-xs text-primary/60">{item.hashtags.slice(0, 10).map((h) => `#${h.replace(/^#/, '')}`).join(' ')}</p>
        )}
      </div>

      {/* Review note input */}
      <div className="px-4 pb-3">
        <input
          value={note} onChange={(e) => setNote(e.target.value)}
          placeholder="Optional note for your decision…"
          className="w-full text-xs bg-background border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-2 px-4 pb-4 border-t border-border/50 pt-3">
        <button
          onClick={() => handleDecide('approved')}
          disabled={!!deciding}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-green-500/10 text-green-600 hover:bg-green-500/20 border border-green-500/20 disabled:opacity-50 transition-colors"
        >
          {deciding === 'approved' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
          Approve
        </button>
        <button
          onClick={() => handleDecide('changes_requested')}
          disabled={!!deciding}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-500/10 text-amber-600 hover:bg-amber-500/20 border border-amber-500/20 disabled:opacity-50 transition-colors"
        >
          {deciding === 'changes_requested' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
          Request Changes
        </button>
        <button
          onClick={() => handleDecide('rejected')}
          disabled={!!deciding}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-500/10 text-red-500 hover:bg-red-500/20 border border-red-500/20 disabled:opacity-50 transition-colors"
        >
          {deciding === 'rejected' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <X className="w-3.5 h-3.5" />}
          Reject
        </button>

        <div className="ml-auto flex items-center gap-2">
          <button onClick={handlePredict} disabled={predicting}
            className={cn('text-[10px] flex items-center gap-1 transition-colors', showPrediction ? 'text-primary' : 'text-muted-foreground hover:text-foreground')}>
            {predicting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
            Predict
          </button>
          <button onClick={loadHistory} disabled={histLoading}
            className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors">
            {histLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Clock className="w-3 h-3" />}
            History
          </button>
        </div>
      </div>

      {/* Performance prediction */}
      {showPrediction && prediction && (
        <div className="border-t border-border/50 px-4 py-3 bg-muted/20 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
              <Sparkles className="w-3 h-3 text-primary" />
              Performance Prediction
            </p>
            <div className="flex items-center gap-2">
              <span className={cn(
                'text-xs font-semibold px-2 py-0.5 rounded-full capitalize',
                prediction.estimated_engagement === 'high' ? 'bg-green-500/10 text-green-600' :
                prediction.estimated_engagement === 'medium' ? 'bg-amber-500/10 text-amber-600' :
                'bg-red-500/10 text-red-500',
              )}>
                {prediction.estimated_engagement} engagement
              </span>
              <span className="text-sm font-bold tabular-nums">{prediction.score}/100</span>
            </div>
          </div>

          {/* Sub-scores */}
          <div className="grid grid-cols-2 gap-2">
            {([
              { label: 'Hook',      value: prediction.hook_strength },
              { label: 'Clarity',   value: prediction.clarity },
              { label: 'CTA',       value: prediction.cta_strength },
              { label: 'Brand fit', value: prediction.brand_alignment },
            ] as { label: string; value: number }[]).map(({ label, value }) => (
              <div key={label} className="flex items-center gap-2">
                <span className="text-[10px] text-muted-foreground w-14 shrink-0">{label}</span>
                <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                  <div
                    className={cn('h-full rounded-full', value >= 70 ? 'bg-green-500' : value >= 45 ? 'bg-amber-500' : 'bg-red-500')}
                    style={{ width: `${value}%` }}
                  />
                </div>
                <span className="text-[10px] tabular-nums text-muted-foreground w-5 text-right">{value}</span>
              </div>
            ))}
          </div>

          {prediction.best_posting_time && (
            <p className="text-[10px] text-muted-foreground">
              <TrendingUp className="w-3 h-3 inline mr-1 text-primary" />
              Best time to post: <span className="font-medium">{prediction.best_posting_time}</span>
            </p>
          )}

          {prediction.improvements.length > 0 && (
            <div>
              <p className="text-[10px] font-medium text-muted-foreground mb-1">Suggestions</p>
              <ul className="space-y-0.5">
                {prediction.improvements.slice(0, 3).map((s, i) => (
                  <li key={i} className="text-[10px] text-foreground/70 flex gap-1.5">
                    <span className="text-primary shrink-0">•</span>
                    {s}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Review history */}
      {showHistory && history.length > 0 && (
        <div className="border-t border-border/50 px-4 py-3 space-y-2 bg-muted/20">
          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Review History</p>
          {history.map((h) => {
            const cfg = DECISION_CONFIG[h.action] ?? DECISION_CONFIG.submitted
            return (
              <div key={h.id} className="flex items-start gap-2">
                <span className={cn('mt-0.5', cfg.color)}>{cfg.icon}</span>
                <div>
                  <span className={cn('text-xs font-medium', cfg.color)}>{cfg.label}</span>
                  <span className="text-[10px] text-muted-foreground ml-2">{new Date(h.timestamp).toLocaleDateString()}</span>
                  {h.note && <p className="text-[10px] text-muted-foreground mt-0.5">{h.note}</p>}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
