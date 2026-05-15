'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import {
  LayoutTemplate, Plus, Trash2, Copy, Check, Search,
  Loader2, X, Pencil, Share2, Globe,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { api } from '@/lib/api'
import { useAppStore } from '@/stores/app-store'
import { SidebarToggle } from '@/components/layout/sidebar'
import { BackButton } from '@/components/layout/back-button'
import type { ContentTemplate } from '@/types'

const CATEGORIES = ['all', 'caption', 'email', 'ad_copy', 'blog_post', 'video_script', 'website_copy', 'other']

const CATEGORY_LABELS: Record<string, string> = {
  all: 'All', caption: 'Caption', email: 'Email', ad_copy: 'Ad Copy',
  blog_post: 'Blog Post', video_script: 'Video Script', website_copy: 'Website Copy', other: 'Other',
}

const PLATFORM_OPTIONS = ['', 'Instagram', 'Facebook', 'TikTok', 'LinkedIn', 'X', 'Email', 'Website']

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function TemplatesPage() {
  const params = useParams<{ projectId: string }>()
  const { activeProject } = useAppStore()

  const [templates, setTemplates] = useState<ContentTemplate[]>([])
  const [loading, setLoading]     = useState(true)
  const [search, setSearch]       = useState('')
  const [category, setCategory]   = useState('all')
  const [showCreate, setShowCreate] = useState(false)
  const [editTarget, setEditTarget] = useState<ContentTemplate | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.templates.list(params.projectId, category !== 'all' ? category : undefined)
      setTemplates(data.templates)
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }, [params.projectId, category])

  useEffect(() => { load() }, [load])

  const filtered = templates.filter((t) =>
    !search || t.name.toLowerCase().includes(search.toLowerCase()) ||
    t.description?.toLowerCase().includes(search.toLowerCase()) ||
    t.body.toLowerCase().includes(search.toLowerCase()),
  )

  async function handleDelete(id: string) {
    try {
      await api.templates.delete(params.projectId, id)
      setTemplates((prev) => prev.filter((t) => t.id !== id))
      toast.success('Template deleted')
    } catch { toast.error('Failed to delete') }
  }

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-3 sm:px-4 py-3 border-b border-border shrink-0">
        <SidebarToggle />
        <BackButton />
        <LayoutTemplate className="w-4 h-4 text-primary" />
        <span className="text-sm font-semibold">Content Templates</span>
        {activeProject && <span className="text-xs text-muted-foreground">- {activeProject.name}</span>}
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{filtered.length} templates</span>
          <button
            onClick={() => { setEditTarget(null); setShowCreate(true) }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" /> New Template
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border shrink-0 flex-wrap">
        <div className="relative flex-1 min-w-40 max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <input
            value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search templates…"
            className="w-full pl-8 pr-3 py-1.5 text-xs bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
        <div className="flex gap-1 flex-wrap">
          {CATEGORIES.map((c) => (
            <button key={c} onClick={() => setCategory(c)}
              className={cn(
                'px-2.5 py-1 rounded-md text-xs font-medium transition-colors',
                category === c ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-muted',
              )}>
              {CATEGORY_LABELS[c]}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4">
        {loading ? (
          <div className="flex items-center justify-center h-40">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-60 gap-3 text-center">
            <LayoutTemplate className="w-10 h-10 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">No templates yet.</p>
            <p className="text-xs text-muted-foreground">Create reusable content frameworks with {'{placeholders}'}.</p>
            <button onClick={() => { setEditTarget(null); setShowCreate(true) }}
              className="px-4 py-2 text-xs font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors">
              Create your first template
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {filtered.map((template) => (
              <TemplateCard
                key={template.id}
                template={template}
                projectId={params.projectId}
                onEdit={() => { setEditTarget(template); setShowCreate(true) }}
                onDelete={() => handleDelete(template.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Create / Edit modal */}
      {showCreate && (
        <TemplateModal
          projectId={params.projectId}
          template={editTarget}
          onClose={() => { setShowCreate(false); setEditTarget(null) }}
          onSaved={(t) => {
            setTemplates((prev) => {
              const idx = prev.findIndex((x) => x.id === t.id)
              if (idx >= 0) { const next = [...prev]; next[idx] = t; return next }
              return [t, ...prev]
            })
            setShowCreate(false)
            setEditTarget(null)
          }}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// TemplateCard
// ---------------------------------------------------------------------------

function TemplateCard({ template, onEdit, onDelete, projectId }: {
  template: ContentTemplate
  onEdit: () => void
  onDelete: () => void
  projectId: string
}) {
  const [copied, setCopied] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [shared, setShared] = useState(!!(template as ContentTemplate & { isShared?: boolean }).isShared)
  const [sharing, setSharing] = useState(false)

  function copy() {
    navigator.clipboard.writeText(template.body)
    setCopied(true)
    toast.success('Template copied!')
    setTimeout(() => setCopied(false), 2000)
  }

  async function toggleShare() {
    setSharing(true)
    try {
      await api.templateCommunity.share(projectId, template.id, !shared)
      setShared(!shared)
      toast.success(shared ? 'Removed from community gallery' : 'Shared to community gallery!')
    } catch {
      toast.error('Failed to update sharing')
    } finally {
      setSharing(false)
    }
  }

  return (
    <div className="border border-border rounded-xl bg-card p-4 flex flex-col gap-3 hover:border-primary/30 transition-colors">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold truncate">{template.name}</span>
          </div>
          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground capitalize">
              {CATEGORY_LABELS[template.category] ?? template.category}
            </span>
            {template.platform && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                {template.platform}
              </span>
            )}
          </div>
        </div>
      </div>

      {template.description && (
        <p className="text-xs text-muted-foreground leading-relaxed">{template.description}</p>
      )}

      <div className="bg-muted/40 rounded-lg p-2.5 font-mono text-xs text-foreground/70 line-clamp-4 leading-relaxed whitespace-pre-wrap">
        {template.body}
      </div>

      {template.placeholders?.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {template.placeholders.map((p) => (
            <span key={p} className="text-[10px] px-1.5 py-0.5 rounded border border-primary/30 text-primary bg-primary/5 font-mono">
              {'{' + p + '}'}
            </span>
          ))}
        </div>
      )}

      <div className="flex items-center gap-1.5 mt-auto pt-1 border-t border-border/50">
        <button onClick={copy}
          className={cn(
            'flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors',
            copied ? 'bg-green-500/10 text-green-600' : 'bg-primary text-primary-foreground hover:bg-primary/90',
          )}>
          {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
          {copied ? 'Copied!' : 'Use'}
        </button>
        <button onClick={onEdit}
          className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
          <Pencil className="w-3 h-3" /> Edit
        </button>
        <button
          onClick={toggleShare}
          disabled={sharing}
          title={shared ? 'Remove from community' : 'Share to community gallery'}
          className={cn(
            'flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs border border-border transition-colors',
            shared ? 'text-violet-600 border-violet-200 bg-violet-50' : 'text-muted-foreground hover:text-foreground hover:bg-muted',
          )}
        >
          {sharing ? <Loader2 className="w-3 h-3 animate-spin" /> : shared ? <Globe className="w-3 h-3" /> : <Share2 className="w-3 h-3" />}
          {shared ? 'Shared' : 'Share'}
        </button>
        {confirmDelete ? (
          <div className="ml-auto flex items-center gap-1.5">
            <button onClick={onDelete} className="text-[10px] text-destructive hover:underline">Delete</button>
            <button onClick={() => setConfirmDelete(false)} className="text-[10px] text-muted-foreground">Cancel</button>
          </div>
        ) : (
          <button onClick={() => setConfirmDelete(true)}
            className="ml-auto p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/5 transition-colors">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// TemplateModal - create or edit
// ---------------------------------------------------------------------------

function TemplateModal({ projectId, template, onClose, onSaved }: {
  projectId: string
  template: ContentTemplate | null
  onClose: () => void
  onSaved: (t: ContentTemplate) => void
}) {
  const isEdit = !!template
  const [name, setName]           = useState(template?.name ?? '')
  const [category, setCategory]   = useState(template?.category ?? 'caption')
  const [platform, setPlatform]   = useState(template?.platform ?? '')
  const [description, setDesc]    = useState(template?.description ?? '')
  const [body, setBody]           = useState(template?.body ?? '')
  const [hashtags, setHashtags]   = useState(template?.hashtags?.join(', ') ?? '')
  const [saving, setSaving]       = useState(false)

  // Auto-extract placeholders from body
  const placeholders = Array.from(new Set((body.match(/\{([^}]+)\}/g) ?? []).map((m) => m.slice(1, -1))))

  async function handleSave() {
    if (!name.trim() || !body.trim()) {
      toast.error('Name and body are required.')
      return
    }
    setSaving(true)
    try {
      const payload = {
        name: name.trim(),
        category,
        platform: platform || undefined,
        description: description.trim() || undefined,
        body: body.trim(),
        placeholders,
        hashtags: hashtags.split(',').map((h) => h.trim()).filter(Boolean),
        tags: [],
      }
      let saved: ContentTemplate
      if (isEdit) {
        saved = await api.templates.update(projectId, template!.id, payload)
      } else {
        saved = await api.templates.create(projectId, payload as Omit<ContentTemplate, 'id' | 'createdAt' | 'updatedAt'>)
      }
      toast.success(isEdit ? 'Template updated' : 'Template created')
      onSaved(saved)
    } catch (err) {
      console.error(err)
      toast.error('Failed to save template')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-background border border-border rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <h2 className="text-sm font-semibold">{isEdit ? 'Edit Template' : 'New Template'}</h2>
          <button onClick={onClose} className="p-1.5 rounded-md hover:bg-muted text-muted-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">Name *</label>
              <input value={name} onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Product launch caption"
                className="w-full text-sm bg-background border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary" />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Category</label>
              <select value={category} onChange={(e) => setCategory(e.target.value)}
                className="w-full text-sm bg-background border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary">
                {CATEGORIES.filter((c) => c !== 'all').map((c) => (
                  <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">Platform</label>
              <select value={platform} onChange={(e) => setPlatform(e.target.value)}
                className="w-full text-sm bg-background border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary">
                {PLATFORM_OPTIONS.map((p) => <option key={p} value={p}>{p || 'Any platform'}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Description</label>
              <input value={description} onChange={(e) => setDesc(e.target.value)}
                placeholder="When to use this template"
                className="w-full text-sm bg-background border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium mb-1">
              Template Body * <span className="text-muted-foreground font-normal">- use {'{placeholder}'} for variable fields</span>
            </label>
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={6}
              placeholder={`e.g. 🚀 Introducing {product_name} - the {benefit}.\n\n{value_prop}\n\n{cta}\n\n#brand #launch`}
              className="w-full text-sm bg-background border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary resize-none font-mono" />
          </div>

          {placeholders.length > 0 && (
            <div>
              <p className="text-xs font-medium mb-1.5">Detected placeholders</p>
              <div className="flex flex-wrap gap-1.5">
                {placeholders.map((p) => (
                  <span key={p} className="text-[10px] px-2 py-0.5 rounded border border-primary/30 bg-primary/5 text-primary font-mono">
                    {'{' + p + '}'}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium mb-1">Default Hashtags <span className="text-muted-foreground">(comma-separated)</span></label>
            <input value={hashtags} onChange={(e) => setHashtags(e.target.value)}
              placeholder="brand, product, launch"
              className="w-full text-sm bg-background border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary" />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border shrink-0">
          <button onClick={onClose} className="px-4 py-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors">Cancel</button>
          <button onClick={handleSave} disabled={saving || !name.trim() || !body.trim()}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors">
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {isEdit ? 'Save Changes' : 'Create Template'}
          </button>
        </div>
      </div>
    </div>
  )
}
