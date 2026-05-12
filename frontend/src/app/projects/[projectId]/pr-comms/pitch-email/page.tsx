'use client'

import { useState, useRef } from 'react'
import { useParams } from 'next/navigation'
import { Mail, Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import { SSEFeaturePage } from '@/components/pillar1/SSEFeaturePage'
import { api } from '@/lib/api'
import { usePillar8Store } from '@/stores/pillar8-store'
import type { ProgressStep } from '@/types'
import { cn } from '@/lib/utils'

const TONES = ['professional', 'conversational', 'bold']

interface SubjectLine { line: string; rationale: string }
interface PitchPayload {
  subject_lines: SubjectLine[]
  pitch_email: string
  follow_up_template: string
  personalisation_used: string
  angle_fit_score: number
  angle_fit_rationale: string
  tips: string[]
  journalist_name: string
  journalist_outlet: string
  company_name: string
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

export default function PitchEmailPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const store = usePillar8Store()

  const [journalistName, setJournalistName] = useState('')
  const [journalistOutlet, setJournalistOutlet] = useState('')
  const [journalistBeat, setJournalistBeat] = useState('')
  const [recentArticle, setRecentArticle] = useState('')
  const [pitchAngle, setPitchAngle] = useState('')
  const [companyName, setCompanyName] = useState('')
  const [newsHook, setNewsHook] = useState('')
  const [keyStats, setKeyStats] = useState<string[]>([''])
  const [exclusive, setExclusive] = useState(false)
  const [tone, setTone] = useState('professional')
  const [result, setResult] = useState<PitchPayload | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  function addStat() { if (keyStats.length < 5) setKeyStats([...keyStats, '']) }
  function removeStat(i: number) { setKeyStats(keyStats.filter((_, idx) => idx !== i)) }
  function updateStat(i: number, v: string) { const n = [...keyStats]; n[i] = v; setKeyStats(n) }

  async function generate() {
    if (!journalistName.trim()) { toast.error('Enter the journalist name'); return }
    if (!journalistOutlet.trim()) { toast.error('Enter the outlet'); return }
    if (!pitchAngle.trim()) { toast.error('Describe your pitch angle'); return }
    if (!companyName.trim()) { toast.error('Enter your company name'); return }
    if (!newsHook.trim()) { toast.error('Enter the news hook'); return }

    abortRef.current?.abort()
    abortRef.current = new AbortController()
    store.setIsStreaming(true)
    store.clearSteps()
    store.clearStreamText()
    setResult(null)

    try {
      await api.pillar8.streamPitchEmail(
        projectId,
        {
          journalist_name: journalistName.trim(),
          journalist_outlet: journalistOutlet.trim(),
          journalist_beat: journalistBeat.trim() || undefined,
          recent_article: recentArticle.trim() || undefined,
          pitch_angle: pitchAngle.trim(),
          company_name: companyName.trim(),
          news_hook: newsHook.trim(),
          key_stats: keyStats.filter(Boolean).length > 0 ? keyStats.filter(Boolean) : undefined,
          exclusive_offer: exclusive,
          tone,
        },
        {
          onStep: (step, label, status) => store.upsertStep(step, label, status as ProgressStep['status']),
          onDelta: (text) => store.appendStreamText(text),
          onSaved: (_id, payload) => {
            setResult(payload as unknown as PitchPayload)
            store.clearStreamText()
            store.setIsStreaming(false)
            toast.success('Pitch email ready!')
          },
          onError: (msg) => { toast.error(msg); store.setIsStreaming(false) },
          onDone: () => store.setIsStreaming(false),
        },
        abortRef.current.signal,
      )
    } catch { store.setIsStreaming(false) }
  }

  const canSubmit = !!journalistName.trim() && !!journalistOutlet.trim() && !!pitchAngle.trim() && !!companyName.trim() && !!newsHook.trim()

  const scoreColor = (score: number) =>
    score >= 8 ? 'text-green-600 dark:text-green-400' : score >= 5 ? 'text-yellow-600 dark:text-yellow-400' : 'text-red-600 dark:text-red-400'

  const form = (
    <>
      <h2 className="font-semibold text-sm">Pitch Email Generator</h2>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Journalist Name *</label>
          <input value={journalistName} onChange={(e) => setJournalistName(e.target.value)} placeholder="Alex Johnson"
            className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Outlet *</label>
          <input value={journalistOutlet} onChange={(e) => setJournalistOutlet(e.target.value)} placeholder="TechCrunch"
            className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Their Beat</label>
          <input value={journalistBeat} onChange={(e) => setJournalistBeat(e.target.value)} placeholder="e.g. enterprise SaaS, AI/ML"
            className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Company Name *</label>
          <input value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="Acme Corp"
            className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
        </div>
      </div>

      <div>
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Recent Article (personalisation)</label>
        <input value={recentArticle} onChange={(e) => setRecentArticle(e.target.value)}
          placeholder="e.g. 'Why Enterprise AI Is Still Broken' - TechCrunch, March 2026"
          className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
      </div>

      <div>
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">News Hook *</label>
        <input value={newsHook} onChange={(e) => setNewsHook(e.target.value)}
          placeholder="e.g. Acme Corp raises $12M Series A - launching in 3 weeks"
          className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
      </div>

      <div>
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Pitch Angle *</label>
        <textarea value={pitchAngle} onChange={(e) => setPitchAngle(e.target.value)} rows={2}
          placeholder="Why is this story relevant to this journalist and their readers?"
          className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary resize-none" />
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Key Stats (optional)</label>
          {keyStats.length < 5 && (
            <button onClick={addStat} className="flex items-center gap-1 text-xs text-primary hover:text-primary/80">
              <Plus className="w-3 h-3" /> Add
            </button>
          )}
        </div>
        <div className="space-y-2">
          {keyStats.map((s, i) => (
            <div key={i} className="flex gap-2">
              <input value={s} onChange={(e) => updateStat(i, e.target.value)} placeholder={`Stat ${i + 1} - e.g. 40% cost reduction`}
                className="flex-1 px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
              {keyStats.length > 1 && <button onClick={() => removeStat(i)} className="text-muted-foreground hover:text-destructive"><X className="w-4 h-4" /></button>}
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between">
        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Tone</label>
          <div className="mt-1 flex gap-1.5">
            {TONES.map((t) => (
              <button key={t} onClick={() => setTone(t)}
                className={cn('px-2.5 py-1 text-xs rounded-lg border transition-colors capitalize',
                  tone === t ? 'bg-primary text-primary-foreground border-primary' : 'bg-background border-border hover:border-primary/50')}>
                {t}
              </button>
            ))}
          </div>
        </div>
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={exclusive} onChange={(e) => setExclusive(e.target.checked)} className="rounded border-border" />
          <span className="text-xs text-muted-foreground">Offer exclusive</span>
        </label>
      </div>
    </>
  )

  const resultNode = result ? (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-sm">Pitch for {result.journalist_name} @ {result.journalist_outlet}</h2>
        <div className="flex items-center gap-1">
          <span className="text-xs text-muted-foreground">Angle fit:</span>
          <span className={cn('text-sm font-bold', scoreColor(result.angle_fit_score))}>{result.angle_fit_score}/10</span>
        </div>
      </div>

      {result.angle_fit_rationale && (
        <p className="text-xs text-muted-foreground italic">{result.angle_fit_rationale}</p>
      )}

      <div className="space-y-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Subject Lines</p>
        {result.subject_lines?.map((s, i) => (
          <div key={i} className="p-3 rounded-lg border border-border bg-card">
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm font-medium">{s.line}</p>
              <CopyButton text={s.line} />
            </div>
            <p className="text-xs text-muted-foreground mt-1">{s.rationale}</p>
          </div>
        ))}
      </div>

      <div className="p-4 rounded-xl border border-border bg-card">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Pitch Email</p>
          <CopyButton text={result.pitch_email} />
        </div>
        <pre className="text-sm whitespace-pre-wrap font-sans leading-relaxed">{result.pitch_email}</pre>
      </div>

      {result.personalisation_used && (
        <div className="p-3 rounded-lg bg-primary/5 border border-primary/20">
          <p className="text-xs font-semibold text-primary uppercase tracking-wide mb-1">Personalisation Used</p>
          <p className="text-xs text-muted-foreground">{result.personalisation_used}</p>
        </div>
      )}

      {result.follow_up_template && (
        <div className="p-4 rounded-xl border border-border bg-card">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Follow-up (send after 5 days)</p>
            <CopyButton text={result.follow_up_template} />
          </div>
          <pre className="text-xs whitespace-pre-wrap font-sans text-muted-foreground leading-relaxed">{result.follow_up_template}</pre>
        </div>
      )}

      {result.tips && result.tips.length > 0 && (
        <div className="p-4 rounded-xl border border-border bg-card">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Tips</p>
          <ul className="space-y-1">
            {result.tips.map((tip, i) => (
              <li key={i} className="text-xs text-muted-foreground flex gap-2"><span className="text-primary">•</span>{tip}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  ) : null

  return (
    <SSEFeaturePage
      projectId={projectId}
      title="Pitch Email Generator"
      subtitle="Pillar 8 - Claude"
      icon={<Mail className="w-4 h-4" />}
      credits={10}
      steps={store.steps}
      isStreaming={store.isStreaming}
      streamText={store.streamText}
      form={form}
      result={resultNode}
      onSubmit={generate}
      submitLabel="Generate Pitch Email - 10 credits"
      canSubmit={canSubmit}
      backPath={`/projects/${projectId}/pr-comms`}
    />
  )
}
