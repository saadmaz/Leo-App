'use client'

import { useState, useRef } from 'react'
import { useParams } from 'next/navigation'
import { Globe, Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import { SSEFeaturePage } from '@/components/pillar1/SSEFeaturePage'
import { api } from '@/lib/api'
import { usePillar10Store } from '@/stores/pillar10-store'
import type { ProgressStep } from '@/types'
import { cn } from '@/lib/utils'

const ALL_SECTIONS = [
  'hero_headline', 'subheadline', 'cta', 'value_proposition',
  'social_proof', 'pricing_copy', 'faq', 'footer_cta',
]

const ANGLE_COLORS: Record<string, string> = {
  pain_led: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  benefit_led: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  social_proof: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  urgency: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  curiosity: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500) }}
      className="text-[10px] text-muted-foreground hover:text-primary px-1.5 py-0.5 rounded border border-border hover:border-primary/50 shrink-0">
      {copied ? 'Copied!' : 'Copy'}
    </button>
  )
}

interface CROVariant { variant_id: string; copy: string; angle: string; rationale: string; which_audience_segment: string }
interface CROSection { section: string; current_version?: string; variants: CROVariant[]; testing_recommendation: string }
interface CROPayload {
  page_analysis: string
  cro_opportunities: string[]
  sections: CROSection[]
  implementation_guide: string
  success_metrics: string[]
  expected_lift_range: string
  overall_cro_roadmap: string
  conversion_goal: string
}

