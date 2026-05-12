'use client'

import { useEffect, useState } from 'react'
import { adminApi, DashboardStats } from '@/lib/admin-api'
import { Skeleton } from '@/components/ui/skeleton'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Users,
  FolderOpen,
  MessageSquare,
  TrendingUp,
  UserCheck,
  UserX,
  BadgeDollarSign,
  Sparkles,
} from 'lucide-react'

export default function AdminDashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    adminApi.dashboard
      .stats()
      .then(setStats)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="p-8 max-w-6xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Platform-wide overview - all metrics are live from Firestore.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive mb-6">
          {error}
        </div>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard
          title="Total Users"
          value={stats?.totalUsers}
          loading={loading}
          icon={<Users className="w-4 h-4" />}
          sub={`+${stats?.newSignups7d ?? 0} this week`}
        />
        <StatCard
          title="Est. MRR"
          value={stats ? `$${stats.estimatedMrr.toLocaleString()}` : undefined}
          loading={loading}
          icon={<BadgeDollarSign className="w-4 h-4" />}
          sub="Pro + Agency subscriptions"
        />
        <StatCard
          title="Total Projects"
          value={stats?.totalProjects}
          loading={loading}
          icon={<FolderOpen className="w-4 h-4" />}
        />
        <StatCard
          title="Messages (MTD)"
          value={stats?.totalMessagesThisMonth?.toLocaleString()}
          loading={loading}
          icon={<MessageSquare className="w-4 h-4" />}
          sub="Across all users"
        />
      </div>

      {/* Tier breakdown + secondary stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Tier breakdown */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-primary" />
              Users by Plan
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {loading ? (
              [1, 2, 3].map((i) => <Skeleton key={i} className="h-8 w-full" />)
            ) : (
              <>
                <TierRow
                  label="Free"
                  count={stats?.usersByTier.free ?? 0}
                  total={stats?.totalUsers ?? 1}
                  color="bg-muted-foreground/40"
                />
                <TierRow
                  label="Pro - $49/mo"
                  count={stats?.usersByTier.pro ?? 0}
                  total={stats?.totalUsers ?? 1}
                  color="bg-primary"
                />
                <TierRow
                  label="Agency - $149/mo"
                  count={stats?.usersByTier.agency ?? 0}
                  total={stats?.totalUsers ?? 1}
                  color="bg-violet-500"
                />
              </>
            )}
          </CardContent>
        </Card>

        {/* Account health */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-primary" />
              Account Health
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {loading ? (
              [1, 2, 3].map((i) => <Skeleton key={i} className="h-8 w-full" />)
            ) : (
              <>
                <HealthRow
                  icon={<UserCheck className="w-4 h-4 text-emerald-500" />}
                  label="Active accounts"
                  value={(stats?.totalUsers ?? 0) - (stats?.suspendedUsers ?? 0)}
                />
                <HealthRow
                  icon={<UserX className="w-4 h-4 text-destructive" />}
                  label="Suspended accounts"
                  value={stats?.suspendedUsers ?? 0}
                />
                <HealthRow
                  icon={<Users className="w-4 h-4 text-muted-foreground" />}
                  label="New signups (last 7 days)"
                  value={stats?.newSignups7d ?? 0}
                />
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatCard({
  title,
  value,
  loading,
  icon,
  sub,
}: {
  title: string
  value?: string | number
  loading: boolean
  icon: React.ReactNode
  sub?: string
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          {title}
        </CardTitle>
        <span className="text-muted-foreground">{icon}</span>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-8 w-24" />
        ) : (
          <p className="text-2xl font-bold">{value ?? '-'}</p>
        )}
        {sub && !loading && (
          <p className="text-xs text-muted-foreground mt-1">{sub}</p>
        )}
      </CardContent>
    </Card>
  )
}

function TierRow({
  label,
  count,
  total,
  color,
}: {
  label: string
  count: number
  total: number
  color: string
}) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-sm">
        <span>{label}</span>
        <span className="font-medium">
          {count} <span className="text-muted-foreground font-normal">({pct}%)</span>
        </span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

function HealthRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode
  label: string
  value: number
}) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        {icon}
        {label}
      </div>
      <span className="text-sm font-semibold">{value.toLocaleString()}</span>
    </div>
  )
}
