'use client'

import { useEffect, useState } from 'react'
import { adminApi, SystemHealth, HealthCheck } from '@/lib/admin-api'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  RefreshCw,
  CheckCircle2,
  XCircle,
  Activity,
  Zap,
} from 'lucide-react'
import { cn } from '@/lib/utils'

export default function AdminSystemPage() {
  const [health, setHealth] = useState<SystemHealth | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  function load() {
    setLoading(true)
    setError('')
    adminApi.system
      .health()
      .then(setHealth)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(load, [])

  const checkedAt = health?.checkedAt
    ? new Date(health.checkedAt).toLocaleString('en-US', {
        month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
      })
    : null

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">System Health</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Live status of every external service dependency.
            {checkedAt && <span className="ml-1">Last checked: {checkedAt}</span>}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={cn('w-3.5 h-3.5 mr-1.5', loading && 'animate-spin')} />
          Recheck All
        </Button>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Overall status banner */}
      {loading ? (
        <Skeleton className="h-16 w-full rounded-xl" />
      ) : health && (
        <OverallBanner overall={health.overall} checkCount={health.checks.length} />
      )}

      {/* Service cards grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {loading
          ? [1, 2, 3, 4, 5, 6].map((i) => <Skeleton key={i} className="h-28 rounded-xl" />)
          : health?.checks.map((check) => (
              <ServiceCard key={check.name} check={check} />
            ))}
      </div>

      {/* Config key summary */}
      {!loading && health && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Zap className="w-4 h-4 text-primary" />
              Response Times
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {health.checks.map((c) => (
                <LatencyRow key={c.name} check={c} max={Math.max(...health.checks.map((x) => x.latencyMs), 1)} />
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function OverallBanner({ overall, checkCount }: { overall: string; checkCount: number }) {
  const config = {
    healthy: {
      bg: 'bg-emerald-500/10 border-emerald-500/30',
      text: 'text-emerald-700 dark:text-emerald-400',
      icon: <CheckCircle2 className="w-5 h-5" />,
      label: 'All systems operational',
    },
    degraded: {
      bg: 'bg-amber-500/10 border-amber-500/30',
      text: 'text-amber-700 dark:text-amber-400',
      icon: <Activity className="w-5 h-5" />,
      label: 'Partial outage - some services degraded',
    },
    down: {
      bg: 'bg-destructive/10 border-destructive/30',
      text: 'text-destructive',
      icon: <XCircle className="w-5 h-5" />,
      label: 'Major outage - multiple services down',
    },
  }[overall] ?? {
    bg: 'bg-muted border-border',
    text: 'text-muted-foreground',
    icon: <Activity className="w-5 h-5" />,
    label: 'Unknown status',
  }

  return (
    <div className={cn('flex items-center gap-3 rounded-xl border px-5 py-4', config.bg)}>
      <span className={config.text}>{config.icon}</span>
      <div className={config.text}>
        <p className="font-semibold">{config.label}</p>
        <p className="text-sm opacity-80">{checkCount} services checked</p>
      </div>
    </div>
  )
}

function ServiceCard({ check }: { check: HealthCheck }) {
  const ok = check.status === 'ok'
  return (
    <div
      className={cn(
        'rounded-xl border bg-card p-4 flex gap-3',
        ok ? 'border-border' : 'border-destructive/40',
      )}
    >
      {/* Status dot */}
      <div className="shrink-0 mt-0.5">
        {ok ? (
          <CheckCircle2 className="w-5 h-5 text-emerald-500" />
        ) : (
          <XCircle className="w-5 h-5 text-destructive" />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-semibold">{check.name}</p>
          <span className={cn(
            'text-xs font-mono shrink-0',
            check.latencyMs < 500 ? 'text-emerald-600 dark:text-emerald-400' :
            check.latencyMs < 2000 ? 'text-amber-600 dark:text-amber-400' :
            'text-destructive',
          )}>
            {check.latencyMs}ms
          </span>
        </div>
        <p className={cn(
          'text-xs mt-1 truncate',
          ok ? 'text-muted-foreground' : 'text-destructive',
        )}>
          {check.detail}
        </p>
      </div>
    </div>
  )
}

function LatencyRow({ check, max }: { check: HealthCheck; max: number }) {
  const pct = Math.round((check.latencyMs / max) * 100)
  const color =
    check.status !== 'ok' ? 'bg-destructive' :
    check.latencyMs < 500 ? 'bg-emerald-500' :
    check.latencyMs < 2000 ? 'bg-amber-500' : 'bg-destructive'

  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-muted-foreground">{check.name}</span>
        <span className={cn(
          'font-mono font-medium',
          check.status !== 'ok' ? 'text-destructive' : 'text-foreground',
        )}>
          {check.status !== 'ok' ? 'error' : `${check.latencyMs}ms`}
        </span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
        <div
          className={cn('h-full rounded-full transition-all', color)}
          style={{ width: `${Math.max(pct, 2)}%` }}
        />
      </div>
    </div>
  )
}
