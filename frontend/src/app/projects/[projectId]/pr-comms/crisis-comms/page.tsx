'use client'

import { useState, useRef } from 'react'
import { useParams } from 'next/navigation'
import { AlertTriangle, Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import { SSEFeaturePage } from '@/components/pillar1/SSEFeaturePage'
import { api } from '@/lib/api'
import { usePillar8Store } from '@/stores/pillar8-store'
import type { ProgressStep } from '@/types'
import { cn } from '@/lib/utils'

const CRISIS_TYPES = [
  { id: 'data_breach', label: 'Data Breach' },
  { id: 'product_recall', label: 'Product Recall' },
  { id: 'executive_misconduct', label: 'Executive Misconduct' },
  { id: 'negative_press', label: 'Negative Press' },
  { id: 'social_backlash', label: 'Social Backlash' },
  { id: 'regulatory_action', label: 'Regulatory Action' },
]

const SEVERITY_LEVELS = [
  { id: 'low', label: 'Low', color: 'border-muted-foreground/30 text-muted-foreground' },
  { id: 'medium', label: 'Medium', color: 'border-yellow-500 text-yellow-600 dark:text-yellow-400' },
  { id: 'high', label: 'High', color: 'border-orange-500 text-orange-600 dark:text-orange-400' },
  { id: 'critical', label: 'Critical', color: 'border-red-500 text-red-600 dark:text-red-400' },
]

const PRIORITY_COLORS: Record<string, string> = {
  immediate: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  '24h': 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  '48h': 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
  week: 'bg-muted text-muted-foreground',
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500) }}
      className="text-[10px] text-muted-foreground hover:text-primary px-1.5 py-0.5 rounded border border-border hover:border-primary/50 shrink-0">
      {copied ? 'Copied!' : 'Copy'}
    </button>
  )
}

const STAKEHOLDER_OPTIONS = ['customers', 'media', 'employees', 'investors', 'partners', 'regulators', 'board']

interface CrisisPayload {
  crisis_assessment: {
    severity_confirmed: string
    reputational_risk: string
    legal_risk_note: string
    time_sensitivity: string
    do_not_say: string[]
  }
  holding_statement: string
  stakeholder_statements: Array<{ stakeholder: string; channel: string; statement: string; key_messages: string[]; tone_guidance: string }>
  internal_faq: Array<{ question: string; answer: string }>
  action_checklist: Array<{ priority: string; action: string; owner?: string }>
  media_q_and_a: Array<{ question: string; answer: string }>
  recovery_roadmap: string
}

