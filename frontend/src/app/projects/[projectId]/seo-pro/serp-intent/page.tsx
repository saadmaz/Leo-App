'use client'

import { useState, useRef } from 'react'
import { useParams } from 'next/navigation'
import { TrendingUp } from 'lucide-react'
import { toast } from 'sonner'
import { SSEFeaturePage } from '@/components/pillar1/SSEFeaturePage'
import { api } from '@/lib/api'
import { usePillar3Store } from '@/stores/pillar3-store'
import type { SerpIntentPayload, ProgressStep } from '@/types'
import { cn } from '@/lib/utils'

const INTENT_COLORS: Record<string, string> = {
  Informational: 'bg-blue-500',
  Navigational: 'bg-purple-500',
  Transactional: 'bg-green-500',
  Commercial: 'bg-orange-500',
}

const INTENT_TEXT: Record<string, string> = {
  Informational: 'text-blue-700 dark:text-blue-400',
  Navigational: 'text-purple-700 dark:text-purple-400',
  Transactional: 'text-green-700 dark:text-green-400',
  Commercial: 'text-orange-700 dark:text-orange-400',
}

const DIFFICULTY_LABEL: Record<string, string> = {
  Low: 'text-green-600',
  Medium: 'text-yellow-600',
  High: 'text-orange-600',
  'Very High': 'text-red-600',
}

export default function SerpIntentPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const store = usePillar3Store()
  const [keyword, setKeyword] = useState('')
  const [locationCode, setLocationCode] = useState(2840)
  const [result, setResult] = useState<SerpIntentPayload | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  async function generate() {
    if (!keyword.trim()) { toast.error('Keyword is required'); return }
    abortRef.current?.abort()
    abortRef.current = new AbortController()
    store.setIsStreaming(true)
    store.clearSteps()
    store.clearStreamText()
    setResult(null)
    try {
      await api.pillar3.streamSerpIntent(projectId,
        { keyword: keyword.trim(), location_code: locationCode, language_code: 'en' },
        {
          onStep: (step, label, status) => store.upsertStep(step, label, status as ProgressStep['status']),
          onDelta: (text) => store.appendStreamText(text),
          onSaved: (_id, payload) => { setResult(payload as unknown as SerpIntentPayload); store.clearStreamText(); store.setIsStreaming(false); toast.success('SERP intent mapped!') },
          onError: (msg) => { toast.error(msg); store.setIsStreaming(false) },
          onDone: () => store.setIsStreaming(false),
        },
        abortRef.current.signal,
      )
    } catch { store.setIsStreaming(false) }
  }

  const form = (
    <>
      <h2 className="font-semibold text-sm">SERP Intent Mapping</h2>
      <div>
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Target Keyword *</label>
        <input value={keyword} onChange={(e) => setKeyword(e.target.value)}
          placeholder="e.g. best email marketing software"
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
      <h2 className="font-semibold text-sm">&ldquo;{result.keyword}&rdquo;</h2>

      {/* Overall intent */}
      <div className="p-4 rounded-xl border border-border bg-card">
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wide font-semibold">Dominant Intent</p>
            <p className={cn('text-xl font-bold mt-1', INTENT_TEXT[result.overall_intent] ?? '')}>{result.overall_intent}</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-muted-foreground">Confidence</p>
            <p className="text-lg font-bold">{result.intent_confidence}%</p>
          </div>
        </div>

        {/* Intent breakdown bars */}
        {result.intent_breakdown && (
          <div className="space-y-1.5">
            {Object.entries(result.intent_breakdown).map(([intent, pct]) => (
              <div key={intent} className="flex items-center gap-2">
                <p className="text-xs w-24 capitalize">{intent}</p>
                <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                  <div className={cn('h-full rounded-full', INTENT_COLORS[intent.charAt(0).toUpperCase() + intent.slice(1)] ?? 'bg-muted-foreground')}
                    style={{ width: `${pct}%` }} />
                </div>
                <p className="text-xs font-mono w-8 text-right">{pct}%</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Content recommendation */}
      <div className="p-4 rounded-xl border border-border bg-card space-y-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Content Strategy</p>
        <p className="text-sm font-medium">{result.content_type_to_create}</p>
        <p className="text-xs text-muted-foreground">{result.content_recommendation}</p>
        {result.angle && <p className="text-xs text-primary font-medium">Angle: {result.angle}</p>}
        <div className="flex items-center gap-4 mt-2">
          {result.ideal_word_count > 0 && (
            <p className="text-xs text-muted-foreground">Target: ~{result.ideal_word_count.toLocaleString()} words</p>
          )}
          <p className={cn('text-xs font-medium', DIFFICULTY_LABEL[result.difficulty_assessment] ?? '')}>
            {result.difficulty_assessment} difficulty
          </p>
          <p className="text-xs text-muted-foreground">{result.ranking_timeline}</p>
        </div>
      </div>

      {/* SERP results */}
      {result.serp_results?.length > 0 && (
        <div className="rounded-xl border border-border overflow-hidden">
          <div className="bg-muted px-3 py-2">
            <p className="text-xs font-semibold text-muted-foreground">Top SERP Results</p>
          </div>
          {result.serp_results.slice(0, 10).map((r, i) => (
            <div key={i} className="px-3 py-2.5 border-t border-border">
              <div className="flex items-start gap-2">
                <span className="text-xs text-muted-foreground font-mono w-5 shrink-0">#{r.position}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium truncate">{r.title}</p>
                  <p className="text-[10px] text-muted-foreground truncate">{r.url}</p>
                </div>
                <span className={cn('text-[10px] px-1.5 py-0.5 rounded-full shrink-0',
                  INTENT_COLORS[r.intent] ? `${INTENT_COLORS[r.intent].replace('bg-', 'bg-').replace('500', '100')} ${INTENT_TEXT[r.intent]}` : 'bg-muted text-muted-foreground')}>
                  {r.intent}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  ) : null

  return (
    <SSEFeaturePage projectId={projectId} title="SERP Intent Mapping" subtitle="DataForSEO + Claude"
      icon={<TrendingUp className="w-4 h-4" />} credits={10} steps={store.steps}
      isStreaming={store.isStreaming} streamText={store.streamText} form={form} result={resultNode}
      onSubmit={generate} submitLabel="Map Intent - 10 credits" canSubmit={!!keyword.trim()} />
  )
}
