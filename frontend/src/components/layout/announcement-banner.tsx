'use client'

import { useEffect, useState } from 'react'
import { X, Info, AlertTriangle, CheckCircle, AlertCircle } from 'lucide-react'
import { cn } from '@/lib/utils'

// ---------------------------------------------------------------------------
// Types (mirrors backend Announcement shape from /announcements/active)
// ---------------------------------------------------------------------------

interface Announcement {
  id: string
  title: string
  body: string
  type: 'info' | 'warning' | 'success' | 'error'
}

// ---------------------------------------------------------------------------
// Styling per type
// ---------------------------------------------------------------------------

const STYLES = {
  info: {
    bar: 'bg-blue-50 border-blue-200 text-blue-900 dark:bg-blue-950 dark:border-blue-800 dark:text-blue-100',
    icon: <Info className="w-4 h-4 text-blue-500 shrink-0" />,
  },
  warning: {
    bar: 'bg-amber-50 border-amber-200 text-amber-900 dark:bg-amber-950 dark:border-amber-800 dark:text-amber-100',
    icon: <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />,
  },
  success: {
    bar: 'bg-green-50 border-green-200 text-green-900 dark:bg-green-950 dark:border-green-800 dark:text-green-100',
    icon: <CheckCircle className="w-4 h-4 text-green-500 shrink-0" />,
  },
  error: {
    bar: 'bg-red-50 border-red-200 text-red-900 dark:bg-red-950 dark:border-red-800 dark:text-red-100',
    icon: <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />,
  },
}

const DISMISSED_KEY = 'leo_dismissed_banners'

function getDismissed(): string[] {
  if (typeof window === 'undefined') return []
  try {
    return JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? '[]')
  } catch {
    return []
  }
}

function saveDismissed(ids: string[]) {
  localStorage.setItem(DISMISSED_KEY, JSON.stringify(ids))
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AnnouncementBanner() {
  const [banners, setBanners] = useState<Announcement[]>([])

  useEffect(() => {
    fetch('/api/backend/announcements/active')
      .then((r) => (r.ok ? r.json() : []))
      .then((data: Announcement[]) => {
        const dismissed = getDismissed()
        setBanners(data.filter((b) => !dismissed.includes(b.id)))
      })
      .catch(() => {/* silently ignore - banners are non-critical */})
  }, [])

  const dismiss = (id: string) => {
    const dismissed = getDismissed()
    saveDismissed([...dismissed, id])
    setBanners((prev) => prev.filter((b) => b.id !== id))
  }

  if (banners.length === 0) return null

  return (
    <div className="flex flex-col gap-0">
      {banners.map((banner) => {
        const s = STYLES[banner.type] ?? STYLES.info
        return (
          <div
            key={banner.id}
            className={cn(
              'flex items-start gap-2.5 px-4 py-2.5 border-b text-sm',
              s.bar,
            )}
          >
            {s.icon}
            <div className="flex-1 min-w-0">
              <span className="font-semibold">{banner.title}</span>
              {banner.body && (
                <span className="ml-1.5 opacity-80">{banner.body}</span>
              )}
            </div>
            <button
              onClick={() => dismiss(banner.id)}
              className="shrink-0 p-0.5 rounded hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
              aria-label="Dismiss"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )
      })}
    </div>
  )
}
