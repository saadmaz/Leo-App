'use client'

import { useState, useRef } from 'react'
import { useParams } from 'next/navigation'
import { Newspaper, Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import { SSEFeaturePage } from '@/components/pillar1/SSEFeaturePage'
import { api } from '@/lib/api'
import { usePillar5Store } from '@/stores/pillar5-store'
import type { ProgressStep } from '@/types'
import { cn } from '@/lib/utils'

const DEFAULT_SECTIONS = ['intro', 'main_story', 'quick_hits', 'tip_of_the_week', 'cta']
const ALL_SECTIONS = ['intro', 'main_story', 'quick_hits', 'tip_of_the_week', 'cta', 'tool_of_the_week', 'stats_roundup', 'upcoming_events', 'reader_spotlight']

interface NewsletterSection { section_key: string; section_title: string; content: string; word_count: number }
interface NewsletterPayload {
  newsletter_name: string
  edition_topic: string
  subject_line_options: { subject: string; preview_text: string }[]
  sections: NewsletterSection[]
  html_body: string
  plain_text_version: string
  total_word_count: number
  estimated_read_time_minutes: number
  cta: { text: string; url_placeholder: string }
  social_snippets: { platform: string; text: string }[]
  loops_result?: unknown
}

function CopyBtn({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [c, setC] = useState(false)
  return (
    <button onClick={() => { navigator.clipboard.writeText(text); setC(true); setTimeout(() => setC(false), 1500) }}
      className="text-[10px] px-2 py-0.5 rounded border border-border hover:border-primary/50 hover:text-primary transition-colors text-muted-foreground shrink-0">
      {c ? 'Copied!' : label}
    </button>
  )
}

export default function NewsletterPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const store = usePillar5Store()

  const [newsletterName, setNewsletterName] = useState('')
  const [topic, setTopic] = useState('')
  const [audience, setAudience] = useState('')
  const [tone, setTone] = useState('warm and insightful')
  const [sections, setSections] = useState<string[]>(DEFAULT_SECTIONS)
  const [sourceUrls, setSourceUrls] = useState<string[]>([''])
  const [pushToLoops, setPushToLoops] = useState(false)
  const [loopsListId, setLoopsListId] = useState('')
  const [result, setResult] = useState<NewsletterPayload | null>(null)
  const [activeTab, setActiveTab] = useState<'sections' | 'html' | 'plain'>('sections')
  const abortRef = useRef<AbortController | null>(null)

  function toggleSection(s: string) {
    setSections((prev) => prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s])
  }
  function addUrl() { if (sourceUrls.length < 5) setSourceUrls([...sourceUrls, '']) }
  function removeUrl(i: number) { setSourceUrls(sourceUrls.filter((_, idx) => idx !== i)) }
  function updateUrl(i: number, v: string) { const next = [...sourceUrls]; next[i] = v; setSourceUrls(next) }

  async function generate() {
    if (!newsletterName.trim()) { toast.error('Enter a newsletter name'); return }
    if (!topic.trim()) { toast.error('Enter the edition topic'); return }
    if (!audience.trim()) { toast.error('Describe the audience'); return }
    if (sections.length === 0) { toast.error('Select at least one section'); return }

    abortRef.current?.abort(); abortRef.current = new AbortController()
    store.setIsStreaming(true); store.clearSteps(); store.clearStreamText(); setResult(null)
    try {
      await api.pillar5.streamNewsletter(projectId,
        { newsletter_name: newsletterName.trim(), edition_topic: topic.trim(), audience: audience.trim(),
          sections, tone: tone.trim(), source_urls: sourceUrls.filter(Boolean),
          push_to_loops: pushToLoops, loops_list_id: loopsListId.trim() || undefined },
        {
          onStep: (s, l, st) => store.upsertStep(s, l, st as ProgressStep['status']),
          onDelta: (t) => store.appendStreamText(t),
          onSaved: (_, p) => { setResult(p as unknown as NewsletterPayload); store.clearStreamText(); store.setIsStreaming(false); toast.success('Newsletter ready!') },
          onError: (m) => { toast.error(m); store.setIsStreaming(false) },
          onDone: () => store.setIsStreaming(false),
        }, abortRef.current.signal)
    } catch { store.setIsStreaming(false) }
  }

  const form = (
    <>
      <h2 className="font-semibold text-sm">Newsletter Production</h2>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Newsletter Name *</label>
          <input value={newsletterName} onChange={(e) => setNewsletterName(e.target.value)} placeholder="e.g. The Leo Brief"
            className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Tone</label>
          <input value={tone} onChange={(e) => setTone(e.target.value)} placeholder="e.g. warm and insightful"
            className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
        </div>
      </div>
      <div>
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Edition Topic *</label>
        <input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="e.g. The rise of AI agents in marketing teams"
          className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
      </div>
      <div>
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Audience *</label>
        <input value={audience} onChange={(e) => setAudience(e.target.value)} placeholder="e.g. Marketing leaders at B2B SaaS companies"
          className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
      </div>
      <div>
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Sections *</label>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {ALL_SECTIONS.map((s) => (
            <button key={s} onClick={() => toggleSection(s)}
              className={cn('px-2.5 py-1 text-xs rounded-lg border capitalize transition-colors',
                sections.includes(s) ? 'bg-primary text-primary-foreground border-primary' : 'bg-background border-border hover:border-primary/50')}>
              {s.replace(/_/g, ' ')}
            </button>
          ))}
        </div>
      </div>
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Source URLs (optional)</label>
          {sourceUrls.length < 5 && (
            <button onClick={addUrl} className="flex items-center gap-1 text-xs text-primary hover:text-primary/80"><Plus className="w-3 h-3" /> Add</button>
          )}
        </div>
        <div className="space-y-2">
          {sourceUrls.map((url, i) => (
            <div key={i} className="flex gap-2">
              <input value={url} onChange={(e) => updateUrl(i, e.target.value)} placeholder="https://example.com/article"
                className="flex-1 px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
              {sourceUrls.length > 1 && (
                <button onClick={() => removeUrl(i)} className="text-muted-foreground hover:text-destructive transition-colors"><X className="w-4 h-4" /></button>
              )}
            </div>
          ))}
        </div>
      </div>
      <div className="space-y-2 p-3 rounded-lg border border-border bg-muted/30">
        <div className="flex items-center gap-2">
          <input type="checkbox" id="loops-nl" checked={pushToLoops} onChange={(e) => setPushToLoops(e.target.checked)} className="rounded" />
          <label htmlFor="loops-nl" className="text-xs font-medium cursor-pointer">Push draft to Loops.so</label>
        </div>
        {pushToLoops && (
          <input value={loopsListId} onChange={(e) => setLoopsListId(e.target.value)} placeholder="Loops List ID (optional)"
            className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
        )}
      </div>
    </>
  )

  const resultNode = result ? (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-sm">{result.newsletter_name}</h2>
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
          <span>{result.total_word_count} words</span>
          <span>·</span>
          <span>{result.estimated_read_time_minutes} min read</span>
        </div>
      </div>

      {result.subject_line_options?.length > 0 && (
        <div className="p-4 rounded-xl border border-border bg-card space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Subject Line Options</p>
          {result.subject_line_options.map((s, i) => (
            <div key={i} className="space-y-0.5">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium">{i + 1}. {s.subject}</span>
                <CopyBtn text={s.subject} />
              </div>
              {s.preview_text && <p className="text-[10px] text-muted-foreground ml-4">Preview: {s.preview_text}</p>}
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-2 border-b border-border pb-2">
        {(['sections', 'html', 'plain'] as const).map((tab) => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className={cn('text-xs px-3 py-1.5 rounded-lg capitalize transition-colors',
              activeTab === tab ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}>
            {tab === 'html' ? 'HTML' : tab === 'plain' ? 'Plain Text' : 'Sections'}
          </button>
        ))}
      </div>

      {activeTab === 'sections' && result.sections?.map((sec, i) => (
        <div key={i} className="p-4 rounded-xl border border-border bg-card space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold">{sec.section_title}</p>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-muted-foreground">{sec.word_count}w</span>
              <CopyBtn text={sec.content} />
            </div>
          </div>
          <p className="text-xs leading-relaxed whitespace-pre-wrap">{sec.content}</p>
        </div>
      ))}

      {activeTab === 'html' && result.html_body && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">HTML Body</p>
            <CopyBtn text={result.html_body} label="Copy HTML" />
          </div>
          <textarea readOnly value={result.html_body} rows={12}
            className="w-full px-3 py-2 text-xs font-mono bg-muted/40 border border-border rounded-lg resize-y" />
        </div>
      )}

      {activeTab === 'plain' && result.plain_text_version && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Plain Text</p>
            <CopyBtn text={result.plain_text_version} label="Copy Text" />
          </div>
          <textarea readOnly value={result.plain_text_version} rows={12}
            className="w-full px-3 py-2 text-xs font-mono bg-muted/40 border border-border rounded-lg resize-y" />
        </div>
      )}

      {result.social_snippets?.length > 0 && (
        <div className="p-4 rounded-xl border border-border bg-card space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Social Snippets</p>
          {result.social_snippets.map((s, i) => (
            <div key={i}>
              <div className="flex items-center justify-between mb-0.5">
                <span className="text-[10px] font-medium capitalize">{s.platform}</span>
                <CopyBtn text={s.text} />
              </div>
              <p className="text-xs text-muted-foreground">{s.text}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  ) : null

  return (
    <SSEFeaturePage projectId={projectId} title="Newsletter Production" subtitle="Pillar 5 - Claude + Loops"
      icon={<Newspaper className="w-4 h-4" />} credits={15} steps={store.steps}
      isStreaming={store.isStreaming} streamText={store.streamText} form={form} result={resultNode}
      onSubmit={generate} submitLabel="Produce Newsletter - 15 credits"
      canSubmit={!!newsletterName.trim() && !!topic.trim() && !!audience.trim() && sections.length > 0}
      backPath={`/projects/${projectId}/email-crm`} />
  )
}
