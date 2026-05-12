'use client'

import { useState, useRef } from 'react'
import { useParams } from 'next/navigation'
import { Wrench } from 'lucide-react'
import { toast } from 'sonner'
import { SSEFeaturePage } from '@/components/pillar1/SSEFeaturePage'
import { api } from '@/lib/api'
import { usePillar3Store } from '@/stores/pillar3-store'
import type { TechnicalSeoPayload, ProgressStep } from '@/types'
import { cn } from '@/lib/utils'

const SEVERITY_STYLES = {
  critical: 'border-red-200 bg-red-50 dark:bg-red-950/20',
  warning: 'border-yellow-200 bg-yellow-50 dark:bg-yellow-950/20',
  info: 'border-blue-200 bg-blue-50 dark:bg-blue-950/20',
}
const SEVERITY_TEXT = {
  critical: 'text-red-700',
  warning: 'text-yellow-700',
  info: 'text-blue-700',
}
const SEVERITY_BADGE = {
  critical: 'bg-red-100 text-red-700',
  warning: 'bg-yellow-100 text-yellow-700',
  info: 'bg-blue-100 text-blue-700',
}

function ScoreBar({ label, score }: { label: string; score: number }) {
  const color = score >= 80 ? 'bg-green-500' : score >= 60 ? 'bg-yellow-500' : 'bg-red-500'
  return (
    <div className="flex items-center gap-2">
      <p className="text-xs w-28 capitalize">{label.replace(/_/g, ' ')}</p>
      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
        <div className={cn('h-full rounded-full', color)} style={{ width: `${score}%` }} />
      </div>
      <p className="text-xs font-mono w-6 text-right">{score}</p>
    </div>
  )
}

