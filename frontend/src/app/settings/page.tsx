'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { updateProfile, deleteUser, signOut, EmailAuthProvider, reauthenticateWithCredential } from 'firebase/auth'
import { useTheme } from 'next-themes'
import { toast } from 'sonner'
import { ArrowLeft, Sun, Moon, Monitor, Loader2, Trash2, Zap, ExternalLink, TrendingDown, TrendingUp } from 'lucide-react'
import { Sidebar } from '@/components/layout/sidebar'
import { useAppStore } from '@/stores/app-store'
import { auth } from '@/lib/firebase'
import { api } from '@/lib/api'
import type { CreditsStatus, CreditTransaction } from '@/types'
import { PasswordInput } from '@/components/ui/password-input'
import { cn } from '@/lib/utils'

type ThemeOption = 'light' | 'dark' | 'system'
const THEMES: { value: ThemeOption; label: string; Icon: React.ElementType }[] = [
  { value: 'light',  label: 'Light',  Icon: Sun },
  { value: 'dark',   label: 'Dark',   Icon: Moon },
  { value: 'system', label: 'System', Icon: Monitor },
]

export default function SettingsPage() {
  const router = useRouter()
  const { theme, setTheme } = useTheme()
  const { user, setUser } = useAppStore()

  const [displayName, setDisplayName] = useState(user?.displayName ?? '')
  const [savingName, setSavingName] = useState(false)

  // Credits
  const [credits, setCredits] = useState<CreditsStatus | null>(null)
  const [transactions, setTransactions] = useState<CreditTransaction[] | null>(null)

  useEffect(() => {
    api.credits.getBalance().then(setCredits).catch(() => {/* silently fail */})
    api.credits.getHistory(15).then((r) => setTransactions(r.transactions)).catch(() => {/* silently fail */})
  }, [])

  // Delete account flow
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deletePassword, setDeletePassword] = useState('')
  const [deleting, setDeleting] = useState(false)

  async function handleSaveName() {
    if (!displayName.trim()) return
    const firebaseUser = auth.currentUser
    if (!firebaseUser) return
    setSavingName(true)
    try {
      await updateProfile(firebaseUser, { displayName: displayName.trim() })
      setUser({ ...user!, displayName: displayName.trim() })
      toast.success('Display name updated')
    } catch {
      toast.error('Failed to update display name')
    } finally {
      setSavingName(false)
    }
  }

  async function handleDeleteAccount() {
    const firebaseUser = auth.currentUser
    if (!firebaseUser || !firebaseUser.email) return
    setDeleting(true)
    try {
      // Re-authenticate before deletion (Firebase requires recent sign-in)
      const credential = EmailAuthProvider.credential(firebaseUser.email, deletePassword)
      await reauthenticateWithCredential(firebaseUser, credential)
      await deleteUser(firebaseUser)
      toast.success('Account deleted')
      router.replace('/login')
    } catch (err: unknown) {
      const code = (err as { code?: string }).code
      if (code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
        toast.error('Incorrect password')
      } else {
        toast.error('Failed to delete account - please try again')
      }
    } finally {
      setDeleting(false)
    }
  }

  async function handleSignOut() {
    await signOut(auth)
    router.replace('/login')
  }

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      <Sidebar />

      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-xl px-6 py-10 space-y-10">
          {/* Back */}
          <button
            onClick={() => router.back()}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </button>

          <h1 className="text-2xl font-bold">Settings</h1>

          {/* Profile */}
          <section className="space-y-4">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Profile</h2>
            <div className="rounded-xl border border-border bg-card p-5 space-y-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Display name</label>
                <div className="flex gap-2">
                  <input
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleSaveName() }}
                    placeholder="Your name"
                    className="flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                  <button
                    onClick={handleSaveName}
                    disabled={savingName || !displayName.trim() || displayName === user?.displayName}
                    className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50 flex items-center gap-2"
                  >
                    {savingName && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    Save
                  </button>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-sm font-medium">Email</label>
                <p className="text-sm text-muted-foreground">{user?.email ?? '-'}</p>
              </div>
            </div>
          </section>

          {/* Appearance */}
          <section className="space-y-4">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Appearance</h2>
            <div className="rounded-xl border border-border bg-card p-5">
              <p className="text-sm font-medium mb-3">Theme</p>
              <div className="flex gap-3">
                {THEMES.map(({ value, label, Icon }) => (
                  <button
                    key={value}
                    onClick={() => setTheme(value)}
                    className={cn(
                      'flex-1 flex flex-col items-center gap-2 py-3 rounded-xl border-2 transition-all text-sm',
                      theme === value
                        ? 'border-primary bg-primary/5 text-primary'
                        : 'border-border text-muted-foreground hover:border-primary/40 hover:text-foreground',
                    )}
                  >
                    <Icon className="w-5 h-5" />
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </section>

          {/* Credits & Plan */}
          <section className="space-y-4">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Credits &amp; Plan</h2>
            <div className="rounded-xl border border-border bg-card p-5 space-y-4">
              {credits ? (
                <>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Zap className="w-4 h-4 text-primary" />
                      <span className="text-sm font-medium">Credits balance</span>
                    </div>
                    <span className="text-sm font-bold tabular-nums">
                      {credits.balance.toLocaleString()}
                      <span className="text-muted-foreground font-normal"> / {credits.planAllotment.toLocaleString()}</span>
                    </span>
                  </div>

                  {/* Progress bar */}
                  <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                    <div
                      className={cn(
                        'h-full rounded-full transition-all',
                        credits.balance / credits.planAllotment <= 0.1
                          ? 'bg-red-500'
                          : credits.balance / credits.planAllotment <= 0.3
                          ? 'bg-amber-500'
                          : 'bg-primary',
                      )}
                      style={{ width: `${Math.min(100, (credits.balance / credits.planAllotment) * 100)}%` }}
                    />
                  </div>

                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>
                      Plan: <span className="font-medium capitalize text-foreground">{credits.plan}</span>
                    </span>
                    {credits.resetsAt && (
                      <span>Resets {new Date(credits.resetsAt * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                    )}
                  </div>

                  <a
                    href="/billing"
                    className="flex items-center gap-1.5 text-xs text-primary hover:underline"
                  >
                    <ExternalLink className="w-3 h-3" />
                    Upgrade plan
                  </a>

                  {/* Credit cost reference */}
                  {credits.costs && Object.keys(credits.costs).length > 0 && (
                    <details className="group">
                      <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground list-none flex items-center gap-1">
                        <span className="border-b border-dashed border-muted-foreground/50">View credit costs</span>
                      </summary>
                      <div className="mt-2 rounded-lg border border-border bg-muted/30 divide-y divide-border">
                        {Object.entries(credits.costs).map(([action, cost]) => (
                          <div key={action} className="flex items-center justify-between px-3 py-1.5">
                            <span className="text-xs text-muted-foreground capitalize">{action.replace(/_/g, ' ')}</span>
                            <span className="text-xs font-medium tabular-nums">{cost} cr</span>
                          </div>
                        ))}
                      </div>
                    </details>
                  )}
                </>
              ) : (
                <div className="h-16 rounded-lg bg-muted/40 animate-pulse" />
              )}
            </div>
          </section>

          {/* Credit History */}
          {transactions !== null && transactions.length > 0 && (
            <section className="space-y-4">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Credit History</h2>
              <div className="rounded-xl border border-border bg-card overflow-hidden">
                {transactions.map((tx, i) => (
                  <div
                    key={tx.id}
                    className={cn(
                      'flex items-center gap-3 px-4 py-2.5',
                      i < transactions.length - 1 && 'border-b border-border',
                    )}
                  >
                    <div className={cn(
                      'w-6 h-6 rounded-full flex items-center justify-center shrink-0',
                      tx.type === 'debit' ? 'bg-red-500/10' : 'bg-green-500/10',
                    )}>
                      {tx.type === 'debit'
                        ? <TrendingDown className="w-3 h-3 text-red-500" />
                        : <TrendingUp className="w-3 h-3 text-green-500" />
                      }
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium capitalize truncate">{tx.action.replace(/_/g, ' ')}</p>
                      <p className="text-[10px] text-muted-foreground">
                        {new Date(tx.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                    <span className={cn(
                      'text-xs font-bold tabular-nums shrink-0',
                      tx.type === 'debit' ? 'text-red-500' : 'text-green-500',
                    )}>
                      {tx.type === 'debit' ? '−' : '+'}{tx.amount}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Account */}
          <section className="space-y-4">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Account</h2>
            <div className="rounded-xl border border-border bg-card p-5 space-y-3">
              <button
                onClick={handleSignOut}
                className="w-full py-2 rounded-lg border border-border text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                Sign out
              </button>
            </div>
          </section>

          {/* Danger zone */}
          <section className="space-y-4">
            <h2 className="text-sm font-semibold text-destructive uppercase tracking-wide">Danger zone</h2>
            <div className="rounded-xl border border-destructive/30 bg-card p-5 space-y-4">
              <div>
                <p className="text-sm font-medium">Delete account</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Permanently removes your account and all data. This cannot be undone.
                </p>
              </div>

              {!showDeleteConfirm ? (
                <button
                  onClick={() => setShowDeleteConfirm(true)}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg border border-destructive/50 text-destructive text-sm hover:bg-destructive/5 transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                  Delete my account
                </button>
              ) : (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">Enter your password to confirm:</p>
                  <PasswordInput
                    value={deletePassword}
                    onChange={(e) => setDeletePassword(e.target.value)}
                    placeholder="Password"
                    className="focus:ring-destructive"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={handleDeleteAccount}
                      disabled={deleting || !deletePassword}
                      className="flex items-center gap-2 px-4 py-2 rounded-lg bg-destructive text-white text-sm font-medium disabled:opacity-50"
                    >
                      {deleting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                      Confirm delete
                    </button>
                    <button
                      onClick={() => { setShowDeleteConfirm(false); setDeletePassword('') }}
                      className="px-4 py-2 rounded-lg border border-border text-sm text-muted-foreground hover:text-foreground"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          </section>
        </div>
      </main>
    </div>
  )
}
