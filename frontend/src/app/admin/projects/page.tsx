'use client'

import { useEffect, useState, useCallback } from 'react'
import { adminApi, AdminProject } from '@/lib/admin-api'
import { Skeleton } from '@/components/ui/skeleton'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Search, RefreshCw, Trash2, Globe, CheckCircle2, Clock, AlertCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

export default function AdminProjectsPage() {
  const [projects, setProjects] = useState<AdminProject[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')
  const [deleting, setDeleting] = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    setError('')
    adminApi.projects
      .list({ search: search || undefined })
      .then(setProjects)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [search])

  useEffect(() => {
    const t = setTimeout(load, 400)
    return () => clearTimeout(t)
  }, [search, load])

  async function handleDelete(id: string) {
    if (confirmId !== id) { setConfirmId(id); return }
    setDeleting(id)
    setConfirmId(null)
    try {
      await adminApi.projects.delete(id)
      setProjects((prev) => prev.filter((p) => p.id !== id))
      toast.success('Project deleted')
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setDeleting(null)
    }
  }

  return (
    <div className="p-8 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Projects</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {loading ? 'Loading…' : `${projects.length} project${projects.length !== 1 ? 's' : ''}`}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={cn('w-3.5 h-3.5 mr-1.5', loading && 'animate-spin')} />
          Refresh
        </Button>
      </div>

      {/* Search */}
      <div className="relative max-w-sm mb-6">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Search by project name…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive mb-4">
          {error}
        </div>
      )}

      {/* Table */}
      <div className="rounded-xl border border-border overflow-hidden">
        <div className="grid grid-cols-[1fr_160px_100px_110px_80px] gap-4 px-4 py-2.5 bg-muted/50 border-b border-border text-xs font-medium text-muted-foreground uppercase tracking-wide">
          <span>Project</span>
          <span>Owner</span>
          <span>Members</span>
          <span>Created</span>
          <span />
        </div>

        {loading ? (
          <div className="divide-y divide-border">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="px-4 py-3 grid grid-cols-[1fr_160px_100px_110px_80px] gap-4 items-center">
                <div className="space-y-1.5">
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="h-3 w-32" />
                </div>
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-4 w-8" />
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-7 w-16 ml-auto" />
              </div>
            ))}
          </div>
        ) : projects.length === 0 ? (
          <div className="px-4 py-12 text-center text-sm text-muted-foreground">
            No projects found.
          </div>
        ) : (
          <div className="divide-y divide-border">
            {projects.map((project) => (
              <ProjectRow
                key={project.id}
                project={project}
                isConfirming={confirmId === project.id}
                isDeleting={deleting === project.id}
                onDelete={() => handleDelete(project.id)}
                onCancelConfirm={() => setConfirmId(null)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function ProjectRow({
  project,
  isConfirming,
  isDeleting,
  onDelete,
  onCancelConfirm,
}: {
  project: AdminProject
  isConfirming: boolean
  isDeleting: boolean
  onDelete: () => void
  onCancelConfirm: () => void
}) {
  const created = project.createdAt
    ? new Date(project.createdAt).toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric',
      })
    : '-'

  return (
    <div className="grid grid-cols-[1fr_160px_100px_110px_80px] gap-4 px-4 py-3 items-center hover:bg-muted/30 transition-colors">
      {/* Name + status */}
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium truncate">{project.name}</p>
          <IngestionBadge status={project.ingestionStatus} hasBrandCore={project.hasBrandCore} />
        </div>
        {project.websiteUrl && (
          <a
            href={project.websiteUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors mt-0.5"
            onClick={(e) => e.stopPropagation()}
          >
            <Globe className="w-3 h-3" />
            {project.websiteUrl.replace(/^https?:\/\//, '')}
          </a>
        )}
      </div>

      {/* Owner UID truncated */}
      <span className="text-xs font-mono text-muted-foreground truncate" title={project.ownerId}>
        {project.ownerId.slice(0, 12)}…
      </span>

      {/* Members */}
      <span className="text-sm text-muted-foreground">{project.memberCount}</span>

      {/* Created */}
      <span className="text-sm text-muted-foreground">{created}</span>

      {/* Delete */}
      <div className="flex items-center gap-1 justify-end">
        {isConfirming ? (
          <>
            <Button
              size="sm"
              disabled={isDeleting}
              onClick={onDelete}
              className="h-7 px-2 text-xs bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Confirm
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={onCancelConfirm}
              className="h-7 px-2 text-xs"
            >
              Cancel
            </Button>
          </>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            disabled={isDeleting}
            onClick={onDelete}
            className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        )}
      </div>
    </div>
  )
}

function IngestionBadge({
  status,
  hasBrandCore,
}: {
  status: string | null
  hasBrandCore: boolean
}) {
  if (hasBrandCore) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
        <CheckCircle2 className="w-3 h-3" />
        Brand Core
      </span>
    )
  }
  if (status === 'in_progress' || status === 'pending') {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
        <Clock className="w-3 h-3" />
        Ingesting
      </span>
    )
  }
  if (status === 'error') {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-destructive">
        <AlertCircle className="w-3 h-3" />
        Error
      </span>
    )
  }
  return null
}
