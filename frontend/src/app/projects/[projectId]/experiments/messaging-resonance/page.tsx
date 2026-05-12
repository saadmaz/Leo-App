'use client'

import { useState, useRef } from 'react'
import { useParams } from 'next/navigation'
import { MessageSquare, Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import { SSEFeaturePage } from '@/components/pillar1/SSEFeaturePage'
import { api } from '@/lib/api'
import { usePillar10Store } from '@/stores/pillar10-store'
import type { ProgressStep } from '@/types'
import { cn } from '@/lib/utils'

const CONFIDENCE_COLORS: Record<string, string> = {
  high: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  medium: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
  low: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
}

interface AdResultRow {
  variant_name: string
  ad_copy: string
  impressions: string
  clicks: string
  spend: string
  conversions: string
}

interface ResonancePayload {
  winner: { variant_name: string; winning_metric: string; winning_value: string; confidence: string; confidence_rationale: string }
  variant_analysis: Array<{ variant_name: string; performance_summary: string; calculated_metrics: Record<string, string>; message_angle_assessment: string; audience_fit_score: number }>
  key_insight: string
  message_learnings: Array<{ learning: string; applies_to: string }>
  next_test_recommendation: { hypothesis: string; what_to_test: string; variants_to_try: string[]; rationale: string }
  propagation_suggestions: string[]
  budget_recommendation: string
  test_name: string
}

export default function MessagingResonancePage() {
  const { projectId } = useParams<{ projectId: string }>()
  const store = usePillar10Store()

  const [testName, setTestName] = useState('')
  const [testObjective, setTestObjective] = useState('')
  const [audience, setAudience] = useState('')
  const [budgetSpent, setBudgetSpent] = useState('')
  const [durationDays, setDurationDays] = useState('')
  const [fetchLive, setFetchLive] = useState(false)
  const [metaAccountId, setMetaAccountId] = useState('')
  const [metaCampaignId, setMetaCampaignId] = useState('')
  const [adRows, setAdRows] = useState<AdResultRow[]>([
    { variant_name: '', ad_copy: '', impressions: '', clicks: '', spend: '', conversions: '' },
    { variant_name: '', ad_copy: '', impressions: '', clicks: '', spend: '', conversions: '' },
  ])
  const [result, setResult] = useState<ResonancePayload | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  function addRow() {
    if (adRows.length < 8) setAdRows([...adRows, { variant_name: '', ad_copy: '', impressions: '', clicks: '', spend: '', conversions: '' }])
  }
  function removeRow(i: number) { if (adRows.length > 2) setAdRows(adRows.filter((_, idx) => idx !== i)) }
  function updateRow(i: number, field: keyof AdResultRow, v: string) {
    const n = [...adRows]; n[i] = { ...n[i], [field]: v }; setAdRows(n)
  }

  async function generate() {
    if (!testName.trim()) { toast.error('Enter the test name'); return }
    if (!testObjective.trim()) { toast.error('Describe the test objective'); return }
    const validRows = adRows.filter((r) => r.variant_name.trim())
    if (validRows.length < 2) { toast.error('Add at least 2 variants with names'); return }

    abortRef.current?.abort()
    abortRef.current = new AbortController()
    store.setIsStreaming(true)
    store.clearSteps()
    store.clearStreamText()
    setResult(null)

    try {
      await api.pillar10.streamMessagingResonance(
        projectId,
        {
          test_name: testName.trim(),
          test_objective: testObjective.trim(),
          audience_description: audience.trim() || undefined,
          budget_spent: budgetSpent ? Number(budgetSpent) : undefined,
          test_duration_days: durationDays ? Number(durationDays) : undefined,
          fetch_live_data: fetchLive,
          meta_ad_account_id: metaAccountId.trim() || undefined,
          meta_campaign_id: metaCampaignId.trim() || undefined,
          ad_results: validRows.map((r) => ({
            variant_name: r.variant_name,
            ad_copy: r.ad_copy || undefined,
            impressions: Number(r.impressions) || 0,
            clicks: Number(r.clicks) || 0,
            spend: Number(r.spend) || 0,
            conversions: Number(r.conversions) || 0,
          })),
        },
        {
          onStep: (step, label, status) => store.upsertStep(step, label, status as ProgressStep['status']),
          onDelta: (text) => store.appendStreamText(text),
          onSaved: (_id, payload) => {
            setResult(payload as unknown as ResonancePayload)
            store.clearStreamText()
            store.setIsStreaming(false)
            toast.success('Resonance analysis ready!')
          },
          onError: (msg) => { toast.error(msg); store.setIsStreaming(false) },
          onDone: () => store.setIsStreaming(false),
        },
        abortRef.current.signal,
      )
    } catch { store.setIsStreaming(false) }
  }

  const canSubmit = !!testName.trim() && !!testObjective.trim() && adRows.filter((r) => r.variant_name.trim()).length >= 2

  const form = (
    <>
      <h2 className="font-semibold text-sm">Messaging Resonance Testing</h2>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Test Name *</label>
          <input value={testName} onChange={(e) => setTestName(e.target.value)} placeholder="e.g. Pain vs Benefit headline test"
            className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Audience</label>
          <input value={audience} onChange={(e) => setAudience(e.target.value)} placeholder="e.g. Lookalike - SaaS founders"
            className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
        </div>
      </div>

      <div>
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Test Objective *</label>
        <textarea value={testObjective} onChange={(e) => setTestObjective(e.target.value)} rows={2}
          placeholder="What were you testing and why? e.g. Whether pain-led copy outperforms benefit-led for cold audiences"
          className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary resize-none" />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Total Budget Spent ($)</label>
          <input type="number" value={budgetSpent} onChange={(e) => setBudgetSpent(e.target.value)} placeholder="e.g. 500"
            className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Test Duration (days)</label>
          <input type="number" value={durationDays} onChange={(e) => setDurationDays(e.target.value)} placeholder="e.g. 7"
            className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
        </div>
      </div>

      <div className="p-3 rounded-lg border border-border bg-muted/30">
        <label className="flex items-center gap-2 cursor-pointer mb-2">
          <input type="checkbox" checked={fetchLive} onChange={(e) => setFetchLive(e.target.checked)} className="rounded border-border" />
          <span className="text-xs font-medium">Fetch live data from Meta Ads API</span>
        </label>
        {fetchLive && (
          <div className="grid grid-cols-2 gap-2 mt-2">
            <input value={metaAccountId} onChange={(e) => setMetaAccountId(e.target.value)} placeholder="Ad Account ID (act_xxx)"
              className="px-3 py-1.5 text-xs bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
            <input value={metaCampaignId} onChange={(e) => setMetaCampaignId(e.target.value)} placeholder="Campaign ID"
              className="px-3 py-1.5 text-xs bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
          </div>
        )}
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Ad Results *</label>
          {adRows.length < 8 && <button onClick={addRow} className="flex items-center gap-1 text-xs text-primary hover:text-primary/80"><Plus className="w-3 h-3" /> Add Variant</button>}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-muted-foreground border-b border-border">
                <th className="text-left pb-2 pr-2 font-medium">Variant Name</th>
                <th className="text-left pb-2 pr-2 font-medium">Impressions</th>
                <th className="text-left pb-2 pr-2 font-medium">Clicks</th>
                <th className="text-left pb-2 pr-2 font-medium">Spend ($)</th>
                <th className="text-left pb-2 pr-2 font-medium">Conversions</th>
                <th className="pb-2" />
              </tr>
            </thead>
            <tbody className="space-y-1">
              {adRows.map((row, i) => (
                <tr key={i} className="border-b border-border/50">
                  {(['variant_name', 'impressions', 'clicks', 'spend', 'conversions'] as const).map((field) => (
                    <td key={field} className="pr-2 py-1.5">
                      <input
                        type={field === 'variant_name' ? 'text' : 'number'}
                        value={row[field]}
                        onChange={(e) => updateRow(i, field, e.target.value)}
                        placeholder={field === 'variant_name' ? 'Variant A' : '0'}
                        className="w-full px-2 py-1 bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary text-xs"
                      />
                    </td>
                  ))}
                  <td className="py-1.5">
                    {adRows.length > 2 && <button onClick={() => removeRow(i)} className="text-muted-foreground hover:text-destructive"><X className="w-3.5 h-3.5" /></button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )

  const resultNode = result ? (
    <div className="space-y-4">
      <h2 className="font-semibold text-sm">{result.test_name}</h2>

      {result.winner && (
        <div className="p-4 rounded-xl border-2 border-green-500 bg-green-50 dark:bg-green-900/20 space-y-1">
          <div className="flex items-center justify-between">
            <p className="text-sm font-bold">Winner: {result.winner.variant_name}</p>
            <span className={cn('text-[10px] px-2 py-0.5 rounded-full font-medium capitalize', CONFIDENCE_COLORS[result.winner.confidence])}>
              {result.winner.confidence} confidence
            </span>
          </div>
          <p className="text-xs text-muted-foreground">{result.winner.winning_metric}: {result.winner.winning_value}</p>
          <p className="text-xs text-muted-foreground italic">{result.winner.confidence_rationale}</p>
        </div>
      )}

      {result.key_insight && (
        <div className="p-4 rounded-xl border border-primary/20 bg-primary/5">
          <p className="text-xs font-semibold text-primary uppercase tracking-wide mb-1">Key Insight</p>
          <p className="text-sm">{result.key_insight}</p>
        </div>
      )}

      <div className="space-y-3">
        {result.variant_analysis?.map((v, i) => (
          <div key={i} className="p-4 rounded-xl border border-border bg-card space-y-2">
            <div className="flex items-center justify-between">
              <p className="font-medium text-sm">{v.variant_name}</p>
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-muted-foreground">Audience fit:</span>
                <span className={cn('text-xs font-bold', v.audience_fit_score >= 7 ? 'text-green-600' : v.audience_fit_score >= 4 ? 'text-yellow-600' : 'text-red-600')}>
                  {v.audience_fit_score}/10
                </span>
              </div>
            </div>
            {v.calculated_metrics && (
              <div className="flex flex-wrap gap-3">
                {Object.entries(v.calculated_metrics).filter(([_, val]) => val).map(([key, val]) => (
                  <div key={key} className="text-xs">
                    <span className="text-muted-foreground capitalize">{key.replace(/_/g, ' ')}: </span>
                    <span className="font-medium">{val}</span>
                  </div>
                ))}
              </div>
            )}
            <p className="text-xs text-muted-foreground">{v.performance_summary}</p>
            <p className="text-xs text-primary/80 italic">{v.message_angle_assessment}</p>
          </div>
        ))}
      </div>

      {result.message_learnings?.length > 0 && (
        <div className="p-4 rounded-xl border border-border bg-card">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Transferable Learnings</p>
          <div className="space-y-2">
            {result.message_learnings.map((l, i) => (
              <div key={i} className="space-y-0.5">
                <p className="text-xs font-medium">{l.learning}</p>
                <p className="text-[10px] text-primary/80">Applies to: {l.applies_to}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {result.next_test_recommendation && (
        <div className="p-4 rounded-xl border border-border bg-card">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Next Test Recommendation</p>
          <p className="text-xs font-medium">{result.next_test_recommendation.hypothesis}</p>
          <p className="text-xs text-muted-foreground mt-1">{result.next_test_recommendation.rationale}</p>
          {result.next_test_recommendation.variants_to_try?.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {result.next_test_recommendation.variants_to_try.map((v, i) => (
                <span key={i} className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary">{v}</span>
              ))}
            </div>
          )}
        </div>
      )}

      {result.propagation_suggestions?.length > 0 && (
        <div className="p-4 rounded-xl border border-primary/20 bg-primary/5">
          <p className="text-xs font-semibold text-primary uppercase tracking-wide mb-2">Apply Winner Across</p>
          <ul className="space-y-1">
            {result.propagation_suggestions.map((s, i) => <li key={i} className="text-xs text-muted-foreground flex gap-2"><span className="text-primary">•</span>{s}</li>)}
          </ul>
        </div>
      )}

      {result.budget_recommendation && (
        <div className="p-3 rounded-lg border border-border bg-card">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Budget Recommendation</p>
          <p className="text-xs">{result.budget_recommendation}</p>
        </div>
      )}
    </div>
  ) : null

  return (
    <SSEFeaturePage
      projectId={projectId}
      title="Messaging Resonance"
      subtitle="Pillar 10 - Meta Ads + Claude"
      icon={<MessageSquare className="w-4 h-4" />}
      credits={15}
      steps={store.steps}
      isStreaming={store.isStreaming}
      streamText={store.streamText}
      form={form}
      result={resultNode}
      onSubmit={generate}
      submitLabel="Analyse Resonance - 15 credits"
      canSubmit={canSubmit}
      backPath={`/projects/${projectId}/experiments`}
    />
  )
}
