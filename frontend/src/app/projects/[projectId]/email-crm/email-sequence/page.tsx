'use client'

import { useState, useRef } from 'react'
import { useParams } from 'next/navigation'
import { Mail } from 'lucide-react'
import { toast } from 'sonner'
import { SSEFeaturePage } from '@/components/pillar1/SSEFeaturePage'
import { api } from '@/lib/api'
import { usePillar5Store } from '@/stores/pillar5-store'
import type { ProgressStep } from '@/types'
import { cn } from '@/lib/utils'

const GOALS = ['onboarding', 'nurture', 're-engagement', 'upsell', 'trial-to-paid', 'post-purchase', 'win-back']
const TONES = ['conversational', 'professional', 'warm', 'urgent']

interface EmailItem {
  email_number: number
  send_delay: string
  trigger_condition: string
  subject_line: string
  preview_text: string
  body_text: string
  cta_text: string
  cta_url_placeholder: string
  angle: string
  purpose: string
}

interface SequencePayload {
  sequence_name: string
  goal: string
  sequence_overview: string
  frequency_rationale: string
  emails: EmailItem[]
  behavioural_triggers: { trigger: string; action: string }[]
  a_b_test_suggestions: string[]
  loops_push_result?: unknown[]
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

export default function EmailSequencePage() {
  const { projectId } = useParams<{ projectId: string }>()
  const store = usePillar5Store()

  const [name, setName] = useState('')
  const [goal, setGoal] = useState('onboarding')
  const [audience, setAudience] = useState('')
  const [productName, setProductName] = useState('')
  const [productDesc, setProductDesc] = useState('')
  const [numEmails, setNumEmails] = useState(5)
  const [tone, setTone] = useState('conversational')
  const [pushToLoops, setPushToLoops] = useState(false)
  const [loopsListId, setLoopsListId] = useState('')
  const [result, setResult] = useState<SequencePayload | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  async function generate() {
    if (!name.trim()) { toast.error('Enter a sequence name'); return }
    if (!audience.trim()) { toast.error('Describe the audience'); return }
    if (!productName.trim()) { toast.error('Enter a product name'); return }
    if (!productDesc.trim()) { toast.error('Describe your product'); return }

    abortRef.current?.abort()
    abortRef.current = new AbortController()
    store.setIsStreaming(true); store.clearSteps(); store.clearStreamText(); setResult(null)

    try {
      await api.pillar5.streamEmailSequence(projectId,
        { sequence_name: name.trim(), goal, audience: audience.trim(), product_name: productName.trim(),
          product_description: productDesc.trim(), num_emails: numEmails, tone,
          push_to_loops: pushToLoops, loops_list_id: loopsListId.trim() || undefined },
        {
          onStep: (s, l, st) => store.upsertStep(s, l, st as ProgressStep['status']),
          onDelta: (t) => store.appendStreamText(t),
          onSaved: (_, p) => { setResult(p as unknown as SequencePayload); store.clearStreamText(); store.setIsStreaming(false); toast.success('Email sequence ready!') },
          onError: (m) => { toast.error(m); store.setIsStreaming(false) },
          onDone: () => store.setIsStreaming(false),
        }, abortRef.current.signal)
    } catch { store.setIsStreaming(false) }
  }

  const canSubmit = !!name.trim() && !!audience.trim() && !!productName.trim() && !!productDesc.trim()

  const form = (
    <>
      <h2 className="font-semibold text-sm">Email Sequence Builder</h2>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Sequence Name *</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. SaaS Onboarding Flow"
            className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Product *</label>
          <input value={productName} onChange={(e) => setProductName(e.target.value)} placeholder="e.g. LEO"
            className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
        </div>
      </div>
      <div>
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Goal *</label>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {GOALS.map((g) => (
            <button key={g} onClick={() => setGoal(g)}
              className={cn('px-2.5 py-1 text-xs rounded-lg border capitalize transition-colors',
                goal === g ? 'bg-primary text-primary-foreground border-primary' : 'bg-background border-border hover:border-primary/50')}>
              {g.replace(/-/g, ' ')}
            </button>
          ))}
        </div>
      </div>
      <div>
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Audience *</label>
        <textarea value={audience} onChange={(e) => setAudience(e.target.value)} rows={2}
          placeholder="e.g. B2B SaaS founders who just signed up for a free trial"
          className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary resize-none" />
      </div>
      <div>
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Product Description *</label>
        <textarea value={productDesc} onChange={(e) => setProductDesc(e.target.value)} rows={2}
          placeholder="What does your product do and what's the key value?"
          className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary resize-none" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Number of Emails</label>
          <select value={numEmails} onChange={(e) => setNumEmails(Number(e.target.value))}
            className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary">
            {[3, 4, 5, 6, 7, 8, 9, 10].map((n) => <option key={n} value={n}>{n} emails</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Tone</label>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {TONES.map((t) => (
              <button key={t} onClick={() => setTone(t)}
                className={cn('px-2.5 py-1 text-xs rounded-lg border capitalize transition-colors',
                  tone === t ? 'bg-primary text-primary-foreground border-primary' : 'bg-background border-border hover:border-primary/50')}>
                {t}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="space-y-2 p-3 rounded-lg border border-border bg-muted/30">
        <div className="flex items-center gap-2">
          <input type="checkbox" id="loops" checked={pushToLoops} onChange={(e) => setPushToLoops(e.target.checked)}
            className="rounded" />
          <label htmlFor="loops" className="text-xs font-medium cursor-pointer">Push to Loops.so (requires LOOPS_API_KEY)</label>
        </div>
        {pushToLoops && (
          <input value={loopsListId} onChange={(e) => setLoopsListId(e.target.value)}
            placeholder="Loops List ID (optional)"
            className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
        )}
      </div>
    </>
  )

  const resultNode = result ? (
    <div className="space-y-4">
      <div>
        <h2 className="font-semibold text-sm">{result.sequence_name}</h2>
        {result.sequence_overview && <p className="text-xs text-muted-foreground mt-1">{result.sequence_overview}</p>}
        {result.frequency_rationale && <p className="text-[10px] text-muted-foreground mt-0.5 italic">{result.frequency_rationale}</p>}
      </div>

      {result.emails?.map((email, i) => (
        <div key={i} className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 bg-muted/40 border-b border-border">
            <div className="flex items-center gap-2">
              <span className="w-5 h-5 rounded-full bg-primary/10 text-primary text-[10px] font-bold flex items-center justify-center">{email.email_number}</span>
              <span className="text-xs font-medium">{email.send_delay}</span>
            </div>
            <span className="text-[10px] text-muted-foreground capitalize px-2 py-0.5 bg-muted rounded-full">{email.angle?.replace(/_/g, ' ')}</span>
          </div>
          <div className="p-4 space-y-3">
            {email.trigger_condition && (
              <p className="text-[10px] text-muted-foreground italic">Trigger: {email.trigger_condition}</p>
            )}
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs"><span className="font-medium">Subject: </span>{email.subject_line}</p>
                <CopyBtn text={email.subject_line} />
              </div>
              {email.preview_text && (
                <p className="text-[10px] text-muted-foreground"><span className="font-medium">Preview: </span>{email.preview_text}</p>
              )}
            </div>
            <div className="bg-muted/40 rounded-lg p-3">
              <div className="flex items-start justify-between gap-2 mb-1">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase">Body</p>
                <CopyBtn text={email.body_text} />
              </div>
              <p className="text-xs whitespace-pre-wrap leading-relaxed">{email.body_text}</p>
            </div>
            {email.cta_text && (
              <div className="flex items-center gap-2 text-xs">
                <span className="font-medium text-primary">{email.cta_text}</span>
                {email.cta_url_placeholder && <span className="text-muted-foreground">→ {email.cta_url_placeholder}</span>}
              </div>
            )}
            {email.purpose && <p className="text-[10px] text-muted-foreground border-t border-border pt-2">{email.purpose}</p>}
          </div>
        </div>
      ))}

      {result.behavioural_triggers?.length > 0 && (
        <div className="p-4 rounded-xl border border-border bg-card space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Behavioural Triggers</p>
          {result.behavioural_triggers.map((t, i) => (
            <div key={i} className="text-xs flex gap-2">
              <span className="font-medium shrink-0">If {t.trigger}:</span>
              <span className="text-muted-foreground">{t.action}</span>
            </div>
          ))}
        </div>
      )}

      {result.a_b_test_suggestions?.length > 0 && (
        <div className="p-4 rounded-xl border border-primary/20 bg-primary/5 space-y-1">
          <p className="text-xs font-semibold text-primary uppercase tracking-wide mb-1">A/B Test Suggestions</p>
          {result.a_b_test_suggestions.map((s, i) => <p key={i} className="text-xs text-muted-foreground">• {s}</p>)}
        </div>
      )}

      {result.loops_push_result && (
        <div className="p-3 rounded-lg border border-border bg-muted/30">
          <p className="text-xs font-medium">Loops.so: {Array.isArray(result.loops_push_result) ? `${result.loops_push_result.length} emails pushed` : 'Push attempted'}</p>
        </div>
      )}
    </div>
  ) : null

  return (
    <SSEFeaturePage projectId={projectId} title="Email Sequence Builder" subtitle="Pillar 5 - Claude + Loops"
      icon={<Mail className="w-4 h-4" />} credits={15} steps={store.steps}
      isStreaming={store.isStreaming} streamText={store.streamText} form={form} result={resultNode}
      onSubmit={generate} submitLabel="Build Sequence - 15 credits" canSubmit={canSubmit}
      backPath={`/projects/${projectId}/email-crm`} />
  )
}