export default function TechnicalSeoPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const store = usePillar3Store()
  const [url, setUrl] = useState('')
  const [enableJs, setEnableJs] = useState(true)
  const [result, setResult] = useState<TechnicalSeoPayload | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  async function generate() {
    if (!url.trim()) { toast.error('URL is required'); return }
    abortRef.current?.abort()
    abortRef.current = new AbortController()
    store.setIsStreaming(true)
    store.clearSteps()
    store.clearStreamText()
    setResult(null)
    try {
      await api.pillar3.streamTechnicalAudit(projectId,
        { url: url.trim(), enable_javascript: enableJs },
        {
          onStep: (step, label, status) => store.upsertStep(step, label, status as ProgressStep['status']),
          onDelta: (text) => store.appendStreamText(text),
          onSaved: (_id, payload) => { setResult(payload as unknown as TechnicalSeoPayload); store.clearStreamText(); store.setIsStreaming(false); toast.success('Technical audit complete!') },
          onError: (msg) => { toast.error(msg); store.setIsStreaming(false) },
          onDone: () => store.setIsStreaming(false),
        },
        abortRef.current.signal,
      )
    } catch { store.setIsStreaming(false) }
  }

  const form = (
    <>
      <h2 className="font-semibold text-sm">Technical SEO Monitor</h2>
      <div>
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Page URL *</label>
        <input value={url} onChange={(e) => setUrl(e.target.value)}
          placeholder="https://example.com"
          className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
      </div>
      <label className="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" checked={enableJs} onChange={(e) => setEnableJs(e.target.checked)}
          className="w-4 h-4 rounded border-border" />
        <span className="text-xs text-muted-foreground">Enable JavaScript rendering (slower but more accurate)</span>
      </label>
    </>
  )

  const resultNode = result ? (
    <div className="space-y-4">
      {/* Header */}
      <div className="p-5 rounded-xl border border-border bg-card">
        <div className="flex items-start justify-between mb-4">
          <div>
            <p className={cn('text-4xl font-bold', result.crawl_score >= 80 ? 'text-green-500' : result.crawl_score >= 60 ? 'text-yellow-500' : 'text-red-500')}>
              {result.crawl_score}
            </p>
            <p className="text-xs text-muted-foreground">Technical health score</p>
          </div>
          <div className="flex flex-col gap-1 items-end">
            {result.https_enabled !== null && (
              <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium',
                result.https_enabled ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700')}>
                {result.https_enabled ? '✓ HTTPS' : '✗ No HTTPS'}
              </span>
            )}
            {result.mobile_friendly !== null && (
              <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium',
                result.mobile_friendly ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700')}>
                {result.mobile_friendly ? '✓ Mobile friendly' : '✗ Not mobile friendly'}
              </span>
            )}
          </div>
        </div>

        {/* Score breakdown */}
        {result.technical_score_breakdown && Object.keys(result.technical_score_breakdown).length > 0 && (
          <div className="space-y-1.5 pt-3 border-t border-border">
            {Object.entries(result.technical_score_breakdown).map(([label, score]) => (
              <ScoreBar key={label} label={label} score={score as number} />
            ))}
          </div>
        )}
      </div>

      {/* Performance metrics */}
      {result.performance_metrics && Object.keys(result.performance_metrics).length > 0 && (
        <div className="p-4 rounded-xl border border-border bg-card">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Performance</p>
          <div className="grid grid-cols-2 gap-2">
            {Object.entries(result.performance_metrics).map(([k, v]) => (
              <div key={k} className="p-2 bg-muted rounded-lg">
                <p className="text-[10px] text-muted-foreground capitalize">{k.replace(/_/g, ' ')}</p>
                <p className="text-xs font-medium">{String(v)}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Quick wins */}
      {result.quick_technical_wins?.length > 0 && (
        <div className="p-4 rounded-xl border border-green-200 bg-green-50 dark:bg-green-950/20 space-y-1">
          <p className="text-xs font-semibold text-green-700 uppercase tracking-wide mb-2">Quick Technical Wins</p>
          {result.quick_technical_wins.map((w, i) => (
            <p key={i} className="text-xs text-green-700">✓ {w}</p>
          ))}
        </div>
      )}

      {/* Issues */}
      {result.issues?.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Issues Found</p>
          {result.issues.map((issue, i) => (
            <div key={i} className={cn('p-3 rounded-lg border', SEVERITY_STYLES[issue.severity])}>
              <div className="flex items-start justify-between gap-2 mb-1">
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase font-semibold">{issue.category}</p>
                  <p className={cn('text-xs font-semibold mt-0.5', SEVERITY_TEXT[issue.severity])}>{issue.description}</p>
                </div>
                <span className={cn('text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0', SEVERITY_BADGE[issue.severity])}>
                  {issue.severity}
                </span>
              </div>
              <p className={cn('text-xs', SEVERITY_TEXT[issue.severity], 'opacity-75 mt-1')}>Fix: {issue.fix}</p>
              {issue.affected_elements?.length > 0 && (
                <p className="text-[10px] text-muted-foreground mt-1">{issue.affected_elements.join(', ')}</p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Recommendations */}
      {result.recommendations?.length > 0 && (
        <div className="p-4 rounded-xl border border-border bg-card space-y-1">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Top Recommendations</p>
          {result.recommendations.map((r, i) => (
            <p key={i} className="text-xs text-muted-foreground">→ {r}</p>
          ))}
        </div>
      )}

      {/* Structured data + canonical */}
      {(result.structured_data?.length > 0 || result.canonical_url) && (
        <div className="p-4 rounded-xl border border-border bg-card space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Metadata</p>
          {result.structured_data?.length > 0 && (
            <div>
              <p className="text-[10px] text-muted-foreground">Structured data found</p>
              <div className="flex flex-wrap gap-1 mt-1">
                {result.structured_data.map((s, i) => (
                  <span key={i} className="text-[10px] px-2 py-0.5 bg-muted rounded-full font-mono">{s}</span>
                ))}
              </div>
            </div>
          )}
          {result.canonical_url && (
            <div>
              <p className="text-[10px] text-muted-foreground">Canonical URL</p>
              <p className="text-xs font-mono truncate">{result.canonical_url}</p>
            </div>
          )}
        </div>
      )}
    </div>
  ) : null

  return (
    <SSEFeaturePage projectId={projectId} title="Technical SEO Monitor" subtitle="DataForSEO + Claude"
      icon={<Wrench className="w-4 h-4" />} credits={20} steps={store.steps}
      isStreaming={store.isStreaming} streamText={store.streamText} form={form} result={resultNode}
      onSubmit={generate} submitLabel="Run Technical Audit - 20 credits" canSubmit={!!url.trim()} />
  )
}
