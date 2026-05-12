'use client'

import { useState, useRef } from 'react'
import { useParams } from 'next/navigation'
import { ImageIcon } from 'lucide-react'
import { toast } from 'sonner'
import { SSEFeaturePage } from '@/components/pillar1/SSEFeaturePage'
import { api } from '@/lib/api'
import { usePillar2Store } from '@/stores/pillar2-store'
import type { VisualBriefPayload, ProgressStep } from '@/types'

const CONTENT_TYPES = ['social_post', 'blog_cover', 'ad', 'email_banner', 'thumbnail', 'hero_image', 'story']
const PLATFORMS = ['Instagram', 'LinkedIn', 'Twitter/X', 'Facebook', 'YouTube', 'TikTok', 'Website', 'Email']

export default function VisualBriefPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const store = usePillar2Store()
  const [contentType, setContentType] = useState('social_post')
  const [platform, setPlatform] = useState('Instagram')
  const [description, setDescription] = useState('')
  const [dimensions, setDimensions] = useState('')
  const [result, setResult] = useState<VisualBriefPayload | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  async function generate() {
    if (!description.trim()) { toast.error('Description is required'); return }
    abortRef.current?.abort()
    abortRef.current = new AbortController()
    store.setIsStreaming(true)
    store.clearSteps()
    store.clearStreamText()
    setResult(null)
    try {
      await api.pillar2.streamVisualBrief(projectId,
        { content_type: contentType, platform, description: description.trim(), dimensions: dimensions || undefined },
        {
          onStep: (step, label, status) => store.upsertStep(step, label, status as ProgressStep['status']),
          onDelta: (text) => store.appendStreamText(text),
          onSaved: (_id, payload) => { setResult(payload as unknown as VisualBriefPayload); store.clearStreamText(); store.setIsStreaming(false); toast.success('Visual brief ready!') },
          onError: (msg) => { toast.error(msg); store.setIsStreaming(false) },
          onDone: () => store.setIsStreaming(false),
        },
        abortRef.current.signal,
      )
    } catch { store.setIsStreaming(false) }
  }

  const form = (
    <>
      <h2 className="font-semibold text-sm">Visual Brief Generator</h2>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Content Type</label>
          <select value={contentType} onChange={(e) => setContentType(e.target.value)}
            className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary">
            {CONTENT_TYPES.map((t) => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Platform</label>
          <select value={platform} onChange={(e) => setPlatform(e.target.value)}
            className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary">
            {PLATFORMS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
      </div>
      <div>
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Description / Objective *</label>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3}
          placeholder="What should this visual communicate? e.g. 'Announce our new AI feature launch, feel exciting and tech-forward'"
          className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary resize-none" />
      </div>
      <div>
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Dimensions (optional)</label>
        <input value={dimensions} onChange={(e) => setDimensions(e.target.value)}
          placeholder="e.g. 1080x1080, 1200x628, 9:16"
          className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
      </div>
    </>
  )

  const resultNode = result ? (
    <div className="space-y-4">
      <h2 className="font-semibold text-sm">Visual Brief - {result.content_type?.replace('_', ' ')}</h2>

      {/* Concept & Mood */}
      <div className="p-4 rounded-xl border border-border bg-card space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Concept</p>
        <p className="text-sm font-medium">{result.concept}</p>
        <p className="text-xs text-muted-foreground">{result.mood}</p>
      </div>

      {/* Color palette */}
      {result.color_palette && (
        <div className="p-4 rounded-xl border border-border bg-card space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Colour Palette</p>
          <div className="flex gap-2">
            {(['primary', 'secondary', 'accent', 'background'] as const).map((k) => (
              result.color_palette[k] && (
                <div key={k} className="flex flex-col items-center gap-1">
                  <div className="w-8 h-8 rounded-lg border border-border shadow-sm"
                    style={{ backgroundColor: result.color_palette[k] }} />
                  <span className="text-[10px] text-muted-foreground">{k}</span>
                  <span className="text-[10px] font-mono">{result.color_palette[k]}</span>
                </div>
              )
            ))}
          </div>
          {result.color_palette.rationale && (
            <p className="text-xs text-muted-foreground">{result.color_palette.rationale}</p>
          )}
        </div>
      )}

      {/* Copy suggestions */}
      {result.copy_suggestions && (
        <div className="p-4 rounded-xl border border-border bg-card space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Copy</p>
          {result.copy_suggestions.headline && <p className="text-sm font-medium">&ldquo;{result.copy_suggestions.headline}&rdquo;</p>}
          {result.copy_suggestions.subheadline && <p className="text-xs text-muted-foreground">{result.copy_suggestions.subheadline}</p>}
          {result.copy_suggestions.cta && <p className="text-xs bg-primary/10 text-primary px-2 py-1 rounded">CTA: {result.copy_suggestions.cta}</p>}
        </div>
      )}

      {/* Midjourney prompt */}
      {result.midjourney_prompt && (
        <div className="p-4 rounded-xl border border-border bg-card space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Midjourney Prompt</p>
          <p className="text-xs font-mono text-muted-foreground leading-relaxed">{result.midjourney_prompt}</p>
        </div>
      )}

      {/* Do / Don't */}
      {(result.do?.length > 0 || result.dont?.length > 0) && (
        <div className="grid grid-cols-2 gap-3">
          {result.do?.length > 0 && (
            <div className="p-3 rounded-xl border border-green-200 bg-green-50 dark:bg-green-950/20">
              <p className="text-xs font-semibold text-green-700 mb-1">✓ Do</p>
              {result.do.map((d, i) => <p key={i} className="text-xs text-green-700">• {d}</p>)}
            </div>
          )}
          {result.dont?.length > 0 && (
            <div className="p-3 rounded-xl border border-red-200 bg-red-50 dark:bg-red-950/20">
              <p className="text-xs font-semibold text-red-700 mb-1">✗ Don&apos;t</p>
              {result.dont.map((d, i) => <p key={i} className="text-xs text-red-700">• {d}</p>)}
            </div>
          )}
        </div>
      )}
    </div>
  ) : null

  return (
    <SSEFeaturePage projectId={projectId} title="Visual Brief" subtitle="Claude creative direction"
      icon={<ImageIcon className="w-4 h-4" />} credits={5} steps={store.steps}
      isStreaming={store.isStreaming} streamText={store.streamText} form={form} result={resultNode}
      onSubmit={generate} submitLabel="Generate Brief - 5 credits" canSubmit={!!description.trim()} />
  )
}
