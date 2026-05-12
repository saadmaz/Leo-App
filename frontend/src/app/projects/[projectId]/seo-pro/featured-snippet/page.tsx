'use client'

import { useState, useRef } from 'react'
import { useParams } from 'next/navigation'
import { Star } from 'lucide-react'
import { toast } from 'sonner'
import { SSEFeaturePage } from '@/components/pillar1/SSEFeaturePage'
import { api } from '@/lib/api'
import { usePillar3Store } from '@/stores/pillar3-store'
import type { FeaturedSnippetPayload, ProgressStep } from '@/types'
import { cn } from '@/lib/utils'

const OPPORTUNITY_COLORS: Record<string, string> = {
  High: 'text-green-600',
  Medium: 'text-yellow-600',
  Low: 'text-red-600',
}

export default function FeaturedSnippetPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const store = usePillar3Store()
  const [keyword, setKeyword] = useState('')
  const [yourContent, setYourContent] = useState('')
  const [locationCode, setLocationCode] = useState(2840)
  const [result, setResult] = useState<FeaturedSnippetPayload | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  async function generate() {
    if (!keyword.trim()) { toast.error('Keyword is required'); return }
    abortRef.current?.abort()
    abortRef.current = new AbortController()
    store.setIsStreaming(true)
    store.clearSteps()
    store.clearStreamText()
    setResult(null)
    try {
      await api.pillar3.streamFeaturedSnippet(projectId,
        { keyword: keyword.trim(), your_content: yourContent.trim() || undefined, location_code: locationCode, language_code: 'en' },
        {
          onStep: (step, label, status) => store.upsertStep(step, label, status as ProgressStep['status']),
          onDelta: (text) => store.appendStreamText(text),
          onSaved: (_id, payload) => { setResult(payload as unknown as FeaturedSnippetPayload); store.clearStreamText(); store.setIsStreaming(false); toast.success('Snippet optimisation ready!') },
          onError: (msg) => { toast.error(msg); store.setIsStreaming(false) },
          onDone: () => store.setIsStreaming(false),
        },
        abortRef.current.signal,
      )
    } catch { store.setIsStreaming(false) }
  }

  const form = (
    <>
      <h2 className="font-semibold text-sm">Featured Snippet Optimizer</h2>
      <div>
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Target Keyword *</label>
        <input value={keyword} onChange={(e) => setKeyword(e.target.value)}
          placeholder="e.g. what is email marketing"
          className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
      </div>
      <div>
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Location</label>
        <select value={locationCode} onChange={(e) => setLocationCode(Number(e.target.value))}
          className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary">
          <option value={2840}>United States</option>
          <option value={2826}>United Kingdom</option>
          <option value={2124}>Canada</option>
          <option value={2036}>Australia</option>
        </select>
      </div>
      <div>
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Your Existing Content (optional - paste to get a rewrite)</label>
        <textarea value={yourContent} onChange={(e) => setYourContent(e.target.value)} rows={4}
          placeholder="Paste your current content section to get an optimised rewrite..."
          className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary resize-none" />
      </div>
    </>
  )

  const resultNode = result ? (
    <div className="space-y-4">
      <h2 className="font-semibold text-sm">Featured Snippet - &ldquo;{result.keyword}&rdquo;</h2>

      {/* Snippet status */}
      <div className="p-4 rounded-xl border border-border bg-card">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <div className={cn('w-2 h-2 rounded-full', result.has_snippet ? 'bg-yellow-500' : 'bg-green-500')} />
            <p className="text-sm font-medium">
              {result.has_snippet ? `Snippet owned by ${result.current_snippet_owner}` : 'No snippet - opportunity open'}
            </p>
          </div>
          {result.opportunity_assessment && (
            <span className={cn('text-xs font-semibold', OPPORTUNITY_COLORS[result.opportunity_assessment] ?? '')}>
              {result.opportunity_assessment} opportunity
            </span>
          )}
        </div>
        {result.snippet_type && (
          <p className="text-xs text-muted-foreground">Snippet type: {result.snippet_type}</p>
        )}
        {result.estimated_time_to_win && (
          <p className="text-xs text-muted-foreground">Estimated time to win: {result.estimated_time_to_win}</p>
        )}
      </div>

      {/* Optimised content */}
      <div className="p-4 rounded-xl border border-primary/20 bg-primary/5 space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-primary">Optimised Snippet Content</p>
        {result.optimised_heading && (
          <div>
            <p className="text-[10px] text-muted-foreground mb-0.5">Heading (H2/H3)</p>
            <p className="text-sm font-semibold">{result.optimised_heading}</p>
          </div>
        )}
        {result.optimised_answer && (
          <div>
            <p className="text-[10px] text-muted-foreground mb-0.5">Answer paragraph (40-60 words)</p>
            <p className="text-sm">{result.optimised_answer}</p>
          </div>
        )}
        {result.optimised_list?.length > 0 && (
          <div>
            <p className="text-[10px] text-muted-foreground mb-1">List format</p>
            <ol className="space-y-0.5">
              {result.optimised_list.map((item, i) => (
                <li key={i} className="text-xs">{i + 1}. {item}</li>
              ))}
            </ol>
          </div>
        )}
      </div>

      {/* Schema markup */}
      {result.schema_markup_suggestion && (
        <div className="p-3 rounded-lg border border-border bg-muted">
          <p className="text-xs font-semibold mb-1">Recommended Schema</p>
          <p className="text-xs font-mono text-muted-foreground">@type: {result.schema_markup_suggestion}</p>
        </div>
      )}

      {/* Content tips */}
      {result.content_tips?.length > 0 && (
        <div className="p-4 rounded-xl border border-border bg-card space-y-1">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Optimisation Tips</p>
          {result.content_tips.map((tip, i) => <p key={i} className="text-xs text-muted-foreground">→ {tip}</p>)}
        </div>
      )}

      {result.page_requirements && (
        <div className="p-3 rounded-lg border border-border">
          <p className="text-xs font-semibold mb-1">Page Requirements</p>
          <p className="text-xs text-muted-foreground">{result.page_requirements}</p>
        </div>
      )}
    </div>
  ) : null

  return (
    <SSEFeaturePage projectId={projectId} title="Featured Snippet Optimizer" subtitle="DataForSEO + Claude"
      icon={<Star className="w-4 h-4" />} credits={10} steps={store.steps}
      isStreaming={store.isStreaming} streamText={store.streamText} form={form} result={resultNode}
      onSubmit={generate} submitLabel="Optimize for Snippet - 10 credits" canSubmit={!!keyword.trim()} />
  )
}
