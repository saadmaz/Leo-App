'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import {
  Bell, RefreshCw, Loader2, Globe, CheckCheck,
  TrendingUp, TrendingDown, Minus, ExternalLink, Filter,
} from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { SidebarToggle } from '@/components/layout/sidebar'
import { BackButton } from '@/components/layout/back-button'
import type { MonitorAlert } from '@/types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function SentimentIcon({ sentiment }: { sentiment: MonitorAlert['sentiment'] }) {
  if (sentiment === 'positive') return <TrendingUp className="w-3.5 h-3.5 text-emerald-500" />
  if (sentiment === 'negative') return <TrendingDown className="w-3.5 h-3.5 text-rose-500" />
  return <Minus className="w-3.5 h-3.5 text-muted-foreground" />
}

function sentimentLabel(s: MonitorAlert['sentiment']) {
  return s === 'positive' ? 'Positive' : s === 'negative' ? 'Negative' : 'Neutral'
}

function sentimentClass(s: MonitorAlert['sentiment']) {
  return s === 'positive'
    ? 'bg-emerald-500/10 text-emerald-600'
    : s === 'negative'
    ? 'bg-rose-500/10 text-rose-600'
    : 'bg-muted text-muted-foreground'
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const h = Math.floor(diff / 3_600_000)
  if (h < 1) return 'Just now'
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function MonitoringPage() {
  const params = useParams<{ projectId: string }>()
  const router = useRouter()
  const [alerts, setAlerts] = useState<MonitorAlert[]>([])
  const [loading, setLoading] = useState(true)
  const [scanning, setScanning] = useState(false)
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [days, setDays] = useState(7)

  const loadAlerts = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.monitoring.alerts(params.projectId, { unread_only: unreadOnly, days })
      setAlerts(data.alerts)
    } catch (err) {
      console.error(err)
      toast.error('Failed to load alerts')
    } finally {
      setLoading(false)
    }
  }, [params.projectId, unreadOnly, days])

  useEffect(() => { loadAlerts() }, [loadAlerts])

  async function handleScan() {
    setScanning(true)
    let newAlerts = 0
    try {
      await new Promise<void>((resolve, reject) => {
        api.monitoring.run(
          params.projectId,
          (event) => {
            if (event.type === 'done') newAlerts = event.new_alerts ?? 0
            if (event.type === 'error') toast.error(event.message ?? 'Monitoring scan failed.')
          },
          resolve,
        ).catch(reject)
      })
      toast.success(`Scan complete - ${newAlerts} new alert(s) found.`)
      await loadAlerts()
    } catch (err) {
      console.error(err)
      const msg = err instanceof Error ? err.message : String(err)
      toast.error(
        msg.includes('401') || msg.includes('403') ? 'Authentication error - please refresh and try again.' :
        msg.includes('400') ? 'Project setup incomplete. Add your brand name in project settings.' :
        msg.includes('429') ? 'Too many requests - wait a minute and try again.' :
        msg.includes('EXA_API_KEY') || msg.includes('TAVILY_API_KEY') ? 'Search API keys not configured. Check EXA_API_KEY and TAVILY_API_KEY in your backend .env.' :
        `Monitoring scan failed: ${msg}`
      )
    } finally {
      setScanning(false)
    }
  }

  async function markRead(alert: MonitorAlert) {
    if (alert.read) return
    try {
      await api.monitoring.markRead(params.projectId, alert.id)
      setAlerts((prev) => prev.map((a) => a.id === alert.id ? { ...a, read: true } : a))
    } catch {
      // non-critical
    }
  }

  const unreadCount = alerts.filter((a) => !a.read).length

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Top bar */}
      <div className="flex items-center gap-3 px-3 sm:px-4 py-3 border-b border-border shrink-0">
        <SidebarToggle />
        <BackButton />
        <div className="flex items-center gap-2">
          <Bell className="w-4 h-4 text-primary" />
          <span className="text-sm font-semibold">Competitors</span>
        </div>
        {/* Section tabs */}
        <div className="hidden sm:flex items-center gap-0.5 rounded-lg border border-border p-0.5 bg-muted/40">
          <button
            onClick={() => router.push(`/projects/${params.projectId}/intelligence`)}
            className="px-3 py-1 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            Analysis
          </button>
          <button
            onClick={() => router.push(`/projects/${params.projectId}/intelligence/profiles`)}
            className="px-3 py-1 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            Profiles
          </button>
          <button className="px-3 py-1 rounded-md text-xs font-medium bg-background text-foreground shadow-sm">
            Monitoring
          </button>
        </div>
        {unreadCount > 0 && (
          <span className="px-1.5 py-0.5 rounded-full bg-primary text-primary-foreground text-[10px] font-bold">
            {unreadCount}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {/* Filters */}
          <div className="hidden sm:flex items-center gap-1.5 border border-border rounded-md overflow-hidden text-xs">
            {[7, 14, 30].map((d) => (
              <button
                key={d}
                onClick={() => setDays(d)}
                className={`px-2.5 py-1.5 transition-colors ${days === d ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              >
                {d}d
              </button>
            ))}
          </div>
          <button
            onClick={() => setUnreadOnly(!unreadOnly)}
            className={`flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-md border transition-colors ${unreadOnly ? 'border-primary text-primary bg-primary/5' : 'border-border text-muted-foreground hover:text-foreground'}`}
          >
            <Filter className="w-3 h-3" />
            Unread
          </button>
          <button
            onClick={handleScan}
            disabled={scanning}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {scanning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            {scanning ? 'Scanning…' : 'Run Scan'}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : alerts.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-96 text-center px-8">
            <Globe className="w-12 h-12 text-muted-foreground/30 mb-4" />
            <h2 className="text-lg font-semibold mb-2">No alerts yet</h2>
            <p className="text-sm text-muted-foreground max-w-sm mb-6">
              Run a scan to monitor brand mentions, competitor news, and industry updates using live web search.
            </p>
            <button
              onClick={handleScan}
              disabled={scanning}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {scanning ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              {scanning ? 'Scanning…' : 'Run first scan'}
            </button>
          </div>
        ) : (
          <div className="px-4 sm:px-6 py-4 space-y-2 max-w-4xl mx-auto">
            {/* Mark all read */}
            {unreadCount > 0 && (
              <div className="flex justify-end mb-2">
                <button
                  onClick={async () => {
                    await Promise.all(alerts.filter((a) => !a.read).map((a) => api.monitoring.markRead(params.projectId, a.id)))
                    setAlerts((prev) => prev.map((a) => ({ ...a, read: true })))
                    toast.success('All alerts marked as read')
                  }}
                  className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  <CheckCheck className="w-3.5 h-3.5" />
                  Mark all read
                </button>
              </div>
            )}

            {alerts.map((alert) => (
              <AlertRow key={alert.id} alert={alert} onRead={() => markRead(alert)} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// AlertRow
// ---------------------------------------------------------------------------

function AlertRow({ alert, onRead }: { alert: MonitorAlert; onRead: () => void }) {
  return (
    <div
      className={`relative rounded-xl border transition-colors ${
        alert.read ? 'border-border bg-card' : 'border-primary/30 bg-primary/5'
      }`}
      onClick={onRead}
    >
      {/* Unread dot */}
      {!alert.read && (
        <span className="absolute top-3.5 left-3 w-1.5 h-1.5 rounded-full bg-primary" />
      )}

      <div className={`flex items-start gap-3 px-4 py-3 ${!alert.read ? 'pl-6' : ''}`}>
        <div className="flex-1 min-w-0">
          {/* Subject tag + sentiment */}
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            {alert.subject && (
              <span className="px-1.5 py-0.5 rounded-full bg-muted text-[10px] font-medium text-muted-foreground">
                {alert.subject}
              </span>
            )}
            <span className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-medium ${sentimentClass(alert.sentiment)}`}>
              <SentimentIcon sentiment={alert.sentiment} />
              {sentimentLabel(alert.sentiment)}
            </span>
            {alert.source && (
              <span className="text-[10px] text-muted-foreground">{alert.source}</span>
            )}
            <span className="ml-auto text-[10px] text-muted-foreground shrink-0">
              {timeAgo(alert.publishedAt ?? alert.savedAt)}
            </span>
          </div>

          {/* Title */}
          <p className="text-sm font-medium leading-snug mb-1">{alert.title}</p>

          {/* Snippet */}
          {alert.snippet && (
            <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">{alert.snippet}</p>
          )}
        </div>

        {/* Open link */}
        <a
          href={alert.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="shrink-0 p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
      </div>
    </div>
  )
}
