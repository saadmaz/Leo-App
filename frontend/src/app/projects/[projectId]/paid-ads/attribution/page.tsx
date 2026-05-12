'use client'

import { useState, useRef } from 'react'
import { useParams } from 'next/navigation'
import { BarChart2, Plus, X, Info } from 'lucide-react'
import { toast } from 'sonner'
import { SSEFeaturePage } from '@/components/pillar1/SSEFeaturePage'
import { api } from '@/lib/api'
import { usePillar4Store } from '@/stores/pillar4-store'
import type { ProgressStep } from '@/types'
import { cn } from '@/lib/utils'

interface ChannelRow {
  channel: string
  sessions: string
  conversions: string
  revenue: string
  cost: string
}

interface ChannelBreakdown {
  channel: string
  sessions: number
  conversions: number
  revenue: number
  cost: number
  roas: number
  cpa: number
  conversion_rate_pct: number
  attributed_share_pct: number
  performance_label: string
  insight: string
}

interface BudgetRec {
  action: string
  channel: string
  current_share_pct: number
  recommended_share_pct: number
  rationale: string
}

interface AttributionPayload {
  analysis_period: string
  conversion_goal: string
  data_source: string
  total_conversions: number
  total_revenue: number
  total_cost: number
  overall_roas: number
  channel_breakdown: ChannelBreakdown[]
  model_comparison: {
    last_click: string
    first_click: string
    linear: string
    data_driven_estimate: string
  }
  budget_recommendations: BudgetRec[]
  top_opportunities: string[]
  risks: string[]
  next_steps: string[]
}

const PERFORMANCE_COLORS: Record<string, string> = {
  top_performer: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  average: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
  underperformer: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  brand_awareness: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
}

const ACTION_COLORS: Record<string, string> = {
  increase: 'text-green-600 dark:text-green-400',
  decrease: 'text-red-600 dark:text-red-400',
  maintain: 'text-muted-foreground',
  pause: 'text-red-700 dark:text-red-400 font-semibold',
  test: 'text-blue-600 dark:text-blue-400',
}

const DEFAULT_CHANNELS = ['Organic Search', 'Paid Search', 'Paid Social', 'Email', 'Direct', 'Referral']

