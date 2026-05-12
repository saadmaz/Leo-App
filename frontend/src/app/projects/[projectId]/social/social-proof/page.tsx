'use client'

import { useState, useRef } from 'react'
import { useParams } from 'next/navigation'
import { Star, Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import { SSEFeaturePage } from '@/components/pillar1/SSEFeaturePage'
import { api } from '@/lib/api'
import { usePillar6Store } from '@/stores/pillar6-store'
import type { ProgressStep } from '@/types'
import { cn } from '@/lib/utils'

const PLATFORMS = ['twitter', 'instagram', 'linkedin', 'facebook', 'tiktok', 'reddit', 'youtube', 'threads']
const GOALS = ['testimonials', 'ugc', 'sentiment', 'case_study_leads']

interface SocialProofPayload {
  brand_name: string
  harvest_goal: string
  keywords_searched: string[]
  harvest_summary: string
  sentiment_overview: { positive_pct: number; neutral_pct: number; negative_pct: number; dominant_theme: string }
  top_testimonials: { rank: number; author: string; platform: string; quote: string; why_it_works: string; best_use: string; permission_needed: boolean }[]
  ugc_highlights: { type: string; description: string; platform: string; suggested_action: string }[]
  case_study_leads: { author: string; company_hint: string | null; outcome_mentioned: string; outreach_angle: string }[]
  negative_patterns: { issue: string; frequency: string; response_recommendation: string }[]
  social_proof_gaps: string[]
  quick_wins: string[]
}

function CopyBtn({ text }: { text: string }) {
  const [c, setC] = useState(false)
  return (
    <button onClick={() => { navigator.clipboard.writeText(text); setC(true); setTimeout(() => setC(false), 1500) }}
      className="text-[10px] px-2 py-0.5 rounded border border-border hover:border-primary/50 hover:text-primary transition-colors text-muted-foreground shrink-0">
      {c ? 'Copied!' : 'Copy'}
    </button>
  )
}

export default function SocialProofPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const store = usePillar6Store()

  const [brandName, setBrandName] = useState('')
  const [keywords, setKeywords] = useState<string[]>([''])
  const [platforms, setPlatforms] = useState<string[]>(['twitter', 'instagram', 'linkedin'])
  const [goal, setGoal] = useState('testimonials')
  const [rawMentions, setRawMentions] = useState('')
  const [result, setResult] = useState<SocialProofPayload | null>(null)
  const [activeTab, setActiveTab] = useState<'testimonials' | 'ugc' | 'leads' | 'gaps'>('testimonials')
  const abortRef = useRef<AbortController | null>(null)

  function togglePlatform(p: string) {
    setPlatforms((prev) => prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p])
  }
  function addKeyword() { if (keywords.length < 10) setKeywords([...keywords, '']) }
  function removeKeyword(i: number) { setKeywords(keywords.filter((_, idx) => idx !== i)) }
  function updateKeyword(i: number, v: string) { const next = [...keywords]; next[i] = v; setKeywords(next) }

  async function generate() {
    if (!brandName.trim()) { toast.error('Enter your brand name'); return }
    const validKeywords = keywords.filter((k) => k.trim())
    if (validKeywords.length === 0) { toast.error('Add at least one keyword'); return }
    if (platforms.length === 0) { toast.error('Select at least one platform'); return }

    abortRef.current?.abort(); abortRef.current = new AbortController()
    store.setIsStreaming(true); store.clearSteps(); store.clearStreamText(); setResult(null)

    const mentions = rawMentions.split('\n').map((s) => s.trim()).filter(Boolean)

    try {
      await api.pillar6.streamSocialProof(projectId,
        { brand_name: brandName.trim(), keywords: validKeywords, platforms, harvest_goal: goal,
          ...(mentions.length > 0 && { raw_mentions: mentions }) },
        {
          onStep: (s, l, st) => store.upsertStep(s, l, st as ProgressStep['status']),
          onDelta: (t) => store.appendStreamText(t),
          onSaved: (_, p) => { setResult(p as unknown as SocialProofPayload); store.clearStreamText(); store.setIsStreaming(false); toast.success('Social proof harvested!') },
          onError: (m) => { toast.error(m); store.setIsStreaming(false) },
          onDone: () => store.setIsStreaming(false),
        }, abortRef.current.signal)
    } catch { store.setIsStreaming(false) }
  }

  const form = (
    <>
      <h2 className="font-semibold text-sm">Social Proof Harvesting</h2>
      <div>
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Brand Name *</label>
        <input value={brandName} onChange={(e) => setBrandName(e.target.value)} placeholder="e.g. LEO"
          className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
      </div>

      <div>
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Harvest Goal *</label>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {GOALS.map((g) => (
            <button key={g} onClick={() => setGoal(g)}
              className={cn('px-2.5 py-1 text-xs rounded-lg border transition-colors',
                goal === g ? 'bg-primary text-primary-foreground border-primary' : 'bg-background border-border hover:border-primary/50')}>
              {g.replace(/_/g, ' ')}
            </button>
          ))}
        </div>
        <p className="text-[10px] text-muted-foreground mt-1">
          {goal === 'testimonials' && 'Find the best quotes to use in marketing materials'}
          {goal === 'ugc' && 'Surface user-generated content moments worth repurposing'}
          {goal === 'sentiment' && 'Understand overall brand sentiment across platforms'}
          {goal === 'case_study_leads' && 'Identify customers who mentioned specific outcomes'}
        </p>
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Search Keywords *</label>
          {keywords.length < 10 && (
            <button onClick={addKeyword} className="flex items-center gap-1 text-xs text-primary hover:text-primary/80"><Plus className="w-3 h-3" /> Add</button>
          )}
        </div>
        <div className="space-y-2">
          {keywords.map((kw, i) => (
            <div key={i} className="flex gap-2">
              <input value={kw} onChange={(e) => updateKeyword(i, e.target.value)} placeholder={`e.g. "${brandName || 'your brand'}" or @handle or #campaign`}
                className="flex-1 px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
              {keywords.length > 1 && (
                <button onClick={() => removeKeyword(i)} className="text-muted-foreground hover:text-destructive transition-colors"><X className="w-4 h-4" /></button>
              )}
            </div>
          ))}
        </div>
      </div>

      <div>
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Platforms *</label>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {PLATFORMS.map((p) => (
            <button key={p} onClick={() => togglePlatform(p)}
              className={cn('px-2.5 py-1 text-xs rounded-lg border capitalize transition-colors',
                platforms.includes(p) ? 'bg-primary text-primary-foreground border-primary' : 'bg-background border-border hover:border-primary/50')}>
              {p}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Paste Raw Mentions (optional)</label>
        <textarea value={rawMentions} onChange={(e) => setRawMentions(e.target.value)} rows={4}
          placeholder={"One mention per line - paste comments, tweets, or reviews you've already collected\ne.g. \"@YourBrand saved us 5 hours a week. Worth every penny. - @customer\""}
          className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary resize-none" />
        <p className="text-[10px] text-muted-foreground mt-1">Claude will also search the web via Tavily if TAVILY_API_KEY is configured.</p>
      </div>
    </>
  )

  const resultNode = result ? (
    <div className="space-y-4">
      <p className="text-sm">{result.harvest_summary}</p>

      {result.sentiment_overview && (
        <div className="p-4 rounded-xl border border-border bg-card">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Sentiment Overview</p>
          <div className="flex h-3 rounded-full overflow-hidden mb-2">
            <div className="bg-green-500 transition-all" style={{ width: `${result.sentiment_overview.positive_pct}%` }} title={`${result.sentiment_overview.positive_pct}% positive`} />
            <div className="bg-yellow-400 transition-all" style={{ width: `${result.sentiment_overview.neutral_pct}%` }} title={`${result.sentiment_overview.neutral_pct}% neutral`} />
            <div className="bg-red-500 transition-all" style={{ width: `${result.sentiment_overview.negative_pct}%` }} title={`${result.sentiment_overview.negative_pct}% negative`} />
          </div>
          <div className="flex items-center gap-4 text-[10px] text-muted-foreground mb-2">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500 inline-block" /> {result.sentiment_overview.positive_pct}% positive</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-yellow-400 inline-block" /> {result.sentiment_overview.neutral_pct}% neutral</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500 inline-block" /> {result.sentiment_overview.negative_pct}% negative</span>
          </div>
          <p className="text-xs text-muted-foreground">Dominant theme: <span className="font-medium text-foreground">{result.sentiment_overview.dominant_theme}</span></p>
        </div>
      )}

      <div className="flex gap-2 border-b border-border pb-2 flex-wrap">
        {(['testimonials', 'ugc', 'leads', 'gaps'] as const).map((tab) => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className={cn('text-xs px-3 py-1.5 rounded-lg capitalize transition-colors',
              activeTab === tab ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}>
            {tab === 'testimonials' ? 'Testimonials' : tab === 'ugc' ? 'UGC' : tab === 'leads' ? 'Case Study Leads' : 'Gaps & Wins'}
          </button>
        ))}
      </div>

      {activeTab === 'testimonials' && (
        <div className="space-y-3">
          {result.top_testimonials?.map((t, i) => (
            <div key={i} className="p-4 rounded-xl border border-border bg-card space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-5 h-5 rounded bg-primary/10 text-primary text-[10px] font-bold flex items-center justify-center">#{t.rank}</span>
                  <span className="text-xs text-muted-foreground capitalize">{t.platform}</span>
                  {t.permission_needed && (
                    <span className="text-[10px] px-1.5 py-0.5 bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400 rounded">Permission needed</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-muted-foreground">{t.best_use}</span>
                  <CopyBtn text={t.quote} />
                </div>
              </div>
              <p className="text-sm font-medium italic">"{t.quote}"</p>
              {t.author !== 'Anonymous' && <p className="text-[10px] text-muted-foreground">- {t.author}</p>}
              <p className="text-[10px] text-muted-foreground">{t.why_it_works}</p>
            </div>
          ))}
        </div>
      )}

      {activeTab === 'ugc' && (
        <div className="space-y-3">
          {result.ugc_highlights?.length > 0 ? result.ugc_highlights.map((u, i) => (
            <div key={i} className="p-4 rounded-xl border border-border bg-card space-y-1">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[10px] px-1.5 py-0.5 bg-muted text-muted-foreground rounded font-medium capitalize">{u.type.replace(/_/g, ' ')}</span>
                <span className="text-[10px] text-muted-foreground capitalize">{u.platform}</span>
              </div>
              <p className="text-xs">{u.description}</p>
              <p className="text-[10px] text-primary font-medium">Action: {u.suggested_action}</p>
            </div>
          )) : <p className="text-xs text-muted-foreground">No UGC highlights found in this batch.</p>}

          {result.negative_patterns?.length > 0 && (
            <div className="mt-4 space-y-2">
              <p className="text-xs font-semibold text-red-600 dark:text-red-400 uppercase tracking-wide">Negative Patterns</p>
              {result.negative_patterns.map((n, i) => (
                <div key={i} className="p-3 rounded-xl border border-red-200/50 bg-red-50/50 dark:bg-red-900/10 dark:border-red-900/30 space-y-1">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-medium">{n.issue}</p>
                    <span className="text-[10px] text-muted-foreground">{n.frequency}</span>
                  </div>
                  <p className="text-[10px] text-muted-foreground">{n.response_recommendation}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'leads' && (
        <div className="space-y-3">
          {result.case_study_leads?.length > 0 ? result.case_study_leads.map((l, i) => (
            <div key={i} className="p-4 rounded-xl border border-border bg-card space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium">{l.author}</p>
                {l.company_hint && <span className="text-[10px] text-muted-foreground">{l.company_hint}</span>}
              </div>
              <p className="text-xs text-muted-foreground"><span className="font-medium text-foreground">Outcome: </span>{l.outcome_mentioned}</p>
              <div className="p-2 rounded-lg bg-primary/5 border border-primary/20">
                <p className="text-[10px] font-semibold text-primary mb-0.5">Outreach angle</p>
                <p className="text-xs">{l.outreach_angle}</p>
              </div>
            </div>
          )) : <p className="text-xs text-muted-foreground">No case study leads identified in this batch.</p>}
        </div>
      )}

      {activeTab === 'gaps' && (
        <div className="space-y-4">
          {result.social_proof_gaps?.length > 0 && (
            <div className="p-4 rounded-xl border border-border bg-card space-y-1">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Social Proof Gaps</p>
              {result.social_proof_gaps.map((g, i) => <p key={i} className="text-xs text-muted-foreground">• {g}</p>)}
            </div>
          )}
          {result.quick_wins?.length > 0 && (
            <div className="p-4 rounded-xl border border-primary/20 bg-primary/5 space-y-1">
              <p className="text-xs font-semibold text-primary uppercase tracking-wide mb-1">Quick Wins</p>
              {result.quick_wins.map((w, i) => <p key={i} className="text-xs text-muted-foreground">• {w}</p>)}
            </div>
          )}
        </div>
      )}
    </div>
  ) : null

  const canSubmit = !!brandName.trim() && keywords.some((k) => k.trim()) && platforms.length > 0

  return (
    <SSEFeaturePage projectId={projectId} title="Social Proof Harvesting" subtitle="Pillar 6 - Claude + Tavily"
      icon={<Star className="w-4 h-4" />} credits={15} steps={store.steps}
      isStreaming={store.isStreaming} streamText={store.streamText} form={form} result={resultNode}
      onSubmit={generate} submitLabel="Harvest Social Proof - 15 credits" canSubmit={canSubmit}
      backPath={`/projects/${projectId}/social`} />
  )
}
