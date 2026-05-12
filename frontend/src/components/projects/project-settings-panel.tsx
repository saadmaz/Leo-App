'use client'

import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Loader2, Trash2, AlertTriangle, UserPlus, UserMinus, Crown, Users, Link2, Link2Off } from 'lucide-react'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'
import { useAppStore } from '@/stores/app-store'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import type { ProjectMember } from '@/types'

// ---------------------------------------------------------------------------
// Model options (mirrors project-wizard.tsx)
// ---------------------------------------------------------------------------

const CONTENT_MODELS = [
  { label: 'Claude Sonnet', value: 'claude-sonnet-4-6' },
  { label: 'GPT-4o',        value: 'gpt-4o' },
  { label: 'Gemini Pro',    value: 'gemini-pro' },
]
const IMAGE_MODELS = [
  { label: 'DALL-E 3', value: 'dall-e-3' },
]
const VIDEO_MODELS = [
  { label: 'Gemini Flash', value: 'gemini-flash' },
  { label: 'GPT-4o',       value: 'gpt-4o' },
]
const PROMPT_MODELS = [
  { label: 'Claude Opus', value: 'claude-opus-4-6' },
  { label: 'GPT-4o',      value: 'gpt-4o' },
  { label: 'Llama',       value: 'llama-3-70b' },
]

// ---------------------------------------------------------------------------
// Social link fields
// ---------------------------------------------------------------------------

const SOCIAL_FIELDS: { key: string; label: string; placeholder: string }[] = [
  { key: 'websiteUrl',    label: 'Website',        placeholder: 'https://yourbrand.com' },
  { key: 'instagramUrl',  label: 'Instagram',      placeholder: 'https://instagram.com/yourbrand' },
  { key: 'facebookUrl',   label: 'Facebook',       placeholder: 'https://facebook.com/yourbrand' },
  { key: 'linkedinUrl',   label: 'LinkedIn',       placeholder: 'https://linkedin.com/company/yourbrand' },
  { key: 'tiktokUrl',     label: 'TikTok',         placeholder: 'https://tiktok.com/@yourbrand' },
  { key: 'xUrl',          label: 'X (Twitter)',    placeholder: 'https://x.com/yourbrand' },
  { key: 'youtubeUrl',    label: 'YouTube',        placeholder: 'https://youtube.com/@yourbrand' },
  { key: 'threadsUrl',    label: 'Threads',        placeholder: 'https://threads.net/@yourbrand' },
  { key: 'pinterestUrl',  label: 'Pinterest',      placeholder: 'https://pinterest.com/yourbrand' },
  { key: 'snapchatUrl',   label: 'Snapchat',       placeholder: 'https://snapchat.com/add/yourbrand' },
]

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

