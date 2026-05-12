'use client'

import { useState, useRef } from 'react'
import { useParams } from 'next/navigation'
import { Type } from 'lucide-react'
import { toast } from 'sonner'
import { SSEFeaturePage } from '@/components/pillar1/SSEFeaturePage'
import { api } from '@/lib/api'
import { usePillar2Store } from '@/stores/pillar2-store'
import type { HeadlinePayload, ProgressStep } from '@/types'

const PLATFORMS = ['General', 'LinkedIn', 'Twitter/X', 'Email Subject', 'YouTube', 'Instagram', 'TikTok', 'Facebook Ad']

export default function HeadlinePage() {
  const { projectId } = useParams<{ projectId: string }>()
  const store = usePillar2Store()
  const [topic, setTopic] = useState('')
  const [platform, setPlatform] = useState('LinkedIn')
  const [count, setCount] = useState(5)
  const [result, setResult] = useState<HeadlinePayload | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  async function generate() {
    if (!topic.trim()) { toast.error('Topic is required'); return }
    abortRef.current?.abort()
    abortRef.current = new AbortController()
    store.setIsStreaming(true)
    store.clearSteps()
    store.clearStreamText()
    setResult(null)
    try {
      await api.pillar2.streamHeadlines(projectId,
        { topic: topic.trim(), platform, count },
        {
          onStep: (step, label, status) => store.upsertStep(step, label, status as ProgressStep['status']),
          onDelta: (text) => store.appendStreamText(text),
          onSaved: (_id, payload) => { setResult(payload as unknown as HeadlinePayload); store.clearStreamText(); store.setIsStreaming(false); toast.success('Headlines ready!') },
          onError: (msg) => { toast.error(msg); store.setIsStreaming(false) },
          onDone: () => store.setIsStreaming(false),
        },
        abortRef.current.signal,
      )
    } catch { store.setIsStreaming(false) }
  }

  const ANGLE_COLORS: Record<string, string> = {
    curiosity: 'bg-purple-500/10 text-purple-600',
    authority: 'bg-blue-500/10 text-blue-600',
    benefit: 'bg-green-500/10 text-green-600',
    urgency: 'bg-red-500/10 text-red-600',
    social_proof: 'bg-yellow-500/10 text-yellow-600',
    data: 'bg-cyan-500/10 text-cyan-600',
    question: 'bg-orange-500/10 text-orange-600',
    story: 'bg-pink-500/10 text-pink-600',
  }

  const form = (
    <>
      <h2 className="font-semibold text-sm">Headline A/B Variants</h2>
      <div>
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Topic / Content *</label>
        <textarea value={topic} onChange={(e) => setTopic(e.target.value)} rows={3}
          placeholder="e.g. 'How we grew our email list by 10k in 30 days' or paste your article intro"
          className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary resize-none" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Platform</label>
          <select value={platform} onChange={(e) => setPlatform(e.target.value)}
            className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary">
            {PLATFORMS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Variants</label>
          <select value={count} onChange={(e) => setCount(Number(e.target.value))}
            className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary">
            {[3, 5, 7, 10].map((n) => <option key={n} value={n}>{n} variants</option>)}
          </select>
        </div>
      </div>
    </>
  )

  const resultNode = result ? (
    <div className="space-y-3">
      <h2 className="font-semibold text-sm">{result.variants?.length} Headline Variants - {result.platform}</h2>
      {result.variants?.map((v, i) => (
        <div key={i} className="p-4 rounded-xl border border-border bg-card space-y-2">
          <div className="flex items-start justify-between gap-2">
            <p className="font-medium text-sm flex-1">{v.text}</p>
            <span className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${ANGLE_COLORS[v.angle] || 'bg-muted text-muted-foreground'}`}>
              {v.angle}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">{v.psychology}</p>
          <p className="text-xs text-muted-foreground/60">{v.character_count} chars</p>
        </div>
      ))}
      {result.recommendation && (
        <div className="p-3 rounded-lg bg-primary/10 text-primary text-sm">
          <span className="font-medium">Recommendation: </span>{result.recommendation}
        </div>
      )}
    </div>
  ) : null

  return (
    <SSEFeaturePage projectId={projectId} title="Headline A/B Variants" subtitle="Claude copywriting"
      icon={<Type className="w-4 h-4" />} credits={5} steps={store.steps}
      isStreaming={store.isStreaming} streamText={store.streamText} form={form} result={resultNode}
      onSubmit={generate} submitLabel={`Generate ${count} Variants - 5 credits`} canSubmit={!!topic.trim()} />
  )
}
