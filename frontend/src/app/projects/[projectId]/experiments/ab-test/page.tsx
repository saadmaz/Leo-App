'use client'

import { useState, useRef } from 'react'
import { useParams } from 'next/navigation'
import { FlaskConical } from 'lucide-react'
import { toast } from 'sonner'
import { SSEFeaturePage } from '@/components/pillar1/SSEFeaturePage'
import { api } from '@/lib/api'
import { usePillar10Store } from '@/stores/pillar10-store'
import type { ProgressStep } from '@/types'
import { cn } from '@/lib/utils'

const TEST_TYPES = [
  { id: 'copy', label: 'Copy' },
  { id: 'layout', label: 'Layout' },
  { id: 'pricing', label: 'Pricing' },
  { id: 'cta', label: 'CTA' },
  { id: 'audience', label: 'Audience' },
  { id: 'channel', label: 'Channel' },
]
const CONFIDENCE_LEVELS = [90, 95, 99]

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500) }}
      className="text-[10px] text-muted-foreground hover:text-primary px-1.5 py-0.5 rounded border border-border hover:border-primary/50 shrink-0">
      {copied ? 'Copied!' : 'Copy'}
    </button>
  )
}

interface ABVariant {
  variant_id: string
  label: string
  description: string
  copy_or_change: string
  rationale: string
  expected_direction: string
}

interface ABTestPayload {
  test_name: string
  hypothesis: string
  control_description: string
  variants: ABVariant[]
  sample_size: { per_variant: number; total: number; calculation_notes: string; estimated_run_days?: number }
  primary_metric: string
  secondary_metrics: string[]
  guardrail_metrics: string[]
  success_criteria: string
  pre_test_checklist: string[]
  implementation_notes: string
  common_pitfalls: string[]
  expected_duration: string
  statistical_approach: string
}

