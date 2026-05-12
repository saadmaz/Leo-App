'use client'

import { useState, useRef } from 'react'
import { useParams } from 'next/navigation'
import { BarChart2, Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import { SSEFeaturePage } from '@/components/pillar1/SSEFeaturePage'
import { api } from '@/lib/api'
import { usePillar8Store } from '@/stores/pillar8-store'
import type { ProgressStep } from '@/types'
import { cn } from '@/lib/utils'

const BRIEFING_PURPOSES = [
  { id: 'introductory_briefing', label: 'Introductory Briefing' },
  { id: 'product_update', label: 'Product Update' },
  { id: 'inquiry_response', label: 'Inquiry Response' },
  { id: 'market_positioning', label: 'Market Positioning' },
]

const ANALYST_FIRMS = ['Gartner', 'Forrester', 'IDC', 'G2', 'Constellation Research', 'Ovum', 'Other']

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500) }}
      className="text-[10px] text-muted-foreground hover:text-primary px-1.5 py-0.5 rounded border border-border hover:border-primary/50 shrink-0">
      {copied ? 'Copied!' : 'Copy'}
    </button>
  )
}

interface AnalystPayload {
  briefing_title: string
  briefing_purpose: string
  analyst_context: string
  executive_summary: string
  positioning_narrative: string
  key_messages: Array<{ message: string; proof_point: string; evidence_type: string }>
  competitive_positioning: Array<{ vs: string; our_advantage: string; their_advantage: string; messaging_angle: string }>
  likely_analyst_questions: Array<{ question: string; recommended_answer: string; trap_to_avoid?: string }>
  metrics_to_share: Array<{ metric: string; value: string; context: string }>
  roadmap_talking_points: string[]
  desired_outcome_statement: string
  follow_up_actions: string[]
  analyst_firm: string
  company_name: string
  product_name: string
}

