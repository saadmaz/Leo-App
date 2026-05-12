'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { Users, UserPlus, Trash2, Crown, Edit2, Eye, ChevronDown, Check } from 'lucide-react'
import { toast } from 'sonner'
import { SidebarToggle } from '@/components/layout/sidebar'
import { BackButton } from '@/components/layout/back-button'
import { api } from '@/lib/api'
import { useAppStore } from '@/stores/app-store'
import { cn } from '@/lib/utils'
import type { ProjectMember } from '@/types'

// ---------------------------------------------------------------------------
// Role metadata
// ---------------------------------------------------------------------------

const ROLES = [
  { value: 'admin',  label: 'Admin',  icon: <Crown className="w-3 h-3" />,  desc: 'Full access. Can invite and remove members.' },
  { value: 'editor', label: 'Editor', icon: <Edit2 className="w-3 h-3" />,  desc: 'Can create and edit content.' },
  { value: 'viewer', label: 'Viewer', icon: <Eye className="w-3 h-3" />,    desc: 'Read-only access.' },
] as const

type Role = 'admin' | 'editor' | 'viewer'

const ROLE_STYLES: Record<Role, string> = {
  admin:  'bg-primary/10 text-primary border-primary/20',
  editor: 'bg-blue-500/10 text-blue-600 border-blue-500/20',
  viewer: 'bg-muted text-muted-foreground',
}

function RoleBadge({ role }: { role: Role }) {
  const meta = ROLES.find((r) => r.value === role)
  return (
    <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border', ROLE_STYLES[role])}>
      {meta?.icon}
      {meta?.label}
    </span>
  )
}

