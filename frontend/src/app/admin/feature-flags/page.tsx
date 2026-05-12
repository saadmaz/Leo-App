'use client'

import { useEffect, useState, useCallback } from 'react'
import { adminApi, FeatureFlag } from '@/lib/admin-api'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { RefreshCw, Plus, Trash2, X, ChevronDown, ChevronUp, Users } from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

const ALL_TIERS = ['free', 'pro', 'agency'] as const

export default function AdminFeatureFlagsPage() {
  const [flags, setFlags] = useState<FeatureFlag[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    adminApi.featureFlags
      .list()
      .then(setFlags)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  useEffect(load, [load])

  async function handleToggle(flag: FeatureFlag) {
    const next = !flag.enabled
    setFlags((prev) => prev.map((f) => f.id === flag.id ? { ...f, enabled: next } : f))
    try {
      await adminApi.featureFlags.toggle(flag.id, next)
      toast.success(`"${flag.name}" ${next ? 'enabled' : 'disabled'}`)
    } catch (e) {
      // Revert optimistic update
      setFlags((prev) => prev.map((f) => f.id === flag.id ? { ...f, enabled: flag.enabled } : f))
      toast.error((e as Error).message)
    }
  }

  async function handleDelete(flag: FeatureFlag) {
    if (!confirm(`Delete flag "${flag.name}"? This cannot be undone.`)) return
    try {
      await adminApi.featureFlags.delete(flag.id)
      setFlags((prev) => prev.filter((f) => f.id !== flag.id))
      toast.success('Flag deleted')
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  function onFlagUpdated(updated: FeatureFlag) {
    setFlags((prev) => prev.map((f) => f.id === updated.id ? updated : f))
  }

  function onFlagCreated(flag: FeatureFlag) {
    setFlags((prev) => [...prev, flag].sort((a, b) => a.id.localeCompare(b.id)))
    setCreating(false)
  }

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Feature Flags</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Control feature availability globally, by plan, or per user.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={cn('w-3.5 h-3.5 mr-1.5', loading && 'animate-spin')} />
            Refresh
          </Button>
          <Button size="sm" onClick={() => setCreating(true)} disabled={creating}>
            <Plus className="w-3.5 h-3.5 mr-1.5" />
            New Flag
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Create new flag inline form */}
      {creating && (
        <CreateFlagForm
          onCreated={onFlagCreated}
          onCancel={() => setCreating(false)}
        />
      )}

      {/* Flag list */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-24 w-full rounded-xl" />)}
        </div>
      ) : flags.length === 0 ? (
        <p className="text-sm text-center text-muted-foreground py-12">
          No feature flags yet. Click &quot;New Flag&quot; to create one.
        </p>
      ) : (
        <div className="space-y-3">
          {flags.map((flag) => (
            <FlagCard
              key={flag.id}
              flag={flag}
              onToggle={() => handleToggle(flag)}
              onDelete={() => handleDelete(flag)}
              onUpdated={onFlagUpdated}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Flag card - shows toggle, tier gates, user overrides
// ---------------------------------------------------------------------------

function FlagCard({
  flag,
  onToggle,
  onDelete,
  onUpdated,
}: {
  flag: FeatureFlag
  onToggle: () => void
  onDelete: () => void
  onUpdated: (f: FeatureFlag) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [overrideUid, setOverrideUid] = useState('')
  const [overrideVal, setOverrideVal] = useState<boolean>(true)
  const [saving, setSaving] = useState(false)

  async function handleTierToggle(tier: string) {
    const current = flag.allowedTiers
    let next: string[] | null
    if (current === null) {
      // Currently all tiers → restrict to everything except this one
      next = ALL_TIERS.filter((t) => t !== tier)
    } else if (current.includes(tier)) {
      const filtered = current.filter((t) => t !== tier)
      next = filtered.length === ALL_TIERS.length ? null : filtered.length === 0 ? null : filtered
    } else {
      const added = [...current, tier]
      next = added.length === ALL_TIERS.length ? null : added
    }
    setSaving(true)
    try {
      const updated = await adminApi.featureFlags.setTiers(flag.id, next)
      if (updated) onUpdated(updated)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  async function handleAddOverride() {
    if (!overrideUid.trim()) return
    setSaving(true)
    try {
      await adminApi.featureFlags.setUserOverride(flag.id, overrideUid.trim(), overrideVal)
      const updated = await adminApi.featureFlags.list().then((all) => all.find((f) => f.id === flag.id))
      if (updated) onUpdated(updated)
      setOverrideUid('')
      toast.success('Override saved')
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  async function handleRemoveOverride(uid: string) {
    setSaving(true)
    try {
      await adminApi.featureFlags.removeUserOverride(flag.id, uid)
      const updated = await adminApi.featureFlags.list().then((all) => all.find((f) => f.id === flag.id))
      if (updated) onUpdated(updated)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const overrideCount = Object.keys(flag.userOverrides ?? {}).length

  return (
    <div className={cn(
      'rounded-xl border bg-card overflow-hidden transition-colors',
      flag.enabled ? 'border-border' : 'border-border opacity-70',
    )}>
      {/* Main row */}
      <div className="flex items-center gap-4 px-4 py-3">
        {/* Toggle switch */}
        <button
          onClick={onToggle}
          className={cn(
            'relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors focus:outline-none',
            flag.enabled ? 'bg-primary' : 'bg-muted-foreground/30',
          )}
          role="switch"
          aria-checked={flag.enabled}
        >
          <span
            className={cn(
              'pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm transform transition-transform',
              flag.enabled ? 'translate-x-4' : 'translate-x-0',
            )}
          />
        </button>

        {/* ID + name */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <code className="text-sm font-mono font-medium">{flag.id}</code>
            <span className="text-sm text-muted-foreground truncate">{flag.name}</span>
          </div>
          {flag.description && (
            <p className="text-xs text-muted-foreground truncate mt-0.5">{flag.description}</p>
          )}
        </div>

        {/* Tier chips */}
        <div className="flex items-center gap-1 shrink-0">
          {flag.allowedTiers === null ? (
            <span className="text-xs text-muted-foreground">All tiers</span>
          ) : flag.allowedTiers.length === 0 ? (
            <span className="text-xs text-destructive">Nobody</span>
          ) : (
            flag.allowedTiers.map((t) => <TierChip key={t} tier={t} />)
          )}
        </div>

        {/* Override count */}
        {overrideCount > 0 && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
            <Users className="w-3 h-3" />
            {overrideCount}
          </span>
        )}

        {/* Expand / delete */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => setExpanded((e) => !e)}
            className="p-1.5 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          <button
            onClick={onDelete}
            className="p-1.5 rounded-md text-muted-foreground hover:bg-muted hover:text-destructive transition-colors"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Expanded panel */}
      {expanded && (
        <div className="border-t border-border px-4 py-4 space-y-5 bg-muted/20">
          {/* Tier gate */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
              Tier Access
            </p>
            <div className="flex items-center gap-2">
              {ALL_TIERS.map((tier) => {
                const active = flag.allowedTiers === null || flag.allowedTiers.includes(tier)
                return (
                  <button
                    key={tier}
                    disabled={saving}
                    onClick={() => handleTierToggle(tier)}
                    className={cn(
                      'px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors capitalize',
                      active
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-card text-muted-foreground border-border hover:border-primary/50',
                    )}
                  >
                    {tier}
                  </button>
                )
              })}
              <span className="text-xs text-muted-foreground ml-2">
                {flag.allowedTiers === null ? 'All tiers have access' : `${flag.allowedTiers.length} tier(s) allowed`}
              </span>
            </div>
          </div>

          <Separator />

          {/* User overrides */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
              Per-User Overrides
            </p>

            {/* Existing overrides */}
            {overrideCount > 0 && (
              <div className="space-y-1.5 mb-3">
                {Object.entries(flag.userOverrides).map(([uid, val]) => (
                  <div key={uid} className="flex items-center gap-2 text-sm">
                    <span className={cn(
                      'w-2 h-2 rounded-full shrink-0',
                      val ? 'bg-emerald-500' : 'bg-destructive',
                    )} />
                    <code className="flex-1 text-xs font-mono text-muted-foreground truncate">{uid}</code>
                    <span className={cn('text-xs', val ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive')}>
                      {val ? 'force-on' : 'force-off'}
                    </span>
                    <button
                      onClick={() => handleRemoveOverride(uid)}
                      disabled={saving}
                      className="p-0.5 text-muted-foreground hover:text-destructive transition-colors"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Add override */}
            <div className="flex items-center gap-2">
              <Input
                placeholder="User UID…"
                value={overrideUid}
                onChange={(e) => setOverrideUid(e.target.value)}
                className="h-8 text-sm font-mono"
              />
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => setOverrideVal(true)}
                  className={cn(
                    'px-2.5 py-1.5 rounded-md text-xs font-medium border transition-colors',
                    overrideVal
                      ? 'bg-emerald-500 text-white border-emerald-500'
                      : 'bg-card text-muted-foreground border-border',
                  )}
                >
                  On
                </button>
                <button
                  onClick={() => setOverrideVal(false)}
                  className={cn(
                    'px-2.5 py-1.5 rounded-md text-xs font-medium border transition-colors',
                    !overrideVal
                      ? 'bg-destructive text-destructive-foreground border-destructive'
                      : 'bg-card text-muted-foreground border-border',
                  )}
                >
                  Off
                </button>
              </div>
              <Button
                size="sm"
                onClick={handleAddOverride}
                disabled={saving || !overrideUid.trim()}
                className="h-8 shrink-0"
              >
                Add
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Create flag inline form
// ---------------------------------------------------------------------------

function CreateFlagForm({
  onCreated,
  onCancel,
}: {
  onCreated: (f: FeatureFlag) => void
  onCancel: () => void
}) {
  const [id, setId] = useState('')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [enabled, setEnabled] = useState(true)
  const [selectedTiers, setSelectedTiers] = useState<string[]>([...ALL_TIERS])
  const [saving, setSaving] = useState(false)

  function toggleTier(tier: string) {
    setSelectedTiers((prev) =>
      prev.includes(tier) ? prev.filter((t) => t !== tier) : [...prev, tier],
    )
  }

  async function handleCreate() {
    if (!id.trim() || !name.trim()) return
    setSaving(true)
    try {
      const allSelected = selectedTiers.length === ALL_TIERS.length
      const flag = await adminApi.featureFlags.upsert(id.trim(), {
        name: name.trim(),
        description: description.trim(),
        enabled,
        allowedTiers: allSelected ? null : selectedTiers,
        userOverrides: {},
      })
      onCreated(flag)
      toast.success(`Flag "${name}" created`)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card className="border-primary/30">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold">New Feature Flag</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">
              ID (slug)
            </label>
            <Input
              placeholder="my_feature"
              value={id}
              onChange={(e) => setId(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'))}
              className="font-mono"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">
              Display Name
            </label>
            <Input
              placeholder="My Feature"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">
            Description
          </label>
          <Input
            placeholder="What does this flag control?"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-6">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">
              Initially enabled
            </label>
            <button
              onClick={() => setEnabled((e) => !e)}
              className={cn(
                'relative inline-flex h-5 w-9 rounded-full border-2 border-transparent transition-colors',
                enabled ? 'bg-primary' : 'bg-muted-foreground/30',
              )}
            >
              <span
                className={cn(
                  'inline-block h-4 w-4 rounded-full bg-white shadow-sm transform transition-transform',
                  enabled ? 'translate-x-4' : 'translate-x-0',
                )}
              />
            </button>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">
              Allowed Tiers
            </label>
            <div className="flex gap-1.5">
              {ALL_TIERS.map((t) => (
                <button
                  key={t}
                  onClick={() => toggleTier(t)}
                  className={cn(
                    'px-2.5 py-1 rounded-md text-xs font-medium border capitalize transition-colors',
                    selectedTiers.includes(t)
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-card text-muted-foreground border-border',
                  )}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
          <Button size="sm" onClick={handleCreate} disabled={saving || !id.trim() || !name.trim()}>
            {saving ? 'Creating…' : 'Create Flag'}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Tier chip
// ---------------------------------------------------------------------------

function TierChip({ tier }: { tier: string }) {
  const styles: Record<string, string> = {
    free: 'bg-muted text-muted-foreground',
    pro: 'bg-primary/10 text-primary',
    agency: 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
  }
  return (
    <span className={cn('inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium capitalize', styles[tier] ?? styles.free)}>
      {tier}
    </span>
  )
}
