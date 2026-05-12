'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import {
  Library, Search, Trash2, Check, RefreshCw, Loader2, TrendingUp, Hash,
  Instagram, Mail, Video, Megaphone, FileText, RotateCcw, Shuffle, ClipboardCheck, Zap, CalendarRange,
  ShieldAlert, ShieldCheck, AlertTriangle, X,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { api } from '@/lib/api'
import { useAppStore } from '@/stores/app-store'
import { SidebarToggle } from '@/components/layout/sidebar'
import { BackButton } from '@/components/layout/back-button'
import type { ContentLibraryItem, ContentLibraryStatus, BrandDriftResult } from '@/types'
import { RecycleModal } from '@/components/content-ops/recycle-modal'
import { TransformModal } from '@/components/content-ops/transform-modal'
import { PerformanceModal } from '@/components/content-ops/performance-modal'
import { LogMetricsModal } from '@/components/brand-tools/log-metrics-modal'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PLATFORMS = ['All', 'Instagram', 'Facebook', 'TikTok', 'LinkedIn', 'X', 'Email']
const STATUSES: { value: ContentLibraryStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'draft', label: 'Draft' },
  { value: 'approved', label: 'Approved' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'posted', label: 'Posted' },
]

const STATUS_STYLES: Record<ContentLibraryStatus, string> = {
  draft: 'bg-muted text-muted-foreground',
  in_review: 'bg-amber-500/10 text-amber-600 border-amber-500/20',
  approved: 'bg-green-500/10 text-green-600 border-green-500/20',
  scheduled: 'bg-blue-500/10 text-blue-600 border-blue-500/20',
  posted: 'bg-purple-500/10 text-purple-600 border-purple-500/20',
}