function Avatar({ name, email }: { name: string; email: string }) {
  const initials = (name || email || '?')
    .split(' ')
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
  return (
    <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-semibold shrink-0">
      {initials}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Role picker dropdown
// ---------------------------------------------------------------------------

function RolePicker({
  currentRole,
  onChange,
  disabled,
}: {
  currentRole: Role
  onChange: (r: Role) => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)

  return (
    <div className="relative">
      <button
        onClick={() => !disabled && setOpen((v) => !v)}
        disabled={disabled}
        className={cn(
          'flex items-center gap-1.5 px-2 py-1 rounded-md text-xs border border-border transition-colors',
          disabled ? 'opacity-50 cursor-not-allowed' : 'hover:bg-muted',
        )}
      >
        <RoleBadge role={currentRole} />
        {!disabled && <ChevronDown className="w-3 h-3 text-muted-foreground" />}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 z-50 w-52 bg-popover border border-border rounded-lg shadow-lg overflow-hidden">
            {ROLES.map((r) => (
              <button
                key={r.value}
                onClick={() => { onChange(r.value); setOpen(false) }}
                className="flex items-start gap-2 w-full px-3 py-2.5 text-left hover:bg-muted transition-colors"
              >
                <div className="mt-0.5">{r.icon}</div>
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-medium">{r.label}</span>
                    {currentRole === r.value && <Check className="w-3 h-3 text-primary" />}
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{r.desc}</p>
                </div>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function TeamPage() {
  const params = useParams<{ projectId: string }>()
  const { user } = useAppStore()
  const projectId = params.projectId

  const [members, setMembers] = useState<ProjectMember[]>([])
  const [loading, setLoading] = useState(true)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<Role>('editor')
  const [inviting, setInviting] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.members.list(projectId)
      setMembers(data)
    } catch {
      toast.error('Failed to load team members')
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => { load() }, [load])

  const currentUserMember = members.find((m) => m.uid === user?.uid)
  const isAdmin = currentUserMember?.role === 'admin'

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault()
    if (!inviteEmail.trim()) return
    setInviting(true)
    try {
      const newMember = await api.members.invite(projectId, inviteEmail.trim(), inviteRole)
      setMembers((prev) => [...prev, newMember])
      setInviteEmail('')
      toast.success(`${inviteEmail} added as ${inviteRole}`)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to invite member'
      toast.error(msg.includes('404') ? 'No LEO account found for that email' : 'Failed to invite')
    } finally {
      setInviting(false)
    }
  }

  async function handleRoleChange(uid: string, newRole: Role) {
    try {
      const updated = await api.members.updateRole(projectId, uid, newRole)
      setMembers((prev) => prev.map((m) => m.uid === uid ? updated : m))
      toast.success('Role updated')
    } catch {
      toast.error('Failed to update role')
    }
  }

  async function handleRemove(uid: string) {
    try {
      await api.members.remove(projectId, uid)
      setMembers((prev) => prev.filter((m) => m.uid !== uid))
      setConfirmRemove(null)
      toast.success('Member removed')
    } catch {
      toast.error('Failed to remove member')
    }
  }

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <header className="flex items-center gap-2 px-4 py-3 border-b border-border shrink-0">
        <SidebarToggle />
        <BackButton />
        <Users className="w-4 h-4 text-muted-foreground" />
        <span className="text-sm font-semibold">Team</span>
        <span className="ml-1 px-1.5 py-0.5 rounded bg-muted text-xs text-muted-foreground">{members.length}</span>
      </header>

      <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 max-w-2xl mx-auto w-full space-y-6">

        {/* Invite form - admin only */}
        {isAdmin && (
          <div className="bg-card border border-border rounded-lg p-4">
            <div className="flex items-center gap-2 mb-3">
              <UserPlus className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm font-semibold">Invite team member</span>
            </div>
            <p className="text-xs text-muted-foreground mb-3">
              The person must already have a LEO account. They&apos;ll get access immediately.
            </p>
            <form onSubmit={handleInvite} className="flex gap-2 flex-wrap">
              <input
                type="email"
                placeholder="colleague@company.com"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                className="flex-1 min-w-0 px-3 py-2 text-sm border border-border rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                required
              />
              {/* Role picker inline */}
              <div className="flex items-center gap-1 border border-border rounded-md overflow-hidden">
                {ROLES.filter((r) => r.value !== 'admin').map((r) => (
                  <button
                    key={r.value}
                    type="button"
                    onClick={() => setInviteRole(r.value as Role)}
                    className={cn(
                      'px-3 py-2 text-xs transition-colors',
                      inviteRole === r.value
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:bg-muted',
                    )}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
              <button
                type="submit"
                disabled={inviting}
                className="px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
              >
                {inviting ? 'Inviting…' : 'Invite'}
              </button>
            </form>
          </div>
        )}

        {/* Members list */}
        <div className="bg-card border border-border rounded-lg">
          <div className="px-4 py-3 border-b border-border">
            <p className="text-sm font-semibold">Members</p>
          </div>

          {loading ? (
            <div className="p-8 text-center text-sm text-muted-foreground">Loading…</div>
          ) : members.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">No members found</div>
          ) : (
            <div className="divide-y divide-border">
              {members.map((member) => {
                const isCurrentUser = member.uid === user?.uid
                const isLastAdmin = member.role === 'admin' && members.filter((m) => m.role === 'admin').length === 1

                return (
                  <div key={member.uid} className="flex items-center gap-3 px-4 py-3">
                    <Avatar name={member.displayName} email={member.email} />

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-medium truncate">
                          {member.displayName || member.email}
                        </span>
                        {isCurrentUser && (
                          <span className="text-[10px] text-muted-foreground">(you)</span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground truncate">{member.email}</p>
                      {member.joinedAt && (
                        <p className="text-[10px] text-muted-foreground/60 mt-0.5">
                          Joined {new Date(member.joinedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {isAdmin && !isCurrentUser ? (
                        <RolePicker
                          currentRole={member.role}
                          onChange={(r) => handleRoleChange(member.uid, r)}
                          disabled={isLastAdmin && member.role === 'admin'}
                        />
                      ) : (
                        <RoleBadge role={member.role} />
                      )}

                      {isAdmin && !isCurrentUser && (
                        confirmRemove === member.uid ? (
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => handleRemove(member.uid)}
                              className="px-2 py-1 text-[11px] text-destructive border border-destructive/30 rounded hover:bg-destructive/10 transition-colors"
                            >
                              Remove
                            </button>
                            <button
                              onClick={() => setConfirmRemove(null)}
                              className="px-2 py-1 text-[11px] text-muted-foreground border border-border rounded hover:bg-muted transition-colors"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setConfirmRemove(member.uid)}
                            disabled={isLastAdmin}
                            title={isLastAdmin ? 'Cannot remove last admin' : 'Remove member'}
                            className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Role legend */}
        <div className="bg-muted/30 border border-border rounded-lg p-4">
          <p className="text-xs font-semibold text-muted-foreground mb-2">Role permissions</p>
          <div className="space-y-1.5">
            {ROLES.map((r) => (
              <div key={r.value} className="flex items-center gap-2 text-xs text-muted-foreground">
                <RoleBadge role={r.value as Role} />
                <span>{r.desc}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
