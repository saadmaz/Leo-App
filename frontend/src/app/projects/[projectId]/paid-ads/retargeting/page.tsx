'use client'

import { useState, useRef } from 'react'
import { useParams } from 'next/navigation'
import { RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { SSEFeaturePage } from '@/components/pillar1/SSEFeaturePage'
import { api } from '@/lib/api'
import { usePillar4Store } from '@/stores/pillar4-store'
import type { ProgressStep } from '@/types'
import { cn } from '@/lib/utils'

const AUDIENCE_SEGMENTS = [
  { id: 'website_visitors', label: 'Website Visitors', desc: 'Visited site but didn\'t convert' },
  { id: 'cart_abandoners', label: 'Cart Abandoners', desc: 'Added to cart, didn\'t purchase' },
  { id: 'past_buyers', label: 'Past Buyers', desc: 'Previous customers - upsell / loyalty' },
  { id: 'video_viewers', label: 'Video Viewers', desc: 'Watched 25%+ of a brand video' },
  { id: 'lead_nurture', label: 'Lead Nurture', desc: 'Leads who haven\'t converted yet' },
]

const PLATFORMS = [
  { id: 'meta_feed', label: 'Meta Feed' },
  { id: 'google_display', label: 'Google Display' },
  { id: 'tiktok', label: 'TikTok' },
  { id: 'linkedin', label: 'LinkedIn' },
]

const GOALS = [
  { id: 'purchase', label: 'Purchase' },
  { id: 'sign_up', label: 'Sign Up' },
  { id: 'demo_request', label: 'Demo Request' },
  { id: 'free_trial', label: 'Free Trial' },
]

interface TouchPoint {
  touch_point: number
  day: number
  funnel_stage: string
  goal: string
  platform: string
  ad_format: string
  frequency_cap: string
  copy: {
    headline: string
    body: string
    cta: string
    cta_url_note: string
  }
  creative_direction: string
  audience_refinement: string
}

interface RetargetingPayload {
  sequence_name: string
  audience_segment: string
  product_name: string
  conversion_goal: string
  funnel_overview: string
  audience_definition: {
    inclusion_criteria: string[]
    exclusion_criteria: string[]
    lookback_window_days: number
    estimated_audience_size_note: string
  }
  touch_points: TouchPoint[]
  exclusion_logic: string[]
  budget_guidance: {
    recommended_split: string
    bofu_weighting: string
  }
  success_metrics: { metric: string; target: string }[]
  implementation_notes: string[]
}

const STAGE_COLORS: Record<string, string> = {
  TOFU: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  MOFU: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
  BOFU: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  'WIN-BACK': 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
}

export default function RetargetingPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const store = usePillar4Store()

  const [productName, setProductName] = useState('')
  const [productDescription, setProductDescription] = useState('')
  const [audienceSegment, setAudienceSegment] = useState('website_visitors')
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>(['meta_feed', 'google_display'])
  const [sequenceLength, setSequenceLength] = useState(5)
  const [conversionGoal, setConversionGoal] = useState('purchase')
  const [result, setResult] = useState<RetargetingPayload | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  function togglePlatform(id: string) {
    setSelectedPlatforms((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]
    )
  }

  async function generate() {
    if (!productName.trim()) { toast.error('Enter a product name'); return }
    if (!productDescription.trim()) { toast.error('Describe your product'); return }
    if (selectedPlatforms.length === 0) { toast.error('Select at least one platform'); return }

    abortRef.current?.abort()
    abortRef.current = new AbortController()
    store.setIsStreaming(true)
    store.clearSteps()
    store.clearStreamText()
    setResult(null)

    try {
      await api.pillar4.streamRetargeting(
        projectId,
        {
          product_name: productName.trim(),
          product_description: productDescription.trim(),
          audience_segment: audienceSegment,
          platforms: selectedPlatforms,
          sequence_length: sequenceLength,
          conversion_goal: conversionGoal,
        },
        {
          onStep: (step, label, status) => store.upsertStep(step, label, status as ProgressStep['status']),
          onDelta: (text) => store.appendStreamText(text),
          onSaved: (_id, payload) => {
            setResult(payload as unknown as RetargetingPayload)
            store.clearStreamText()
            store.setIsStreaming(false)
            toast.success('Retargeting sequence ready!')
          },
          onError: (msg) => { toast.error(msg); store.setIsStreaming(false) },
          onDone: () => store.setIsStreaming(false),
        },
        abortRef.current.signal,
      )
    } catch { store.setIsStreaming(false) }
  }

  const canSubmit = !!productName.trim() && !!productDescription.trim() && selectedPlatforms.length > 0

  const form = (
    <>
      <h2 className="font-semibold text-sm">Retargeting Sequence Builder</h2>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Product / Service *</label>
          <input value={productName} onChange={(e) => setProductName(e.target.value)}
            placeholder="e.g. LEO Marketing Co-pilot"
            className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Conversion Goal *</label>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {GOALS.map((g) => (
              <button key={g.id} onClick={() => setConversionGoal(g.id)}
                className={cn(
                  'px-2.5 py-1 text-xs rounded-lg border transition-colors',
                  conversionGoal === g.id
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-background border-border hover:border-primary/50',
                )}>
                {g.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div>
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Product Description *</label>
        <textarea value={productDescription} onChange={(e) => setProductDescription(e.target.value)}
          rows={2} placeholder="What does your product do? Who is it for? What makes it different?"
          className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary resize-none" />
      </div>

      <div>
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Audience Segment *</label>
        <div className="mt-1 space-y-2">
          {AUDIENCE_SEGMENTS.map((s) => (
            <button key={s.id} onClick={() => setAudienceSegment(s.id)}
              className={cn(
                'w-full text-left px-3 py-2.5 rounded-lg border transition-colors',
                audienceSegment === s.id
                  ? 'bg-primary/10 border-primary/50 text-primary'
                  : 'bg-background border-border hover:border-primary/30',
              )}>
              <p className="text-xs font-medium">{s.label}</p>
              <p className="text-[10px] text-muted-foreground">{s.desc}</p>
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Platforms *</label>
        <div className="mt-1 flex flex-wrap gap-2">
          {PLATFORMS.map((p) => (
            <button key={p.id} onClick={() => togglePlatform(p.id)}
              className={cn(
                'px-3 py-1.5 text-xs rounded-lg border transition-colors',
                selectedPlatforms.includes(p.id)
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-background border-border hover:border-primary/50',
              )}>
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Sequence Length</label>
        <div className="mt-1 flex gap-2">
          {[3, 4, 5, 6, 7].map((n) => (
            <button key={n} onClick={() => setSequenceLength(n)}
              className={cn(
                'px-3 py-1.5 text-xs rounded-lg border transition-colors',
                sequenceLength === n
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-background border-border hover:border-primary/50',
              )}>
              {n} touch points
            </button>
          ))}
        </div>
      </div>
    </>
  )

  const resultNode = result ? (
    <div className="space-y-4">
      <div>
        <h2 className="font-semibold text-sm">{result.sequence_name || result.product_name}</h2>
        {result.funnel_overview && (
          <p className="text-xs text-muted-foreground mt-1">{result.funnel_overview}</p>
        )}
      </div>

      {result.audience_definition && (
        <div className="p-4 rounded-xl border border-border bg-card space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Audience Definition</p>
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <p className="font-medium mb-1 text-green-600 dark:text-green-400">Include</p>
              <ul className="space-y-0.5">
                {result.audience_definition.inclusion_criteria?.map((c, i) => (
                  <li key={i} className="text-muted-foreground">• {c}</li>
                ))}
              </ul>
            </div>
            <div>
              <p className="font-medium mb-1 text-red-600 dark:text-red-400">Exclude</p>
              <ul className="space-y-0.5">
                {result.audience_definition.exclusion_criteria?.map((c, i) => (
                  <li key={i} className="text-muted-foreground">• {c}</li>
                ))}
              </ul>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Lookback window: <span className="font-medium">{result.audience_definition.lookback_window_days} days</span>
            {result.audience_definition.estimated_audience_size_note && (
              <span> · {result.audience_definition.estimated_audience_size_note}</span>
            )}
          </p>
        </div>
      )}

      {result.touch_points?.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Touch Points</p>
          {result.touch_points.map((tp, i) => (
            <div key={i} className="p-4 rounded-xl border border-border bg-card space-y-3">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center shrink-0">
                  {tp.touch_point}
                </div>
                <div className="flex-1 flex items-center justify-between">
                  <div>
                    <span className="text-xs font-medium">Day {tp.day}</span>
                    <span className="text-muted-foreground text-xs"> · {tp.platform?.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}</span>
                  </div>
                  <span className={cn('text-[10px] px-2 py-0.5 rounded-full font-medium', STAGE_COLORS[tp.funnel_stage] ?? 'bg-muted text-muted-foreground')}>
                    {tp.funnel_stage}
                  </span>
                </div>
              </div>
              <div className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">Goal: </span>{tp.goal}
              </div>
              {tp.copy && (
                <div className="space-y-1.5 bg-muted/40 rounded-lg p-3">
                  {tp.copy.headline && (
                    <p className="text-xs"><span className="font-medium">Headline: </span>{tp.copy.headline}</p>
                  )}
                  {tp.copy.body && (
                    <p className="text-xs text-muted-foreground">{tp.copy.body}</p>
                  )}
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-primary">{tp.copy.cta}</span>
                    {tp.copy.cta_url_note && (
                      <span className="text-[10px] text-muted-foreground italic">{tp.copy.cta_url_note}</span>
                    )}
                  </div>
                </div>
              )}
              <div className="grid grid-cols-2 gap-2 text-[10px] text-muted-foreground">
                <div><span className="font-medium">Format:</span> {tp.ad_format}</div>
                <div><span className="font-medium">Frequency:</span> {tp.frequency_cap}</div>
              </div>
              {tp.creative_direction && (
                <p className="text-[10px] text-muted-foreground italic">{tp.creative_direction}</p>
              )}
              {tp.audience_refinement && (
                <p className="text-[10px] text-muted-foreground">Audience: {tp.audience_refinement}</p>
              )}
            </div>
          ))}
        </div>
      )}

      {result.budget_guidance && (
        <div className="p-4 rounded-xl border border-border bg-card space-y-1">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Budget Guidance</p>
          <p className="text-xs">{result.budget_guidance.recommended_split}</p>
          <p className="text-xs text-muted-foreground">{result.budget_guidance.bofu_weighting}</p>
        </div>
      )}

      {result.success_metrics?.length > 0 && (
        <div className="p-4 rounded-xl border border-border bg-card space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Success Metrics</p>
          {result.success_metrics.map((m, i) => (
            <div key={i} className="flex items-center gap-2 text-xs">
              <span className="font-medium">{m.metric}:</span>
              <span className="text-primary">{m.target}</span>
            </div>
          ))}
        </div>
      )}

      {result.exclusion_logic?.length > 0 && (
        <div className="p-4 rounded-xl border border-red-200/50 bg-red-50/50 dark:bg-red-900/10 dark:border-red-900/30">
          <p className="text-xs font-semibold text-red-600 dark:text-red-400 uppercase tracking-wide mb-2">Stop Showing Ads When</p>
          <ul className="space-y-0.5">
            {result.exclusion_logic.map((e, i) => (
              <li key={i} className="text-xs text-muted-foreground">• {e}</li>
            ))}
          </ul>
        </div>
      )}

      {result.implementation_notes?.length > 0 && (
        <div className="p-4 rounded-xl border border-border bg-card space-y-1">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Implementation Notes</p>
          {result.implementation_notes.map((n, i) => (
            <p key={i} className="text-xs text-muted-foreground">• {n}</p>
          ))}
        </div>
      )}
    </div>
  ) : null

  return (
    <SSEFeaturePage
      projectId={projectId}
      title="Retargeting Sequence Builder"
      subtitle="Pillar 4 - Claude"
      icon={<RefreshCw className="w-4 h-4" />}
      credits={20}
      steps={store.steps}
      isStreaming={store.isStreaming}
      streamText={store.streamText}
      form={form}
      result={resultNode}
      onSubmit={generate}
      submitLabel="Build Sequence - 20 credits"
      canSubmit={canSubmit}
      backPath={`/projects/${projectId}/paid-ads`}
    />
  )
}