const TYPE_ICONS: Record<string, React.ReactNode> = {
  caption: <Instagram className="w-3 h-3" />,
  ad_copy: <Megaphone className="w-3 h-3" />,
  video_script: <Video className="w-3 h-3" />,
  email: <Mail className="w-3 h-3" />,
  image_prompt: <FileText className="w-3 h-3" />,
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function LibraryPage() {
  const params = useParams<{ projectId: string }>()
  const { activeProject, setHashtagPanelOpen } = useAppStore()

  const [items, setItems] = useState<ContentLibraryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [platformFilter, setPlatformFilter] = useState('All')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [recycleItem, setRecycleItem] = useState<ContentLibraryItem | null>(null)
  const [transformItem, setTransformItem] = useState<ContentLibraryItem | null>(null)
  const [performanceItem, setPerformanceItem] = useState<ContentLibraryItem | null>(null)
  const [metricsItem, setMetricsItem] = useState<ContentLibraryItem | null>(null)
  const [scoring, setScoring] = useState(false)
  const [scores, setScores] = useState<Record<string, number | null>>({})
  const [sortBy, setSortBy] = useState<'date_desc' | 'date_asc' | 'score_desc'>('date_desc')
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false)
  const [scheduleDate, setScheduleDate] = useState('')
  const [scheduling, setScheduling] = useState(false)
  const [driftResult, setDriftResult] = useState<BrandDriftResult | null>(null)
  const [driftChecking, setDriftChecking] = useState(false)

  const loadItems = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.contentLibrary.list(params.projectId, {
        platform: platformFilter !== 'All' ? platformFilter : undefined,
        status: statusFilter !== 'all' ? statusFilter : undefined,
      })
      setItems(data.items)
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }, [params.projectId, platformFilter, statusFilter])

  useEffect(() => { loadItems() }, [loadItems])

  const filtered = items
    .filter((item) => !search || item.content.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      if (sortBy === 'score_desc') {
        const sa = scores[a.id] ?? a.voice_score ?? -1
        const sb = scores[b.id] ?? b.voice_score ?? -1
        return sb - sa
      }
      const ta = new Date(a.createdAt).getTime()
      const tb = new Date(b.createdAt).getTime()
      return sortBy === 'date_asc' ? ta - tb : tb - ta
    })

  async function handleStatusChange(item: ContentLibraryItem, newStatus: ContentLibraryStatus) {
    try {
      const updated = await api.contentLibrary.update(params.projectId, item.id, { status: newStatus })
      setItems((prev) => prev.map((i) => (i.id === item.id ? updated : i)))
      toast.success(`Marked as ${newStatus}`)
    } catch {
      toast.error('Failed to update status')
    }
  }

  async function handleDelete(id: string) {
    try {
      await api.contentLibrary.delete(params.projectId, id)
      setItems((prev) => prev.filter((i) => i.id !== id))
      setSelectedIds((prev) => { const s = new Set(prev); s.delete(id); return s })
      toast.success('Deleted')
    } catch {
      toast.error('Failed to delete')
    }
  }

  async function handleBulkApprove() {
    const ids = Array.from(selectedIds)
    await Promise.all(ids.map((id) => api.contentLibrary.update(params.projectId, id, { status: 'approved' })))
    setItems((prev) => prev.map((i) => selectedIds.has(i.id) ? { ...i, status: 'approved' } : i))
    setSelectedIds(new Set())
    toast.success(`${ids.length} items approved`)
  }

  async function handleBulkSchedule() {
    if (!scheduleDate) { toast.error('Pick a start date'); return }
    setScheduling(true)
    try {
      const ids = Array.from(selectedIds)
      const result = await api.contentLibrary.bulkSchedule(params.projectId, ids, scheduleDate)
      toast.success(`${result.scheduled} items scheduled to calendar`)
      setSelectedIds(new Set())
      setScheduleModalOpen(false)
      setScheduleDate('')
      loadItems()
    } catch {
      toast.error('Failed to schedule items')
    } finally {
      setScheduling(false)
    }
  }

  async function handleSubmitReview(id: string) {
    try {
      await api.approval.submitForReview(params.projectId, id)
      setItems((prev) => prev.map((i) => i.id === id ? { ...i, status: 'in_review' as ContentLibraryStatus } : i))
      toast.success('Submitted for review')
    } catch {
      toast.error('Failed to submit for review')
    }
  }

  async function handleScoreAll() {
    if (scoring || items.length === 0) return
    setScoring(true)
    try {
      const ids = items.slice(0, 20).map((i) => i.id)
      const result = await api.reports.scoreContent(params.projectId, ids)
      const newScores: Record<string, number | null> = {}
      for (const [id, r] of Object.entries(result)) {
        newScores[id] = r.score
      }
      setScores((prev) => ({ ...prev, ...newScores }))
      toast.success('Content scored')
    } catch {
      toast.error('Scoring failed - Brand Core required')
    } finally {
      setScoring(false)
    }
  }

  async function handleCheckDrift() {
    const selectedItems = items.filter((i) => selectedIds.has(i.id))
    if (selectedItems.length === 0) return
    setDriftChecking(true)
    try {
      const content = selectedItems.map((i) => i.content)
      const result = await api.drift.check(params.projectId, content)
      setDriftResult(result)
    } catch {
      toast.error('Drift check failed - Brand Core required')
    } finally {
      setDriftChecking(false)
    }
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const s = new Set(prev)
      if (s.has(id)) { s.delete(id) } else { s.add(id) }
      return s
    })
  }

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-3 sm:px-4 py-3 border-b border-border shrink-0">
        <SidebarToggle />
        <BackButton />
        <Library className="w-4 h-4 text-primary" />
        <span className="text-sm font-semibold">Content Library</span>
        {activeProject && <span className="text-xs text-muted-foreground">- {activeProject.name}</span>}
        <div className="ml-auto flex items-center gap-2">
          {selectedIds.size > 0 && (
            <>
              <span className="text-xs text-muted-foreground">{selectedIds.size} selected</span>
              <button
                onClick={handleBulkApprove}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors"
              >
                <Check className="w-3.5 h-3.5" /> Approve
              </button>
              <button
                onClick={() => setScheduleModalOpen(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
              >
                <CalendarRange className="w-3.5 h-3.5" /> Schedule
              </button>
              <button
                onClick={handleCheckDrift}
                disabled={driftChecking}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-violet-600 text-white rounded-md hover:bg-violet-700 disabled:opacity-50 transition-colors"
              >
                {driftChecking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldAlert className="w-3.5 h-3.5" />} Drift Check
              </button>
            </>
          )}
          <button
            onClick={handleScoreAll}
            disabled={scoring}
            title="Score all items against brand voice"
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-50 transition-colors"
          >
            {scoring ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
            Score
          </button>
          <button
            onClick={() => setHashtagPanelOpen(true)}
            title="Hashtag Research"
            className="flex items-center gap-1 p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <Hash className="w-3.5 h-3.5" />
          </button>
          <button onClick={loadItems} className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="px-4 py-3 border-b border-border bg-muted/20 flex items-center gap-3 flex-wrap shrink-0">
        <div className="relative flex-1 min-w-0">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search content…"
            className="w-full pl-8 pr-3 py-1.5 text-xs bg-background border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        <div className="flex items-center gap-1.5">
          {PLATFORMS.map((p) => (
            <button
              key={p}
              onClick={() => setPlatformFilter(p)}
              className={cn(
                'px-2.5 py-1 rounded-md text-xs transition-colors',
                platformFilter === p ? 'bg-primary text-primary-foreground' : 'bg-background border border-border text-muted-foreground hover:text-foreground',
              )}
            >
              {p}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 ml-auto">
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
            className="text-xs bg-background border border-border rounded-md px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="date_desc">Newest first</option>
            <option value="date_asc">Oldest first</option>
            <option value="score_desc">Best score</option>
          </select>
        </div>

        <div className="flex items-center gap-1.5">
          {STATUSES.map((s) => (
            <button
              key={s.value}
              onClick={() => setStatusFilter(s.value)}
              className={cn(
                'px-2.5 py-1 rounded-md text-xs transition-colors',
                statusFilter === s.value ? 'bg-primary text-primary-foreground' : 'bg-background border border-border text-muted-foreground hover:text-foreground',
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content grid */}
      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-96 text-center">
            <Library className="w-12 h-12 text-muted-foreground/30 mb-4" />
            <h2 className="text-lg font-semibold mb-2">No content yet</h2>
            <p className="text-sm text-muted-foreground max-w-sm">
              Generate content in chat and click <strong>Save</strong> on any caption, ad, script, or email to build your library.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {filtered.map((item) => (
              <LibraryCard
                key={item.id}
                item={item}
                selected={selectedIds.has(item.id)}
                voiceScore={scores[item.id] ?? item.voice_score ?? null}
                onSelect={() => toggleSelect(item.id)}
                onStatusChange={(s) => handleStatusChange(item, s)}
                onDelete={() => handleDelete(item.id)}
                onRecycle={() => setRecycleItem(item)}
                onTransform={() => setTransformItem(item)}
                onSubmitReview={() => handleSubmitReview(item.id)}
                onLogMetrics={() => setMetricsItem(item)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Modals */}
      {recycleItem && (
        <RecycleModal
          item={recycleItem}
          projectId={params.projectId}
          onClose={() => setRecycleItem(null)}
          onSaved={loadItems}
        />
      )}
      {transformItem && (
        <TransformModal
          item={transformItem}
          projectId={params.projectId}
          onClose={() => setTransformItem(null)}
          onSaved={loadItems}
        />
      )}
      {performanceItem && (
        <PerformanceModal
          item={performanceItem}
          projectId={params.projectId}
          onClose={() => setPerformanceItem(null)}
          onSaved={loadItems}
        />
      )}
      {metricsItem && (
        <LogMetricsModal
          projectId={params.projectId}
          itemId={metricsItem.id}
          platform={metricsItem.platform}
          onClose={() => setMetricsItem(null)}
        />
      )}

      {/* Brand Drift Modal */}
      {driftResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-card border border-border rounded-xl w-full max-w-md shadow-xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <div className="flex items-center gap-2">
                {driftResult.status === 'on_track'
                  ? <ShieldCheck className="w-4 h-4 text-green-600" />
                  : <ShieldAlert className="w-4 h-4 text-amber-500" />}
                <span className="text-sm font-semibold">Brand Drift Report</span>
              </div>
              <button onClick={() => setDriftResult(null)} className="p-1 rounded hover:bg-muted text-muted-foreground">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="px-5 py-4 space-y-4 max-h-[70vh] overflow-y-auto">
              {/* Score + status */}
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Drift Score</p>
                  <p className="text-2xl font-bold tabular-nums">{driftResult.drift_score}<span className="text-sm font-normal text-muted-foreground">/100</span></p>
                </div>
                <span className={cn(
                  'text-xs font-semibold px-3 py-1 rounded-full capitalize',
                  driftResult.status === 'on_track' ? 'bg-green-500/10 text-green-600' :
                  driftResult.status === 'minor_drift' ? 'bg-amber-500/10 text-amber-600' :
                  driftResult.status === 'significant_drift' ? 'bg-orange-500/10 text-orange-600' :
                  driftResult.status === 'off_brand' ? 'bg-red-500/10 text-red-600' :
                  'bg-muted text-muted-foreground',
                )}>
                  {driftResult.status.replace('_', ' ')}
                </span>
              </div>

              {/* Drift dimensions */}
              <div className="grid grid-cols-3 gap-2">
                {([
                  { label: 'Tone', value: driftResult.tone_drift },
                  { label: 'Theme', value: driftResult.theme_drift },
                  { label: 'Voice', value: driftResult.voice_drift },
                ] as { label: string; value: boolean }[]).map(({ label, value }) => (
                  <div key={label} className={cn(
                    'text-center rounded-lg p-2 border',
                    value ? 'border-red-500/20 bg-red-500/5' : 'border-green-500/20 bg-green-500/5',
                  )}>
                    <p className="text-[10px] text-muted-foreground">{label}</p>
                    <p className={cn('text-xs font-semibold mt-0.5', value ? 'text-red-600' : 'text-green-600')}>
                      {value ? 'Drifted' : 'Aligned'}
                    </p>
                  </div>
                ))}
              </div>

              {/* Issues */}
              {driftResult.issues.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3 text-amber-500" /> Issues
                  </p>
                  <ul className="space-y-1">
                    {driftResult.issues.map((issue, i) => (
                      <li key={i} className="text-xs text-foreground/80 flex gap-1.5">
                        <span className="text-amber-500 shrink-0">•</span>{issue}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Recommendations */}
              {driftResult.recommendations.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">Recommendations</p>
                  <ul className="space-y-1">
                    {driftResult.recommendations.map((rec, i) => (
                      <li key={i} className="text-xs text-foreground/80 flex gap-1.5">
                        <span className="text-primary shrink-0">→</span>{rec}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Positive observations */}
              {driftResult.positive_observations.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">What&apos;s Working</p>
                  <ul className="space-y-1">
                    {driftResult.positive_observations.map((obs, i) => (
                      <li key={i} className="text-xs text-foreground/80 flex gap-1.5">
                        <span className="text-green-600 shrink-0">✓</span>{obs}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
            <div className="px-5 py-3 border-t border-border">
              <button
                onClick={() => setDriftResult(null)}
                className="w-full py-2 text-sm font-medium border border-border rounded-lg hover:bg-muted transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Schedule Modal */}
      {scheduleModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-card border border-border rounded-xl p-6 w-80 shadow-xl space-y-4">
            <h3 className="text-sm font-semibold">Schedule {selectedIds.size} item{selectedIds.size !== 1 ? 's' : ''} to Calendar</h3>
            <p className="text-xs text-muted-foreground">One item per day, starting from the date you choose.</p>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Start date</label>
              <input
                type="date"
                value={scheduleDate}
                onChange={(e) => setScheduleDate(e.target.value)}
                min={new Date().toISOString().slice(0, 10)}
                className="w-full px-3 py-2 text-sm border border-border rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleBulkSchedule}
                disabled={scheduling || !scheduleDate}
                className="flex-1 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors"
              >
                {scheduling ? 'Scheduling…' : 'Schedule'}
              </button>
              <button
                onClick={() => { setScheduleModalOpen(false); setScheduleDate('') }}
                className="flex-1 py-2 text-sm border border-border rounded-lg hover:bg-muted transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// LibraryCard
// ---------------------------------------------------------------------------

function ScorePill({ score }: { score: number | null }) {
  if (score === null) return null
  const color = score >= 80 ? 'text-green-600 bg-green-500/10' : score >= 60 ? 'text-amber-600 bg-amber-500/10' : 'text-red-600 bg-red-500/10'
  return (
    <span className={cn('text-[10px] font-semibold px-1.5 py-0.5 rounded-full', color)}>
      {score}
    </span>
  )
}

function LibraryCard({
  item, selected, voiceScore, onSelect, onStatusChange, onDelete, onRecycle, onTransform, onSubmitReview, onLogMetrics,
}: {
  item: ContentLibraryItem
  selected: boolean
  voiceScore: number | null
  onSelect: () => void
  onStatusChange: (s: ContentLibraryStatus) => void
  onDelete: () => void
  onRecycle: () => void
  onTransform: () => void
  onSubmitReview: () => void
  onLogMetrics: () => void
}) {
  const [showStatusMenu, setShowStatusMenu] = useState(false)
  const statusStyle = STATUS_STYLES[item.status] ?? STATUS_STYLES.draft

  return (
    <div className={cn(
      'relative rounded-xl border bg-card overflow-hidden transition-all group',
      selected ? 'border-primary ring-1 ring-primary/20' : 'border-border hover:border-border/60',
    )}>
      {/* Select checkbox */}
      <button
        onClick={onSelect}
        className={cn(
          'absolute top-3 left-3 w-4 h-4 rounded border transition-all z-10',
          selected ? 'bg-primary border-primary' : 'border-border bg-background opacity-0 group-hover:opacity-100',
        )}
      >
        {selected && <Check className="w-2.5 h-2.5 text-white m-auto" />}
      </button>

      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-3 pb-2 pl-10">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">{TYPE_ICONS[item.type] ?? <FileText className="w-3 h-3" />}</span>
          <span className="text-xs font-medium">{item.platform}</span>
          <ScorePill score={voiceScore} />
        </div>
        {/* Status badge */}
        <button
          onClick={() => setShowStatusMenu(!showStatusMenu)}
          className={cn('text-[10px] px-2 py-0.5 rounded-full border font-medium capitalize', statusStyle)}
        >
          {item.status}
        </button>
        {showStatusMenu && (
          <div className="absolute top-9 right-3 z-20 bg-card border border-border rounded-lg shadow-lg py-1 min-w-24">
            {(['draft', 'approved', 'scheduled', 'posted'] as ContentLibraryStatus[]).map((s) => (
              <button
                key={s}
                onClick={() => { onStatusChange(s); setShowStatusMenu(false) }}
                className="w-full px-3 py-1.5 text-xs text-left hover:bg-muted capitalize transition-colors"
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Content */}
      <div className="px-4 pb-3">
        {(() => {
          const hook = (item.metadata?.hook ?? item.metadata?.headline) as string | undefined
          const cta = item.metadata?.cta as string | undefined
          return (
            <>
              {hook && (
                <p className="text-[10px] font-semibold text-primary uppercase tracking-wide mb-1.5 truncate">
                  {hook}
                </p>
              )}
              <p className="text-sm text-foreground/90 leading-relaxed line-clamp-4">{item.content}</p>
              {cta && (
                <p className="mt-1.5 text-xs text-muted-foreground italic truncate">CTA: {cta}</p>
              )}
            </>
          )
        })()}
        {item.hashtags.length > 0 && (
          <p className="mt-1.5 text-xs text-primary/70 truncate">
            {item.hashtags.slice(0, 6).map((h) => `#${h.replace(/^#/, '')}`).join(' ')}
          </p>
        )}
      </div>

      {/* Footer actions */}
      <div className="flex items-center gap-1 px-3 pb-3 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={onRecycle}
          title="Generate variants of this content"
          className="flex items-center gap-1 px-2 py-1 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <RotateCcw className="w-3 h-3" />
          <span>Recycle</span>
        </button>
        <button
          onClick={onTransform}
          title="Adapt for all platforms"
          className="flex items-center gap-1 px-2 py-1 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <Shuffle className="w-3 h-3" />
          <span>Transform</span>
        </button>
        <button
          onClick={onLogMetrics}
          title="Log performance metrics"
          className="flex items-center gap-1 px-2 py-1 rounded-md text-xs text-muted-foreground hover:text-green-600 hover:bg-muted transition-colors"
        >
          <TrendingUp className="w-3 h-3" />
          <span>Metrics</span>
        </button>
        {item.status === 'draft' && (
          <button
            onClick={onSubmitReview}
            title="Submit for team review"
            className="flex items-center gap-1 px-2 py-1 rounded-md text-xs text-muted-foreground hover:text-amber-600 hover:bg-muted transition-colors"
          >
            <ClipboardCheck className="w-3 h-3" />
            <span>Review</span>
          </button>
        )}
        <button
          onClick={onDelete}
          className="ml-auto p-1 rounded-md text-muted-foreground hover:text-destructive hover:bg-muted transition-colors"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </div>

      {/* Date */}
      <div className="px-4 pb-2 text-[10px] text-muted-foreground/50">
        {new Date(item.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
      </div>
    </div>
  )
}
