'use client'

import { useState, useRef } from 'react'
import { useParams } from 'next/navigation'
import { TrendingDown, Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import { SSEFeaturePage } from '@/components/pillar1/SSEFeaturePage'
import { api } from '@/lib/api'
import { usePillar5Store } from '@/stores/pillar5-store'
import type { ProgressStep } from '@/types'
import { cn } from '@/lib/utils'

const OUTCOMES = ['won', 'lost', 'churned', 'no_decision']
const PRIORITY_STYLES: Record<string, string> = {
  high:   'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  medium: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
  low:    'bg-muted text-muted-foreground',
}

interface DealRow {
  deal_id: string
  outcome: string
  competitor_chosen: string
  deal_size: string
  close_date: string
  reason_given: string
  sales_notes: string
}

interface WinPattern { pattern: string; frequency: string; implication: string }
interface LossPattern { pattern: string; frequency: string; root_cause: string; fix: string }
interface Competitor { competitor: string; times_chosen_over_us: number; primary_reason: string; our_response: string }
interface Objection { objection: string; frequency: string; best_response: string; supporting_evidence: string }
interface ProcessGap { stage: string; gap: string; recommended_fix: string }
interface ProductGap { gap: string; mentioned_in_n_deals: number; priority: string; suggested_response: string }
interface RecommendedAction { action: string; owner: string; priority: string; timeline: string }

interface WinLossPayload {
  product_name: string
  analysis_period: string
  executive_summary: string
  outcome_breakdown: { won: number; lost: number; churned: number; no_decision: number; win_rate_pct: number; average_deal_size_won: number | null; average_deal_size_lost: number | null }
  win_patterns: WinPattern[]
  loss_patterns: LossPattern[]
  competitive_analysis: Competitor[]
  objection_playbook: Objection[]
  sales_process_gaps: ProcessGap[]
  product_gaps: ProductGap[]
  ideal_deal_profile: { company_size: string; industry: string; buying_trigger: string; champion_persona: string; deal_velocity_days: string }
  recommended_actions: RecommendedAction[]
}

function newDeal(i: number): DealRow {
  return { deal_id: `deal-${i + 1}`, outcome: 'lost', competitor_chosen: '', deal_size: '', close_date: '', reason_given: '', sales_notes: '' }
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

export default function WinLossPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const store = usePillar5Store()

  const [productName, setProductName] = useState('')
  const [dateRange, setDateRange] = useState('')
  const [deals, setDeals] = useState<DealRow[]>([newDeal(0), newDeal(1), newDeal(2)])
  const [result, setResult] = useState<WinLossPayload | null>(null)
  const [activeTab, setActiveTab] = useState<'patterns' | 'competitive' | 'playbook' | 'actions'>('patterns')
  const abortRef = useRef<AbortController | null>(null)

  function addDeal() { if (deals.length < 100) setDeals([...deals, newDeal(deals.length)]) }
  function removeDeal(i: number) { setDeals(deals.filter((_, idx) => idx !== i)) }
  function updateDeal(i: number, field: keyof DealRow, val: string) {
    const next = [...deals]; next[i] = { ...next[i], [field]: val }; setDeals(next)
  }

  async function generate() {
    if (!productName.trim()) { toast.error('Enter your product name'); return }
    const validDeals = deals.filter((d) => d.deal_id.trim() && d.outcome)
    if (validDeals.length < 1) { toast.error('Add at least one deal'); return }

    abortRef.current?.abort(); abortRef.current = new AbortController()
    store.setIsStreaming(true); store.clearSteps(); store.clearStreamText(); setResult(null)

    const payload = validDeals.map((d) => ({
      deal_id: d.deal_id.trim(),
      outcome: d.outcome,
      ...(d.competitor_chosen && { competitor_chosen: d.competitor_chosen }),
      ...(d.deal_size && { deal_size: parseFloat(d.deal_size) }),
      ...(d.close_date && { close_date: d.close_date }),
      ...(d.reason_given && { reason_given: d.reason_given }),
      ...(d.sales_notes && { sales_notes: d.sales_notes }),
    }))

    try {
      await api.pillar5.streamWinLoss(projectId,
        { deals: payload, product_name: productName.trim(), date_range: dateRange.trim() || undefined },
        {
          onStep: (s, l, st) => store.upsertStep(s, l, st as ProgressStep['status']),
          onDelta: (t) => store.appendStreamText(t),
          onSaved: (_, p) => { setResult(p as unknown as WinLossPayload); store.clearStreamText(); store.setIsStreaming(false); toast.success('Win/Loss analysis ready!') },
          onError: (m) => { toast.error(m); store.setIsStreaming(false) },
          onDone: () => store.setIsStreaming(false),
        }, abortRef.current.signal)
    } catch { store.setIsStreaming(false) }
  }

  const form = (
    <>
      <h2 className="font-semibold text-sm">Win/Loss Analysis</h2>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Product Name *</label>
          <input value={productName} onChange={(e) => setProductName(e.target.value)} placeholder="e.g. LEO"
            className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Date Range (optional)</label>
          <input value={dateRange} onChange={(e) => setDateRange(e.target.value)} placeholder="e.g. Q1 2026"
            className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
        </div>
      </div>
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Deal Outcomes ({deals.length})</label>
          {deals.length < 100 && (
            <button onClick={addDeal} className="flex items-center gap-1 text-xs text-primary hover:text-primary/80"><Plus className="w-3 h-3" /> Add deal</button>
          )}
        </div>
        <div className="space-y-3">
          {deals.map((deal, i) => (
            <div key={i} className="p-3 rounded-lg border border-border bg-muted/20 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-semibold text-muted-foreground uppercase">Deal {i + 1}</span>
                {deals.length > 1 && (
                  <button onClick={() => removeDeal(i)} className="text-muted-foreground hover:text-destructive transition-colors">
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <input value={deal.deal_id} onChange={(e) => updateDeal(i, 'deal_id', e.target.value)} placeholder="Deal ID *"
                  className="px-2 py-1.5 text-xs bg-background border border-border rounded focus:outline-none" />
                <div className="flex gap-1">
                  {OUTCOMES.map((o) => (
                    <button key={o} onClick={() => updateDeal(i, 'outcome', o)}
                      className={cn('flex-1 px-1.5 py-1.5 text-[10px] rounded border capitalize transition-colors',
                        deal.outcome === o ? 'bg-primary text-primary-foreground border-primary' : 'bg-background border-border hover:border-primary/50')}>
                      {o.replace(/_/, ' ')}
                    </button>
                  ))}
                </div>
                <input value={deal.competitor_chosen} onChange={(e) => updateDeal(i, 'competitor_chosen', e.target.value)} placeholder="Competitor chosen"
                  className="px-2 py-1.5 text-xs bg-background border border-border rounded focus:outline-none" />
                <input value={deal.deal_size} onChange={(e) => updateDeal(i, 'deal_size', e.target.value)} placeholder="Deal value ($)" type="number" min="0"
                  className="px-2 py-1.5 text-xs bg-background border border-border rounded focus:outline-none" />
                <input value={deal.close_date} onChange={(e) => updateDeal(i, 'close_date', e.target.value)} placeholder="Close date (e.g. 2026-03-15)"
                  className="px-2 py-1.5 text-xs bg-background border border-border rounded focus:outline-none" />
                <input value={deal.reason_given} onChange={(e) => updateDeal(i, 'reason_given', e.target.value)} placeholder="Reason given"
                  className="px-2 py-1.5 text-xs bg-background border border-border rounded focus:outline-none" />
              </div>
              <textarea value={deal.sales_notes} onChange={(e) => updateDeal(i, 'sales_notes', e.target.value)} rows={2}
                placeholder="Sales notes / call recap..."
                className="w-full px-2 py-1.5 text-xs bg-background border border-border rounded focus:outline-none resize-none" />
            </div>
          ))}
        </div>
      </div>
    </>
  )

  const resultNode = result ? (
    <div className="space-y-4">
      <div>
        <h2 className="font-semibold text-sm">{result.product_name} - {result.analysis_period}</h2>
        {result.executive_summary && <p className="text-xs text-muted-foreground mt-1">{result.executive_summary}</p>}
      </div>

      {result.outcome_breakdown && (
        <div className="grid grid-cols-4 gap-2">
          {[
            { label: 'Won', value: result.outcome_breakdown.won, color: 'text-green-500' },
            { label: 'Lost', value: result.outcome_breakdown.lost, color: 'text-red-500' },
            { label: 'Churned', value: result.outcome_breakdown.churned, color: 'text-orange-500' },
            { label: 'No Dec.', value: result.outcome_breakdown.no_decision, color: 'text-muted-foreground' },
          ].map((s) => (
            <div key={s.label} className="p-3 rounded-xl border border-border bg-card text-center">
              <p className={cn('text-lg font-bold', s.color)}>{s.value}</p>
              <p className="text-[10px] text-muted-foreground">{s.label}</p>
            </div>
          ))}
        </div>
      )}
      {result.outcome_breakdown?.win_rate_pct != null && (
        <div className="flex items-center gap-4 text-xs text-muted-foreground px-1">
          <span>Win rate: <span className="font-bold text-foreground">{result.outcome_breakdown.win_rate_pct}%</span></span>
          {result.outcome_breakdown.average_deal_size_won != null && (
            <span>Avg won: <span className="font-medium text-foreground">${result.outcome_breakdown.average_deal_size_won.toLocaleString()}</span></span>
          )}
          {result.outcome_breakdown.average_deal_size_lost != null && (
            <span>Avg lost: <span className="font-medium text-foreground">${result.outcome_breakdown.average_deal_size_lost.toLocaleString()}</span></span>
          )}
        </div>
      )}

      <div className="flex gap-2 border-b border-border pb-2 flex-wrap">
        {(['patterns', 'competitive', 'playbook', 'actions'] as const).map((tab) => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className={cn('text-xs px-3 py-1.5 rounded-lg capitalize transition-colors',
              activeTab === tab ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}>
            {tab === 'patterns' ? 'Win/Loss Patterns' : tab === 'competitive' ? 'Competitive' : tab === 'playbook' ? 'Objection Playbook' : 'Actions'}
          </button>
        ))}
      </div>

      {activeTab === 'patterns' && (
        <div className="space-y-4">
          {result.win_patterns?.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-green-600 dark:text-green-400 uppercase tracking-wide">Win Patterns</p>
              {result.win_patterns.map((p, i) => (
                <div key={i} className="p-3 rounded-xl border border-green-200/50 bg-green-50/50 dark:bg-green-900/10 dark:border-green-900/30">
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <p className="text-xs font-medium">{p.pattern}</p>
                    <span className="text-[10px] text-muted-foreground shrink-0">{p.frequency}</span>
                  </div>
                  <p className="text-[10px] text-muted-foreground">{p.implication}</p>
                </div>
              ))}
            </div>
          )}
          {result.loss_patterns?.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-red-600 dark:text-red-400 uppercase tracking-wide">Loss Patterns</p>
              {result.loss_patterns.map((p, i) => (
                <div key={i} className="p-3 rounded-xl border border-red-200/50 bg-red-50/50 dark:bg-red-900/10 dark:border-red-900/30 space-y-1">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-xs font-medium">{p.pattern}</p>
                    <span className="text-[10px] text-muted-foreground shrink-0">{p.frequency}</span>
                  </div>
                  <p className="text-[10px] text-muted-foreground">Root cause: {p.root_cause}</p>
                  <p className="text-[10px] font-medium text-primary">Fix: {p.fix}</p>
                </div>
              ))}
            </div>
          )}
          {result.sales_process_gaps?.length > 0 && (
            <div className="p-4 rounded-xl border border-border bg-card space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Sales Process Gaps</p>
              {result.sales_process_gaps.map((g, i) => (
                <div key={i} className="text-xs space-y-0.5">
                  <p className="font-medium">{g.stage}</p>
                  <p className="text-muted-foreground">{g.gap}</p>
                  <p className="text-primary text-[10px]">Fix: {g.recommended_fix}</p>
                </div>
              ))}
            </div>
          )}
          {result.product_gaps?.length > 0 && (
            <div className="p-4 rounded-xl border border-border bg-card space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Product Gaps</p>
              {result.product_gaps.map((g, i) => (
                <div key={i} className="flex items-start gap-3 text-xs">
                  <span className={cn('shrink-0 mt-0.5 text-[10px] px-1.5 py-0.5 rounded-full font-medium capitalize', PRIORITY_STYLES[g.priority] ?? 'bg-muted text-muted-foreground')}>{g.priority}</span>
                  <div>
                    <p className="font-medium">{g.gap} <span className="text-muted-foreground font-normal">({g.mentioned_in_n_deals} deals)</span></p>
                    <p className="text-[10px] text-muted-foreground">{g.suggested_response}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'competitive' && (
        <div className="space-y-3">
          {result.competitive_analysis?.map((c, i) => (
            <div key={i} className="p-4 rounded-xl border border-border bg-card space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold">{c.competitor}</p>
                <span className="text-xs text-muted-foreground">{c.times_chosen_over_us}x chosen over us</span>
              </div>
              <p className="text-xs text-muted-foreground"><span className="font-medium text-foreground">Why they chose: </span>{c.primary_reason}</p>
              <div className="p-2.5 rounded-lg bg-primary/5 border border-primary/20">
                <p className="text-[10px] font-semibold text-primary mb-0.5">Our counter</p>
                <p className="text-xs">{c.our_response}</p>
              </div>
            </div>
          ))}
          {result.ideal_deal_profile && (
            <div className="p-4 rounded-xl border border-border bg-card space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Ideal Deal Profile</p>
              {[
                { label: 'Company size', value: result.ideal_deal_profile.company_size },
                { label: 'Industry', value: result.ideal_deal_profile.industry },
                { label: 'Buying trigger', value: result.ideal_deal_profile.buying_trigger },
                { label: 'Champion persona', value: result.ideal_deal_profile.champion_persona },
                { label: 'Deal velocity', value: result.ideal_deal_profile.deal_velocity_days },
              ].map((r) => r.value ? (
                <div key={r.label} className="flex gap-2 text-xs">
                  <span className="text-muted-foreground shrink-0 w-28">{r.label}</span>
                  <span>{r.value}</span>
                </div>
              ) : null)}
            </div>
          )}
        </div>
      )}

      {activeTab === 'playbook' && (
        <div className="space-y-3">
          {result.objection_playbook?.map((o, i) => (
            <div key={i} className="p-4 rounded-xl border border-border bg-card space-y-2">
              <div className="flex items-start justify-between gap-2">
                <p className="text-xs font-semibold">{o.objection}</p>
                <span className="text-[10px] text-muted-foreground shrink-0">{o.frequency}</span>
              </div>
              <div className="bg-muted/40 rounded-lg p-3">
                <div className="flex items-start justify-between gap-2 mb-1">
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase">Best response</p>
                  <CopyBtn text={o.best_response} />
                </div>
                <p className="text-xs leading-relaxed">{o.best_response}</p>
              </div>
              {o.supporting_evidence && (
                <p className="text-[10px] text-muted-foreground italic">{o.supporting_evidence}</p>
              )}
            </div>
          ))}
        </div>
      )}

      {activeTab === 'actions' && (
        <div className="space-y-3">
          {result.recommended_actions?.map((a, i) => (
            <div key={i} className="p-3 rounded-xl border border-border bg-card flex items-start gap-3">
              <span className={cn('shrink-0 mt-0.5 text-[10px] px-1.5 py-0.5 rounded-full font-medium capitalize', PRIORITY_STYLES[a.priority] ?? 'bg-muted text-muted-foreground')}>{a.priority}</span>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium">{a.action}</p>
                <div className="flex items-center gap-3 mt-0.5 text-[10px] text-muted-foreground">
                  <span>Owner: {a.owner}</span>
                  <span>·</span>
                  <span>{a.timeline}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  ) : null

  const canSubmit = !!productName.trim() && deals.some((d) => d.deal_id.trim())

  return (
    <SSEFeaturePage projectId={projectId} title="Win/Loss Analysis" subtitle="Pillar 5 - Claude"
      icon={<TrendingDown className="w-4 h-4" />} credits={15} steps={store.steps}
      isStreaming={store.isStreaming} streamText={store.streamText} form={form} result={resultNode}
      onSubmit={generate} submitLabel="Analyse Deals - 15 credits" canSubmit={canSubmit}
      backPath={`/projects/${projectId}/email-crm`} />
  )
}
