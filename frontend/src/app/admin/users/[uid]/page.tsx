'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { adminApi, AdminUser } from '@/lib/admin-api'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import {
  ArrowLeft,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  RotateCcw,
  CreditCard,
  MessageSquare,
  FolderOpen,
  User,
  AlertTriangle,
  Zap,
  Crown,
  SlidersHorizontal,
  ChevronDown,
  ChevronUp,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

const TIERS = ['free', 'pro', 'agency'] as const

export default function AdminUserDetailPage() {
  const { uid } = useParams<{ uid: string }>()
  const router = useRouter()
  const [user, setUser] = useState<AdminUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [acting, setActing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [topupAmount, setTopupAmount] = useState('500')
  const [topupReason, setTopupReason] = useState('')
  const [showOverrides, setShowOverrides] = useState(false)
  const [overrideMsgs, setOverrideMsgs] = useState('')
  const [overrideProjects, setOverrideProjects] = useState('')
  const [overrideIngestions, setOverrideIngestions] = useState('')

  useEffect(() => {
    adminApi.users
      .get(uid)
      .then(setUser)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [uid])

  async function act<T>(fn: () => Promise<T>, successMsg: string, update?: (r: T) => void) {
    setActing(true)
    try {
      const result = await fn()
      toast.success(successMsg)
      if (update) update(result)
      else {
        // Refresh full user
        const fresh = await adminApi.users.get(uid)
        setUser(fresh)
      }
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setActing(false)
    }
  }

  const handleChangeTier = (tier: typeof TIERS[number]) =>
    act(() => adminApi.users.updateTier(uid, tier), `Plan changed to ${tier}`, (u) =>
      setUser(u as AdminUser),
    )

  const handleResetUsage = () =>
    act(() => adminApi.users.resetUsage(uid), 'Usage reset successfully')

  const handleSuspend = () =>
    act(
      () => adminApi.users.suspend(uid),
      'User suspended',
      () => setUser((u) => u ? { ...u, suspended: true } : u),
    )

  const handleUnsuspend = () =>
    act(
      () => adminApi.users.unsuspend(uid),
      'User unsuspended',
      () => setUser((u) => u ? { ...u, suspended: false } : u),
    )

  const handleGrantAdmin = () =>
    act(() => adminApi.users.grantAdmin(uid), 'Super admin granted', () =>
      setUser((u) => u ? { ...u, adminOverrides: { ...u.adminOverrides, isSuperAdmin: 1 } } : u),
    )

  const handleRevokeAdmin = () =>
    act(() => adminApi.users.revokeAdmin(uid), 'Super admin revoked', () =>
      setUser((u) => u ? { ...u, adminOverrides: { ...u.adminOverrides, isSuperAdmin: 0 } } : u),
    )

  const handleTopup = () => {
    const amount = parseInt(topupAmount, 10)
    if (!amount || amount <= 0) { toast.error('Enter a valid amount'); return }
    act(() => adminApi.credits.topup(uid, amount, topupReason || 'Admin topup'), `Added ${amount} credits`)
    setTopupAmount('500')
    setTopupReason('')
  }

  const handleOverrideLimits = () => {
    const limits: Record<string, number> = {}
    if (overrideMsgs) limits.messagesLimit = parseInt(overrideMsgs, 10)
    if (overrideProjects) limits.projectsLimit = parseInt(overrideProjects, 10)
    if (overrideIngestions) limits.ingestionsLimit = parseInt(overrideIngestions, 10)
    if (Object.keys(limits).length === 0) { toast.error('Enter at least one override value'); return }
    act(() => adminApi.users.overrideLimits(uid, limits), 'Limits overridden')
    setOverrideMsgs(''); setOverrideProjects(''); setOverrideIngestions('')
  }

  const handleDelete = async () => {
    if (!confirmDelete) { setConfirmDelete(true); return }
    setActing(true)
    try {
      await adminApi.users.delete(uid)
      toast.success('User deleted')
      router.replace('/admin/users')
    } catch (e) {
      toast.error((e as Error).message)
      setActing(false)
    }
  }

  if (loading) {
    return (
      <div className="p-8 max-w-3xl mx-auto space-y-4">
        <Skeleton className="h-6 w-24" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    )
  }

  if (error || !user) {
    return (
      <div className="p-8 max-w-3xl mx-auto">
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error || 'User not found.'}
        </div>
      </div>
    )
  }

  const joined = user.createdAt
    ? new Date(user.createdAt).toLocaleDateString('en-US', {
        month: 'long', day: 'numeric', year: 'numeric',
      })
    : '-'

  const periodEnd = user.billing.currentPeriodEnd
    ? new Date(user.billing.currentPeriodEnd * 1000).toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric',
      })
    : null

  return (
    <div className="p-8 max-w-3xl mx-auto space-y-6">
      {/* Back */}
      <Link
        href="/admin/users"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        All users
      </Link>

      {/* Identity card */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              {/* Avatar placeholder */}
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                <User className="w-5 h-5 text-primary" />
              </div>
              <div>
                <CardTitle className="text-base">
                  {user.displayName || user.email}
                </CardTitle>
                <p className="text-sm text-muted-foreground">{user.email}</p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {user.suspended && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-destructive/10 text-destructive">
                  <ShieldAlert className="w-3 h-3" />
                  Suspended
                </span>
              )}
              <TierPill tier={user.tier} />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
            <InfoRow label="UID" value={<code className="text-xs bg-muted px-1.5 py-0.5 rounded">{user.uid}</code>} />
            <InfoRow label="Joined" value={joined} />
            {user.billing.stripeCustomerId && (
              <InfoRow label="Stripe Customer" value={
                <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{user.billing.stripeCustomerId}</code>
              } />
            )}
            {user.billing.subscriptionStatus && (
              <InfoRow label="Subscription" value={
                <span className={cn(
                  'capitalize',
                  user.billing.subscriptionStatus === 'active' ? 'text-emerald-600' : 'text-muted-foreground',
                )}>
                  {user.billing.subscriptionStatus}
                </span>
              } />
            )}
            {periodEnd && <InfoRow label="Period ends" value={periodEnd} />}
          </dl>
        </CardContent>
      </Card>

      {/* Usage */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">Usage (this month)</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-4 gap-4">
          <UsageStat
            icon={<Zap className="w-4 h-4" />}
            label="Credits"
            value={user.credits?.balance != null ? user.credits.balance.toLocaleString() : '-'}
          />
          <UsageStat
            icon={<MessageSquare className="w-4 h-4" />}
            label="Messages"
            value={user.billing.messagesUsed}
          />
          <UsageStat
            icon={<FolderOpen className="w-4 h-4" />}
            label="Projects"
            value={user.projectCount ?? '-'}
          />
          <UsageStat
            icon={<CreditCard className="w-4 h-4" />}
            label="Ingestions"
            value={user.billing.ingestionsUsed}
          />
        </CardContent>
      </Card>

      {/* Actions */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">Admin Actions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Change tier */}
          <div>
            <p className="text-sm font-medium mb-2">Change plan</p>
            <div className="flex gap-2">
              {TIERS.map((t) => (
                <Button
                  key={t}
                  variant={user.tier === t ? 'default' : 'outline'}
                  size="sm"
                  disabled={acting || user.tier === t}
                  onClick={() => handleChangeTier(t)}
                  className="capitalize"
                >
                  {t}
                </Button>
              ))}
            </div>
          </div>

          <Separator />

          {/* Reset usage */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Reset monthly usage</p>
              <p className="text-xs text-muted-foreground">
                Clears message counter back to 0 for this billing period.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={acting}
              onClick={handleResetUsage}
            >
              <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
              Reset
            </Button>
          </div>

          <Separator />

          {/* Credits topup */}
          <div>
            <p className="text-sm font-medium mb-2 flex items-center gap-1.5">
              <Zap className="w-3.5 h-3.5 text-amber-500" />
              Add credits
            </p>
            <div className="flex gap-2 flex-wrap">
              <input
                type="number"
                min={1}
                value={topupAmount}
                onChange={(e) => setTopupAmount(e.target.value)}
                placeholder="Amount"
                className="w-24 px-2 py-1.5 text-sm border border-border rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <input
                value={topupReason}
                onChange={(e) => setTopupReason(e.target.value)}
                placeholder="Reason (optional)"
                className="flex-1 min-w-0 px-2 py-1.5 text-sm border border-border rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <Button size="sm" variant="outline" disabled={acting} onClick={handleTopup}>
                <Zap className="w-3.5 h-3.5 mr-1.5 text-amber-500" />
                Topup
              </Button>
            </div>
          </div>

          <Separator />

          {/* Grant / revoke super admin */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium flex items-center gap-1.5">
                <Crown className="w-3.5 h-3.5 text-amber-500" />
                Super admin access
              </p>
              <p className="text-xs text-muted-foreground">Grant or revoke the superAdmin Firebase custom claim.</p>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={acting} onClick={handleGrantAdmin}>
                Grant
              </Button>
              <Button size="sm" variant="outline" disabled={acting} onClick={handleRevokeAdmin}
                className="text-destructive border-destructive/40 hover:bg-destructive/10">
                Revoke
              </Button>
            </div>
          </div>

          <Separator />

          {/* Custom limit overrides */}
          <div>
            <button
              onClick={() => setShowOverrides((v) => !v)}
              className="flex items-center gap-1.5 text-sm font-medium w-full text-left"
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              Override limits
              {showOverrides ? <ChevronUp className="w-3 h-3 ml-auto" /> : <ChevronDown className="w-3 h-3 ml-auto" />}
            </button>
            {showOverrides && (
              <div className="mt-3 space-y-2">
                <p className="text-xs text-muted-foreground">Leave blank to keep the plan default.</p>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { label: 'Messages/mo', value: overrideMsgs, set: setOverrideMsgs },
                    { label: 'Projects', value: overrideProjects, set: setOverrideProjects },
                    { label: 'Ingestions/mo', value: overrideIngestions, set: setOverrideIngestions },
                  ].map(({ label, value, set }) => (
                    <div key={label}>
                      <label className="text-[10px] text-muted-foreground block mb-1">{label}</label>
                      <input
                        type="number"
                        min={0}
                        value={value}
                        onChange={(e) => set(e.target.value)}
                        placeholder="default"
                        className="w-full px-2 py-1.5 text-sm border border-border rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                      />
                    </div>
                  ))}
                </div>
                <Button size="sm" variant="outline" disabled={acting} onClick={handleOverrideLimits}>
                  Apply overrides
                </Button>
              </div>
            )}
          </div>

          <Separator />

          {/* Suspend / unsuspend */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">
                {user.suspended ? 'Unsuspend account' : 'Suspend account'}
              </p>
              <p className="text-xs text-muted-foreground">
                {user.suspended
                  ? "Re-enable the user's ability to sign in."
                  : 'Block the user from signing in (Firebase Auth disabled).'}
              </p>
            </div>
            {user.suspended ? (
              <Button
                variant="outline"
                size="sm"
                disabled={acting}
                onClick={handleUnsuspend}
              >
                <ShieldCheck className="w-3.5 h-3.5 mr-1.5" />
                Unsuspend
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                disabled={acting}
                onClick={handleSuspend}
                className="text-destructive border-destructive/40 hover:bg-destructive/10"
              >
                <ShieldAlert className="w-3.5 h-3.5 mr-1.5" />
                Suspend
              </Button>
            )}
          </div>

          <Separator />

          {/* Delete */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-destructive">Delete account</p>
              <p className="text-xs text-muted-foreground">
                Permanently removes Auth record and Firestore profile. Irreversible.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={acting}
              onClick={handleDelete}
              className={cn(
                confirmDelete
                  ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
                  : 'text-destructive border-destructive/40 hover:bg-destructive/10',
              )}
            >
              {confirmDelete ? (
                <>
                  <AlertTriangle className="w-3.5 h-3.5 mr-1.5" />
                  Confirm delete
                </>
              ) : (
                <>
                  <Trash2 className="w-3.5 h-3.5 mr-1.5" />
                  Delete
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Admin overrides (if any) */}
      {Object.keys(user.adminOverrides).length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold">Custom Limit Overrides</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
              {Object.entries(user.adminOverrides).map(([k, v]) => (
                <InfoRow key={k} label={k} value={String(v)} />
              ))}
            </dl>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function TierPill({ tier }: { tier: string }) {
  const styles: Record<string, string> = {
    free: 'bg-muted text-muted-foreground',
    pro: 'bg-primary/10 text-primary',
    agency: 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
  }
  return (
    <span
      className={cn(
        'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold capitalize',
        styles[tier] ?? styles.free,
      )}
    >
      {tier}
    </span>
  )
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium">{value}</dd>
    </div>
  )
}

function UsageStat({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode
  label: string
  value: number | string
}) {
  return (
    <div className="flex flex-col items-center gap-1.5 p-3 rounded-lg bg-muted/50">
      <span className="text-muted-foreground">{icon}</span>
      <p className="text-xl font-bold">{typeof value === 'number' ? value.toLocaleString() : value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  )
}
