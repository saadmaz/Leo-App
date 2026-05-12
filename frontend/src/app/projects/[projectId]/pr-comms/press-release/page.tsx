'use client'

import { useState, useRef } from 'react'
import { useParams } from 'next/navigation'
import { FileText, Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import { SSEFeaturePage } from '@/components/pillar1/SSEFeaturePage'
import { api } from '@/lib/api'
import { usePillar8Store } from '@/stores/pillar8-store'
import type { ProgressStep } from '@/types'
import { cn } from '@/lib/utils'

const NEWS_TYPES = [
  { id: 'product_launch', label: 'Product Launch' },
  { id: 'funding', label: 'Funding Round' },
  { id: 'partnership', label: 'Partnership' },
  { id: 'milestone', label: 'Milestone' },
  { id: 'executive_hire', label: 'Executive Hire' },
  { id: 'award', label: 'Award / Recognition' },
]

const TONES = ['professional', 'conversational', 'bold']

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500) }}
      className="text-[10px] text-muted-foreground hover:text-primary px-1.5 py-0.5 rounded border border-border hover:border-primary/50 shrink-0">
      {copied ? 'Copied!' : 'Copy'}
    </button>
  )
}

interface PressReleasePayload {
  headline: string
  subheadline?: string
  dateline: string
  lead_paragraph: string
  body_paragraphs: string[]
  quote?: { text: string; speaker_name: string; speaker_title: string }
  boilerplate: string
  media_contact: string
  embargo_note?: string
  seo_keywords?: string[]
  editorial_notes?: string
  company_name: string
  news_type: string
}