export default function ABTestDesignPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const store = usePillar10Store()

  const [whatToTest, setWhatToTest] = useState('')
  const [testType, setTestType] = useState('copy')
  const [businessGoal, setBusinessGoal] = useState('')
  const [currentVersion, setCurrentVersion] = useState('')
  const [targetAudience, setTargetAudience] = useState('')
  const [trafficPerDay, setTrafficPerDay] = useState('')
  const [currentCR, setCurrentCR] = useState('')
  const [mde, setMde] = useState('5')
  const [confidenceLevel, setConfidenceLevel] = useState(95)
  const [numVariants, setNumVariants] = useState(2)
  const [platform, setPlatform] = useState('')
  const [result, setResult] = useState<ABTestPayload | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  async function generate() {
    if (!whatToTest.trim()) { toast.error('Describe what you want to test'); return }
    if (!businessGoal.trim()) { toast.error('Describe the business goal'); return }

    abortRef.current?.abort()
    abortRef.current = new AbortController()
    store.setIsStreaming(true)
    store.clearSteps()
    store.clearStreamText()
    setResult(null)

    try {
      await api.pillar10.streamABTestDesign(
        projectId,
        {
          what_to_test: whatToTest.trim(),
          test_type: testType,
          business_goal: businessGoal.trim(),
          current_version: currentVersion.trim() || undefined,
          target_audience: targetAudience.trim() || undefined,
          traffic_per_day: trafficPerDay ? Number(trafficPerDay) : undefined,
          current_conversion_rate: currentCR ? Number(currentCR) : undefined,
          minimum_detectable_effect: Number(mde),
          confidence_level: confidenceLevel,
          num_variants: numVariants,
          platform: platform.trim() || undefined,
        },
        {
          onStep: (step, label, status) => store.upsertStep(step, label, status as ProgressStep['status']),
          onDelta: (text) => store.appendStreamText(text),
          onSaved: (_id, payload) => {
            setResult(payload as unknown as ABTestPayload)
            store.clearStreamText()
            store.setIsStreaming(false)
            toast.success('A/B test design ready!')
          },
          onError: (msg) => { toast.error(msg); store.setIsStreaming(false) },
          onDone: () => store.setIsStreaming(false),
        },
        abortRef.current.signal,
      )
    } catch { store.setIsStreaming(false) }
  }

  const canSubmit = !!whatToTest.trim() && !!businessGoal.trim()

  const DIRECTION_COLORS: Record<string, string> = {
    increase: 'text-green-600 dark:text-green-400',
    decrease: 'text-red-600 dark:text-red-400',
    neutral: 'text-muted-foreground',
  }

  const form = (
    <>
      <h2 className="font-semibold text-sm">A/B Test Designer</h2>

      <div>
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">What to Test *</label>
        <textarea value={whatToTest} onChange={(e) => setWhatToTest(e.target.value)} rows={2}
          placeholder="e.g. Homepage hero headline - testing pain-led vs benefit-led vs curiosity-driven copy"
          className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary resize-none" />
      </div>

      <div>
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Test Type *</label>
        <div className="mt-1 flex flex-wrap gap-2">
          {TEST_TYPES.map((t) => (
            <button key={t.id} onClick={() => setTestType(t.id)}
              className={cn('px-3 py-1.5 text-xs rounded-lg border transition-colors',
                testType === t.id ? 'bg-primary text-primary-foreground border-primary' : 'bg-background border-border hover:border-primary/50')}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Business Goal *</label>
        <input value={businessGoal} onChange={(e) => setBusinessGoal(e.target.value)}
          placeholder="e.g. increase free trial signups by 20%"
          className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
      </div>

      <div>
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Current Version (Control)</label>
        <textarea value={currentVersion} onChange={(e) => setCurrentVersion(e.target.value)} rows={2}
          placeholder="Describe or quote the current version that will be the control"
          className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary resize-none" />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Platform</label>
          <input value={platform} onChange={(e) => setPlatform(e.target.value)} placeholder="e.g. website, Meta Ads, email"
            className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Target Audience</label>
          <input value={targetAudience} onChange={(e) => setTargetAudience(e.target.value)} placeholder="e.g. mid-market SaaS founders"
            className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Daily Traffic</label>
          <input type="number" value={trafficPerDay} onChange={(e) => setTrafficPerDay(e.target.value)} placeholder="e.g. 500"
            className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Current CR %</label>
          <input type="number" step="0.1" value={currentCR} onChange={(e) => setCurrentCR(e.target.value)} placeholder="e.g. 3.2"
            className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Min. Detectable Effect %</label>
          <input type="number" step="0.5" value={mde} onChange={(e) => setMde(e.target.value)} placeholder="5"
            className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Confidence Level</label>
          <div className="mt-1 flex gap-1.5">
            {CONFIDENCE_LEVELS.map((c) => (
              <button key={c} onClick={() => setConfidenceLevel(c)}
                className={cn('flex-1 py-1.5 text-xs rounded-lg border transition-colors',
                  confidenceLevel === c ? 'bg-primary text-primary-foreground border-primary' : 'bg-background border-border hover:border-primary/50')}>
                {c}%
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Number of Variants</label>
          <select value={numVariants} onChange={(e) => setNumVariants(Number(e.target.value))}
            className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary">
            {[2, 3, 4, 5].map((n) => <option key={n} value={n}>{n} (incl. control)</option>)}
          </select>
        </div>
      </div>
    </>
  )

  const resultNode = result ? (
    <div className="space-y-4">
      <h2 className="font-semibold text-sm">{result.test_name}</h2>

      <div className="p-4 rounded-xl border border-primary/20 bg-primary/5">
        <p className="text-xs font-semibold text-primary uppercase tracking-wide mb-1">Hypothesis</p>
        <p className="text-sm italic">{result.hypothesis}</p>
      </div>

      {result.sample_size && (
        <div className="p-4 rounded-xl border border-border bg-card">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Sample Size</p>
          <div className="grid grid-cols-3 gap-3 text-center">
            {result.sample_size.per_variant && (
              <div><p className="text-lg font-bold">{result.sample_size.per_variant.toLocaleString()}</p><p className="text-[10px] text-muted-foreground">per variant</p></div>
            )}
            {result.sample_size.total && (
              <div><p className="text-lg font-bold">{result.sample_size.total.toLocaleString()}</p><p className="text-[10px] text-muted-foreground">total</p></div>
            )}
            {result.sample_size.estimated_run_days && (
              <div><p className="text-lg font-bold">{result.sample_size.estimated_run_days}</p><p className="text-[10px] text-muted-foreground">est. days</p></div>
            )}
          </div>
          {result.sample_size.calculation_notes && (
            <p className="text-xs text-muted-foreground mt-2">{result.sample_size.calculation_notes}</p>
          )}
        </div>
      )}

      <div className="space-y-3">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Variants</p>
        {result.variants?.map((v, i) => (
          <div key={i} className="p-4 rounded-xl border border-border bg-card space-y-2">
            <div className="flex items-center gap-2">
              <span className="w-6 h-6 rounded bg-primary/10 text-primary text-xs font-bold flex items-center justify-center">{v.variant_id}</span>
              <span className="font-medium text-sm">{v.label}</span>
              <span className={cn('text-[10px] ml-auto capitalize', DIRECTION_COLORS[v.expected_direction])}>
                ↑ {v.expected_direction}
              </span>
            </div>
            {v.copy_or_change && (
              <div className="flex items-start justify-between gap-2 bg-muted/50 px-3 py-2 rounded-lg">
                <p className="text-sm font-medium">{v.copy_or_change}</p>
                <CopyButton text={v.copy_or_change} />
              </div>
            )}
            <p className="text-xs text-muted-foreground">{v.description}</p>
            <p className="text-xs text-primary/80 italic">{v.rationale}</p>
          </div>
        ))}
      </div>

      <div className="p-4 rounded-xl border border-border bg-card">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Metrics</p>
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs">
            <span className="text-green-600 dark:text-green-400 font-medium">Primary:</span>
            <span>{result.primary_metric}</span>
          </div>
          {result.secondary_metrics?.map((m, i) => (
            <div key={i} className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>Secondary:</span><span>{m}</span>
            </div>
          ))}
          {result.guardrail_metrics?.map((m, i) => (
            <div key={i} className="flex items-center gap-2 text-xs text-red-500 dark:text-red-400">
              <span>Guardrail:</span><span>{m}</span>
            </div>
          ))}
        </div>
      </div>

      {result.success_criteria && (
        <div className="p-4 rounded-xl border border-border bg-card">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Success Criteria</p>
          <p className="text-sm">{result.success_criteria}</p>
        </div>
      )}

      {result.pre_test_checklist?.length > 0 && (
        <div className="p-4 rounded-xl border border-border bg-card">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Pre-Launch Checklist</p>
          <ul className="space-y-1">
            {result.pre_test_checklist.map((item, i) => (
              <li key={i} className="flex items-start gap-2 text-xs">
                <span className="w-4 h-4 rounded border border-border shrink-0 mt-0.5" />
                {item}
              </li>
            ))}
          </ul>
        </div>
      )}

      {result.implementation_notes && (
        <div className="p-4 rounded-xl border border-border bg-card">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Implementation Notes</p>
          <p className="text-sm whitespace-pre-wrap">{result.implementation_notes}</p>
        </div>
      )}

      {result.common_pitfalls?.length > 0 && (
        <div className="p-4 rounded-xl border border-orange-200 bg-orange-50 dark:bg-orange-900/20 dark:border-orange-800">
          <p className="text-xs font-semibold text-orange-700 dark:text-orange-400 uppercase tracking-wide mb-2">Common Pitfalls to Avoid</p>
          <ul className="space-y-1">
            {result.common_pitfalls.map((p, i) => (
              <li key={i} className="text-xs text-orange-700 dark:text-orange-300 flex gap-2"><span>⚠</span>{p}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  ) : null

  return (
    <SSEFeaturePage
      projectId={projectId}
      title="A/B Test Designer"
      subtitle="Pillar 10 - Claude"
      icon={<FlaskConical className="w-4 h-4" />}
      credits={10}
      steps={store.steps}
      isStreaming={store.isStreaming}
      streamText={store.streamText}
      form={form}
      result={resultNode}
      onSubmit={generate}
      submitLabel="Design A/B Test - 10 credits"
      canSubmit={canSubmit}
      backPath={`/projects/${projectId}/experiments`}
    />
  )
}