export function ProjectSettingsPanel() {
  const router = useRouter()
  const {
    projectSettingsPanelOpen, setProjectSettingsPanelOpen,
    activeProject, upsertProject, removeProject,
  } = useAppStore()

  // Form state
  const [name, setName]               = useState('')
  const [description, setDescription] = useState('')
  const [socialLinks, setSocialLinks] = useState<Record<string, string>>({})
  const [contentModel, setContentModel] = useState('claude-sonnet-4-6')
  const [imageModel,   setImageModel]   = useState('dall-e-3')
  const [videoModel,   setVideoModel]   = useState('gemini-flash')
  const [promptModel,  setPromptModel]  = useState('claude-opus-4-6')

  const [saving, setSaving]           = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleting, setDeleting]       = useState(false)

  // Team members
  const [members, setMembers]         = useState<ProjectMember[]>([])
  const [membersLoading, setMembersLoading] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole]   = useState<'editor' | 'viewer'>('editor')
  const [inviting, setInviting]       = useState(false)
  const [removingUid, setRemovingUid] = useState<string | null>(null)

  // Threads connect state
  const [threadsConnected, setThreadsConnected] = useState(false)
  const [threadsUsername, setThreadsUsername] = useState<string | null>(null)
  const [threadsLoading, setThreadsLoading] = useState(false)
  const [threadsDisconnecting, setThreadsDisconnecting] = useState(false)

  // Sync form from activeProject whenever panel opens
  useEffect(() => {
    if (!projectSettingsPanelOpen || !activeProject) return
    setName(activeProject.name ?? '')
    setDescription(activeProject.description ?? '')
    setSocialLinks({
      websiteUrl:   activeProject.websiteUrl   ?? '',
      instagramUrl: activeProject.instagramUrl ?? '',
      facebookUrl:  activeProject.facebookUrl  ?? '',
      linkedinUrl:  activeProject.linkedinUrl  ?? '',
      tiktokUrl:    activeProject.tiktokUrl    ?? '',
      xUrl:         activeProject.xUrl         ?? '',
      youtubeUrl:   activeProject.youtubeUrl   ?? '',
      threadsUrl:   activeProject.threadsUrl   ?? '',
      pinterestUrl: activeProject.pinterestUrl ?? '',
      snapchatUrl:  activeProject.snapchatUrl  ?? '',
    })
    setContentModel(activeProject.contentModel ?? 'claude-sonnet-4-6')
    setImageModel(activeProject.imageModel     ?? 'dall-e-3')
    setVideoModel(activeProject.videoModel     ?? 'gemini-flash')
    setPromptModel(activeProject.promptModel   ?? 'claude-opus-4-6')
    setShowDeleteConfirm(false)
    setInviteEmail('')
    setInviteRole('editor')

    // Load team members
    setMembersLoading(true)
    api.members.list(activeProject.id)
      .then(setMembers)
      .catch(() => toast.error('Failed to load team members'))
      .finally(() => setMembersLoading(false))

    // Check Threads connection status
    api.threads.status()
      .then((s) => {
        setThreadsConnected(s.connected)
        setThreadsUsername(s.connected ? (s.threads_user_id ?? null) : null)
      })
      .catch(() => { /* non-fatal */ })
  }, [projectSettingsPanelOpen, activeProject])

  async function handleThreadsConnect() {
    setThreadsLoading(true)
    try {
      const { auth_url } = await api.threads.connect()
      window.location.href = auth_url
    } catch {
      toast.error('Could not start Threads connection')
      setThreadsLoading(false)
    }
  }

  async function handleThreadsDisconnect() {
    setThreadsDisconnecting(true)
    try {
      await api.threads.disconnect()
      setThreadsConnected(false)
      setThreadsUsername(null)
      toast.success('Threads account disconnected')
    } catch {
      toast.error('Failed to disconnect Threads')
    } finally {
      setThreadsDisconnecting(false)
    }
  }

  function handleClose() {
    if (saving || deleting) return
    setProjectSettingsPanelOpen(false)
  }

  async function handleSave() {
    if (!activeProject || !name.trim()) return
    setSaving(true)
    try {
      const updated = await api.projects.update(activeProject.id, {
        name: name.trim(),
        description: description.trim() || undefined,
        ...Object.fromEntries(
          Object.entries(socialLinks).map(([k, v]) => [k, v.trim() || null])
        ),
        contentModel,
        imageModel,
        videoModel,
        promptModel,
      })
      upsertProject(updated)
      toast.success('Settings saved')
      setProjectSettingsPanelOpen(false)
    } catch (err) {
      console.error(err)
      toast.error('Failed to save settings')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!activeProject) return
    setDeleting(true)
    try {
      await api.projects.delete(activeProject.id)
      removeProject(activeProject.id)
      toast.success(`"${activeProject.name}" deleted`)
      setProjectSettingsPanelOpen(false)
      router.push('/')
    } catch (err) {
      console.error(err)
      toast.error('Failed to delete project')
    } finally {
      setDeleting(false)
    }
  }

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault()
    if (!activeProject || !inviteEmail.trim()) return
    setInviting(true)
    try {
      const member = await api.members.invite(activeProject.id, inviteEmail.trim(), inviteRole)
      setMembers((prev) => [...prev, member])
      setInviteEmail('')
      toast.success(`${member.displayName || member.email} added to project`)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('404')) toast.error('No LEO account found for that email')
      else if (msg.includes('409')) toast.error('User is already a member')
      else toast.error('Failed to invite member')
    } finally {
      setInviting(false)
    }
  }

  async function handleRemoveMember(uid: string) {
    if (!activeProject) return
    setRemovingUid(uid)
    try {
      await api.members.remove(activeProject.id, uid)
      setMembers((prev) => prev.filter((m) => m.uid !== uid))
      toast.success('Member removed')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('400')) toast.error('Cannot remove the last admin')
      else toast.error('Failed to remove member')
    } finally {
      setRemovingUid(null)
    }
  }

  return (
    <AnimatePresence>
      {projectSettingsPanelOpen && activeProject && (
        <>
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/40 z-40"
            onClick={handleClose}
          />
          <motion.aside
            initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
            transition={{ type: 'spring', stiffness: 320, damping: 32 }}
            className="fixed right-0 top-0 h-full w-full max-w-md bg-card border-l border-border z-50 flex flex-col shadow-2xl"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
              <div>
                <h2 className="font-semibold text-sm">Project Settings</h2>
                <p className="text-xs text-muted-foreground">{activeProject.name}</p>
              </div>
              <button
                onClick={handleClose}
                className="p-1.5 rounded-md hover:bg-muted text-muted-foreground"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-5 space-y-6">

              {/* Brand */}
              <section className="space-y-3">
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Brand</h3>
                <Field label="Brand name *" value={name} onChange={setName} placeholder="Acme Coffee Co." />
                <Field label="Description" value={description} onChange={setDescription} placeholder="What does this brand sell or stand for?" textarea />
              </section>

              {/* Social links */}
              <section className="space-y-3">
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Social Links</h3>
                <div className="space-y-2">
                  {SOCIAL_FIELDS.map((field) => (
                    <Field
                      key={field.key}
                      label={field.label}
                      value={socialLinks[field.key] ?? ''}
                      onChange={(v) => setSocialLinks((prev) => ({ ...prev, [field.key]: v }))}
                      placeholder={field.placeholder}
                      type="url"
                    />
                  ))}
                </div>
              </section>

              {/* AI Models */}
              <section className="space-y-3">
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">AI Models</h3>
                <div className="space-y-2.5">
                  {[
                    { label: 'Content & Chat',    options: CONTENT_MODELS, value: contentModel, set: setContentModel },
                    { label: 'Image Generation',  options: IMAGE_MODELS,   value: imageModel,   set: setImageModel },
                    { label: 'Video Planning',    options: VIDEO_MODELS,   value: videoModel,   set: setVideoModel },
                    { label: 'Campaign AI',       options: PROMPT_MODELS,  value: promptModel,  set: setPromptModel },
                  ].map(({ label, options, value, set }) => (
                    <div key={label} className="flex items-center gap-3">
                      <label className="text-xs text-muted-foreground shrink-0 w-32">{label}</label>
                      <select
                        value={value}
                        onChange={(e) => set(e.target.value)}
                        className="flex-1 rounded-lg border border-input bg-background px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                      >
                        {options.map((opt) => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              </section>

              {/* Connected Accounts */}
              <section className="space-y-3">
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Connected Accounts</h3>
                <div className="rounded-xl border border-border p-4 flex items-center gap-3">
                  {/* Threads logo - simple T icon */}
                  <div className="w-8 h-8 rounded-lg bg-black flex items-center justify-center shrink-0">
                    <span className="text-white text-xs font-bold">T</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium">Threads</p>
                    {threadsConnected && threadsUsername
                      ? <p className="text-[11px] text-muted-foreground">Connected - user {threadsUsername}</p>
                      : <p className="text-[11px] text-muted-foreground">Publish posts directly to Threads</p>
                    }
                  </div>
                  {threadsConnected ? (
                    <button
                      onClick={handleThreadsDisconnect}
                      disabled={threadsDisconnecting}
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-border text-xs text-muted-foreground hover:text-destructive hover:border-destructive/50 disabled:opacity-40 transition-colors"
                    >
                      {threadsDisconnecting
                        ? <Loader2 className="w-3 h-3 animate-spin" />
                        : <Link2Off className="w-3 h-3" />}
                      Disconnect
                    </button>
                  ) : (
                    <button
                      onClick={handleThreadsConnect}
                      disabled={threadsLoading}
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-border text-xs font-medium hover:bg-muted disabled:opacity-40 transition-colors"
                    >
                      {threadsLoading
                        ? <Loader2 className="w-3 h-3 animate-spin" />
                        : <Link2 className="w-3 h-3" />}
                      Connect
                    </button>
                  )}
                </div>
              </section>

              {/* Team */}
              <section className="space-y-3">
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                  <Users className="w-3.5 h-3.5" />
                  Team
                </h3>

                {/* Current members */}
                {membersLoading ? (
                  <div className="space-y-2">
                    {[1, 2].map((i) => <div key={i} className="h-10 rounded-lg bg-muted/40 animate-pulse" />)}
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {members.map((m) => (
                      <div key={m.uid} className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium truncate">{m.displayName || m.email}</p>
                          {m.displayName && <p className="text-[11px] text-muted-foreground truncate">{m.email}</p>}
                        </div>
                        <span className={cn(
                          'shrink-0 text-[10px] px-1.5 py-0.5 rounded-full font-medium',
                          m.role === 'admin'
                            ? 'bg-primary/10 text-primary'
                            : m.role === 'editor'
                            ? 'bg-muted text-muted-foreground'
                            : 'bg-muted text-muted-foreground/60',
                        )}>
                          {m.role === 'admin' && <Crown className="w-2.5 h-2.5 inline mr-0.5" />}
                          {m.role}
                        </span>
                        {m.role !== 'admin' && (
                          <button
                            onClick={() => handleRemoveMember(m.uid)}
                            disabled={removingUid === m.uid}
                            title="Remove member"
                            className="p-1 rounded-md hover:bg-muted text-muted-foreground hover:text-destructive disabled:opacity-40 transition-colors"
                          >
                            {removingUid === m.uid
                              ? <Loader2 className="w-3 h-3 animate-spin" />
                              : <UserMinus className="w-3 h-3" />}
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Invite form */}
                <form onSubmit={handleInvite} className="space-y-2">
                  <label className="block text-xs font-medium text-muted-foreground">Invite by email</label>
                  <div className="flex gap-2">
                    <input
                      type="email"
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                      placeholder="colleague@example.com"
                      className="flex-1 rounded-lg border border-input bg-background px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50"
                    />
                    <select
                      value={inviteRole}
                      onChange={(e) => setInviteRole(e.target.value as 'editor' | 'viewer')}
                      className="rounded-lg border border-input bg-background px-2 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                    >
                      <option value="editor">Editor</option>
                      <option value="viewer">Viewer</option>
                    </select>
                  </div>
                  <button
                    type="submit"
                    disabled={inviting || !inviteEmail.trim()}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs font-medium hover:bg-muted disabled:opacity-40 transition-colors"
                  >
                    {inviting ? <Loader2 className="w-3 h-3 animate-spin" /> : <UserPlus className="w-3 h-3" />}
                    {inviting ? 'Inviting…' : 'Invite'}
                  </button>
                </form>
              </section>

              {/* Danger zone */}
              <section className="space-y-3">
                <h3 className="text-xs font-semibold text-destructive uppercase tracking-wide">Danger Zone</h3>
                <div className="rounded-xl border border-destructive/30 p-4 space-y-3">
                  <p className="text-xs text-muted-foreground">
                    Permanently delete this project, all its chats, messages, and campaigns. This cannot be undone.
                  </p>
                  {!showDeleteConfirm ? (
                    <button
                      onClick={() => setShowDeleteConfirm(true)}
                      className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-destructive/50 text-destructive text-xs hover:bg-destructive/5 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Delete project
                    </button>
                  ) : (
                    <div className="space-y-2">
                      <div className="flex items-start gap-2 text-xs text-destructive">
                        <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                        <span>Are you sure? This will permanently delete &quot;{activeProject.name}&quot; and all its data.</span>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={handleDelete}
                          disabled={deleting}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-destructive text-white text-xs font-medium disabled:opacity-50"
                        >
                          {deleting && <Loader2 className="w-3 h-3 animate-spin" />}
                          Yes, delete
                        </button>
                        <button
                          onClick={() => setShowDeleteConfirm(false)}
                          className="px-3 py-1.5 rounded-lg border border-border text-xs text-muted-foreground hover:text-foreground"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </section>
            </div>

            {/* Footer */}
            <div className="border-t border-border px-5 py-4 flex gap-3 shrink-0">
              <button
                onClick={handleSave}
                disabled={saving || !name.trim()}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium disabled:opacity-40 hover:opacity-90 transition-opacity"
              >
                {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Save changes
              </button>
              <button
                onClick={handleClose}
                className="px-5 py-2.5 rounded-xl border border-border text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                Cancel
              </button>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  )
}

// ---------------------------------------------------------------------------
// Field helper
// ---------------------------------------------------------------------------

function Field({
  label, value, onChange, placeholder, textarea, type = 'text',
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  textarea?: boolean
  type?: string
}) {
  const cls = 'w-full rounded-lg border border-input bg-background px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50'
  return (
    <div>
      <label className="block text-xs font-medium text-muted-foreground mb-1">{label}</label>
      {textarea ? (
        <textarea
          rows={2}
          className={cn(cls, 'resize-none')}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
        />
      ) : (
        <input
          type={type}
          className={cls}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
        />
      )}
    </div>
  )
}
