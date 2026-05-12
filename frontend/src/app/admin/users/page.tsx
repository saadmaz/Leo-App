'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { adminApi, AdminUser } from '@/lib/admin-api'
import { Skeleton } from '@/components/ui/skeleton'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Search, ChevronRight, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'

const TIER_FILTERS = [
  { label: 'All', value: '' },
  { label: 'Free', value: 'free' },
  { label: 'Pro', value: 'pro' },
  { label: 'Agency', value: 'agency' },
]

export default function AdminUsersPage() {
  const [users, setUsers] = useState<AdminUser[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [tier, setTier] = useState('')
  const [error, setError] = useState('')

  const load = useCallback(() => {
    setLoading(true)
    setError('')
    adminApi.users
      .list({ search: search || undefined, tier: tier || undefined })
      .then(setUsers)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [search, tier])

  // Reload when tier filter changes
  useEffect(() => { load() }, [tier]) // eslint-disable-line react-hooks/exhaustive-deps

  // Debounce search
  useEffect(() => {
    const t = setTimeout(load, 400)
    return () => clearTimeout(t)
  }, [search, load])

  return (
    <div className="p-8 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Users</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {loading ? 'Loading…' : `${users.length} user${users.length !== 1 ? 's' : ''}`}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={cn('w-3.5 h-3.5 mr-1.5', loading && 'animate-spin')} />
          Refresh
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search by email or name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        <div className="flex items-center gap-1">
          {TIER_FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setTier(f.value)}
              className={cn(
                'px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
                tier === f.value
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive mb-4">
          {error}
        </div>
      )}

      {/* Table */}
      <div className="rounded-xl border border-border overflow-hidden">
        {/* Table header */}
        <div className="grid grid-cols-[1fr_100px_120px_120px_110px_44px] gap-4 px-4 py-2.5 bg-muted/50 border-b border-border text-xs font-medium text-muted-foreground uppercase tracking-wide">
          <span>User</span>
          <span>Plan</span>
          <span>Credits</span>
          <span>Messages (MTD)</span>
          <span>Joined</span>
          <span />
        </div>

        {loading ? (
          <div className="divide-y divide-border">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="px-4 py-3 grid grid-cols-[1fr_100px_120px_120px_110px_44px] gap-4 items-center">
                <div className="space-y-1.5">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-28" />
                </div>
                <Skeleton className="h-5 w-14" />
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-4 ml-auto" />
              </div>
            ))}
          </div>
        ) : users.length === 0 ? (
          <div className="px-4 py-12 text-center text-sm text-muted-foreground">
            No users found.
          </div>
        ) : (
          <div className="divide-y divide-border">
            {users.map((user) => (
              <UserRow key={user.uid} user={user} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function UserRow({ user }: { user: AdminUser }) {
  const joined = user.createdAt
    ? new Date(user.createdAt).toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric',
      })
    : '-'

  return (
    <Link
      href={`/admin/users/${user.uid}`}
      className="grid grid-cols-[1fr_100px_120px_120px_110px_44px] gap-4 px-4 py-3 items-center hover:bg-muted/40 transition-colors"
    >
      {/* Identity */}
      <div className="min-w-0">
        <p className="text-sm font-medium truncate">
          {user.displayName || user.email}
        </p>
        <p className="text-xs text-muted-foreground truncate">{user.email}</p>
      </div>

      {/* Tier */}
      <TierBadge tier={user.tier} />

      {/* Credits balance */}
      <span className="text-sm text-muted-foreground tabular-nums">
        {user.credits?.balance != null
          ? user.credits.balance.toLocaleString()
          : '-'}
      </span>

      {/* Messages used */}
      <span className="text-sm text-muted-foreground tabular-nums">
        {user.billing.messagesUsed.toLocaleString()}
      </span>

      {/* Joined */}
      <span className="text-sm text-muted-foreground">{joined}</span>

      {/* Arrow */}
      <ChevronRight className="w-4 h-4 text-muted-foreground ml-auto" />
    </Link>
  )
}

function TierBadge({ tier }: { tier: string }) {
  const variants: Record<string, string> = {
    free: 'bg-muted text-muted-foreground',
    pro: 'bg-primary/10 text-primary',
    agency: 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
  }
  return (
    <span
      className={cn(
        'inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium capitalize',
        variants[tier] ?? variants.free,
      )}
    >
      {tier}
    </span>
  )
}
