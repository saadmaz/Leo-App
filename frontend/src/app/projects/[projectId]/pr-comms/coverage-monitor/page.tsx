'use client'

import { useState, useRef } from 'react'
import { useParams } from 'next/navigation'
import { Eye, Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import { SSEFeaturePage } from '@/components/pillar1/SSEFeaturePage'
import { api } from '@/lib/api'
import { usePillar8Store } from '@/stores/pillar8-store'
import type { ProgressStep } from '@/types'
import { cn } from '@/lib/utils'

const SENTIMENT_COLORS: Record<string, string> = {
  positive: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  neutral: 'bg-muted text-muted-foreground',
  negative: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
}

const SEVERITY_COLORS: Record<string, string> = {
  high: 'border-red-500 bg-red-50 dark:bg-red-900/20',
  medium: 'border-orange-400 bg-orange-50 dark:bg-orange-900/20',
  low: 'border-border bg-card',
}

interface CoverageMention {
  source: string
  title: string
  url?: string
  snippet: string
  sentiment: 'positive' | 'neutral' | 'negative'
  significance: 'high' | 'medium' | 'low'
  date?: string
}

interface CoverageAlert { type: string; message: string; severity: 'high' | 'medium' | 'low' }
interface CoveragePayload {
  coverage_summary: string
  sentiment_breakdown: { positive: number; neutral: number; negative: number }
  key_themes: Array<{ theme: string; mention_count: number; sentiment: string }>
  top_mentions: CoverageMention[]
  alerts: CoverageAlert[]
  recommended_actions: string[]
  brand_name: string
  total_raw_mentions: number
  days_back: number
}

export default function CoverageMonitorPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const store = usePillar8Store()

  const [brandName, setBrandName] = useState('')
  const [keywords, setKeywords] = useState<string[]>([''])
  const [includeReddit, setIncludeReddit] = useState(true)
  const [includeNews, setIncludeNews] = useState(true)
  const [daysBack, setDaysBack] = useState(7)
  const [sentimentFilter, setSentimentFilter] = useState<string>('')
  const [result, setResult] = useState<CoveragePayload | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  function addKeyword() { if (keywords.length < 5) setKeywords([...keywords, '']) }
  function removeKeyword(i: number) { setKeywords(keywords.filter((_, idx) => idx !== i)) }
  function updateKeyword(i: number, v: string) { const n = [...keywords]; n[i] = v; setKeywords(n) }

  async function generate() {
    if (!brandName.trim()) { toast.error('Enter the brand name to monitor'); return }

    abortRef.current?.abort()
    abortRef.current = new AbortController()
    store.setIsStreaming(true)
    store.clearSteps()
    store.clearStreamText()
    setResult(null)

    try {
      await api.pillar8.streamCoverageMonitor(
        projectId,
        {
          brand_name: brandName.trim(),
          keywords: keywords.filter(Boolean),
          include_reddit: includeReddit,
          include_news: includeNews,
          days_back: daysBack,
          sentiment_filter: sentimentFilter || undefined,
        },
        {
          onStep: (step, label, status) => store.upsertStep(step, label, status as ProgressStep['status']),
          onDelta: (text) => store.appendStreamText(text),
          onSaved: (_id, payload) => {
            setResult(payload as unknown as CoveragePayload)
            store.clearStreamText()
            store.setIsStreaming(false)
            toast.success('Coverage report ready!')
          },
          onError: (msg) => { toast.error(msg); store.setIsStreaming(false) },
          onDone: () => store.setIsStreaming(false),
        },
        abortRef.current.signal,
      )
    } catch { store.setIsStreaming(false) }
  }

  const canSubmit = !!brandName.trim()

  const form = (
    <>
      <h2 className="font-semibold text-sm">Coverage Monitoring</h2>

      <div>
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Brand / Company Name *</label>
        <input value={brandName} onChange={(e) => setBrandName(e.target.value)} placeholder="Acme Corp"
          className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Additional Keywords</label>
          {keywords.length < 5 && (
            <button onClick={addKeyword} className="flex items-center gap-1 text-xs text-primary hover:text-primary/80">
              <Plus className="w-3 h-3" /> Add
            </button>
          )}
        </div>
        <div className="space-y-2">
          {keywords.map((k, i) => (
            <div key={i} className="flex gap-2">
              <input value={k} onChange={(e) => updateKeyword(i, e.target.value)} placeholder={`Keyword ${i + 1} - e.g. product name, CEO name`}
                className="flex-1 px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
              {keywords.length > 1 && <button onClick={() => removeKeyword(i)} className="text-muted-foreground hover:text-destructive"><X className="w-4 h-4" /></button>}
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Time Window</label>
          <select value={daysBack} onChange={(e) => setDaysBack(Number(e.target.value))}
            className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary">
            {[3, 7, 14, 30].map((d) => <option key={d} value={d}>Last {d} days</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Sentiment Filter</label>
          <select value={sentimentFilter} onChange={(e) => setSentimentFilter(e.target.value)}
            className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary">
            <option value="">All sentiments</option>
            <option value="positive">Positive only</option>
            <option value="neutral">Neutral only</option>
            <option value="negative">Negative only</option>
          </select>
        </div>
      </div>

      <div className="flex gap-6">
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={includeNews} onChange={(e) => setIncludeNews(e.target.checked)} className="rounded border-border" />
          <span className="text-xs text-muted-foreground">Scan news (SerpAPI)</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={includeReddit} onChange={(e) => setIncludeReddit(e.target.checked)} className="rounded border-border" />
          <span className="text-xs text-muted-foreground">Scan Reddit (Apify)</span>
        </label>
      </div>
    </>
  )

  const resultNode = result ? (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-sm">{result.brand_name} - {result.days_back} day coverage</h2>
        <span className="text-xs text-muted-foreground">{result.total_raw_mentions} raw mentions</span>
      </div>

      {result.alerts && result.alerts.length > 0 && (
        <div className="space-y-2">
          {result.alerts.map((a, i) => (
            <div key={i} className={cn('p-3 rounded-lg border-l-4', SEVERITY_COLORS[a.severity])}>
              <p className="text-xs font-semibold capitalize">{a.type}</p>
              <p className="text-xs text-muted-foreground">{a.message}</p>
            </div>
          ))}
        </div>
      )}

      <div className="p-4 rounded-xl border border-border bg-card">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Coverage Summary</p>
        <p className="text-sm">{result.coverage_summary}</p>
      </div>

      {result.sentiment_breakdown && (
        <div className="p-4 rounded-xl border border-border bg-card">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Sentiment Breakdown</p>
          <div className="flex gap-3">
            {(Object.entries(result.sentiment_breakdown) as [string, number][]).map(([sentiment, pct]) => (
              <div key={sentiment} className="flex-1 text-center">
                <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium capitalize block', SENTIMENT_COLORS[sentiment])}>{sentiment}</span>
                <p className="text-lg font-bold mt-1">{pct}%</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {result.key_themes && result.key_themes.length > 0 && (
        <div className="p-4 rounded-xl border border-border bg-card">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Key Themes</p>
          <div className="space-y-2">
            {result.key_themes.map((t, i) => (
              <div key={i} className="flex items-center justify-between text-sm">
                <span>{t.theme}</span>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">{t.mention_count} mentions</span>
                  <span className={cn('text-[10px] px-1.5 py-0.5 rounded-full capitalize', SENTIMENT_COLORS[t.sentiment])}>{t.sentiment}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-3">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Top Mentions</p>
        {result.top_mentions?.slice(0, 10).map((m, i) => (
          <div key={i} className="p-4 rounded-xl border border-border bg-card space-y-1">
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm font-medium leading-snug">{m.title}</p>
              <span className={cn('text-[10px] px-1.5 py-0.5 rounded-full capitalize shrink-0', SENTIMENT_COLORS[m.sentiment])}>{m.sentiment}</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>{m.source}</span>
              {m.date && <span>· {m.date}</span>}
              {m.significance === 'high' && <span className="text-orange-500 font-medium">· High significance</span>}
            </div>
            <p className="text-xs text-muted-foreground">{m.snippet}</p>
            {m.url && <a href={m.url} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline">Read more ↗</a>}
          </div>
        ))}
      </div>

      {result.recommended_actions && result.recommended_actions.length > 0 && (
        <div className="p-4 rounded-xl border border-primary/20 bg-primary/5">
          <p className="text-xs font-semibold text-primary uppercase tracking-wide mb-2">Recommended Actions</p>
          <ul className="space-y-1">
            {result.recommended_actions.map((a, i) => (
              <li key={i} className="text-xs text-muted-foreground flex gap-2"><span className="text-primary">•</span>{a}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  ) : null

  return (
    <SSEFeaturePage
      projectId={projectId}
      title="Coverage Monitoring"
      subtitle="Pillar 8 - SerpAPI + Apify + Claude"
      icon={<Eye className="w-4 h-4" />}
      credits={15}
      steps={store.steps}
      isStreaming={store.isStreaming}
      streamText={store.streamText}
      form={form}
      result={resultNode}
      onSubmit={generate}
      submitLabel="Monitor Coverage - 15 credits"
      canSubmit={canSubmit}
      backPath={`/projects/${projectId}/pr-comms`}
    />
  )
}
