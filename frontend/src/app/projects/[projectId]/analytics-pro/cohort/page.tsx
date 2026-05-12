'use client'

import { useState, useRef } from 'react'
import { useParams } from 'next/navigation'
import { Users, Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import { SSEFeaturePage } from '@/components/pillar1/SSEFeaturePage'
import { api } from '@/lib/api'
import { usePillar7Store } from '@/stores/pillar7-store'
import type { ProgressStep } from '@/types'
import { cn } from '@/lib/utils'

const COHORT_TYPES = ['retention', 'revenue', 'activation', 'feature_adoption']

interface CohortRow { cohort_name: string; initial_users: string; week0: string; week1: string; week2: string; week4: string; week8: string; week12: string }
interface CohortTrend { cohort: string; avg_retention_pct: number; trend_vs_prev: string; notable_observation: string }
interface QuickWin { action: string; expected_impact: string; effort: string; timeline: string }
interface Experiment { experiment: string; hypothesis: string; success_metric: string }
interface CohortPayload {
  product_name: string; cohort_type: string; analysis_summary: string; benchmark_comparison: string
  retention_curve_shape: string; critical_drop_off_period: string; cohort_trends: CohortTrend[]
  best_cohort: string; worst_cohort: string
  root_causes: { hypothesis: string; evidence_from_data: string; confidence: string }[]
  quick_wins: QuickWin[]; experiments_to_run: Experiment[]
  north_star_metric: string; six_month_outlook: string
}

function newCohort(i: number): CohortRow {
  return { cohort_name: `Cohort ${i + 1}`, initial_users: '', week0: '100', week1: '', week2: '', week4: '', week8: '', week12: '' }
}

const TREND_STYLES: Record<string, string> = {
  improving: 'text-green-600 dark:text-green-400',
  stable:    'text-muted-foreground',
  declining: 'text-red-600 dark:text-red-400',
}

export default function CohortAnalysisPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const store = usePillar7Store()

  const [productName, setProductName] = useState('')
  const [cohortType, setCohortType] = useState('retention')
  const [businessContext, setBusinessContext] = useState('')
  const [cohorts, setCohorts] = useState<CohortRow[]>([newCohort(0), newCohort(1), newCohort(2)])
  const [result, setResult] = useState<CohortPayload | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  function addCohort() { if (cohorts.length < 24) setCohorts([...cohorts, newCohort(cohorts.length)]) }
  function removeCohort(i: number) { setCohorts(cohorts.filter((_, idx) => idx !== i)) }
  function updateCohort(i: number, field: keyof CohortRow, val: string) {
    const next = [...cohorts]; next[i] = { ...next[i], [field]: val }; setCohorts(next)
  }

  async function generate() {
    if (!productName.trim()) { toast.error('Enter your product name'); return }
    const validCohorts = cohorts.filter((c) => c.cohort_name.trim() && c.initial_users)
    if (validCohorts.length < 1) { toast.error('Add at least one cohort with initial users'); return }

    abortRef.current?.abort(); abortRef.current = new AbortController()
    store.setIsStreaming(true); store.clearSteps(); store.clearStreamText(); setResult(null)

    const payload = validCohorts.map((c) => ({
      cohort_name: c.cohort_name,
      initial_users: parseInt(c.initial_users),
      ...(c.week0 && { week0: parseFloat(c.week0) }),
      ...(c.week1 && { week1: parseFloat(c.week1) }),
      ...(c.week2 && { week2: parseFloat(c.week2) }),
      ...(c.week4 && { week4: parseFloat(c.week4) }),
      ...(c.week8 && { week8: parseFloat(c.week8) }),
      ...(c.week12 && { week12: parseFloat(c.week12) }),
    }))

    try {
      await api.pillar7.streamCohortAnalysis(projectId,
        { product_name: productName.trim(), cohort_type: cohortType, cohorts: payload,
          ...(businessContext.trim() && { business_context: businessContext.trim() }) },
        {
          onStep: (s, l, st) => store.upsertStep(s, l, st as ProgressStep['status']),
          onDelta: (t) => store.appendStreamText(t),
          onSaved: (_, p) => { setResult(p as unknown as CohortPayload); store.clearStreamText(); store.setIsStreaming(false); toast.success('Cohort analysis ready!') },
          onError: (m) => { toast.error(m); store.setIsStreaming(false) },
          onDone: () => store.setIsStreaming(false),
        }, abortRef.current.signal)
    } catch { store.setIsStreaming(false) }
  }

  const form = (
    <>
      <h2 className="font-semibold text-sm">Cohort Analysis</h2>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Product Name *</label>
          <input value={productName} onChange={(e) => setProductName(e.target.value)} placeholder="e.g. LEO"
            className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Cohort Type</label>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {COHORT_TYPES.map((t) => (
              <button key={t} onClick={() => setCohortType(t)}
                className={cn('px-2.5 py-1 text-xs rounded-lg border capitalize transition-colors',
                  cohortType === t ? 'bg-primary text-primary-foreground border-primary' : 'bg-background border-border hover:border-primary/50')}>
                {t.replace(/_/g, ' ')}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div>
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Business Context (optional)</label>
        <textarea value={businessContext} onChange={(e) => setBusinessContext(e.target.value)} rows={2}
          placeholder="e.g. We launched a new onboarding flow in February - check if week 2 retention improved"
          className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary resize-none" />
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Cohorts - retention % per period</label>
          {cohorts.length < 24 && (
            <button onClick={addCohort} className="flex items-center gap-1 text-xs text-primary hover:text-primary/80"><Plus className="w-3 h-3" /> Add cohort</button>
          )}
        </div>
        <div className="rounded-lg border border-border overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-muted">
                {['Cohort Name', 'Users', 'Wk 0', 'Wk 1', 'Wk 2', 'Wk 4', 'Wk 8', 'Wk 12', ''].map((h) => (
                  <th key={h} className="px-2 py-2 text-left text-[10px] font-semibold text-muted-foreground">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {cohorts.map((c, i) => (
                <tr key={i} className="border-t border-border">
                  <td className="px-2 py-1.5"><input value={c.cohort_name} onChange={(e) => updateCohort(i, 'cohort_name', e.target.value)} className="w-32 px-2 py-1 text-xs bg-background border border-border rounded focus:outline-none" /></td>
                  <td className="px-2 py-1.5"><input value={c.initial_users} onChange={(e) => updateCohort(i, 'initial_users', e.target.value)} type="number" placeholder="1000" className="w-20 px-2 py-1 text-xs bg-background border border-border rounded focus:outline-none" /></td>
                  {(['week0', 'week1', 'week2', 'week4', 'week8', 'week12'] as (keyof CohortRow)[]).map((wk) => (
                    <td key={wk} className="px-2 py-1.5"><input value={c[wk]} onChange={(e) => updateCohort(i, wk, e.target.value)} type="number" min="0" max="100" step="0.1" placeholder="%" className="w-16 px-2 py-1 text-xs bg-background border border-border rounded focus:outline-none" /></td>
                  ))}
                  <td className="px-2 py-1.5">{cohorts.length > 1 && <button onClick={() => removeCohort(i)} className="text-muted-foreground hover:text-destructive"><X className="w-3.5 h-3.5" /></button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[10px] text-muted-foreground mt-1">Enter retention as percentages (e.g. 45.2 = 45.2% retained)</p>
      </div>
    </>
  )

  const resultNode = result ? (
    <div className="space-y-4">
      <p className="text-sm">{result.analysis_summary}</p>
      <div className="grid grid-cols-2 gap-3">
        <div className="p-3 rounded-xl border border-border bg-card">
          <p className="text-[10px] font-semibold text-muted-foreground mb-1">Curve Shape</p>
          <p className="text-xs">{result.retention_curve_shape}</p>
        </div>
        <div className="p-3 rounded-xl border border-red-200/50 bg-red-50/50 dark:bg-red-900/10 dark:border-red-900/30">
          <p className="text-[10px] font-semibold text-red-600 dark:text-red-400 mb-1">Critical Drop-off</p>
          <p className="text-xs font-bold">{result.critical_drop_off_period}</p>
        </div>
      </div>

      {result.cohort_trends?.length > 0 && (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="grid grid-cols-[2fr_1fr_1fr] gap-0 bg-muted px-4 py-2.5">
            {['Cohort', 'Avg Retention', 'Trend'].map((h) => <p key={h} className="text-[10px] font-semibold text-muted-foreground">{h}</p>)}
          </div>
          {result.cohort_trends.map((t, i) => (
            <div key={i} className="grid grid-cols-[2fr_1fr_1fr] gap-0 px-4 py-2.5 border-t border-border items-center">
              <div>
                <p className="text-xs font-medium">{t.cohort}</p>
                <p className="text-[10px] text-muted-foreground">{t.notable_observation}</p>
              </div>
              <p className="text-xs font-bold">{t.avg_retention_pct?.toFixed(1)}%</p>
              <span className={cn('text-xs font-medium capitalize', TREND_STYLES[t.trend_vs_prev] ?? '')}>{t.trend_vs_prev}</span>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        {result.best_cohort && (
          <div className="p-3 rounded-xl border border-green-200/50 bg-green-50/50 dark:bg-green-900/10">
            <p className="text-[10px] font-semibold text-green-600 dark:text-green-400 mb-1">Best Cohort</p>
            <p className="text-xs">{result.best_cohort}</p>
          </div>
        )}
        {result.worst_cohort && (
          <div className="p-3 rounded-xl border border-red-200/50 bg-red-50/50 dark:bg-red-900/10">
            <p className="text-[10px] font-semibold text-red-600 dark:text-red-400 mb-1">Worst Cohort</p>
            <p className="text-xs">{result.worst_cohort}</p>
          </div>
        )}
      </div>

      {result.root_causes?.length > 0 && (
        <div className="p-4 rounded-xl border border-border bg-card space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Root Cause Hypotheses</p>
          {result.root_causes.map((r, i) => (
            <div key={i} className="space-y-0.5">
              <div className="flex items-center gap-2">
                <p className="text-xs font-medium flex-1">{r.hypothesis}</p>
                <span className={cn('text-[10px] px-1.5 py-0.5 rounded-full shrink-0',
                  r.confidence === 'high' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                  : r.confidence === 'medium' ? 'bg-yellow-100 text-yellow-700' : 'bg-muted text-muted-foreground')}>
                  {r.confidence}
                </span>
              </div>
              <p className="text-[10px] text-muted-foreground">{r.evidence_from_data}</p>
            </div>
          ))}
        </div>
      )}

      {result.quick_wins?.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Quick Wins</p>
          {result.quick_wins.map((w, i) => (
            <div key={i} className="p-3 rounded-xl border border-border bg-card flex items-start gap-3">
              <span className={cn('shrink-0 mt-0.5 text-[10px] px-1.5 py-0.5 rounded-full font-medium capitalize',
                w.effort === 'low' ? 'bg-green-100 text-green-700' : w.effort === 'medium' ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700')}>
                {w.effort}
              </span>
              <div className="flex-1">
                <p className="text-xs font-medium">{w.action}</p>
                <p className="text-[10px] text-primary">{w.expected_impact} · {w.timeline}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {result.north_star_metric && (
        <div className="p-3 rounded-lg border border-primary/20 bg-primary/5 text-xs">
          <span className="font-semibold text-primary">North Star: </span>{result.north_star_metric}
        </div>
      )}
      {result.six_month_outlook && (
        <p className="text-xs text-muted-foreground italic">{result.six_month_outlook}</p>
      )}
    </div>
  ) : null

  const canSubmit = !!productName.trim() && cohorts.some((c) => c.initial_users)

  return (
    <SSEFeaturePage projectId={projectId} title="Cohort Analysis" subtitle="Pillar 7 - Claude"
      icon={<Users className="w-4 h-4" />} credits={20} steps={store.steps}
      isStreaming={store.isStreaming} streamText={store.streamText} form={form} result={resultNode}
      onSubmit={generate} submitLabel="Analyse Cohorts - 20 credits" canSubmit={canSubmit}
      backPath={`/projects/${projectId}/analytics-pro`} />
  )
}
