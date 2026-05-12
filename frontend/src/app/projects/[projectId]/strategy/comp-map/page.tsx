'use client'

import { useState, useRef } from 'react'
import { useParams } from 'next/navigation'
import { Map } from 'lucide-react'
import { toast } from 'sonner'
import { SSEFeaturePage } from '@/components/pillar1/SSEFeaturePage'
import { api } from '@/lib/api'
import { usePillar1Store } from '@/stores/pillar1-store'
import type { CompMapPayload, ProgressStep } from '@/types'

export default function CompMapPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const store = usePillar1Store()
  const [competitors, setCompetitors] = useState('')
  const [xAxis, setXAxis] = useState('Price')
  const [yAxis, setYAxis] = useState('Features')
  const [result, setResult] = useState<CompMapPayload | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  async function generate() {
    const compList = competitors.split(',').map((s) => s.trim()).filter(Boolean)
    if (compList.length === 0) { toast.error('Enter at least one competitor'); return }
    abortRef.current?.abort()
    abortRef.current = new AbortController()
    store.setIsStreaming(true)
    store.clearSteps()
    store.clearStreamText()
    setResult(null)
    try {
      await api.pillar1.streamCompMap(projectId,
        { competitors: compList, x_axis: xAxis, y_axis: yAxis },
        {
          onStep: (step, label, status) => store.upsertStep(step, label, status as ProgressStep['status']),
          onDelta: (text) => store.appendStreamText(text),
          onSaved: (_id, payload) => { setResult(payload as unknown as CompMapPayload); store.clearStreamText(); store.setIsStreaming(false); toast.success('Positioning map ready!') },
          onError: (msg) => { toast.error(msg); store.setIsStreaming(false) },
          onDone: () => store.setIsStreaming(false),
        },
        abortRef.current.signal,
      )
    } catch { store.setIsStreaming(false) }
  }

  const form = (
    <>
      <h2 className="font-semibold text-sm">Competitive Positioning Map</h2>
      <div>
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Competitors * (comma-separated)</label>
        <input value={competitors} onChange={(e) => setCompetitors(e.target.value)} placeholder="e.g. HubSpot, Mailchimp, Klaviyo"
          className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">X Axis</label>
          <input value={xAxis} onChange={(e) => setXAxis(e.target.value)} placeholder="e.g. Price"
            className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Y Axis</label>
          <input value={yAxis} onChange={(e) => setYAxis(e.target.value)} placeholder="e.g. Features"
            className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
        </div>
      </div>
    </>
  )

  const resultNode = result ? (
    <div className="space-y-4">
      <h2 className="font-semibold text-sm">Positioning Map - {result.x_axis} vs {result.y_axis}</h2>
      {result.white_space && (
        <div className="p-3 rounded-lg bg-primary/10 text-primary text-sm">{result.white_space}</div>
      )}
      {result.competitors?.map((c, i) => (
        <div key={i} className="flex items-center justify-between p-3 rounded-lg border border-border text-sm">
          <div>
            <p className="font-medium">{c.name}</p>
            <p className="text-xs text-muted-foreground">{c.summary}</p>
          </div>
          <div className="text-right text-xs text-muted-foreground">
            <p>X: {c.x} / Y: {c.y}</p>
            {c.threat_level && <p className="text-red-500">{c.threat_level} threat</p>}
          </div>
        </div>
      ))}
      {result.strategic_recommendation && (
        <p className="text-sm text-muted-foreground">{result.strategic_recommendation}</p>
      )}
    </div>
  ) : null

  return (
    <SSEFeaturePage projectId={projectId} title="Positioning Map" subtitle="SerpAPI + Claude"
      icon={<Map className="w-4 h-4" />} credits={35} steps={store.steps}
      isStreaming={store.isStreaming} streamText={store.streamText} form={form} result={resultNode}
      onSubmit={generate} submitLabel="Generate Map - 35 credits" canSubmit={competitors.trim().length > 0} />
  )
}
