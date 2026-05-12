'use client'

import { useState, useRef } from 'react'
import { useParams } from 'next/navigation'
import { Mail, Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import { SSEFeaturePage } from '@/components/pillar1/SSEFeaturePage'
import { api } from '@/lib/api'
import { usePillar10Store } from '@/stores/pillar10-store'
import type { ProgressStep } from '@/types'
import { cn } from '@/lib/utils'

const METRIC_COLORS: Record<string, string> = {
  high: 'text-green-600 dark:text-green-400',
  medium: 'text-yellow-600 dark:text-yellow-400',
  low: 'text-red-600 dark:text-red-400',
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

interface EmailVariant {
  variant_name: string
  subject_line: string
  open_rate?: number
  click_rate?: number
  ctor?: number
  conversions?: number
  unsubscribes?: number
}

interface EmailABResult {
  winner: string
  confidence: string
  winning_subject_line: string
  why_it_won: string
  key_metrics_comparison: string
  subject_line_patterns: string[]
  what_to_keep: string[]
  what_to_drop: string[]
  next_test_hypothesis: string
  next_test_variants: string[]
  transferable_learnings: string[]
  loops_campaign_id?: string
}

export default function EmailABPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const store = usePillar10Store()

  const [campaignName, setCampaignName] = useState('')
  const [audienceSegment, setAudienceSegment] = useState('')
  const [campaignGoal, setCampaignGoal] = useState('')
  const [loopsCampaignId, setLoopsCampaignId] = useState('')
  const [useLiveData, setUseLiveData] = useState(false)
  const [variants, setVariants] = useState<EmailVariant[]>([
    { variant_name: 'A', subject_line: '', open_rate: undefined, click_rate: undefined, ctor: undefined },
    { variant_name: 'B', subject_line: '', open_rate: undefined, click_rate: undefined, ctor: undefined },
  ])
  const [result, setResult] = useState<EmailABResult | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  function addVariant() {
    if (variants.length >= 6) return
    const names = ['A', 'B', 'C', 'D', 'E', 'F']
    setVariants([...variants, { variant_name: names[variants.length], subject_line: '', open_rate: undefined, click_rate: undefined, ctor: undefined }])
  }

  function removeVariant(i: number) {
    if (variants.length <= 2) return
    setVariants(variants.filter((_, idx) => idx !== i))
  }

  function updateVariant(i: number, field: keyof EmailVariant, value: string) {
    const n = [...variants]
    if (field === 'variant_name' || field === 'subject_line') {
      n[i] = { ...n[i], [field]: value }
    } else {
      n[i] = { ...n[i], [field]: value === '' ? undefined : parseFloat(value) }
    }
    setVariants(n)
  }

  async function generate() {
    if (!campaignName.trim()) { toast.error('Enter campaign name'); return }
    if (!campaignGoal.trim()) { toast.error('Describe the campaign goal'); return }
    if (useLiveData && !loopsCampaignId.trim()) { toast.error('Enter Loops campaign ID'); return }

    const validVariants = variants.filter((v) => v.subject_line.trim())
    if (!useLiveData && validVariants.length < 2) { toast.error('Enter at least 2 subject lines'); return }

    abortRef.current?.abort()
    abortRef.current = new AbortController()
    store.setIsStreaming(true)
    store.clearSteps()
    store.clearStreamText()
    setResult(null)

    try {
      await api.pillar10.streamEmailAB(
        projectId,
        {
          campaign_name: campaignName.trim(),
          audience_segment: audienceSegment.trim() || undefined,
          campaign_goal: campaignGoal.trim(),
          loops_campaign_id: useLiveData ? loopsCampaignId.trim() : undefined,
          variants: useLiveData ? undefined : validVariants,
        },
        {
          onStep: (step, label, status) => store.upsertStep(step, label, status as ProgressStep['status']),
          onDelta: (text) => store.appendStreamText(text),
          onSaved: (_id, payload) => {
            setResult(payload as unknown as EmailABResult)
            store.clearStreamText()
            store.setIsStreaming(false)
            toast.success('Email A/B analysis ready!')
          },
          onError: (msg) => { toast.error(msg); store.setIsStreaming(false) },
          onDone: () => store.setIsStreaming(false),
        },
        abortRef.current.signal,
      )
    } catch { store.setIsStreaming(false) }
  }

  const canSubmit = !!campaignName.trim() && !!campaignGoal.trim() &&
    (useLiveData ? !!loopsCampaignId.trim() : variants.filter((v) => v.subject_line.trim()).length >= 2)

  const form = (
    <>
      <h2 className="font-semibold text-sm">Email A/B Analysis</h2>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Campaign Name *</label>
          <input value={campaignName} onChange={(e) => setCampaignName(e.target.value)} placeholder="e.g. March Product Launch"
            className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Audience Segment</label>
          <input value={audienceSegment} onChange={(e) => setAudienceSegment(e.target.value)} placeholder="e.g. Trial users, Day 7"
            className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
        </div>
      </div>

      <div>
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Campaign Goal *</label>
        <input value={campaignGoal} onChange={(e) => setCampaignGoal(e.target.value)} placeholder="e.g. Drive trial-to-paid upgrades"
          className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
      </div>

      <div className="flex items-center gap-3 p-3 rounded-lg border border-border bg-muted/30">
        <input type="checkbox" id="use-live" checked={useLiveData} onChange={(e) => setUseLiveData(e.target.checked)}
          className="rounded" />
        <label htmlFor="use-live" className="text-sm cursor-pointer">Fetch live results from Loops.so</label>
      </div>

      {useLiveData ? (
        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Loops Campaign ID *</label>
          <input value={loopsCampaignId} onChange={(e) => setLoopsCampaignId(e.target.value)} placeholder="e.g. clx1234abc"
            className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
          <p className="text-[10px] text-muted-foreground mt-1">Found in your Loops dashboard under Campaigns → Campaign ID</p>
        </div>
      ) : (
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Variants *</label>
            {variants.length < 6 && (
              <button onClick={addVariant} className="flex items-center gap-1 text-xs text-primary hover:text-primary/80">
                <Plus className="w-3 h-3" /> Add variant
              </button>
            )}
          </div>

          <div className="space-y-3">
            {variants.map((v, i) => (
              <div key={i} className="p-3 rounded-lg border border-border bg-muted/30 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-primary">Variant {v.variant_name}</span>
                  {variants.length > 2 && (
                    <button onClick={() => removeVariant(i)} className="text-muted-foreground hover:text-destructive">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
                <input value={v.subject_line} onChange={(e) => updateVariant(i, 'subject_line', e.target.value)}
                  placeholder="Subject line"
                  className="w-full px-3 py-1.5 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Open Rate %</label>
                    <input type="number" step="0.1" min="0" max="100"
                      value={v.open_rate ?? ''} onChange={(e) => updateVariant(i, 'open_rate', e.target.value)}
                      placeholder="28.5"
                      className="mt-0.5 w-full px-2 py-1 text-xs bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary" />
                  </div>
                  <div>
                    <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Click Rate %</label>
                    <input type="number" step="0.1" min="0" max="100"
                      value={v.click_rate ?? ''} onChange={(e) => updateVariant(i, 'click_rate', e.target.value)}
                      placeholder="4.2"
                      className="mt-0.5 w-full px-2 py-1 text-xs bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary" />
                  </div>
                  <div>
                    <label className="text-[10px] text-muted-foreground uppercase tracking-wide">CTOR %</label>
                    <input type="number" step="0.1" min="0" max="100"
                      value={v.ctor ?? ''} onChange={(e) => updateVariant(i, 'ctor', e.target.value)}
                      placeholder="14.7"
                      className="mt-0.5 w-full px-2 py-1 text-xs bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Conversions</label>
                    <input type="number" min="0"
                      value={v.conversions ?? ''} onChange={(e) => updateVariant(i, 'conversions', e.target.value)}
                      placeholder="12"
                      className="mt-0.5 w-full px-2 py-1 text-xs bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary" />
                  </div>
                  <div>
                    <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Unsubscribes</label>
                    <input type="number" min="0"
                      value={v.unsubscribes ?? ''} onChange={(e) => updateVariant(i, 'unsubscribes', e.target.value)}
                      placeholder="3"
                      className="mt-0.5 w-full px-2 py-1 text-xs bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  )

  const resultNode = result ? (
    <div className="space-y-4">
      {/* Winner card */}
      <div className={cn('p-5 rounded-xl border-2 space-y-2',
        result.confidence === 'high' ? 'border-green-500/50 bg-green-50/50 dark:bg-green-900/10' :
        result.confidence === 'medium' ? 'border-yellow-500/50 bg-yellow-50/50 dark:bg-yellow-900/10' :
        'border-red-500/50 bg-red-50/50 dark:bg-red-900/10')}>
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Winner</span>
          <span className={cn('text-xs font-bold capitalize px-2 py-0.5 rounded-full',
            result.confidence === 'high' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' :
            result.confidence === 'medium' ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400' :
            'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400')}>
            {result.confidence} confidence
          </span>
        </div>
        <p className="text-lg font-bold">Variant {result.winner}</p>
        <div className="flex items-start gap-2">
          <p className="text-sm font-medium flex-1">{result.winning_subject_line}</p>
          <CopyButton text={result.winning_subject_line} />
        </div>
        <p className="text-sm text-muted-foreground">{result.why_it_won}</p>
      </div>

      {/* Metrics comparison */}
      {result.key_metrics_comparison && (
        <div className="p-4 rounded-xl border border-border bg-card">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Metrics Comparison</p>
          <p className="text-sm whitespace-pre-wrap">{result.key_metrics_comparison}</p>
        </div>
      )}

      {/* Subject line patterns */}
      {result.subject_line_patterns?.length > 0 && (
        <div className="p-4 rounded-xl border border-primary/20 bg-primary/5">
          <p className="text-xs font-semibold text-primary uppercase tracking-wide mb-2">Subject Line Patterns That Work</p>
          <ul className="space-y-1">
            {result.subject_line_patterns.map((p, i) => (
              <li key={i} className="text-xs text-muted-foreground flex gap-2">
                <span className="text-primary font-medium">•</span>{p}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* What to keep / drop */}
      {(result.what_to_keep?.length > 0 || result.what_to_drop?.length > 0) && (
        <div className="grid grid-cols-2 gap-3">
          {result.what_to_keep?.length > 0 && (
            <div className="p-3 rounded-xl border border-green-500/30 bg-green-50/50 dark:bg-green-900/10">
              <p className="text-xs font-semibold text-green-700 dark:text-green-400 mb-2">Keep Doing</p>
              <ul className="space-y-1">
                {result.what_to_keep.map((k, i) => <li key={i} className="text-xs text-muted-foreground">✓ {k}</li>)}
              </ul>
            </div>
          )}
          {result.what_to_drop?.length > 0 && (
            <div className="p-3 rounded-xl border border-red-500/30 bg-red-50/50 dark:bg-red-900/10">
              <p className="text-xs font-semibold text-red-700 dark:text-red-400 mb-2">Stop Doing</p>
              <ul className="space-y-1">
                {result.what_to_drop.map((d, i) => <li key={i} className="text-xs text-muted-foreground">✗ {d}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Next test */}
      {result.next_test_hypothesis && (
        <div className="p-4 rounded-xl border border-border bg-card space-y-3">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Next Test</p>
          <p className="text-sm">{result.next_test_hypothesis}</p>
          {result.next_test_variants?.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {result.next_test_variants.map((v, i) => (
                <div key={i} className="flex items-center gap-1.5 px-2 py-1 rounded bg-muted/50 flex-1 min-w-0">
                  <span className="w-4 h-4 rounded-full bg-primary/10 text-primary text-[9px] font-bold flex items-center justify-center shrink-0">{String.fromCharCode(65 + i)}</span>
                  <span className="text-xs truncate">{v}</span>
                  <CopyButton text={v} />
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Transferable learnings */}
      {result.transferable_learnings?.length > 0 && (
        <div className="p-4 rounded-xl border border-border bg-card">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Transferable Learnings</p>
          <ul className="space-y-1">
            {result.transferable_learnings.map((l, i) => (
              <li key={i} className="text-xs text-muted-foreground flex gap-2">
                <span className="text-primary">→</span>{l}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  ) : null

  return (
    <SSEFeaturePage
      projectId={projectId}
      title="Email A/B Analysis"
      subtitle="Pillar 10 - Loops + Claude"
      icon={<Mail className="w-4 h-4" />}
      credits={10}
      steps={store.steps}
      isStreaming={store.isStreaming}
      streamText={store.streamText}
      form={form}
      result={resultNode}
      onSubmit={generate}
      submitLabel="Analyse Results - 10 credits"
      canSubmit={canSubmit}
      backPath={`/projects/${projectId}/experiments`}
    />
  )
}