export default function LandingPageCROPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const store = usePillar10Store()

  const [pageUrl, setPageUrl] = useState('')
  const [pageDescription, setPageDescription] = useState('')
  const [conversionGoal, setConversionGoal] = useState('')
  const [currentHeadline, setCurrentHeadline] = useState('')
  const [currentCta, setCurrentCta] = useState('')
  const [targetAudience, setTargetAudience] = useState('')
  const [painPoints, setPainPoints] = useState<string[]>([''])
  const [numVariants, setNumVariants] = useState(3)
  const [selectedSections, setSelectedSections] = useState(['hero_headline', 'subheadline', 'cta', 'value_proposition'])
  const [result, setResult] = useState<CROPayload | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  function toggleSection(s: string) {
    setSelectedSections((prev) => prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s])
  }
  function addPain() { if (painPoints.length < 6) setPainPoints([...painPoints, '']) }
  function removePain(i: number) { setPainPoints(painPoints.filter((_, idx) => idx !== i)) }
  function updatePain(i: number, v: string) { const n = [...painPoints]; n[i] = v; setPainPoints(n) }

  async function generate() {
    if (!conversionGoal.trim()) { toast.error('Describe the conversion goal'); return }
    if (!targetAudience.trim()) { toast.error('Describe the target audience'); return }
    if (!pageUrl.trim() && !pageDescription.trim()) { toast.error('Provide a page URL or description'); return }
    if (selectedSections.length === 0) { toast.error('Select at least one section to optimise'); return }

    abortRef.current?.abort()
    abortRef.current = new AbortController()
    store.setIsStreaming(true)
    store.clearSteps()
    store.clearStreamText()
    setResult(null)

    try {
      await api.pillar10.streamLandingPageCRO(
        projectId,
        {
          page_url: pageUrl.trim() || undefined,
          page_description: pageDescription.trim() || undefined,
          conversion_goal: conversionGoal.trim(),
          current_headline: currentHeadline.trim() || undefined,
          current_cta: currentCta.trim() || undefined,
          target_audience: targetAudience.trim(),
          pain_points: painPoints.filter(Boolean).length > 0 ? painPoints.filter(Boolean) : undefined,
          num_variants: numVariants,
          sections_to_optimise: selectedSections,
        },
        {
          onStep: (step, label, status) => store.upsertStep(step, label, status as ProgressStep['status']),
          onDelta: (text) => store.appendStreamText(text),
          onSaved: (_id, payload) => {
            setResult(payload as unknown as CROPayload)
            store.clearStreamText()
            store.setIsStreaming(false)
            toast.success('CRO variants ready!')
          },
          onError: (msg) => { toast.error(msg); store.setIsStreaming(false) },
          onDone: () => store.setIsStreaming(false),
        },
        abortRef.current.signal,
      )
    } catch { store.setIsStreaming(false) }
  }

  const canSubmit = !!conversionGoal.trim() && !!targetAudience.trim() &&
    (!!pageUrl.trim() || !!pageDescription.trim()) && selectedSections.length > 0

  const form = (
    <>
      <h2 className="font-semibold text-sm">Landing Page CRO</h2>

      <div>
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Page URL (Firecrawl reads it)</label>
        <input value={pageUrl} onChange={(e) => setPageUrl(e.target.value)} placeholder="https://yoursite.com/landing-page"
          className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
      </div>

      <div>
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Page Description (if no URL) *</label>
        <textarea value={pageDescription} onChange={(e) => setPageDescription(e.target.value)} rows={2}
          placeholder="Describe the page - product, value prop, current messaging, key sections"
          className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary resize-none" />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Conversion Goal *</label>
          <input value={conversionGoal} onChange={(e) => setConversionGoal(e.target.value)} placeholder="e.g. book a demo"
            className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Target Audience *</label>
          <input value={targetAudience} onChange={(e) => setTargetAudience(e.target.value)} placeholder="e.g. mid-market CMOs"
            className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Current Headline</label>
          <input value={currentHeadline} onChange={(e) => setCurrentHeadline(e.target.value)} placeholder="Your current hero headline"
            className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Current CTA</label>
          <input value={currentCta} onChange={(e) => setCurrentCta(e.target.value)} placeholder="e.g. Get Started Free"
            className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
        </div>
      </div>

      <div>
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Sections to Optimise *</label>
        <div className="mt-1 flex flex-wrap gap-2">
          {ALL_SECTIONS.map((s) => (
            <button key={s} onClick={() => toggleSection(s)}
              className={cn('px-3 py-1.5 text-xs rounded-lg border transition-colors capitalize',
                selectedSections.includes(s) ? 'bg-primary text-primary-foreground border-primary' : 'bg-background border-border hover:border-primary/50')}>
              {s.replace(/_/g, ' ')}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Variants per Section</label>
        <div className="mt-1 flex gap-2">
          {[2, 3, 4, 5].map((n) => (
            <button key={n} onClick={() => setNumVariants(n)}
              className={cn('px-3 py-1.5 text-xs rounded-lg border transition-colors',
                numVariants === n ? 'bg-primary text-primary-foreground border-primary' : 'bg-background border-border hover:border-primary/50')}>
              {n}
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Visitor Pain Points</label>
          {painPoints.length < 6 && <button onClick={addPain} className="flex items-center gap-1 text-xs text-primary hover:text-primary/80"><Plus className="w-3 h-3" /> Add</button>}
        </div>
        <div className="space-y-2">
          {painPoints.map((p, i) => (
            <div key={i} className="flex gap-2">
              <input value={p} onChange={(e) => updatePain(i, e.target.value)} placeholder={`Pain point ${i + 1}`}
                className="flex-1 px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
              {painPoints.length > 1 && <button onClick={() => removePain(i)} className="text-muted-foreground hover:text-destructive"><X className="w-4 h-4" /></button>}
            </div>
          ))}
        </div>
      </div>
    </>
  )

  const resultNode = result ? (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-sm">CRO Variants - {result.conversion_goal}</h2>
        {result.expected_lift_range && (
          <span className="text-xs text-green-600 dark:text-green-400 font-medium">{result.expected_lift_range}</span>
        )}
      </div>

      {result.page_analysis && (
        <div className="p-4 rounded-xl border border-border bg-card">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Page Analysis</p>
          <p className="text-sm">{result.page_analysis}</p>
        </div>
      )}

      {result.cro_opportunities?.length > 0 && (
        <div className="p-4 rounded-xl border border-primary/20 bg-primary/5">
          <p className="text-xs font-semibold text-primary uppercase tracking-wide mb-2">Top CRO Opportunities</p>
          <ol className="space-y-1">
            {result.cro_opportunities.map((o, i) => <li key={i} className="text-xs text-muted-foreground flex gap-2"><span className="text-primary font-medium">{i + 1}.</span>{o}</li>)}
          </ol>
        </div>
      )}

      {result.sections?.map((section, si) => (
        <div key={si} className="p-4 rounded-xl border border-border bg-card space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold capitalize">{section.section.replace(/_/g, ' ')}</p>
            {section.current_version && (
              <span className="text-[10px] text-muted-foreground bg-muted px-2 py-0.5 rounded">Current: {section.current_version.slice(0, 40)}{section.current_version.length > 40 ? '…' : ''}</span>
            )}
          </div>

          <div className="space-y-2">
            {section.variants.map((v, vi) => (
              <div key={vi} className="p-3 rounded-lg bg-muted/50 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="w-5 h-5 rounded bg-primary/10 text-primary text-[10px] font-bold flex items-center justify-center">{v.variant_id}</span>
                    <span className={cn('text-[10px] px-1.5 py-0.5 rounded-full font-medium capitalize', ANGLE_COLORS[v.angle] ?? 'bg-muted text-muted-foreground')}>
                      {v.angle?.replace(/_/g, ' ')}
                    </span>
                  </div>
                  <CopyButton text={v.copy} />
                </div>
                <p className="text-sm font-medium">{v.copy}</p>
                <p className="text-xs text-muted-foreground">{v.rationale}</p>
                <p className="text-[10px] text-primary/70 italic">Best for: {v.which_audience_segment}</p>
              </div>
            ))}
          </div>

          {section.testing_recommendation && (
            <p className="text-xs text-muted-foreground border-t border-border pt-2">{section.testing_recommendation}</p>
          )}
        </div>
      ))}

      {result.implementation_guide && (
        <div className="p-4 rounded-xl border border-border bg-card">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Implementation Guide</p>
          <p className="text-sm whitespace-pre-wrap">{result.implementation_guide}</p>
        </div>
      )}

      {result.overall_cro_roadmap && (
        <div className="p-4 rounded-xl border border-border bg-card">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Testing Roadmap</p>
          <p className="text-sm">{result.overall_cro_roadmap}</p>
        </div>
      )}
    </div>
  ) : null

  return (
    <SSEFeaturePage
      projectId={projectId}
      title="Landing Page CRO"
      subtitle="Pillar 10 - Firecrawl + Claude"
      icon={<Globe className="w-4 h-4" />}
      credits={15}
      steps={store.steps}
      isStreaming={store.isStreaming}
      streamText={store.streamText}
      form={form}
      result={resultNode}
      onSubmit={generate}
      submitLabel="Generate CRO Variants - 15 credits"
      canSubmit={canSubmit}
      backPath={`/projects/${projectId}/experiments`}
    />
  )
}
