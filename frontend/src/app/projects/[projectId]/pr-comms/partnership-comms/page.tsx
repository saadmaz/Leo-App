'use client'

import { useState, useRef } from 'react'
import { useParams } from 'next/navigation'
import { Handshake } from 'lucide-react'
import { toast } from 'sonner'
import { SSEFeaturePage } from '@/components/pillar1/SSEFeaturePage'
import { api } from '@/lib/api'
import { usePillar8Store } from '@/stores/pillar8-store'
import type { ProgressStep } from '@/types'
import { cn } from '@/lib/utils'

const COMMS_TYPES = [
  { id: 'initial_outreach', label: 'Initial Outreach' },
  { id: 'proposal', label: 'Partnership Proposal' },
  { id: 'announcement_draft', label: 'Announcement Draft' },
  { id: 'joint_press_release', label: 'Joint Press Release' },
]

const PARTNERSHIP_TYPES = [
  'technology integration',
  'co-marketing',
  'reseller',
  'strategic alliance',
  'OEM',
  'channel partner',
]

const TONES = ['professional', 'warm', 'bold']

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500) }}
      className="text-[10px] text-muted-foreground hover:text-primary px-1.5 py-0.5 rounded border border-border hover:border-primary/50 shrink-0">
      {copied ? 'Copied!' : 'Copy'}
    </button>
  )
}

interface PartnershipPayload {
  comms_type: string
  document_title: string
  primary_document: string
  subject_line?: string
  value_proposition_summary: { for_us: string; for_partner: string; combined_market_opportunity: string }
  key_messages: string[]
  partnership_terms_outline?: Array<{ term: string; description: string }>
  follow_up_sequence: Array<{ timing: string; action: string; template: string }>
  objection_handling: Array<{ objection: string; response: string }>
  success_metrics: string[]
  tone_notes: string
  your_company: string
  partner_company: string
}

