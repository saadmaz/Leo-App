'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import {
  FileText, Sparkles, RefreshCw, Download, TrendingUp,
  BarChart2, Upload, CheckCircle2, FlaskConical, Plus, Trash2,
  Clock, AlertCircle, ExternalLink, ChevronDown, ChevronUp, Loader2,
} from 'lucide-react'
import { toast } from 'sonner'
import { SidebarToggle } from '@/components/layout/sidebar'
import { BackButton } from '@/components/layout/back-button'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import type { WeeklyDigest, ResearchReport } from '@/types'

// ---------------------------------------------------------------------------
// Markdown-lite renderer (bold, headers, bullets)
// ---------------------------------------------------------------------------

function renderMarkdown(text: string) {
  const lines = text.split('\n')
  const elements: React.ReactNode[] = []
  let key = 0

  for (const line of lines) {
    if (line.startsWith('## ')) {
      elements.push(
        <h2 key={key++} className="text-sm font-bold mt-5 mb-1.5 text-foreground">
          {line.slice(3)}
        </h2>
      )
    } else if (line.startsWith('- ') || line.startsWith('• ')) {
      elements.push(
        <li key={key++} className="text-sm text-muted-foreground ml-3 leading-relaxed">
          {parseBold(line.slice(2))}
        </li>
      )
    } else if (line.trim() === '') {
      elements.push(<div key={key++} className="h-1" />)
    } else {
      elements.push(
        <p key={key++} className="text-sm text-muted-foreground leading-relaxed">
          {parseBold(line)}
        </p>
      )
    }
  }
  return elements
}

function parseBold(text: string): React.ReactNode {
  const parts = text.split(/\*\*(.*?)\*\*/)
  return parts.map((p, i) =>
    i % 2 === 1 ? <strong key={i} className="text-foreground font-semibold">{p}</strong> : p
  )
}

// ---------------------------------------------------------------------------
// Stat mini-card
// ---------------------------------------------------------------------------

