'use client'

import { useState, useRef } from 'react'
import { useParams } from 'next/navigation'
import { Trophy, Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import { SSEFeaturePage } from '@/components/pillar1/SSEFeaturePage'
import { api } from '@/lib/api'
import { usePillar8Store } from '@/stores/pillar8-store'
import type { ProgressStep } from '@/types'

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500) }}
      className="text-[10px] text-muted-foreground hover:text-primary px-1.5 py-0.5 rounded border border-border hover:border-primary/50 shrink-0">
      {copied ? 'Copied!' : 'Copy'}
    </button>
  )
}

interface AwardPayload {
  submission_title: string
  executive_summary: string
  main_submission: string
  key_achievements_highlighted: Array<{ achievement: string; metric?: string; impact: string }>
  judge_takeaways: string[]
  supporting_evidence_suggestions: string[]
  word_count: number
  criteria_addressed: string[]
  submission_tips: string[]
  award_name: string
  company_name: string
  award_category?: string
}

export default function AwardsPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const store = usePillar8Store()

  const [awardName, setAwardName] = useState('')
  const [awardUrl, setAwardUrl] = useState('')
  const [awardCategory, setAwardCategory] = useState('')
  const [companyName, setCompanyName] = useState('')
  const [submissionAngle, setSubmissionAngle] = useState('')
  const [achievements, setAchievements] = useState<string[]>([''])
  const [wordLimit, setWordLimit] = useState('')
  const [supportingData, setSupportingData] = useState<string[]>([''])
  const [result, setResult] = useState<AwardPayload | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  function addItem(list: string[], set: (v: string[]) => void) { if (list.length < 10) set([...list, '']) }
  function removeItem(i: number, list: string[], set: (v: string[]) => void) { set(list.filter((_, idx) => idx !== i)) }
  function updateItem(i: number, v: string, list: string[], set: (v: string[]) => void) { const n = [...list]; n[i] = v; set(n) }

  async function generate() {
    if (!awardName.trim()) { toast.error('Enter the award name'); return }
    if (!companyName.trim()) { toast.error('Enter the company name'); return }
    if (!submissionAngle.trim()) { toast.error('Describe the submission angle'); return }
    if (achievements.filter(Boolean).length === 0) { toast.error('Add at least one key achievement'); return }

    abortRef.current?.abort()
    abortRef.current = new AbortController()
    store.setIsStreaming(true)
    store.clearSteps()
    store.clearStreamText()
    setResult(null)

    try {
      await api.pillar8.streamAwardSubmission(
        projectId,
        {
          award_name: awardName.trim(),
          award_url: awardUrl.trim() || undefined,
          award_category: awardCategory.trim() || undefined,
          company_name: companyName.trim(),
          submission_angle: submissionAngle.trim(),
          key_achievements: achievements.filter(Boolean),
          word_limit: wordLimit ? Number(wordLimit) : undefined,
          supporting_data: supportingData.filter(Boolean).length > 0 ? supportingData.filter(Boolean) : undefined,
        },
        {
          onStep: (step, label, status) => store.upsertStep(step, label, status as ProgressStep['status']),
          onDelta: (text) => store.appendStreamText(text),
          onSaved: (_id, payload) => {
            setResult(payload as unknown as AwardPayload)
            store.clearStreamText()
            store.setIsStreaming(false)
            toast.success('Award submission ready!')
          },
          onError: (msg) => { toast.error(msg); store.setIsStreaming(false) },
          onDone: () => store.setIsStreaming(false),
        },
        abortRef.current.signal,
      )
    } catch { store.setIsStreaming(false) }
  }

  const canSubmit = !!awardName.trim() && !!companyName.trim() && !!submissionAngle.trim() && achievements.filter(Boolean).length > 0

  const form = (
    <>
      <h2 className="font-semibold text-sm">Award Submissions</h2>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Award Name *</label>
          <input value={awardName} onChange={(e) => setAwardName(e.target.value)} placeholder="e.g. Deloitte Fast 50"
            className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Category</label>
          <input value={awardCategory} onChange={(e) => setAwardCategory(e.target.value)} placeholder="e.g. Best AI Product"
            className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
        </div>
      </div>

      <div>
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Award Page URL (Firecrawl reads criteria)</label>
        <input value={awardUrl} onChange={(e) => setAwardUrl(e.target.value)} placeholder="https://award-site.com/apply"
          className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Company Name *</label>
          <input value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="Acme Corp"
            className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Word Limit</label>
          <input type="number" value={wordLimit} onChange={(e) => setWordLimit(e.target.value)} placeholder="e.g. 500"
            className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
        </div>
      </div>

      <div>
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Submission Angle *</label>
        <textarea value={submissionAngle} onChange={(e) => setSubmissionAngle(e.target.value)} rows={2}
          placeholder="e.g. How we grew ARR by 300% while maintaining 95% customer retention in a challenging market"
          className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary resize-none" />
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Key Achievements *</label>
          {achievements.length < 10 && (
            <button onClick={() => addItem(achievements, setAchievements)} className="flex items-center gap-1 text-xs text-primary hover:text-primary/80">
              <Plus className="w-3 h-3" /> Add
            </button>
          )}
        </div>
        <div className="space-y-2">
          {achievements.map((a, i) => (
            <div key={i} className="flex gap-2">
              <input value={a} onChange={(e) => updateItem(i, e.target.value, achievements, setAchievements)}
                placeholder="e.g. 300% ARR growth, £4.2M revenue, 95% retention rate"
                className="flex-1 px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
              {achievements.length > 1 && <button onClick={() => removeItem(i, achievements, setAchievements)} className="text-muted-foreground hover:text-destructive"><X className="w-4 h-4" /></button>}
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Supporting Data (optional)</label>
          {supportingData.length < 8 && (
            <button onClick={() => addItem(supportingData, setSupportingData)} className="flex items-center gap-1 text-xs text-primary hover:text-primary/80">
              <Plus className="w-3 h-3" /> Add
            </button>
          )}
        </div>
        <div className="space-y-2">
          {supportingData.map((d, i) => (
            <div key={i} className="flex gap-2">
              <input value={d} onChange={(e) => updateItem(i, e.target.value, supportingData, setSupportingData)}
                placeholder="e.g. NPS score of 72, 3 enterprise logos won in Q1"
                className="flex-1 px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
              {supportingData.length > 1 && <button onClick={() => removeItem(i, supportingData, setSupportingData)} className="text-muted-foreground hover:text-destructive"><X className="w-4 h-4" /></button>}
            </div>
          ))}
        </div>
      </div>
    </>
  )

  const resultNode = result ? (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-sm">{result.award_name} - {result.company_name}</h2>
        <span className="text-xs text-muted-foreground">{result.word_count} words</span>
      </div>

      <div className="p-4 rounded-xl border border-border bg-card">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Executive Summary</p>
          <CopyButton text={result.executive_summary} />
        </div>
        <p className="text-sm">{result.executive_summary}</p>
      </div>

      <div className="p-4 rounded-xl border border-border bg-card">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Main Submission</p>
          <CopyButton text={result.main_submission} />
        </div>
        <p className="text-sm whitespace-pre-wrap leading-relaxed">{result.main_submission}</p>
      </div>

      {result.judge_takeaways?.length > 0 && (
        <div className="p-4 rounded-xl border border-primary/20 bg-primary/5">
          <p className="text-xs font-semibold text-primary uppercase tracking-wide mb-2">What Judges Should Remember</p>
          <ul className="space-y-1">
            {result.judge_takeaways.map((t, i) => <li key={i} className="text-xs text-muted-foreground flex gap-2"><span className="text-primary">•</span>{t}</li>)}
          </ul>
        </div>
      )}

      {result.criteria_addressed?.length > 0 && (
        <div className="p-4 rounded-xl border border-border bg-card">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Criteria Addressed</p>
          <div className="flex flex-wrap gap-2">
            {result.criteria_addressed.map((c, i) => <span key={i} className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary">{c}</span>)}
          </div>
        </div>
      )}

      {result.supporting_evidence_suggestions?.length > 0 && (
        <div className="p-4 rounded-xl border border-border bg-card">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Evidence to Attach</p>
          <ul className="space-y-1">
            {result.supporting_evidence_suggestions.map((s, i) => <li key={i} className="text-xs text-muted-foreground flex gap-2"><span className="text-primary">•</span>{s}</li>)}
          </ul>
        </div>
      )}

      {result.submission_tips?.length > 0 && (
        <div className="p-4 rounded-xl border border-border bg-card">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Submission Tips</p>
          <ul className="space-y-1">
            {result.submission_tips.map((t, i) => <li key={i} className="text-xs text-muted-foreground flex gap-2"><span className="text-primary">•</span>{t}</li>)}
          </ul>
        </div>
      )}
    </div>
  ) : null

  return (
    <SSEFeaturePage
      projectId={projectId}
      title="Award Submissions"
      subtitle="Pillar 8 - Firecrawl + Claude"
      icon={<Trophy className="w-4 h-4" />}
      credits={15}
      steps={store.steps}
      isStreaming={store.isStreaming}
      streamText={store.streamText}
      form={form}
      result={resultNode}
      onSubmit={generate}
      submitLabel="Draft Award Submission - 15 credits"
      canSubmit={canSubmit}
      backPath={`/projects/${projectId}/pr-comms`}
    />
  )
}
