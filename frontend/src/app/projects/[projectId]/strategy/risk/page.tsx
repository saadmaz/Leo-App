'use client'

import { useState, useRef } from 'react'
import { useParams } from 'next/navigation'
import { Shield, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import { SSEFeaturePage } from '@/components/pillar1/SSEFeaturePage'
import { api } from '@/lib/api'
import { usePillar1Store } from '@/stores/pillar1-store'
import type { RiskPayload, ProgressStep } from '@/types'
import { cn } from '@/lib/utils'

const SEVERITY_COLORS: Record<string, string> = {
  critical: 'bg-red-500/10 text-red-600 border-red-200',
  high: 'bg-orange-500/10 text-orange-600 border-orange-200',
  medium: 'bg-yellow-500/10 text-yellow-600 border-yellow-200',
  low: 'bg-blue-500/10 text-blue-600 border-blue-200',
}

export default function RiskPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const store = usePillar1Store()
  const [keywords, setKeywords] = useState('')
  const [includeCompetitors, setIncludeCompetitors] = useState(true)
  const [result, setResult] = useState<RiskPayload | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  async function generate() {
    abortRef.current?.abort()
    abortRef.current = new AbortController()
    store.setIsStreaming(true)
    store.clearSteps()
    store.clearStreamText()
    setResult(null)
    try {
      await api.pillar1.streamRiskScan(projectId,
        {
          keywords: keywords.split(',').map((s) => s.trim()).filter(Boolean),
          include_competitor_signals: includeCompetitors,
        },
        {
          onStep: (step, label, status) => store.upsertStep(step, label, status as ProgressStep['status']),
          onSaved: (_id, payload) => { setResult(payload as unknown as RiskPayload); store.clearStreamText(); store.setIsStreaming(false); toast.success('Risk scan complete!') },
          onError: (msg) => { toast.error(msg); store.setIsStreaming(false) },
          onDone: () => store.setIsStreaming(false),
        },
        abortRef.current.signal,
      )
    } catch { store.setIsStreaming(false) }
  }

  const form = (
    <>
      <h2 className="font-semibold text-sm">Risk Flagging</h2>
      <div>
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Custom Keywords (optional, comma-separated)</label>
        <input value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="e.g. AI regulation, data privacy law"
          className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
      </div>
      <label className="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" checked={includeCompetitors} onChange={(e) => setIncludeCompetitors(e.target.checked)} className="rounded" />
        <span className="text-sm">Include competitor aggression signals</span>
      </label>
    </>
  )

  const resultNode = result ? (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-sm">Risk Report</h2>
        <div className="flex gap-2 text-xs">
          <span className="px-2 py-0.5 rounded-full bg-red-500/10 text-red-600">{result.scan_summary.critical} critical</span>
          <span className="px-2 py-0.5 rounded-full bg-orange-500/10 text-orange-600">{result.scan_summary.high} high</span>
        </div>
      </div>
      {result.risks.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-6">No significant risks detected at this time.</p>
      ) : result.risks.map((risk, i) => (
        <div key={i} className={cn('p-4 rounded-xl border bg-card space-y-2', SEVERITY_COLORS[risk.severity])}>
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <p className="font-semibold text-sm">{risk.title}</p>
            </div>
            <span className="text-xs font-medium uppercase">{risk.severity}</span>
          </div>
          <p className="text-xs">{risk.description}</p>
          {risk.recommended_action && (
            <p className="text-xs font-medium">Action: {risk.recommended_action}</p>
          )}
        </div>
      ))}
    </div>
  ) : null

  return (
    <SSEFeaturePage projectId={projectId} title="Risk Flagging" subtitle="Monitoring + SerpAPI + Claude"
      icon={<Shield className="w-4 h-4" />} credits={30} steps={store.steps}
      isStreaming={store.isStreaming} streamText={store.streamText} form={form} result={resultNode}
      onSubmit={generate} submitLabel="Run Risk Scan - 30 credits" canSubmit={true} />
  )
}
