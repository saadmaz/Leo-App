'use client'

import { useState, useRef } from 'react'
import { useParams } from 'next/navigation'
import { Zap } from 'lucide-react'
import { toast } from 'sonner'
import { SSEFeaturePage } from '@/components/pillar1/SSEFeaturePage'
import { api } from '@/lib/api'
import { usePillar10Store } from '@/stores/pillar10-store'
import type { ProgressStep } from '@/types'
import { cn } from '@/lib/utils'

const PRIORITY_COLORS: Record<string, string> = {
  high:   'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 border-red-200 dark:border-red-800',
  medium: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400 border-yellow-200 dark:border-yellow-800',
  low:    'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 border-blue-200 dark:border-blue-800',
}

const CHANNELS = [
  'landing_pages', 'email_campaigns', 'paid_ads', 'social_content',
  'blog_posts', 'sales_enablement', 'onboarding_flows', 'pricing_page',
]

interface PropagationAction {
  action: string
  channel: string
  rationale: string
  priority: string
  effort: string
  expected_impact: string
}

interface LearningPropagationResult {
  experiments_analysed: number
  winning_themes: string[]
  losing_themes: string[]
  propagation_actions: PropagationAction[]
  quick_wins: string[]
  long_term_plays: string[]
  meta_learnings: string[]
  propagation_summary: string
}

