'use client'

import { useState, useRef } from 'react'
import { useParams } from 'next/navigation'
import { FileSearch } from 'lucide-react'
import { toast } from 'sonner'
import { SSEFeaturePage } from '@/components/pillar1/SSEFeaturePage'
import { api } from '@/lib/api'
import { usePillar3Store } from '@/stores/pillar3-store'
import type { OnPageSeoPayload, ProgressStep } from '@/types'
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

function ScoreRing({ score, grade }: { score: number; grade: string }) {
  const color = score >= 80 ? 'text-green-500' : score >= 60 ? 'text-yellow-500' : 'text-red-500'
  return (
    <div className="flex flex-col items-center">
      <p className={cn('text-4xl font-bold', color)}>{score}</p>
      <p className="text-xl font-semibold">{grade}</p>
    </div>
  )
}

export default function OnPageSeoPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const store = usePillar3Store()
  const [url, setUrl] = useState('')
  const [targetKeyword, setTargetKeyword] = useState('')
  const [result, setResult] = useState<OnPageSeoPayload | null>(null)
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
      await api.pillar3.streamOnPageAudit(projectId,
        { url: url.trim(), target_keyword: targetKeyword.trim() || undefined },
        {
          onStep: (step, label, status) => store.upsertStep(step, label, status as ProgressStep['status']),
          onDelta: (text) => store.appendStreamText(text),
          onSaved: (_id, payload) => { setResult(payload as unknown as OnPageSeoPayload); store.clearStreamText(); store.setIsStreaming(false); toast.success('On-page audit complete!') },
          onError: (msg) => { toast.error(msg); store.setIsStreaming(false) },
          onDone: () => store.setIsStreaming(false),
        },
        abortRef.current.signal,
      )
    } catch { store.setIsStreaming(false) }
  }

  const form = (
    <>
      <h2 className="font-semibold text-sm">On-Page SEO Audit</h2>
      <div>
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Page URL *</label>
        <input value={url} onChange={(e) => setUrl(e.target.value)}
          placeholder="https://example.com/your-page"
          className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
      </div>
      <div>
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Target Keyword (optional)</label>
        <input value={targetKeyword} onChange={(e) => setTargetKeyword(e.target.value)}
          placeholder="e.g. marketing automation software"
          className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
      </div>
    </>
  )

  const resultNode = result ? (
    <div className="space-y-4">
      {/* Score header */}
      <div className="p-5 rounded-xl border border-border bg-card flex items-center gap-6">
        <ScoreRing score={result.overall_score} grade={result.grade} />
        <div className="flex-1 space-y-2">
          <p className="text-xs text-muted-foreground font-mono truncate">{result.url}</p>
          {result.estimated_impact && (
            <p className="text-xs text-muted-foreground">{result.estimated_impact}</p>
          )}
          <div className="flex flex-wrap gap-2 mt-2">
            {result.word_count && (
              <span className="text-xs bg-muted px-2 py-0.5 rounded-full">{result.word_count.toLocaleString()} words</span>
            )}
            {result.load_time_ms && (
              <span className="text-xs bg-muted px-2 py-0.5 rounded-full">{result.load_time_ms}ms load</span>
            )}
          </div>
        </div>
      </div>

      {/* Priority fixes */}
      {result.priority_fixes?.length > 0 && (
        <div className="p-4 rounded-xl border border-red-200 bg-red-50 dark:bg-red-950/20 space-y-1">
          <p className="text-xs font-semibold text-red-700 uppercase tracking-wide mb-2">Top Priority Fixes</p>
          {result.priority_fixes.map((f, i) => (
            <p key={i} className="text-xs text-red-700">→ {f}</p>
          ))}
        </div>
      )}

      {/* Quick wins */}
      {result.quick_wins?.length > 0 && (
        <div className="p-4 rounded-xl border border-green-200 bg-green-50 dark:bg-green-950/20 space-y-1">
          <p className="text-xs font-semibold text-green-700 uppercase tracking-wide mb-2">Quick Wins (under 30 min)</p>
          {result.quick_wins.map((w, i) => (
            <p key={i} className="text-xs text-green-700">✓ {w}</p>
          ))}
        </div>
      )}

      {/* Issues */}
      {result.issues?.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">All Issues</p>
          {result.issues.map((issue, i) => (
            <div key={i} className={cn('p-3 rounded-lg border', SEVERITY_STYLES[issue.severity])}>
              <div className="flex items-start justify-between gap-2 mb-1">
                <p className={cn('text-xs font-semibold', SEVERITY_TEXT[issue.severity])}>{issue.description}</p>
                <span className={cn('text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0', SEVERITY_BADGE[issue.severity])}>
                  {issue.severity}
                </span>
              </div>
              <p className={cn('text-xs', SEVERITY_TEXT[issue.severity], 'opacity-80')}>Fix: {issue.fix}</p>
            </div>
          ))}
        </div>
      )}

      {/* Optimised meta */}
      {(result.optimised_title || result.optimised_description) && (
        <div className="p-4 rounded-xl border border-border bg-card space-y-3">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Suggested Meta</p>
          {result.optimised_title && (
            <div>
              <p className="text-[10px] text-muted-foreground mb-0.5">Title</p>
              <p className="text-sm font-medium">{result.optimised_title}</p>
            </div>
          )}
          {result.optimised_description && (
            <div>
              <p className="text-[10px] text-muted-foreground mb-0.5">Description</p>
              <p className="text-xs text-muted-foreground">{result.optimised_description}</p>
            </div>
          )}
        </div>
      )}

      {/* Strengths */}
      {result.strengths?.length > 0 && (
        <div className="p-4 rounded-xl border border-border bg-card">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Strengths</p>
          {result.strengths.map((s, i) => <p key={i} className="text-xs text-muted-foreground">• {s}</p>)}
        </div>
      )}
    </div>
  ) : null

  return (
    <SSEFeaturePage projectId={projectId} title="On-Page SEO Audit" subtitle="DataForSEO + Claude"
      icon={<FileSearch className="w-4 h-4" />} credits={15} steps={store.steps}
      isStreaming={store.isStreaming} streamText={store.streamText} form={form} result={resultNode}
      onSubmit={generate} submitLabel="Run Audit - 15 credits" canSubmit={!!url.trim()} />
  )
}
