'use client'

import { useState, useRef } from 'react'
import { useParams } from 'next/navigation'
import { TrendingUp } from 'lucide-react'
import { toast } from 'sonner'
import { SSEFeaturePage } from '@/components/pillar1/SSEFeaturePage'
import { api } from '@/lib/api'
import { usePillar1Store } from '@/stores/pillar1-store'
import type { ProgressStep } from '@/types'

export default function GTMPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const store = usePillar1Store()
  const [productName, setProductName] = useState('')
  const [budget, setBudget] = useState('')
  const [launchDate, setLaunchDate] = useState('')
  const [result, setResult] = useState<Record<string, unknown> | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  async function generate() {
    if (!productName.trim()) { toast.error('Product name is required'); return }
    abortRef.current?.abort()
    abortRef.current = new AbortController()
    store.setIsStreaming(true)
    store.clearSteps()
    store.clearStreamText()
    setResult(null)
    try {
      await api.pillar1.streamGTM(projectId,
        { product_name: productName.trim(), budget: budget.trim() || undefined, launch_date: launchDate || undefined },
        {
          onStep: (step, label, status) => store.upsertStep(step, label, status as ProgressStep['status']),
          onDelta: (text) => store.appendStreamText(text),
          onSaved: (_id, payload) => { setResult(payload); store.clearStreamText(); store.setIsStreaming(false); toast.success('GTM strategy ready!') },
          onError: (msg) => { toast.error(msg); store.setIsStreaming(false) },
          onDone: () => store.setIsStreaming(false),
        },
        abortRef.current.signal,
      )
    } catch { store.setIsStreaming(false) }
  }

  const form = (
    <>
      <h2 className="font-semibold text-sm">GTM Strategy</h2>
      <div>
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Product / Service Name *</label>
        <input value={productName} onChange={(e) => setProductName(e.target.value)} placeholder="e.g. Leo AI Marketing Platform"
          className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
      </div>
      <div>
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Budget (optional)</label>
        <input value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="e.g. $10,000/month"
          className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
      </div>
      <div>
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Target Launch Date (optional)</label>
        <input type="date" value={launchDate} onChange={(e) => setLaunchDate(e.target.value)}
          className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
      </div>
    </>
  )

  const resultNode = result ? (
    <div className="space-y-4">
      <h2 className="font-semibold text-sm">GTM Strategy</h2>
      {(result.executive_summary as string) && <p className="text-sm text-muted-foreground">{result.executive_summary as string}</p>}
      {(result.channel_mix as unknown[])?.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Channel Mix</p>
          {(result.channel_mix as { channel: string; role: string; budget_pct: number }[]).map((c, i) => (
            <div key={i} className="flex items-start justify-between p-3 rounded-lg border border-border text-sm">
              <div><p className="font-medium">{c.channel}</p><p className="text-xs text-muted-foreground">{c.role}</p></div>
              <span className="text-primary font-semibold">{c.budget_pct}%</span>
            </div>
          ))}
        </div>
      )}
    </div>
  ) : null

  return (
    <SSEFeaturePage projectId={projectId} title="GTM Strategy" subtitle="SerpAPI + Firecrawl + Claude"
      icon={<TrendingUp className="w-4 h-4" />} credits={35} steps={store.steps}
      isStreaming={store.isStreaming} streamText={store.streamText} form={form} result={resultNode}
      onSubmit={generate} submitLabel="Generate GTM Strategy - 35 credits" canSubmit={!!productName.trim()} />
  )
}
