'use client'

import { useState, useRef } from 'react'
import { useParams } from 'next/navigation'
import { Star, Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import { SSEFeaturePage } from '@/components/pillar1/SSEFeaturePage'
import { api } from '@/lib/api'
import { usePillar5Store } from '@/stores/pillar5-store'
import type { ProgressStep } from '@/types'
import { cn } from '@/lib/utils'

const GRADE_STYLES: Record<string, string> = {
  'A+': 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  'A':  'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  'B':  'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
  'C':  'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  'D':  'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
}

interface LeadRow {
  contact_id: string
  email: string
  name: string
  company: string
  job_title: string
  company_size: string
  industry: string
  emails_opened: string
  demo_requested: boolean
  free_trial_started: boolean
  days_since_signup: string
}

interface ScoredLead {
  contact_id: string
  email: string | null
  name: string | null
  company: string | null
  total_score: number
  grade: string
  icp_fit_score: number
  behavioural_score: number
  intent_score: number
  score_rationale: string
  top_positive_signals: string[]
  top_negative_signals: string[]
  recommended_action: string
  next_step: string
  hubspot_lifecycle_recommendation: string
}

interface LeadScoringPayload {
  scoring_model_summary: string
  icp_fit_criteria: string[]
  scoring_breakdown: { icp_fit_weight_pct: number; behavioural_weight_pct: number; intent_weight_pct: number }
  leads: ScoredLead[]
  pipeline_summary: { hot_leads: number; warm_leads: number; cold_leads: number; disqualified: number }
  model_improvement_suggestions: string[]
  hubspot_sync_result?: unknown
}

function newRow(i: number): LeadRow {
  return { contact_id: `lead-${i + 1}`, email: '', name: '', company: '', job_title: '', company_size: '', industry: '', emails_opened: '', demo_requested: false, free_trial_started: false, days_since_signup: '' }
}

function ScoreBar({ value, color }: { value: number; color: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
        <div className={cn('h-full rounded-full', color)} style={{ width: `${value}%` }} />
      </div>
      <span className="text-[10px] font-medium w-6 text-right">{value}</span>
    </div>
  )
}

export default function LeadScoringPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const store = usePillar5Store()

  const [productName, setProductName] = useState('')
  const [icp, setIcp] = useState('')
  const [leads, setLeads] = useState<LeadRow[]>([newRow(0)])
  const [pushToHubspot, setPushToHubspot] = useState(false)
  const [result, setResult] = useState<LeadScoringPayload | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const abortRef = useRef<AbortController | null>(null)

  function addLead() { if (leads.length < 50) setLeads([...leads, newRow(leads.length)]) }
  function removeLead(i: number) { setLeads(leads.filter((_, idx) => idx !== i)) }
  function updateLead(i: number, field: keyof LeadRow, val: string | boolean) {
    const next = [...leads]; next[i] = { ...next[i], [field]: val }; setLeads(next)
  }
  function toggleExpand(id: string) {
    setExpanded((prev) => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s })
  }

  async function generate() {
    if (!productName.trim()) { toast.error('Enter your product name'); return }
    if (!icp.trim()) { toast.error('Describe your Ideal Customer Profile'); return }
    const validLeads = leads.filter((l) => l.contact_id.trim())
    if (validLeads.length === 0) { toast.error('Add at least one lead'); return }

    abortRef.current?.abort(); abortRef.current = new AbortController()
    store.setIsStreaming(true); store.clearSteps(); store.clearStreamText(); setResult(null)

    const payload = validLeads.map((l) => ({
      contact_id: l.contact_id.trim(),
      ...(l.email && { email: l.email }),
      ...(l.name && { name: l.name }),
      ...(l.company && { company: l.company }),
      ...(l.job_title && { job_title: l.job_title }),
      ...(l.company_size && { company_size: l.company_size }),
      ...(l.industry && { industry: l.industry }),
      ...(l.emails_opened && { emails_opened: parseInt(l.emails_opened) }),
      ...(l.demo_requested && { demo_requested: true }),
      ...(l.free_trial_started && { free_trial_started: true }),
      ...(l.days_since_signup && { days_since_signup: parseInt(l.days_since_signup) }),
    }))

    try {
      await api.pillar5.streamLeadScoring(projectId,
        { leads: payload, product_name: productName.trim(), ideal_customer_profile: icp.trim(), push_scores_to_hubspot: pushToHubspot },
        {
          onStep: (s, l, st) => store.upsertStep(s, l, st as ProgressStep['status']),
          onDelta: (t) => store.appendStreamText(t),
          onSaved: (_, p) => { setResult(p as unknown as LeadScoringPayload); store.clearStreamText(); store.setIsStreaming(false); toast.success('Lead scores ready!') },
          onError: (m) => { toast.error(m); store.setIsStreaming(false) },
          onDone: () => store.setIsStreaming(false),
        }, abortRef.current.signal)
    } catch { store.setIsStreaming(false) }
  }

  const form = (
    <>
      <h2 className="font-semibold text-sm">Lead Scoring</h2>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Product Name *</label>
          <input value={productName} onChange={(e) => setProductName(e.target.value)} placeholder="e.g. LEO"
            className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
        </div>
        <div className="flex items-center gap-2 mt-5">
          <input type="checkbox" id="hs-push" checked={pushToHubspot} onChange={(e) => setPushToHubspot(e.target.checked)} className="rounded" />
          <label htmlFor="hs-push" className="text-xs cursor-pointer">Sync scores to HubSpot</label>
        </div>
      </div>
      <div>
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Ideal Customer Profile *</label>
        <textarea value={icp} onChange={(e) => setIcp(e.target.value)} rows={2}
          placeholder="e.g. B2B SaaS companies with 50-500 employees, marketing team of 5+, based in US/EU, annual revenue $5M-$50M"
          className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary resize-none" />
      </div>
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Leads ({leads.length})</label>
          {leads.length < 50 && (
            <button onClick={addLead} className="flex items-center gap-1 text-xs text-primary hover:text-primary/80"><Plus className="w-3 h-3" /> Add lead</button>
          )}
        </div>
        <div className="space-y-3">
          {leads.map((lead, i) => (
            <div key={i} className="p-3 rounded-lg border border-border bg-muted/20 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-semibold text-muted-foreground uppercase">Lead {i + 1}</span>
                {leads.length > 1 && (
                  <button onClick={() => removeLead(i)} className="text-muted-foreground hover:text-destructive transition-colors">
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <input value={lead.contact_id} onChange={(e) => updateLead(i, 'contact_id', e.target.value)} placeholder="Contact ID *"
                  className="px-2 py-1.5 text-xs bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary" />
                <input value={lead.email} onChange={(e) => updateLead(i, 'email', e.target.value)} placeholder="Email"
                  className="px-2 py-1.5 text-xs bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary" />
                <input value={lead.name} onChange={(e) => updateLead(i, 'name', e.target.value)} placeholder="Full name"
                  className="px-2 py-1.5 text-xs bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary" />
                <input value={lead.company} onChange={(e) => updateLead(i, 'company', e.target.value)} placeholder="Company"
                  className="px-2 py-1.5 text-xs bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary" />
                <input value={lead.job_title} onChange={(e) => updateLead(i, 'job_title', e.target.value)} placeholder="Job title"
                  className="px-2 py-1.5 text-xs bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary" />
                <input value={lead.company_size} onChange={(e) => updateLead(i, 'company_size', e.target.value)} placeholder="Company size (e.g. 50-200)"
                  className="px-2 py-1.5 text-xs bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary" />
                <input value={lead.industry} onChange={(e) => updateLead(i, 'industry', e.target.value)} placeholder="Industry"
                  className="px-2 py-1.5 text-xs bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary" />
                <input value={lead.emails_opened} onChange={(e) => updateLead(i, 'emails_opened', e.target.value)} placeholder="Emails opened" type="number" min="0"
                  className="px-2 py-1.5 text-xs bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary" />
                <input value={lead.days_since_signup} onChange={(e) => updateLead(i, 'days_since_signup', e.target.value)} placeholder="Days since signup" type="number" min="0"
                  className="px-2 py-1.5 text-xs bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary" />
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-1.5 text-[10px] cursor-pointer">
                    <input type="checkbox" checked={lead.demo_requested} onChange={(e) => updateLead(i, 'demo_requested', e.target.checked)} className="rounded" />
                    Demo req.
                  </label>
                  <label className="flex items-center gap-1.5 text-[10px] cursor-pointer">
                    <input type="checkbox" checked={lead.free_trial_started} onChange={(e) => updateLead(i, 'free_trial_started', e.target.checked)} className="rounded" />
                    Trial started
                  </label>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  )

  const resultNode = result ? (
    <div className="space-y-4">
      {result.scoring_model_summary && (
        <p className="text-sm text-muted-foreground">{result.scoring_model_summary}</p>
      )}

      {result.pipeline_summary && (
        <div className="grid grid-cols-4 gap-2">
          {[
            { label: 'Hot', value: result.pipeline_summary.hot_leads, color: 'text-red-500' },
            { label: 'Warm', value: result.pipeline_summary.warm_leads, color: 'text-orange-500' },
            { label: 'Cold', value: result.pipeline_summary.cold_leads, color: 'text-blue-500' },
            { label: 'DQ', value: result.pipeline_summary.disqualified, color: 'text-muted-foreground' },
          ].map((s) => (
            <div key={s.label} className="p-3 rounded-xl border border-border bg-card text-center">
              <p className={cn('text-lg font-bold', s.color)}>{s.value}</p>
              <p className="text-[10px] text-muted-foreground">{s.label}</p>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-3">
        {result.leads?.sort((a, b) => b.total_score - a.total_score).map((lead) => {
          const isOpen = expanded.has(lead.contact_id)
          return (
            <div key={lead.contact_id} className="rounded-xl border border-border bg-card overflow-hidden">
              <button
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors text-left"
                onClick={() => toggleExpand(lead.contact_id)}
              >
                <span className={cn('w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold shrink-0', GRADE_STYLES[lead.grade] ?? 'bg-muted text-muted-foreground')}>
                  {lead.grade}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium truncate">{lead.name || lead.email || lead.contact_id}</p>
                  {lead.company && <p className="text-[10px] text-muted-foreground">{lead.company}</p>}
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <div className="text-right">
                    <p className="text-sm font-bold">{lead.total_score}</p>
                    <p className="text-[10px] text-muted-foreground">/ 100</p>
                  </div>
                </div>
              </button>

              {isOpen && (
                <div className="px-4 pb-4 space-y-3 border-t border-border pt-3">
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                      <span>ICP Fit</span><span></span>
                    </div>
                    <ScoreBar value={lead.icp_fit_score} color="bg-blue-500" />
                    <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                      <span>Behavioural</span><span></span>
                    </div>
                    <ScoreBar value={lead.behavioural_score} color="bg-purple-500" />
                    <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                      <span>Intent</span><span></span>
                    </div>
                    <ScoreBar value={lead.intent_score} color="bg-primary" />
                  </div>

                  <p className="text-xs text-muted-foreground">{lead.score_rationale}</p>

                  <div className="grid grid-cols-2 gap-3">
                    {lead.top_positive_signals?.length > 0 && (
                      <div>
                        <p className="text-[10px] font-semibold text-green-600 dark:text-green-400 mb-1">Positive signals</p>
                        {lead.top_positive_signals.map((s, i) => (
                          <p key={i} className="text-[10px] text-muted-foreground">+ {s}</p>
                        ))}
                      </div>
                    )}
                    {lead.top_negative_signals?.length > 0 && (
                      <div>
                        <p className="text-[10px] font-semibold text-red-600 dark:text-red-400 mb-1">Negative signals</p>
                        {lead.top_negative_signals.map((s, i) => (
                          <p key={i} className="text-[10px] text-muted-foreground">– {s}</p>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="p-2.5 rounded-lg bg-primary/5 border border-primary/20">
                    <p className="text-[10px] font-semibold text-primary mb-0.5">Recommended action</p>
                    <p className="text-xs">{lead.recommended_action}</p>
                  </div>

                  {lead.next_step && (
                    <div className="p-2.5 rounded-lg bg-muted/50 border border-border">
                      <p className="text-[10px] font-semibold text-muted-foreground mb-0.5">Next step</p>
                      <p className="text-xs">{lead.next_step}</p>
                    </div>
                  )}

                  {lead.hubspot_lifecycle_recommendation && (
                    <p className="text-[10px] text-muted-foreground">
                      HubSpot lifecycle: <span className="font-medium capitalize">{lead.hubspot_lifecycle_recommendation.replace(/_/g, ' ')}</span>
                    </p>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {result.icp_fit_criteria?.length > 0 && (
        <div className="p-4 rounded-xl border border-border bg-card space-y-1">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">ICP Criteria Used</p>
          {result.icp_fit_criteria.map((c, i) => <p key={i} className="text-xs text-muted-foreground">• {c}</p>)}
        </div>
      )}

      {result.model_improvement_suggestions?.length > 0 && (
        <div className="p-4 rounded-xl border border-primary/20 bg-primary/5 space-y-1">
          <p className="text-xs font-semibold text-primary uppercase tracking-wide mb-1">Improve This Model</p>
          {result.model_improvement_suggestions.map((s, i) => <p key={i} className="text-xs text-muted-foreground">• {s}</p>)}
        </div>
      )}
    </div>
  ) : null

  const canSubmit = !!productName.trim() && !!icp.trim() && leads.some((l) => l.contact_id.trim())

  return (
    <SSEFeaturePage projectId={projectId} title="Lead Scoring" subtitle="Pillar 5 - Claude + HubSpot"
      icon={<Star className="w-4 h-4" />} credits={20} steps={store.steps}
      isStreaming={store.isStreaming} streamText={store.streamText} form={form} result={resultNode}
      onSubmit={generate} submitLabel="Score Leads - 20 credits" canSubmit={canSubmit}
      backPath={`/projects/${projectId}/email-crm`} />
  )
}
