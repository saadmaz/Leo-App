'use client'

import { useState, useRef } from 'react'
import { useParams } from 'next/navigation'
import { Users } from 'lucide-react'
import { toast } from 'sonner'
import { SSEFeaturePage } from '@/components/pillar1/SSEFeaturePage'
import { api } from '@/lib/api'
import { usePillar1Store } from '@/stores/pillar1-store'
import type { ICPPayload, ProgressStep } from '@/types'

export default function ICPPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const store = usePillar1Store()

  const [region, setRegion] = useState('Global')
  const [useApollo, setUseApollo] = useState(true)
  const [manualSegments, setManualSegments] = useState('')
  const [result, setResult] = useState<ICPPayload | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  async function generate() {
    abortRef.current?.abort()
    abortRef.current = new AbortController()
    store.setIsStreaming(true)
    store.clearSteps()
    store.clearStreamText()
    setResult(null)

    try {
      await api.pillar1.streamICP(
        projectId,
        {
          target_region: region,
          use_apollo: useApollo,
          manual_segments: manualSegments.split(',').map((s) => s.trim()).filter(Boolean),
        },
        {
          onStep: (step, label, status) =>
            store.upsertStep(step, label, status as ProgressStep['status']),
          onDelta: (text) => store.appendStreamText(text),
          onSaved: (_docId, payload) => {
            setResult(payload as unknown as ICPPayload)
            store.clearStreamText()
            store.setIsStreaming(false)
            toast.success('ICP segments ready!')
          },
          onError: (msg) => {
            toast.error(msg)
            store.setIsStreaming(false)
          },
          onDone: () => store.setIsStreaming(false),
        },
        abortRef.current.signal,
      )
    } catch (err: unknown) {
      if ((err as Error)?.name !== 'AbortError') toast.error('ICP generation failed')
      store.setIsStreaming(false)
    }
  }

  const form = (
    <>
      <h2 className="font-semibold text-sm">ICP Builder</h2>
      <div>
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Target Region</label>
        <input
          value={region}
          onChange={(e) => setRegion(e.target.value)}
          placeholder="e.g. Global, US, UK, APAC"
          className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>
      <div>
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Segment Hints (optional, comma-separated)</label>
        <input
          value={manualSegments}
          onChange={(e) => setManualSegments(e.target.value)}
          placeholder="e.g. SaaS Founders, E-commerce Managers"
          className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>
      <label className="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" checked={useApollo} onChange={(e) => setUseApollo(e.target.checked)} className="rounded" />
        <span className="text-sm">Enrich with Apollo.io data</span>
      </label>
    </>
  )

  const resultNode = result?.segments ? (
    <div className="space-y-4">
      <h2 className="font-semibold text-sm">ICP Segments</h2>
      {result.segments.map((seg, i) => (
        <div key={i} className="p-4 rounded-xl border border-border bg-card space-y-3">
          <p className="font-semibold text-sm">{seg.name}</p>
          <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
            {Object.entries(seg.firmographics || {}).map(([k, v]) => (
              <div key={k}><span className="font-medium text-foreground">{k}:</span> {v}</div>
            ))}
          </div>
          {seg.buying_signals?.length > 0 && (
            <div>
              <p className="text-xs font-medium mb-1">Buying Signals</p>
              <ul className="text-xs text-muted-foreground space-y-0.5">
                {seg.buying_signals.map((s, j) => <li key={j}>• {s}</li>)}
              </ul>
            </div>
          )}
          {seg.psychographics?.pain_points?.length > 0 && (
            <div>
              <p className="text-xs font-medium mb-1">Pain Points</p>
              <ul className="text-xs text-muted-foreground space-y-0.5">
                {seg.psychographics.pain_points.map((p, j) => <li key={j}>• {p}</li>)}
              </ul>
            </div>
          )}
        </div>
      ))}
      {result.summary && <p className="text-sm text-muted-foreground italic">{result.summary}</p>}
    </div>
  ) : null

  return (
    <SSEFeaturePage
      projectId={projectId}
      title="ICP Builder"
      subtitle="Apollo.io + Claude"
      icon={<Users className="w-4 h-4" />}
      credits={40}
      steps={store.steps}
      isStreaming={store.isStreaming}
      streamText={store.streamText}
      form={form}
      result={resultNode}
      onSubmit={generate}
      submitLabel="Build ICP - 40 credits"
      canSubmit={true}
    />
  )
}
