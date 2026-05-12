'use client'

import { useState, useRef } from 'react'
import { useParams } from 'next/navigation'
import { Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { SSEFeaturePage } from '@/components/pillar1/SSEFeaturePage'
import { api } from '@/lib/api'
import { usePillar5Store } from '@/stores/pillar5-store'
import type { ProgressStep } from '@/types'
import { cn } from '@/lib/utils'

const TONES = ['conversational', 'professional', 'urgent', 'playful', 'curious']
const GOALS = ['open_rate', 'click_rate', 'reply_rate']

interface SubjectVariant {
  variant_id: string
  subject_line: string
  preview_text: string
  angle: string
  predicted_open_rate_score: number
  score_rationale: string
  character_count: number
  emoji_used: boolean
  spam_risk: 'low' | 'medium' | 'high'
  spam_flags: string[]
  best_for: string
}

interface SubjectPayload {
  email_topic: string
  variants: SubjectVariant[]
  recommended_variant: string
  recommendation_rationale: string
  a_b_test_pairs: { test_name: string; variant_a: string; variant_b: string; what_you_are_testing: string }[]
  deliverability_notes: string
  timing_tip: string
}

const SPAM_COLORS = { low: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400', medium: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400', high: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' }

function ScoreDots({ score }: { score: number }) {
  const color = score >= 8 ? 'bg-green-500' : score >= 6 ? 'bg-yellow-500' : 'bg-red-500'
  return (
    <div className="flex items-center gap-0.5">
      {Array.from({ length: 10 }).map((_, i) => (
        <div key={i} className={cn('w-2 h-2 rounded-full', i < score ? color : 'bg-muted')} />
      ))}
      <span className="ml-1.5 text-xs font-bold">{score}/10</span>
    </div>
  )
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

export default function SubjectLinesPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const store = usePillar5Store()

  const [topic, setTopic] = useState('')
  const [audience, setAudience] = useState('')
  const [goal, setGoal] = useState('open_rate')
  const [tone, setTone] = useState('conversational')
  const [numVariants, setNumVariants] = useState(5)
  const [avoidSpam, setAvoidSpam] = useState(true)
  const [result, setResult] = useState<SubjectPayload | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  async function generate() {
    if (!topic.trim()) { toast.error('Describe the email topic'); return }
    if (!audience.trim()) { toast.error('Describe the audience'); return }
    abortRef.current?.abort(); abortRef.current = new AbortController()
    store.setIsStreaming(true); store.clearSteps(); store.clearStreamText(); setResult(null)
    try {
      await api.pillar5.streamSubjectLines(projectId,
        { email_topic: topic.trim(), audience: audience.trim(), goal, num_variants: numVariants, tone, avoid_spam_words: avoidSpam },
        {
          onStep: (s, l, st) => store.upsertStep(s, l, st as ProgressStep['status']),
          onDelta: (t) => store.appendStreamText(t),
          onSaved: (_, p) => { setResult(p as unknown as SubjectPayload); store.clearStreamText(); store.setIsStreaming(false); toast.success('Subject lines ready!') },
          onError: (m) => { toast.error(m); store.setIsStreaming(false) },
          onDone: () => store.setIsStreaming(false),
        }, abortRef.current.signal)
    } catch { store.setIsStreaming(false) }
  }

  const form = (
    <>
      <h2 className="font-semibold text-sm">Subject Line Optimiser</h2>
      <div>
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Email Topic *</label>
        <textarea value={topic} onChange={(e) => setTopic(e.target.value)} rows={2}
          placeholder="e.g. Announcing our new AI-powered reporting dashboard - for existing customers"
          className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary resize-none" />
      </div>
      <div>
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Audience *</label>
        <input value={audience} onChange={(e) => setAudience(e.target.value)}
          placeholder="e.g. Active Pro subscribers, 30–45, B2B marketers"
          className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Optimise For</label>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {GOALS.map((g) => (
              <button key={g} onClick={() => setGoal(g)}
                className={cn('px-2.5 py-1 text-xs rounded-lg border transition-colors',
                  goal === g ? 'bg-primary text-primary-foreground border-primary' : 'bg-background border-border hover:border-primary/50')}>
                {g.replace(/_/g, ' ')}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Tone</label>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {TONES.map((t) => (
              <button key={t} onClick={() => setTone(t)}
                className={cn('px-2.5 py-1 text-xs rounded-lg border capitalize transition-colors',
                  tone === t ? 'bg-primary text-primary-foreground border-primary' : 'bg-background border-border hover:border-primary/50')}>
                {t}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-4">
        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Variants</label>
          <select value={numVariants} onChange={(e) => setNumVariants(Number(e.target.value))}
            className="mt-1 px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary">
            {[3, 5, 7, 10].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-2 mt-4">
          <input type="checkbox" id="spam" checked={avoidSpam} onChange={(e) => setAvoidSpam(e.target.checked)} className="rounded" />
          <label htmlFor="spam" className="text-xs cursor-pointer">Strict spam filtering</label>
        </div>
      </div>
    </>
  )

  const resultNode = result ? (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-sm">Subject Line Variants</h2>
        {result.recommended_variant && (
          <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">Recommended: {result.recommended_variant}</span>
        )}
      </div>
      {result.recommendation_rationale && (
        <p className="text-xs text-muted-foreground">{result.recommendation_rationale}</p>
      )}

      {result.variants?.map((v, i) => (
        <div key={i} className={cn('p-4 rounded-xl border bg-card space-y-2',
          v.variant_id === result.recommended_variant ? 'border-primary/50 bg-primary/5' : 'border-border')}>
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="w-5 h-5 rounded bg-primary/10 text-primary text-[10px] font-bold flex items-center justify-center">{v.variant_id}</span>
              <span className={cn('text-[10px] px-1.5 py-0.5 rounded-full font-medium capitalize', SPAM_COLORS[v.spam_risk])}>
                {v.spam_risk} risk
              </span>
              {v.emoji_used && <span className="text-[10px] text-muted-foreground">emoji</span>}
            </div>
            <CopyBtn text={v.subject_line} />
          </div>
          <p className="text-sm font-medium">{v.subject_line}</p>
          {v.preview_text && <p className="text-[10px] text-muted-foreground">Preview: {v.preview_text}</p>}
          <ScoreDots score={v.predicted_open_rate_score} />
          <p className="text-xs text-muted-foreground">{v.score_rationale}</p>
          <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
            <span>{v.character_count} chars</span>
            <span className="capitalize">Angle: {v.angle?.replace(/_/g, ' ')}</span>
            <span className="ml-auto italic">{v.best_for}</span>
          </div>
          {v.spam_flags?.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {v.spam_flags.map((f, j) => <span key={j} className="text-[10px] px-1.5 py-0.5 bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400 rounded">{f}</span>)}
            </div>
          )}
        </div>
      ))}

      {result.a_b_test_pairs?.length > 0 && (
        <div className="p-4 rounded-xl border border-border bg-card space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">A/B Test Pairs</p>
          {result.a_b_test_pairs.map((p, i) => (
            <div key={i} className="text-xs space-y-0.5">
              <p className="font-medium">{p.test_name}</p>
              <p className="text-muted-foreground">A: {p.variant_a} vs B: {p.variant_b}</p>
              <p className="text-muted-foreground italic">Testing: {p.what_you_are_testing}</p>
            </div>
          ))}
        </div>
      )}

      {result.deliverability_notes && (
        <div className="p-3 rounded-lg border border-border bg-muted/30 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Deliverability: </span>{result.deliverability_notes}
        </div>
      )}
      {result.timing_tip && (
        <div className="p-3 rounded-lg border border-primary/20 bg-primary/5 text-xs text-muted-foreground">
          <span className="font-medium text-primary">Timing tip: </span>{result.timing_tip}
        </div>
      )}
    </div>
  ) : null

  return (
    <SSEFeaturePage projectId={projectId} title="Subject Line Optimiser" subtitle="Pillar 5 - Claude"
      icon={<Sparkles className="w-4 h-4" />} credits={5} steps={store.steps}
      isStreaming={store.isStreaming} streamText={store.streamText} form={form} result={resultNode}
      onSubmit={generate} submitLabel="Optimise Subject Lines - 5 credits" canSubmit={!!topic.trim() && !!audience.trim()}
      backPath={`/projects/${projectId}/email-crm`} />
  )
}
