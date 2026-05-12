'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import {
  Send, Copy, Check, Loader2, RefreshCw, ExternalLink,
  CalendarDays, ChevronDown, ChevronUp,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { api } from '@/lib/api'
import { useAppStore } from '@/stores/app-store'
import { SidebarToggle } from '@/components/layout/sidebar'
import { BackButton } from '@/components/layout/back-button'
import type { PublishQueueDay, PublishQueueEntry } from '@/types'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PLATFORM_COLORS: Record<string, string> = {
  instagram: 'bg-pink-500',
  facebook: 'bg-blue-600',
  tiktok: 'bg-neutral-800',
  linkedin: 'bg-blue-700',
  x: 'bg-neutral-600',
  email: 'bg-violet-500',
}

const PLATFORM_LINKS: Record<string, string> = {
  instagram: 'https://www.instagram.com/create/story',
  facebook: 'https://www.facebook.com',
  tiktok: 'https://www.tiktok.com/upload',
  linkedin: 'https://www.linkedin.com/feed',
  x: 'https://x.com/compose/tweet',
}

const STATUS_STYLES: Record<string, string> = {
  planned:   'bg-muted text-muted-foreground',
  drafted:   'bg-blue-500/10 text-blue-600',
  approved:  'bg-green-500/10 text-green-600',
  scheduled: 'bg-amber-500/10 text-amber-600',
  posted:    'bg-purple-500/10 text-purple-600',
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function PublishPage() {
  const params = useParams<{ projectId: string }>()
  const router = useRouter()
  const { activeProject } = useAppStore()

  const [days, setDays] = useState<PublishQueueDay[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedDays, setExpandedDays] = useState<Set<string>>(new Set(['today']))
  const [markingPosted, setMarkingPosted] = useState<Set<string>>(new Set())

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.publishQueue.get(params.projectId)
      setDays(data.days)
      // Auto-expand days that have entries
      const withEntries = new Set(
        data.days.filter((d) => d.entries.length > 0).map((d) => d.date)
      )
      setExpandedDays(withEntries)
    } catch (err) {
      console.error(err)
      toast.error('Failed to load publish queue')
    } finally {
      setLoading(false)
    }
  }, [params.projectId])

  useEffect(() => { load() }, [load])

  async function markPosted(entry: PublishQueueEntry) {
    setMarkingPosted((prev) => new Set(prev).add(entry.id))
    try {
      await api.calendar.updateEntry(params.projectId, entry.id, { status: 'posted' })
      setDays((prev) =>
        prev.map((day) => ({
          ...day,
          entries: day.entries.map((e) =>
            e.id === entry.id ? { ...e, status: 'posted' } : e
          ),
        }))
      )
      toast.success('Marked as posted!')
    } catch {
      toast.error('Failed to update status')
    } finally {
      setMarkingPosted((prev) => { const s = new Set(prev); s.delete(entry.id); return s })
    }
  }

  function toggleDay(date: string) {
    setExpandedDays((prev) => {
      const s = new Set(prev)
      if (s.has(date)) { s.delete(date) } else { s.add(date) }
      return s
    })
  }

  const totalToday = days[0]?.entries.length ?? 0
  const totalPosted = days[0]?.entries.filter((e) => e.status === 'posted').length ?? 0
  const totalWeek = days.reduce((sum, d) => sum + d.entries.length, 0)

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-3 sm:px-4 py-3 border-b border-border shrink-0">
        <SidebarToggle />
        <BackButton />
        <Send className="w-4 h-4 text-primary" />
        <span className="text-sm font-semibold">Publishing Queue</span>
        {activeProject && (
          <span className="text-xs text-muted-foreground">- {activeProject.name}</span>
        )}
        <div className="ml-auto flex items-center gap-3">
          <span className="text-xs text-muted-foreground">
            {totalWeek} post{totalWeek !== 1 ? 's' : ''} this week
          </span>
          <button
            onClick={load}
            className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {totalWeek === 0 ? (
          <div className="flex flex-col items-center justify-center h-96 gap-4 px-8 text-center">
            <CalendarDays className="w-12 h-12 text-muted-foreground/30" />
            <h2 className="text-lg font-semibold">Nothing scheduled this week</h2>
            <p className="text-sm text-muted-foreground max-w-sm">
              Use the Calendar to schedule posts, or generate a content calendar with AI.
            </p>
            <button
              onClick={() => router.push(`/projects/${params.projectId}/calendar`)}
              className="px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
            >
              Go to Calendar
            </button>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {days.filter((d) => d.entries.length > 0 || d.label === 'Today').map((day) => (
              <DaySection
                key={day.date}
                day={day}
                expanded={expandedDays.has(day.date)}
                onToggle={() => toggleDay(day.date)}
                onMarkPosted={markPosted}
                markingPosted={markingPosted}
              />
            ))}
          </div>
        )}

        {/* Today's progress bar */}
        {totalToday > 0 && (
          <div className="sticky bottom-0 bg-background border-t border-border px-4 py-3">
            <div className="flex items-center justify-between text-xs text-muted-foreground mb-1.5">
              <span>Today&apos;s progress</span>
              <span>{totalPosted}/{totalToday} posted</span>
            </div>
            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: totalToday ? `${(totalPosted / totalToday) * 100}%` : '0%' }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// DaySection
// ---------------------------------------------------------------------------

function DaySection({
  day, expanded, onToggle, onMarkPosted, markingPosted,
}: {
  day: PublishQueueDay
  expanded: boolean
  onToggle: () => void
  onMarkPosted: (e: PublishQueueEntry) => void
  markingPosted: Set<string>
}) {
  const isToday = day.label === 'Today'
  const allPosted = day.entries.length > 0 && day.entries.every((e) => e.status === 'posted')

  return (
    <div>
      <button
        onClick={onToggle}
        className={cn(
          'flex items-center justify-between w-full px-4 py-3 hover:bg-muted/30 transition-colors',
          isToday && 'bg-primary/3',
        )}
      >
        <div className="flex items-center gap-3">
          <span className={cn('text-sm font-semibold', isToday ? 'text-primary' : 'text-foreground')}>
            {day.label}
          </span>
          {day.entries.length > 0 && (
            <span className="text-xs text-muted-foreground">
              {day.entries.length} post{day.entries.length !== 1 ? 's' : ''}
            </span>
          )}
          {allPosted && (
            <span className="text-xs text-green-600 font-medium flex items-center gap-1">
              <Check className="w-3 h-3" /> All posted
            </span>
          )}
        </div>
        {day.entries.length > 0 && (
          expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />
        )}
      </button>

      {expanded && day.entries.length > 0 && (
        <div className="px-4 pb-4 space-y-3">
          {day.entries.map((entry) => (
            <PostCard
              key={entry.id}
              entry={entry}
              onMarkPosted={() => onMarkPosted(entry)}
              marking={markingPosted.has(entry.id)}
            />
          ))}
        </div>
      )}

      {expanded && day.entries.length === 0 && (
        <p className="px-4 pb-3 text-xs text-muted-foreground">No posts scheduled.</p>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// PostCard
// ---------------------------------------------------------------------------

function PostCard({
  entry, onMarkPosted, marking,
}: {
  entry: PublishQueueEntry
  onMarkPosted: () => void
  marking: boolean
}) {
  const [copied, setCopied] = useState(false)
  const [copiedHashtags, setCopiedHashtags] = useState(false)

  const platformKey = entry.platform?.toLowerCase() ?? ''
  const platformLink = PLATFORM_LINKS[platformKey]
  const isPosted = entry.status === 'posted'

  function copyContent() {
    const text = [entry.content, entry.hashtags?.length ? entry.hashtags.map((h) => `#${h.replace(/^#/, '')}`).join(' ') : ''].filter(Boolean).join('\n\n')
    navigator.clipboard.writeText(text)
    setCopied(true)
    toast.success('Copied to clipboard!')
    setTimeout(() => setCopied(false), 2000)
  }

  function copyHashtags() {
    if (!entry.hashtags?.length) return
    navigator.clipboard.writeText(entry.hashtags.map((h) => `#${h.replace(/^#/, '')}`).join(' '))
    setCopiedHashtags(true)
    toast.success('Hashtags copied!')
    setTimeout(() => setCopiedHashtags(false), 2000)
  }

  return (
    <div className={cn(
      'rounded-xl border bg-card overflow-hidden transition-all',
      isPosted ? 'opacity-60 border-border/50' : 'border-border',
    )}>
      {/* Card header */}
      <div className="flex items-center gap-2 px-4 pt-3 pb-2">
        <div className={cn('w-2 h-2 rounded-full shrink-0', PLATFORM_COLORS[platformKey] ?? 'bg-muted-foreground')} />
        <span className="text-xs font-semibold capitalize">{entry.platform}</span>
        {entry.time && <span className="text-xs text-muted-foreground">· {entry.time}</span>}
        {entry.content_format && (
          <span className="text-xs text-muted-foreground capitalize">· {entry.content_format}</span>
        )}
        <span className={cn('ml-auto text-[10px] px-2 py-0.5 rounded-full font-medium capitalize', STATUS_STYLES[entry.status] ?? STATUS_STYLES.planned)}>
          {entry.status}
        </span>
      </div>

      {/* Content */}
      <div className="px-4 pb-3">
        <p className="text-sm text-foreground/90 leading-relaxed whitespace-pre-wrap">{entry.content}</p>
        {entry.hashtags?.length > 0 && (
          <p className="mt-2 text-xs text-primary/70 leading-relaxed">
            {entry.hashtags.slice(0, 15).map((h) => `#${h.replace(/^#/, '')}`).join(' ')}
          </p>
        )}
      </div>

      {/* Actions */}
      {!isPosted && (
        <div className="flex items-center gap-2 px-3 pb-3 pt-1 border-t border-border/50">
          {/* Copy all */}
          <button
            onClick={copyContent}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all',
              copied
                ? 'bg-green-500/10 text-green-600'
                : 'bg-primary text-primary-foreground hover:bg-primary/90',
            )}
          >
            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? 'Copied!' : 'Copy post'}
          </button>

          {/* Copy hashtags only */}
          {entry.hashtags?.length > 0 && (
            <button
              onClick={copyHashtags}
              className={cn(
                'flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs transition-all border',
                copiedHashtags
                  ? 'border-green-500/30 text-green-600 bg-green-500/5'
                  : 'border-border text-muted-foreground hover:text-foreground hover:bg-muted',
              )}
            >
              {copiedHashtags ? <Check className="w-3 h-3" /> : '#'}
              Hashtags
            </button>
          )}

          {/* Open platform */}
          {platformLink && (
            <a
              href={platformLink}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <ExternalLink className="w-3 h-3" />
              Open {entry.platform}
            </a>
          )}

          {/* Mark posted */}
          <button
            onClick={onMarkPosted}
            disabled={marking}
            className="ml-auto flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs text-muted-foreground hover:text-green-600 hover:bg-green-500/5 border border-border transition-colors disabled:opacity-50"
          >
            {marking ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
            Mark posted
          </button>
        </div>
      )}

      {isPosted && (
        <div className="px-4 pb-2 text-xs text-green-600 flex items-center gap-1">
          <Check className="w-3 h-3" /> Posted
        </div>
      )}
    </div>
  )
}