export default function CrisisCommsPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const store = usePillar8Store()

  const [crisisType, setCrisisType] = useState('data_breach')
  const [crisisSummary, setCrisisSummary] = useState('')
  const [severity, setSeverity] = useState('medium')
  const [companyName, setCompanyName] = useState('')
  const [stakeholders, setStakeholders] = useState<string[]>(['customers', 'media', 'employees'])
  const [responseSoFar, setResponseSoFar] = useState('')
  const [confirmedFacts, setConfirmedFacts] = useState<string[]>([''])
  const [unknownFacts, setUnknownFacts] = useState<string[]>([''])
  const [spokespersonName, setSpokespersonName] = useState('')
  const [spokespersonTitle, setSpokespersonTitle] = useState('')
  const [result, setResult] = useState<CrisisPayload | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  function addFact(list: string[], setList: (v: string[]) => void) { if (list.length < 8) setList([...list, '']) }
  function removeFact(i: number, list: string[], setList: (v: string[]) => void) { setList(list.filter((_, idx) => idx !== i)) }
  function updateFact(i: number, v: string, list: string[], setList: (v: string[]) => void) { const n = [...list]; n[i] = v; setList(n) }
  function toggleStakeholder(s: string) {
    setStakeholders((prev) => prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s])
  }

  async function generate() {
    if (!crisisSummary.trim()) { toast.error('Describe the crisis'); return }
    if (!companyName.trim()) { toast.error('Enter the company name'); return }
    if (stakeholders.length === 0) { toast.error('Select at least one stakeholder group'); return }

    abortRef.current?.abort()
    abortRef.current = new AbortController()
    store.setIsStreaming(true)
    store.clearSteps()
    store.clearStreamText()
    setResult(null)

    try {
      await api.pillar8.streamCrisisComms(
        projectId,
        {
          crisis_type: crisisType,
          crisis_summary: crisisSummary.trim(),
          severity,
          affected_stakeholders: stakeholders,
          company_name: companyName.trim(),
          company_response_so_far: responseSoFar.trim() || undefined,
          facts_confirmed: confirmedFacts.filter(Boolean).length > 0 ? confirmedFacts.filter(Boolean) : undefined,
          facts_unknown: unknownFacts.filter(Boolean).length > 0 ? unknownFacts.filter(Boolean) : undefined,
          spokesperson_name: spokespersonName.trim() || undefined,
          spokesperson_title: spokespersonTitle.trim() || undefined,
        },
        {
          onStep: (step, label, status) => store.upsertStep(step, label, status as ProgressStep['status']),
          onDelta: (text) => store.appendStreamText(text),
          onSaved: (_id, payload) => {
            setResult(payload as unknown as CrisisPayload)
            store.clearStreamText()
            store.setIsStreaming(false)
            toast.success('Crisis playbook ready!')
          },
          onError: (msg) => { toast.error(msg); store.setIsStreaming(false) },
          onDone: () => store.setIsStreaming(false),
        },
        abortRef.current.signal,
      )
    } catch { store.setIsStreaming(false) }
  }

  const canSubmit = !!crisisSummary.trim() && !!companyName.trim() && stakeholders.length > 0
  const selectedSeverity = SEVERITY_LEVELS.find((s) => s.id === severity)

  const form = (
    <>
      <h2 className="font-semibold text-sm">Crisis Communications</h2>
      <p className="text-xs text-muted-foreground">Not legal advice - always consult your legal team for high-severity situations.</p>

      <div>
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Crisis Type *</label>
        <div className="mt-1 flex flex-wrap gap-2">
          {CRISIS_TYPES.map((t) => (
            <button key={t.id} onClick={() => setCrisisType(t.id)}
              className={cn('px-3 py-1.5 text-xs rounded-lg border transition-colors',
                crisisType === t.id ? 'bg-primary text-primary-foreground border-primary' : 'bg-background border-border hover:border-primary/50')}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Company Name *</label>
          <input value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="Acme Corp"
            className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Severity *</label>
          <div className="mt-1 flex gap-1.5">
            {SEVERITY_LEVELS.map((s) => (
              <button key={s.id} onClick={() => setSeverity(s.id)}
                className={cn('flex-1 py-1.5 text-xs rounded-lg border-2 transition-colors font-medium',
                  severity === s.id ? `${s.color} bg-muted/50` : 'border-border text-muted-foreground hover:border-muted-foreground/50')}>
                {s.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div>
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Crisis Summary *</label>
        <textarea value={crisisSummary} onChange={(e) => setCrisisSummary(e.target.value)} rows={3}
          placeholder="Describe what happened - be factual and specific. The more detail you provide, the more accurate the response."
          className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary resize-none" />
      </div>

      <div>
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Affected Stakeholders *</label>
        <div className="mt-1 flex flex-wrap gap-2">
          {STAKEHOLDER_OPTIONS.map((s) => (
            <button key={s} onClick={() => toggleStakeholder(s)}
              className={cn('px-3 py-1.5 text-xs rounded-lg border transition-colors capitalize',
                stakeholders.includes(s) ? 'bg-primary text-primary-foreground border-primary' : 'bg-background border-border hover:border-primary/50')}>
              {s}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Response Given So Far</label>
        <textarea value={responseSoFar} onChange={(e) => setResponseSoFar(e.target.value)} rows={2}
          placeholder="Any statement, social post, or internal comms already sent"
          className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary resize-none" />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Confirmed Facts</label>
            <button onClick={() => addFact(confirmedFacts, setConfirmedFacts)} className="text-xs text-primary hover:text-primary/80 flex items-center gap-1">
              <Plus className="w-3 h-3" /> Add
            </button>
          </div>
          <div className="space-y-2">
            {confirmedFacts.map((f, i) => (
              <div key={i} className="flex gap-2">
                <input value={f} onChange={(e) => updateFact(i, e.target.value, confirmedFacts, setConfirmedFacts)}
                  placeholder="Confirmed fact…"
                  className="flex-1 px-3 py-1.5 text-xs bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
                {confirmedFacts.length > 1 && <button onClick={() => removeFact(i, confirmedFacts, setConfirmedFacts)} className="text-muted-foreground hover:text-destructive"><X className="w-3.5 h-3.5" /></button>}
              </div>
            ))}
          </div>
        </div>
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Still Under Investigation</label>
            <button onClick={() => addFact(unknownFacts, setUnknownFacts)} className="text-xs text-primary hover:text-primary/80 flex items-center gap-1">
              <Plus className="w-3 h-3" /> Add
            </button>
          </div>
          <div className="space-y-2">
            {unknownFacts.map((f, i) => (
              <div key={i} className="flex gap-2">
                <input value={f} onChange={(e) => updateFact(i, e.target.value, unknownFacts, setUnknownFacts)}
                  placeholder="Unknown / investigating…"
                  className="flex-1 px-3 py-1.5 text-xs bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
                {unknownFacts.length > 1 && <button onClick={() => removeFact(i, unknownFacts, setUnknownFacts)} className="text-muted-foreground hover:text-destructive"><X className="w-3.5 h-3.5" /></button>}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Spokesperson Name</label>
          <input value={spokespersonName} onChange={(e) => setSpokespersonName(e.target.value)} placeholder="Jane Smith"
            className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Their Title</label>
          <input value={spokespersonTitle} onChange={(e) => setSpokespersonTitle(e.target.value)} placeholder="CEO"
            className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
        </div>
      </div>
    </>
  )

  const resultNode = result ? (
    <div className="space-y-4">
      {result.crisis_assessment && (
        <div className={cn('p-4 rounded-xl border-2',
          result.crisis_assessment.severity_confirmed === 'critical' ? 'border-red-500 bg-red-50 dark:bg-red-900/20' :
          result.crisis_assessment.severity_confirmed === 'high' ? 'border-orange-500 bg-orange-50 dark:bg-orange-900/20' :
          'border-border bg-card')}>
          <p className="text-xs font-bold uppercase tracking-wide mb-2">
            Crisis Assessment - <span className="capitalize">{result.crisis_assessment.severity_confirmed}</span> Severity
          </p>
          <p className="text-xs text-muted-foreground mb-1">{result.crisis_assessment.reputational_risk}</p>
          <p className="text-xs text-muted-foreground mb-2">{result.crisis_assessment.time_sensitivity}</p>
          {result.crisis_assessment.do_not_say?.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold text-red-600 uppercase mb-1">Do NOT say:</p>
              <ul className="space-y-0.5">
                {result.crisis_assessment.do_not_say.map((d, i) => (
                  <li key={i} className="text-xs text-red-600 dark:text-red-400 flex gap-1.5"><span>✗</span>{d}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {result.holding_statement && (
        <div className="p-4 rounded-xl border border-border bg-card">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Holding Statement (use within 24h)</p>
            <CopyButton text={result.holding_statement} />
          </div>
          <p className="text-sm font-medium italic">"{result.holding_statement}"</p>
        </div>
      )}

      {result.stakeholder_statements?.map((s, i) => (
        <div key={i} className="p-4 rounded-xl border border-border bg-card space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold capitalize">{s.stakeholder}</span>
              <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded capitalize">{s.channel}</span>
            </div>
            <CopyButton text={s.statement} />
          </div>
          <pre className="text-sm whitespace-pre-wrap font-sans leading-relaxed">{s.statement}</pre>
          {s.key_messages?.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold text-muted-foreground uppercase mb-1">Key Messages</p>
              <ul className="space-y-0.5">
                {s.key_messages.map((m, j) => <li key={j} className="text-xs text-muted-foreground flex gap-1.5"><span className="text-primary">•</span>{m}</li>)}
              </ul>
            </div>
          )}
        </div>
      ))}

      {result.action_checklist?.length > 0 && (
        <div className="p-4 rounded-xl border border-border bg-card">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Action Checklist</p>
          <div className="space-y-2">
            {result.action_checklist.map((item, i) => (
              <div key={i} className="flex items-start gap-2">
                <span className={cn('text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0 capitalize', PRIORITY_COLORS[item.priority])}>{item.priority}</span>
                <div className="flex-1">
                  <p className="text-xs">{item.action}</p>
                  {item.owner && <p className="text-[10px] text-muted-foreground">Owner: {item.owner}</p>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {result.media_q_and_a?.length > 0 && (
        <div className="p-4 rounded-xl border border-border bg-card">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Media Q&A</p>
          <div className="space-y-3">
            {result.media_q_and_a.map((qa, i) => (
              <div key={i} className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">Q: {qa.question}</p>
                <div className="flex items-start gap-2">
                  <p className="text-xs flex-1">A: {qa.answer}</p>
                  <CopyButton text={`Q: ${qa.question}\nA: ${qa.answer}`} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {result.internal_faq?.length > 0 && (
        <div className="p-4 rounded-xl border border-border bg-card">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Internal FAQ</p>
          <div className="space-y-3">
            {result.internal_faq.map((faq, i) => (
              <div key={i} className="space-y-1">
                <p className="text-xs font-medium">{faq.question}</p>
                <p className="text-xs text-muted-foreground">{faq.answer}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {result.recovery_roadmap && (
        <div className="p-4 rounded-xl border border-primary/20 bg-primary/5">
          <p className="text-xs font-semibold text-primary uppercase tracking-wide mb-2">Recovery Roadmap</p>
          <p className="text-sm whitespace-pre-wrap">{result.recovery_roadmap}</p>
        </div>
      )}
    </div>
  ) : null

  return (
    <SSEFeaturePage
      projectId={projectId}
      title="Crisis Communications"
      subtitle="Pillar 8 - Claude"
      icon={<AlertTriangle className="w-4 h-4" />}
      credits={20}
      steps={store.steps}
      isStreaming={store.isStreaming}
      streamText={store.streamText}
      form={form}
      result={resultNode}
      onSubmit={generate}
      submitLabel="Generate Crisis Playbook - 20 credits"
      canSubmit={canSubmit}
      backPath={`/projects/${projectId}/pr-comms`}
    />
  )
}
