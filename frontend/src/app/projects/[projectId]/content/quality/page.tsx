'use client'

import { useState, useRef } from 'react'
import { useParams } from 'next/navigation'
import { CheckCircle } from 'lucide-react'
import { toast } from 'sonner'
import { SSEFeaturePage } from '@/components/pillar1/SSEFeaturePage'
import { api } from '@/lib/api'
import { usePillar2Store } from '@/stores/pillar2-store'
import type { QualityPayload, ProgressStep } from '@/types'
import { cn } from '@/lib/utils'

const PLATFORMS = ['General', 'LinkedIn', 'Twitter/X', 'Instagram', 'Facebook', 'Email', 'Blog', 'YouTube']
const CONTENT_TYPES = ['post', 'article', 'email', 'caption', 'ad_copy', 'script', 'landing_page']

function ScoreBar({ score }: { score: number }) {
  const color = score >= 80 ? 'bg-green-500' : score >= 60 ? 'bg-yellow-500' : 'bg-red-500'
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
        <div className={cn('h-full rounded-full transition-all', color)} style={{ width: `${score}%` }} />
      </div>
      <span className="text-xs font-mono w-6 text-right">{score}</span>
    </div>
  )
}

export default function QualityPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const store = usePillar2Store()
  const [content, setContent] = useState('')
  const [platform, setPlatform] = useState('LinkedIn')
  const [contentType, setContentType] = useState('post')
  const [result, setResult] = useState<QualityPayload | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  async function generate() {
    if (!content.trim()) { toast.error('Content is required'); return }
    abortRef.current?.abort()
    abortRef.current = new AbortController()
    store.setIsStreaming(true)
    store.clearSteps()
    store.clearStreamText()
    setResult(null)
    try {
      await api.pillar2.streamQualityScore(projectId,
        { content: content.trim(), platform, content_type: contentType },
        {
          onStep: (step, label, status) => store.upsertStep(step, label, status as ProgressStep['status']),
          onDelta: (text) => store.appendStreamText(text),
          onSaved: (_id, payload) => { setResult(payload as unknown as QualityPayload); store.clearStreamText(); store.setIsStreaming(false); toast.success('Quality report ready!') },
          onError: (msg) => { toast.error(msg); store.setIsStreaming(false) },
          onDone: () => store.setIsStreaming(false),
        },
        abortRef.current.signal,
      )
    } catch { store.setIsStreaming(false) }
  }

  const form = (
    <>
      <h2 className="font-semibold text-sm">Content Quality Scorer</h2>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Platform</label>
          <select value={platform} onChange={(e) => setPlatform(e.target.value)}
            className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary">
            {PLATFORMS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Content Type</label>
          <select value={contentType} onChange={(e) => setContentType(e.target.value)}
            className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary">
            {CONTENT_TYPES.map((t) => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
          </select>
        </div>
      </div>
      <div>
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Content to Score *</label>
        <textarea value={content} onChange={(e) => setContent(e.target.value)} rows={6}
          placeholder="Paste your content here for quality analysis..."
          className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary resize-none" />
      </div>
    </>
  )

  const resultNode = result ? (
    <div className="space-y-4">
      {/* Overall score */}
      <div className="p-5 rounded-xl border border-border bg-card flex items-center gap-4">
        <div className="text-center">
          <p className={cn('text-4xl font-bold',
            result.overall_score >= 80 ? 'text-green-500' :
              result.overall_score >= 60 ? 'text-yellow-500' : 'text-red-500'
          )}>{result.overall_score}</p>
          <p className="text-lg font-semibold">{result.grade}</p>
        </div>
        <div className="flex-1">
          <p className="text-sm font-medium">{result.verdict}</p>
          <p className="text-xs text-muted-foreground mt-1">{result.platform} · {result.content_type}</p>
          <span className={cn('inline-block text-xs px-2 py-0.5 rounded-full mt-2',
            result.publish_ready ? 'bg-green-500/10 text-green-600' : 'bg-red-500/10 text-red-600'
          )}>
            {result.publish_ready ? '✓ Publish Ready' : '✗ Needs Revision'}
          </span>
        </div>
      </div>

      {/* Dimensions */}
      <div className="p-4 rounded-xl border border-border bg-card space-y-3">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Dimension Scores</p>
        {result.dimensions?.map((d, i) => (
          <div key={i} className="space-y-1">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium">{d.name}</p>
            </div>
            <ScoreBar score={d.score} />
            <p className="text-xs text-muted-foreground">{d.feedback}</p>
          </div>
        ))}
      </div>

      {/* Improvements */}
      {result.top_3_improvements?.length > 0 && (
        <div className="p-4 rounded-xl border border-orange-200 bg-orange-50 dark:bg-orange-950/20">
          <p className="text-xs font-semibold text-orange-700 uppercase tracking-wide mb-2">Top Improvements</p>
          {result.top_3_improvements.map((imp, i) => (
            <p key={i} className="text-xs text-orange-700 mb-1">→ {imp}</p>
          ))}
        </div>
      )}

      {result.rewrite_suggestion && (
        <div className="p-4 rounded-xl border border-border bg-card">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Rewrite Suggestion</p>
          <p className="text-sm text-muted-foreground italic">&ldquo;{result.rewrite_suggestion}&rdquo;</p>
        </div>
      )}
    </div>
  ) : null

  return (
    <SSEFeaturePage projectId={projectId} title="Content Quality Score" subtitle="6-dimension analysis"
      icon={<CheckCircle className="w-4 h-4" />} credits={10} steps={store.steps}
      isStreaming={store.isStreaming} streamText={store.streamText} form={form} result={resultNode}
      onSubmit={generate} submitLabel="Score Content - 10 credits" canSubmit={!!content.trim()} />
  )
}
