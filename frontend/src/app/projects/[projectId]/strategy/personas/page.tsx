'use client'

import { useState, useRef } from 'react'
import { useParams } from 'next/navigation'
import { UserCircle } from 'lucide-react'
import { toast } from 'sonner'
import { SSEFeaturePage } from '@/components/pillar1/SSEFeaturePage'
import { api } from '@/lib/api'
import { usePillar1Store } from '@/stores/pillar1-store'
import type { PersonaPayload, ProgressStep } from '@/types'

export default function PersonasPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const store = usePillar1Store()
  const [segments, setSegments] = useState('')
  const [useApollo, setUseApollo] = useState(true)
  const [result, setResult] = useState<PersonaPayload | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  async function generate() {
    const segList = segments.split(',').map((s) => s.trim()).filter(Boolean)
    if (segList.length === 0) { toast.error('Enter at least one segment name'); return }
    abortRef.current?.abort()
    abortRef.current = new AbortController()
    store.setIsStreaming(true)
    store.clearSteps()
    store.clearStreamText()
    setResult(null)
    try {
      await api.pillar1.streamPersonas(projectId,
        { segment_names: segList, use_apollo: useApollo },
        {
          onStep: (step, label, status) => store.upsertStep(step, label, status as ProgressStep['status']),
          onDelta: (text) => store.appendStreamText(text),
          onSaved: (_id, payload) => { setResult(payload as unknown as PersonaPayload); store.clearStreamText(); store.setIsStreaming(false); toast.success('Personas ready!') },
          onError: (msg) => { toast.error(msg); store.setIsStreaming(false) },
          onDone: () => store.setIsStreaming(false),
        },
        abortRef.current.signal,
      )
    } catch { store.setIsStreaming(false) }
  }

  const form = (
    <>
      <h2 className="font-semibold text-sm">Persona Generation</h2>
      <div>
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Segment Names * (comma-separated)</label>
        <input value={segments} onChange={(e) => setSegments(e.target.value)} placeholder="e.g. SaaS Founders, E-commerce Managers, Marketing Directors"
          className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
      </div>
      <label className="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" checked={useApollo} onChange={(e) => setUseApollo(e.target.checked)} className="rounded" />
        <span className="text-sm">Enrich with Apollo.io data</span>
      </label>
    </>
  )

  const resultNode = result?.personas ? (
    <div className="space-y-4">
      <h2 className="font-semibold text-sm">Buyer Personas</h2>
      {result.personas.map((p, i) => (
        <div key={i} className="p-4 rounded-xl border border-border bg-card space-y-3">
          <div>
            <p className="font-semibold">{p.name}</p>
            {p.archetype && <p className="text-xs text-muted-foreground">{p.archetype}</p>}
          </div>
          {p.a_day_in_their_life && <p className="text-sm text-muted-foreground italic">{p.a_day_in_their_life}</p>}
          {p.goals?.length > 0 && (
            <div>
              <p className="text-xs font-medium mb-1">Goals</p>
              <ul className="text-xs text-muted-foreground space-y-0.5">{p.goals.map((g, j) => <li key={j}>• {g}</li>)}</ul>
            </div>
          )}
          {p.challenges?.length > 0 && (
            <div>
              <p className="text-xs font-medium mb-1">Challenges</p>
              <ul className="text-xs text-muted-foreground space-y-0.5">{p.challenges.map((c, j) => <li key={j}>• {c}</li>)}</ul>
            </div>
          )}
          {p.messaging_angle && <p className="text-xs bg-primary/10 text-primary px-3 py-1.5 rounded-lg">{p.messaging_angle}</p>}
        </div>
      ))}
    </div>
  ) : null

  return (
    <SSEFeaturePage projectId={projectId} title="Persona Generation" subtitle="Apollo.io + Claude"
      icon={<UserCircle className="w-4 h-4" />} credits={25} steps={store.steps}
      isStreaming={store.isStreaming} streamText={store.streamText} form={form} result={resultNode}
      onSubmit={generate} submitLabel="Generate Personas - 25 credits" canSubmit={segments.trim().length > 0} />
  )
}
