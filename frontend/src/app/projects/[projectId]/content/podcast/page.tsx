'use client'

import { useState, useRef } from 'react'
import { useParams } from 'next/navigation'
import { Mic } from 'lucide-react'
import { toast } from 'sonner'
import { SSEFeaturePage } from '@/components/pillar1/SSEFeaturePage'
import { api } from '@/lib/api'
import { usePillar2Store } from '@/stores/pillar2-store'
import type { PodcastPayload, ProgressStep } from '@/types'

export default function PodcastPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const store = usePillar2Store()
  const [mode, setMode] = useState<'url' | 'transcript'>('transcript')
  const [audioUrl, setAudioUrl] = useState('')
  const [transcript, setTranscript] = useState('')
  const [episodeTitle, setEpisodeTitle] = useState('')
  const [speakers, setSpeakers] = useState('')
  const [result, setResult] = useState<PodcastPayload | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  async function generate() {
    if (mode === 'url' && !audioUrl.trim()) { toast.error('Audio URL is required'); return }
    if (mode === 'transcript' && !transcript.trim()) { toast.error('Transcript is required'); return }
    abortRef.current?.abort()
    abortRef.current = new AbortController()
    store.setIsStreaming(true)
    store.clearSteps()
    store.clearStreamText()
    setResult(null)
    const speakerList = speakers.split(',').map((s) => s.trim()).filter(Boolean)
    try {
      await api.pillar2.streamPodcast(projectId,
        {
          audio_url: mode === 'url' ? audioUrl.trim() : undefined,
          transcript: mode === 'transcript' ? transcript.trim() : undefined,
          episode_title: episodeTitle.trim() || undefined,
          speaker_names: speakerList.length > 0 ? speakerList : undefined,
        },
        {
          onStep: (step, label, status) => store.upsertStep(step, label, status as ProgressStep['status']),
          onDelta: (text) => store.appendStreamText(text),
          onSaved: (_id, payload) => { setResult(payload as unknown as PodcastPayload); store.clearStreamText(); store.setIsStreaming(false); toast.success('Show notes ready!') },
          onError: (msg) => { toast.error(msg); store.setIsStreaming(false) },
          onDone: () => store.setIsStreaming(false),
        },
        abortRef.current.signal,
      )
    } catch { store.setIsStreaming(false) }
  }

  const canSubmit = mode === 'url' ? !!audioUrl.trim() : !!transcript.trim()

  const form = (
    <>
      <h2 className="font-semibold text-sm">Podcast Show Notes</h2>

      {/* Mode toggle */}
      <div className="flex rounded-lg border border-border overflow-hidden">
        {(['transcript', 'url'] as const).map((m) => (
          <button key={m} onClick={() => setMode(m)}
            className={`flex-1 py-2 text-xs font-medium transition-colors ${mode === m ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}>
            {m === 'transcript' ? 'Paste Transcript' : 'Audio URL (Whisper)'}
          </button>
        ))}
      </div>

      {mode === 'url' ? (
        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Audio URL * (mp3, mp4, wav, m4a)</label>
          <input value={audioUrl} onChange={(e) => setAudioUrl(e.target.value)}
            placeholder="https://example.com/episode.mp3"
            className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
          <p className="text-xs text-muted-foreground mt-1">Requires OPENAI_API_KEY ($0.006/min audio)</p>
        </div>
      ) : (
        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Transcript *</label>
          <textarea value={transcript} onChange={(e) => setTranscript(e.target.value)} rows={6}
            placeholder="Paste your podcast transcript here..."
            className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary resize-none" />
        </div>
      )}

      <div>
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Episode Title (optional)</label>
        <input value={episodeTitle} onChange={(e) => setEpisodeTitle(e.target.value)}
          placeholder="e.g. #42 - How AI is Changing Marketing"
          className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
      </div>
      <div>
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Speakers (optional, comma-separated)</label>
        <input value={speakers} onChange={(e) => setSpeakers(e.target.value)}
          placeholder="e.g. John Smith, Jane Doe"
          className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
      </div>
    </>
  )

  const resultNode = result ? (
    <div className="space-y-4">
      <h2 className="font-semibold text-sm">{result.episode_title}</h2>

      <div className="p-4 rounded-xl border border-border bg-card">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Summary</p>
        <p className="text-sm text-muted-foreground">{result.summary}</p>
      </div>

      {result.key_takeaways?.length > 0 && (
        <div className="p-4 rounded-xl border border-border bg-card">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Key Takeaways</p>
          {result.key_takeaways.map((t, i) => (
            <p key={i} className="text-sm text-muted-foreground">• {t}</p>
          ))}
        </div>
      )}

      {result.timestamps?.length > 0 && (
        <div className="p-4 rounded-xl border border-border bg-card">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Timestamps</p>
          {result.timestamps.map((t, i) => (
            <p key={i} className="text-xs text-muted-foreground font-mono">{t.time} - {t.topic}</p>
          ))}
        </div>
      )}

      {result.notable_quotes?.length > 0 && (
        <div className="p-4 rounded-xl border border-border bg-card space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Notable Quotes</p>
          {result.notable_quotes.map((q, i) => (
            <blockquote key={i} className="border-l-2 border-primary pl-3">
              <p className="text-sm italic">&ldquo;{q.quote}&rdquo;</p>
              <p className="text-xs text-muted-foreground mt-0.5">- {q.speaker}</p>
            </blockquote>
          ))}
        </div>
      )}

      {result.platform_description && (
        <div className="p-4 rounded-xl border border-border bg-card">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Platform Description</p>
          <p className="text-sm text-muted-foreground whitespace-pre-wrap">{result.platform_description}</p>
        </div>
      )}

      {result.linkedin_post && (
        <div className="p-4 rounded-xl border border-border bg-card">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">LinkedIn Post</p>
          <p className="text-sm text-muted-foreground whitespace-pre-wrap">{result.linkedin_post}</p>
        </div>
      )}
    </div>
  ) : null

  return (
    <SSEFeaturePage projectId={projectId} title="Podcast Show Notes" subtitle="Whisper + Claude"
      icon={<Mic className="w-4 h-4" />} credits={20} steps={store.steps}
      isStreaming={store.isStreaming} streamText={store.streamText} form={form} result={resultNode}
      onSubmit={generate} submitLabel="Generate Show Notes - 20 credits" canSubmit={canSubmit} />
  )
}
