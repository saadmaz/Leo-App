'use client'

import { useState, useRef } from 'react'
import { useParams } from 'next/navigation'
import { Video } from 'lucide-react'
import { toast } from 'sonner'
import { SSEFeaturePage } from '@/components/pillar1/SSEFeaturePage'
import { api } from '@/lib/api'
import { usePillar2Store } from '@/stores/pillar2-store'
import type { VideoScriptPayload, ProgressStep } from '@/types'

const PLATFORMS = ['YouTube', 'TikTok', 'LinkedIn', 'Instagram Reels', 'Twitter/X']

export default function VideoScriptPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const store = usePillar2Store()
  const [topic, setTopic] = useState('')
  const [platform, setPlatform] = useState('YouTube')
  const [duration, setDuration] = useState(3)
  const [cta, setCta] = useState('')
  const [result, setResult] = useState<VideoScriptPayload | null>(null)
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
      await api.pillar2.streamVideoScript(projectId,
        { topic: topic.trim(), platform, duration_minutes: duration, cta: cta || undefined, include_broll: true },
        {
          onStep: (step, label, status) => store.upsertStep(step, label, status as ProgressStep['status']),
          onDelta: (text) => store.appendStreamText(text),
          onSaved: (_id, payload) => { setResult(payload as unknown as VideoScriptPayload); store.clearStreamText(); store.setIsStreaming(false); toast.success('Script ready!') },
          onError: (msg) => { toast.error(msg); store.setIsStreaming(false) },
          onDone: () => store.setIsStreaming(false),
        },
        abortRef.current.signal,
      )
    } catch { store.setIsStreaming(false) }
  }

  const form = (
    <>
      <h2 className="font-semibold text-sm">Video Script Writer</h2>
      <div>
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Topic *</label>
        <textarea value={topic} onChange={(e) => setTopic(e.target.value)} rows={2}
          placeholder="e.g. '5 ways AI is changing content marketing in 2026'"
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
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Duration</label>
          <select value={duration} onChange={(e) => setDuration(Number(e.target.value))}
            className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary">
            {[1, 2, 3, 5, 8, 10, 15, 20].map((n) => <option key={n} value={n}>{n} min</option>)}
          </select>
        </div>
      </div>
      <div>
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">CTA Goal (optional)</label>
        <input value={cta} onChange={(e) => setCta(e.target.value)}
          placeholder="e.g. Subscribe, Visit leoagent.online, Book a demo"
          className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
      </div>
    </>
  )

  const resultNode = result ? (
    <div className="space-y-4">
      <div className="flex items-start justify-between">
        <h2 className="font-semibold text-sm">{result.title}</h2>
        {result.estimated_duration && (
          <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">{result.estimated_duration}</span>
        )}
      </div>

      {result.hook && (
        <div className="p-3 rounded-lg bg-primary/10 text-primary text-sm">
          <span className="font-medium text-xs uppercase tracking-wide block mb-1">Hook</span>
          {result.hook}
        </div>
      )}

      {result.sections?.map((s, i) => (
        <div key={i} className="p-4 rounded-xl border border-border bg-card space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono text-muted-foreground">{s.timestamp}</span>
            <span className="font-semibold text-sm">{s.section_title}</span>
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed">{s.script}</p>
          {s.broll && <p className="text-xs text-muted-foreground/70 italic">📹 B-Roll: {s.broll}</p>}
          {s.notes && <p className="text-xs text-muted-foreground/70">📝 {s.notes}</p>}
        </div>
      ))}

      {result.cta && (
        <div className="p-3 rounded-lg border border-border bg-card">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">CTA</p>
          <p className="text-sm">{result.cta}</p>
        </div>
      )}

      {result.tags && result.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {result.tags.map((t, i) => (
            <span key={i} className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">#{t}</span>
          ))}
        </div>
      )}
    </div>
  ) : null

  return (
    <SSEFeaturePage projectId={projectId} title="Video Script" subtitle="Claude scriptwriting"
      icon={<Video className="w-4 h-4" />} credits={15} steps={store.steps}
      isStreaming={store.isStreaming} streamText={store.streamText} form={form} result={resultNode}
      onSubmit={generate} submitLabel="Write Script - 15 credits" canSubmit={!!topic.trim()} />
  )
}
