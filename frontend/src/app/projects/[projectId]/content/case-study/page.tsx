'use client'

import { useState, useRef } from 'react'
import { useParams } from 'next/navigation'
import { BookOpen } from 'lucide-react'
import { toast } from 'sonner'
import { SSEFeaturePage } from '@/components/pillar1/SSEFeaturePage'
import { api } from '@/lib/api'
import { usePillar2Store } from '@/stores/pillar2-store'
import type { CaseStudyPayload, ProgressStep } from '@/types'

export default function CaseStudyPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const store = usePillar2Store()
  const [clientName, setClientName] = useState('')
  const [industry, setIndustry] = useState('')
  const [challenge, setChallenge] = useState('')
  const [solution, setSolution] = useState('')
  const [results, setResults] = useState('')
  const [testimonial, setTestimonial] = useState('')
  const [result, setResult] = useState<CaseStudyPayload | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const canSubmit = !!clientName.trim() && !!industry.trim() && !!challenge.trim() && !!solution.trim() && !!results.trim()

  async function generate() {
    if (!canSubmit) { toast.error('Please fill in all required fields'); return }
    abortRef.current?.abort()
    abortRef.current = new AbortController()
    store.setIsStreaming(true)
    store.clearSteps()
    store.clearStreamText()
    setResult(null)
    try {
      await api.pillar2.streamCaseStudy(projectId,
        {
          client_name: clientName.trim(),
          industry: industry.trim(),
          challenge: challenge.trim(),
          solution: solution.trim(),
          results: results.trim(),
          testimonial: testimonial.trim() || undefined,
        },
        {
          onStep: (step, label, status) => store.upsertStep(step, label, status as ProgressStep['status']),
          onDelta: (text) => store.appendStreamText(text),
          onSaved: (_id, payload) => { setResult(payload as unknown as CaseStudyPayload); store.clearStreamText(); store.setIsStreaming(false); toast.success('Case study ready!') },
          onError: (msg) => { toast.error(msg); store.setIsStreaming(false) },
          onDone: () => store.setIsStreaming(false),
        },
        abortRef.current.signal,
      )
    } catch { store.setIsStreaming(false) }
  }

  const form = (
    <>
      <h2 className="font-semibold text-sm">Case Study Production</h2>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Client Name *</label>
          <input value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="e.g. Acme Corp"
            className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Industry *</label>
          <input value={industry} onChange={(e) => setIndustry(e.target.value)} placeholder="e.g. B2B SaaS"
            className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
        </div>
      </div>
      {[
        { label: 'Challenge *', value: challenge, setter: setChallenge, placeholder: 'What problem did they face before using your product?' },
        { label: 'Solution *', value: solution, setter: setSolution, placeholder: 'How did your product/service solve it? What did you implement?' },
        { label: 'Results / Metrics *', value: results, setter: setResults, placeholder: 'e.g. 40% revenue increase in 3 months, saved 10h/week, 3x ROI' },
        { label: 'Testimonial (optional)', value: testimonial, setter: setTestimonial, placeholder: 'Client quote if available' },
      ].map(({ label, value, setter, placeholder }) => (
        <div key={label}>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</label>
          <textarea value={value} onChange={(e) => setter(e.target.value)} rows={3} placeholder={placeholder}
            className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary resize-none" />
        </div>
      ))}
    </>
  )

  const resultNode = result ? (
    <div className="space-y-4">
      <div>
        <h2 className="font-bold text-base">{result.headline}</h2>
        {result.subheadline && <p className="text-sm text-muted-foreground mt-0.5">{result.subheadline}</p>}
      </div>

      {result.key_stats?.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          {result.key_stats.map((s, i) => (
            <div key={i} className="p-3 rounded-xl border border-border bg-card text-center">
              <p className="text-xl font-bold text-primary">{s.metric}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>
      )}

      {result.sections?.map((s, i) => (
        <div key={i} className="p-4 rounded-xl border border-border bg-card space-y-2">
          <p className="font-semibold text-sm">{s.title}</p>
          <p className="text-sm text-muted-foreground whitespace-pre-wrap">{s.content}</p>
          {s.pull_quote && (
            <blockquote className="border-l-2 border-primary pl-3 text-sm italic text-muted-foreground">
              &ldquo;{s.pull_quote}&rdquo;
            </blockquote>
          )}
        </div>
      ))}

      {result.testimonial_formatted && (
        <div className="p-4 rounded-xl border border-primary/20 bg-primary/5">
          <p className="text-sm italic">{result.testimonial_formatted}</p>
        </div>
      )}

      {result.cta && (
        <div className="p-3 rounded-lg bg-primary text-primary-foreground text-sm text-center font-medium">
          {result.cta}
        </div>
      )}

      {result.social_proof_snippet && (
        <div className="p-3 rounded-lg border border-border bg-muted text-xs text-muted-foreground">
          <p className="font-semibold mb-1">Social proof snippet</p>
          <p>{result.social_proof_snippet}</p>
        </div>
      )}
    </div>
  ) : null

  return (
    <SSEFeaturePage projectId={projectId} title="Case Study Production" subtitle="Claude narrative writing"
      icon={<BookOpen className="w-4 h-4" />} credits={15} steps={store.steps}
      isStreaming={store.isStreaming} streamText={store.streamText} form={form} result={resultNode}
      onSubmit={generate} submitLabel="Generate Case Study - 15 credits" canSubmit={canSubmit} />
  )
}
