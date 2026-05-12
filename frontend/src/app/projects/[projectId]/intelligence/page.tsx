'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import {
  BarChart2, RefreshCw, Plus, X, Loader2, ChevronDown, ChevronUp,
  TrendingUp, AlertTriangle, Lightbulb, Zap, Search,
  Globe, Instagram, Youtube, Linkedin, Facebook, Target,
  ArrowRight, CheckCircle2, Flame, Shield, Swords,
  TrendingDown, Minus, Activity, Sparkles, MapPin, DollarSign, Building2,
  Users, Star, ExternalLink,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { api, type IntelligenceStreamEvent } from '@/lib/api'
import { SidebarToggle } from '@/components/layout/sidebar'
import { BackButton } from '@/components/layout/back-button'
import { CompetitorReportPanel } from './competitor-report'
import type {
  CompetitorSnapshot,
  CompetitorReport,
  DiscoveredCompetitor,
  CompetitiveStrategy,
  DiscoveredInfluencer,
} from '@/types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type CompetitorForm = {
  name: string
  website: string
  instagram: string
  facebook: string
  tiktok: string
  linkedin: string
  youtube: string
}

type LogEntry = { id: number; message: string; icon: string; detail?: string; competitor?: string; ts: number }

type Tab = 'snapshots' | 'strategy' | 'influencers'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PLATFORM_ICONS: Record<string, React.ReactNode> = {
  instagram: <Instagram className="w-3.5 h-3.5" />,
  facebook: <Facebook className="w-3.5 h-3.5" />,
  tiktok: <Activity className="w-3.5 h-3.5" />,
  linkedin: <Linkedin className="w-3.5 h-3.5" />,
  youtube: <Youtube className="w-3.5 h-3.5" />,
  web: <Globe className="w-3.5 h-3.5" />,
}

const PLATFORM_COLORS: Record<string, string> = {
  instagram: 'text-pink-500 bg-pink-500/10',
  facebook: 'text-blue-500 bg-blue-500/10',
  tiktok: 'text-foreground bg-muted',
  linkedin: 'text-sky-600 bg-sky-500/10',
  youtube: 'text-red-500 bg-red-500/10',
  web: 'text-emerald-500 bg-emerald-500/10',
}

const THREAT_CONFIG = {
  high:   { label: 'High threat',   color: 'text-red-500',    bg: 'bg-red-500/10 border-red-500/20',    icon: <Flame className="w-3.5 h-3.5" /> },
  medium: { label: 'Medium threat', color: 'text-amber-500',  bg: 'bg-amber-500/10 border-amber-500/20', icon: <AlertTriangle className="w-3.5 h-3.5" /> },
  low:    { label: 'Low threat',    color: 'text-emerald-500', bg: 'bg-emerald-500/10 border-emerald-500/20', icon: <Shield className="w-3.5 h-3.5" /> },
}

const POSITION_CONFIG = {
  winning:    { label: 'Winning',    color: 'text-emerald-600', bg: 'bg-emerald-500/10', icon: <TrendingUp className="w-3.5 h-3.5" /> },
  competitive:{ label: 'Competitive', color: 'text-blue-500',  bg: 'bg-blue-500/10',    icon: <Minus className="w-3.5 h-3.5" /> },
  losing:     { label: 'Behind',     color: 'text-red-500',    bg: 'bg-red-500/10',     icon: <TrendingDown className="w-3.5 h-3.5" /> },
  untapped:   { label: 'Untapped',   color: 'text-violet-500', bg: 'bg-violet-500/10',  icon: <Sparkles className="w-3.5 h-3.5" /> },
}

const PRIORITY_CONFIG = {
  immediate:  { label: 'Do now',      color: 'text-red-500',    bg: 'bg-red-500/10',    border: 'border-red-500/30' },
  short_term: { label: 'This month',  color: 'text-amber-500',  bg: 'bg-amber-500/10',  border: 'border-amber-500/30' },
  long_term:  { label: 'Long-term',   color: 'text-blue-500',   bg: 'bg-blue-500/10',   border: 'border-blue-500/30' },
}

