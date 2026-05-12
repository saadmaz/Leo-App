'use client'

import { useState, useRef } from 'react'
import { useParams } from 'next/navigation'
import { TrendingUp, Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import { SSEFeaturePage } from '@/components/pillar1/SSEFeaturePage'
import { api } from '@/lib/api'
import { usePillar7Store } from '@/stores/pillar7-store'
import type { ProgressStep } from '@/types'
import { cn } from '@/lib/utils'

const PERF_STYLES: Record<string, string> = {
  strong:   'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  average:  'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
  weak:     'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  critical: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
}
const EFFORT_STYLES: Record<string, string> = {
  low:    'bg-green-100 text-green-700',
  medium: 'bg-yellow-100 text-yellow-700',
  high:   'bg-red-100 text-red-700',
}

interface StepRow { name: string; users: string; drop_off_reasons: string }
interface StepResult {
  step_name: string; users: number; conversion_rate_from_prev_pct: number; drop_off_pct: number
  performance: string; drop_off_diagnosis: string; fix_recommendation: string; expected_impact: string; effort: string
}
interface FunnelPayload {
  funnel_name: string; time_period: string; overall_conversion_rate_pct: number; funnel_health_score: number
  benchmark_assessment: string; executive_summary: string; steps_analysis: StepResult[]
  biggest_leak: { step: string; users_lost: number; root_cause: string; priority_fix: string }
  quick_wins: { action: string; target_step: string; expected_lift: string; effort: string }[]
  ab_tests_to_run: { step: string; test: string; hypothesis: string; success_metric: string }[]
  revenue_opportunity: string
}

export default function FunnelAnalysisPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const store = usePillar7Store()

  const [funnelName, setFunnelName] = useState('')
  const [period, setPeriod] = useState('Last 30 days')
  const [goalEvent, setGoalEvent] = useState('paid subscription')
  const [benchmark, setBenchmark] = useState('')
  const [steps, setSteps] = useState<StepRow[]>([
    { name: 'Homepage Visit', users: '', drop_off_reasons: '' },
    { name: 'Sign Up', users: '', drop_off_reasons: '' },
    { name: 'First Action', users: '', drop_off_reasons: '' },
    { name: 'Paid', users: '', drop_off_reasons: '' },
  ])
  const [result, setResult] = useState<FunnelPayload | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  function addStep() { setSteps([...steps, { name: '', users: '', drop_off_reasons: '' }]) }
  function removeStep(i: number) { setSteps(steps.filter((_, idx) => idx !== i)) }
  function updateStep(i: number, field: keyof StepRow, val: string) {
    const next = [...steps]; next[i] = { ...next[i], [field]: val }; setSteps(next)
  }

  async function generate() {
    if (!funnelName.trim()) { toast.error('Enter a funnel name'); return }
    const validSteps = steps.filter((s) => s.name.trim() && s.users)
    if (validSteps.length < 2) { toast.error('Add at least 2 funnel steps with user counts'); return }

    abortRef.current?.abort(); abortRef.current = new AbortController()
    store.setIsStreaming(true); store.clearSteps(); store.clearStreamText(); setResult(null)

    const stepsPayload = validSteps.map((s) => ({
      name: s.name,
      users: parseInt(s.users),
      ...(s.drop_off_reasons && { drop_off_reasons: s.drop_off_reasons.split(',').map((r) => r.trim()).filter(Boolean) }),
    }))

    try {
      await api.pillar7.streamFunnelAnalysis(projectId,
        { funnel_name: funnelName.trim(), steps: stepsPayload, time_period: period, goal_conversion_event: goalEvent,
          ...(benchmark.trim() && { industry_benchmark: benchmark.trim() }) },
        {
          onStep: (s, l, st) => store.upsertStep(s, l, st as ProgressStep['status']),
          onDelta: (t) => store.appendStreamText(t),
          onSaved: (_, p) => { setResult(p as unknown as FunnelPayload); store.clearStreamText(); store.setIsStreaming(false); toast.success('Funnel analysis ready!') },
          onError: (m) => { toast.error(m); store.setIsStreaming(false) },
          onDone: () => store.setIsStreaming(false),
        }, abortRef.current.signal)
    } catch { store.setIsStreaming(false) }
  }

  const form = (
    <>
      <h2 className="font-semibold text-sm">Funnel Conversion Analysis</h2>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Funnel Name *</label>
          <input value={funnelName} onChange={(e) => setFunnelName(e.target.value)} placeholder="e.g. Free-to-Paid Conversion"
            className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Time Period</label>
          <input value={period} onChange={(e) => setPeriod(e.target.value)} placeholder="e.g. Last 30 days"
            className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Goal Conversion Event</label>
          <input value={goalEvent} onChange={(e) => setGoalEvent(e.target.value)} placeholder="e.g. paid subscription"
            className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Industry Benchmark (optional)</label>
          <input value={benchmark} onChange={(e) => setBenchmark(e.target.value)} placeholder="e.g. SaaS free-to-paid ~3-5%"
            className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Funnel Steps *</label>
          {steps.length < 10 && (
            <button onClick={addStep} className="flex items-center gap-1 text-xs text-primary hover:text-primary/80"><Plus className="w-3 h-3" /> Add step</button>
          )}
        </div>
        <div className="space-y-2">
          {steps.map((s, i) => (
            <div key={i} className="flex items-start gap-2">
              <div className="flex flex-col items-center mt-2">
                <div className="w-5 h-5 rounded-full bg-primary/10 text-primary text-[10px] font-bold flex items-center justify-center shrink-0">{i + 1}</div>
                {i < steps.length - 1 && <div className="w-0.5 h-4 bg-border mt-1" />}
              </div>
              <div className="flex-1 grid grid-cols-3 gap-2">
                <input value={s.name} onChange={(e) => updateStep(i, 'name', e.target.value)} placeholder="Step name"
                  className="px-2 py-1.5 text-xs bg-background border border-border rounded focus:outline-none" />
                <input value={s.users} onChange={(e) => updateStep(i, 'users', e.target.value)} placeholder="Users" type="number" min="0"
                  className="px-2 py-1.5 text-xs bg-background border border-border rounded focus:outline-none" />
                <input value={s.drop_off_reasons} onChange={(e) => updateStep(i, 'drop_off_reasons', e.target.value)}
                  placeholder="Known drop-off reasons (comma-separated)"
                  className="px-2 py-1.5 text-xs bg-background border border-border rounded focus:outline-none" />
              </div>
              {steps.length > 2 && (
                <button onClick={() => removeStep(i)} className="text-muted-foreground hover:text-destructive mt-2"><X className="w-3.5 h-3.5" /></button>
              )}
            </div>
          ))}
        </div>
      </div>
    </>
  )

  const resultNode = result ? (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-semibold text-sm">{result.funnel_name}</h2>
          <p className="text-xs text-muted-foreground">{result.time_period}</p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold">{result.overall_conversion_rate_pct?.toFixed(2)}%</p>
          <p className="text-[10px] text-muted-foreground">overall conversion</p>
        </div>
      </div>
      {result.benchmark_assessment && <p className="text-xs text-muted-foreground italic">{result.benchmark_assessment}</p>}
      <p className="text-sm">{result.executive_summary}</p>

      {result.biggest_leak && (
        <div className="p-4 rounded-xl border border-red-200/50 bg-red-50/50 dark:bg-red-900/10 dark:border-red-900/30">
          <p className="text-xs font-semibold text-red-600 dark:text-red-400 mb-1">Biggest Leak - {result.biggest_leak.step}</p>
          <p className="text-xs"><span className="font-medium">{result.biggest_leak.users_lost?.toLocaleString()} users lost.</span> {result.biggest_leak.root_cause}</p>
          <p className="text-[10px] text-primary mt-1 font-medium">Fix: {result.biggest_leak.priority_fix}</p>
        </div>
      )}

      <div className="space-y-2">
        {result.steps_analysis?.map((step, i) => (
          <div key={i} className="p-3 rounded-xl border border-border bg-card space-y-1">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-muted text-[10px] font-bold flex items-center justify-center">{i + 1}</span>
                <p className="text-xs font-medium">{step.step_name}</p>
              </div>
              <div className="flex items-center gap-2">
                {i > 0 && <span className="text-xs font-bold">{step.conversion_rate_from_prev_pct?.toFixed(1)}%</span>}
                <span className={cn('text-[10px] px-1.5 py-0.5 rounded-full font-medium capitalize', PERF_STYLES[step.performance] ?? 'bg-muted text-muted-foreground')}>
                  {step.performance}
                </span>
              </div>
            </div>
            {step.drop_off_diagnosis && <p className="text-[10px] text-muted-foreground">{step.drop_off_diagnosis}</p>}
            {step.fix_recommendation && (
              <p className="text-[10px] text-primary">Fix: {step.fix_recommendation} <span className="text-muted-foreground">({step.expected_impact})</span></p>
            )}
          </div>
        ))}
      </div>

      {result.quick_wins?.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Quick Wins</p>
          {result.quick_wins.map((w, i) => (
            <div key={i} className="flex items-start gap-3 p-3 rounded-xl border border-border bg-card">
              <span className={cn('shrink-0 text-[10px] px-1.5 py-0.5 rounded-full font-medium mt-0.5', EFFORT_STYLES[w.effort] ?? '')}>{w.effort}</span>
              <div>
                <p className="text-xs font-medium">{w.action}</p>
                <p className="text-[10px] text-muted-foreground">Step: {w.target_step} · {w.expected_lift}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {result.revenue_opportunity && (
        <div className="p-3 rounded-lg border border-primary/20 bg-primary/5 text-xs">
          <span className="font-semibold text-primary">Revenue opportunity: </span>{result.revenue_opportunity}
        </div>
      )}

      {result.ab_tests_to_run?.length > 0 && (
        <div className="p-4 rounded-xl border border-border bg-card space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">A/B Tests to Run</p>
          {result.ab_tests_to_run.map((t, i) => (
            <div key={i} className="text-xs space-y-0.5">
              <p className="font-medium">{t.test}</p>
              <p className="text-muted-foreground">Step: {t.step} · {t.hypothesis}</p>
              <p className="text-[10px] text-primary">Success metric: {t.success_metric}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  ) : null

  const canSubmit = !!funnelName.trim() && steps.filter((s) => s.users).length >= 2

  return (
    <SSEFeaturePage projectId={projectId} title="Funnel Conversion Analysis" subtitle="Pillar 7 - Claude"
      icon={<TrendingUp className="w-4 h-4" />} credits={15} steps={store.steps}
      isStreaming={store.isStreaming} streamText={store.streamText} form={form} result={resultNode}
      onSubmit={generate} submitLabel="Analyse Funnel - 15 credits" canSubmit={canSubmit}
      backPath={`/projects/${projectId}/analytics-pro`} />
  )
}
