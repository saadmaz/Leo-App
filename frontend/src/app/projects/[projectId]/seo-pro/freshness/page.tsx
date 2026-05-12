'use client'

import { useState, useRef } from 'react'
import { useParams } from 'next/navigation'
import { RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { SSEFeaturePage } from '@/components/pillar1/SSEFeaturePage'
import { api } from '@/lib/api'
import { usePillar3Store } from '@/stores/pillar3-store'
import type { ContentFreshnessPayload, ProgressStep } from '@/types'
import { cn } from '@/lib/utils'

const SIGNAL_STYLES = {
  good: 'text-green-700 bg-green-50 border-green-200 dark:bg-green-950/20',
  warning: 'text-yellow-700 bg-yellow-50 border-yellow-200 dark:bg-yellow-950/20',
  critical: 'text-red-700 bg-red-50 border-red-200 dark:bg-red-950/20',
}

const PRIORITY_BADGE = {
  low: 'bg-blue-100 text-blue-700',
  medium: 'bg-yellow-100 text-yellow-700',
  high: 'bg-red-100 text-red-700',
}

function FreshnessScore({ score }: { score: number }) {
  const color = score >= 70 ? 'text-green-500' : score >= 40 ? 'text-yellow-500' : 'text-red-500'
  const barColor = score >= 70 ? 'bg-green-500' : score >= 40 ? 'bg-yellow-500' : 'bg-red-500'
  return (
    <div className="flex items-center gap-3">
      <p className={cn('text-4xl font-bold', color)}>{score}</p>
      <div className="flex-1">
        <div className="h-2 bg-muted rounded-full overflow-hidden">
          <div className={cn('h-full rounded-full', barColor)} style={{ width: `${score}%` }} />
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">Freshness score</p>
      </div>
    </div>
  )
}

export default function FreshnessPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const store = usePillar3Store()
  const [url, setUrl] = useState('')
  const [keyword, setKeyword] = useState('')
  const [locationCode, setLocationCode] = useState(2840)
  const [result, setResult] = useState<ContentFreshnessPayload | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  async function generate() {
    if (!url.trim()) { toast.error('URL is required'); return }
    if (!keyword.trim()) { toast.error('Keyword is required'); return }
    abortRef.current?.abort()
    abortRef.current = new AbortController()
    store.setIsStreaming(true)
    store.clearSteps()
    store.clearStreamText()
    setResult(null)
    try {
      await api.pillar3.streamFreshnessCheck(projectId,
        { url: url.trim(), keyword: keyword.trim(), location_code: locationCode, language_code: 'en' },
        {
          onStep: (step, label, status) => store.upsertStep(step, label, status as ProgressStep['status']),
          onDelta: (text) => store.appendStreamText(text),
          onSaved: (_id, payload) => { setResult(payload as unknown as ContentFreshnessPayload); store.clearStreamText(); store.setIsStreaming(false); toast.success('Freshness check complete!') },
          onError: (msg) => { toast.error(msg); store.setIsStreaming(false) },
          onDone: () => store.setIsStreaming(false),
        },
        abortRef.current.signal,
      )
    } catch { store.setIsStreaming(false) }
  }

  const form = (
    <>
      <h2 className="font-semibold text-sm">Content Freshness Check</h2>
      <div>
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Page URL *</label>
        <input value={url} onChange={(e) => setUrl(e.target.value)}
          placeholder="https://example.com/blog/your-article"
          className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
      </div>
      <div>
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Target Keyword *</label>
        <input value={keyword} onChange={(e) => setKeyword(e.target.value)}
          placeholder="e.g. best CRM for startups"
          className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
      </div>
      <div>
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Location</label>
        <select value={locationCode} onChange={(e) => setLocationCode(Number(e.target.value))}
          className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary">
          <option value={2840}>United States</option>
          <option value={2826}>United Kingdom</option>
          <option value={2124}>Canada</option>
          <option value={2036}>Australia</option>
        </select>
      </div>
    </>
  )

  const resultNode = result ? (
    <div className="space-y-4">
      {/* Score + rank */}
      <div className="p-5 rounded-xl border border-border bg-card space-y-4">
        <FreshnessScore score={result.freshness_score} />
        <div className="grid grid-cols-3 gap-3 pt-2 border-t border-border">
          <div>
            <p className="text-xs text-muted-foreground">Current Rank</p>
            <p className="text-lg font-bold">{result.current_position ? `#${result.current_position}` : 'N/R'}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Trend</p>
            <p className="text-sm font-medium">{result.position_trend}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Priority</p>
            <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium', PRIORITY_BADGE[result.update_priority] ?? 'bg-muted text-muted-foreground')}>
              {result.update_priority}
            </span>
          </div>
        </div>
      </div>

      {/* Freshness signals */}
      {result.signals?.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Freshness Signals</p>
          {result.signals.map((sig, i) => (
            <div key={i} className={cn('p-3 rounded-lg border flex items-start gap-3', SIGNAL_STYLES[sig.status])}>
              <div className={cn('w-2 h-2 rounded-full mt-1 shrink-0',
                sig.status === 'good' ? 'bg-green-500' : sig.status === 'warning' ? 'bg-yellow-500' : 'bg-red-500')} />
              <div>
                <p className="text-xs font-semibold">{sig.signal}</p>
                <p className="text-xs opacity-80">{sig.note}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Recommended updates */}
      {result.recommended_updates?.length > 0 && (
        <div className="p-4 rounded-xl border border-orange-200 bg-orange-50 dark:bg-orange-950/20">
          <p className="text-xs font-semibold text-orange-700 uppercase tracking-wide mb-2">Recommended Updates</p>
          {result.recommended_updates.map((u, i) => (
            <p key={i} className="text-xs text-orange-700 mb-1">→ {u}</p>
          ))}
        </div>
      )}

      {/* Refresh checklist */}
      {result.refresh_checklist?.length > 0 && (
        <div className="p-4 rounded-xl border border-border bg-card">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Refresh Checklist</p>
          {result.refresh_checklist.map((item, i) => (
            <p key={i} className="text-xs text-muted-foreground">☐ {item}</p>
          ))}
        </div>
      )}

      {result.competitive_threat && (
        <div className="p-3 rounded-lg border border-border">
          <p className="text-xs font-semibold mb-1">Competitive Threat</p>
          <p className="text-xs text-muted-foreground">{result.competitive_threat}</p>
        </div>
      )}

      {result.estimated_traffic_recovery && (
        <div className="p-3 rounded-lg bg-primary/5 border border-primary/20">
          <p className="text-xs font-semibold text-primary mb-0.5">Potential Impact</p>
          <p className="text-xs">{result.estimated_traffic_recovery}</p>
        </div>
      )}
    </div>
  ) : null

  return (
    <SSEFeaturePage projectId={projectId} title="Content Freshness Check" subtitle="DataForSEO + Claude"
      icon={<RefreshCw className="w-4 h-4" />} credits={10} steps={store.steps}
      isStreaming={store.isStreaming} streamText={store.streamText} form={form} result={resultNode}
      onSubmit={generate} submitLabel="Check Freshness - 10 credits" canSubmit={!!url.trim() && !!keyword.trim()} />
  )
}
