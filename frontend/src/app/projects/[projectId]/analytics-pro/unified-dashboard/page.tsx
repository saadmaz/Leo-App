'use client'

import { useState, useRef } from 'react'
import { useParams } from 'next/navigation'
import { LayoutDashboard, Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import { SSEFeaturePage } from '@/components/pillar1/SSEFeaturePage'
import { api } from '@/lib/api'
import { usePillar7Store } from '@/stores/pillar7-store'
import type { ProgressStep } from '@/types'
import { cn } from '@/lib/utils'

const PERF_STYLES: Record<string, string> = {
  excellent: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  good:      'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  average:   'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
  poor:      'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
}
const TREND_ICONS: Record<string, string> = { up: '↑', flat: '→', down: '↓' }

interface ChannelRow { channel: string; sessions: string; conversions: string; revenue: string; spend: string }
interface ChannelResult { channel: string; sessions_or_reach: number; conversions: number; revenue: number; spend: number; roas: number; cpa: number; trend: string; performance_rating: string; key_insight: string }
interface DashboardPayload {
  period: string; data_sources: string[]; executive_summary: string; overall_health_score: number; health_rationale: string
  channel_matrix: ChannelResult[]; top_performing_channel: string; underperforming_channel: string
  budget_shift_recommendation: string; content_performance_note: string; quick_wins: string[]; strategic_priorities: string[]; risks_to_watch: string[]
}

function newChannel(i: number): ChannelRow {
  return { channel: '', sessions: '', conversions: '', revenue: '', spend: '' }
}

export default function UnifiedDashboardPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const store = usePillar7Store()

  const [dateRange, setDateRange] = useState(30)
  const [goals, setGoals] = useState(['traffic', 'conversions', 'revenue'])
  const [channels, setChannels] = useState<ChannelRow[]>([newChannel(0)])
  const [includeGa4, setIncludeGa4] = useState(true)
  const [includeMeta, setIncludeMeta] = useState(false)
  const [metaAccountId, setMetaAccountId] = useState('')
  const [result, setResult] = useState<DashboardPayload | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  function addChannel() { setChannels([...channels, newChannel(channels.length)]) }
  function removeChannel(i: number) { setChannels(channels.filter((_, idx) => idx !== i)) }
  function updateChannel(i: number, field: keyof ChannelRow, val: string) {
    const next = [...channels]; next[i] = { ...next[i], [field]: val }; setChannels(next)
  }
  function toggleGoal(g: string) {
    setGoals((prev) => prev.includes(g) ? prev.filter((x) => x !== g) : [...prev, g])
  }

  async function generate() {
    const validChannels = channels.filter((c) => c.channel.trim())
    abortRef.current?.abort(); abortRef.current = new AbortController()
    store.setIsStreaming(true); store.clearSteps(); store.clearStreamText(); setResult(null)

    const manualData = validChannels.length > 0 ? validChannels.map((c) => ({
      channel: c.channel,
      ...(c.sessions && { sessions: parseInt(c.sessions) }),
      ...(c.conversions && { conversions: parseInt(c.conversions) }),
      ...(c.revenue && { revenue: parseFloat(c.revenue) }),
      ...(c.spend && { spend: parseFloat(c.spend) }),
    })) : undefined

    try {
      await api.pillar7.streamUnifiedDashboard(projectId,
        { date_range_days: dateRange, goals, manual_channel_data: manualData,
          include_meta: includeMeta, ...(includeMeta && metaAccountId && { meta_ad_account_id: metaAccountId }) },
        {
          onStep: (s, l, st) => store.upsertStep(s, l, st as ProgressStep['status']),
          onDelta: (t) => store.appendStreamText(t),
          onSaved: (_, p) => { setResult(p as unknown as DashboardPayload); store.clearStreamText(); store.setIsStreaming(false); toast.success('Dashboard ready!') },
          onError: (m) => { toast.error(m); store.setIsStreaming(false) },
          onDone: () => store.setIsStreaming(false),
        }, abortRef.current.signal)
    } catch { store.setIsStreaming(false) }
  }

  const form = (
    <>
      <h2 className="font-semibold text-sm">Unified Analytics Dashboard</h2>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Date Range</label>
          <select value={dateRange} onChange={(e) => setDateRange(Number(e.target.value))}
            className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary">
            {[7, 14, 30, 60, 90, 180, 365].map((d) => <option key={d} value={d}>Last {d} days</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Focus Goals</label>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {['traffic', 'conversions', 'revenue', 'engagement', 'retention'].map((g) => (
              <button key={g} onClick={() => toggleGoal(g)}
                className={cn('px-2.5 py-1 text-xs rounded-lg border capitalize transition-colors',
                  goals.includes(g) ? 'bg-primary text-primary-foreground border-primary' : 'bg-background border-border hover:border-primary/50')}>
                {g}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="space-y-2 p-3 rounded-lg border border-border bg-muted/20">
        <div className="flex items-center gap-2">
          <input type="checkbox" id="ga4" checked={includeGa4} onChange={(e) => setIncludeGa4(e.target.checked)} className="rounded" />
          <label htmlFor="ga4" className="text-xs cursor-pointer">Auto-pull from GA4 (requires GA4_PROPERTY_ID + GA4_SERVICE_ACCOUNT_KEY)</label>
        </div>
        <div className="flex items-center gap-2">
          <input type="checkbox" id="meta" checked={includeMeta} onChange={(e) => setIncludeMeta(e.target.checked)} className="rounded" />
          <label htmlFor="meta" className="text-xs cursor-pointer">Pull Meta Ads Insights (requires META_ACCESS_TOKEN)</label>
        </div>
        {includeMeta && (
          <input value={metaAccountId} onChange={(e) => setMetaAccountId(e.target.value)} placeholder="Meta Ad Account ID (act_xxxxxxx)"
            className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary font-mono" />
        )}
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Manual Channel Data (optional)</label>
          <button onClick={addChannel} className="flex items-center gap-1 text-xs text-primary hover:text-primary/80"><Plus className="w-3 h-3" /> Add channel</button>
        </div>
        <div className="rounded-lg border border-border overflow-hidden">
          <div className="grid grid-cols-[1.5fr_1fr_1fr_1fr_1fr_auto] gap-0 bg-muted px-3 py-2">
            {['Channel', 'Sessions', 'Conversions', 'Revenue ($)', 'Spend ($)', ''].map((h) => (
              <p key={h} className="text-[10px] font-semibold text-muted-foreground">{h}</p>
            ))}
          </div>
          {channels.map((ch, i) => (
            <div key={i} className="grid grid-cols-[1.5fr_1fr_1fr_1fr_1fr_auto] gap-1 px-2 py-1.5 border-t border-border items-center">
              <input value={ch.channel} onChange={(e) => updateChannel(i, 'channel', e.target.value)} placeholder="organic_search"
                className="px-2 py-1 text-xs bg-background border border-border rounded focus:outline-none" />
              <input value={ch.sessions} onChange={(e) => updateChannel(i, 'sessions', e.target.value)} placeholder="12000" type="number"
                className="px-2 py-1 text-xs bg-background border border-border rounded focus:outline-none" />
              <input value={ch.conversions} onChange={(e) => updateChannel(i, 'conversions', e.target.value)} placeholder="240" type="number"
                className="px-2 py-1 text-xs bg-background border border-border rounded focus:outline-none" />
              <input value={ch.revenue} onChange={(e) => updateChannel(i, 'revenue', e.target.value)} placeholder="48000" type="number"
                className="px-2 py-1 text-xs bg-background border border-border rounded focus:outline-none" />
              <input value={ch.spend} onChange={(e) => updateChannel(i, 'spend', e.target.value)} placeholder="3000" type="number"
                className="px-2 py-1 text-xs bg-background border border-border rounded focus:outline-none" />
              {channels.length > 1 ? (
                <button onClick={() => removeChannel(i)} className="text-muted-foreground hover:text-destructive p-1"><X className="w-3 h-3" /></button>
              ) : <div />}
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
          <h2 className="font-semibold text-sm">{result.period}</h2>
          <p className="text-[10px] text-muted-foreground">Sources: {result.data_sources?.join(', ')}</p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold">{result.overall_health_score}</p>
          <p className="text-[10px] text-muted-foreground">Health score</p>
        </div>
      </div>
      <p className="text-sm">{result.executive_summary}</p>
      {result.health_rationale && <p className="text-xs text-muted-foreground italic">{result.health_rationale}</p>}

      {result.channel_matrix?.length > 0 && (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr] gap-0 bg-muted px-4 py-2.5">
            {['Channel', 'Sessions', 'Conv.', 'Revenue', 'ROAS', 'Rating'].map((h) => (
              <p key={h} className="text-[10px] font-semibold text-muted-foreground">{h}</p>
            ))}
          </div>
          {result.channel_matrix.map((ch, i) => (
            <div key={i} className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr] gap-0 px-4 py-2.5 border-t border-border items-center">
              <div>
                <p className="text-xs font-medium capitalize">{ch.channel?.replace(/_/g, ' ')}</p>
                <p className="text-[10px] text-muted-foreground">{TREND_ICONS[ch.trend]} {ch.key_insight}</p>
              </div>
              <p className="text-xs">{ch.sessions_or_reach?.toLocaleString()}</p>
              <p className="text-xs">{ch.conversions?.toLocaleString()}</p>
              <p className="text-xs">${ch.revenue?.toLocaleString()}</p>
              <p className="text-xs">{ch.roas ? `${ch.roas.toFixed(1)}x` : '-'}</p>
              <span className={cn('text-[10px] px-1.5 py-0.5 rounded-full font-medium capitalize', PERF_STYLES[ch.performance_rating] ?? 'bg-muted text-muted-foreground')}>
                {ch.performance_rating}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        {result.budget_shift_recommendation && (
          <div className="p-3 rounded-xl border border-primary/20 bg-primary/5">
            <p className="text-[10px] font-semibold text-primary mb-1">Budget Shift</p>
            <p className="text-xs">{result.budget_shift_recommendation}</p>
          </div>
        )}
        {result.content_performance_note && (
          <div className="p-3 rounded-xl border border-border bg-card">
            <p className="text-[10px] font-semibold text-muted-foreground mb-1">Content</p>
            <p className="text-xs">{result.content_performance_note}</p>
          </div>
        )}
      </div>

      {result.quick_wins?.length > 0 && (
        <div className="p-4 rounded-xl border border-border bg-card">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Quick Wins</p>
          {result.quick_wins.map((w, i) => <p key={i} className="text-xs text-muted-foreground">• {w}</p>)}
        </div>
      )}
      {result.strategic_priorities?.length > 0 && (
        <div className="p-4 rounded-xl border border-primary/20 bg-primary/5">
          <p className="text-xs font-semibold text-primary uppercase tracking-wide mb-2">90-Day Priorities</p>
          {result.strategic_priorities.map((p, i) => <p key={i} className="text-xs text-muted-foreground">• {p}</p>)}
        </div>
      )}
      {result.risks_to_watch?.length > 0 && (
        <div className="p-4 rounded-xl border border-red-200/50 bg-red-50/50 dark:bg-red-900/10 dark:border-red-900/30">
          <p className="text-xs font-semibold text-red-600 dark:text-red-400 uppercase tracking-wide mb-2">Risks to Watch</p>
          {result.risks_to_watch.map((r, i) => <p key={i} className="text-xs text-muted-foreground">• {r}</p>)}
        </div>
      )}
    </div>
  ) : null

  return (
    <SSEFeaturePage projectId={projectId} title="Unified Dashboard" subtitle="Pillar 7 - Claude + GA4 + Meta"
      icon={<LayoutDashboard className="w-4 h-4" />} credits={15} steps={store.steps}
      isStreaming={store.isStreaming} streamText={store.streamText} form={form} result={resultNode}
      onSubmit={generate} submitLabel="Generate Dashboard - 15 credits" canSubmit={true}
      backPath={`/projects/${projectId}/analytics-pro`} />
  )
}