export default function PressReleasePage() {
  const { projectId } = useParams<{ projectId: string }>()
  const store = usePillar8Store()

  const [newsType, setNewsType] = useState('product_launch')
  const [headlineTopic, setHeadlineTopic] = useState('')
  const [companyName, setCompanyName] = useState('')
  const [keyFacts, setKeyFacts] = useState<string[]>([''])
  const [quoteName, setQuoteName] = useState('')
  const [quoteTitle, setQuoteTitle] = useState('')
  const [quoteHint, setQuoteHint] = useState('')
  const [targetAudience, setTargetAudience] = useState('')
  const [embargoDate, setEmbargoDate] = useState('')
  const [boilerplate, setBoilerplate] = useState('')
  const [tone, setTone] = useState('professional')
  const [result, setResult] = useState<PressReleasePayload | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  function addFact() { if (keyFacts.length < 10) setKeyFacts([...keyFacts, '']) }
  function removeFact(i: number) { setKeyFacts(keyFacts.filter((_, idx) => idx !== i)) }
  function updateFact(i: number, val: string) { const n = [...keyFacts]; n[i] = val; setKeyFacts(n) }

  async function generate() {
    if (!headlineTopic.trim()) { toast.error('Enter the core announcement'); return }
    if (!companyName.trim()) { toast.error('Enter your company name'); return }
    if (keyFacts.filter(Boolean).length === 0) { toast.error('Add at least one key fact'); return }

    abortRef.current?.abort()
    abortRef.current = new AbortController()
    store.setIsStreaming(true)
    store.clearSteps()
    store.clearStreamText()
    setResult(null)

    try {
      await api.pillar8.streamPressRelease(
        projectId,
        {
          news_type: newsType,
          headline_topic: headlineTopic.trim(),
          company_name: companyName.trim(),
          key_facts: keyFacts.filter(Boolean),
          quote_name: quoteName.trim() || undefined,
          quote_title: quoteTitle.trim() || undefined,
          quote_hint: quoteHint.trim() || undefined,
          target_audience: targetAudience.trim() || undefined,
          embargo_date: embargoDate.trim() || undefined,
          boilerplate: boilerplate.trim() || undefined,
          tone,
        },
        {
          onStep: (step, label, status) => store.upsertStep(step, label, status as ProgressStep['status']),
          onDelta: (text) => store.appendStreamText(text),
          onSaved: (_id, payload) => {
            setResult(payload as unknown as PressReleasePayload)
            store.clearStreamText()
            store.setIsStreaming(false)
            toast.success('Press release ready!')
          },
          onError: (msg) => { toast.error(msg); store.setIsStreaming(false) },
          onDone: () => store.setIsStreaming(false),
        },
        abortRef.current.signal,
      )
    } catch { store.setIsStreaming(false) }
  }

  const canSubmit = !!headlineTopic.trim() && !!companyName.trim() && keyFacts.filter(Boolean).length > 0

  const form = (
    <>
      <h2 className="font-semibold text-sm">Press Release Writer</h2>

      <div>
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">News Type *</label>
        <div className="mt-1 flex flex-wrap gap-2">
          {NEWS_TYPES.map((t) => (
            <button key={t.id} onClick={() => setNewsType(t.id)}
              className={cn('px-3 py-1.5 text-xs rounded-lg border transition-colors',
                newsType === t.id ? 'bg-primary text-primary-foreground border-primary' : 'bg-background border-border hover:border-primary/50')}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Company Name *</label>
          <input value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="Acme Corp"
            className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Target Audience</label>
          <input value={targetAudience} onChange={(e) => setTargetAudience(e.target.value)} placeholder="tech press, investors…"
            className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
        </div>
      </div>

      <div>
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Core Announcement *</label>
        <textarea value={headlineTopic} onChange={(e) => setHeadlineTopic(e.target.value)} rows={2}
          placeholder="e.g. Acme Corp raises $12M Series A to expand AI-powered logistics platform"
          className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary resize-none" />
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Key Facts *</label>
          {keyFacts.length < 10 && (
            <button onClick={addFact} className="flex items-center gap-1 text-xs text-primary hover:text-primary/80">
              <Plus className="w-3 h-3" /> Add
            </button>
          )}
        </div>
        <div className="space-y-2">
          {keyFacts.map((f, i) => (
            <div key={i} className="flex gap-2">
              <input value={f} onChange={(e) => updateFact(i, e.target.value)}
                placeholder={`Fact ${i + 1} - e.g. $12M raised, 3 lead investors, closing date`}
                className="flex-1 px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
              {keyFacts.length > 1 && (
                <button onClick={() => removeFact(i)} className="text-muted-foreground hover:text-destructive">
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Quote - Speaker Name</label>
          <input value={quoteName} onChange={(e) => setQuoteName(e.target.value)} placeholder="Jane Smith"
            className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Speaker Title</label>
          <input value={quoteTitle} onChange={(e) => setQuoteTitle(e.target.value)} placeholder="CEO & Co-founder"
            className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
        </div>
      </div>

      {quoteName && (
        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Quote Direction</label>
          <input value={quoteHint} onChange={(e) => setQuoteHint(e.target.value)}
            placeholder="e.g. Emphasise the mission to fix logistics, not just the money"
            className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Embargo Date</label>
          <input value={embargoDate} onChange={(e) => setEmbargoDate(e.target.value)} placeholder="e.g. April 15, 2026 09:00 ET"
            className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
        </div>
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
      </div>

      <div>
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Boilerplate (optional - Claude will write one if omitted)</label>
        <textarea value={boilerplate} onChange={(e) => setBoilerplate(e.target.value)} rows={2}
          placeholder="About Acme Corp: We build AI-powered logistics software for…"
          className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary resize-none" />
      </div>
    </>
  )

  const resultNode = result ? (
    <div className="space-y-4">
      {result.embargo_note && (
        <div className="p-3 rounded-lg bg-orange-50 border border-orange-200 dark:bg-orange-900/20 dark:border-orange-800">
          <p className="text-xs font-semibold text-orange-700 dark:text-orange-400">EMBARGO</p>
          <p className="text-xs text-orange-700 dark:text-orange-300">{result.embargo_note}</p>
        </div>
      )}

      <div className="p-5 rounded-xl border border-border bg-card space-y-4">
        <div className="border-b border-border pb-3">
          <div className="flex items-start justify-between gap-2">
            <h2 className="font-bold text-base leading-snug">{result.headline}</h2>
            <CopyButton text={result.headline} />
          </div>
          {result.subheadline && <p className="text-sm text-muted-foreground mt-1">{result.subheadline}</p>}
          <p className="text-xs text-muted-foreground mt-2 italic">{result.dateline}</p>
        </div>

        <div className="space-y-3">
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-medium leading-relaxed">{result.lead_paragraph}</p>
            <CopyButton text={result.lead_paragraph} />
          </div>
          {result.body_paragraphs?.map((p, i) => (
            <div key={i} className="flex items-start justify-between gap-2">
              <p className="text-sm leading-relaxed text-muted-foreground">{p}</p>
              <CopyButton text={p} />
            </div>
          ))}
        </div>

        {result.quote && (
          <div className="p-4 rounded-lg bg-muted/50 border-l-4 border-primary">
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm italic">"{result.quote.text}"</p>
              <CopyButton text={`"${result.quote.text}" - ${result.quote.speaker_name}, ${result.quote.speaker_title}`} />
            </div>
            <p className="text-xs text-muted-foreground mt-2">- {result.quote.speaker_name}, {result.quote.speaker_title}</p>
          </div>
        )}

        <div className="border-t border-border pt-3 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-[10px] font-semibold text-muted-foreground uppercase">About {result.company_name}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{result.boilerplate}</p>
            </div>
            <CopyButton text={result.boilerplate} />
          </div>
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-[10px] font-semibold text-muted-foreground uppercase">Media Contact</p>
              <p className="text-xs text-muted-foreground">{result.media_contact}</p>
            </div>
            <CopyButton text={result.media_contact} />
          </div>
        </div>
      </div>

      {result.seo_keywords && result.seo_keywords.length > 0 && (
        <div className="p-4 rounded-xl border border-border bg-card">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">SEO Keywords</p>
          <div className="flex flex-wrap gap-2">
            {result.seo_keywords.map((k, i) => (
              <span key={i} className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary">{k}</span>
            ))}
          </div>
        </div>
      )}

      {result.editorial_notes && (
        <div className="p-4 rounded-xl border border-border bg-card">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Editorial Notes</p>
          <p className="text-xs text-muted-foreground">{result.editorial_notes}</p>
        </div>
      )}

      <button
        onClick={() => {
          const full = [
            result.headline,
            result.subheadline || '',
            '',
            result.dateline + result.lead_paragraph,
            '',
            ...(result.body_paragraphs || []).map((p) => p + '\n'),
            result.quote ? `"${result.quote.text}" - ${result.quote.speaker_name}, ${result.quote.speaker_title}\n` : '',
            `About ${result.company_name}: ${result.boilerplate}`,
            '',
            `Media Contact: ${result.media_contact}`,
          ].join('\n')
          navigator.clipboard.writeText(full)
          toast.success('Full press release copied!')
        }}
        className="w-full py-2.5 text-sm font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
      >
        Copy Full Press Release
      </button>
    </div>
  ) : null

  return (
    <SSEFeaturePage
      projectId={projectId}
      title="Press Release Writer"
      subtitle="Pillar 8 - Claude"
      icon={<FileText className="w-4 h-4" />}
      credits={10}
      steps={store.steps}
      isStreaming={store.isStreaming}
      streamText={store.streamText}
      form={form}
      result={resultNode}
      onSubmit={generate}
      submitLabel="Write Press Release - 10 credits"
      canSubmit={canSubmit}
      backPath={`/projects/${projectId}/pr-comms`}
    />
  )
}
