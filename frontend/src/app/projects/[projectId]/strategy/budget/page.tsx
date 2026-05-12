'use client'

import { useState, useRef } from 'react'
import { useParams } from 'next/navigation'
import { DollarSign } from 'lucide-react'
import { toast } from 'sonner'
import { SSEFeaturePage } from '@/components/pillar1/SSEFeaturePage'
import { api } from '@/lib/api'
import { usePillar1Store } from '@/stores/pillar1-store'
import type { BudgetPayload, ProgressStep } from '@/types'

const CHANNEL_OPTIONS = ['Meta Ads', 'Google Ads', 'LinkedIn Ads', 'TikTok Ads', 'SEO/Content', 'Email', 'Influencer', 'PR']

export default function BudgetPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const store = usePillar1Store()
  const [totalBudget, setTotalBudget] = useState('')
  const [duration, setDuration] = useState(3)
  const [channels, setChannels] = useState<string[]>(['Meta Ads', 'Google Ads', 'SEO/Content'])
  const [result, setResult] = useState<BudgetPayload | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  function toggleChannel(ch: string) {
    setChannels((prev) => prev.includes(ch) ? prev.filter((c) => c !== ch) : [...prev, ch])
  }

  async function generate() {
    if (!totalBudget || channels.length === 0) { toast.error('Budget and at least one channel required'); return }
    abortRef.current?.abort()
    abortRef.current = new AbortController()
    store.setIsStreaming(true)
    store.clearSteps()
    store.clearStreamText()
    setResult(null)
    try {
      await api.pillar1.streamBudget(projectId,
        { total_budget: Number(totalBudget), duration_months: duration, channels },
        {
          onStep: (step, label, status) => store.upsertStep(step, label, status as ProgressStep['status']),
          onDelta: (text) => store.appendStreamText(text),
          onSaved: (_id, payload) => { setResult(payload as unknown as BudgetPayload); store.clearStreamText(); store.setIsStreaming(false); toast.success('Budget model ready!') },
          onError: (msg) => { toast.error(msg); store.setIsStreaming(false) },
          onDone: () => store.setIsStreaming(false),
        },
        abortRef.current.signal,
      )
    } catch { store.setIsStreaming(false) }
  }

  const form = (
    <>
      <h2 className="font-semibold text-sm">Budget Modelling</h2>
      <div>
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Total Budget (USD) *</label>
        <input type="number" value={totalBudget} onChange={(e) => setTotalBudget(e.target.value)} placeholder="e.g. 10000"
          className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
      </div>
      <div>
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Duration</label>
        <select value={duration} onChange={(e) => setDuration(Number(e.target.value))}
          className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary">
          {[1, 2, 3, 6, 12].map((n) => <option key={n} value={n}>{n} month{n > 1 ? 's' : ''}</option>)}
        </select>
      </div>
      <div>
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2 block">Channels *</label>
        <div className="flex flex-wrap gap-2">
          {CHANNEL_OPTIONS.map((ch) => (
            <button key={ch} onClick={() => toggleChannel(ch)}
              className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${channels.includes(ch) ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground hover:border-primary'}`}>
              {ch}
            </button>
          ))}
        </div>
      </div>
    </>
  )

  const resultNode = result ? (
    <div className="space-y-4">
      <h2 className="font-semibold text-sm">Budget Model - ${Number(result.total_budget).toLocaleString()} / {result.duration_months}mo</h2>
      {result.allocations?.map((a, i) => (
        <div key={i} className="flex items-center justify-between p-3 rounded-lg border border-border text-sm">
          <div>
            <p className="font-medium">{a.channel}</p>
            <p className="text-xs text-muted-foreground">{a.rationale}</p>
          </div>
          <div className="text-right">
            <p className="font-semibold text-primary">{a.percentage}%</p>
            <p className="text-xs text-muted-foreground">${a.amount.toLocaleString()}</p>
          </div>
        </div>
      ))}
      {result.summary && <p className="text-sm text-muted-foreground italic">{result.summary}</p>}
    </div>
  ) : null

  return (
    <SSEFeaturePage projectId={projectId} title="Budget Modelling" subtitle="Claude + Meta Ads benchmarks"
      icon={<DollarSign className="w-4 h-4" />} credits={30} steps={store.steps}
      isStreaming={store.isStreaming} streamText={store.streamText} form={form} result={resultNode}
      onSubmit={generate} submitLabel="Model Budget - 30 credits" canSubmit={!!totalBudget && channels.length > 0} />
  )
}