export default function AnalystRelationsPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const store = usePillar8Store()

  const [analystFirm, setAnalystFirm] = useState('Gartner')
  const [customFirm, setCustomFirm] = useState('')
  const [analystName, setAnalystName] = useState('')
  const [briefingPurpose, setBriefingPurpose] = useState('introductory_briefing')
  const [companyName, setCompanyName] = useState('')
  const [productName, setProductName] = useState('')
  const [analystUrl, setAnalystUrl] = useState('')
  const [differentiators, setDifferentiators] = useState<string[]>([''])
  const [useCases, setUseCases] = useState<string[]>([''])
  const [tractionMetrics, setTractionMetrics] = useState<string[]>([''])
  const [desiredOutcome, setDesiredOutcome] = useState('')
  const [result, setResult] = useState<AnalystPayload | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  function addItem(list: string[], set: (v: string[]) => void, max = 8) { if (list.length < max) set([...list, '']) }
  function removeItem(i: number, list: string[], set: (v: string[]) => void) { set(list.filter((_, idx) => idx !== i)) }
  function updateItem(i: number, v: string, list: string[], set: (v: string[]) => void) { const n = [...list]; n[i] = v; set(n) }

  async function generate() {
    const firm = analystFirm === 'Other' ? customFirm.trim() : analystFirm
    if (!firm) { toast.error('Enter the analyst firm name'); return }
    if (!companyName.trim()) { toast.error('Enter the company name'); return }
    if (!productName.trim()) { toast.error('Enter the product name'); return }
    if (differentiators.filter(Boolean).length === 0) { toast.error('Add at least one differentiator'); return }
    if (useCases.filter(Boolean).length === 0) { toast.error('Add at least one use case'); return }

    abortRef.current?.abort()
    abortRef.current = new AbortController()
    store.setIsStreaming(true)
    store.clearSteps()
    store.clearStreamText()
    setResult(null)

    try {
      await api.pillar8.streamAnalystBriefing(
        projectId,
        {
          analyst_firm: firm,
          analyst_name: analystName.trim() || undefined,
          briefing_purpose: briefingPurpose,
          company_name: companyName.trim(),
          product_name: productName.trim(),
          analyst_coverage_url: analystUrl.trim() || undefined,
          company_differentiation: differentiators.filter(Boolean),
          target_use_cases: useCases.filter(Boolean),
          traction_metrics: tractionMetrics.filter(Boolean).length > 0 ? tractionMetrics.filter(Boolean) : undefined,
          desired_outcome: desiredOutcome.trim() || undefined,
        },
        {
          onStep: (step, label, status) => store.upsertStep(step, label, status as ProgressStep['status']),
          onDelta: (text) => store.appendStreamText(text),
          onSaved: (_id, payload) => {
            setResult(payload as unknown as AnalystPayload)
            store.clearStreamText()
            store.setIsStreaming(false)
            toast.success('Analyst briefing ready!')
          },
          onError: (msg) => { toast.error(msg); store.setIsStreaming(false) },
          onDone: () => store.setIsStreaming(false),
        },
        abortRef.current.signal,
      )
    } catch { store.setIsStreaming(false) }
  }

  const canSubmit = !!companyName.trim() && !!productName.trim() &&
    differentiators.filter(Boolean).length > 0 && useCases.filter(Boolean).length > 0 &&
    (analystFirm !== 'Other' || !!customFirm.trim())

  const form = (
    <>
      <h2 className="font-semibold text-sm">Analyst Relations</h2>

      <div>
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Analyst Firm *</label>
        <div className="mt-1 flex flex-wrap gap-2">
          {ANALYST_FIRMS.map((f) => (
            <button key={f} onClick={() => setAnalystFirm(f)}
              className={cn('px-3 py-1.5 text-xs rounded-lg border transition-colors',
                analystFirm === f ? 'bg-primary text-primary-foreground border-primary' : 'bg-background border-border hover:border-primary/50')}>
              {f}
            </button>
          ))}
        </div>
        {analystFirm === 'Other' && (
          <input value={customFirm} onChange={(e) => setCustomFirm(e.target.value)} placeholder="Firm name"
            className="mt-2 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
        )}
      </div>

      <div>
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Briefing Purpose *</label>
        <div className="mt-1 flex flex-wrap gap-2">
          {BRIEFING_PURPOSES.map((p) => (
            <button key={p.id} onClick={() => setBriefingPurpose(p.id)}
              className={cn('px-3 py-1.5 text-xs rounded-lg border transition-colors',
                briefingPurpose === p.id ? 'bg-primary text-primary-foreground border-primary' : 'bg-background border-border hover:border-primary/50')}>
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Analyst Name</label>
          <input value={analystName} onChange={(e) => setAnalystName(e.target.value)} placeholder="e.g. Mark Smith"
            className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Company Name *</label>
          <input value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="Acme Corp"
            className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
        </div>
      </div>

      <div>
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Product / Solution Name *</label>
        <input value={productName} onChange={(e) => setProductName(e.target.value)} placeholder="e.g. Acme AI Platform"
          className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
      </div>

      <div>
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Analyst Research URL (Firecrawl reads it)</label>
        <input value={analystUrl} onChange={(e) => setAnalystUrl(e.target.value)} placeholder="https://gartner.com/en/documents/..."
          className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Differentiators *</label>
          {differentiators.length < 8 && <button onClick={() => addItem(differentiators, setDifferentiators)} className="flex items-center gap-1 text-xs text-primary hover:text-primary/80"><Plus className="w-3 h-3" /> Add</button>}
        </div>
        <div className="space-y-2">
          {differentiators.map((d, i) => (
            <div key={i} className="flex gap-2">
              <input value={d} onChange={(e) => updateItem(i, e.target.value, differentiators, setDifferentiators)}
                placeholder="e.g. Only platform with real-time multi-model inference at edge"
                className="flex-1 px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
              {differentiators.length > 1 && <button onClick={() => removeItem(i, differentiators, setDifferentiators)} className="text-muted-foreground hover:text-destructive"><X className="w-4 h-4" /></button>}
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Target Use Cases *</label>
          {useCases.length < 8 && <button onClick={() => addItem(useCases, setUseCases)} className="flex items-center gap-1 text-xs text-primary hover:text-primary/80"><Plus className="w-3 h-3" /> Add</button>}
        </div>
        <div className="space-y-2">
          {useCases.map((u, i) => (
            <div key={i} className="flex gap-2">
              <input value={u} onChange={(e) => updateItem(i, e.target.value, useCases, setUseCases)}
                placeholder="e.g. Financial services compliance automation"
                className="flex-1 px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
              {useCases.length > 1 && <button onClick={() => removeItem(i, useCases, setUseCases)} className="text-muted-foreground hover:text-destructive"><X className="w-4 h-4" /></button>}
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Traction Metrics (optional)</label>
          {tractionMetrics.length < 6 && <button onClick={() => addItem(tractionMetrics, setTractionMetrics, 6)} className="flex items-center gap-1 text-xs text-primary hover:text-primary/80"><Plus className="w-3 h-3" /> Add</button>}
        </div>
        <div className="space-y-2">
          {tractionMetrics.map((t, i) => (
            <div key={i} className="flex gap-2">
              <input value={t} onChange={(e) => updateItem(i, e.target.value, tractionMetrics, setTractionMetrics)}
                placeholder="e.g. 120 enterprise customers, $4M ARR, 98% retention"
                className="flex-1 px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
              {tractionMetrics.length > 1 && <button onClick={() => removeItem(i, tractionMetrics, setTractionMetrics)} className="text-muted-foreground hover:text-destructive"><X className="w-4 h-4" /></button>}
            </div>
          ))}
        </div>
      </div>

      <div>
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Desired Outcome</label>
        <input value={desiredOutcome} onChange={(e) => setDesiredOutcome(e.target.value)}
          placeholder="e.g. Inclusion in next Gartner Magic Quadrant, analyst advisory retainer"
          className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
      </div>
    </>
  )

  const resultNode = result ? (
    <div className="space-y-4">
      <h2 className="font-semibold text-sm">{result.briefing_title}</h2>

      {result.analyst_context && (
        <div className="p-3 rounded-lg bg-muted/50 border border-border text-xs text-muted-foreground">{result.analyst_context}</div>
      )}

      <div className="p-4 rounded-xl border border-border bg-card">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Executive Summary (60-second pitch)</p>
          <CopyButton text={result.executive_summary} />
        </div>
        <p className="text-sm font-medium">{result.executive_summary}</p>
      </div>

      <div className="p-4 rounded-xl border border-border bg-card">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Positioning Narrative</p>
          <CopyButton text={result.positioning_narrative} />
        </div>
        <p className="text-sm whitespace-pre-wrap leading-relaxed">{result.positioning_narrative}</p>
      </div>

      {result.key_messages?.length > 0 && (
        <div className="p-4 rounded-xl border border-border bg-card">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Key Messages with Proof Points</p>
          <div className="space-y-3">
            {result.key_messages.map((m, i) => (
              <div key={i} className="space-y-1">
                <p className="text-sm font-medium">{m.message}</p>
                <p className="text-xs text-muted-foreground">Proof: {m.proof_point}</p>
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary capitalize">{m.evidence_type.replace(/_/g, ' ')}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {result.likely_analyst_questions?.length > 0 && (
        <div className="p-4 rounded-xl border border-border bg-card">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Likely Analyst Questions & Answers</p>
          <div className="space-y-4">
            {result.likely_analyst_questions.map((qa, i) => (
              <div key={i} className="space-y-1.5">
                <p className="text-xs font-medium">Q: {qa.question}</p>
                <div className="flex items-start gap-2">
                  <p className="text-xs text-muted-foreground flex-1">A: {qa.recommended_answer}</p>
                  <CopyButton text={`Q: ${qa.question}\nA: ${qa.recommended_answer}`} />
                </div>
                {qa.trap_to_avoid && (
                  <p className="text-[10px] text-red-500 dark:text-red-400">⚠ Avoid: {qa.trap_to_avoid}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {result.competitive_positioning?.length > 0 && (
        <div className="p-4 rounded-xl border border-border bg-card">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Competitive Positioning</p>
          <div className="space-y-3">
            {result.competitive_positioning.map((c, i) => (
              <div key={i} className="p-3 rounded-lg bg-muted/50 space-y-1">
                <p className="text-xs font-semibold">vs. {c.vs}</p>
                <p className="text-xs text-green-600 dark:text-green-400">✓ Our advantage: {c.our_advantage}</p>
                <p className="text-xs text-muted-foreground">Their strength: {c.their_advantage}</p>
                <p className="text-xs text-primary italic">Messaging angle: {c.messaging_angle}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {result.follow_up_actions?.length > 0 && (
        <div className="p-4 rounded-xl border border-primary/20 bg-primary/5">
          <p className="text-xs font-semibold text-primary uppercase tracking-wide mb-2">Follow-up Actions</p>
          <ul className="space-y-1">
            {result.follow_up_actions.map((a, i) => <li key={i} className="text-xs text-muted-foreground flex gap-2"><span className="text-primary">•</span>{a}</li>)}
          </ul>
        </div>
      )}
    </div>
  ) : null

  return (
    <SSEFeaturePage
      projectId={projectId}
      title="Analyst Relations"
      subtitle="Pillar 8 - Firecrawl + Claude"
      icon={<BarChart2 className="w-4 h-4" />}
      credits={20}
      steps={store.steps}
      isStreaming={store.isStreaming}
      streamText={store.streamText}
      form={form}
      result={resultNode}
      onSubmit={generate}
      submitLabel="Prepare Analyst Briefing - 20 credits"
      canSubmit={canSubmit}
      backPath={`/projects/${projectId}/pr-comms`}
    />
  )
}