function MiniStat({ label, value, icon }: { label: string; value: string | number; icon: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2.5 bg-muted/40 rounded-lg px-3 py-2.5">
      <div className="text-muted-foreground">{icon}</div>
      <div>
        <p className="text-[11px] text-muted-foreground">{label}</p>
        <p className="text-sm font-bold tabular-nums">{value}</p>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Research report types & helpers
// ---------------------------------------------------------------------------

const REPORT_TYPES = [
  { value: 'market_landscape',   label: 'Market Landscape' },
  { value: 'competitor_deep',    label: 'Competitor Deep-Dive' },
  { value: 'trend_analysis',     label: 'Trend Analysis' },
  { value: 'audience_insights',  label: 'Audience Insights' },
]

function StatusBadge({ status }: { status: ResearchReport['status'] }) {
  const styles: Record<ResearchReport['status'], string> = {
    pending:    'bg-amber-500/10 text-amber-600',
    processing: 'bg-blue-500/10 text-blue-600',
    complete:   'bg-green-500/10 text-green-600',
    error:      'bg-red-500/10 text-red-500',
  }
  const icons: Record<ResearchReport['status'], React.ReactNode> = {
    pending:    <Clock className="w-3 h-3" />,
    processing: <Loader2 className="w-3 h-3 animate-spin" />,
    complete:   <CheckCircle2 className="w-3 h-3" />,
    error:      <AlertCircle className="w-3 h-3" />,
  }
  return (
    <span className={cn('flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium capitalize', styles[status])}>
      {icons[status]}
      {status}
    </span>
  )
}

// ---------------------------------------------------------------------------
// ResearchReportsTab
// ---------------------------------------------------------------------------

function ResearchReportsTab({ projectId }: { projectId: string }) {
  const [reports, setReports]     = useState<ResearchReport[]>([])
  const [listLoading, setListLoading] = useState(true)
  const [topic, setTopic]         = useState('')
  const [reportType, setReportType] = useState('market_landscape')
  const [starting, setStarting]   = useState(false)
  const [expanded, setExpanded]   = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const loadList = useCallback(async () => {
    try {
      const data = await api.research.list(projectId)
      setReports(data.reports)
    } catch {
      // silently ignore
    } finally {
      setListLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    loadList()
  }, [loadList])

  // Poll every 5 s while any report is pending/processing
  useEffect(() => {
    const hasActive = reports.some(
      (r) => r.status === 'pending' || r.status === 'processing',
    )
    if (hasActive && !pollRef.current) {
      pollRef.current = setInterval(loadList, 5000)
    }
    if (!hasActive && pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
    return () => {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
    }
  }, [reports, loadList])

  async function handleStart() {
    if (!topic.trim()) { toast.error('Enter a research topic'); return }
    setStarting(true)
    try {
      await api.research.start(projectId, topic.trim(), reportType)
      setTopic('')
      toast.success('Research started - results will appear below when ready')
      await loadList()
    } catch (err) {
      toast.error(String(err))
    } finally {
      setStarting(false)
    }
  }

  async function handleDelete(reportId: string) {
    try {
      await api.research.delete(projectId, reportId)
      setReports((prev) => prev.filter((r) => r.id !== reportId))
      if (expanded === reportId) setExpanded(null)
      toast.success('Report deleted')
    } catch {
      toast.error('Failed to delete report')
    }
  }

  function downloadReport(report: ResearchReport) {
    if (!report.sections) return
    const lines = [`# ${report.title ?? report.topic}`, '', report.summary ?? '', '']
    report.sections.forEach((s) => {
      lines.push(`## ${s.title}`, '', s.content, '')
    })
    if (report.sources?.length) {
      lines.push('## Sources', '')
      report.sources.forEach((src) => lines.push(`- [${src.title}](${src.url})`))
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${report.topic.replace(/\s+/g, '-').toLowerCase()}-research.md`
    a.click()
    URL.revokeObjectURL(url)
    toast.success('Downloaded')
  }

  return (
    <div className="space-y-4">
      {/* Start new research */}
      <div className="border border-border rounded-xl bg-card p-4 space-y-3">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">New Research Report</p>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleStart()}
            placeholder="e.g. AI tools for small business marketing in 2025"
            className="flex-1 text-sm bg-background border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <select
            value={reportType}
            onChange={(e) => setReportType(e.target.value)}
            className="text-sm bg-background border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary"
          >
            {REPORT_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
          <button
            onClick={handleStart}
            disabled={starting || !topic.trim()}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 transition-opacity whitespace-nowrap"
          >
            {starting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
            Start Research
          </button>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Deep research uses AI to search, scrape, and synthesise sources into a structured report. Takes 1-3 minutes.
        </p>
      </div>

      {/* Reports list */}
      {listLoading ? (
        <div className="flex items-center justify-center py-10">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      ) : reports.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-14 text-center">
          <FlaskConical className="w-10 h-10 text-muted-foreground/30 mb-3" />
          <p className="text-sm font-medium">No research reports yet</p>
          <p className="text-xs text-muted-foreground mt-1">Start a report above to get AI-synthesised research on any topic.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {reports.map((report) => {
            const isExpanded = expanded === report.id
            const isReady = report.status === 'complete'
            return (
              <div key={report.id} className="border border-border rounded-xl bg-card overflow-hidden">
                {/* Row header */}
                <div className="flex items-center gap-3 px-4 py-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{report.title ?? report.topic}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <StatusBadge status={report.status} />
                      {report.report_type && (
                        <span className="text-[10px] text-muted-foreground capitalize">
                          {REPORT_TYPES.find((t) => t.value === report.report_type)?.label ?? report.report_type}
                        </span>
                      )}
                      <span className="text-[10px] text-muted-foreground">
                        {new Date(report.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {isReady && (
                      <button
                        onClick={() => downloadReport(report)}
                        className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                        title="Download .md"
                      >
                        <Download className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <button
                      onClick={() => handleDelete(report.id)}
                      className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-red-500 transition-colors"
                      title="Delete"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                    {isReady && (
                      <button
                        onClick={() => setExpanded(isExpanded ? null : report.id)}
                        className="p-1.5 rounded hover:bg-muted text-muted-foreground transition-colors"
                      >
                        {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                      </button>
                    )}
                  </div>
                </div>

                {/* Expanded report body */}
                {isExpanded && isReady && (
                  <div className="border-t border-border px-4 py-4 space-y-4">
                    {report.summary && (
                      <p className="text-sm text-muted-foreground leading-relaxed">{report.summary}</p>
                    )}

                    {report.sections?.map((section, i) => (
                      <div key={i}>
                        <h3 className="text-sm font-semibold mb-1.5">{section.title}</h3>
                        <div className="space-y-0.5 text-sm text-muted-foreground leading-relaxed">
                          {renderMarkdown(section.content)}
                        </div>
                      </div>
                    ))}

                    {report.sources && report.sources.length > 0 && (
                      <div className="pt-2 border-t border-border/50">
                        <p className="text-xs font-semibold text-muted-foreground mb-2">Sources</p>
                        <div className="space-y-1">
                          {report.sources.map((src, i) => (
                            <a
                              key={i}
                              href={src.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-1.5 text-xs text-primary hover:underline"
                            >
                              <ExternalLink className="w-3 h-3 shrink-0" />
                              {src.title || src.url}
                            </a>
                          ))}
                        </div>
                      </div>
                    )}

                    {report.error && (
                      <div className="flex items-center gap-2 text-xs text-red-500 bg-red-500/10 rounded-lg px-3 py-2">
                        <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                        {report.error}
                      </div>
                    )}
                  </div>
                )}

                {/* Processing placeholder */}
                {(report.status === 'pending' || report.status === 'processing') && (
                  <div className="border-t border-border/50 px-4 py-3 flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Researching and synthesising sources - this takes 1-3 minutes…
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

type Tab = 'digest' | 'research'

export default function ReportsPage() {
  const params = useParams<{ projectId: string }>()
  const projectId = params.projectId

  const [tab, setTab] = useState<Tab>('digest')
  const [digest, setDigest] = useState<WeeklyDigest | null>(null)
  const [loading, setLoading] = useState(false)

  const generate = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.reports.getDigest(projectId)
      setDigest(data)
    } catch {
      toast.error('Failed to generate digest')
    } finally {
      setLoading(false)
    }
  }, [projectId])

  function downloadMd() {
    if (!digest) return
    const blob = new Blob([digest.digest], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `leo-digest-${new Date().toISOString().slice(0, 10)}.md`
    a.click()
    URL.revokeObjectURL(url)
  }

  const ov = digest?.overview

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <header className="flex items-center gap-2 px-4 py-3 border-b border-border shrink-0">
        <SidebarToggle />
        <BackButton />
        <FileText className="w-4 h-4 text-muted-foreground" />
        <span className="text-sm font-semibold">Reports</span>

        {/* Tabs */}
        <div className="flex items-center gap-1 ml-3">
          {([
            { id: 'digest',   label: 'Weekly Digest',      icon: <Sparkles className="w-3.5 h-3.5" /> },
            { id: 'research', label: 'Research Reports',  icon: <FlaskConical className="w-3.5 h-3.5" /> },
          ] as { id: Tab; label: string; icon: React.ReactNode }[]).map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
                tab === t.id
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted',
              )}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>

        {/* Digest-only actions */}
        {tab === 'digest' && (
          <div className="ml-auto flex items-center gap-2">
            {digest && (
              <>
                <span className="text-[11px] text-muted-foreground hidden sm:block">
                  {new Date(digest.generated_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </span>
                <button
                  onClick={downloadMd}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border border-border hover:bg-muted transition-colors"
                >
                  <Download className="w-3 h-3" />
                  Export MD
                </button>
              </>
            )}
            <button
              onClick={generate}
              disabled={loading}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {loading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
              {digest ? 'Regenerate' : 'Generate Digest'}
            </button>
          </div>
        )}
      </header>

      <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 max-w-3xl mx-auto w-full space-y-4">

        {/* ── AI Digest tab ── */}
        {tab === 'digest' && (
          <>
            {!digest && !loading && (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <div className="p-4 rounded-full bg-muted mb-4">
                  <Sparkles className="w-8 h-8 text-muted-foreground" />
                </div>
                <h2 className="text-base font-semibold mb-1">AI Weekly Digest</h2>
                <p className="text-sm text-muted-foreground max-w-sm mb-6">
                  Get a comprehensive AI-powered analysis of your content performance, what&apos;s working,
                  and specific recommendations for next week.
                </p>
                <button
                  onClick={generate}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors text-sm font-medium"
                >
                  <Sparkles className="w-4 h-4" />
                  Generate Digest
                </button>
              </div>
            )}

            {loading && (
              <div className="flex flex-col items-center justify-center py-20 gap-3">
                <RefreshCw className="w-6 h-6 text-primary animate-spin" />
                <p className="text-sm text-muted-foreground">Analysing your content performance…</p>
              </div>
            )}

            {digest && !loading && (
              <>
                {ov && (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <MiniStat label="Total Content"  value={ov.total_content}          icon={<FileText className="w-3.5 h-3.5" />} />
                    <MiniStat label="Posted"         value={ov.total_posted}           icon={<Upload className="w-3.5 h-3.5" />} />
                    <MiniStat label="Avg Engagement" value={ov.avg_engagement}         icon={<TrendingUp className="w-3.5 h-3.5" />} />
                    <MiniStat label="Best Platform"  value={ov.best_platform || '-'}   icon={<BarChart2 className="w-3.5 h-3.5" />} />
                  </div>
                )}

                {ov && Object.keys(ov.platform_breakdown).length > 0 && (
                  <div className="bg-card border border-border rounded-lg p-3">
                    <p className="text-xs font-semibold text-muted-foreground mb-2">Platform Distribution</p>
                    <div className="flex flex-wrap gap-2">
                      {Object.entries(ov.platform_breakdown).map(([platform, count]) => (
                        <div key={platform} className="flex items-center gap-1.5 px-2.5 py-1 bg-muted rounded-full text-xs">
                          <span className="font-medium capitalize">{platform}</span>
                          <span className="text-muted-foreground">{count}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="bg-card border border-border rounded-lg p-5">
                  <div className="flex items-center gap-2 mb-4 pb-3 border-b border-border">
                    <Sparkles className="w-4 h-4 text-primary" />
                    <span className="text-sm font-semibold">AI Analysis</span>
                    <CheckCircle2 className="w-3.5 h-3.5 text-green-500 ml-auto" />
                  </div>
                  <div className="space-y-0.5">
                    {renderMarkdown(digest.digest)}
                  </div>
                </div>

                {digest.trends.status_breakdown.length > 0 && (
                  <div className="bg-card border border-border rounded-lg p-4">
                    <p className="text-xs font-semibold text-muted-foreground mb-3">Content by Status</p>
                    <div className="space-y-2">
                      {digest.trends.status_breakdown.map((s) => {
                        const total = digest.trends.status_breakdown.reduce((acc, x) => acc + x.count, 0)
                        const pct = total > 0 ? Math.round((s.count / total) * 100) : 0
                        return (
                          <div key={s.status} className="flex items-center gap-3">
                            <span className="text-xs w-20 capitalize text-muted-foreground">{s.status}</span>
                            <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                              <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
                            </div>
                            <span className="text-xs tabular-nums text-muted-foreground w-8 text-right">{s.count}</span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </>
            )}
          </>
        )}

        {/* ── Research Reports tab ── */}
        {tab === 'research' && <ResearchReportsTab projectId={projectId} />}
      </div>
    </div>
  )
}
