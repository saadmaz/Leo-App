'use client'

import { useEffect, useState } from 'react'
import { Sparkles, X, Tag } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ScrollArea } from '@/components/ui/scroll-area'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ChangelogEntry {
  id: string
  version: string
  title: string
  body: string
  tags: string[]
  publishedAt: string
}

// ---------------------------------------------------------------------------
// Seen tracking (localStorage)
// ---------------------------------------------------------------------------

const SEEN_KEY = 'leo_changelog_seen'

function getLastSeen(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem(SEEN_KEY)
}

function markSeen(latestId: string) {
  localStorage.setItem(SEEN_KEY, latestId)
}

// ---------------------------------------------------------------------------
// Changelog Modal
// ---------------------------------------------------------------------------

interface ChangelogModalProps {
  open: boolean
  onClose: () => void
}

export function ChangelogModal({ open, onClose }: ChangelogModalProps) {
  const [entries, setEntries] = useState<ChangelogEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!open) return
    setLoading(true)
    fetch('/api/backend/changelog?limit=20')
      .then((r) => (r.ok ? r.json() : []))
      .then((data: ChangelogEntry[]) => {
        setEntries(data)
        if (data.length > 0) markSeen(data[0].id)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [open])

  if (!open) return null

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 bg-black/40"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="fixed right-4 bottom-4 z-50 w-[360px] max-h-[520px] rounded-xl border border-border bg-card shadow-xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" />
            <span className="font-semibold text-sm">What&apos;s New</span>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <ScrollArea className="flex-1">
          {loading ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">Loading...</div>
          ) : entries.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">No updates yet.</div>
          ) : (
            <div className="px-4 py-3 space-y-5">
              {entries.map((entry, idx) => (
                <div key={entry.id} className={cn('pb-5', idx < entries.length - 1 && 'border-b border-border')}>
                  {/* Version + date */}
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-primary/10 text-primary font-semibold">
                      {entry.version}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {new Date(entry.publishedAt).toLocaleDateString(undefined, {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })}
                    </span>
                  </div>

                  {/* Title */}
                  <p className="text-sm font-semibold mb-1">{entry.title}</p>

                  {/* Body - render HTML safely as text, or use dangerouslySetInnerHTML for rich content */}
                  <div
                    className="text-xs text-muted-foreground leading-relaxed prose prose-sm dark:prose-invert max-w-none"
                    dangerouslySetInnerHTML={{ __html: entry.body }}
                  />

                  {/* Tags */}
                  {entry.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {entry.tags.map((tag) => (
                        <span
                          key={tag}
                          className="flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground capitalize"
                        >
                          <Tag className="w-2.5 h-2.5" />
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// Hook: returns true if there are unseen updates
// ---------------------------------------------------------------------------

export function useHasUnseenChangelog(): boolean {
  const [hasUnseen, setHasUnseen] = useState(false)

  useEffect(() => {
    fetch('/api/backend/changelog?limit=1')
      .then((r) => (r.ok ? r.json() : []))
      .then((data: ChangelogEntry[]) => {
        if (data.length === 0) return
        const lastSeen = getLastSeen()
        setHasUnseen(lastSeen !== data[0].id)
      })
      .catch(() => {})
  }, [])

  return hasUnseen
}