export default function AttributionPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const store = usePillar4Store()

  const [dateRangeDays, setDateRangeDays] = useState(30)
  const [conversionGoal, setConversionGoal] = useState('purchase')
  const [currency, setCurrency] = useState('USD')
  const [channels, setChannels] = useState<ChannelRow[]>([
    { channel: '', sessions: '', conversions: '', revenue: '', cost: '' },
  ])
  const [result, setResult] = useState<AttributionPayload | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  function addChannel() {
    if (channels.length < 12) setChannels([...channels, { channel: '', sessions: '', conversions: '', revenue: '', cost: '' }])
  }
  function removeChannel(i: number) { setChannels(channels.filter((_, idx) => idx !== i)) }
  function updateChannel(i: number, field: keyof ChannelRow, val: string) {
    const next = [...channels]
    next[i] = { ...next[i], [field]: val }
    setChannels(next)
  }
  function presetChannel(i: number, name: string) {
    const next = [...channels]
    next[i] = { ...next[i], channel: name }
    setChannels(next)
  }

  async function generate() {
    const validChannels = channels.filter((c) => c.channel.trim())
    if (validChannels.length === 0) {
      toast.error('Add at least one channel with data, or connect GA4 via settings')
      return
    }

    abortRef.current?.abort()
    abortRef.current = new AbortController()
    store.setIsStreaming(true)
    store.clearSteps()
    store.clearStreamText()
    setResult(null)

    const channelData = validChannels.map((c) => ({
      channel: c.channel.trim(),
      sessions: parseInt(c.sessions) || 0,
      conversions: parseInt(c.conversions) || 0,
      revenue: parseFloat(c.revenue) || 0,
      cost: parseFloat(c.cost) || 0,
    }))

    try {
      await api.pillar4.streamAttribution(
        projectId,
        {
          date_range_days: dateRangeDays,
          channel_data: channelData,
          conversion_goal: conversionGoal.trim(),
          currency,
        },
        {
          onStep: (step, label, status) => store.upsertStep(step, label, status as ProgressStep['status']),
          onDelta: (text) => store.appendStreamText(text),
          onSaved: (_id, payload) => {
            setResult(payload as unknown as AttributionPayload)
            store.clearStreamText()
            store.setIsStreaming(false)
            toast.success('Attribution analysis ready!')
          },
          onError: (msg) => { toast.error(msg); store.setIsStreaming(false) },
          onDone: () => store.setIsStreaming(false),
        },
        abortRef.current.signal,
      )
    } catch { store.setIsStreaming(false) }
  }

  const canSubmit = channels.some((c) => c.channel.trim())

  const form = (
    <>
      <h2 className="font-semibold text-sm">Cross-Channel Attribution</h2>

      <div className="p-3 rounded-lg bg-primary/5 border border-primary/20 flex items-start gap-2">
        <Info className="w-3.5 h-3.5 text-primary shrink-0 mt-0.5" />
        <p className="text-[10px] text-muted-foreground">
          <span className="font-medium text-foreground">GA4 connected?</span> If you&apos;ve set GA4_PROPERTY_ID + GA4_SERVICE_ACCOUNT_KEY in your .env, data will be pulled automatically - leave the table empty.
          Otherwise, enter channel metrics manually below.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Date Range</label>
          <select value={dateRangeDays} onChange={(e) => setDateRangeDays(Number(e.target.value))}
            className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary">
            {[7, 14, 30, 60, 90, 180, 365].map((d) => (
              <option key={d} value={d}>Last {d} days</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Conversion Goal</label>
          <input value={conversionGoal} onChange={(e) => setConversionGoal(e.target.value)}
            placeholder="e.g. purchase, sign_up"
            className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Currency</label>
          <select value={currency} onChange={(e) => setCurrency(e.target.value)}
            className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary">
            {['USD', 'GBP', 'EUR', 'AUD', 'CAD'].map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Channel Data (Manual)</label>
          <button onClick={addChannel} className="flex items-center gap-1 text-xs text-primary hover:text-primary/80">
            <Plus className="w-3 h-3" /> Add Channel
          </button>
        </div>

        <div className="flex flex-wrap gap-1 mb-2">
          {DEFAULT_CHANNELS.map((name) => (
            <button key={name} onClick={() => {
              const empty = channels.findIndex((c) => !c.channel.trim())
              if (empty !== -1) presetChannel(empty, name)
              else setChannels([...channels, { channel: name, sessions: '', conversions: '', revenue: '', cost: '' }])
            }}
              className="text-[10px] px-2 py-0.5 rounded-full border border-border hover:border-primary/50 hover:text-primary transition-colors">
              {name}
            </button>
          ))}
        </div>

        <div className="rounded-lg border border-border overflow-hidden">
          {/* Header */}
          <div className="grid grid-cols-[1.5fr_1fr_1fr_1fr_1fr_auto] gap-0 bg-muted px-3 py-2">
            {['Channel', 'Sessions', 'Conversions', 'Revenue', 'Cost', ''].map((h, i) => (
              <p key={i} className="text-[10px] font-semibold text-muted-foreground">{h}</p>
            ))}
          </div>
          {channels.map((c, i) => (
            <div key={i} className="grid grid-cols-[1.5fr_1fr_1fr_1fr_1fr_auto] gap-1 px-2 py-1.5 border-t border-border items-center">
              <input value={c.channel} onChange={(e) => updateChannel(i, 'channel', e.target.value)}
                placeholder="e.g. Paid Search"
                className="px-2 py-1 text-xs bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary" />
              <input value={c.sessions} onChange={(e) => updateChannel(i, 'sessions', e.target.value)}
                placeholder="0" type="number" min="0"
                className="px-2 py-1 text-xs bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary" />
              <input value={c.conversions} onChange={(e) => updateChannel(i, 'conversions', e.target.value)}
                placeholder="0" type="number" min="0"
                className="px-2 py-1 text-xs bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary" />
              <input value={c.revenue} onChange={(e) => updateChannel(i, 'revenue', e.target.value)}
                placeholder="0.00" type="number" min="0"
                className="px-2 py-1 text-xs bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary" />
              <input value={c.cost} onChange={(e) => updateChannel(i, 'cost', e.target.value)}
                placeholder="0.00" type="number" min="0"
                className="px-2 py-1 text-xs bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary" />
              <button onClick={() => removeChannel(i)} className="text-muted-foreground hover:text-destructive transition-colors p-1">
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
        <p className="text-[10px] text-muted-foreground mt-1">Leave Cost as 0 for organic/free channels.</p>
      </div>
    </>
  )

  function fmt(n: number, prefix = '') {
    if (!n && n !== 0) return '-'
    return `${prefix}${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
  }

  const resultNode = result ? (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-semibold text-sm">Attribution Analysis - {result.analysis_period}</h2>
          <p className="text-xs text-muted-foreground">{result.conversion_goal} · Source: {result.data_source}</p>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: 'Total Conversions', value: fmt(result.total_conversions) },
          { label: 'Total Revenue', value: fmt(result.total_revenue, '$') },
          { label: 'Total Cost', value: fmt(result.total_cost, '$') },
          { label: 'Overall ROAS', value: result.overall_roas ? `${result.overall_roas.toFixed(2)}x` : '-' },
        ].map((s) => (
          <div key={s.label} className="p-3 rounded-xl border border-border bg-card text-center">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{s.label}</p>
            <p className="text-lg font-bold mt-0.5">{s.value}</p>
          </div>
        ))}
      </div>

      {/* Channel breakdown */}
      {result.channel_breakdown?.length > 0 && (
        <div className="rounded-xl border border-border overflow-hidden">
          <div className="bg-muted px-3 py-2 grid grid-cols-[1.5fr_1fr_1fr_1fr_1fr_auto] gap-2">
            {['Channel', 'Conv. Rate', 'ROAS', 'CPA', 'Share %', 'Status'].map((h) => (
              <p key={h} className="text-[10px] font-semibold text-muted-foreground">{h}</p>
            ))}
          </div>
          {result.channel_breakdown.map((ch, i) => (
            <div key={i} className="border-t border-border">
              <div className="px-3 py-2.5 grid grid-cols-[1.5fr_1fr_1fr_1fr_1fr_auto] gap-2 items-start">
                <p className="text-xs font-medium">{ch.channel}</p>
                <p className="text-xs font-mono">{ch.conversion_rate_pct?.toFixed(1) ?? '-'}%</p>
                <p className="text-xs font-mono">{ch.roas ? `${ch.roas.toFixed(2)}x` : '-'}</p>
                <p className="text-xs font-mono">{ch.cpa ? `$${ch.cpa.toFixed(2)}` : '-'}</p>
                <div className="flex items-center gap-1">
                  <div className="w-12 h-1 bg-muted rounded-full overflow-hidden">
                    <div className="h-full bg-primary rounded-full" style={{ width: `${Math.min(ch.attributed_share_pct, 100)}%` }} />
                  </div>
                  <span className="text-xs font-mono">{ch.attributed_share_pct?.toFixed(0)}%</span>
                </div>
                <span className={cn(
                  'text-[10px] px-1.5 py-0.5 rounded-full font-medium whitespace-nowrap',
                  PERFORMANCE_COLORS[ch.performance_label] ?? 'bg-muted text-muted-foreground',
                )}>
                  {ch.performance_label?.replace(/_/g, ' ')}
                </span>
              </div>
              {ch.insight && (
                <p className="px-3 pb-2 text-[10px] text-muted-foreground">{ch.insight}</p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Budget recommendations */}
      {result.budget_recommendations?.length > 0 && (
        <div className="p-4 rounded-xl border border-border bg-card space-y-3">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Budget Recommendations</p>
          {result.budget_recommendations.map((r, i) => (
            <div key={i} className="text-xs space-y-0.5">
              <div className="flex items-center gap-2">
                <span className={cn('font-semibold capitalize', ACTION_COLORS[r.action] ?? 'text-foreground')}>{r.action}</span>
                <span className="font-medium">{r.channel}</span>
                <span className="text-muted-foreground ml-auto">{r.current_share_pct}% → {r.recommended_share_pct}%</span>
              </div>
              <p className="text-muted-foreground">{r.rationale}</p>
            </div>
          ))}
        </div>
      )}

      {/* Model comparison */}
      {result.model_comparison && (
        <div className="p-4 rounded-xl border border-border bg-card space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Attribution Model Comparison</p>
          {Object.entries(result.model_comparison).map(([model, desc]) => (
            <div key={model} className="text-xs">
              <span className="font-medium capitalize mr-1">{model.replace(/_/g, ' ')}:</span>
              <span className="text-muted-foreground">{desc}</span>
            </div>
          ))}
        </div>
      )}

      {result.top_opportunities?.length > 0 && (
        <div className="p-4 rounded-xl border border-primary/20 bg-primary/5 space-y-1">
          <p className="text-xs font-semibold text-primary uppercase tracking-wide mb-2">Top Opportunities</p>
          {result.top_opportunities.map((o, i) => (
            <p key={i} className="text-xs text-muted-foreground">⭐ {o}</p>
          ))}
        </div>
      )}

      {result.risks?.length > 0 && (
        <div className="p-4 rounded-xl border border-red-200/50 bg-red-50/50 dark:bg-red-900/10 dark:border-red-900/30 space-y-1">
          <p className="text-xs font-semibold text-red-600 dark:text-red-400 uppercase tracking-wide mb-2">Risks to Watch</p>
          {result.risks.map((r, i) => (
            <p key={i} className="text-xs text-muted-foreground">⚠ {r}</p>
          ))}
        </div>
      )}

      {result.next_steps?.length > 0 && (
        <div className="p-4 rounded-xl border border-border bg-card space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Next Steps</p>
          {result.next_steps.map((s, i) => (
            <div key={i} className="flex items-start gap-2 text-xs">
              <div className="w-4 h-4 rounded border border-border shrink-0 mt-0.5" />
              <span>{s}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  ) : null

  return (
    <SSEFeaturePage
      projectId={projectId}
      title="Cross-Channel Attribution"
      subtitle="Pillar 4 - GA4 + Claude"
      icon={<BarChart2 className="w-4 h-4" />}
      credits={20}
      steps={store.steps}
      isStreaming={store.isStreaming}
      streamText={store.streamText}
      form={form}
      result={resultNode}
      onSubmit={generate}
      submitLabel="Analyse Attribution - 20 credits"
      canSubmit={canSubmit}
      backPath={`/projects/${projectId}/paid-ads`}
    />
  )
}