function emptyForm(): CompetitorForm {
  return { name: '', website: '', instagram: '', facebook: '', tiktok: '', linkedin: '', youtube: '' }
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function IntelligencePage() {
  const params = useParams<{ projectId: string }>()
  const router = useRouter()
  const searchParams = useSearchParams()

  const [tab, setTab] = useState<Tab>('snapshots')
  const [snapshots, setSnapshots] = useState<CompetitorSnapshot[]>([])
  const [strategy, setStrategy] = useState<CompetitiveStrategy | null>(null)
  const [strategyError, setStrategyError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [discovering, setDiscovering] = useState(false)
  const [strategyLoading, setStrategyLoading] = useState(false)
  const [discovered, setDiscovered] = useState<DiscoveredCompetitor[]>([])
  const [savedNames, setSavedNames] = useState<Set<string>>(new Set())
  const [savingNames, setSavingNames] = useState<Set<string>>(new Set())
  const [showAddForm, setShowAddForm] = useState(false)
  const [competitors, setCompetitors] = useState<CompetitorForm[]>([emptyForm()])
  const [liveLog, setLiveLog] = useState<LogEntry[]>([])
  const logIdRef = useRef(0)
  const [reportSnapshot, setReportSnapshot] = useState<CompetitorSnapshot | null>(null)
  const [report, setReport] = useState<CompetitorReport | null>(null)
  const [reportLoading, setReportLoading] = useState(false)

  const loadSnapshots = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.intelligence.get(params.projectId)
      setSnapshots(data.snapshots ?? [])
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }, [params.projectId])

  useEffect(() => {
    if (params.projectId) loadSnapshots()
  }, [params.projectId, loadSnapshots])

  // Pre-fill competitor form from ?prefill=Name&website=url (sent by Profiles "Deep Dive" button)
  useEffect(() => {
    const prefill = searchParams.get('prefill')
    if (!prefill) return
    setCompetitors([{
      name: prefill,
      website: searchParams.get('website') ?? '',
      instagram: '',
      facebook: '',
      tiktok: '',
      linkedin: '',
      youtube: '',
    }])
    setShowAddForm(true)
    // Clean the params from the URL without triggering a navigation
    const url = new URL(window.location.href)
    url.searchParams.delete('prefill')
    url.searchParams.delete('website')
    window.history.replaceState({}, '', url.toString())
  }, [searchParams])

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function pushLog(event: IntelligenceStreamEvent) {
    if (event.type !== 'step') return
    const id = ++logIdRef.current
    setLiveLog(prev => [...prev.slice(-40), { id, message: event.message, icon: event.icon, detail: event.detail, competitor: event.competitor, ts: Date.now() }])
  }

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  async function handleRefresh() {
    const valid = competitors.filter(c => c.name.trim())
    if (valid.length === 0) { toast.error('Add at least one competitor name.'); return }
    const hasAnyPlatform = valid.some(c => c.instagram || c.facebook || c.tiktok || c.linkedin || c.youtube || c.website)
    if (!hasAnyPlatform) { toast.error('Add at least one platform handle or URL.'); return }

    setRefreshing(true)
    setShowAddForm(false)
    setLiveLog([])

    await new Promise<void>((resolve) => {
      api.intelligence.refresh(
        params.projectId,
        valid.map(c => ({
          name: c.name.trim(),
          website:   c.website.trim()   || undefined,
          instagram: c.instagram.trim() || undefined,
          facebook:  c.facebook.trim()  || undefined,
          tiktok:    c.tiktok.trim()    || undefined,
          linkedin:  c.linkedin.trim()  || undefined,
          youtube:   c.youtube.trim()   || undefined,
        })),
        (event) => {
          pushLog(event)
          if (event.type === 'result' && event.refreshed) {
            toast.success(`Analysed ${event.refreshed.length} competitor(s).`)
            setCompetitors([emptyForm()])
            setStrategy(null)
            loadSnapshots()
          }
          if (event.type === 'error') {
            toast.error(event.message || 'Analysis failed.')
          }
        },
        () => resolve(),
      ).catch(err => {
        toast.error('Analysis failed. Check handles and try again.')
        console.error(err)
        resolve()
      })
    })

    setRefreshing(false)
  }

  async function handleDiscover() {
    setDiscovering(true)
    setDiscovered([])
    setLiveLog([])

    await new Promise<void>((resolve) => {
      api.seoIntel.discoverCompetitors(
        params.projectId,
        (event) => {
          pushLog(event)
          if (event.type === 'result' && event.competitors) {
            const found = event.competitors
            setDiscovered(found)
            if (found.length === 0) toast.info('No competitors found. Add them manually.')
          }
          if (event.type === 'error') {
            toast.error(event.message || 'Discovery failed.')
          }
        },
        () => resolve(),
      ).catch(err => {
        toast.error('Auto-discovery requires Exa/Tavily API keys.')
        console.error(err)
        resolve()
      })
    })

    setDiscovering(false)
  }

  async function handleGenerateStrategy() {
    setStrategyLoading(true)
    setStrategyError(null)
    setTab('strategy')
    try {
      const result = await api.intelligence.strategy(params.projectId)
      setStrategy(result)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      const userMsg = msg.includes('400')
        ? 'Run competitor analysis first - add at least one competitor and click Analyse.'
        : (msg.includes('500') || msg.includes('parse') || msg.includes('JSON'))
        ? 'The AI returned an unexpected response. Click Try Again - it usually succeeds on the second attempt.'
        : (msg.includes('fetch') || msg.includes('network') || msg.includes('timeout') || msg.includes('Failed'))
        ? 'Request timed out - the strategy takes 20-40 seconds. Please try again.'
        : 'Strategy generation failed. Please try again.'
      setStrategyError(userMsg)
      toast.error(userMsg)
    } finally {
      setStrategyLoading(false)
    }
  }

  async function handleOpenReport(snapshot: CompetitorSnapshot) {
    setReportSnapshot(snapshot)
    setReport(null)
    setReportLoading(true)
    try {
      const result = await api.intelligence.report(params.projectId, snapshot.name)
      setReport(result)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      const userMsg = (msg.includes('fetch') || msg.includes('network') || msg.includes('timeout') || msg.includes('Failed'))
        ? 'Report timed out - takes 15–30 seconds. Please try again.'
        : 'Could not generate report. Try again.'
      toast.error(userMsg)
      console.error(err)
    } finally {
      setReportLoading(false)
    }
  }

  async function addDiscoveredCompetitor(c: DiscoveredCompetitor) {
    const name = c.name || (() => { try { return new URL(c.url).hostname.replace('www.', '') } catch { return c.url } })()

    // Mark as saving - card stays visible in the discovery panel
    setSavingNames(prev => { const s = new Set(prev); s.add(c.name); return s })
    setRefreshing(true)
    setShowAddForm(false)
    setLiveLog([])

    await new Promise<void>((resolve) => {
      api.intelligence.addDiscovered(
        params.projectId,
        c,
        (event) => {
          pushLog(event)
          if (event.type === 'result' && event.refreshed) {
            toast.success(`${name} analysed and saved.`)
            setStrategy(null)
            loadSnapshots()
          }
          if (event.type === 'error') {
            toast.error(event.message || 'Analysis failed.')
          }
        },
        () => resolve(),
      ).catch(err => {
        toast.error(`Could not analyse ${name}. Try again.`)
        console.error(err)
        resolve()
      })
    })

    setSavingNames(prev => { const s = new Set(prev); s.delete(c.name); return s })
    setSavedNames(prev => { const s = new Set(prev); s.add(c.name); return s })
    setRefreshing(false)
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* ── Top bar ── */}
      <div className="flex items-center gap-3 px-3 sm:px-4 py-3 border-b border-border shrink-0">
        <SidebarToggle />
        <BackButton />
        <div className="flex items-center gap-2">
          <BarChart2 className="w-4 h-4 text-primary" />
          <span className="text-sm font-semibold">Competitors</span>
        </div>

        {/* Section tabs */}
        <div className="hidden sm:flex items-center gap-0.5 rounded-lg border border-border p-0.5 bg-muted/40 ml-2">
          <button className="px-3 py-1 rounded-md text-xs font-medium bg-background text-foreground shadow-sm">
            Analysis
          </button>
          <button
            onClick={() => router.push(`/projects/${params.projectId}/intelligence/profiles`)}
            className="px-3 py-1 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            Profiles
          </button>
          <button
            onClick={() => router.push(`/projects/${params.projectId}/intelligence/monitoring`)}
            className="px-3 py-1 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            Monitoring
          </button>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={handleDiscover}
            disabled={discovering}
            className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 text-xs border border-border rounded-md text-muted-foreground hover:text-foreground disabled:opacity-50 transition-colors"
          >
            {discovering ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
            {discovering ? 'Discovering…' : 'Auto-discover'}
          </button>
          {snapshots.length > 0 && (
            <button
              onClick={handleGenerateStrategy}
              disabled={strategyLoading}
              className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 text-xs border border-violet-500/30 text-violet-400 rounded-md hover:bg-violet-500/10 disabled:opacity-50 transition-colors"
            >
              {strategyLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              {strategyLoading ? 'Generating…' : 'Strategy Plan'}
            </button>
          )}
          <button
            onClick={() => setShowAddForm(!showAddForm)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Competitors
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">

        {/* ── Add competitor form ── */}
        {showAddForm && (
          <AddCompetitorForm
            competitors={competitors}
            setCompetitors={setCompetitors}
            onClose={() => setShowAddForm(false)}
            onSubmit={handleRefresh}
            refreshing={refreshing}
          />
        )}

        {/* ── Live log ── */}
        {(refreshing || discovering) && liveLog.length > 0 && (
          <LiveLogPanel log={liveLog} active={refreshing || discovering} />
        )}

        {/* ── Auto-discovered suggestions ── */}
        {discovered.length > 0 && (
          <DiscoveredBanner
            discovered={discovered}
            onSave={addDiscoveredCompetitor}
            onDismiss={() => { setDiscovered([]); setSavedNames(new Set()); setSavingNames(new Set()) }}
            savedNames={savedNames}
            savingNames={savingNames}
          />
        )}

        {/* ── Tabs ── */}
        {!refreshing && !loading && (
          <div className="flex items-center gap-1 px-4 sm:px-6 pt-4 pb-0 border-b border-border">
            {([
              { key: 'snapshots',   label: 'Competitor Profiles', icon: <BarChart2 className="w-3.5 h-3.5" /> },
              { key: 'strategy',    label: 'Strategy Plan',       icon: <Sparkles className="w-3.5 h-3.5" /> },
              { key: 'influencers', label: 'Influencers',         icon: <Users className="w-3.5 h-3.5" /> },
            ] as { key: Tab; label: string; icon: React.ReactNode }[]).map(t => (
              <button
                key={t.key}
                onClick={() => {
                  if (t.key === 'strategy' && !strategy && !strategyLoading && !strategyError) {
                    handleGenerateStrategy()
                  } else {
                    setTab(t.key)
                  }
                }}
                className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium border-b-2 transition-colors -mb-px ${
                  tab === t.key
                    ? 'border-primary text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                {t.icon}{t.label}
              </button>
            ))}
          </div>
        )}

        {/* ── Content ── */}
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : snapshots.length === 0 && !refreshing && tab !== 'influencers' ? (
          <EmptyState onAdd={() => setShowAddForm(true)} />
        ) : tab === 'snapshots' ? (
          <div className="px-4 sm:px-6 py-5 grid grid-cols-1 lg:grid-cols-2 gap-4 max-w-6xl">
            {snapshots.map(snapshot => (
              <CompetitorCard key={snapshot.id} snapshot={snapshot} onOpenReport={handleOpenReport} />
            ))}
          </div>
        ) : tab === 'influencers' ? (
          <InfluencersPanel projectId={params.projectId} />
        ) : (
          <StrategyPanel
            strategy={strategy}
            loading={strategyLoading}
            error={strategyError}
            onRegenerate={handleGenerateStrategy}
          />
        )}
      </div>

      {reportSnapshot && (
        <CompetitorReportPanel
          snapshot={reportSnapshot}
          report={report}
          loading={reportLoading}
          onClose={() => { setReportSnapshot(null); setReport(null) }}
          onRegenerate={() => handleOpenReport(reportSnapshot)}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Add Competitor Form
// ---------------------------------------------------------------------------

function AddCompetitorForm({
  competitors,
  setCompetitors,
  onClose,
  onSubmit,
  refreshing,
}: {
  competitors: CompetitorForm[]
  setCompetitors: React.Dispatch<React.SetStateAction<CompetitorForm[]>>
  onClose: () => void
  onSubmit: () => void
  refreshing: boolean
}) {
  function update(i: number, field: keyof CompetitorForm, val: string) {
    setCompetitors(prev => prev.map((c, idx) => idx === i ? { ...c, [field]: val } : c))
  }
  function remove(i: number) {
    setCompetitors(prev => prev.filter((_, j) => j !== i))
  }
  function addRow() {
    setCompetitors(prev => [...prev, emptyForm()])
  }

  return (
    <div className="border-b border-border bg-muted/20 p-4 sm:p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold">Add competitors to analyse</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Add handles and URLs for each platform you want tracked
          </p>
        </div>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="space-y-4">
        {competitors.map((comp, i) => (
          <div key={i} className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-center justify-between mb-3">
              <input
                value={comp.name}
                onChange={e => update(i, 'name', e.target.value)}
                placeholder="Competitor brand name *"
                className="text-sm font-medium bg-transparent focus:outline-none placeholder:text-muted-foreground/50 flex-1"
              />
              {competitors.length > 1 && (
                <button onClick={() => remove(i)} className="text-muted-foreground hover:text-destructive">
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {[
                { field: 'website',   icon: <Globe className="w-3 h-3" />,      placeholder: 'Website URL',        color: 'text-emerald-500' },
                { field: 'instagram', icon: <Instagram className="w-3 h-3" />,  placeholder: '@instagram_handle',  color: 'text-pink-500'    },
                { field: 'facebook',  icon: <Facebook className="w-3 h-3" />,   placeholder: 'Facebook page URL',  color: 'text-blue-500'    },
                { field: 'tiktok',    icon: <Activity className="w-3 h-3" />,   placeholder: 'TikTok profile URL', color: 'text-foreground'  },
                { field: 'linkedin',  icon: <Linkedin className="w-3 h-3" />,   placeholder: 'LinkedIn company URL', color: 'text-sky-500'   },
                { field: 'youtube',   icon: <Youtube className="w-3 h-3" />,    placeholder: 'YouTube channel URL', color: 'text-red-500'   },
              ].map(({ field, icon, placeholder, color }) => (
                <div key={field} className="flex items-center gap-1.5 bg-background border border-border rounded-lg px-2.5 py-1.5">
                  <span className={color}>{icon}</span>
                  <input
                    value={comp[field as keyof CompetitorForm]}
                    onChange={e => update(i, field as keyof CompetitorForm, e.target.value)}
                    placeholder={placeholder}
                    className="flex-1 text-xs bg-transparent focus:outline-none placeholder:text-muted-foreground/40 min-w-0"
                  />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3 mt-4">
        {competitors.length < 5 && (
          <button
            onClick={addRow}
            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
          >
            <Plus className="w-3 h-3" /> Add another competitor
          </button>
        )}
        <button
          onClick={onSubmit}
          disabled={refreshing}
          className="ml-auto flex items-center gap-1.5 px-5 py-2 text-xs font-semibold bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          {refreshing ? (
            <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Analysing…</>
          ) : (
            <><Zap className="w-3.5 h-3.5" /> Run Analysis</>
          )}
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Live Log Panel
// ---------------------------------------------------------------------------

const ICON_MAP: Record<string, React.ReactNode> = {
  search:   <Search className="w-3.5 h-3.5" />,
  globe:    <Globe className="w-3.5 h-3.5" />,
  brain:    <Sparkles className="w-3.5 h-3.5" />,
  check:    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />,
  warn:     <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />,
  done:     <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />,
  read:     <Globe className="w-3.5 h-3.5" />,
  instagram:<Instagram className="w-3.5 h-3.5 text-pink-400" />,
  facebook: <Facebook className="w-3.5 h-3.5 text-blue-400" />,
  linkedin: <Linkedin className="w-3.5 h-3.5 text-sky-400" />,
  youtube:  <Youtube className="w-3.5 h-3.5 text-red-400" />,
  video:    <Activity className="w-3.5 h-3.5" />,
  database: <BarChart2 className="w-3.5 h-3.5" />,
  map:      <Target className="w-3.5 h-3.5" />,
  zap:      <Zap className="w-3.5 h-3.5 text-primary" />,
  save:     <CheckCircle2 className="w-3.5 h-3.5" />,
  activity: <Activity className="w-3.5 h-3.5" />,
}

function LiveLogPanel({ log, active }: { log: LogEntry[]; active: boolean }) {
  const bottomRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [log.length])

  return (
    <div className="mx-4 sm:mx-6 my-4 rounded-2xl border border-border bg-[#0d0d0d] overflow-hidden">
      {/* Terminal header */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border/50 bg-muted/10">
        <div className="flex gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-red-500/70" />
          <span className="w-2.5 h-2.5 rounded-full bg-amber-500/70" />
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500/70" />
        </div>
        <span className="text-[10px] font-mono text-muted-foreground ml-1">leo - intelligence engine</span>
        {active && (
          <div className="ml-auto flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-[10px] text-emerald-400 font-mono">running</span>
          </div>
        )}
      </div>

      {/* Log lines */}
      <div className="px-4 py-3 space-y-1.5 max-h-72 overflow-y-auto font-mono text-xs">
        {log.map((entry, i) => (
          <div
            key={entry.id}
            className={`flex items-start gap-2.5 transition-all ${
              i === log.length - 1 ? 'opacity-100' : 'opacity-60'
            }`}
          >
            <span className={`shrink-0 mt-0.5 ${entry.icon === 'check' || entry.icon === 'done' ? 'text-emerald-400' : entry.icon === 'warn' ? 'text-amber-400' : 'text-muted-foreground'}`}>
              {ICON_MAP[entry.icon] ?? <Activity className="w-3.5 h-3.5" />}
            </span>
            <span className="flex-1 min-w-0">
              <span className={`${entry.icon === 'check' || entry.icon === 'done' ? 'text-foreground/90' : entry.icon === 'warn' ? 'text-amber-300' : 'text-foreground/70'}`}>
                {entry.message}
              </span>
              {entry.detail && (
                <span className="block text-[10px] text-muted-foreground/50 mt-0.5 truncate">
                  {entry.detail}
                </span>
              )}
            </span>
            <span className="text-[9px] text-muted-foreground/30 shrink-0 mt-0.5 tabular-nums">
              {new Date(entry.ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          </div>
        ))}
        {active && (
          <div className="flex items-center gap-2 text-muted-foreground/40">
            <span className="inline-block w-2 h-3.5 bg-muted-foreground/40 animate-pulse rounded-sm" />
          </div>
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Discovered Banner - filterable rich cards with per-card Save button
// ---------------------------------------------------------------------------

const RELEVANCE_LABEL = (score: number) => {
  if (score >= 0.85) return { label: 'Direct competitor', color: 'text-red-400 bg-red-400/10' }
  if (score >= 0.65) return { label: 'Strong competitor', color: 'text-amber-400 bg-amber-400/10' }
  return { label: 'Adjacent', color: 'text-blue-400 bg-blue-400/10' }
}

function DiscoveredBanner({
  discovered,
  onSave,
  onDismiss,
  savedNames,
  savingNames,
}: {
  discovered: DiscoveredCompetitor[]
  onSave: (c: DiscoveredCompetitor) => void
  onDismiss: () => void
  savedNames: Set<string>
  savingNames: Set<string>
}) {
  const [typeFilter, setTypeFilter] = useState<string | null>(null)
  const [geoFilter, setGeoFilter] = useState<string | null>(null)

  const types = Array.from(new Set(discovered.map(c => c.type).filter(Boolean))) as string[]
  const geos = Array.from(new Set(discovered.map(c => c.geography).filter(Boolean))) as string[]

  const filtered = discovered.filter(c => {
    if (typeFilter && c.type !== typeFilter) return false
    if (geoFilter && c.geography !== geoFilter) return false
    return true
  })

  const savedCount = discovered.filter(c => savedNames.has(c.name)).length

  return (
    <div className="mx-4 sm:mx-6 mt-4 rounded-2xl border border-border bg-muted/10 p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="text-sm font-semibold">
            {discovered.length} competitors discovered
            {savedCount > 0 && <span className="ml-2 text-emerald-400 text-xs font-normal">· {savedCount} saved</span>}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Sourced from Tavily · Exa · Claude AI - cached 24h
          </p>
        </div>
        <button onClick={onDismiss} className="text-muted-foreground hover:text-foreground p-1">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Filter chips */}
      {(types.length > 1 || geos.length > 1) && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          {types.map(t => (
            <button
              key={t}
              onClick={() => setTypeFilter(typeFilter === t ? null : t)}
              className={cn(
                'px-2.5 py-0.5 rounded-full text-[10px] font-medium border transition-colors capitalize',
                typeFilter === t
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-muted/50 text-muted-foreground border-border hover:text-foreground',
              )}
            >
              {t}
            </button>
          ))}
          {geos.map(g => (
            <button
              key={g}
              onClick={() => setGeoFilter(geoFilter === g ? null : g)}
              className={cn(
                'px-2.5 py-0.5 rounded-full text-[10px] font-medium border transition-colors',
                geoFilter === g
                  ? 'bg-violet-600 text-white border-violet-600'
                  : 'bg-muted/50 text-muted-foreground border-border hover:text-foreground',
              )}
            >
              {g}
            </button>
          ))}
          {(typeFilter || geoFilter) && (
            <button
              onClick={() => { setTypeFilter(null); setGeoFilter(null) }}
              className="px-2.5 py-0.5 rounded-full text-[10px] font-medium text-muted-foreground hover:text-foreground"
            >
              Clear
            </button>
          )}
        </div>
      )}

      {/* Cards grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {filtered.map((c, i) => {
          const rel = RELEVANCE_LABEL(c.relevance_score ?? 0.6)
          const isSaved = savedNames.has(c.name)
          const isSaving = savingNames.has(c.name)
          return (
            <div
              key={i}
              className={cn(
                'relative rounded-xl border bg-card p-4 flex flex-col gap-2 transition-all',
                isSaved ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-border',
              )}
            >
              {/* Top row */}
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  {c.logo_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={c.logo_url}
                      alt={c.name}
                      className="w-7 h-7 rounded-lg object-contain bg-white shrink-0"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                    />
                  ) : (
                    <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center text-primary font-bold text-xs shrink-0">
                      {c.name.charAt(0).toUpperCase()}
                    </div>
                  )}
                  <span className="text-sm font-semibold truncate">{c.name}</span>
                </div>
                <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full shrink-0 ${rel.color}`}>
                  {rel.label}
                </span>
              </div>

              {/* Segment badges */}
              {(c.type || (c.segments && c.segments.length > 0)) && (
                <div className="flex flex-wrap gap-1">
                  {c.type && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground capitalize">{c.type}</span>
                  )}
                  {c.segments?.map(s => (
                    <span key={s} className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400">{s}</span>
                  ))}
                  {c.geography && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-500/10 text-violet-400">{c.geography}</span>
                  )}
                </div>
              )}

              {/* Description */}
              {(c.what_they_do || c.description) && (
                <p className="text-xs text-foreground/70 line-clamp-2">
                  {c.what_they_do || c.description}
                </p>
              )}

              {/* Key advantage */}
              {c.key_advantage && (
                <p className="text-[10px] text-emerald-400 flex items-start gap-1">
                  <Sparkles className="w-3 h-3 shrink-0 mt-0.5" />
                  {c.key_advantage}
                </p>
              )}

              {/* Meta row */}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-auto pt-1 border-t border-border/50">
                {c.location && (
                  <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                    <MapPin className="w-2.5 h-2.5" />{c.location}
                  </span>
                )}
                {c.estimated_revenue_range && c.estimated_revenue_range !== 'unknown' && (
                  <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                    <DollarSign className="w-2.5 h-2.5" />{c.estimated_revenue_range}
                  </span>
                )}
                {c.employee_count && c.employee_count !== 'unknown' && (
                  <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                    <Building2 className="w-2.5 h-2.5" />{c.employee_count}
                  </span>
                )}
                {c.funding_stage && c.funding_stage !== 'unknown' && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground capitalize">
                    {c.funding_stage}
                  </span>
                )}
              </div>

              {/* Why competitor */}
              {c.why_competitor && (
                <p className="text-[10px] text-muted-foreground italic line-clamp-1">
                  {c.why_competitor}
                </p>
              )}

              {/* Save button */}
              <button
                onClick={() => !isSaved && !isSaving && onSave(c)}
                disabled={isSaved || isSaving}
                className={cn(
                  'mt-1 w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[11px] font-medium transition-all',
                  isSaved
                    ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 cursor-default'
                    : isSaving
                    ? 'bg-muted/50 text-muted-foreground border border-border cursor-wait'
                    : 'bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20',
                )}
              >
                {isSaved ? (
                  <><CheckCircle2 className="w-3 h-3" /> Saved</>
                ) : isSaving ? (
                  <><Loader2 className="w-3 h-3 animate-spin" /> Analysing…</>
                ) : (
                  <><Plus className="w-3 h-3" /> Save to profiles</>
                )}
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Empty State
// ---------------------------------------------------------------------------

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center h-96 text-center px-8">
      <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center mb-5">
        <BarChart2 className="w-8 h-8 text-muted-foreground/40" />
      </div>
      <h2 className="text-lg font-semibold mb-2">No competitor intelligence yet</h2>
      <p className="text-sm text-muted-foreground max-w-sm mb-6">
        Add your competitors&apos; social handles and LEO will analyse their content,
        identify their strategy, and surface opportunities they&apos;re missing.
      </p>
      <button
        onClick={onAdd}
        className="flex items-center gap-2 px-5 py-2.5 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
      >
        <Plus className="w-4 h-4" />
        Add your first competitor
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Competitor Card
// ---------------------------------------------------------------------------

const AVATAR_GRADIENTS = [
  'from-violet-500 to-purple-600',
  'from-blue-500 to-cyan-600',
  'from-emerald-500 to-teal-600',
  'from-rose-500 to-pink-600',
  'from-amber-500 to-orange-600',
]

function getGradient(name: string) {
  const code = name.charCodeAt(0) % AVATAR_GRADIENTS.length
  return AVATAR_GRADIENTS[code]
}

function CompetitorCard({ snapshot, onOpenReport }: { snapshot: CompetitorSnapshot; onOpenReport: (s: CompetitorSnapshot) => void }) {
  const [expanded, setExpanded] = useState(true)
  const { analysis, web_analysis } = snapshot
  const platforms = Object.keys(snapshot.platforms || {})
  const gradient = getGradient(snapshot.name)

  const scrapedDate = snapshot.scrapedAt
    ? new Date(snapshot.scrapedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
    : null

  // Determine a threat vibe from the web_analysis or analysis
  const threatLevel = (web_analysis as { threat_level?: string } | undefined)?.threat_level ?? 'medium'
  const threat = THREAT_CONFIG[threatLevel as keyof typeof THREAT_CONFIG] ?? THREAT_CONFIG.medium

  return (
    <div className="border border-border rounded-2xl bg-card overflow-hidden group transition-all hover:border-border/80 hover:shadow-lg hover:shadow-black/10">

      {/* ── Card header ── */}
      <div className="relative px-5 pt-5 pb-4">
        {/* Subtle gradient tint in top-right */}
        <div className={`absolute top-0 right-0 w-32 h-32 rounded-bl-[80px] bg-gradient-to-bl ${gradient} opacity-[0.06] pointer-events-none`} />

        <div className="flex items-start gap-3 relative">
          {/* Avatar */}
          <div className={`w-11 h-11 rounded-2xl bg-gradient-to-br ${gradient} flex items-center justify-center text-white font-bold text-base shrink-0 shadow-md`}>
            {snapshot.name.charAt(0).toUpperCase()}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-sm font-semibold leading-tight">{snapshot.name}</h3>
              <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border ${threat.bg} ${threat.color}`}>
                {threat.icon}{threat.label}
              </span>
            </div>

            {/* Platform badges */}
            <div className="flex items-center flex-wrap gap-1.5 mt-2">
              {platforms.map(p => (
                <span key={p} className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-medium ${PLATFORM_COLORS[p] ?? 'text-muted-foreground bg-muted'}`}>
                  {PLATFORM_ICONS[p]} {p}
                </span>
              ))}
              {scrapedDate && (
                <span className="text-[10px] text-muted-foreground ml-auto">Updated {scrapedDate}</span>
              )}
            </div>
          </div>

          {/* Collapse toggle */}
          <button
            onClick={() => setExpanded(!expanded)}
            className="p-1.5 rounded-lg hover:bg-muted/60 transition-colors text-muted-foreground hover:text-foreground shrink-0"
          >
            {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* ── Deep-dive CTA ── */}
      <div className="px-5 pb-4">
        <button
          onClick={() => onOpenReport(snapshot)}
          className={`w-full flex items-center justify-center gap-2 py-2.5 text-xs font-semibold rounded-xl bg-gradient-to-r ${gradient} text-white shadow-sm hover:opacity-90 transition-opacity`}
        >
          <BarChart2 className="w-3.5 h-3.5" />
          View Deep-Dive Report
        </button>
      </div>

      {/* ── Expanded body ── */}
      {expanded && (
        <div className="border-t border-border/60 px-5 pt-4 pb-5 space-y-4">

          {/* Market position - redesigned as intelligence brief */}
          {web_analysis?.market_position && (
            <div className="relative rounded-xl overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-r from-blue-500/8 to-violet-500/5 rounded-xl" />
              <div className="relative border border-blue-500/20 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-5 h-5 rounded-md bg-blue-500/15 flex items-center justify-center">
                    <Globe className="w-3 h-3 text-blue-400" />
                  </div>
                  <span className="text-[10px] font-bold uppercase tracking-widest text-blue-400">Market Position</span>
                </div>
                <p className="text-xs text-foreground/85 leading-relaxed">{web_analysis.market_position}</p>
                {web_analysis.opportunity && (
                  <div className="mt-3 flex items-start gap-2 pt-2.5 border-t border-blue-500/15">
                    <div className="w-4 h-4 rounded-full bg-emerald-500/15 flex items-center justify-center shrink-0 mt-0.5">
                      <ArrowRight className="w-2.5 h-2.5 text-emerald-400" />
                    </div>
                    <p className="text-xs text-emerald-400 leading-relaxed">{web_analysis.opportunity}</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {analysis && (
            <>
              {/* Voice + Themes row */}
              {(analysis.tone && analysis.tone !== 'Unknown') || (analysis.key_themes?.length ?? 0) > 0 ? (
                <div className="grid grid-cols-1 gap-3">
                  {analysis.tone && analysis.tone !== 'Unknown' && (
                    <div className="rounded-xl bg-muted/30 border border-border/60 px-4 py-3">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1.5">Brand Voice</p>
                      <p className="text-xs text-foreground/80 leading-relaxed">{analysis.tone}</p>
                    </div>
                  )}
                  {(analysis.key_themes?.length ?? 0) > 0 && (
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">Key Themes</p>
                      <div className="flex flex-wrap gap-1.5">
                        {analysis.key_themes.map((theme, i) => (
                          <span key={i} className="text-[10px] px-2.5 py-1 rounded-full bg-muted/60 border border-border/60 text-foreground/70 font-medium">
                            {theme}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : null}

              {/* Strengths vs Weaknesses */}
              {((analysis.strengths?.length ?? 0) > 0 || (analysis.weaknesses?.length ?? 0) > 0) && (
                <div className="grid grid-cols-2 gap-2.5">
                  {(analysis.strengths?.length ?? 0) > 0 && (
                    <div className="rounded-xl bg-emerald-500/5 border border-emerald-500/20 p-3.5">
                      <div className="flex items-center gap-1.5 mb-2.5">
                        <div className="w-4 h-4 rounded-full bg-emerald-500/20 flex items-center justify-center">
                          <TrendingUp className="w-2.5 h-2.5 text-emerald-500" />
                        </div>
                        <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-500">They Excel</p>
                      </div>
                      <ul className="space-y-1.5">
                        {analysis.strengths.slice(0, 4).map((s, i) => (
                          <li key={i} className="text-[11px] text-foreground/75 flex items-start gap-1.5">
                            <span className="w-1 h-1 rounded-full bg-emerald-500/60 shrink-0 mt-1.5" />
                            {s}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {(analysis.weaknesses?.length ?? 0) > 0 && (
                    <div className="rounded-xl bg-red-500/5 border border-red-500/20 p-3.5">
                      <div className="flex items-center gap-1.5 mb-2.5">
                        <div className="w-4 h-4 rounded-full bg-red-500/20 flex items-center justify-center">
                          <AlertTriangle className="w-2.5 h-2.5 text-red-500" />
                        </div>
                        <p className="text-[10px] font-bold uppercase tracking-widest text-red-500">Weaknesses</p>
                      </div>
                      <ul className="space-y-1.5">
                        {analysis.weaknesses.slice(0, 4).map((w, i) => (
                          <li key={i} className="text-[11px] text-foreground/75 flex items-start gap-1.5">
                            <span className="w-1 h-1 rounded-full bg-red-500/60 shrink-0 mt-1.5" />
                            {w}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              {/* Opportunities */}
              {(analysis.content_gaps?.length ?? 0) > 0 && (
                <div className="rounded-xl bg-amber-500/5 border border-amber-500/25 p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-5 h-5 rounded-md bg-amber-500/20 flex items-center justify-center">
                      <Lightbulb className="w-3 h-3 text-amber-500" />
                    </div>
                    <span className="text-[10px] font-bold uppercase tracking-widest text-amber-500">Gaps You Can Exploit</span>
                  </div>
                  <ul className="space-y-2">
                    {analysis.content_gaps.map((gap, i) => (
                      <li key={i} className="flex items-start gap-2.5">
                        <span className="w-4 h-4 rounded-full bg-amber-500/20 text-amber-500 text-[9px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                          {i + 1}
                        </span>
                        <span className="text-xs text-foreground/80 leading-relaxed">{gap}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Hashtags */}
              {(analysis.top_hashtags?.length ?? 0) > 0 && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">Their Top Hashtags</p>
                  <div className="flex flex-wrap gap-1">
                    {analysis.top_hashtags.slice(0, 12).map((tag, i) => (
                      <span key={i} className="text-[10px] px-2 py-0.5 rounded-lg bg-muted/60 border border-border/50 text-muted-foreground font-mono">
                        #{tag.replace(/^#/, '')}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Strategy Panel
// ---------------------------------------------------------------------------

function StrategyPanel({
  strategy,
  loading,
  error,
  onRegenerate,
}: {
  strategy: CompetitiveStrategy | null
  loading: boolean
  error: string | null
  onRegenerate: () => void
}) {
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <Loader2 className="w-7 h-7 animate-spin text-violet-400" />
        <p className="text-sm text-muted-foreground">Generating strategy plan…</p>
        <p className="text-xs text-muted-foreground/60">Analysing competitor data + running AI - takes 20–40 seconds</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="px-4 sm:px-6 py-10 flex flex-col items-center justify-center gap-4 text-center max-w-lg mx-auto">
        <div className="w-12 h-12 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center">
          <AlertTriangle className="w-6 h-6 text-red-500" />
        </div>
        <div>
          <h3 className="text-sm font-semibold mb-1">Strategy generation failed</h3>
          <p className="text-xs text-muted-foreground leading-relaxed">{error}</p>
        </div>
        <button
          onClick={onRegenerate}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" /> Try Again
        </button>
      </div>
    )
  }

  if (!strategy) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3 text-center">
        <Sparkles className="w-8 h-8 text-violet-400/50" />
        <p className="text-sm text-muted-foreground">Generate a detailed competitive strategy based on your competitor data.</p>
        <p className="text-xs text-muted-foreground/60">Takes 20–40 seconds to analyse all competitors</p>
        <button
          onClick={onRegenerate}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          <Sparkles className="w-3.5 h-3.5" /> Generate Strategy
        </button>
      </div>
    )
  }

  const EFFORT_COLOR: Record<string, string> = {
    low: 'text-emerald-500',
    medium: 'text-amber-500',
    high: 'text-red-500',
  }

  return (
    <div className="px-4 sm:px-6 py-5 space-y-5 max-w-5xl">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold">Competitive Strategy Plan</h2>
          <p className="text-xs text-muted-foreground mt-0.5">AI-generated from live competitor data</p>
        </div>
        <button
          onClick={onRegenerate}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-border rounded-lg text-muted-foreground hover:text-foreground transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" /> Regenerate
        </button>
      </div>

      {/* Market Snapshot */}
      {strategy.market_snapshot && (
        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="flex items-center gap-2 mb-3">
            <BarChart2 className="w-4 h-4 text-primary" />
            <h3 className="text-sm font-semibold">Market Snapshot</h3>
            {strategy.market_snapshot.market_maturity && (
              <span className="ml-auto text-[10px] font-semibold px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                {strategy.market_snapshot.market_maturity}
              </span>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
            <div className="rounded-xl bg-muted/40 border border-border px-3 py-2.5 text-center">
              <p className="text-[10px] text-muted-foreground uppercase tracking-widest mb-1">Competitors Analysed</p>
              <p className="text-lg font-bold">{strategy.market_snapshot.total_competitors}</p>
            </div>
            {(strategy.market_snapshot.top_channels?.length ?? 0) > 0 && (
              <div className="rounded-xl bg-muted/40 border border-border px-3 py-2.5">
                <p className="text-[10px] text-muted-foreground uppercase tracking-widest mb-1">Top Channels</p>
                <div className="flex flex-wrap gap-1">
                  {strategy.market_snapshot.top_channels.map((c, i) => (
                    <span key={i} className="text-[10px] bg-background px-1.5 py-0.5 rounded-md border border-border capitalize">{c}</span>
                  ))}
                </div>
              </div>
            )}
            {(strategy.market_snapshot.key_trends?.length ?? 0) > 0 && (
              <div className="rounded-xl bg-muted/40 border border-border px-3 py-2.5">
                <p className="text-[10px] text-muted-foreground uppercase tracking-widest mb-1">Key Trends</p>
                <ul className="space-y-0.5">
                  {strategy.market_snapshot.key_trends.slice(0, 3).map((t, i) => (
                    <li key={i} className="text-[10px] text-foreground/80 flex gap-1">
                      <TrendingUp className="w-2.5 h-2.5 text-primary shrink-0 mt-0.5" />{t}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          {(strategy.market_snapshot.data_points?.length ?? 0) > 0 && (
            <div className="rounded-xl bg-muted/20 border border-border px-3 py-2 space-y-1">
              {strategy.market_snapshot.data_points.map((dp, i) => (
                <p key={i} className="text-xs text-foreground/70 flex gap-1.5">
                  <Activity className="w-3 h-3 text-muted-foreground shrink-0 mt-0.5" />{dp}
                </p>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Executive Summary + Brand Position */}
      <div className="rounded-2xl border border-border bg-card p-5">
        <div className="flex items-center gap-2 mb-3">
          <Target className="w-4 h-4 text-primary" />
          <h3 className="text-sm font-semibold">Executive Summary</h3>
        </div>
        <p className="text-sm text-foreground/80 leading-relaxed">{strategy.executive_summary}</p>

        {strategy.brand_position?.differentiation && (
          <div className="mt-3 pt-3 border-t border-border">
            <p className="text-xs text-muted-foreground font-medium mb-1">Your differentiation</p>
            <p className="text-sm text-foreground/80">{strategy.brand_position.differentiation}</p>
          </div>
        )}

        <div className="grid grid-cols-2 gap-4 mt-4">
          {(strategy.brand_position?.strengths?.length ?? 0) > 0 && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-500 mb-2">Your Strengths</p>
              <ul className="space-y-1">
                {strategy.brand_position.strengths.map((s, i) => (
                  <li key={i} className="text-xs text-foreground/80 flex gap-1.5">
                    <CheckCircle2 className="w-3 h-3 text-emerald-500 shrink-0 mt-0.5" />{s}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {(strategy.brand_position?.vulnerabilities?.length ?? 0) > 0 && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-red-500 mb-2">Vulnerabilities</p>
              <ul className="space-y-1">
                {strategy.brand_position.vulnerabilities.map((v, i) => (
                  <li key={i} className="text-xs text-foreground/80 flex gap-1.5">
                    <AlertTriangle className="w-3 h-3 text-red-500 shrink-0 mt-0.5" />{v}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        {(strategy.brand_position?.evidence?.length ?? 0) > 0 && (
          <div className="mt-3 pt-3 border-t border-border">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1.5">Supporting Evidence</p>
            <ul className="space-y-1">
              {strategy.brand_position.evidence!.map((e, i) => (
                <li key={i} className="text-xs text-muted-foreground flex gap-1.5">
                  <ArrowRight className="w-3 h-3 shrink-0 mt-0.5" />{e}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Quick wins */}
      {(strategy.quick_wins?.length ?? 0) > 0 && (
        <div className="rounded-2xl border border-amber-500/25 bg-amber-500/5 p-5">
          <div className="flex items-center gap-2 mb-3">
            <Zap className="w-4 h-4 text-amber-500" />
            <h3 className="text-sm font-semibold text-amber-500">Quick Wins - Do This Week</h3>
          </div>
          <div className="space-y-3">
            {strategy.quick_wins.map((win, i) => {
              if (typeof win === 'string') {
                return (
                  <div key={i} className="flex items-start gap-2.5 text-sm text-foreground/80">
                    <span className="w-5 h-5 rounded-full bg-amber-500/20 text-amber-500 text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                      {i + 1}
                    </span>
                    {win}
                  </div>
                )
              }
              const w = win as { action: string; why_now: string; expected_result: string }
              return (
                <div key={i} className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3">
                  <div className="flex items-start gap-2.5 mb-2">
                    <span className="w-5 h-5 rounded-full bg-amber-500/20 text-amber-500 text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                      {i + 1}
                    </span>
                    <p className="text-sm font-medium text-foreground">{w.action}</p>
                  </div>
                  <div className="ml-7 space-y-1">
                    {w.why_now && (
                      <p className="text-xs text-amber-400/80 flex gap-1.5">
                        <Zap className="w-3 h-3 shrink-0 mt-0.5" /> {w.why_now}
                      </p>
                    )}
                    {w.expected_result && (
                      <p className="text-xs text-emerald-400 flex gap-1.5">
                        <TrendingUp className="w-3 h-3 shrink-0 mt-0.5" /> {w.expected_result}
                      </p>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Competitor breakdown */}
      {(strategy.competitor_breakdown?.length ?? 0) > 0 && (
        <div>
          <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3 flex items-center gap-2">
            <Swords className="w-3.5 h-3.5" /> Competitor Breakdown
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {strategy.competitor_breakdown.map((comp, i) => {
              const threat = THREAT_CONFIG[comp.threat_level] ?? THREAT_CONFIG.medium
              return (
                <div key={i} className={`rounded-xl border p-4 ${threat.bg}`}>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-lg bg-background/50 flex items-center justify-center text-xs font-bold">
                        {comp.name.charAt(0).toUpperCase()}
                      </div>
                      <span className="text-sm font-semibold">{comp.name}</span>
                    </div>
                    <span className={`flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-background/40 ${threat.color}`}>
                      {threat.icon} {threat.label}
                    </span>
                  </div>
                  {/* Data snapshot */}
                  {comp.data_snapshot && (
                    <div className="rounded-lg bg-background/30 px-3 py-2 mb-3">
                      {comp.data_snapshot.top_themes && comp.data_snapshot.top_themes.length > 0 && (
                        <div className="flex flex-wrap gap-1 mb-1.5">
                          {comp.data_snapshot.top_themes.slice(0, 4).map((t, j) => (
                            <span key={j} className="text-[9px] px-1.5 py-0.5 rounded-full bg-background/60 border border-border text-foreground/60">{t}</span>
                          ))}
                        </div>
                      )}
                      {comp.data_snapshot.followers && Object.keys(comp.data_snapshot.followers).length > 0 && (
                        <div className="flex gap-3 flex-wrap">
                          {Object.entries(comp.data_snapshot.followers).map(([plt, count]) => (
                            <span key={plt} className="text-[9px] text-muted-foreground">
                              <span className="capitalize">{plt}</span>: <span className="font-semibold text-foreground/70">{count >= 1000 ? `${(count / 1000).toFixed(1)}K` : count}</span>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  <div className="space-y-2.5 text-xs">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1">What they do better</p>
                      <p className="text-foreground/80">{comp.what_they_do_better}</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1">Their weakness</p>
                      <p className="text-foreground/80">{comp.their_weakness}</p>
                    </div>
                    <div className="pt-2 border-t border-border/40">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-500 mb-1">How to beat them</p>
                      <p className="text-foreground/80">{comp.how_to_beat_them}</p>
                    </div>
                    {(comp.key_evidence?.length ?? 0) > 0 && (
                      <div className="pt-1">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1">Evidence</p>
                        <ul className="space-y-0.5">
                          {comp.key_evidence!.map((ev, j) => (
                            <li key={j} className="text-[10px] text-muted-foreground flex gap-1">
                              <ArrowRight className="w-2.5 h-2.5 shrink-0 mt-0.5" />{ev}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Channel Strategy */}
      {strategy.channel_strategy && Object.keys(strategy.channel_strategy).length > 0 && (
        <div>
          <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3 flex items-center gap-2">
            <Globe className="w-3.5 h-3.5" /> Channel Strategy
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {Object.entries(strategy.channel_strategy).map(([platform, cfg]) => {
              const priorityColor =
                cfg.priority === 'primary' ? 'text-emerald-500 bg-emerald-500/10' :
                cfg.priority === 'secondary' ? 'text-amber-500 bg-amber-500/10' :
                'text-muted-foreground bg-muted'
              const PlatIcon = PLATFORM_ICONS[platform.toLowerCase()] ?? <Globe className="w-3.5 h-3.5" />
              return (
                <div key={platform} className="rounded-xl border border-border bg-card p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className={cn('w-7 h-7 rounded-lg flex items-center justify-center', PLATFORM_COLORS[platform.toLowerCase()] ?? 'text-foreground bg-muted')}>
                        {PlatIcon}
                      </span>
                      <span className="text-sm font-semibold capitalize">{platform}</span>
                    </div>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full capitalize ${priorityColor}`}>
                      {cfg.priority}
                    </span>
                  </div>
                  <p className="text-xs text-foreground/70 mb-2">{cfg.rationale}</p>
                  {cfg.posting_frequency && (
                    <p className="text-[10px] text-muted-foreground mb-2">
                      <span className="font-semibold text-foreground/60">Frequency:</span> {cfg.posting_frequency}
                    </p>
                  )}
                  {(cfg.recommended_formats?.length ?? 0) > 0 && (
                    <div className="flex flex-wrap gap-1 mb-2">
                      {cfg.recommended_formats.map((f, j) => (
                        <span key={j} className="text-[9px] px-1.5 py-0.5 rounded-full bg-muted border border-border text-foreground/60">{f}</span>
                      ))}
                    </div>
                  )}
                  {(cfg.content_angles?.length ?? 0) > 0 && (
                    <ul className="space-y-0.5">
                      {cfg.content_angles.slice(0, 3).map((a, j) => (
                        <li key={j} className="text-[10px] text-muted-foreground flex gap-1">
                          <ArrowRight className="w-2.5 h-2.5 shrink-0 mt-0.5" />{a}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Content Strategy */}
      {strategy.content_strategy && (
        <div>
          <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3 flex items-center gap-2">
            <Sparkles className="w-3.5 h-3.5" /> Content Strategy
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
            {(strategy.content_strategy.themes_to_own?.length ?? 0) > 0 && (
              <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
                <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-500 mb-2">Themes to Own</p>
                <ul className="space-y-1">
                  {strategy.content_strategy.themes_to_own.map((t, i) => (
                    <li key={i} className="text-xs text-foreground/80 flex gap-1.5">
                      <CheckCircle2 className="w-3 h-3 text-emerald-500 shrink-0 mt-0.5" />{t}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {(strategy.content_strategy.themes_to_attack?.length ?? 0) > 0 && (
              <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
                <p className="text-[10px] font-bold uppercase tracking-widest text-amber-500 mb-2">Themes to Attack</p>
                <ul className="space-y-1">
                  {strategy.content_strategy.themes_to_attack.map((t, i) => (
                    <li key={i} className="text-xs text-foreground/80 flex gap-1.5">
                      <Swords className="w-3 h-3 text-amber-500 shrink-0 mt-0.5" />{t}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          {(strategy.content_strategy.formats?.length ?? 0) > 0 && (
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">Recommended Formats</p>
              <div className="space-y-2">
                {strategy.content_strategy.formats.map((f, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-muted border border-border shrink-0 capitalize">{f.format}</span>
                    <div className="min-w-0">
                      <span className="text-[10px] text-muted-foreground capitalize mr-1">{f.platform} -</span>
                      <span className="text-xs text-foreground/80">{f.rationale}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Battlegrounds */}
      {(strategy.battlegrounds?.length ?? 0) > 0 && (
        <div>
          <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3 flex items-center gap-2">
            <Activity className="w-3.5 h-3.5" /> Content Battlegrounds
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {strategy.battlegrounds.map((b, i) => {
              const pos = POSITION_CONFIG[b.our_position] ?? POSITION_CONFIG.competitive
              return (
                <div key={i} className="rounded-xl border border-border bg-card p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium">{b.area}</span>
                    <span className={`flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full ${pos.bg} ${pos.color}`}>
                      {pos.icon} {pos.label}
                    </span>
                  </div>
                  <p className="text-xs text-foreground/70">{b.recommendation}</p>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Action Plan */}
      {(strategy.action_plan?.length ?? 0) > 0 && (
        <div>
          <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3 flex items-center gap-2">
            <Target className="w-3.5 h-3.5" /> Action Plan
          </h3>
          <div className="space-y-2">
            {strategy.action_plan.map((action, i) => {
              const p = PRIORITY_CONFIG[action.priority] ?? PRIORITY_CONFIG.short_term
              return (
                <div key={i} className={`rounded-xl border ${p.border} bg-card p-4`}>
                  <div className="flex items-start gap-3">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 mt-0.5 ${p.bg} ${p.color}`}>
                      {p.label}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground">{action.action}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{action.rationale}</p>
                      <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                        {action.expected_impact && (
                          <p className="text-xs text-emerald-500 flex items-center gap-1">
                            <TrendingUp className="w-3 h-3" /> {action.expected_impact}
                          </p>
                        )}
                        {action.timeframe && (
                          <p className="text-xs text-muted-foreground flex items-center gap-1">
                            <Activity className="w-3 h-3" /> {action.timeframe}
                          </p>
                        )}
                        {action.effort && (
                          <p className={`text-xs flex items-center gap-1 ${EFFORT_COLOR[action.effort] ?? ''}`}>
                            <Zap className="w-3 h-3" /> {action.effort} effort
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Data Sources */}
      {(strategy.data_sources?.length ?? 0) > 0 && (
        <div className="rounded-xl border border-border bg-muted/20 p-4">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2 flex items-center gap-1.5">
            <ExternalLink className="w-3 h-3" /> Data Sources
          </p>
          <div className="space-y-1">
            {strategy.data_sources!.map((src, i) => (
              <p key={i} className="text-[10px] text-muted-foreground truncate">
                {src.startsWith('http') ? (
                  <a href={src} target="_blank" rel="noopener noreferrer" className="hover:text-primary transition-colors">
                    {src}
                  </a>
                ) : src}
              </p>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Influencers Panel
// ---------------------------------------------------------------------------

const PLATFORMS_INF = ['Instagram', 'TikTok', 'YouTube', 'LinkedIn', 'X']
const AUDIENCE_SIZES = [
  { value: 'micro', label: 'Micro', desc: '1k–100k' },
  { value: 'macro', label: 'Macro', desc: '100k–1M' },
  { value: 'mega',  label: 'Mega',  desc: '1M+' },
]

function InfluencersPanel({ projectId }: { projectId: string }) {
  const [topic, setTopic]         = useState('')
  const [platform, setPlatform]   = useState('Instagram')
  const [size, setSize]           = useState('micro')
  const [location, setLocation]   = useState('')
  const [loading, setLoading]     = useState(false)
  const [results, setResults]     = useState<DiscoveredInfluencer[]>([])
  const [searched, setSearched]   = useState(false)

  async function handleDiscover() {
    if (!topic.trim()) { toast.error('Enter a topic or niche first.'); return }
    setLoading(true)
    setResults([])
    setSearched(false)
    try {
      const data = await api.seoIntel.discoverInfluencers(
        projectId,
        topic.trim(),
        platform,
        size,
        location.trim() || undefined,
      )
      setResults(data.influencers)
      setSearched(true)
    } catch (err) {
      console.error(err)
      toast.error('Influencer discovery failed.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="px-4 sm:px-6 py-5 max-w-3xl">
      {/* Search form */}
      <div className="border border-border rounded-xl bg-card p-4 space-y-4 mb-5">
        <div>
          <label className="block text-xs font-medium mb-1.5">Topic / Niche *</label>
          <input
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleDiscover()}
            placeholder="e.g. sustainable fashion, B2B SaaS, fitness coaching"
            className="w-full text-sm bg-background border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        <div>
          <label className="block text-xs font-medium mb-1.5">Platform</label>
          <div className="flex gap-1.5 flex-wrap">
            {PLATFORMS_INF.map((p) => (
              <button
                key={p}
                onClick={() => setPlatform(p)}
                className={cn(
                  'px-2.5 py-1 rounded-md text-xs font-medium border transition-colors',
                  platform === p
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'border-border text-muted-foreground hover:text-foreground hover:bg-muted',
                )}
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium mb-1.5">Audience Size</label>
            <div className="flex gap-1.5">
              {AUDIENCE_SIZES.map((s) => (
                <button
                  key={s.value}
                  onClick={() => setSize(s.value)}
                  className={cn(
                    'flex-1 flex flex-col items-center px-2 py-1.5 rounded-lg text-[10px] font-medium border transition-colors',
                    size === s.value
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'border-border text-muted-foreground hover:text-foreground hover:bg-muted',
                  )}
                >
                  <span className="font-semibold text-xs">{s.label}</span>
                  <span className="opacity-70">{s.desc}</span>
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1.5">Location <span className="text-muted-foreground">(optional)</span></label>
            <input
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="e.g. United States, London"
              className="w-full text-sm bg-background border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
        </div>

        <button
          onClick={handleDiscover}
          disabled={loading || !topic.trim()}
          className="w-full flex items-center justify-center gap-2 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Users className="w-4 h-4" />}
          {loading ? 'Discovering influencers…' : 'Discover Influencers'}
        </button>
      </div>

      {/* Results */}
      {searched && results.length === 0 && (
        <div className="text-center py-12 text-sm text-muted-foreground">
          No influencers found for this topic and platform. Try a different niche or platform.
        </div>
      )}

      {results.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
            {results.length} Influencers Found
          </p>
          {results.map((inf, i) => (
            <div key={i} className="border border-border rounded-xl bg-card p-4 space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold">{inf.name}</p>
                    {inf.platform && (
                      <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded capitalize">{inf.platform}</span>
                    )}
                  </div>
                  {inf.handle && (
                    <p className="text-xs text-muted-foreground">{inf.handle}</p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {inf.alignment_score != null && (
                    <div className="flex items-center gap-1 text-xs">
                      <Star className="w-3 h-3 text-amber-400" />
                      <span className="font-semibold">{inf.alignment_score}%</span>
                      <span className="text-muted-foreground">match</span>
                    </div>
                  )}
                  {inf.url && (
                    <a
                      href={inf.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  )}
                </div>
              </div>

              {inf.followers && (
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{inf.followers}</span> followers
                </p>
              )}

              {inf.bio && (
                <p className="text-xs text-muted-foreground line-clamp-2">{inf.bio}</p>
              )}

              {inf.content_themes && inf.content_themes.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {inf.content_themes.map((theme, j) => (
                    <span key={j} className="text-[10px] bg-muted px-2 py-0.5 rounded-full text-muted-foreground">
                      {theme}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
