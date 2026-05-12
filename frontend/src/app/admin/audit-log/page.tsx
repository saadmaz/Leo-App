'use client'

import { useEffect, useState } from 'react'
import { adminApi, AuditLogEntry } from '@/lib/admin-api'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'

// Human-readable labels + colour per action
const ACTION_META: Record<string, { label: string; color: string }> = {
  change_tier:      { label: 'Changed tier',       color: 'text-blue-600 dark:text-blue-400 bg-blue-500/10' },
  reset_usage:      { label: 'Reset usage',         color: 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/10' },
  suspend_user:     { label: 'Suspended user',      color: 'text-amber-600 dark:text-amber-400 bg-amber-500/10' },
  unsuspend_user:   { label: 'Unsuspended user',    color: 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/10' },
  override_limits:  { label: 'Overrode limits',     color: 'text-violet-600 dark:text-violet-400 bg-violet-500/10' },
  delete_user:      { label: 'Deleted user',        color: 'text-destructive bg-destructive/10' },
  delete_project:   { label: 'Deleted project',     color: 'text-destructive bg-destructive/10' },
  grant_admin:      { label: 'Granted admin',       color: 'text-violet-600 dark:text-violet-400 bg-violet-500/10' },
  revoke_admin:     { label: 'Revoked admin',       color: 'text-amber-600 dark:text-amber-400 bg-amber-500/10' },
}

export default function AdminAuditLogPage() {
  const [entries, setEntries] = useState<AuditLogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  function load() {
    setLoading(true)
    setError('')
    adminApi.auditLog
      .list(200)
      .then(setEntries)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(load, [])

  return (
    <div className="p-8 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Audit Log</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Every admin action is recorded here with who did it and when.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={cn('w-3.5 h-3.5 mr-1.5', loading && 'animate-spin')} />
          Refresh
        </Button>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive mb-4">
          {error}
        </div>
      )}

      {/* Log list */}
      <div className="rounded-xl border border-border overflow-hidden">
        {/* Column headers */}
        <div className="grid grid-cols-[140px_1fr_200px_160px] gap-4 px-4 py-2.5 bg-muted/50 border-b border-border text-xs font-medium text-muted-foreground uppercase tracking-wide">
          <span>Action</span>
          <span>Details</span>
          <span>Target</span>
          <span>When</span>
        </div>

        {loading ? (
          <div className="divide-y divide-border">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="grid grid-cols-[140px_1fr_200px_160px] gap-4 px-4 py-3 items-center">
                <Skeleton className="h-5 w-24" />
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-4 w-28" />
              </div>
            ))}
          </div>
        ) : entries.length === 0 ? (
          <div className="px-4 py-12 text-center text-sm text-muted-foreground">
            No audit log entries yet. Admin actions will appear here.
          </div>
        ) : (
          <div className="divide-y divide-border">
            {entries.map((entry) => (
              <AuditRow key={entry.id} entry={entry} />
            ))}
          </div>
        )}
      </div>

      {!loading && entries.length > 0 && (
        <p className="text-xs text-muted-foreground text-center mt-3">
          Showing the most recent {entries.length} entries
        </p>
      )}
    </div>
  )
}

function AuditRow({ entry }: { entry: AuditLogEntry }) {
  const meta = ACTION_META[entry.action] ?? {
    label: entry.action,
    color: 'text-muted-foreground bg-muted',
  }

  const when = entry.timestamp
    ? new Date(entry.timestamp).toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '-'

  const detailText = formatDetails(entry.action, entry.details)

  return (
    <div className="grid grid-cols-[140px_1fr_200px_160px] gap-4 px-4 py-3 items-start hover:bg-muted/30 transition-colors">
      {/* Action badge */}
      <span
        className={cn(
          'inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium w-fit',
          meta.color,
        )}
      >
        {meta.label}
      </span>

      {/* Details */}
      <span className="text-sm text-muted-foreground truncate">{detailText}</span>

      {/* Target UID */}
      <span className="text-xs font-mono text-muted-foreground truncate" title={entry.targetUid}>
        {entry.targetUid ? `${entry.targetUid.slice(0, 16)}…` : '-'}
      </span>

      {/* Timestamp */}
      <span className="text-sm text-muted-foreground">{when}</span>
    </div>
  )
}

function formatDetails(action: string, details: Record<string, unknown>): string {
  if (!details || Object.keys(details).length === 0) return '-'

  switch (action) {
    case 'change_tier':
      return `${details.from} → ${details.to}`
    case 'override_limits': {
      const ov = details.overrides as Record<string, number> | undefined
      if (!ov) return '-'
      return Object.entries(ov)
        .map(([k, v]) => `${k}: ${v}`)
        .join(', ')
    }
    case 'delete_user':
      return `${details.email ?? ''} (${details.tier ?? 'free'})`
    case 'delete_project':
      return `"${details.projectName ?? details.projectId ?? ''}"`
    default:
      return JSON.stringify(details)
  }
}
