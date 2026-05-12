'use client'

import { useState, useRef } from 'react'
import { useParams } from 'next/navigation'
import { Copy, Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import { SSEFeaturePage } from '@/components/pillar1/SSEFeaturePage'
import { api } from '@/lib/api'
import { usePillar4Store } from '@/stores/pillar4-store'
import type { ProgressStep } from '@/types'
import { cn } from '@/lib/utils'

const PLATFORMS = [
  { id: 'google_search', label: 'Google Search', hint: 'RSA: headlines ≤30 chars' },
  { id: 'google_display', label: 'Google Display', hint: 'Short + long headline + description' },
  { id: 'meta_feed', label: 'Meta Feed', hint: 'Primary ≤125, headline ≤40' },
  { id: 'meta_stories', label: 'Meta Stories', hint: 'Punchy, visual-first' },
  { id: 'tiktok', label: 'TikTok', hint: 'Ad text ≤100 chars + hook' },
  { id: 'linkedin', label: 'LinkedIn', hint: 'Headline ≤70, body ≤600' },
]

const TONES = ['professional', 'casual', 'urgent', 'inspirational']

interface AdVariant {
  variant_id: string
  angle: string
  angle_rationale: string
  ab_hypothesis: string
  cta: string
  // Google Search RSA
  headlines?: string[]
  descriptions?: string[]
  // Google Display
  short_headline?: string
  long_headline?: string
  description?: string
  // Meta
  primary_text?: string
  headline?: string
  // TikTok
  ad_text?: string
  hook?: string
  // LinkedIn
  body?: string
}

interface AdCopyPayload {
  platform: string
  product_name: string
  platform_specs: string
  variants: AdVariant[]
  testing_strategy: string
  brand_voice_notes: string
}

const ANGLE_COLORS: Record<string, string> = {
  problem_aware: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  solution_aware: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  social_proof: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  urgency: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  aspirational: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  function doCopy() {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <button onClick={doCopy} className="text-[10px] text-muted-foreground hover:text-primary transition-colors px-1.5 py-0.5 rounded border border-border hover:border-primary/50">
      {copied ? 'Copied!' : 'Copy'}
    </button>
  )
}

export default function AdCopyPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const store = usePillar4Store()

  const [platform, setPlatform] = useState('google_search')
  const [objective, setObjective] = useState('')
  const [productName, setProductName] = useState('')
  const [productDescription, setProductDescription] = useState('')
  const [targetAudience, setTargetAudience] = useState('')
  const [tone, setTone] = useState('professional')
  const [numVariants, setNumVariants] = useState(3)
  const [usps, setUsps] = useState<string[]>([''])
  const [landingPageUrl, setLandingPageUrl] = useState('')
  const [result, setResult] = useState<AdCopyPayload | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  function addUsp() { if (usps.length < 5) setUsps([...usps, '']) }
  function removeUsp(i: number) { setUsps(usps.filter((_, idx) => idx !== i)) }
  function updateUsp(i: number, val: string) {
    const next = [...usps]; next[i] = val; setUsps(next)
  }

  async function generate() {
    if (!productName.trim()) { toast.error('Enter a product name'); return }
    if (!productDescription.trim()) { toast.error('Enter a product description'); return }
    if (!targetAudience.trim()) { toast.error('Describe your target audience'); return }
    if (!objective.trim()) { toast.error('Enter the ad objective'); return }

    abortRef.current?.abort()
    abortRef.current = new AbortController()
    store.setIsStreaming(true)
    store.clearSteps()
    store.clearStreamText()
    setResult(null)

    try {
      await api.pillar4.streamAdCopy(
        projectId,
        {
          platform,
          objective: objective.trim(),
          product_name: productName.trim(),
          product_description: productDescription.trim(),
          target_audience: targetAudience.trim(),
          tone,
          num_variants: numVariants,
          usp: usps.filter(Boolean),
          landing_page_url: landingPageUrl.trim() || undefined,
        },
        {
          onStep: (step, label, status) => store.upsertStep(step, label, status as ProgressStep['status']),
          onDelta: (text) => store.appendStreamText(text),
          onSaved: (_id, payload) => {
            setResult(payload as unknown as AdCopyPayload)
            store.clearStreamText()
            store.setIsStreaming(false)
            toast.success('Ad copy ready!')
          },
          onError: (msg) => { toast.error(msg); store.setIsStreaming(false) },
          onDone: () => store.setIsStreaming(false),
        },
        abortRef.current.signal,
      )
    } catch { store.setIsStreaming(false) }
  }

  const canSubmit = !!productName.trim() && !!productDescription.trim() && !!targetAudience.trim() && !!objective.trim()
  const selectedPlatform = PLATFORMS.find((p) => p.id === platform)

  const form = (
    <>
      <h2 className="font-semibold text-sm">Ad Copy Generator</h2>

      <div>
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Platform *</label>
        <div className="mt-1 flex flex-wrap gap-2">
          {PLATFORMS.map((p) => (
            <button key={p.id} onClick={() => setPlatform(p.id)}
              className={cn(
                'px-3 py-1.5 text-xs rounded-lg border transition-colors text-left',
                platform === p.id
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-background border-border hover:border-primary/50',
              )}>
              {p.label}
            </button>
          ))}
        </div>
        {selectedPlatform && (
          <p className="mt-1 text-[10px] text-muted-foreground">{selectedPlatform.hint}</p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Product / Service *</label>
          <input value={productName} onChange={(e) => setProductName(e.target.value)}
            placeholder="e.g. LEO Marketing Co-pilot"
            className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Ad Objective *</label>
          <input value={objective} onChange={(e) => setObjective(e.target.value)}
            placeholder="e.g. free trial signups"
            className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
        </div>
      </div>

      <div>
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Product Description *</label>
        <textarea value={productDescription} onChange={(e) => setProductDescription(e.target.value)}
          rows={2} placeholder="Describe your product - what it does, key benefits, how it's different"
          className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary resize-none" />
      </div>

      <div>
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Target Audience *</label>
        <textarea value={targetAudience} onChange={(e) => setTargetAudience(e.target.value)}
          rows={2} placeholder="e.g. Freelance marketers and small agency owners who want to save time on client reporting"
          className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary resize-none" />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Tone</label>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {TONES.map((t) => (
              <button key={t} onClick={() => setTone(t)}
                className={cn(
                  'px-2.5 py-1 text-xs rounded-lg border transition-colors capitalize',
                  tone === t
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-background border-border hover:border-primary/50',
                )}>
                {t}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Variants</label>
          <select value={numVariants} onChange={(e) => setNumVariants(Number(e.target.value))}
            className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary">
            {[2, 3, 4, 5].map((n) => <option key={n} value={n}>{n} variants</option>)}
          </select>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">USPs (optional)</label>
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
                placeholder={`USP ${i + 1}`}
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
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Landing Page URL (optional)</label>
        <input value={landingPageUrl} onChange={(e) => setLandingPageUrl(e.target.value)}
          placeholder="https://yoursite.com/lp"
          className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
      </div>
    </>
  )

  const resultNode = result ? (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-sm">{result.product_name} - {result.platform.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}</h2>
        <span className="text-xs text-muted-foreground">{result.variants?.length} variants</span>
      </div>

      {result.platform_specs && (
        <div className="p-3 rounded-lg bg-muted/50 border border-border text-xs text-muted-foreground">
          {result.platform_specs}
        </div>
      )}

      {result.variants?.map((v, i) => (
        <div key={i} className="p-4 rounded-xl border border-border bg-card space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-6 h-6 rounded bg-primary/10 text-primary text-xs font-bold flex items-center justify-center">{v.variant_id}</span>
              <span className={cn('text-[10px] px-2 py-0.5 rounded-full font-medium capitalize', ANGLE_COLORS[v.angle] ?? 'bg-muted text-muted-foreground')}>
                {v.angle?.replace(/_/g, ' ')}
              </span>
            </div>
          </div>

          {v.angle_rationale && <p className="text-xs text-muted-foreground italic">{v.angle_rationale}</p>}

          {/* Google Search RSA */}
          {v.headlines && (
            <div className="space-y-1">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase">Headlines</p>
              {v.headlines.map((h, j) => (
                <div key={j} className="flex items-center justify-between gap-2 text-xs bg-muted/50 px-2.5 py-1.5 rounded">
                  <span>{h}</span>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className={cn('text-[10px]', h.length > 30 ? 'text-red-500' : 'text-muted-foreground')}>{h.length}/30</span>
                    <CopyButton text={h} />
                  </div>
                </div>
              ))}
            </div>
          )}
          {v.descriptions && (
            <div className="space-y-1">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase">Descriptions</p>
              {v.descriptions.map((d, j) => (
                <div key={j} className="flex items-start justify-between gap-2 text-xs bg-muted/50 px-2.5 py-1.5 rounded">
                  <span>{d}</span>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className={cn('text-[10px]', d.length > 90 ? 'text-red-500' : 'text-muted-foreground')}>{d.length}/90</span>
                    <CopyButton text={d} />
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Display / Meta / LinkedIn */}
          {v.short_headline && (
            <div className="flex items-center justify-between text-xs bg-muted/50 px-2.5 py-1.5 rounded">
              <div><span className="text-muted-foreground text-[10px]">Short: </span>{v.short_headline}</div>
              <CopyButton text={v.short_headline} />
            </div>
          )}
          {v.long_headline && (
            <div className="flex items-center justify-between text-xs bg-muted/50 px-2.5 py-1.5 rounded">
              <div><span className="text-muted-foreground text-[10px]">Long: </span>{v.long_headline}</div>
              <CopyButton text={v.long_headline} />
            </div>
          )}
          {v.primary_text && (
            <div className="space-y-0.5">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase">Primary Text</p>
              <div className="flex items-start justify-between gap-2 text-xs bg-muted/50 px-2.5 py-1.5 rounded">
                <span>{v.primary_text}</span>
                <CopyButton text={v.primary_text} />
              </div>
            </div>
          )}
          {v.headline && (
            <div className="flex items-center justify-between text-xs bg-muted/50 px-2.5 py-1.5 rounded">
              <div><span className="text-muted-foreground text-[10px]">Headline: </span>{v.headline}</div>
              <CopyButton text={v.headline} />
            </div>
          )}
          {v.description && (
            <div className="flex items-center justify-between text-xs bg-muted/50 px-2.5 py-1.5 rounded">
              <div><span className="text-muted-foreground text-[10px]">Description: </span>{v.description}</div>
              <CopyButton text={v.description} />
            </div>
          )}

          {/* TikTok */}
          {v.hook && (
            <div className="flex items-center justify-between text-xs bg-primary/5 px-2.5 py-1.5 rounded border border-primary/20">
              <div><span className="text-primary text-[10px] font-medium">Hook (0-3s): </span>{v.hook}</div>
              <CopyButton text={v.hook} />
            </div>
          )}
          {v.ad_text && (
            <div className="flex items-start justify-between gap-2 text-xs bg-muted/50 px-2.5 py-1.5 rounded">
              <span>{v.ad_text}</span>
              <CopyButton text={v.ad_text} />
            </div>
          )}

          {/* LinkedIn body */}
          {v.body && (
            <div className="space-y-0.5">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase">Body</p>
              <div className="flex items-start justify-between gap-2 text-xs bg-muted/50 px-2.5 py-1.5 rounded">
                <span className="whitespace-pre-wrap">{v.body}</span>
                <CopyButton text={v.body} />
              </div>
            </div>
          )}

          <div className="flex items-center justify-between text-xs border-t border-border pt-2">
            <span className="text-muted-foreground">CTA: <span className="text-foreground font-medium">{v.cta}</span></span>
          </div>

          {v.ab_hypothesis && (
            <p className="text-[10px] text-muted-foreground">A/B Hypothesis: {v.ab_hypothesis}</p>
          )}
        </div>
      ))}

      {result.testing_strategy && (
        <div className="p-4 rounded-xl border border-border bg-card">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Testing Strategy</p>
          <p className="text-sm">{result.testing_strategy}</p>
        </div>
      )}

      {result.brand_voice_notes && (
        <div className="p-4 rounded-xl border border-primary/20 bg-primary/5">
          <p className="text-xs font-semibold text-primary uppercase tracking-wide mb-1">Brand Voice Applied</p>
          <p className="text-xs text-muted-foreground">{result.brand_voice_notes}</p>
        </div>
      )}
    </div>
  ) : null

  return (
    <SSEFeaturePage
      projectId={projectId}
      title="Ad Copy Generator"
      subtitle="Pillar 4 - Claude"
      icon={<Copy className="w-4 h-4" />}
      credits={10}
      steps={store.steps}
      isStreaming={store.isStreaming}
      streamText={store.streamText}
      form={form}
      result={resultNode}
      onSubmit={generate}
      submitLabel="Generate Ad Copy - 10 credits"
      canSubmit={canSubmit}
      backPath={`/projects/${projectId}/paid-ads`}
    />
  )
}
