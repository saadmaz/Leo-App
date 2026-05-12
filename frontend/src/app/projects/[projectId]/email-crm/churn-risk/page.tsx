'use client'

import { useState, useRef } from 'react'
import { useParams } from 'next/navigation'
import { AlertTriangle, Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import { SSEFeaturePage } from '@/components/pillar1/SSEFeaturePage'
import { api } from '@/lib/api'
import { usePillar5Store } from '@/stores/pillar5-store'
import type { ProgressStep } from '@/types'
import { cn } from '@/lib/utils'

interface ContactRow {
  contact_id: string
  email: string
  name: string
  last_login_days_ago: string
  last_email_open_days_ago: string
  sessions_last_30d: string
  features_used_last_30d: string
  plan: string
}

interface ChurnContact {
  contact_id: string
  email: string | null
  name: string | null
  risk_score: number
  risk_level: string
  churn_probability_pct: number
  risk_factors: string[]
  positive_signals: string[]
  recommended_action: string
  intervention_urgency: string
  win_back_email?: { subject: string; preview_text: string; body: string } | null
}

interface ChurnPayload {
  analysis_summary: string
  cohort_stats: { total_contacts: number; high_risk_count: number; medium_risk_count: number; low_risk_count: number; healthy_count: number; average_risk_score: number }
  contacts: ChurnContact[]
  top_churn_signals: string[]
  retention_playbook: { segment: string; action: string; timing: string; owner: string }[]
  early_warning_indicators: string[]
}

const RISK_COLORS: Record<string, string> = {
  high: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  medium: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
  low: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  healthy: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
}

const URGENCY_COLORS: Record<string, string> = {
  immediate: 'text-red-600 dark:text-red-400 font-semibold',
  this_week: 'text-orange-500 dark:text-orange-400',
  this_month: 'text-yellow-600 dark:text-yellow-400',
  monitor: 'text-muted-foreground',
}

function CopyBtn({ text }: { text: string }) {
  const [c, setC] = useState(false)
  return (
    <button onClick={() => { navigator.clipboard.writeText(text); setC(true); setTimeout(() => setC(false), 1500) }}
      className="text-[10px] px-2 py-0.5 rounded border border-border hover:border-primary/50 hover:text-primary transition-colors text-muted-foreground shrink-0">
      {c ? 'Copied!' : 'Copy'}
    </button>
  )
}

const EMPTY_ROW = (): ContactRow => ({ contact_id: '', email: '', name: '', last_login_days_ago: '', last_email_open_days_ago: '', sessions_last_30d: '', features_used_last_30d: '', plan: '' })

export default function ChurnRiskPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const store = usePillar5Store()

  const [productName, setProductName] = useState('')
  const [contacts, setContacts] = useState<ContactRow[]>([EMPTY_ROW()])
  const [winBack, setWinBack] = useState(true)
  const [result, setResult] = useState<ChurnPayload | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  function addRow() { setContacts([...contacts, EMPTY_ROW()]) }
  function removeRow(i: number) { setContacts(contacts.filter((_, idx) => idx !== i)) }
  function updateRow(i: number, field: keyof ContactRow, val: string) {
    const next = [...contacts]; next[i] = { ...next[i], [field]: val }; setContacts(next)
  }

  async function generate() {
    if (!productName.trim()) { toast.error('Enter a product name'); return }
    const valid = contacts.filter(c => c.contact_id.trim())
    if (valid.length === 0) { toast.error('Add at least one contact with an ID'); return }

    abortRef.current?.abort(); abortRef.current = new AbortController()
    store.setIsStreaming(true); store.clearSteps(); store.clearStreamText(); setResult(null)

    const contactPayload = valid.map(c => ({
      contact_id: c.contact_id.trim(),
      email: c.email.trim() || undefined,
      name: c.name.trim() || undefined,
      last_login_days_ago: c.last_login_days_ago ? parseInt(c.last_login_days_ago) : undefined,
      last_email_open_days_ago: c.last_email_open_days_ago ? parseInt(c.last_email_open_days_ago) : undefined,
      sessions_last_30d: c.sessions_last_30d ? parseInt(c.sessions_last_30d) : undefined,
      features_used_last_30d: c.features_used_last_30d ? parseInt(c.features_used_last_30d) : undefined,
      plan: c.plan.trim() || undefined,
    }))

    try {
      await api.pillar5.streamChurnRisk(projectId,
        { contacts: contactPayload, product_name: productName.trim(), win_back_sequence: winBack },
        {
          onStep: (s, l, st) => store.upsertStep(s, l, st as ProgressStep['status']),
          onDelta: (t) => store.appendStreamText(t),
          onSaved: (_, p) => { setResult(p as unknown as ChurnPayload); store.clearStreamText(); store.setIsStreaming(false); toast.success('Churn risk analysis ready!') },
          onError: (m) => { toast.error(m); store.setIsStreaming(false) },
          onDone: () => store.setIsStreaming(false),
        }, abortRef.current.signal)
    } catch { store.setIsStreaming(false) }
  }

  const form = (
    <>
      <h2 className="font-semibold text-sm">Churn Risk Detection</h2>
      <div className="flex items-end gap-3">
        <div className="flex-1">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Product *</label>
          <input value={productName} onChange={(e) => setProductName(e.target.value)} placeholder="e.g. LEO"
            className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
        </div>
        <div className="flex items-center gap-2 pb-2">
          <input type="checkbox" id="wb" checked={winBack} onChange={(e) => setWinBack(e.target.checked)} className="rounded" />
          <label htmlFor="wb" className="text-xs cursor-pointer whitespace-nowrap">Generate win-back emails</label>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Contacts *</label>
          <button onClick={addRow} className="flex items-center gap-1 text-xs text-primary hover:text-primary/80">
            <Plus className="w-3 h-3" /> Add contact
          </button>
        </div>
        <div className="space-y-2">
          {contacts.map((c, i) => (
            <div key={i} className="p-3 rounded-lg border border-border bg-muted/30 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium">Contact {i + 1}</span>
                {contacts.length > 1 && (
                  <button onClick={() => removeRow(i)} className="text-muted-foreground hover:text-destructive transition-colors">
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              <div className="grid grid-cols-3 gap-2">
                <input value={c.contact_id} onChange={(e) => updateRow(i, 'contact_id', e.target.value)} placeholder="ID *"
                  className="px-2 py-1.5 text-xs bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary" />
                <input value={c.email} onChange={(e) => updateRow(i, 'email', e.target.value)} placeholder="Email"
                  className="px-2 py-1.5 text-xs bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary" />
                <input value={c.name} onChange={(e) => updateRow(i, 'name', e.target.value)} placeholder="Name"
                  className="px-2 py-1.5 text-xs bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary" />
              </div>
              <div className="grid grid-cols-4 gap-2">
                <input value={c.last_login_days_ago} onChange={(e) => updateRow(i, 'last_login_days_ago', e.target.value)}
                  placeholder="Last login (days)" type="number" min="0"
                  className="px-2 py-1.5 text-xs bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary" />
                <input value={c.last_email_open_days_ago} onChange={(e) => updateRow(i, 'last_email_open_days_ago', e.target.value)}
                  placeholder="Last open (days)" type="number" min="0"
                  className="px-2 py-1.5 text-xs bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary" />
                <input value={c.sessions_last_30d} onChange={(e) => updateRow(i, 'sessions_last_30d', e.target.value)}
                  placeholder="Sessions/30d" type="number" min="0"
                  className="px-2 py-1.5 text-xs bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary" />
                <input value={c.plan} onChange={(e) => updateRow(i, 'plan', e.target.value)} placeholder="Plan"
                  className="px-2 py-1.5 text-xs bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary" />
              </div>
            </div>
          ))}
        </div>
        <p className="text-[10px] text-muted-foreground mt-1">Leave numeric fields blank if unknown. Paste CSV data or add rows manually.</p>
      </div>
    </>
  )

  const resultNode = result ? (
    <div className="space-y-4">
      <p className="text-sm">{result.analysis_summary}</p>

      {result.cohort_stats && (
        <div className="grid grid-cols-5 gap-2">
          {[
            { label: 'Total', value: result.cohort_stats.total_contacts, color: '' },
            { label: 'High Risk', value: result.cohort_stats.high_risk_count, color: 'text-red-600 dark:text-red-400' },
            { label: 'Medium', value: result.cohort_stats.medium_risk_count, color: 'text-yellow-600 dark:text-yellow-400' },
            { label: 'Low Risk', value: result.cohort_stats.low_risk_count, color: 'text-blue-600 dark:text-blue-400' },
            { label: 'Healthy', value: result.cohort_stats.healthy_count, color: 'text-green-600 dark:text-green-400' },
          ].map((s) => (
            <div key={s.label} className="p-3 rounded-xl border border-border bg-card text-center">
              <p className={cn('text-lg font-bold', s.color)}>{s.value}</p>
              <p className="text-[10px] text-muted-foreground">{s.label}</p>
            </div>
          ))}
        </div>
      )}

      {result.contacts?.map((contact, i) => (
        <div key={i} className="rounded-xl border border-border bg-card overflow-hidden">
          <button
            onClick={() => setExpandedId(expandedId === contact.contact_id ? null : contact.contact_id)}
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/30 transition-colors">
            <div className="flex items-center gap-3">
              <span className="text-xs font-medium">{contact.name || contact.email || contact.contact_id}</span>
              <span className={cn('text-[10px] px-2 py-0.5 rounded-full font-medium capitalize', RISK_COLORS[contact.risk_level] ?? 'bg-muted text-muted-foreground')}>
                {contact.risk_level}
              </span>
            </div>
            <div className="flex items-center gap-3 text-xs">
              <span className="text-muted-foreground">Risk: <span className="font-bold text-foreground">{contact.risk_score}/100</span></span>
              <span className={cn('capitalize text-[10px]', URGENCY_COLORS[contact.intervention_urgency] ?? '')}>{contact.intervention_urgency?.replace(/_/g, ' ')}</span>
            </div>
          </button>

          {expandedId === contact.contact_id && (
            <div className="border-t border-border p-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-[10px] font-semibold text-red-500 uppercase mb-1">Risk Factors</p>
                  {contact.risk_factors?.map((r, j) => <p key={j} className="text-xs text-muted-foreground">• {r}</p>)}
                </div>
                <div>
                  <p className="text-[10px] font-semibold text-green-500 uppercase mb-1">Positive Signals</p>
                  {contact.positive_signals?.map((p, j) => <p key={j} className="text-xs text-muted-foreground">• {p}</p>)}
                </div>
              </div>
              <div className="p-3 rounded-lg bg-primary/5 border border-primary/20">
                <p className="text-[10px] font-semibold text-primary uppercase mb-1">Recommended Action</p>
                <p className="text-xs">{contact.recommended_action}</p>
              </div>
              {contact.win_back_email && (
                <div className="space-y-2">
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase">Win-Back Email</p>
                  <div className="flex items-center gap-2">
                    <p className="text-xs font-medium">Subject: {contact.win_back_email.subject}</p>
                    <CopyBtn text={contact.win_back_email.subject} />
                  </div>
                  <div className="bg-muted/40 rounded-lg p-3">
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <p className="text-[10px] text-muted-foreground">Body</p>
                      <CopyBtn text={contact.win_back_email.body} />
                    </div>
                    <p className="text-xs whitespace-pre-wrap">{contact.win_back_email.body}</p>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      ))}

      {result.top_churn_signals?.length > 0 && (
        <div className="p-4 rounded-xl border border-border bg-card space-y-1">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Top Churn Signals Across Cohort</p>
          {result.top_churn_signals.map((s, i) => <p key={i} className="text-xs text-muted-foreground">• {s}</p>)}
        </div>
      )}

      {result.retention_playbook?.length > 0 && (
        <div className="p-4 rounded-xl border border-border bg-card space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Retention Playbook</p>
          {result.retention_playbook.map((p, i) => (
            <div key={i} className="text-xs grid grid-cols-[1fr_1fr_auto_auto] gap-2 items-center">
              <span className="font-medium">{p.segment}</span>
              <span className="text-muted-foreground">{p.action}</span>
              <span className="text-muted-foreground">{p.timing}</span>
              <span className="text-[10px] px-1.5 py-0.5 bg-muted rounded-full">{p.owner}</span>
            </div>
          ))}
        </div>
      )}

      {result.early_warning_indicators?.length > 0 && (
        <div className="p-4 rounded-xl border border-yellow-200/50 bg-yellow-50/50 dark:bg-yellow-900/10 dark:border-yellow-900/30 space-y-1">
          <p className="text-xs font-semibold text-yellow-600 dark:text-yellow-400 uppercase tracking-wide mb-1">Early Warning Indicators to Monitor</p>
          {result.early_warning_indicators.map((s, i) => <p key={i} className="text-xs text-muted-foreground">• {s}</p>)}
        </div>
      )}
    </div>
  ) : null

  return (
    <SSEFeaturePage projectId={projectId} title="Churn Risk Detection" subtitle="Pillar 5 - Claude"
      icon={<AlertTriangle className="w-4 h-4" />} credits={20} steps={store.steps}
      isStreaming={store.isStreaming} streamText={store.streamText} form={form} result={resultNode}
      onSubmit={generate} submitLabel="Analyse Churn Risk - 20 credits"
      canSubmit={!!productName.trim() && contacts.some(c => c.contact_id.trim())}
      backPath={`/projects/${projectId}/email-crm`} />
  )
}
