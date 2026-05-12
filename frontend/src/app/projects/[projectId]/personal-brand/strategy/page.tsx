'use client'

import { useEffect, useRef, useState } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import {
  Loader2, Sparkles, RefreshCw, ChevronRight, Search, ShieldCheck, Map, BarChart2,
} from 'lucide-react'
import { api } from '@/lib/api'
import { useAppStore } from '@/stores/app-store'
import { cn } from '@/lib/utils'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface NicheVoice {
  name: string
  platform: string
  whatTheyPost: string
  gapTheyLeave: string
}

interface PlatformPlan {
  platform: string
  focusLevel: 'primary' | 'secondary' | 'passive'
  postsPerWeek: number
  contentTypes: string[]
  reasoning: string
}

interface ReputationResult {
  googleResults: Array<{ title: string; url: string; snippet: string }>
  mentions: Array<{ text: string; source: string; sentiment: 'positive' | 'neutral' | 'negative' }>
  checkedAt: string
}

type TabKey = 'platform' | 'niche' | 'audit' | 'roadmap' | 'reputation'

// ---------------------------------------------------------------------------
// Tab component
// ---------------------------------------------------------------------------

function Tab({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap',
        active
          ? 'border-primary text-primary'
          : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border',
      )}
    >
      {label}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Platform Plan Tab
// ---------------------------------------------------------------------------

interface StrategyData {
  platforms?: PlatformPlan[]
  allocation?: Record<string, number>
  platformAllocation?: Record<string, { percentage?: number; focusLevel?: string; postsPerWeek?: number; contentMix?: string[] }>
  contentStrategy?: Array<{ pillar: string; angle: string; formats: string[]; frequency: string; sampleTopics: string[] }>
  roadmap?: Record<string, { focus: string; metrics: string[]; experiments: string[]; milestones: string[] }>
  quickWins?: string[]
  differentiationStatement?: string
}

