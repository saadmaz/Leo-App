'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, BarChart, Bar, Legend,
} from 'recharts'
import {
  BarChart2, TrendingUp, FileText, Upload, Sparkles,
  RefreshCw, Clock, CheckCircle2, AlertCircle, Info,
  Zap, Loader2,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { SidebarToggle } from '@/components/layout/sidebar'
import { BackButton } from '@/components/layout/back-button'
import { api } from '@/lib/api'
import type {
  AnalyticsOverview, AnalyticsTrends, ContentPerformanceRow, ActivityEvent, ContentPrediction,
} from '@/types'
import { CHANNELS } from '@/components/chat/channel-selector'

type MainTab = 'overview' | 'predict'

// ---------------------------------------------------------------------------
// Colour palette
// ---------------------------------------------------------------------------

const PLATFORM_COLORS: Record<string, string> = {
  instagram: '#E1306C',
  linkedin: '#0A66C2',
  twitter: '#1DA1F2',
  facebook: '#1877F2',
  tiktok: '#000000',
  youtube: '#FF0000',
  unknown: '#6b7280',
}

const STATUS_COLORS: Record<string, string> = {
  draft: '#6b7280',
  in_review: '#f59e0b',
  approved: '#10b981',
  scheduled: '#3b82f6',
  posted: '#8b5cf6',
}

const PIE_FALLBACK = ['#6366f1', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#3b82f6']

// ---------------------------------------------------------------------------
// Activity event metadata
// ---------------------------------------------------------------------------

const EVENT_META: Record<string, { icon: React.ReactNode; label: string }> = {
  metrics_logged:        { icon: <BarChart2 className="w-3 h-3" />,       label: 'Metrics logged' },
  content_created:       { icon: <FileText className="w-3 h-3" />,        label: 'Content created' },
  content_posted:        { icon: <Upload className="w-3 h-3" />,          label: 'Content posted' },
  review_submitted:      { icon: <Clock className="w-3 h-3" />,           label: 'Submitted for review' },
  review_approved:       { icon: <CheckCircle2 className="w-3 h-3" />,    label: 'Content approved' },
  review_rejected:       { icon: <AlertCircle className="w-3 h-3" />,     label: 'Content rejected' },
  changes_requested:     { icon: <AlertCircle className="w-3 h-3" />,     label: 'Changes requested' },
  default:               { icon: <Info className="w-3 h-3" />,            label: 'Activity' },
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

// ---------------------------------------------------------------------------
// Stat card
// ---------------------------------------------------------------------------

function StatCard({ label, value, sub, icon }: {
  label: string; value: string | number; sub?: string; icon: React.ReactNode
}) {
  return (
    <div className="bg-card border border-border rounded-lg p-4 flex items-start gap-3">
      <div className="p-2 rounded-md bg-muted text-muted-foreground shrink-0">{icon}</div>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-2xl font-bold tabular-nums leading-tight">{value}</p>
        {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function AnalyticsPage() {
  const params = useParams<{ projectId: string }>()
  const projectId = params.projectId

  const [mainTab, setMainTab] = useState<MainTab>('overview')
  const [overview, setOverview] = useState<AnalyticsOverview | null>(null)
  const [trends, setTrends] = useState<AnalyticsTrends | null>(null)
  const [content, setContent] = useState<ContentPerformanceRow[]>([])
  const [activity, setActivity] = useState<ActivityEvent[]>([])
  const [aiSummary, setAiSummary] = useState<string>('')
  const [summaryLoading, setSummaryLoading] = useState(false)
  const [loading, setLoading] = useState(true)
  const [sortKey, setSortKey] = useState<'engagement' | 'impressions' | 'clicks'>('engagement')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [ov, tr, ct, ac] = await Promise.all([
        api.analytics.getOverview(projectId),
        api.analytics.getTrends(projectId),
        api.analytics.getContent(projectId),
        api.analytics.getActivity(projectId),
      ])
      setOverview(ov)
      setTrends(tr)
      setContent(ct)
      setActivity(ac)
    } catch {
      toast.error('Failed to load analytics')
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => { load() }, [load])

  async function loadAiSummary() {
    setSummaryLoading(true)
    try {
      const { summary } = await api.analytics.getAiSummary(projectId)
      setAiSummary(summary)
    } catch {
      toast.error('Failed to generate summary')
    } finally {
      setSummaryLoading(false)
    }
  }

  const sortedContent = [...content].sort((a, b) => b[sortKey] - a[sortKey])

  const pieData = trends?.platform_breakdown.map((p, i) => ({
    name: p.platform,
    value: p.count,
    fill: PLATFORM_COLORS[p.platform] ?? PIE_FALLBACK[i % PIE_FALLBACK.length],
  })) ?? []

  const statusData = trends?.status_breakdown.map((s) => ({
    name: s.status,
    count: s.count,
    fill: STATUS_COLORS[s.status] ?? '#6b7280',
  })) ?? []

  if (loading) {
    return (
      <div className="flex flex-col h-screen">
        <header className="flex items-center gap-2 px-4 py-3 border-b border-border shrink-0">
          <SidebarToggle />
          <BackButton />
          <BarChart2 className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-semibold">Analytics</span>
        </header>
        <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
          Loading analytics…
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Header */}
      <header className="flex items-center gap-2 px-4 py-3 border-b border-border shrink-0">
        <SidebarToggle />
        <BackButton />
        <BarChart2 className="w-4 h-4 text-muted-foreground" />
        <span className="text-sm font-semibold">Analytics</span>

        {/* Tabs */}
        <div className="flex items-center gap-0.5 rounded-lg border border-border p-0.5 bg-muted/40 ml-2">
          <button
            onClick={() => setMainTab('overview')}
            className={cn(
              'px-3 py-1 rounded-md text-xs font-medium transition-colors',
              mainTab === 'overview' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            Overview
          </button>
          <button
            onClick={() => setMainTab('predict')}
            className={cn(
              'flex items-center gap-1 px-3 py-1 rounded-md text-xs font-medium transition-colors',
              mainTab === 'predict' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Zap className="w-3 h-3" />
            Predict
          </button>
        </div>

        <div className="ml-auto">
          {mainTab === 'overview' && (
            <button
              onClick={load}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs border border-border hover:bg-muted transition-colors"
            >
              <RefreshCw className="w-3 h-3" />
              Refresh
            </button>
          )}
        </div>
      </header>

      {/* Predict tab */}
      {mainTab === 'predict' && (
        <div className="flex-1 overflow-y-auto">
          <PredictTab projectId={projectId} />
        </div>
      )}

      {/* Overview tab body */}
      {mainTab === 'overview' && (
      <div className="flex-1 overflow-y-auto p-4 space-y-6">

        {/* Overview cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard
            label="Total Content"
            value={overview?.total_content ?? 0}
            icon={<FileText className="w-4 h-4" />}
          />
          <StatCard
            label="Posted"
            value={overview?.total_posted ?? 0}
            sub={overview?.total_content ? `${Math.round((overview.total_posted / overview.total_content) * 100)}% of total` : undefined}
            icon={<Upload className="w-4 h-4" />}
          />
          <StatCard
            label="Avg Engagement"
            value={overview?.avg_engagement ?? 0}
            sub="per tracked post"
            icon={<TrendingUp className="w-4 h-4" />}
          />
          <StatCard
            label="Total Impressions"
            value={(overview?.total_impressions ?? 0).toLocaleString()}
            sub={overview?.best_platform ? `Best: ${overview.best_platform}` : 'No metrics yet'}
            icon={<BarChart2 className="w-4 h-4" />}
          />
        </div>

        {/* AI Summary */}
        <div className="bg-card border border-border rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-primary" />
              <span className="text-sm font-semibold">AI Performance Summary</span>
            </div>
            <button
              onClick={loadAiSummary}
              disabled={summaryLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {summaryLoading ? (
                <RefreshCw className="w-3 h-3 animate-spin" />
              ) : (
                <Sparkles className="w-3 h-3" />
              )}
              {aiSummary ? 'Regenerate' : 'Generate'}
            </button>
          </div>
          {aiSummary ? (
            <p className="text-sm text-muted-foreground leading-relaxed">{aiSummary}</p>
          ) : (
            <p className="text-sm text-muted-foreground">
              Click &quot;Generate&quot; to get an AI-powered analysis of your content performance.
            </p>
          )}
        </div>

        {/* Charts row */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

          {/* Content creation trend */}
          <div className="lg:col-span-2 bg-card border border-border rounded-lg p-4">
            <p className="text-sm font-semibold mb-4">Content Created Over Time</p>
            {trends && trends.daily_creation.length > 0 ? (
              <ResponsiveContainer width="100%" height={180}>
                <LineChart data={trends.daily_creation} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 10 }}
                    tickFormatter={(d) => d.slice(5)} // MM-DD
                  />
                  <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{ fontSize: 12 }}
                    labelFormatter={(l) => `Date: ${l}`}
                  />
                  <Line
                    type="monotone"
                    dataKey="count"
                    stroke="hsl(var(--primary))"
                    strokeWidth={2}
                    dot={false}
                    name="Content"
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-44 flex items-center justify-center text-sm text-muted-foreground">
                No content data yet
              </div>
            )}
          </div>

          {/* Platform breakdown pie */}
          <div className="bg-card border border-border rounded-lg p-4">
            <p className="text-sm font-semibold mb-4">Platform Breakdown</p>
            {pieData.length > 0 ? (
              <ResponsiveContainer width="100%" height={180}>
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={45}
                    outerRadius={70}
                    dataKey="value"
                    nameKey="name"
                  >
                    {pieData.map((entry, i) => (
                      <Cell key={i} fill={entry.fill} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ fontSize: 12 }} />
                  <Legend iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-44 flex items-center justify-center text-sm text-muted-foreground">
                No data yet
              </div>
            )}
          </div>
        </div>

        {/* Status breakdown bar */}
        <div className="bg-card border border-border rounded-lg p-4">
          <p className="text-sm font-semibold mb-4">Content by Status</p>
          {statusData.length > 0 ? (
            <ResponsiveContainer width="100%" height={130}>
              <BarChart data={statusData} layout="vertical" margin={{ left: 10, right: 20 }}>
                <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={90} />
                <Tooltip contentStyle={{ fontSize: 12 }} />
                <Bar dataKey="count" name="Items" radius={[0, 4, 4, 0]}>
                  {statusData.map((entry, i) => (
                    <Cell key={i} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-28 flex items-center justify-center text-sm text-muted-foreground">
              No data yet
            </div>
          )}
        </div>

        {/* Content performance + activity side by side */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

          {/* Performance table */}
          <div className="lg:col-span-2 bg-card border border-border rounded-lg overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <p className="text-sm font-semibold">Content Performance</p>
              <div className="flex items-center gap-1">
                {(['engagement', 'impressions', 'clicks'] as const).map((k) => (
                  <button
                    key={k}
                    onClick={() => setSortKey(k)}
                    className={`px-2 py-1 rounded text-xs transition-colors ${
                      sortKey === k
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:bg-muted'
                    }`}
                  >
                    {k}
                  </button>
                ))}
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="text-left px-4 py-2 text-muted-foreground font-medium">Platform</th>
                    <th className="text-left px-4 py-2 text-muted-foreground font-medium">Status</th>
                    <th className="text-right px-4 py-2 text-muted-foreground font-medium">Impressions</th>
                    <th className="text-right px-4 py-2 text-muted-foreground font-medium">Clicks</th>
                    <th className="text-right px-4 py-2 text-muted-foreground font-medium">Engagement</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedContent.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                        No content items yet
                      </td>
                    </tr>
                  ) : sortedContent.slice(0, 20).map((row) => (
                    <tr key={row.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                      <td className="px-4 py-2 font-medium capitalize">{row.platform}</td>
                      <td className="px-4 py-2">
                        <span
                          className="px-1.5 py-0.5 rounded text-[10px] font-medium"
                          style={{ backgroundColor: `${STATUS_COLORS[row.status] ?? '#6b7280'}20`, color: STATUS_COLORS[row.status] ?? '#6b7280' }}
                        >
                          {row.status}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">{row.impressions > 0 ? row.impressions.toLocaleString() : '-'}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{row.clicks > 0 ? row.clicks.toLocaleString() : '-'}</td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        {row.engagement > 0 ? (
                          <span className="font-semibold text-primary">{row.engagement}</span>
                        ) : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Activity feed */}
          <div className="bg-card border border-border rounded-lg overflow-hidden">
            <div className="px-4 py-3 border-b border-border">
              <p className="text-sm font-semibold">Activity Feed</p>
            </div>
            <div className="overflow-y-auto" style={{ maxHeight: 420 }}>
              {activity.length === 0 ? (
                <div className="p-6 text-center text-sm text-muted-foreground">
                  No activity yet
                </div>
              ) : activity.map((evt) => {
                const meta = EVENT_META[evt.event_type] ?? EVENT_META.default
                return (
                  <div key={evt.id} className="flex items-start gap-2.5 px-4 py-2.5 border-b border-border/50 hover:bg-muted/20 transition-colors">
                    <div className="mt-0.5 p-1.5 rounded bg-muted text-muted-foreground shrink-0">
                      {meta.icon}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-foreground leading-snug">{evt.description}</p>
                      {evt.user_email && (
                        <p className="text-[10px] text-muted-foreground mt-0.5">{evt.user_email}</p>
                      )}
                      <p className="text-[10px] text-muted-foreground/60 mt-0.5">{relativeTime(evt.timestamp)}</p>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

        </div>
      </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Predict tab
// ---------------------------------------------------------------------------

const PLATFORM_OPTIONS = ['instagram', 'linkedin', 'twitter', 'tiktok', 'facebook', 'email', 'youtube']

const PREDICTION_CONFIG: Record<ContentPrediction['prediction'], { color: string; bg: string }> = {
  'excellent':     { color: 'text-emerald-600', bg: 'bg-emerald-500/10 border-emerald-500/20' },
  'above average': { color: 'text-blue-600',    bg: 'bg-blue-500/10 border-blue-500/20' },
  'average':       { color: 'text-amber-600',   bg: 'bg-amber-500/10 border-amber-500/20' },
  'below average': { color: 'text-orange-600',  bg: 'bg-orange-500/10 border-orange-500/20' },
  'poor':          { color: 'text-red-600',     bg: 'bg-red-500/10 border-red-500/20' },
}

function PredictTab({ projectId }: { projectId: string }) {
  const [content, setContent] = useState('')
  const [platform, setPlatform] = useState('instagram')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<ContentPrediction | null>(null)

  async function handlePredict() {
    if (!content.trim()) { toast.error('Enter some content to predict.'); return }
    setLoading(true)
    setResult(null)
    try {
      const data = await api.contentPredict.predict(projectId, content.trim(), platform)
      setResult(data)
    } catch (err) {
      const msg = String(err)
      if (msg.includes('400')) {
        toast.error('Brand Core not set up yet. Run brand ingestion first.', { duration: 5000 })
      } else {
        toast.error('Prediction failed. Try again.')
      }
    } finally {
      setLoading(false)
    }
  }

  const predCfg = result ? PREDICTION_CONFIG[result.prediction] : null

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      <div>
        <h2 className="text-base font-semibold mb-1">Performance Predictor</h2>
        <p className="text-sm text-muted-foreground">
          Paste draft content and get a predicted engagement score before you publish.
        </p>
      </div>

      <div className="space-y-3">
        {/* Platform selector */}
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-2">Platform</label>
          <div className="flex flex-wrap gap-1.5">
            {PLATFORM_OPTIONS.map((p) => {
              const ch = CHANNELS.find((c) => c.key === p)
              return (
                <button
                  key={p}
                  onClick={() => setPlatform(p)}
                  className={cn(
                    'flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors',
                    platform === p
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground hover:text-foreground',
                  )}
                >
                  {ch && <span>{ch.icon}</span>}
                  <span className="capitalize">{p.replace('_', ' ')}</span>
                </button>
              )
            })}
          </div>
        </div>

        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Paste your draft content here to get a performance prediction..."
          rows={7}
          className="w-full text-sm bg-muted/50 border border-border rounded-lg px-3 py-2.5 resize-none focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-colors placeholder:text-muted-foreground/50"
        />
        <div className="flex justify-end">
          <button
            onClick={handlePredict}
            disabled={loading || !content.trim()}
            className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? (
              <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Predicting…</>
            ) : (
              <><Zap className="w-3.5 h-3.5" /> Predict performance</>
            )}
          </button>
        </div>
      </div>

      {result && predCfg && (
        <div className="space-y-4">
          {/* Main score */}
          <div className={cn('rounded-xl border p-5', predCfg.bg)}>
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className={cn('text-4xl font-bold tabular-nums', predCfg.color)}>
                  {result.score}
                  <span className="text-lg font-normal text-muted-foreground">/100</span>
                </div>
                <div className={cn('text-sm font-medium mt-0.5 capitalize', predCfg.color)}>
                  {result.prediction} · {result.estimated_engagement} engagement
                </div>
              </div>
              {result.best_posting_time && (
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">Best time to post</p>
                  <p className="text-sm font-medium">{result.best_posting_time}</p>
                </div>
              )}
            </div>

            {/* Dimension bars */}
            <div className="grid grid-cols-2 gap-3 mt-3">
              <ScoreBar label="Hook Strength" value={result.hook_strength} />
              <ScoreBar label="Clarity" value={result.clarity} />
              <ScoreBar label="CTA Strength" value={result.cta_strength} />
              <ScoreBar label="Brand Alignment" value={result.brand_alignment} />
            </div>
          </div>

          {result.reasons.length > 0 && (
            <div className="rounded-xl border border-border p-4 space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide">Why this score</p>
              <ul className="space-y-1">
                {result.reasons.map((r, i) => (
                  <li key={i} className="flex gap-2 text-sm text-foreground/80">
                    <span className="text-muted-foreground mt-0.5 shrink-0">·</span>{r}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {result.improvements.length > 0 && (
            <div className="rounded-xl border border-border p-4 space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide">How to improve</p>
              <ul className="space-y-1">
                {result.improvements.map((imp, i) => (
                  <li key={i} className="flex gap-2 text-sm text-foreground/80">
                    <span className="text-primary mt-0.5 shrink-0">→</span>{imp}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function ScoreBar({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="flex justify-between text-xs mb-1">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium tabular-nums">{value}</span>
      </div>
      <div className="h-1.5 rounded-full bg-border overflow-hidden">
        <div
          className="h-full rounded-full bg-primary transition-all"
          style={{ width: `${Math.min(value, 100)}%` }}
        />
      </div>
    </div>
  )
}