export default function PartnershipCommsPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const store = usePillar8Store()

  const [commsType, setCommsType] = useState('initial_outreach')
  const [yourCompany, setYourCompany] = useState('')
  const [partnerCompany, setPartnerCompany] = useState('')
  const [partnershipType, setPartnershipType] = useState('technology integration')
  const [valueProposition, setValueProposition] = useState('')
  const [keyAsk, setKeyAsk] = useState('')
  const [partnerContactName, setPartnerContactName] = useState('')
  const [partnerContactTitle, setPartnerContactTitle] = useState('')
  const [tone, setTone] = useState('professional')
  const [includeTerms, setIncludeTerms] = useState(false)
  const [result, setResult] = useState<PartnershipPayload | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  async function generate() {
    if (!yourCompany.trim()) { toast.error('Enter your company name'); return }
    if (!partnerCompany.trim()) { toast.error('Enter the partner company name'); return }
    if (!valueProposition.trim()) { toast.error('Describe the value proposition'); return }

    abortRef.current?.abort()
    abortRef.current = new AbortController()
    store.setIsStreaming(true)
    store.clearSteps()
    store.clearStreamText()
    setResult(null)

    try {
      await api.pillar8.streamPartnershipComms(
        projectId,
        {
          comms_type: commsType,
          your_company: yourCompany.trim(),
          partner_company: partnerCompany.trim(),
          partnership_type: partnershipType,
          value_proposition: valueProposition.trim(),
          key_ask: keyAsk.trim() || undefined,
          partner_contact_name: partnerContactName.trim() || undefined,
          partner_contact_title: partnerContactTitle.trim() || undefined,
          tone,
          include_terms_outline: includeTerms,
        },
        {
          onStep: (step, label, status) => store.upsertStep(step, label, status as ProgressStep['status']),
          onDelta: (text) => store.appendStreamText(text),
          onSaved: (_id, payload) => {
            setResult(payload as unknown as PartnershipPayload)
            store.clearStreamText()
            store.setIsStreaming(false)
            toast.success('Partnership communication ready!')
          },
          onError: (msg) => { toast.error(msg); store.setIsStreaming(false) },
          onDone: () => store.setIsStreaming(false),
        },
        abortRef.current.signal,
      )
    } catch { store.setIsStreaming(false) }
  }

  const canSubmit = !!yourCompany.trim() && !!partnerCompany.trim() && !!valueProposition.trim()

  const form = (
    <>
      <h2 className="font-semibold text-sm">Partnership Communications</h2>

      <div>
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Communication Type *</label>
        <div className="mt-1 flex flex-wrap gap-2">
          {COMMS_TYPES.map((t) => (
            <button key={t.id} onClick={() => setCommsType(t.id)}
              className={cn('px-3 py-1.5 text-xs rounded-lg border transition-colors',
                commsType === t.id ? 'bg-primary text-primary-foreground border-primary' : 'bg-background border-border hover:border-primary/50')}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Your Company *</label>
          <input value={yourCompany} onChange={(e) => setYourCompany(e.target.value)} placeholder="Acme Corp"
            className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Partner Company *</label>
          <input value={partnerCompany} onChange={(e) => setPartnerCompany(e.target.value)} placeholder="Partner Corp"
            className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
        </div>
      </div>

      <div>
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Partnership Type *</label>
        <div className="mt-1 flex flex-wrap gap-2">
          {PARTNERSHIP_TYPES.map((t) => (
            <button key={t} onClick={() => setPartnershipType(t)}
              className={cn('px-3 py-1.5 text-xs rounded-lg border transition-colors capitalize',
                partnershipType === t ? 'bg-primary text-primary-foreground border-primary' : 'bg-background border-border hover:border-primary/50')}>
              {t}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Value Proposition *</label>
        <textarea value={valueProposition} onChange={(e) => setValueProposition(e.target.value)} rows={3}
          placeholder="What does each side get from this partnership? e.g. We bring 500 SMB customers they can upsell; they bring enterprise distribution we can't afford alone."
          className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary resize-none" />
      </div>

      <div>
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Key Ask</label>
        <input value={keyAsk} onChange={(e) => setKeyAsk(e.target.value)}
          placeholder="e.g. 30-minute introductory call, pilot programme agreement, co-marketing commitment"
          className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Partner Contact Name</label>
          <input value={partnerContactName} onChange={(e) => setPartnerContactName(e.target.value)} placeholder="Alex Johnson"
            className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Their Title</label>
          <input value={partnerContactTitle} onChange={(e) => setPartnerContactTitle(e.target.value)} placeholder="VP Partnerships"
            className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
        </div>
      </div>

      <div className="flex items-center justify-between">
        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Tone</label>
          <div className="mt-1 flex gap-1.5">
            {TONES.map((t) => (
              <button key={t} onClick={() => setTone(t)}
                className={cn('px-2.5 py-1 text-xs rounded-lg border transition-colors capitalize',
                  tone === t ? 'bg-primary text-primary-foreground border-primary' : 'bg-background border-border hover:border-primary/50')}>
                {t}
              </button>
            ))}
          </div>
        </div>
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={includeTerms} onChange={(e) => setIncludeTerms(e.target.checked)} className="rounded border-border" />
          <span className="text-xs text-muted-foreground">Include terms outline</span>
        </label>
      </div>
    </>
  )

  const resultNode = result ? (
    <div className="space-y-4">
      <h2 className="font-semibold text-sm">{result.document_title}</h2>

      {result.subject_line && (
        <div className="p-3 rounded-lg border border-border bg-card flex items-center justify-between gap-2">
          <div>
            <p className="text-[10px] font-semibold text-muted-foreground uppercase">Subject Line</p>
            <p className="text-sm font-medium">{result.subject_line}</p>
          </div>
          <CopyButton text={result.subject_line} />
        </div>
      )}

      <div className="p-4 rounded-xl border border-border bg-card">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            {result.comms_type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
          </p>
          <CopyButton text={result.primary_document} />
        </div>
        <pre className="text-sm whitespace-pre-wrap font-sans leading-relaxed">{result.primary_document}</pre>
      </div>

      {result.value_proposition_summary && (
        <div className="p-4 rounded-xl border border-border bg-card">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Value Proposition</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800">
              <p className="text-[10px] font-semibold text-green-700 dark:text-green-400 uppercase mb-1">For {result.your_company}</p>
              <p className="text-xs">{result.value_proposition_summary.for_us}</p>
            </div>
            <div className="p-3 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
              <p className="text-[10px] font-semibold text-blue-700 dark:text-blue-400 uppercase mb-1">For {result.partner_company}</p>
              <p className="text-xs">{result.value_proposition_summary.for_partner}</p>
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-2">{result.value_proposition_summary.combined_market_opportunity}</p>
        </div>
      )}

      {result.objection_handling?.length > 0 && (
        <div className="p-4 rounded-xl border border-border bg-card">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Objection Handling</p>
          <div className="space-y-3">
            {result.objection_handling.map((o, i) => (
              <div key={i} className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">Objection: {o.objection}</p>
                <p className="text-xs">Response: {o.response}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {result.follow_up_sequence?.length > 0 && (
        <div className="p-4 rounded-xl border border-border bg-card">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Follow-up Sequence</p>
          <div className="space-y-3">
            {result.follow_up_sequence.map((f, i) => (
              <div key={i} className="p-3 rounded-lg bg-muted/50 space-y-1">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium">{f.timing}</p>
                  <span className="text-xs text-muted-foreground capitalize">{f.action}</span>
                </div>
                <p className="text-xs text-muted-foreground italic">{f.template}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {result.partnership_terms_outline && result.partnership_terms_outline.length > 0 && (
        <div className="p-4 rounded-xl border border-border bg-card">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Partnership Terms Outline</p>
          <div className="space-y-2">
            {result.partnership_terms_outline.map((t, i) => (
              <div key={i} className="flex gap-3">
                <p className="text-xs font-medium min-w-[120px]">{t.term}</p>
                <p className="text-xs text-muted-foreground">{t.description}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {result.success_metrics?.length > 0 && (
        <div className="p-4 rounded-xl border border-primary/20 bg-primary/5">
          <p className="text-xs font-semibold text-primary uppercase tracking-wide mb-2">Partnership Success Metrics</p>
          <ul className="space-y-1">
            {result.success_metrics.map((m, i) => <li key={i} className="text-xs text-muted-foreground flex gap-2"><span className="text-primary">•</span>{m}</li>)}
          </ul>
        </div>
      )}
    </div>
  ) : null

  return (
    <SSEFeaturePage
      projectId={projectId}
      title="Partnership Communications"
      subtitle="Pillar 8 - Claude"
      icon={<Handshake className="w-4 h-4" />}
      credits={10}
      steps={store.steps}
      isStreaming={store.isStreaming}
      streamText={store.streamText}
      form={form}
      result={resultNode}
      onSubmit={generate}
      submitLabel="Draft Partnership Comms - 10 credits"
      canSubmit={canSubmit}
      backPath={`/projects/${projectId}/pr-comms`}
    />
  )
}
