'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Bell, X, BarChart2, FileText, Upload, Clock, CheckCircle2, AlertCircle, Info, Users } from 'lucide-react'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import type { ActivityEvent } from '@/types'

// ---------------------------------------------------------------------------
// Event display metadata
// ---------------------------------------------------------------------------

const EVENT_META: Record<string, { icon: React.ReactNode; color: string }> = {
  metrics_logged:    { icon: <BarChart2 className="w-3 h-3" />,    color: 'text-primary' },
  content_created:   { icon: <FileText className="w-3 h-3" />,     color: 'text-blue-500' },
  content_posted:    { icon: <Upload className="w-3 h-3" />,        color: 'text-purple-500' },
  review_submitted:  { icon: <Clock className="w-3 h-3" />,         color: 'text-amber-500' },
  review_approved:   { icon: <CheckCircle2 className="w-3 h-3" />, color: 'text-green-500' },
  review_rejected:   { icon: <AlertCircle className="w-3 h-3" />,  color: 'text-red-500' },
  changes_requested: { icon: <AlertCircle className="w-3 h-3" />,  color: 'text-orange-500' },
  member_added:      { icon: <Users className="w-3 h-3" />,         color: 'text-teal-500' },
  default:           { icon: <Info className="w-3 h-3" />,          color: 'text-muted-foreground' },
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

const STORAGE_KEY = (projectId: string) => `leo_notif_seen_${projectId}`

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function NotificationBell({ projectId }: { projectId: string }) {
  const [events, setEvents] = useState<ActivityEvent[]>([])
  const [open, setOpen] = useState(false)
  const [lastSeen, setLastSeen] = useState<number>(() => {
    if (typeof window === 'undefined') return Date.now()
    return parseInt(localStorage.getItem(STORAGE_KEY(projectId)) ?? '0', 10)
  })
  const panelRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    try {
      const data = await api.analytics.getActivity(projectId)
      setEvents(data)
    } catch {
      // silently fail - notification bell is non-critical
    }
  }, [projectId])

  useEffect(() => { load() }, [load])

  // Poll every 60 seconds while open
  useEffect(() => {
    if (!open) return
    const id = setInterval(load, 60000)
    return () => clearInterval(id)
  }, [open, load])

  // Close on outside click
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  const unread = events.filter((e) => new Date(e.timestamp).getTime() > lastSeen).length

  function markAllRead() {
    const now = Date.now()
    setLastSeen(now)
    localStorage.setItem(STORAGE_KEY(projectId), String(now))
  }

  function toggleOpen() {
    setOpen((v) => {
      if (!v) {
        // Mark as read when opening
        markAllRead()
        load()
      }
      return !v
    })
  }

  return (
    <div className="relative" ref={panelRef}>
      <button
        onClick={toggleOpen}
        className="relative p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        title="Notifications"
      >
        <Bell className="w-3.5 h-3.5" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-3.5 flex items-center justify-center rounded-full bg-primary text-primary-foreground text-[9px] font-bold px-0.5">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute left-0 bottom-full mb-2 w-72 bg-popover border border-border rounded-lg shadow-xl z-50 overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2.5 border-b border-border">
            <span className="text-xs font-semibold">Notifications</span>
            <button
              onClick={() => setOpen(false)}
              className="p-0.5 rounded hover:bg-muted transition-colors text-muted-foreground"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="overflow-y-auto max-h-72">
            {events.length === 0 ? (
              <div className="py-8 text-center text-xs text-muted-foreground">
                No activity yet
              </div>
            ) : events.map((evt) => {
              const meta = EVENT_META[evt.event_type] ?? EVENT_META.default
              const isNew = new Date(evt.timestamp).getTime() > lastSeen
              return (
                <div
                  key={evt.id}
                  className={cn(
                    'flex items-start gap-2.5 px-3 py-2.5 border-b border-border/50 hover:bg-muted/30 transition-colors',
                    isNew && 'bg-primary/5',
                  )}
                >
                  <div className={cn('mt-0.5 shrink-0', meta.color)}>{meta.icon}</div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] text-foreground leading-snug">{evt.description}</p>
                    <p className="text-[10px] text-muted-foreground/60 mt-0.5">{relativeTime(evt.timestamp)}</p>
                  </div>
                  {isNew && (
                    <div className="w-1.5 h-1.5 rounded-full bg-primary shrink-0 mt-1.5" />
                  )}
                </div>
              )
            })}
          </div>

          {events.length > 0 && (
            <div className="px-3 py-2 border-t border-border">
              <button
                onClick={markAllRead}
                className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
              >
                Mark all as read
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
