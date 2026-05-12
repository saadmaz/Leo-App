'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import {
  adminApi,
  FlaggedItem,
  ModerationStats,
  AbuseReport,
} from '@/lib/admin-api'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  ShieldAlert,
  ShieldCheck,
  Trash2,
  RefreshCw,
  AlertTriangle,
  UserX,
  CheckCircle2,
  ExternalLink,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

export default function AdminModerationPage() {
  const [stats, setStats] = useState<ModerationStats | null>(null)
  const [pending, setPending] = useState<FlaggedItem[]>([])
  const [reviewed, setReviewed] = useState<FlaggedItem[]>([])
  const [abuse, setAbuse] = useState<AbuseReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [s, p, r, a] = await Promise.all([
        adminApi.moderation.stats(),
        adminApi.moderation.list({ status: 'pending' }),
        adminApi.moderation.list({ status: 'actioned' }),
        adminApi.moderation.abuse(),
      ])
      setStats(s)
      setPending(p)
      setReviewed(r)
      setAbuse(a)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function dismiss(flagId: string) {
    try {
      await adminApi.moderation.dismiss(flagId)
      setPending((prev) => prev.filter((f) => f.id !== flagId))
      setStats((s) => s ? { ...s, pending: s.pending - 1, dismissed: s.dismissed + 1 } : s)
      toast.success('Flag dismissed')
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  async function action(flagId: string) {
    try {
      await adminApi.moderation.action(flagId)
      setPending((prev) => prev.filter((f) => f.id !== flagId))
      setStats((s) => s ? { ...s, pending: s.pending - 1, actioned: s.actioned + 1 } : s)
      toast.success('Content deleted and flag actioned')
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Moderation</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Flagged messages and abuse pattern detection.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={cn('w-3.5 h-3.5 mr-1.5', loading && 'animate-spin')} />
          Refresh
        </Button>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatPill label="Pending review" value={stats?.pending} color="text-amber-600 dark:text-amber-400" loading={loading} />
        <StatPill label="Actioned" value={stats?.actioned} color="text-destructive" loading={loading} />
        <StatPill label="Dismissed" value={stats?.dismissed} color="text-emerald-600 dark:text-emerald-400" loading={loading} />
        <StatPill label="Abuse suspects" value={abuse?.suspects.length} color="text-violet-600 dark:text-violet-400" loading={loading} />
      </div>

      {/* Tabs */}
      <Tabs defaultValue="queue">
        <TabsList>
          <TabsTrigger value="queue" className="gap-1.5">
            <ShieldAlert className="w-3.5 h-3.5" />
            Queue
            {(stats?.pending ?? 0) > 0 && (
              <span className="ml-1 inline-flex items-center justify-center h-4 min-w-4 px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold">
                {stats!.pending}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="reviewed" className="gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5" />
            Reviewed
          </TabsTrigger>
          <TabsTrigger value="abuse" className="gap-1.5">
            <UserX className="w-3.5 h-3.5" />
            Abuse Patterns
            {(abuse?.suspects.length ?? 0) > 0 && (
              <span className="ml-1 inline-flex items-center justify-center h-4 min-w-4 px-1 rounded-full bg-violet-500 text-white text-[10px] font-bold">
                {abuse!.suspects.length}
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        {/* --- Queue tab --- */}
        <TabsContent value="queue" className="mt-4">
          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-36 w-full rounded-xl" />)}
            </div>
          ) : pending.length === 0 ? (
            <Empty icon={<ShieldCheck className="w-8 h-8 text-emerald-500" />} message="No pending flags - queue is clear." />
          ) : (
            <div className="space-y-3">
              {pending.map((item) => (
                <FlagCard
                  key={item.id}
                  item={item}
                  onDismiss={() => dismiss(item.id)}
                  onAction={() => action(item.id)}
                />
              ))}
            </div>
          )}
        </TabsContent>

        {/* --- Reviewed tab --- */}
        <TabsContent value="reviewed" className="mt-4">
          {loading ? (
            <div className="space-y-3">
              {[1, 2].map((i) => <Skeleton key={i} className="h-28 w-full rounded-xl" />)}
            </div>
          ) : reviewed.length === 0 ? (
            <Empty icon={<CheckCircle2 className="w-8 h-8 text-muted-foreground" />} message="No reviewed items yet." />
          ) : (
            <div className="space-y-3">
              {reviewed.map((item) => (
                <ReviewedCard key={item.id} item={item} />
              ))}
            </div>
          )}
        </TabsContent>

        {/* --- Abuse tab --- */}
        <TabsContent value="abuse" className="mt-4">
          {loading ? (
            <Skeleton className="h-48 w-full rounded-xl" />
          ) : (
            <AbuseSuspectTable report={abuse} />
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Flag card (pending)
// ---------------------------------------------------------------------------

function FlagCard({
  item,
  onDismiss,
  onAction,
}: {
  item: FlaggedItem
  onDismiss: () => void
  onAction: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [confirming, setConfirming] = useState(false)

  const when = new Date(item.flaggedAt).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      {/* Top bar */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
        <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {item.patterns.map((p) => (
              <span
                key={p}
                className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-amber-500/10 text-amber-600 dark:text-amber-400"
              >
                {p}
              </span>
            ))}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {item.email} · {when}
          </p>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 shrink-0">
          <Button
            size="sm"
            variant="outline"
            onClick={onDismiss}
            className="h-7 px-2.5 text-xs text-emerald-600 border-emerald-500/30 hover:bg-emerald-500/10"
          >
            <ShieldCheck className="w-3.5 h-3.5 mr-1" />
            Dismiss
          </Button>
          {confirming ? (
            <>
              <Button
                size="sm"
                onClick={onAction}
                className="h-7 px-2.5 text-xs bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Delete content
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setConfirming(false)}
                className="h-7 px-2 text-xs"
              >
                Cancel
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setConfirming(true)}
              className="h-7 px-2.5 text-xs text-destructive border-destructive/30 hover:bg-destructive/10"
            >
              <Trash2 className="w-3.5 h-3.5 mr-1" />
              Action
            </Button>
          )}
          <Link
            href={`/admin/users/${item.uid}`}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>

      {/* Content snippet */}
      <div
        className="px-4 py-3 cursor-pointer select-none"
        onClick={() => setExpanded((e) => !e)}
      >
        <p
          className={cn(
            'text-sm text-muted-foreground font-mono whitespace-pre-wrap break-all',
            !expanded && 'line-clamp-2',
          )}
        >
          {item.content}
        </p>
        {item.content.length > 120 && (
          <button className="text-xs text-primary mt-1 hover:underline">
            {expanded ? 'Show less' : 'Show more'}
          </button>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Reviewed card (read-only)
// ---------------------------------------------------------------------------

function ReviewedCard({ item }: { item: FlaggedItem }) {
  const when = new Date(item.flaggedAt).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3 flex items-start gap-3 opacity-70">
      <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <StatusPill status={item.status} />
          {item.patterns.map((p) => (
            <span key={p} className="text-xs text-muted-foreground">{p}</span>
          ))}
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">{item.email} · {when}</p>
        <p className="text-sm font-mono text-muted-foreground line-clamp-1 mt-1 break-all">{item.content}</p>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Abuse suspect table
// ---------------------------------------------------------------------------

function AbuseSuspectTable({ report }: { report: AbuseReport | null }) {
  if (!report) return null

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <UserX className="w-4 h-4 text-violet-500" />
          High-Volume Users
          <span className="text-xs font-normal text-muted-foreground ml-auto">
            Platform avg: {report.platformAvg.toFixed(1)} msgs/user · threshold: 5× avg or 200+
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {report.suspects.length === 0 ? (
          <p className="px-4 pb-6 pt-2 text-sm text-center text-muted-foreground">
            No abuse suspects detected.
          </p>
        ) : (
          <div className="divide-y divide-border">
            {/* Header */}
            <div className="grid grid-cols-[1fr_100px_120px_100px] gap-4 px-4 py-2 bg-muted/50 text-xs font-medium text-muted-foreground uppercase tracking-wide">
              <span>User</span>
              <span>Plan</span>
              <span>Messages (MTD)</span>
              <span>Action</span>
            </div>
            {report.suspects.map((s) => (
              <div
                key={s.uid}
                className="grid grid-cols-[1fr_100px_120px_100px] gap-4 px-4 py-3 items-center hover:bg-muted/30 transition-colors"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{s.displayName || s.email}</p>
                  <p className="text-xs text-muted-foreground truncate">{s.email}</p>
                </div>
                <TierPill tier={s.tier} />
                <div>
                  <p className="text-sm font-semibold text-destructive">
                    {s.messagesUsed.toLocaleString()}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {((s.messagesUsed / Math.max(report.platformAvg, 1)) * 1).toFixed(0)}× avg
                  </p>
                </div>
                <Link
                  href={`/admin/users/${s.uid}`}
                  className="text-xs text-primary hover:underline inline-flex items-center gap-1"
                >
                  View user
                  <ExternalLink className="w-3 h-3" />
                </Link>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Micro components
// ---------------------------------------------------------------------------

function StatPill({
  label,
  value,
  color,
  loading,
}: {
  label: string
  value?: number
  color: string
  loading: boolean
}) {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      {loading ? (
        <Skeleton className="h-7 w-10 mt-1" />
      ) : (
        <p className={cn('text-2xl font-bold mt-0.5', color)}>{value ?? 0}</p>
      )}
    </div>
  )
}

function StatusPill({ status }: { status: string }) {
  const styles: Record<string, string> = {
    pending: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
    actioned: 'bg-destructive/10 text-destructive',
    dismissed: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  }
  return (
    <span
      className={cn(
        'inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium capitalize',
        styles[status] ?? styles.pending,
      )}
    >
      {status}
    </span>
  )
}

function TierPill({ tier }: { tier: string }) {
  const styles: Record<string, string> = {
    free: 'bg-muted text-muted-foreground',
    pro: 'bg-primary/10 text-primary',
    agency: 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
  }
  return (
    <span
      className={cn(
        'inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium capitalize',
        styles[tier] ?? styles.free,
      )}
    >
      {tier}
    </span>
  )
}

function Empty({ icon, message }: { icon: React.ReactNode; message: string }) {
  return (
    <div className="flex flex-col items-center gap-3 py-16 text-center">
      {icon}
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  )
}
