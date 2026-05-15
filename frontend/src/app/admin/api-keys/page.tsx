'use client'

import { useEffect, useState } from 'react'
import { adminApi, ApiKeyStatus } from '@/lib/admin-api'
import { Skeleton } from '@/components/ui/skeleton'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  CheckCircle2,
  XCircle,
  KeyRound,
  AlertTriangle,
  RefreshCw,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const CATEGORY_ORDER = [
  'LLM',
  'Search',
  'Scraping',
  'Social',
  'Brand',
  'Storage',
  'Email',
  'Email CRM',
  'Payments',
  'CRM',
  'PR',
  'Translation',
]

export default function ApiKeysPage() {
  const [keys, setKeys] = useState<ApiKeyStatus[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  function load() {
    setLoading(true)
    setError('')
    adminApi.apiKeys
      .list()
      .then(setKeys)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(load, [])

  const grouped = CATEGORY_ORDER.reduce<Record<string, ApiKeyStatus[]>>((acc, cat) => {
    const items = keys.filter((k) => k.category === cat)
    if (items.length > 0) acc[cat] = items
    return acc
  }, {})

  const uncategorised = keys.filter((k) => !CATEGORY_ORDER.includes(k.category))
  if (uncategorised.length > 0) grouped['Other'] = uncategorised

  const totalConfigured = keys.filter((k) => k.configured).length
  const totalMissing = keys.filter((k) => !k.configured).length
  const nearLimit = keys.filter((k) => {
    if (!k.usage) return false
    return k.usage.total > 0 && k.usage.used / k.usage.total >= 0.8
  })

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">API Keys</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Configuration status and live usage for all third-party integrations.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading} className="gap-2">
          <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
          Refresh
        </Button>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive mb-6">
          {error}
        </div>
      )}

      {/* Summary row */}
      {!loading && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 mb-8 text-sm">
          <span className="flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
            <strong>{totalConfigured}</strong>
            <span className="text-muted-foreground">configured</span>
          </span>
          <span className="text-border">|</span>
          <span className="flex items-center gap-1.5">
            <XCircle className="w-4 h-4 text-muted-foreground/50" />
            <strong>{totalMissing}</strong>
            <span className="text-muted-foreground">missing</span>
          </span>
          {nearLimit.length > 0 && (
            <>
              <span className="text-border">|</span>
              <span className="flex items-center gap-1.5 text-amber-600">
                <AlertTriangle className="w-4 h-4" />
                <strong>{nearLimit.length}</strong> near limit
                ({nearLimit.map((k) => k.name).join(', ')})
              </span>
            </>
          )}
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-48 w-full" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {Object.entries(grouped).map(([category, items]) => (
            <CategoryCard key={category} category={category} items={items} />
          ))}
        </div>
      )}
    </div>
  )
}

function CategoryCard({ category, items }: { category: string; items: ApiKeyStatus[] }) {
  const missing = items.filter((k) => !k.configured).length
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold flex items-center justify-between">
          <span className="flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-primary" />
            {category}
          </span>
          {missing > 0 ? (
            <Badge variant="destructive" className="text-xs font-normal">
              {missing} missing
            </Badge>
          ) : (
            <Badge variant="secondary" className="text-xs font-normal text-emerald-600 bg-emerald-500/10">
              All set
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {items.map((key) => (
          <KeyRow key={key.id} item={key} />
        ))}
      </CardContent>
    </Card>
  )
}

function KeyRow({ item }: { item: ApiKeyStatus }) {
  return (
    <div className="space-y-2">
      {/* Name + status */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          {item.configured ? (
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
          ) : (
            <XCircle className="w-3.5 h-3.5 text-muted-foreground/50 shrink-0" />
          )}
          <span className="text-sm truncate">{item.name}</span>
        </div>
        {item.maskedKey ? (
          <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono text-muted-foreground shrink-0">
            {item.maskedKey}
          </code>
        ) : (
          <span className="text-xs text-muted-foreground/40 italic shrink-0">not set</span>
        )}
      </div>

      {/* Usage bar — only shown when we have live usage data */}
      {item.usage && item.configured && (
        <UsageBar used={item.usage.used} total={item.usage.total} label={item.usage.label} />
      )}
    </div>
  )
}

function UsageBar({ used, total, label }: { used: number; total: number; label: string }) {
  const pct = total > 0 ? Math.min(Math.round((used / total) * 100), 100) : 0
  const barColor =
    pct >= 90 ? 'bg-destructive' : pct >= 70 ? 'bg-amber-500' : 'bg-emerald-500'
  const textColor =
    pct >= 90 ? 'text-destructive' : pct >= 70 ? 'text-amber-600' : 'text-muted-foreground'

  return (
    <div className="space-y-1 pl-5">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className={cn('text-xs font-medium', textColor)}>{pct}%</span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
        <div
          className={cn('h-full rounded-full transition-all', barColor)}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}
