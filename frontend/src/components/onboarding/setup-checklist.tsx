'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, Circle, X, ChevronDown, ChevronUp, Sparkles } from 'lucide-react'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/stores/app-store'
import type { Project } from '@/types'

// ---------------------------------------------------------------------------
// Checklist items
// ---------------------------------------------------------------------------

interface CheckItem {
  id: string
  label: string
  description: string
  done: boolean
  action?: { label: string; path: string }
}

const STORAGE_KEY = (projectId: string) => `leo_checklist_dismissed_${projectId}`
const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SetupChecklist({ project }: { project: Project }) {
  const router = useRouter()
  const projectId = project.id
  const { checklistCache, setChecklistCache } = useAppStore()

  const [items, setItems] = useState<CheckItem[]>([])
  const [loading, setLoading] = useState(true)
  const [collapsed, setCollapsed] = useState(false)
  const [dismissed, setDismissed] = useState(() => {
    if (typeof window === 'undefined') return false
    return localStorage.getItem(STORAGE_KEY(projectId)) === 'true'
  })

  function buildItems(
    hasContent: boolean,
    hasCalendar: boolean,
    hasTeam: boolean,
  ): CheckItem[] {
    return [
      {
        id: 'brand_core',
        label: 'Extract Brand Core',
        description: 'Let LEO analyse your brand to build its intelligence layer.',
        done: !!project.brandCore,
        action: project.brandCore ? undefined : { label: 'Set up now', path: `/projects/${projectId}/chats` },
      },
      {
        id: 'first_content',
        label: 'Create your first content',
        description: 'Generate a caption, script, or campaign in chat.',
        done: hasContent,
        action: hasContent ? undefined : { label: 'Open chat', path: `/projects/${projectId}/chats` },
      },
      {
        id: 'calendar',
        label: 'Schedule content to calendar',
        description: 'Plan your posting schedule to stay consistent.',
        done: hasCalendar,
        action: hasCalendar ? undefined : { label: 'View calendar', path: `/projects/${projectId}/calendar` },
      },
      {
        id: 'team',
        label: 'Invite a team member',
        description: 'Collaborate with editors, designers, or clients.',
        done: hasTeam,
        action: hasTeam ? undefined : { label: 'Invite', path: `/projects/${projectId}/team` },
      },
    ]
  }

  const fetchAndBuild = useCallback(async () => {
    try {
      const [libraryData, calendarData, membersData] = await Promise.all([
        api.contentLibrary.list(projectId, {}).catch(() => ({ items: [] })),
        api.calendar.get(projectId).catch(() => ({ entries: [] })),
        api.members.list(projectId).catch(() => []),
      ])
      const hasContent  = (libraryData?.items?.length ?? 0) > 0
      const hasCalendar = (calendarData?.entries?.length ?? 0) > 0
      const hasTeam     = (membersData?.length ?? 0) > 1
      const built = buildItems(hasContent, hasCalendar, hasTeam)
      setItems(built)
      setChecklistCache(projectId, built)
      return built
    } catch {
      return null
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, project.brandCore])

  useEffect(() => {
    if (dismissed) return

    const cached = checklistCache[projectId]
    const isFresh = cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS

    if (isFresh) {
      // Render immediately from cache, refresh silently in background
      setItems(cached.items as CheckItem[])
      setLoading(false)
      fetchAndBuild() // silent background refresh
    } else {
      // No cache or stale - fetch with loading state
      setLoading(true)
      fetchAndBuild().finally(() => setLoading(false))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  const doneCount = items.filter((i) => i.done).length
  const allDone = items.length > 0 && doneCount === items.length

  function dismiss() {
    localStorage.setItem(STORAGE_KEY(projectId), 'true')
    setDismissed(true)
  }

  // Auto-dismiss once everything is done (after a short delay)
  useEffect(() => {
    if (allDone && !dismissed) {
      const t = setTimeout(() => {
        localStorage.setItem(STORAGE_KEY(projectId), 'true')
        setDismissed(true)
      }, 5000)
      return () => clearTimeout(t)
    }
  }, [allDone, dismissed, projectId])

  if (dismissed || loading) return null

  const pct = items.length > 0 ? Math.round((doneCount / items.length) * 100) : 0

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden mb-4">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
        <Sparkles className="w-4 h-4 text-primary shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">
              {allDone ? 'Setup complete!' : 'Getting started'}
            </span>
            <span className="text-xs text-muted-foreground">
              {doneCount}/{items.length}
            </span>
          </div>
          {/* Progress bar */}
          <div className="mt-1 h-1 rounded-full bg-muted overflow-hidden w-full max-w-48">
            <div
              className={cn(
                'h-full rounded-full transition-all duration-500',
                allDone ? 'bg-green-500' : 'bg-primary',
              )}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => setCollapsed((v) => !v)}
            className="p-1 rounded hover:bg-muted transition-colors text-muted-foreground"
          >
            {collapsed ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
          </button>
          <button
            onClick={dismiss}
            className="p-1 rounded hover:bg-muted transition-colors text-muted-foreground"
            title="Dismiss"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Items */}
      {!collapsed && (
        <div className="divide-y divide-border/50">
          {items.map((item) => (
            <div
              key={item.id}
              className={cn(
                'flex items-start gap-3 px-4 py-3 transition-colors',
                item.done ? 'opacity-60' : '',
              )}
            >
              <div className="mt-0.5 shrink-0">
                {item.done ? (
                  <CheckCircle2 className="w-4 h-4 text-green-500" />
                ) : (
                  <Circle className="w-4 h-4 text-muted-foreground/40" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className={cn('text-sm font-medium', item.done && 'line-through text-muted-foreground')}>
                  {item.label}
                </p>
                {!item.done && (
                  <p className="text-xs text-muted-foreground mt-0.5">{item.description}</p>
                )}
              </div>
              {item.action && !item.done && (
                <button
                  onClick={() => router.push(item.action!.path)}
                  className="shrink-0 text-xs text-primary hover:underline underline-offset-2 transition-colors"
                >
                  {item.action.label} →
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {allDone && !collapsed && (
        <div className="px-4 py-3 bg-green-500/5 text-xs text-green-600 text-center font-medium">
          You&apos;re all set! This checklist will disappear shortly.
        </div>
      )}
    </div>
  )
}
