'use client'

import { useState, useRef } from 'react'
import { useParams } from 'next/navigation'
import { Search } from 'lucide-react'
import { toast } from 'sonner'
import { SSEFeaturePage } from '@/components/pillar1/SSEFeaturePage'
import { api } from '@/lib/api'
import { usePillar2Store } from '@/stores/pillar2-store'
import type { ContentGapPayload, ProgressStep } from '@/types'
import { cn } from '@/lib/utils'

const OPPORTUNITY_COLORS = ['bg-green-500', 'bg-lime-500', 'bg-yellow-500', 'bg-orange-500', 'bg-red-500']

export default function ContentGapPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const store = usePillar2Store()
  const [domain, setDomain] = useState('')
  const [competitorDomains, setCompetitorDomains] = useState('')
  const [result, setResult] = useState<ContentGapPayload | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  async function generate() {
    if (!domain.trim()) { toast.error('Your domain is required'); return }
    abortRef.current?.abort()
    abortRef.current = new AbortController()
    store.setIsStreaming(true)
    store.clearSteps()
    store.clearStreamText()
    setResult(null)
    const compList = competitorDomains.split(',').map((s) => s.trim()).filter(Boolean)
    try {
      await api.pillar2.streamContentGap(projectId,
        { domain: domain.trim(), competitor_domains: compList },
        {
          onStep: (step, label, status) => store.upsertStep(step, label, status as ProgressStep['status']),
          onDelta: (text) => store.appendStreamText(text),
          onSaved: (_id, payload) => { setResult(payload as unknown as ContentGapPayload); store.clearStreamText(); store.setIsStreaming(false); toast.success('Gap analysis ready!') },
          onError: (msg) => { toast.error(msg); store.setIsStreaming(false) },
          onDone: () => store.setIsStreaming(false),
        },
        abortRef.current.signal,
      )
    } catch { store.setIsStreaming(false) }
  }

  const form = (
    <>
      <h2 className="font-semibold text-sm">Content Gap Analysis</h2>
      <div>
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Your Domain *</label>
        <input value={domain} onChange={(e) => setDomain(e.target.value)}
          placeholder="e.g. leoagent.online (no https://)"
          className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
      </div>
      <div>
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Competitor Domains (optional, comma-separated)</label>
        <input value={competitorDomains} onChange={(e) => setCompetitorDomains(e.target.value)}
          placeholder="e.g. hubspot.com, mailchimp.com, buffer.com"
          className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
      </div>
      <p className="text-xs text-muted-foreground">Requires DataForSEO credentials for live keyword data. Falls back to Claude-only analysis if not configured.</p>
    </>
  )

  const resultNode = result ? (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-sm">Content Gap Report - {result.domain}</h2>
        <div className="flex gap-2 text-xs">
          {result.dataforseo_used && <span className="bg-blue-500/10 text-blue-600 px-2 py-0.5 rounded-full">DataForSEO</span>}
          <span className="bg-muted text-muted-foreground px-2 py-0.5 rounded-full">{result.keywords_analysed} keywords</span>
        </div>
      </div>

      <div className="p-4 rounded-xl border border-border bg-card">
        <p className="text-sm text-muted-foreground">{result.summary}</p>
      </div>

      {result.gaps?.map((gap, i) => (
        <div key={i} className="p-4 rounded-xl border border-border bg-card space-y-2">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="font-medium text-sm">{gap.keyword}</p>
              <p className="text-xs text-muted-foreground">{gap.content_type} · {gap.estimated_traffic_potential} potential</p>
            </div>
            <div className="text-right shrink-0">
              <div className="flex items-center gap-1 justify-end">
                <div className={cn('w-2 h-2 rounded-full', OPPORTUNITY_COLORS[Math.floor((10 - gap.opportunity_score) / 2)] || 'bg-muted')} />
                <span className="text-xs font-semibold">{gap.opportunity_score}/10</span>
              </div>
              <p className="text-xs text-muted-foreground">{gap.difficulty}</p>
            </div>
          </div>
          <p className="text-xs bg-primary/10 text-primary px-3 py-1.5 rounded-lg">{gap.content_angle}</p>
          {gap.search_volume && gap.search_volume !== 'Unknown' && (
            <p className="text-xs text-muted-foreground">{gap.search_volume} monthly searches</p>
          )}
        </div>
      ))}

      {result.quick_wins?.length > 0 && (
        <div className="p-4 rounded-xl border border-green-200 bg-green-50 dark:bg-green-950/20">
          <p className="text-xs font-semibold text-green-700 uppercase tracking-wide mb-2">Quick Wins</p>
          {result.quick_wins.map((w, i) => <p key={i} className="text-xs text-green-700">→ {w}</p>)}
        </div>
      )}

      {result.long_term_plays?.length > 0 && (
        <div className="p-4 rounded-xl border border-blue-200 bg-blue-50 dark:bg-blue-950/20">
          <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide mb-2">Long-Term Plays</p>
          {result.long_term_plays.map((p, i) => <p key={i} className="text-xs text-blue-700">→ {p}</p>)}
        </div>
      )}

      {result.content_calendar_suggestion && (
        <div className="p-4 rounded-xl border border-border bg-card">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">90-Day Plan</p>
          <p className="text-sm text-muted-foreground">{result.content_calendar_suggestion}</p>
        </div>
      )}
    </div>
  ) : null

  return (
    <SSEFeaturePage projectId={projectId} title="Content Gap Analysis" subtitle="DataForSEO + Claude"
      icon={<Search className="w-4 h-4" />} credits={40} steps={store.steps}
      isStreaming={store.isStreaming} streamText={store.streamText} form={form} result={resultNode}
      onSubmit={generate} submitLabel="Analyse Gaps - 40 credits" canSubmit={!!domain.trim()} />
  )
}
