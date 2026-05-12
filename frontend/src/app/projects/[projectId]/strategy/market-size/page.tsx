'use client'

import { useState, useRef } from 'react'
import { useParams } from 'next/navigation'
import { BarChart3 } from 'lucide-react'
import { toast } from 'sonner'
import { SSEFeaturePage } from '@/components/pillar1/SSEFeaturePage'
import { api } from '@/lib/api'
import { usePillar1Store } from '@/stores/pillar1-store'
import type { MarketSizingPayload, ProgressStep } from '@/types'

export default function MarketSizePage() {
  const { projectId } = useParams<{ projectId: string }>()
  const store = usePillar1Store()
  const [market, setMarket] = useState('')
  const [geography, setGeography] = useState('Global')
  const [result, setResult] = useState<MarketSizingPayload | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  async function generate() {
    if (!market.trim()) { toast.error('Market description required'); return }
    abortRef.current?.abort()
    abortRef.current = new AbortController()
    store.setIsStreaming(true)
    store.clearSteps()
    store.clearStreamText()
    setResult(null)
    try {
      await api.pillar1.streamMarketSize(projectId,
        { market_description: market.trim(), geography },
        {
          onStep: (step, label, status) => store.upsertStep(step, label, status as ProgressStep['status']),
          onDelta: (text) => store.appendStreamText(text),
          onSaved: (_id, payload) => { setResult(payload as unknown as MarketSizingPayload); store.clearStreamText(); store.setIsStreaming(false); toast.success('Market sizing ready!') },
          onError: (msg) => { toast.error(msg); store.setIsStreaming(false) },
          onDone: () => store.setIsStreaming(false),
        },
        abortRef.current.signal,
      )
    } catch { store.setIsStreaming(false) }
  }

  const form = (
    <>
      <h2 className="font-semibold text-sm">Market Sizing (TAM / SAM / SOM)</h2>
      <div>
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Market Description *</label>
        <textarea value={market} onChange={(e) => setMarket(e.target.value)} rows={2}
          placeholder="e.g. AI-powered marketing automation software for SMBs"
          className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary resize-none" />
      </div>
      <div>
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Geography</label>
        <input value={geography} onChange={(e) => setGeography(e.target.value)} placeholder="e.g. Global, US, Europe"
          className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
      </div>
    </>
  )

  const resultNode = result ? (
    <div className="space-y-4">
      <h2 className="font-semibold text-sm">Market Analysis - {result.geography}</h2>
      {(['tam', 'sam', 'som'] as const).map((key) => {
        const tier = result[key]
        return (
          <div key={key} className="p-4 rounded-xl border border-border bg-card">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{key.toUpperCase()}</span>
              <span className="text-lg font-bold text-primary">{tier.value}</span>
            </div>
            <p className="text-xs text-muted-foreground">{tier.methodology}</p>
          </div>
        )
      })}
      {result.confidence && <p className="text-xs text-muted-foreground">Confidence: {result.confidence}</p>}
    </div>
  ) : null

  return (
    <SSEFeaturePage projectId={projectId} title="Market Sizing" subtitle="SerpAPI × 3 + Claude"
      icon={<BarChart3 className="w-4 h-4" />} credits={40} steps={store.steps}
      isStreaming={store.isStreaming} streamText={store.streamText} form={form} result={resultNode}
      onSubmit={generate} submitLabel="Analyse Market - 40 credits" canSubmit={!!market.trim()} />
  )
}