function PlatformPlanTab({ projectId }: { projectId: string }) {
  const [generating, setGenerating] = useState(false)
  const [strategy, setStrategy] = useState<StrategyData | null>(null)
  const [steps, setSteps] = useState<string[]>([])
  const ctrlRef = useRef<AbortController | null>(null)

  useEffect(() => {
    // Try to load saved strategy
    api.persona.getStrategy(projectId).then((s) => setStrategy(s as unknown as StrategyData)).catch(() => {})
  }, [projectId])

  function handleGenerate() {
    setGenerating(true)
    setSteps([])
    ctrlRef.current = new AbortController()
    api.persona.streamStrategy(
      projectId,
      {
        onStep: (label) => setSteps((p) => [...p, label]),
        onDone: (s) => { setStrategy(s as unknown as StrategyData); setGenerating(false) },
        onError: () => setGenerating(false),
      },
      ctrlRef.current.signal,
    )
  }

  const platforms: PlatformPlan[] = strategy?.platforms ?? []
  const allocation: Record<string, number> = strategy?.allocation ?? {}

  if (!strategy && !generating) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center">
          <Map className="w-7 h-7 text-primary" />
        </div>
        <div className="text-center max-w-xs">
          <h3 className="text-base font-semibold text-foreground">Generate your platform plan</h3>
          <p className="text-sm text-muted-foreground mt-1">
            LEO analyses your Personal Core and goals to build a precise platform allocation strategy.
          </p>
        </div>
        <button
          onClick={handleGenerate}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          <Sparkles className="w-4 h-4" />
          Generate my platform plan
        </button>
      </div>
    )
  }

  if (generating) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
        <div className="space-y-2 text-center">
          {steps.map((s, i) => (
            <p key={i} className="text-sm text-muted-foreground">{s}</p>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-foreground">Platform Allocation</h2>
        <button onClick={handleGenerate} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground border border-border rounded-lg px-3 py-1.5 hover:bg-muted transition-colors">
          <RefreshCw className="w-3.5 h-3.5" /> Regenerate
        </button>
      </div>

      {/* Allocation summary */}
      {Object.keys(allocation).length > 0 && (
        <div className="flex gap-2 flex-wrap">
          {Object.entries(allocation).map(([platform, pct]) => (
            <div key={platform} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary/10 text-primary text-xs font-medium capitalize">
              {platform}: {pct}%
            </div>
          ))}
        </div>
      )}

      {/* Per-platform cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {platforms.map((p) => (
          <div key={p.platform} className="rounded-xl border border-border bg-card p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-7 h-7 rounded-lg bg-muted flex items-center justify-center text-xs font-bold uppercase text-muted-foreground">
                  {p.platform[0]}
                </span>
                <span className="text-sm font-semibold text-foreground capitalize">{p.platform}</span>
              </div>
              <span className={cn(
                'text-[10px] font-medium px-2 py-0.5 rounded-full capitalize',
                p.focusLevel === 'primary' ? 'bg-primary/10 text-primary' :
                p.focusLevel === 'secondary' ? 'bg-amber-500/10 text-amber-600' :
                'bg-muted text-muted-foreground',
              )}>
                {p.focusLevel} · {p.postsPerWeek}×/wk
              </span>
            </div>
            {p.contentTypes?.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {p.contentTypes.map((t) => (
                  <span key={t} className="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground">{t}</span>
                ))}
              </div>
            )}
            {p.reasoning && <p className="text-xs text-muted-foreground">{p.reasoning}</p>}
          </div>
        ))}
      </div>

      {/* Growth Roadmap section (if included in strategy) */}
      {strategy?.roadmap && (() => {
        const roadmap = strategy.roadmap!
        return (
        <div className="space-y-4">
          <h2 className="text-base font-semibold text-foreground">Growth Roadmap</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {['months_1_3', 'months_4_6', 'months_7_12'].map((key, i) => {
              const phase = roadmap[key]
              if (!phase) return null
              return (
                <div key={key} className="rounded-xl border border-border bg-card p-4 space-y-3">
                  <p className="text-xs font-semibold text-primary uppercase tracking-wide">
                    {['Month 1–3', 'Month 4–6', 'Month 7–12'][i]}
                  </p>
                  <p className="text-sm font-medium text-foreground">{phase.focus}</p>
                  {phase.metrics?.length > 0 && (
                    <ul className="space-y-1">
                      {phase.metrics.map((m: string) => (
                        <li key={m} className="text-xs text-muted-foreground flex items-center gap-1.5">
                          <ChevronRight className="w-3 h-3 text-primary shrink-0" />{m}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )
            })}
          </div>
        </div>
        )
      })()}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Niche Research Tab
// ---------------------------------------------------------------------------

function NicheResearchTab({ projectId }: { projectId: string }) {
  const [researching, setResearching] = useState(false)
  const [result, setResult] = useState<Record<string, unknown> | null>(null)
  const [steps, setSteps] = useState<string[]>([])
  const ctrlRef = useRef<AbortController | null>(null)

  function handleResearch() {
    setResearching(true)
    setSteps([])
    ctrlRef.current = new AbortController()
    api.persona.streamNicheResearch(
      projectId,
      {
        onStep: (label) => setSteps((p) => [...p, label]),
        onDone: (r) => { setResult(r); setResearching(false) },
        onError: () => setResearching(false),
      },
      ctrlRef.current.signal,
    )
  }

  if (!result && !researching) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center">
          <Search className="w-7 h-7 text-primary" />
        </div>
        <div className="text-center max-w-xs">
          <h3 className="text-base font-semibold text-foreground">Research your niche</h3>
          <p className="text-sm text-muted-foreground mt-1">
            LEO finds the top voices in your space and identifies the gaps they&apos;re leaving open.
          </p>
        </div>
        <button
          onClick={handleResearch}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          <Sparkles className="w-4 h-4" />
          Run niche research
        </button>
      </div>
    )
  }

  if (researching) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
        <div className="space-y-2 text-center">
          {steps.map((s, i) => <p key={i} className="text-sm text-muted-foreground">{s}</p>)}
        </div>
      </div>
    )
  }

  const voices: NicheVoice[] = (result?.voices as NicheVoice[]) ?? []
  const contentGaps: string[] = (result?.contentGaps as string[]) ?? []

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-foreground">Top Voices in Your Niche</h2>
        <button onClick={handleResearch} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground border border-border rounded-lg px-3 py-1.5 hover:bg-muted transition-colors">
          <RefreshCw className="w-3.5 h-3.5" /> Re-run
        </button>
      </div>

      {voices.length > 0 && (
        <div className="divide-y divide-border/50 rounded-xl border border-border bg-card overflow-hidden">
          {voices.map((v, i) => (
            <div key={i} className="px-4 py-3 space-y-1">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-foreground">{v.name}</p>
                <span className="text-[10px] text-muted-foreground capitalize">{v.platform}</span>
              </div>
              <p className="text-xs text-muted-foreground">{v.whatTheyPost}</p>
              {v.gapTheyLeave && (
                <p className="text-xs text-amber-600 flex items-center gap-1">
                  <span className="font-medium">Gap:</span> {v.gapTheyLeave}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {contentGaps.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-foreground">Content Gaps You Can Own</h3>
          <div className="space-y-2">
            {contentGaps.map((gap, i) => (
              <div key={i} className="flex items-start gap-3 p-3 rounded-xl bg-primary/5 border border-primary/10">
                <span className="w-5 h-5 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center shrink-0">{i + 1}</span>
                <p className="text-sm text-foreground">{gap}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Profile Audit Tab
// ---------------------------------------------------------------------------

function ProfileAuditTab() {
  const [auditing, setAuditing] = useState(false)

  async function handleAudit() {
    setAuditing(true)
    try {
      // Profile audit endpoint will be added in a future phase
    } finally {
      setAuditing(false)
    }
  }

  return (
    <div className="flex flex-col items-center justify-center py-20 gap-4">
      <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center">
        <BarChart2 className="w-7 h-7 text-primary" />
      </div>
      <div className="text-center max-w-xs">
        <h3 className="text-base font-semibold text-foreground">Profile Optimisation Audit</h3>
        <p className="text-sm text-muted-foreground mt-1">
          LEO audits every connected profile - headline, bio, about section - and gives specific rewrite suggestions.
        </p>
      </div>
      <button
        onClick={handleAudit}
        disabled={auditing}
        className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
      >
        {auditing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
        {auditing ? 'Auditing profiles…' : 'Run profile audit'}
      </button>
      <p className="text-xs text-muted-foreground">Connect your LinkedIn and social profiles in project settings first.</p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Reputation Tab
// ---------------------------------------------------------------------------

function ReputationTab({ projectId }: { projectId: string }) {
  const [checking, setChecking] = useState(false)
  const [result, setResult] = useState<ReputationResult | null>(null)

  async function handleCheck() {
    setChecking(true)
    try {
      const res = await api.persona.checkReputation(projectId) as unknown as ReputationResult
      setResult(res)
    } finally {
      setChecking(false)
    }
  }

  useEffect(() => {
    api.persona.getReputation(projectId).then((r) => setResult(r as unknown as ReputationResult)).catch(() => {})
  }, [projectId])

  if (!result && !checking) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center">
          <ShieldCheck className="w-7 h-7 text-primary" />
        </div>
        <div className="text-center max-w-xs">
          <h3 className="text-base font-semibold text-foreground">Monitor your reputation</h3>
          <p className="text-sm text-muted-foreground mt-1">
            See what appears when people Google your name, and track web and social mentions.
          </p>
        </div>
        <button
          onClick={handleCheck}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          <Sparkles className="w-4 h-4" />
          Run reputation check
        </button>
      </div>
    )
  }

  if (checking) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Searching the web for your name…</p>
      </div>
    )
  }

  const sentimentColor = (s: string) =>
    s === 'positive' ? 'text-green-600 bg-green-500/10' :
    s === 'negative' ? 'text-red-500 bg-red-500/10' :
    'text-muted-foreground bg-muted'

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-foreground">Google Presence</h2>
        <button onClick={handleCheck} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground border border-border rounded-lg px-3 py-1.5 hover:bg-muted transition-colors">
          <RefreshCw className="w-3.5 h-3.5" /> Re-check
        </button>
      </div>

      {result?.googleResults && result.googleResults.length > 0 && (
        <div className="divide-y divide-border/50 rounded-xl border border-border bg-card overflow-hidden">
          {result.googleResults.slice(0, 6).map((r, i) => (
            <div key={i} className="px-4 py-3 space-y-0.5">
              <a href={r.url} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-primary hover:underline">{r.title}</a>
              <p className="text-[11px] text-muted-foreground">{r.url}</p>
              {r.snippet && <p className="text-xs text-muted-foreground mt-0.5">{r.snippet}</p>}
            </div>
          ))}
        </div>
      )}

      {result?.mentions && result.mentions.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-foreground">Recent Mentions</h3>
          <div className="space-y-2">
            {result.mentions.map((m, i) => (
              <div key={i} className="flex items-start gap-3 p-3 rounded-xl border border-border bg-card">
                <span className={cn('text-[10px] font-medium px-2 py-0.5 rounded-full shrink-0 capitalize mt-0.5', sentimentColor(m.sentiment))}>
                  {m.sentiment}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-muted-foreground capitalize">{m.source}</p>
                  <p className="text-sm text-foreground mt-0.5">{m.text}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

const TABS: { key: TabKey; label: string }[] = [
  { key: 'platform', label: 'Platform Plan' },
  { key: 'niche', label: 'Niche Research' },
  { key: 'audit', label: 'Profile Audit' },
  { key: 'roadmap', label: 'Growth Roadmap' },
  { key: 'reputation', label: 'Reputation' },
]

export default function PersonalBrandStrategyPage() {
  const params = useParams<{ projectId: string }>()
  const searchParams = useSearchParams()
  const { personalCore, setPersonalCore } = useAppStore()
  const [core, setCore] = useState<{ fullName?: string } | null>(personalCore)
  const [activeTab, setActiveTab] = useState<TabKey>(() => {
    const tab = searchParams.get('tab') as TabKey | null
    return TABS.some((t) => t.key === tab) ? tab! : 'platform'
  })

  useEffect(() => {
    if (personalCore) { setCore(personalCore); return }
    api.persona.getCore(params.projectId).then((c) => { setCore(c); setPersonalCore(c) }).catch(console.error)
  }, [params.projectId, personalCore, setPersonalCore])

  return (
    <div className="flex flex-col h-full overflow-hidden bg-background">
      {/* Header */}
      <div className="shrink-0 border-b border-border px-6 py-4">
        <h1 className="text-lg font-bold text-foreground">Personal Brand Strategy</h1>
        {core?.fullName && <p className="text-sm text-muted-foreground mt-0.5">{core.fullName}</p>}
      </div>

      {/* Tabs */}
      <div className="shrink-0 border-b border-border px-6 flex gap-0 overflow-x-auto">
        {TABS.map((t) => (
          <Tab key={t.key} label={t.label} active={activeTab === t.key} onClick={() => setActiveTab(t.key)} />
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="max-w-4xl mx-auto">
          {activeTab === 'platform' && <PlatformPlanTab projectId={params.projectId} />}
          {activeTab === 'niche' && <NicheResearchTab projectId={params.projectId} />}
          {activeTab === 'audit' && <ProfileAuditTab />}
          {activeTab === 'roadmap' && <PlatformPlanTab projectId={params.projectId} />}
          {activeTab === 'reputation' && <ReputationTab projectId={params.projectId} />}
        </div>
      </div>
    </div>
  )
}
