'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import {
  LayoutDashboard, Loader2, Library, CalendarDays, BarChart2,
  Brain, TrendingUp, Zap, ChevronRight, RefreshCw,
  AlertTriangle, Lightbulb, Star, Info,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { api } from '@/lib/api'
import { useAppStore } from '@/stores/app-store'
import { SidebarToggle } from '@/components/layout/sidebar'
import { BackButton } from '@/components/layout/back-button'
import { SetupChecklist } from '@/components/onboarding/setup-checklist'
import type { ProjectAnalytics, ProjectInsight } from '@/types'

type ComparisonData = {
  period_days: number
  library: { current: number; previous: number; pct_change: number | null }
  calendar: { current: number; previous: number; pct_change: number | null }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PLATFORM_COLORS: Record<string, string> = {
  instagram: 'bg-pink-500',
  facebook: 'bg-blue-600',
  tiktok: 'bg-neutral-900',
  linkedin: 'bg-blue-700',
  x: 'bg-neutral-700',
  email: 'bg-violet-500',
}

const STATUS_STYLES: Record<string, { bg: string; label: string }> = {
  draft:     { bg: 'bg-muted',             label: 'Draft' },
  approved:  { bg: 'bg-green-500/80',      label: 'Approved' },
  scheduled: { bg: 'bg-blue-500/80',       label: 'Scheduled' },
  posted:    { bg: 'bg-purple-500/80',     label: 'Posted' },
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const days = Math.floor(diff / 86400000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  return `${days}d ago`
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function DashboardPage() {
  const params = useParams<{ projectId: string }>()
  const router = useRouter()
  const { activeProject } = useAppStore()

  const [data, setData] = useState<ProjectAnalytics | null>(null)
  const [loading, setLoading] = useState(true)
  const [insights, setInsights] = useState<ProjectInsight[]>([])
  const [insightsLoading, setInsightsLoading] = useState(false)
  const [comparison, setComparison] = useState<ComparisonData | null>(null)
  const [comparePeriod, setComparePeriod] = useState<'7d' | '30d'>('7d')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [result, comp] = await Promise.all([
        api.analytics.get(params.projectId),
        api.analytics.compare(params.projectId, comparePeriod),
      ])
      setData(result)
      setComparison(comp)
    } catch (err) {
      console.error(err)
      toast.error('Failed to load analytics')
    } finally {
      setLoading(false)
    }
  }, [params.projectId, comparePeriod])

  const loadInsights = useCallback(async () => {
    setInsightsLoading(true)
    try {
      const result = await api.insights.get(params.projectId)
      setInsights(result.insights)
    } catch (err) {
      console.error(err)
    } finally {
      setInsightsLoading(false)
    }
  }, [params.projectId])

  useEffect(() => { load() }, [load])
  useEffect(() => { loadInsights() }, [loadInsights])

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const lib = data?.library
  const cal = data?.calendar
  const mem = data?.memory
  const comp = data?.competitors
  const topPerformers = data?.top_performers ?? []

  // Pipeline funnel values
  const pipeline = [
    { key: 'draft',     ...STATUS_STYLES['draft'],     count: lib?.by_status['draft'] ?? 0 },
    { key: 'approved',  ...STATUS_STYLES['approved'],  count: lib?.by_status['approved'] ?? 0 },
    { key: 'scheduled', ...STATUS_STYLES['scheduled'], count: lib?.by_status['scheduled'] ?? 0 },
    { key: 'posted',    ...STATUS_STYLES['posted'],     count: lib?.by_status['posted'] ?? 0 },
  ]
  const pipelineMax = Math.max(...pipeline.map((p) => p.count), 1)

  // Top platform by volume
  const byPlatform = Object.entries(lib?.by_platform ?? {}).sort((a, b) => b[1] - a[1])

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border shrink-0">
        <SidebarToggle />
        <BackButton />
        <LayoutDashboard className="w-4 h-4 text-primary" />
        <span className="text-sm font-semibold">Brand Dashboard</span>
        {activeProject && (
          <span className="text-xs text-muted-foreground">- {activeProject.name}</span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <div className="flex items-center border border-border rounded-md overflow-hidden text-xs">
            {(['7d', '30d'] as const).map((p) => (
              <button
                key={p}
                onClick={() => { setComparePeriod(p) }}
                className={cn('px-2.5 py-1 transition-colors', comparePeriod === p ? 'bg-muted text-foreground font-medium' : 'text-muted-foreground hover:bg-muted/50')}
              >
                {p}
              </button>
            ))}
          </div>
          <button
            onClick={load}
            className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            title="Refresh"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">

        {/* Setup checklist - shown until dismissed */}
        {activeProject && <SetupChecklist project={activeProject} />}

        {/* Top stats row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard
            icon={<Library className="w-4 h-4" />}
            label="Library Items"
            value={lib?.total ?? 0}
            sub={`${lib?.by_status['posted'] ?? 0} posted`}
            trend={comparison?.library.pct_change ?? null}
            onClick={() => router.push(`/projects/${params.projectId}/library`)}
          />
          <StatCard
            icon={<CalendarDays className="w-4 h-4" />}
            label="Upcoming Posts"
            value={cal?.upcoming_count ?? 0}
            sub="next 30 days"
            trend={comparison?.calendar.pct_change ?? null}
            onClick={() => router.push(`/projects/${params.projectId}/calendar`)}
          />
          <StatCard
            icon={<Brain className="w-4 h-4" />}
            label="Brand Memory"
            value={mem?.count ?? 0}
            sub="signals learned"
            onClick={() => router.push(`/projects/${params.projectId}/intelligence`)}
          />
          <StatCard
            icon={<BarChart2 className="w-4 h-4" />}
            label="Competitors"
            value={comp?.count ?? 0}
            sub={comp?.last_analysis ? `Last: ${timeAgo(comp.last_analysis)}` : 'Not analysed'}
            onClick={() => router.push(`/projects/${params.projectId}/intelligence`)}
          />
        </div>

        {/* Middle row: Pipeline + Platform breakdown */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

          {/* Content Pipeline */}
          <div className="border border-border rounded-xl bg-card p-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold">Content Pipeline</h3>
              <button
                onClick={() => router.push(`/projects/${params.projectId}/library`)}
                className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-0.5 transition-colors"
              >
                View all <ChevronRight className="w-3 h-3" />
              </button>
            </div>
            <div className="space-y-2.5">
              {pipeline.map((stage) => (
                <div key={stage.key} className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground w-16 shrink-0">{stage.label}</span>
                  <div className="flex-1 h-5 rounded-md bg-muted overflow-hidden">
                    <div
                      className={cn('h-full rounded-md transition-all', stage.bg)}
                      style={{ width: `${(stage.count / pipelineMax) * 100}%`, minWidth: stage.count > 0 ? '1.5rem' : 0 }}
                    />
                  </div>
                  <span className="text-xs font-medium w-6 text-right shrink-0">{stage.count}</span>
                </div>
              ))}
            </div>
            {lib?.total === 0 && (
              <p className="text-xs text-muted-foreground mt-3 text-center">
                Save content to the library to start tracking your pipeline.
              </p>
            )}
          </div>

          {/* Platform breakdown */}
          <div className="border border-border rounded-xl bg-card p-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold">Content by Platform</h3>
              <button
                onClick={() => router.push(`/projects/${params.projectId}/bulk`)}
                className="text-xs text-primary flex items-center gap-1 hover:opacity-80 transition-opacity"
              >
                <Zap className="w-3 h-3" /> Generate more
              </button>
            </div>
            {byPlatform.length === 0 ? (
              <div className="flex items-center justify-center h-24">
                <p className="text-xs text-muted-foreground text-center">No content yet.</p>
              </div>
            ) : (
              <div className="space-y-2.5">
                {byPlatform.map(([platform, count]) => {
                  const pct = Math.round((count / (lib?.total || 1)) * 100)
                  return (
                    <div key={platform} className="flex items-center gap-3">
                      <div className={cn('w-2 h-2 rounded-full shrink-0', PLATFORM_COLORS[platform.toLowerCase()] ?? 'bg-muted-foreground')} />
                      <span className="text-xs text-muted-foreground capitalize w-20 shrink-0">{platform}</span>
                      <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                        <div
                          className={cn('h-full rounded-full', PLATFORM_COLORS[platform.toLowerCase()] ?? 'bg-primary')}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="text-xs font-medium w-6 text-right shrink-0">{count}</span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {/* Bottom row: Upcoming calendar + Top performers */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

          {/* Upcoming calendar entries */}
          <div className="border border-border rounded-xl bg-card p-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold">Upcoming Posts</h3>
              <button
                onClick={() => router.push(`/projects/${params.projectId}/calendar`)}
                className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-0.5 transition-colors"
              >
                Full calendar <ChevronRight className="w-3 h-3" />
              </button>
            </div>
            {cal?.upcoming.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-24 gap-2">
                <p className="text-xs text-muted-foreground text-center">No upcoming posts scheduled.</p>
                <button
                  onClick={() => router.push(`/projects/${params.projectId}/calendar`)}
                  className="text-xs text-primary hover:opacity-80"
                >
                  Generate a calendar →
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                {cal?.upcoming.slice(0, 6).map((entry) => (
                  <div key={entry.id} className="flex items-start gap-3 py-1.5 border-b border-border last:border-0">
                    <div className="text-xs text-muted-foreground w-14 shrink-0 pt-0.5">
                      {formatDate(entry.date)}
                    </div>
                    <div className={cn('w-1.5 h-1.5 rounded-full mt-1.5 shrink-0', PLATFORM_COLORS[entry.platform?.toLowerCase()] ?? 'bg-muted-foreground')} />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-foreground/80 truncate">{entry.content}</p>
                      <span className="text-[10px] text-muted-foreground capitalize">{entry.platform}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Top performers */}
          <div className="border border-border rounded-xl bg-card p-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold">Top Performers</h3>
              <TrendingUp className="w-3.5 h-3.5 text-green-500" />
            </div>
            {topPerformers.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-24 gap-2">
                <p className="text-xs text-muted-foreground text-center">
                  Log performance data on your posted content to see top performers here.
                </p>
                <button
                  onClick={() => router.push(`/projects/${params.projectId}/library`)}
                  className="text-xs text-primary hover:opacity-80"
                >
                  Go to library →
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                {topPerformers.map((item) => (
                  <div key={item.id} className="flex items-start gap-3 py-1.5 border-b border-border last:border-0">
                    <div className={cn('w-1.5 h-1.5 rounded-full mt-1.5 shrink-0', PLATFORM_COLORS[item.platform?.toLowerCase()] ?? 'bg-muted-foreground')} />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-foreground/80 truncate">{item.content}</p>
                      <span className="text-[10px] text-muted-foreground capitalize">{item.platform}</span>
                    </div>
                    <div className="shrink-0 text-right">
                      <span className="text-xs font-semibold text-green-600">{item.engagement_rate.toFixed(1)}%</span>
                      <p className="text-[10px] text-muted-foreground">engagement</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

        </div>

        {/* AI Insights Feed */}
        <div className="border border-border rounded-xl bg-card p-4">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Brain className="w-4 h-4 text-primary" />
              <h3 className="text-sm font-semibold">LEO&apos;s Insights</h3>
            </div>
            <button
              onClick={loadInsights}
              disabled={insightsLoading}
              className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
              title="Refresh insights"
            >
              {insightsLoading
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : <RefreshCw className="w-3.5 h-3.5" />}
            </button>
          </div>

          {insightsLoading && insights.length === 0 ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : insights.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-6">
              Click refresh to generate AI insights for this project.
            </p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {insights.map((insight, i) => (
                <InsightCard key={i} insight={insight} />
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// InsightCard
// ---------------------------------------------------------------------------

const INSIGHT_CONFIG: Record<string, { icon: React.ReactNode; border: string; iconBg: string }> = {
  warning:     { icon: <AlertTriangle className="w-3.5 h-3.5" />, border: 'border-amber-500/30',  iconBg: 'bg-amber-500/10 text-amber-600' },
  opportunity: { icon: <Lightbulb className="w-3.5 h-3.5" />,    border: 'border-primary/30',     iconBg: 'bg-primary/10 text-primary' },
  tip:         { icon: <Info className="w-3.5 h-3.5" />,          border: 'border-blue-500/30',    iconBg: 'bg-blue-500/10 text-blue-600' },
  achievement: { icon: <Star className="w-3.5 h-3.5" />,          border: 'border-green-500/30',   iconBg: 'bg-green-500/10 text-green-600' },
}

const PRIORITY_DOT: Record<string, string> = {
  high:   'bg-red-500',
  medium: 'bg-amber-500',
  low:    'bg-muted-foreground',
}

function InsightCard({ insight }: { insight: ProjectInsight }) {
  const config = INSIGHT_CONFIG[insight.type] ?? INSIGHT_CONFIG.tip

  return (
    <div className={cn('rounded-xl border p-3.5 space-y-2', config.border)}>
      <div className="flex items-start gap-2">
        <div className={cn('p-1.5 rounded-md shrink-0 mt-0.5', config.iconBg)}>
          {config.icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-semibold leading-tight">{insight.title}</span>
            <div className={cn('w-1.5 h-1.5 rounded-full shrink-0', PRIORITY_DOT[insight.priority] ?? PRIORITY_DOT.low)} />
          </div>
        </div>
      </div>
      <p className="text-xs text-foreground/70 leading-relaxed">{insight.body}</p>
      {insight.action && (
        <p className="text-[10px] font-medium text-primary border-t border-border/50 pt-2">
          → {insight.action}
        </p>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// StatCard
// ---------------------------------------------------------------------------

function StatCard({
  icon, label, value, sub, trend, onClick,
}: {
  icon: React.ReactNode
  label: string
  value: number
  sub: string
  trend?: number | null
  onClick?: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="border border-border rounded-xl bg-card p-4 text-left hover:bg-muted/30 transition-colors group w-full"
    >
      <div className="flex items-center gap-2 text-muted-foreground mb-2 group-hover:text-foreground transition-colors">
        {icon}
        <span className="text-xs font-medium">{label}</span>
        {trend !== null && trend !== undefined && (
          <span className={cn(
            'ml-auto text-[10px] font-semibold px-1.5 py-0.5 rounded-full',
            trend > 0 ? 'bg-green-500/10 text-green-600' : trend < 0 ? 'bg-red-500/10 text-red-500' : 'bg-muted text-muted-foreground',
          )}>
            {trend > 0 ? '+' : ''}{trend}%
          </span>
        )}
      </div>
      <p className="text-2xl font-bold tabular-nums">{value}</p>
      <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>
    </button>
  )
}
