'use client'

import { useEffect, useState } from 'react'
import { adminApi, Announcement, ChangelogEntry, BroadcastResult } from '@/lib/admin-api'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { toast } from 'sonner'
import { Megaphone, BookOpen, Mail, Trash2, Plus, Send, CheckCircle2, XCircle, RefreshCw } from 'lucide-react'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const typeColors: Record<string, string> = {
  info: 'bg-blue-500/10 text-blue-600 border-blue-200',
  warning: 'bg-yellow-500/10 text-yellow-700 border-yellow-200',
  success: 'bg-green-500/10 text-green-700 border-green-200',
  error: 'bg-red-500/10 text-red-600 border-red-200',
}

// ---------------------------------------------------------------------------
// Banners tab
// ---------------------------------------------------------------------------

function BannersTab() {
  const [banners, setBanners] = useState<Announcement[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    title: '',
    body: '',
    type: 'info' as Announcement['type'],
    active: true,
    expiresAt: '',
  })

  const load = async () => {
    setLoading(true)
    try {
      setBanners(await adminApi.announcements.list())
    } catch {
      toast.error('Failed to load banners')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const handleCreate = async () => {
    if (!form.title.trim() || !form.body.trim()) {
      toast.error('Title and body are required')
      return
    }
    setSaving(true)
    try {
      const payload = {
        ...form,
        expiresAt: form.expiresAt || null,
      }
      const created = await adminApi.announcements.create(payload)
      setBanners((prev) => [created, ...prev])
      setForm({ title: '', body: '', type: 'info', active: true, expiresAt: '' })
      setShowForm(false)
      toast.success('Banner created')
    } catch {
      toast.error('Failed to create banner')
    } finally {
      setSaving(false)
    }
  }

  const toggleActive = async (banner: Announcement) => {
    try {
      const updated = await adminApi.announcements.update(banner.id, { active: !banner.active })
      setBanners((prev) => prev.map((b) => (b.id === banner.id ? updated : b)))
      toast.success(updated.active ? 'Banner activated' : 'Banner deactivated')
    } catch {
      toast.error('Failed to update banner')
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this banner?')) return
    try {
      await adminApi.announcements.delete(id)
      setBanners((prev) => prev.filter((b) => b.id !== id))
      toast.success('Banner deleted')
    } catch {
      toast.error('Failed to delete banner')
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Banners appear at the top of the app for all users until dismissed or expired.
        </p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={load}>
            <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Refresh
          </Button>
          <Button size="sm" onClick={() => setShowForm((v) => !v)}>
            <Plus className="w-3.5 h-3.5 mr-1.5" /> New Banner
          </Button>
        </div>
      </div>

      {/* Create form */}
      {showForm && (
        <Card className="border-primary/30">
          <CardContent className="pt-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium mb-1 block">Title</label>
                <Input
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder="What's new..."
                />
              </div>
              <div>
                <label className="text-xs font-medium mb-1 block">Type</label>
                <div className="flex gap-1">
                  {(['info', 'warning', 'success', 'error'] as const).map((t) => (
                    <button
                      key={t}
                      onClick={() => setForm({ ...form, type: t })}
                      className={`flex-1 py-1 rounded text-xs font-medium border capitalize transition-all ${
                        form.type === t ? typeColors[t] : 'text-muted-foreground border-border hover:bg-muted'
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div>
              <label className="text-xs font-medium mb-1 block">Body</label>
              <textarea
                value={form.body}
                onChange={(e) => setForm({ ...form, body: e.target.value })}
                placeholder="Banner message..."
                rows={2}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <label className="text-xs font-medium mb-1 block">Expires at (optional)</label>
                <Input
                  type="datetime-local"
                  value={form.expiresAt}
                  onChange={(e) => setForm({ ...form, expiresAt: e.target.value })}
                />
              </div>
              <div className="flex items-center gap-2 pt-5">
                <label className="text-xs font-medium">Active</label>
                <button
                  onClick={() => setForm({ ...form, active: !form.active })}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                    form.active ? 'bg-primary' : 'bg-muted-foreground/30'
                  }`}
                >
                  <span
                    className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${
                      form.active ? 'translate-x-4.5' : 'translate-x-0.5'
                    }`}
                  />
                </button>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setShowForm(false)}>Cancel</Button>
              <Button size="sm" onClick={handleCreate} disabled={saving}>
                {saving ? 'Creating...' : 'Create Banner'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Banner list */}
      {loading ? (
        <div className="text-center py-8 text-muted-foreground text-sm">Loading...</div>
      ) : banners.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground text-sm">No banners yet.</div>
      ) : (
        <div className="space-y-2">
          {banners.map((b) => (
            <div
              key={b.id}
              className="flex items-start gap-3 p-3 rounded-lg border border-border bg-card"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className={`text-xs px-2 py-0.5 rounded-full border font-medium capitalize ${typeColors[b.type]}`}>
                    {b.type}
                  </span>
                  {b.active ? (
                    <span className="flex items-center gap-1 text-xs text-green-600 font-medium">
                      <CheckCircle2 className="w-3 h-3" /> Active
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <XCircle className="w-3 h-3" /> Inactive
                    </span>
                  )}
                  {b.expiresAt && (
                    <span className="text-xs text-muted-foreground">
                      Expires {new Date(b.expiresAt).toLocaleDateString()}
                    </span>
                  )}
                </div>
                <p className="text-sm font-medium">{b.title}</p>
                <p className="text-xs text-muted-foreground mt-0.5 truncate">{b.body}</p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => toggleActive(b)}
                  className="text-xs h-7 px-2"
                >
                  {b.active ? 'Deactivate' : 'Activate'}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleDelete(b.id)}
                  className="text-muted-foreground hover:text-destructive h-7 w-7 p-0"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Broadcast tab
// ---------------------------------------------------------------------------

function BroadcastTab() {
  const [form, setForm] = useState({
    subject: '',
    body: '',
    segment: 'all' as 'all' | 'free' | 'pro' | 'agency',
  })
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<BroadcastResult | null>(null)

  const handleSend = async () => {
    if (!form.subject.trim() || !form.body.trim()) {
      toast.error('Subject and body are required')
      return
    }
    if (!confirm(`Send broadcast to segment "${form.segment}"? This cannot be undone.`)) return
    setSending(true)
    setResult(null)
    try {
      const res = await adminApi.broadcast.send({
        subject: form.subject,
        html_body: form.body,
        segment: form.segment,
      })
      setResult(res)
      toast.success(`Broadcast sent - ${res.sent} delivered`)
    } catch {
      toast.error('Broadcast failed')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="space-y-4 max-w-2xl">
      <p className="text-sm text-muted-foreground">
        Send a one-off email to a user segment via Resend. HTML is supported in the body.
      </p>

      {result && (
        <div className={`p-3 rounded-lg border text-sm ${result.failed === 0 ? 'border-green-200 bg-green-50 text-green-800' : 'border-yellow-200 bg-yellow-50 text-yellow-800'}`}>
          <p className="font-medium">
            Sent: {result.sent} &nbsp;·&nbsp; Failed: {result.failed}
          </p>
          {result.errors.length > 0 && (
            <ul className="mt-2 space-y-0.5 text-xs">
              {result.errors.map((e, i) => (
                <li key={i} className="font-mono">{e}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <Card>
        <CardContent className="pt-4 space-y-3">
          {/* Segment */}
          <div>
            <label className="text-xs font-medium mb-1 block">Segment</label>
            <div className="flex gap-2">
              {(['all', 'free', 'pro', 'agency'] as const).map((seg) => (
                <button
                  key={seg}
                  onClick={() => setForm({ ...form, segment: seg })}
                  className={`flex-1 py-1.5 rounded-md text-xs font-medium border capitalize transition-all ${
                    form.segment === seg
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'text-muted-foreground border-border hover:bg-muted'
                  }`}
                >
                  {seg === 'all' ? 'All users' : seg.charAt(0).toUpperCase() + seg.slice(1)}
                </button>
              ))}
            </div>
          </div>

          {/* Subject */}
          <div>
            <label className="text-xs font-medium mb-1 block">Subject</label>
            <Input
              value={form.subject}
              onChange={(e) => setForm({ ...form, subject: e.target.value })}
              placeholder="Your weekly update from LEO..."
            />
          </div>

          {/* HTML Body */}
          <div>
            <label className="text-xs font-medium mb-1 block">HTML Body</label>
            <textarea
              value={form.body}
              onChange={(e) => setForm({ ...form, body: e.target.value })}
              placeholder="<p>Hello,</p><p>Here's what's new...</p>"
              rows={8}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono resize-y focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>

          <div className="flex justify-end">
            <Button onClick={handleSend} disabled={sending} className="gap-2">
              <Send className="w-3.5 h-3.5" />
              {sending ? 'Sending...' : 'Send Broadcast'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Changelog tab
// ---------------------------------------------------------------------------

function ChangelogTab() {
  const [entries, setEntries] = useState<ChangelogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    version: '',
    title: '',
    body: '',
    tags: '',
    publishedAt: new Date().toISOString().slice(0, 16),
  })

  const load = async () => {
    setLoading(true)
    try {
      setEntries(await adminApi.changelog.list(50))
    } catch {
      toast.error('Failed to load changelog')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const handleCreate = async () => {
    if (!form.version.trim() || !form.title.trim() || !form.body.trim()) {
      toast.error('Version, title, and body are required')
      return
    }
    setSaving(true)
    try {
      const tags = form.tags.split(',').map((t) => t.trim()).filter(Boolean)
      const created = await adminApi.changelog.create({
        version: form.version,
        title: form.title,
        body: form.body,
        tags,
        publishedAt: new Date(form.publishedAt).toISOString(),
      })
      setEntries((prev) => [created, ...prev])
      setForm({ version: '', title: '', body: '', tags: '', publishedAt: new Date().toISOString().slice(0, 16) })
      setShowForm(false)
      toast.success('Changelog entry created')
    } catch {
      toast.error('Failed to create entry')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this changelog entry?')) return
    try {
      await adminApi.changelog.delete(id)
      setEntries((prev) => prev.filter((e) => e.id !== id))
      toast.success('Entry deleted')
    } catch {
      toast.error('Failed to delete entry')
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Changelog entries appear in the &quot;What&apos;s New&quot; feed inside the app.
        </p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={load}>
            <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Refresh
          </Button>
          <Button size="sm" onClick={() => setShowForm((v) => !v)}>
            <Plus className="w-3.5 h-3.5 mr-1.5" /> New Entry
          </Button>
        </div>
      </div>

      {showForm && (
        <Card className="border-primary/30">
          <CardContent className="pt-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium mb-1 block">Version</label>
                <Input
                  value={form.version}
                  onChange={(e) => setForm({ ...form, version: e.target.value })}
                  placeholder="v1.2.0"
                />
              </div>
              <div>
                <label className="text-xs font-medium mb-1 block">Published at</label>
                <Input
                  type="datetime-local"
                  value={form.publishedAt}
                  onChange={(e) => setForm({ ...form, publishedAt: e.target.value })}
                />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium mb-1 block">Title</label>
              <Input
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="New campaign templates + bug fixes"
              />
            </div>
            <div>
              <label className="text-xs font-medium mb-1 block">Body (HTML supported)</label>
              <textarea
                value={form.body}
                onChange={(e) => setForm({ ...form, body: e.target.value })}
                placeholder="<ul><li>Added...</li><li>Fixed...</li></ul>"
                rows={4}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-y focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            <div>
              <label className="text-xs font-medium mb-1 block">Tags (comma-separated)</label>
              <Input
                value={form.tags}
                onChange={(e) => setForm({ ...form, tags: e.target.value })}
                placeholder="feature, fix, improvement"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setShowForm(false)}>Cancel</Button>
              <Button size="sm" onClick={handleCreate} disabled={saving}>
                {saving ? 'Creating...' : 'Create Entry'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {loading ? (
        <div className="text-center py-8 text-muted-foreground text-sm">Loading...</div>
      ) : entries.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground text-sm">No changelog entries yet.</div>
      ) : (
        <div className="space-y-2">
          {entries.map((entry) => (
            <div key={entry.id} className="p-3 rounded-lg border border-border bg-card">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <Badge variant="default" className="text-xs font-mono normal-case tracking-normal">{entry.version}</Badge>
                    {entry.tags.map((tag) => (
                      <span key={tag} className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                        {tag}
                      </span>
                    ))}
                    <span className="text-xs text-muted-foreground ml-auto">
                      {new Date(entry.publishedAt).toLocaleDateString()}
                    </span>
                  </div>
                  <p className="text-sm font-medium">{entry.title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                    {entry.body.replace(/<[^>]+>/g, ' ').trim()}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleDelete(entry.id)}
                  className="text-muted-foreground hover:text-destructive h-7 w-7 p-0 shrink-0"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function CommunicationsPage() {
  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Communications</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Manage in-app banners, email broadcasts, and the What&apos;s New changelog.
        </p>
      </div>

      <Tabs defaultValue="banners">
        <TabsList>
          <TabsTrigger value="banners" className="gap-1.5">
            <Megaphone className="w-3.5 h-3.5" /> Banners
          </TabsTrigger>
          <TabsTrigger value="broadcast" className="gap-1.5">
            <Mail className="w-3.5 h-3.5" /> Email Broadcast
          </TabsTrigger>
          <TabsTrigger value="changelog" className="gap-1.5">
            <BookOpen className="w-3.5 h-3.5" /> Changelog
          </TabsTrigger>
        </TabsList>

        <TabsContent value="banners" className="mt-4">
          <BannersTab />
        </TabsContent>

        <TabsContent value="broadcast" className="mt-4">
          <BroadcastTab />
        </TabsContent>

        <TabsContent value="changelog" className="mt-4">
          <ChangelogTab />
        </TabsContent>
      </Tabs>
    </div>
  )
}
