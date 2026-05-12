'use client'

import { useState, useRef } from 'react'
import { useParams } from 'next/navigation'
import { useRouter } from 'next/navigation'
import { FileText, ChevronLeft, Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import { SSEFeaturePage } from '@/components/pillar1/SSEFeaturePage'
import { api } from '@/lib/api'
import { usePillar4Store } from '@/stores/pillar4-store'
import type { ProgressStep } from '@/types'
import { cn } from '@/lib/utils'

const PLATFORMS = [
  { id: 'google_search', label: 'Google Search' },
  { id: 'google_display', label: 'Google Display' },
  { id: 'meta_feed', label: 'Meta Feed' },
  { id: 'meta_stories', label: 'Meta Stories' },
  { id: 'tiktok', label: 'TikTok' },
  { id: 'linkedin', label: 'LinkedIn' },
]

const OBJECTIVES = [
  { id: 'awareness', label: 'Brand Awareness' },
  { id: 'traffic', label: 'Traffic' },
  { id: 'leads', label: 'Lead Generation' },
  { id: 'sales', label: 'Sales / Conversions' },
  { id: 'app_installs', label: 'App Installs' },
]

interface AdBriefPayload {
  campaign_name: string
  objective: string
  executive_summary: string
  target_audience: {
    primary: string
    demographics: string
    psychographics: string
    pain_points: string[]
    buying_intent_signals: string[]
  }
  budget_allocation: { platform: string; percentage: number; daily_budget: string; rationale: string }[]
  platform_strategy: {
    platform: string
    campaign_type: string
    bidding_strategy: string
    targeting_approach: string
    creative_formats: string[]
    key_metrics: string[]
    expected_cpc_range: string
    expected_ctr_range: string
  }[]
  creative_requirements: {
    key_messages: string[]
    tone_and_style: string
    headline_angles: string[]
    image_specs_summary: string
    video_specs_summary: string
  }
  tracking_setup: { task: string; platform: string; priority: string }[]
  kpis: { metric: string; target: string; rationale: string }[]
  launch_checklist: string[]
  timeline: string
}

export default function AdBriefPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const router = useRouter()
  const store = usePillar4Store()

  const [campaignName, setCampaignName] = useState('')
  const [objective, setObjective] = useState('leads')
  const [targetAudience, setTargetAudience] = useState('')
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>(['google_search', 'meta_feed'])
  const [dailyBudget, setDailyBudget] = useState('')
  const [timeline, setTimeline] = useState('30 days')
  const [productName, setProductName] = useState('')
  const [usps, setUsps] = useState<string[]>([''])
  const [landingPageUrl, setLandingPageUrl] = useState('')
  const [result, setResult] = useState<AdBriefPayload | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  function togglePlatform(id: string) {
    setSelectedPlatforms((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]
    )
  }

  function addUsp() { if (usps.length < 5) setUsps([...usps, '']) }
  function removeUsp(i: number) { setUsps(usps.filter((_, idx) => idx !== i)) }
  function updateUsp(i: number, val: string) {
    const next = [...usps]; next[i] = val; setUsps(next)
  }

  async function generate() {
    if (!campaignName.trim()) { toast.error('Enter a campaign name'); return }
    if (!productName.trim()) { toast.error('Enter a product name'); return }
    if (!targetAudience.trim()) { toast.error('Describe your target audience'); return }
    if (!dailyBudget.trim()) { toast.error('Enter your budget'); return }
    if (selectedPlatforms.length === 0) { toast.error('Select at least one platform'); return }

    abortRef.current?.abort()
    abortRef.current = new AbortController()
    store.setIsStreaming(true)
    store.clearSteps()
    store.clearStreamText()
    setResult(null)

    try {
      await api.pillar4.streamAdBrief(
        projectId,
        {
          campaign_name: campaignName.trim(),
          objective,
          target_audience: targetAudience.trim(),
          platforms: selectedPlatforms,
          daily_budget: dailyBudget.trim(),
          timeline,
          product_name: productName.trim(),
          unique_selling_points: usps.filter(Boolean),
          landing_page_url: landingPageUrl.trim() || undefined,
        },
        {
          onStep: (step, label, status) => store.upsertStep(step, label, status as ProgressStep['status']),
          onDelta: (text) => store.appendStreamText(text),
          onSaved: (_id, payload) => {
            setResult(payload as unknown as AdBriefPayload)
            store.clearStreamText()
            store.setIsStreaming(false)
            toast.success('Ad brief ready!')
          },
          onError: (msg) => { toast.error(msg); store.setIsStreaming(false) },
          onDone: () => store.setIsStreaming(false),
        },
        abortRef.current.signal,
      )
    } catch { store.setIsStreaming(false) }
  }

  const canSubmit = !!campaignName.trim() && !!productName.trim() && !!targetAudience.trim() && !!dailyBudget.trim() && selectedPlatforms.length > 0

  const form = (
    <>
      <h2 className="font-semibold text-sm">Paid Ad Campaign Brief Generator</h2>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Campaign Name *</label>
          <input value={campaignName} onChange={(e) => setCampaignName(e.target.value)}
            placeholder="e.g. Q3 Lead Gen Push"
            className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Product / Service *</label>
          <input value={productName} onChange={(e) => setProductName(e.target.value)}
            placeholder="e.g. LEO Marketing Co-pilot"
            className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
        </div>
      </div>

      <div>
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Objective *</label>
        <div className="mt-1 flex flex-wrap gap-2">
          {OBJECTIVES.map((o) => (
            <button key={o.id} onClick={() => setObjective(o.id)}
              className={cn(
                'px-3 py-1.5 text-xs rounded-lg border transition-colors',
                objective === o.id
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-background border-border hover:border-primary/50',
              )}>
              {o.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Target Audience *</label>
        <textarea value={targetAudience} onChange={(e) => setTargetAudience(e.target.value)}
          rows={2} placeholder="e.g. B2B marketing managers at 10-200 person SaaS companies, aged 28-45, spending 5+ hrs/week on content"
          className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary resize-none" />
      </div>

      <div>
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Platforms *</label>
        <div className="mt-1 flex flex-wrap gap-2">
          {PLATFORMS.map((p) => (
            <button key={p.id} onClick={() => togglePlatform(p.id)}
              className={cn(
                'px-3 py-1.5 text-xs rounded-lg border transition-colors',
                selectedPlatforms.includes(p.id)
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-background border-border hover:border-primary/50',
              )}>
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Budget *</label>
          <input value={dailyBudget} onChange={(e) => setDailyBudget(e.target.value)}
            placeholder="e.g. $100/day or $3,000/month"
            className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Timeline</label>
          <select value={timeline} onChange={(e) => setTimeline(e.target.value)}
            className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary">
            {['14 days', '30 days', '60 days', '90 days', '6 months'].map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Unique Selling Points</label>
          {usps.length < 5 && (
            <button onClick={addUsp} className="flex items-center gap-1 text-xs text-primary hover:text-primary/80">
              <Plus className="w-3 h-3" /> Add
            </button>
          )}
        </div>
        <div className="space-y-2">
          {usps.map((usp, i) => (
            <div key={i} className="flex gap-2">
              <input value={usp} onChange={(e) => updateUsp(i, e.target.value)}
                placeholder={`USP ${i + 1} - e.g. Saves 10 hours/week`}
                className="flex-1 px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
              {usps.length > 1 && (
                <button onClick={() => removeUsp(i)} className="text-muted-foreground hover:text-destructive transition-colors">
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      <div>
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Landing Page URL</label>
        <input value={landingPageUrl} onChange={(e) => setLandingPageUrl(e.target.value)}
          placeholder="https://yoursite.com/landing-page"
          className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
      </div>
    </>
  )

  const resultNode = result ? (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-sm">{result.campaign_name}</h2>
        <span className="text-xs capitalize bg-primary/10 text-primary px-2 py-0.5 rounded-full">{result.objective}</span>
      </div>

      {result.executive_summary && (
        <div className="p-4 rounded-xl border border-border bg-card">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Executive Summary</p>
          <p className="text-sm">{result.executive_summary}</p>
        </div>
      )}

      {result.target_audience && (
        <div className="p-4 rounded-xl border border-border bg-card space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Target Audience</p>
          <p className="text-sm font-medium">{result.target_audience.primary}</p>
          <div className="grid grid-cols-2 gap-3 text-xs text-muted-foreground">
            <div>
              <p className="font-medium text-foreground mb-1">Demographics</p>
              <p>{result.target_audience.demographics}</p>
            </div>
            <div>
              <p className="font-medium text-foreground mb-1">Psychographics</p>
              <p>{result.target_audience.psychographics}</p>
            </div>
          </div>
          {result.target_audience.pain_points?.length > 0 && (
            <div>
              <p className="text-xs font-medium mb-1">Pain Points</p>
              <div className="flex flex-wrap gap-1">
                {result.target_audience.pain_points.map((p, i) => (
                  <span key={i} className="text-[10px] px-2 py-0.5 bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 rounded-full">{p}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {result.budget_allocation?.length > 0 && (
        <div className="p-4 rounded-xl border border-border bg-card space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Budget Allocation</p>
          {result.budget_allocation.map((b, i) => (
            <div key={i} className="flex items-center gap-3">
              <div className="flex-1">
                <div className="flex justify-between text-xs mb-0.5">
                  <span className="font-medium capitalize">{b.platform.replace(/_/g, ' ')}</span>
                  <span className="text-muted-foreground">{b.percentage}% · {b.daily_budget}</span>
                </div>
                <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                  <div className="h-full bg-primary rounded-full" style={{ width: `${b.percentage}%` }} />
                </div>
                <p className="text-[10px] text-muted-foreground mt-0.5">{b.rationale}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {result.platform_strategy?.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Platform Strategy</p>
          {result.platform_strategy.map((p, i) => (
            <div key={i} className="p-4 rounded-xl border border-border bg-card space-y-2">
              <p className="text-sm font-semibold capitalize">{p.platform.replace(/_/g, ' ')}</p>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div><span className="text-muted-foreground">Campaign Type: </span>{p.campaign_type}</div>
                <div><span className="text-muted-foreground">Bidding: </span>{p.bidding_strategy}</div>
                <div><span className="text-muted-foreground">Expected CPC: </span>{p.expected_cpc_range}</div>
                <div><span className="text-muted-foreground">Expected CTR: </span>{p.expected_ctr_range}</div>
              </div>
              <p className="text-xs text-muted-foreground">{p.targeting_approach}</p>
              {p.creative_formats?.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {p.creative_formats.map((f, j) => (
                    <span key={j} className="text-[10px] px-2 py-0.5 bg-muted rounded-full">{f}</span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {result.creative_requirements && (
        <div className="p-4 rounded-xl border border-border bg-card space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Creative Requirements</p>
          <p className="text-xs text-muted-foreground">{result.creative_requirements.tone_and_style}</p>
          {result.creative_requirements.key_messages?.length > 0 && (
            <div>
              <p className="text-xs font-medium mb-1">Key Messages</p>
              <ul className="space-y-0.5">
                {result.creative_requirements.key_messages.map((m, i) => (
                  <li key={i} className="text-xs text-muted-foreground flex gap-1.5"><span className="text-primary">•</span>{m}</li>
                ))}
              </ul>
            </div>
          )}
          {result.creative_requirements.headline_angles?.length > 0 && (
            <div>
              <p className="text-xs font-medium mb-1">Headline Angles</p>
              <div className="flex flex-wrap gap-1">
                {result.creative_requirements.headline_angles.map((a, i) => (
                  <span key={i} className="text-[10px] px-2 py-0.5 bg-primary/10 text-primary rounded-full">{a}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {result.kpis?.length > 0 && (
        <div className="p-4 rounded-xl border border-border bg-card space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">KPIs</p>
          {result.kpis.map((k, i) => (
            <div key={i} className="flex items-start gap-2 text-xs">
              <span className="font-medium shrink-0">{k.metric}:</span>
              <span className="text-primary font-semibold shrink-0">{k.target}</span>
              <span className="text-muted-foreground">{k.rationale}</span>
            </div>
          ))}
        </div>
      )}

      {result.launch_checklist?.length > 0 && (
        <div className="p-4 rounded-xl border border-border bg-card space-y-1">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Launch Checklist</p>
          {result.launch_checklist.map((item, i) => (
            <div key={i} className="flex items-center gap-2 text-xs">
              <div className="w-3.5 h-3.5 rounded border border-border shrink-0" />
              <span>{item}</span>
            </div>
          ))}
        </div>
      )}

      {result.tracking_setup?.length > 0 && (
        <div className="p-4 rounded-xl border border-border bg-card space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Tracking Setup</p>
          {result.tracking_setup.map((t, i) => (
            <div key={i} className="flex items-center gap-2 text-xs">
              <span className={cn(
                'px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0',
                t.priority === 'high' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                : t.priority === 'medium' ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
                : 'bg-muted text-muted-foreground',
              )}>{t.priority}</span>
              <span>{t.task}</span>
              <span className="text-muted-foreground ml-auto shrink-0">{t.platform}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  ) : null

  return (
    <SSEFeaturePage
      projectId={projectId}
      title="Campaign Brief Generator"
      subtitle="Pillar 4 - Claude"
      icon={<FileText className="w-4 h-4" />}
      credits={15}
      steps={store.steps}
      isStreaming={store.isStreaming}
      streamText={store.streamText}
      form={form}
      result={resultNode}
      onSubmit={generate}
      submitLabel="Generate Brief - 15 credits"
      canSubmit={canSubmit}
      backPath={`/projects/${projectId}/paid-ads`}
    />
  )
}
