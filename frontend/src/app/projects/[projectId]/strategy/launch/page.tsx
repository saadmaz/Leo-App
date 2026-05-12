'use client'

import { useState, useRef } from 'react'
import { useParams } from 'next/navigation'
import { Rocket } from 'lucide-react'
import { toast } from 'sonner'
import { SSEFeaturePage } from '@/components/pillar1/SSEFeaturePage'
import { api } from '@/lib/api'
import { usePillar1Store } from '@/stores/pillar1-store'
import type { LaunchPayload, ProgressStep } from '@/types'

const CHANNEL_OPTIONS = ['Instagram', 'LinkedIn', 'Email', 'Google Ads', 'Meta Ads', 'TikTok', 'PR', 'SEO']

export default function LaunchPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const store = usePillar1Store()
  const [productName, setProductName] = useState('')
  const [launchDate, setLaunchDate] = useState('')
  const [channels, setChannels] = useState<string[]>(['Instagram', 'Email'])
  const [result, setResult] = useState<LaunchPayload | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  function toggleChannel(ch: string) {
    setChannels((prev) => prev.includes(ch) ? prev.filter((c) => c !== ch) : [...prev, ch])
  }

  async function generate() {
    if (!productName.trim() || !launchDate || channels.length === 0) { toast.error('Product name, launch date, and channels required'); return }
    abortRef.current?.abort()
    abortRef.current = new AbortController()
    store.setIsStreaming(true)
    store.clearSteps()
    store.clearStreamText()
    setResult(null)
    try {
      await api.pillar1.streamLaunch(projectId,
        { product_name: productName.trim(), launch_date: launchDate, channels },
        {
          onStep: (step, label, status) => store.upsertStep(step, label, status as ProgressStep['status']),
          onDelta: (text) => store.appendStreamText(text),
          onSaved: (_id, payload) => { setResult(payload as unknown as LaunchPayload); store.clearStreamText(); store.setIsStreaming(false); toast.success('Launch plan ready!') },
          onError: (msg) => { toast.error(msg); store.setIsStreaming(false) },
          onDone: () => store.setIsStreaming(false),
        },
        abortRef.current.signal,
      )
    } catch { store.setIsStreaming(false) }
  }

  const form = (
    <>
      <h2 className="font-semibold text-sm">Launch Planning</h2>
      <div>
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Product / Campaign Name *</label>
        <input value={productName} onChange={(e) => setProductName(e.target.value)} placeholder="e.g. Leo Pro Launch"
          className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
      </div>
      <div>
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Launch Date *</label>
        <input type="date" value={launchDate} onChange={(e) => setLaunchDate(e.target.value)}
          className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
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
      <h2 className="font-semibold text-sm">Launch Plan - {result.product_name}</h2>
      {result.phases?.map((phase, i) => (
        <div key={i} className="p-4 rounded-xl border border-border bg-card space-y-2">
          <div className="flex items-center justify-between">
            <p className="font-semibold text-sm">{phase.phase}</p>
            {phase.weeks && <span className="text-xs text-muted-foreground">{phase.weeks}</span>}
          </div>
          {phase.goal && <p className="text-xs text-muted-foreground">{phase.goal}</p>}
          {phase.milestones?.length > 0 && (
            <ul className="text-xs text-muted-foreground space-y-0.5">
              {phase.milestones.map((m, j) => <li key={j}>• {m}</li>)}
            </ul>
          )}
        </div>
      ))}
      {result.budget_guidance && <p className="text-sm text-muted-foreground">{result.budget_guidance}</p>}
    </div>
  ) : null

  return (
    <SSEFeaturePage projectId={projectId} title="Launch Planning" subtitle="Claude"
      icon={<Rocket className="w-4 h-4" />} credits={20} steps={store.steps}
      isStreaming={store.isStreaming} streamText={store.streamText} form={form} result={resultNode}
      onSubmit={generate} submitLabel="Generate Launch Plan - 20 credits"
      canSubmit={!!productName.trim() && !!launchDate && channels.length > 0} />
  )
}