export default function LearningPropagationPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const store = usePillar10Store()

  const [selectedChannels, setSelectedChannels] = useState<string[]>(['landing_pages', 'email_campaigns', 'paid_ads'])
  const [focusArea, setFocusArea] = useState('')
  const [result, setResult] = useState<LearningPropagationResult | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  function toggleChannel(c: string) {
    setSelectedChannels((prev) => prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c])
  }

  async function generate() {
    if (selectedChannels.length === 0) { toast.error('Select at least one propagation channel'); return }

    abortRef.current?.abort()
    abortRef.current = new AbortController()
    store.setIsStreaming(true)
    store.clearSteps()
    store.clearStreamText()
    setResult(null)

    try {
      await api.pillar10.streamLearningPropagation(
        projectId,
        {
          propagation_channels: selectedChannels,
          focus_area: focusArea.trim() || undefined,
        },
        {
          onStep: (step, label, status) => store.upsertStep(step, label, status as ProgressStep['status']),
          onDelta: (text) => store.appendStreamText(text),
          onSaved: (_id, payload) => {
            setResult(payload as unknown as LearningPropagationResult)
            store.clearStreamText()
            store.setIsStreaming(false)
            toast.success('Propagation plan ready!')
          },
          onError: (msg) => { toast.error(msg); store.setIsStreaming(false) },
          onDone: () => store.setIsStreaming(false),
        },
        abortRef.current.signal,
      )
    } catch { store.setIsStreaming(false) }
  }

  const canSubmit = selectedChannels.length > 0

  const form = (
    <>
      <h2 className="font-semibold text-sm">Learning Propagation</h2>
      <p className="text-xs text-muted-foreground">Reads all concluded experiments in your log and synthesises a cross-channel action plan.</p>

      <div>
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Propagation Channels *</label>
        <div className="mt-1 flex flex-wrap gap-2">
          {CHANNELS.map((c) => (
            <button key={c} onClick={() => toggleChannel(c)}
              className={cn('px-3 py-1.5 text-xs rounded-lg border transition-colors capitalize',
                selectedChannels.includes(c) ? 'bg-primary text-primary-foreground border-primary' : 'bg-background border-border hover:border-primary/50')}>
              {c.replace(/_/g, ' ')}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Focus Area (optional)</label>
        <input value={focusArea} onChange={(e) => setFocusArea(e.target.value)}
          placeholder="e.g. conversion rate, messaging clarity, audience fit"
          className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
        <p className="text-[10px] text-muted-foreground mt-1">Leave blank to surface all cross-cutting learnings</p>
      </div>
    </>
  )

  const resultNode = result ? (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-sm">Propagation Plan</h2>
        <span className="text-xs text-muted-foreground">{result.experiments_analysed} experiment{result.experiments_analysed !== 1 ? 's' : ''} analysed</span>
      </div>

      {result.propagation_summary && (
        <div className="p-4 rounded-xl border border-border bg-card">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Summary</p>
          <p className="text-sm">{result.propagation_summary}</p>
        </div>
      )}

      {/* Winning / Losing themes */}
      {(result.winning_themes?.length > 0 || result.losing_themes?.length > 0) && (
        <div className="grid grid-cols-2 gap-3">
          {result.winning_themes?.length > 0 && (
            <div className="p-3 rounded-xl border border-green-500/30 bg-green-50/50 dark:bg-green-900/10">
              <p className="text-xs font-semibold text-green-700 dark:text-green-400 mb-2">What's Working</p>
              <ul className="space-y-1">
                {result.winning_themes.map((t, i) => <li key={i} className="text-xs text-muted-foreground">✓ {t}</li>)}
              </ul>
            </div>
          )}
          {result.losing_themes?.length > 0 && (
            <div className="p-3 rounded-xl border border-red-500/30 bg-red-50/50 dark:bg-red-900/10">
              <p className="text-xs font-semibold text-red-700 dark:text-red-400 mb-2">What's Not Working</p>
              <ul className="space-y-1">
                {result.losing_themes.map((t, i) => <li key={i} className="text-xs text-muted-foreground">✗ {t}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Action plan */}
      {result.propagation_actions?.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Action Plan</p>
          {result.propagation_actions.map((a, i) => (
            <div key={i} className={cn('p-3 rounded-xl border', PRIORITY_COLORS[a.priority] ?? 'border-border bg-card')}>
              <div className="flex items-start justify-between gap-2 mb-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-semibold capitalize">{a.channel.replace(/_/g, ' ')}</span>
                  <span className={cn('text-[10px] px-1.5 py-0.5 rounded-full font-medium capitalize border',
                    PRIORITY_COLORS[a.priority] ?? 'bg-muted text-muted-foreground border-border')}>
                    {a.priority} priority
                  </span>
                  <span className="text-[10px] text-muted-foreground">Effort: {a.effort}</span>
                </div>
                <span className="text-[10px] text-muted-foreground shrink-0">Expected: {a.expected_impact}</span>
              </div>
              <p className="text-sm font-medium">{a.action}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{a.rationale}</p>
            </div>
          ))}
        </div>
      )}

      {/* Quick wins */}
      {result.quick_wins?.length > 0 && (
        <div className="p-4 rounded-xl border border-primary/20 bg-primary/5">
          <p className="text-xs font-semibold text-primary uppercase tracking-wide mb-2">Quick Wins (implement this week)</p>
          <ol className="space-y-1">
            {result.quick_wins.map((w, i) => (
              <li key={i} className="text-xs text-muted-foreground flex gap-2">
                <span className="text-primary font-medium">{i + 1}.</span>{w}
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* Long-term plays */}
      {result.long_term_plays?.length > 0 && (
        <div className="p-4 rounded-xl border border-border bg-card">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Long-Term Plays</p>
          <ul className="space-y-1">
            {result.long_term_plays.map((p, i) => (
              <li key={i} className="text-xs text-muted-foreground flex gap-2">
                <span className="text-primary">→</span>{p}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Meta learnings */}
      {result.meta_learnings?.length > 0 && (
        <div className="p-4 rounded-xl border border-border bg-card">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Meta Learnings</p>
          <ul className="space-y-1">
            {result.meta_learnings.map((m, i) => (
              <li key={i} className="text-xs text-muted-foreground flex gap-2">
                <span className="text-primary">•</span>{m}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  ) : null

  return (
    <SSEFeaturePage
      projectId={projectId}
      title="Learning Propagation"
      subtitle="Pillar 10 - Claude"
      icon={<Zap className="w-4 h-4" />}
      credits={20}
      steps={store.steps}
      isStreaming={store.isStreaming}
      streamText={store.streamText}
      form={form}
      result={resultNode}
      onSubmit={generate}
      submitLabel="Generate Propagation Plan - 20 credits"
      canSubmit={canSubmit}
      backPath={`/projects/${projectId}/experiments`}
    />
  )
}
