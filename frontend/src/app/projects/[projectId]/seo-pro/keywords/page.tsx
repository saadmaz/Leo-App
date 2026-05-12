'use client'

import { useState, useRef } from 'react'
import { useParams } from 'next/navigation'
import { Search } from 'lucide-react'
import { toast } from 'sonner'
import { SSEFeaturePage } from '@/components/pillar1/SSEFeaturePage'
import { api } from '@/lib/api'
import { usePillar3Store } from '@/stores/pillar3-store'
import type { KeywordResearchPayload, ProgressStep } from '@/types'
import { cn } from '@/lib/utils'

const LOCATIONS = [
  { label: 'United States', code: 2840 },
  { label: 'United Kingdom', code: 2826 },
  { label: 'Canada', code: 2124 },
  { label: 'Australia', code: 2036 },
  { label: 'Germany', code: 2276 },
  { label: 'France', code: 2250 },
]

const INTENT_COLORS: Record<string, string> = {
  Informational: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  Navigational: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
  Transactional: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  Commercial: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
}

function DifficultyBar({ score }: { score: number | null }) {
  if (score === null) return <span className="text-xs text-muted-foreground">N/A</span>
  const color = score <= 30 ? 'bg-green-500' : score <= 60 ? 'bg-yellow-500' : 'bg-red-500'
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
        <div className={cn('h-full rounded-full', color)} style={{ width: `${score}%` }} />
      </div>
      <span className="text-xs font-mono">{score}</span>
    </div>
  )
}

export default function KeywordResearchPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const store = usePillar3Store()
  const [seeds, setSeeds] = useState('')
  const [locationCode, setLocationCode] = useState(2840)
  const [limit, setLimit] = useState(50)
  const [result, setResult] = useState<KeywordResearchPayload | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  async function generate() {
    const seedList = seeds.split(',').map((s) => s.trim()).filter(Boolean)
    if (seedList.length === 0) { toast.error('Enter at least one seed keyword'); return }
    abortRef.current?.abort()
    abortRef.current = new AbortController()
    store.setIsStreaming(true)
    store.clearSteps()
    store.clearStreamText()
    setResult(null)
    try {
      await api.pillar3.streamKeywordResearch(projectId,
        { seed_keywords: seedList, location_code: locationCode, language_code: 'en', limit },
        {
          onStep: (step, label, status) => store.upsertStep(step, label, status as ProgressStep['status']),
          onDelta: (text) => store.appendStreamText(text),
          onSaved: (_id, payload) => { setResult(payload as unknown as KeywordResearchPayload); store.clearStreamText(); store.setIsStreaming(false); toast.success('Keyword research ready!') },
          onError: (msg) => { toast.error(msg); store.setIsStreaming(false) },
          onDone: () => store.setIsStreaming(false),
        },
        abortRef.current.signal,
      )
    } catch { store.setIsStreaming(false) }
  }

  const form = (
    <>
      <h2 className="font-semibold text-sm">Keyword Research Engine</h2>
      <div>
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Seed Keywords * (comma-separated)</label>
        <input value={seeds} onChange={(e) => setSeeds(e.target.value)}
          placeholder="e.g. marketing automation, email campaigns, lead nurturing"
          className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Location</label>
          <select value={locationCode} onChange={(e) => setLocationCode(Number(e.target.value))}
            className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary">
            {LOCATIONS.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Results Limit</label>
          <select value={limit} onChange={(e) => setLimit(Number(e.target.value))}
            className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary">
            {[20, 50, 100, 200].map((n) => <option key={n} value={n}>{n} keywords</option>)}
          </select>
        </div>
      </div>
    </>
  )

  const resultNode = result ? (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-sm">Keyword Research Results</h2>
        <span className="text-xs text-muted-foreground">{result.total_found} ideas found</span>
      </div>

      {result.strategy_note && (
        <div className="p-4 rounded-xl border border-border bg-card">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Strategy Overview</p>
          <p className="text-sm text-muted-foreground">{result.strategy_note}</p>
        </div>
      )}

      {result.priority_picks?.length > 0 && (
        <div className="p-4 rounded-xl border border-primary/20 bg-primary/5 space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-primary">Priority Picks</p>
          {result.priority_picks.map((p, i) => <p key={i} className="text-xs">⭐ {p}</p>)}
        </div>
      )}

      {result.keywords?.length > 0 && (
        <div className="rounded-xl border border-border overflow-hidden">
          <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-0 bg-muted px-3 py-2">
            {['Keyword', 'Volume', 'Diff', 'CPC', 'Intent'].map((h) => (
              <p key={h} className="text-xs font-semibold text-muted-foreground">{h}</p>
            ))}
          </div>
          {result.keywords.map((kw, i) => (
            <div key={i} className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-3 px-3 py-2 border-t border-border items-start">
              <div>
                <p className="text-xs font-medium">{kw.keyword}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{kw.content_idea}</p>
              </div>
              <p className="text-xs font-mono text-right">{kw.search_volume?.toLocaleString() ?? '-'}</p>
              <DifficultyBar score={kw.difficulty} />
              <p className="text-xs font-mono">{kw.cpc ? `$${kw.cpc.toFixed(2)}` : '-'}</p>
              <span className={cn('text-[10px] px-1.5 py-0.5 rounded-full font-medium whitespace-nowrap',
                INTENT_COLORS[kw.intent] ?? 'bg-muted text-muted-foreground')}>
                {kw.intent}
              </span>
            </div>
          ))}
        </div>
      )}

      {result.cluster_suggestions?.length > 0 && (
        <div className="p-4 rounded-xl border border-border bg-card space-y-3">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Keyword Clusters</p>
          {result.cluster_suggestions.map((c, i) => (
            <div key={i}>
              <p className="text-xs font-medium mb-1">{c.cluster}</p>
              <div className="flex flex-wrap gap-1">
                {c.keywords.map((kw, j) => (
                  <span key={j} className="text-[10px] px-2 py-0.5 bg-muted rounded-full">{kw}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  ) : null

  return (
    <SSEFeaturePage projectId={projectId} title="Keyword Research" subtitle="DataForSEO + Claude"
      icon={<Search className="w-4 h-4" />} credits={10} steps={store.steps}
      isStreaming={store.isStreaming} streamText={store.streamText} form={form} result={resultNode}
      onSubmit={generate} submitLabel="Research Keywords - 10 credits" canSubmit={!!seeds.trim()} />
  )
}
