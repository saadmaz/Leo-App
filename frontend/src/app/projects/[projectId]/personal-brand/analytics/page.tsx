'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import {
  Loader2, RefreshCw, TrendingUp, Users, BarChart2, Star, Sparkles,
  Camera, RotateCcw,
} from 'lucide-react'
import { api } from '@/lib/api'
import { useAppStore } from '@/stores/app-store'
import { cn } from '@/lib/utils'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AnalyticsSnapshot {
  platform: string
  snapshotDate: string
  followers: number
  followersDelta: number
  postsThisWeek: number
  avgEngagementRate: number
  consistencyScore: number
  topPostUrl?: string
  topPostEngagement?: number
  profileViews?: number
}

interface WeeklyBrief {
  generatedAt: string
  postIdeas: string[]
  performanceSummary: string
  focusThisWeek: string
}

// ---------------------------------------------------------------------------
// Consistency Ring
// ---------------------------------------------------------------------------

function ConsistencyRing({ score }: { score: number }) {
  const r = 36
  const circ = 2 * Math.PI * r
  const filled = circ * (score / 100)
  const color = score >= 80 ? 'text-green-500' : score >= 60 ? 'text-amber-500' : 'text-red-500'

  return (
    <div className="relative w-24 h-24">
      <svg className="w-full h-full -rotate-90" viewBox="0 0 84 84">
        <circle cx="42" cy="42" r={r} fill="none" stroke="currentColor" strokeWidth="5" className="text-muted" />
        <circle
          cx="42" cy="42" r={r} fill="none" stroke="currentColor" strokeWidth="5"
          strokeDasharray={`${filled} ${circ}`} strokeLinecap="round"
          className={cn(color, 'transition-all duration-700')}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={cn('text-xl font-bold', color)}>{score}</span>
        <span className="text-[9px] text-muted-foreground">/100</span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sparkline (simple SVG bar chart)
// ---------------------------------------------------------------------------

function MiniSparkline({ values }: { values: number[] }) {
  if (!values.length) return null
  const max = Math.max(...values, 1)
  const w = 80
  const h = 24
  const barW = Math.floor(w / values.length) - 1

  return (
    <svg width={w} height={h} className="overflow-visible">
      {values.map((v, i) => {
        const barH = Math.max(2, Math.round((v / max) * h))
        return (
          <rect
            key={i}
            x={i * (barW + 1)}
            y={h - barH}
            width={barW}
            height={barH}
            rx={1}
            className="fill-primary/50"
          />
        )
      })}
    </svg>
  )
}

// ---------------------------------------------------------------------------
// Platform card
// ---------------------------------------------------------------------------

function PlatformCard({ snap, history }: { snap: AnalyticsSnapshot; history: number[] }) {
  const deltaColor = snap.followersDelta >= 0 ? 'text-green-600' : 'text-red-500'

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="w-7 h-7 rounded-lg bg-muted flex items-center justify-center text-xs font-bold uppercase text-muted-foreground">
            {snap.platform[0]}
          </span>
          <span className="text-sm font-semibold text-foreground capitalize">{snap.platform}</span>
        </div>
        <span className={cn('text-xs font-medium', deltaColor)}>
          {snap.followersDelta >= 0 ? '+' : ''}{snap.followersDelta} this week
        </span>
      </div>

      <div className="flex items-end justify-between">
        <div>
          <p className="text-2xl font-bold text-foreground">{(snap.followers ?? 0).toLocaleString()}</p>
          <p className="text-[11px] text-muted-foreground">followers</p>
        </div>
        <MiniSparkline values={history} />
      </div>

      <div className="grid grid-cols-2 gap-2 pt-1 border-t border-border/50">
        <div>
          <p className="text-xs font-medium text-foreground">{snap.avgEngagementRate?.toFixed(1) ?? '–'}%</p>
          <p className="text-[10px] text-muted-foreground">Engagement rate</p>
        </div>
        <div>
          <p className="text-xs font-medium text-foreground">{snap.postsThisWeek ?? 0}</p>
          <p className="text-[10px] text-muted-foreground">Posts this week</p>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Weekly Brief card
// ---------------------------------------------------------------------------

function WeeklyBriefCard({ brief }: { brief: WeeklyBrief }) {
  return (
    <div className="rounded-2xl border border-primary/20 bg-primary/5 p-5 space-y-4">
      <div className="flex items-center gap-2">
        <Sparkles className="w-4 h-4 text-primary" />
        <h3 className="text-sm font-semibold text-foreground">This Week&apos;s Brief</h3>
        <span className="text-[10px] text-muted-foreground ml-auto">
          {brief.generatedAt ? new Date(brief.generatedAt).toLocaleDateString() : ''}
        </span>
      </div>

      {brief.focusThisWeek && (
        <p className="text-sm text-foreground">{brief.focusThisWeek}</p>
      )}

      {brief.performanceSummary && (
        <p className="text-xs text-muted-foreground">{brief.performanceSummary}</p>
      )}

      {brief.postIdeas?.length > 0 && (
        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Post Ideas This Week</p>
          {brief.postIdeas.map((idea, i) => (
            <div key={i} className="flex items-start gap-2">
              <span className="w-5 h-5 rounded-full bg-primary/10 text-primary text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                {i + 1}
              </span>
              <p className="text-sm text-foreground">{idea}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function PersonalBrandAnalyticsPage() {
  const params = useParams<{ projectId: string }>()
  const { personalCore, setPersonalCore } = useAppStore()
  const [snapshots, setSnapshots] = useState<AnalyticsSnapshot[]>([])
  const [brief, setBrief] = useState<WeeklyBrief | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [takingSnapshot, setTakingSnapshot] = useState(false)
  const [regeneratingBrief, setRegeneratingBrief] = useState(false)

  useEffect(() => {
    async function load() {
      try {
        const [snaps, weeklyBrief] = await Promise.allSettled([
          api.persona.getAnalytics(params.projectId) as unknown as Promise<AnalyticsSnapshot[]>,
          api.persona.getWeeklyBrief(params.projectId) as unknown as Promise<WeeklyBrief>,
        ])
        if (snaps.status === 'fulfilled') setSnapshots(snaps.value ?? [])
        if (weeklyBrief.status === 'fulfilled' && weeklyBrief.value) setBrief(weeklyBrief.value)
      } catch {
        // Non-critical - page shows empty state
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    }
    load()
  }, [params.projectId])

  // Load Personal Core for the name display
  useEffect(() => {
    if (personalCore) return
    api.persona.getCore(params.projectId).then(setPersonalCore).catch(() => {})
  }, [params.projectId, personalCore, setPersonalCore])

  async function handleRefresh() {
    setRefreshing(true)
    try {
      const [snaps, weeklyBrief] = await Promise.allSettled([
        api.persona.getAnalytics(params.projectId) as unknown as Promise<AnalyticsSnapshot[]>,
        api.persona.getWeeklyBrief(params.projectId) as unknown as Promise<WeeklyBrief>,
      ])
      if (snaps.status === 'fulfilled') setSnapshots(snaps.value ?? [])
      if (weeklyBrief.status === 'fulfilled' && weeklyBrief.value) setBrief(weeklyBrief.value)
    } catch {
      // Non-critical
    } finally {
      setRefreshing(false)
    }
  }

  async function handleTakeSnapshot() {
    setTakingSnapshot(true)
    try {
      await api.persona.triggerSnapshot(params.projectId)
      // Reload snapshots after a short delay for Firestore to settle
      setTimeout(async () => {
        const snaps = await api.persona.getAnalytics(params.projectId) as unknown as AnalyticsSnapshot[]
        setSnapshots(snaps ?? [])
        setTakingSnapshot(false)
      }, 1500)
    } catch {
      setTakingSnapshot(false)
    }
  }

  async function handleRegenerateBrief() {
    setRegeneratingBrief(true)
    try {
      const newBrief = await api.persona.regenerateBrief(params.projectId) as unknown as WeeklyBrief
      setBrief(newBrief)
    } catch {
      // Non-critical
    } finally {
      setRegeneratingBrief(false)
    }
  }

  // Compute overall consistency score (average of all platforms)
  const latestSnaps = Object.values(
    snapshots.reduce<Record<string, AnalyticsSnapshot>>((acc, s) => {
      if (!acc[s.platform] || s.snapshotDate > acc[s.platform].snapshotDate) {
        acc[s.platform] = s
      }
      return acc
    }, {}),
  )

  const overallConsistency = latestSnaps.length
    ? Math.round(latestSnaps.reduce((sum, s) => sum + (s.consistencyScore ?? 0), 0) / latestSnaps.length)
    : 0

  // Build per-platform follower history sparklines
  const platformHistory = snapshots.reduce<Record<string, number[]>>((acc, s) => {
    if (!acc[s.platform]) acc[s.platform] = []
    acc[s.platform].push(s.followers ?? 0)
    return acc
  }, {})

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto bg-background">
      <div className="max-w-4xl mx-auto w-full px-6 py-8 space-y-8">

        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Brand Analytics</h1>
            {personalCore?.fullName && (
              <p className="text-sm text-muted-foreground mt-0.5">{personalCore.fullName}</p>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap justify-end">
            <button
              onClick={handleTakeSnapshot}
              disabled={takingSnapshot}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground border border-border rounded-lg px-3 py-1.5 hover:bg-muted transition-colors disabled:opacity-40"
            >
              {takingSnapshot ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Camera className="w-3.5 h-3.5" />}
              Take snapshot
            </button>
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground border border-border rounded-lg px-3 py-1.5 hover:bg-muted transition-colors disabled:opacity-40"
            >
              {refreshing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
              Refresh
            </button>
          </div>
        </div>

        {/* Weekly Brief */}
        {brief && (
          <div className="space-y-2">
            <WeeklyBriefCard brief={brief} />
            <div className="flex justify-end">
              <button
                onClick={handleRegenerateBrief}
                disabled={regeneratingBrief}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                {regeneratingBrief ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
                Regenerate brief
              </button>
            </div>
          </div>
        )}

        {/* Consistency Hero */}
        <div className="flex items-center gap-6 p-6 rounded-2xl border border-border bg-card">
          <ConsistencyRing score={overallConsistency} />
          <div className="flex-1 space-y-2">
            <h2 className="text-base font-semibold text-foreground">
              Consistency Score: {overallConsistency}/100
            </h2>
            <p className="text-sm text-muted-foreground">
              {overallConsistency >= 80
                ? 'Excellent consistency. You\'re showing up reliably across your platforms.'
                : overallConsistency >= 60
                ? 'Good, but there are gaps. Check the platform breakdown below.'
                : latestSnaps.length === 0
                ? 'No analytics data yet. Snapshots are taken weekly automatically.'
                : 'Posting consistency needs work. Consistency is the #1 personal brand growth lever.'}
            </p>
            {latestSnaps.length > 0 && (
              <div className="flex gap-3 flex-wrap mt-1">
                {latestSnaps.map((s) => (
                  <span key={s.platform} className={cn(
                    'text-[10px] font-medium px-2 py-0.5 rounded-full capitalize',
                    s.consistencyScore >= 80 ? 'bg-green-500/10 text-green-600' :
                    s.consistencyScore >= 60 ? 'bg-amber-500/10 text-amber-600' :
                    'bg-red-500/10 text-red-500',
                  )}>
                    {s.platform}: {s.consistencyScore ?? 0}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Platform Cards */}
        {latestSnaps.length > 0 ? (
          <div>
            <h2 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
              <Users className="w-4 h-4 text-primary" />
              Platform Growth
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {latestSnaps.map((snap) => (
                <PlatformCard
                  key={snap.platform}
                  snap={snap}
                  history={platformHistory[snap.platform] ?? []}
                />
              ))}
            </div>
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-border p-10 text-center space-y-3">
            <BarChart2 className="w-8 h-8 text-muted-foreground mx-auto" />
            <div>
              <p className="text-sm font-medium text-foreground">No analytics data yet</p>
              <p className="text-xs text-muted-foreground mt-1">
                Analytics snapshots are captured automatically every Monday.
                The first snapshot will appear after your connected platforms are scraped.
              </p>
            </div>
          </div>
        )}

        {/* Top Posts */}
        {latestSnaps.some((s) => s.topPostUrl) && (
          <div className="space-y-3">
            <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Star className="w-4 h-4 text-primary" />
              Best Posts This Week
            </h2>
            <div className="divide-y divide-border/50 rounded-xl border border-border bg-card overflow-hidden">
              {latestSnaps
                .filter((s) => s.topPostUrl)
                .map((s) => (
                  <div key={s.platform} className="flex items-center justify-between px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="w-6 h-6 rounded-md bg-muted flex items-center justify-center text-[10px] font-bold uppercase text-muted-foreground">
                        {s.platform[0]}
                      </span>
                      <a
                        href={s.topPostUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-primary hover:underline truncate max-w-xs"
                      >
                        Top {s.platform} post
                      </a>
                    </div>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {(s.topPostEngagement ?? 0).toLocaleString()} engagements
                    </span>
                  </div>
                ))}
            </div>
          </div>
        )}

        {/* Profile Views */}
        {latestSnaps.some((s) => s.profileViews) && (
          <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
            <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-primary" />
              Profile Views
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              {latestSnaps
                .filter((s) => s.profileViews)
                .map((s) => (
                  <div key={s.platform} className="space-y-0.5">
                    <p className="text-xl font-bold text-foreground">{(s.profileViews ?? 0).toLocaleString()}</p>
                    <p className="text-xs text-muted-foreground capitalize">{s.platform} profile views</p>
                  </div>
                ))}
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
