'use client'

import { useCallback, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import {
  Loader2, Sparkles, Zap, BookOpen, Flame, User, RefreshCw,
  Copy, Check, ThumbsUp, ChevronDown, ChevronUp, ArrowRight, FileText,
  Send, Calendar,
} from 'lucide-react'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import type { ConnectedPlatform, ContentPlatform, GeneratedPost, OpinionQuestions, GeneratedBios } from '@/types'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PLATFORMS: { value: ContentPlatform; label: string }[] = [
  { value: 'linkedin', label: 'LinkedIn' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'twitter', label: 'Twitter / X' },
  { value: 'tiktok', label: 'TikTok' },
  { value: 'threads', label: 'Threads' },
  { value: 'youtube', label: 'YouTube' },
]

type Mode = 'quick' | 'story' | 'opinion' | 'bio' | 'article'

const ARTICLE_PLATFORMS = [
  { value: 'linkedin', label: 'LinkedIn Article' },
  { value: 'substack', label: 'Substack' },
  { value: 'medium', label: 'Medium' },
  { value: 'blog', label: 'Blog Post' },
]

// ---------------------------------------------------------------------------
// Voice accuracy badge
// ---------------------------------------------------------------------------

function VoiceBadge({ score }: { score: number }) {
  const color =
    score >= 85 ? 'text-green-600 bg-green-500/10 border-green-500/20' :
    score >= 65 ? 'text-amber-600 bg-amber-500/10 border-amber-500/20' :
    'text-red-500 bg-red-500/10 border-red-500/20'
  return (
    <span className={cn('text-[10px] font-semibold px-2 py-0.5 rounded-full border', color)}>
      {score}% your voice
    </span>
  )
}

// ---------------------------------------------------------------------------
// Copy button
// ---------------------------------------------------------------------------

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  function handleCopy() {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <button
      onClick={handleCopy}
      className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
    >
      {copied ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Approve button
// ---------------------------------------------------------------------------

function ApproveButton({
  projectId,
  content,
  platform,
  edited,
}: {
  projectId: string
  content: string
  platform: ContentPlatform
  edited: boolean
}) {
  const [saved, setSaved] = useState(false)
  async function handleApprove() {
    await api.persona.approveOutput(projectId, { content, platform, editedByUser: edited })
    setSaved(true)
  }
  return (
    <button
      onClick={handleApprove}
      disabled={saved}
      className={cn(
        'flex items-center gap-1.5 text-xs transition-colors',
        saved
          ? 'text-green-600 cursor-default'
          : 'text-muted-foreground hover:text-foreground',
      )}
    >
      <ThumbsUp className="w-3.5 h-3.5" />
      {saved ? 'Saved to voice' : 'Approve & train voice'}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Steps progress
// ---------------------------------------------------------------------------

function StepsList({ steps }: { steps: { label: string; status: 'running' | 'done' | 'error' }[] }) {
  if (!steps.length) return null
  return (
    <div className="space-y-1.5 py-2">
      {steps.map((s, i) => (
        <div key={i} className="flex items-center gap-2 text-sm">
          {s.status === 'running' && <Loader2 className="w-3.5 h-3.5 animate-spin text-primary shrink-0" />}
          {s.status === 'done' && <Check className="w-3.5 h-3.5 text-green-500 shrink-0" />}
          {s.status === 'error' && <span className="w-3.5 h-3.5 text-destructive shrink-0">✕</span>}
          <span className={cn(
            'text-sm',
            s.status === 'running' ? 'text-foreground' : 'text-muted-foreground',
          )}>{s.label}</span>
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Platform selector
// ---------------------------------------------------------------------------

function PlatformSelector({
  value,
  onChange,
  multi,
  selected,
  onToggle,
}: {
  value?: ContentPlatform
  onChange?: (v: ContentPlatform) => void
  multi?: boolean
  selected?: ContentPlatform[]
  onToggle?: (v: ContentPlatform) => void
}) {
  if (multi && selected && onToggle) {
    return (
      <div className="flex flex-wrap gap-2">
        {PLATFORMS.map((p) => (
          <button
            key={p.value}
            onClick={() => onToggle(p.value)}
            className={cn(
              'px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors',
              selected.includes(p.value)
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-background border-border text-muted-foreground hover:text-foreground',
            )}
          >
            {p.label}
          </button>
        ))}
      </div>
    )
  }
  return (
    <select
      value={value}
      onChange={(e) => onChange?.(e.target.value as ContentPlatform)}
      className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
    >
      {PLATFORMS.map((p) => (
        <option key={p.value} value={p.value}>{p.label}</option>
      ))}
    </select>
  )
}

// ---------------------------------------------------------------------------
// Publish panel (embedded in PostOutput)
// ---------------------------------------------------------------------------

function PublishPanel({ projectId, content }: { projectId: string; content: string }) {
  const [open, setOpen] = useState(false)
  const [platforms, setPlatforms] = useState<ConnectedPlatform[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [scheduleDate, setScheduleDate] = useState('')
  const [tab, setTab] = useState<'now' | 'schedule'>('now')
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [errMsg, setErrMsg] = useState('')

  const loadPlatforms = useCallback(async () => {
    if (platforms.length) return
    try {
      const data = await api.persona.getPublishingProfile(projectId)
      setPlatforms(data.connectedPlatforms)
      if (data.connectedPlatforms.length > 0) {
        setSelected([data.connectedPlatforms[0].platform])
      }
    } catch {
      // ignore - user may not have connected platforms yet
    }
  }, [projectId, platforms.length])

  function toggle() {
    if (!open) loadPlatforms()
    setOpen(!open)
    setStatus('idle')
  }

  function togglePlatform(p: string) {
    setSelected((prev) =>
      prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p],
    )
  }

  async function handlePublish() {
    if (!selected.length) return
    setStatus('loading')
    try {
      if (tab === 'now') {
        await api.persona.publishNow(projectId, content, selected)
      } else {
        if (!scheduleDate) { setErrMsg('Pick a date & time'); setStatus('error'); return }
        await api.persona.schedulePost(projectId, content, selected, new Date(scheduleDate).toISOString())
      }
      setStatus('done')
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : 'Publish failed')
      setStatus('error')
    }
  }

  return (
    <div>
      <button
        onClick={toggle}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <Send className="w-3.5 h-3.5" />
        {open ? 'Close' : 'Publish'}
      </button>

      {open && (
        <div className="mt-3 rounded-lg border border-border bg-background p-3 space-y-3">
          {/* Tab toggle */}
          <div className="flex gap-1">
            {(['now', 'schedule'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={cn(
                  'flex-1 text-xs py-1 rounded-md font-medium transition-colors',
                  tab === t ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground',
                )}
              >
                {t === 'now' ? 'Publish Now' : 'Schedule'}
              </button>
            ))}
          </div>

          {/* Platform toggles */}
          {platforms.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No platforms connected yet.{' '}
              <a href={`publishing`} className="underline text-primary hover:opacity-80">Connect platforms →</a>
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {platforms.map((p) => (
                <button
                  key={p.platform}
                  onClick={() => togglePlatform(p.platform)}
                  className={cn(
                    'px-2.5 py-1 rounded-md text-xs border transition-colors',
                    selected.includes(p.platform)
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'border-border text-muted-foreground hover:text-foreground',
                  )}
                >
                  {p.displayName || p.platform}
                </button>
              ))}
            </div>
          )}

          {/* Schedule date */}
          {tab === 'schedule' && (
            <input
              type="datetime-local"
              value={scheduleDate}
              onChange={(e) => setScheduleDate(e.target.value)}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
            />
          )}

          {/* Action button */}
          {status === 'done' ? (
            <p className="text-xs text-green-600 font-medium flex items-center gap-1.5">
              <Check className="w-3.5 h-3.5" />
              {tab === 'now' ? 'Published!' : 'Scheduled!'}
            </p>
          ) : (
            <button
              onClick={handlePublish}
              disabled={status === 'loading' || !selected.length || platforms.length === 0}
              className="w-full flex items-center justify-center gap-1.5 rounded-lg bg-primary text-primary-foreground text-xs py-1.5 font-medium disabled:opacity-50 transition-opacity"
            >
              {status === 'loading' && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {tab === 'now' ? (
                <><Send className="w-3.5 h-3.5" /> Publish Now</>
              ) : (
                <><Calendar className="w-3.5 h-3.5" /> Schedule</>
              )}
            </button>
          )}

          {status === 'error' && (
            <p className="text-xs text-destructive">{errMsg}</p>
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Generated post output card
// ---------------------------------------------------------------------------

function PostOutput({
  projectId,
  post,
  onEdit,
}: {
  projectId: string
  post: GeneratedPost
  onEdit: (text: string) => void
}) {
  const [text, setText] = useState(post.content)
  const [editing, setEditing] = useState(false)

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/60 bg-muted/30">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-foreground capitalize">{post.platform}</span>
          <VoiceBadge score={post.voiceAccuracyScore} />
        </div>
        <div className="flex items-center gap-3">
          <CopyButton text={text} />
          <button
            onClick={() => { setEditing(!editing); if (editing) onEdit(text) }}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {editing ? 'Done editing' : 'Edit'}
          </button>
        </div>
      </div>
      <div className="p-4">
        {editing ? (
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={8}
            className="w-full bg-transparent text-sm text-foreground resize-none focus:outline-none leading-relaxed"
          />
        ) : (
          <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">{text}</p>
        )}
      </div>
      <div className="flex items-center justify-between gap-4 px-4 py-2.5 border-t border-border/60 bg-muted/20">
        <PublishPanel projectId={projectId} content={text} />
        <ApproveButton
          projectId={projectId}
          content={text}
          platform={post.platform as ContentPlatform}
          edited={text !== post.content}
        />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Mode: Quick Post
// ---------------------------------------------------------------------------

function QuickPostMode({ projectId }: { projectId: string }) {
  const [platform, setPlatform] = useState<ContentPlatform>('linkedin')
  const [topic, setTopic] = useState('')
  const [loading, setLoading] = useState(false)
  const [steps, setSteps] = useState<{ label: string; status: 'running' | 'done' | 'error' }[]>([])
  const [result, setResult] = useState<GeneratedPost | null>(null)
  const [error, setError] = useState<string | null>(null)
  const ctrlRef = useRef<AbortController | null>(null)

  function handleGenerate() {
    if (!topic.trim()) return
    setLoading(true)
    setSteps([])
    setResult(null)
    setError(null)
    ctrlRef.current = new AbortController()
    api.persona.streamGeneratePost(
      projectId,
      { platform, topic: topic.trim() },
      {
        onStep: (label, status) => setSteps((p) => {
          const idx = p.findIndex((s) => s.label === label)
          if (idx >= 0) { const n = [...p]; n[idx] = { label, status }; return n }
          return [...p, { label, status }]
        }),
        onDone: (event) => { setResult(event.result as GeneratedPost); setLoading(false) },
        onError: (msg) => { setError(msg); setLoading(false) },
      },
      ctrlRef.current.signal,
    )
  }

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1.5">Platform</p>
          <PlatformSelector value={platform} onChange={setPlatform} />
        </div>
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1.5">What do you want to write about?</p>
          <textarea
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="e.g. The biggest mistake I see founders make when hiring their first team"
            rows={3}
            className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring resize-none"
          />
        </div>
        <button
          onClick={handleGenerate}
          disabled={loading || !topic.trim()}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
          {loading ? 'Writing…' : 'Generate post'}
        </button>
      </div>

      {loading && <StepsList steps={steps} />}
      {error && <p className="text-sm text-destructive">{error}</p>}
      {result && (
        <PostOutput
          projectId={projectId}
          post={result}
          onEdit={() => {}}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Mode: Story → Post
// ---------------------------------------------------------------------------

function StoryMode({ projectId }: { projectId: string }) {
  const [platform, setPlatform] = useState<ContentPlatform>('linkedin')
  const [story, setStory] = useState('')
  const [loading, setLoading] = useState(false)
  const [steps, setSteps] = useState<{ label: string; status: 'running' | 'done' | 'error' }[]>([])
  const [result, setResult] = useState<GeneratedPost | null>(null)
  const [error, setError] = useState<string | null>(null)
  const ctrlRef = useRef<AbortController | null>(null)

  function handleGenerate() {
    if (!story.trim()) return
    setLoading(true)
    setSteps([])
    setResult(null)
    setError(null)
    ctrlRef.current = new AbortController()
    api.persona.streamStoryToPost(
      projectId,
      { story: story.trim(), platform },
      {
        onStep: (label, status) => setSteps((p) => {
          const idx = p.findIndex((s) => s.label === label)
          if (idx >= 0) { const n = [...p]; n[idx] = { label, status }; return n }
          return [...p, { label, status }]
        }),
        onDone: (event) => { setResult(event.result as GeneratedPost); setLoading(false) },
        onError: (msg) => { setError(msg); setLoading(false) },
      },
      ctrlRef.current.signal,
    )
  }

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1.5">Platform</p>
          <PlatformSelector value={platform} onChange={setPlatform} />
        </div>
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1.5">What happened? Describe it in your own words.</p>
          <textarea
            value={story}
            onChange={(e) => setStory(e.target.value)}
            placeholder="e.g. Last week a client called to say we lost the deal. They went with a cheaper option. I was frustrated at first - then I realised it was the best thing that could have happened..."
            rows={5}
            className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring resize-none"
          />
          <p className="text-[11px] text-muted-foreground mt-1">Don&apos;t clean it up - LEO structures it. Just write what happened.</p>
        </div>
        <button
          onClick={handleGenerate}
          disabled={loading || !story.trim()}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <BookOpen className="w-4 h-4" />}
          {loading ? 'Shaping your story…' : 'Turn into post'}
        </button>
      </div>

      {loading && <StepsList steps={steps} />}
      {error && <p className="text-sm text-destructive">{error}</p>}
      {result && (
        <PostOutput projectId={projectId} post={result} onEdit={() => {}} />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Mode: Opinion / Hot Take
// ---------------------------------------------------------------------------

function OpinionMode({ projectId }: { projectId: string }) {
  const [platform, setPlatform] = useState<ContentPlatform>('linkedin')
  const [take, setTake] = useState('')
  const [loading, setLoading] = useState(false)
  const [steps, setSteps] = useState<{ label: string; status: 'running' | 'done' | 'error' }[]>([])
  const [questions, setQuestions] = useState<string[] | null>(null)
  const [answers, setAnswers] = useState<string[]>(['', '', ''])
  const [result, setResult] = useState<GeneratedPost | null>(null)
  const [error, setError] = useState<string | null>(null)
  const ctrlRef = useRef<AbortController | null>(null)

  function handleGetQuestions() {
    if (!take.trim()) return
    setLoading(true)
    setSteps([])
    setQuestions(null)
    setResult(null)
    setError(null)
    ctrlRef.current = new AbortController()
    api.persona.streamOpinion(
      projectId,
      { take: take.trim(), platform },
      {
        onStep: (label, status) => setSteps((p) => {
          const idx = p.findIndex((s) => s.label === label)
          if (idx >= 0) { const n = [...p]; n[idx] = { label, status }; return n }
          return [...p, { label, status }]
        }),
        onDone: (event) => {
          const r = event.result as OpinionQuestions | GeneratedPost
          if (r.type === 'questions') {
            setQuestions((r as OpinionQuestions).questions)
            setAnswers(new Array((r as OpinionQuestions).questions.length).fill(''))
          } else {
            setResult(r as GeneratedPost)
          }
          setLoading(false)
        },
        onError: (msg) => { setError(msg); setLoading(false) },
      },
      ctrlRef.current.signal,
    )
  }

  function handleGeneratePost() {
    const filledAnswers = answers.filter((a) => a.trim())
    if (!filledAnswers.length) return
    setLoading(true)
    setSteps([])
    setResult(null)
    setError(null)
    ctrlRef.current = new AbortController()
    api.persona.streamOpinion(
      projectId,
      { take: take.trim(), platform, answers: filledAnswers },
      {
        onStep: (label, status) => setSteps((p) => {
          const idx = p.findIndex((s) => s.label === label)
          if (idx >= 0) { const n = [...p]; n[idx] = { label, status }; return n }
          return [...p, { label, status }]
        }),
        onDone: (event) => { setResult(event.result as GeneratedPost); setLoading(false) },
        onError: (msg) => { setError(msg); setLoading(false) },
      },
      ctrlRef.current.signal,
    )
  }

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1.5">Platform</p>
          <PlatformSelector value={platform} onChange={setPlatform} />
        </div>
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1.5">What&apos;s your take? State it bluntly.</p>
          <textarea
            value={take}
            onChange={(e) => setTake(e.target.value)}
            placeholder="e.g. Most startup advice is wrong because it's given by people who got lucky, not people who were actually good."
            rows={3}
            className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring resize-none"
          />
        </div>

        {!questions && (
          <button
            onClick={handleGetQuestions}
            disabled={loading || !take.trim()}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
            {loading ? 'Thinking…' : 'Get probing questions'}
          </button>
        )}
      </div>

      {loading && <StepsList steps={steps} />}
      {error && <p className="text-sm text-destructive">{error}</p>}

      {questions && !result && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">Answer these to sharpen your argument:</p>
          {questions.map((q, i) => (
            <div key={i}>
              <p className="text-sm font-medium text-foreground mb-1.5">{q}</p>
              <textarea
                value={answers[i] || ''}
                onChange={(e) => {
                  const n = [...answers]; n[i] = e.target.value; setAnswers(n)
                }}
                rows={2}
                placeholder="Your answer…"
                className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring resize-none"
              />
            </div>
          ))}
          <button
            onClick={handleGeneratePost}
            disabled={loading || !answers.some((a) => a.trim())}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Flame className="w-4 h-4" />}
            {loading ? 'Writing…' : 'Write the post'}
          </button>
        </div>
      )}

      {result && (
        <PostOutput projectId={projectId} post={result} onEdit={() => {}} />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Mode: Bio Writer
// ---------------------------------------------------------------------------

function BioMode({ projectId }: { projectId: string }) {
  const [loading, setLoading] = useState(false)
  const [steps, setSteps] = useState<{ label: string; status: 'running' | 'done' | 'error' }[]>([])
  const [result, setResult] = useState<GeneratedBios | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const ctrlRef = useRef<AbortController | null>(null)

  function handleGenerate() {
    setLoading(true)
    setSteps([])
    setResult(null)
    setError(null)
    ctrlRef.current = new AbortController()
    api.persona.streamBioWriter(
      projectId,
      {
        onStep: (label, status) => setSteps((p) => {
          const idx = p.findIndex((s) => s.label === label)
          if (idx >= 0) { const n = [...p]; n[idx] = { label, status }; return n }
          return [...p, { label, status }]
        }),
        onDone: (event) => { setResult(event.result as GeneratedBios); setLoading(false) },
        onError: (msg) => { setError(msg); setLoading(false) },
      },
      ctrlRef.current.signal,
    )
  }

  const toggle = (key: string) => setExpanded((p) => ({ ...p, [key]: !p[key] }))

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">
          LEO writes your LinkedIn headline and about section, Instagram bio, X bio, and TikTok bio - all from your Personal Core positioning.
        </p>
        <button
          onClick={handleGenerate}
          disabled={loading}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <User className="w-4 h-4" />}
          {loading ? 'Writing your bios…' : 'Generate all bios'}
        </button>
      </div>

      {loading && <StepsList steps={steps} />}
      {error && <p className="text-sm text-destructive">{error}</p>}

      {result && (
        <div className="space-y-3">
          {/* LinkedIn */}
          {result.bios.linkedin && (
            <div className="rounded-xl border border-border bg-card overflow-hidden">
              <button
                onClick={() => toggle('linkedin')}
                className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-foreground hover:bg-muted/40 transition-colors"
              >
                LinkedIn
                {expanded.linkedin ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>
              {expanded.linkedin && (
                <div className="px-4 pb-4 space-y-4 border-t border-border/60">
                  <div className="pt-3">
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Headline</p>
                      <CopyButton text={result.bios.linkedin.headline} />
                    </div>
                    <p className="text-sm text-foreground">{result.bios.linkedin.headline}</p>
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">About (preview)</p>
                      <CopyButton text={result.bios.linkedin.aboutPreview} />
                    </div>
                    <p className="text-sm text-foreground whitespace-pre-wrap">{result.bios.linkedin.aboutPreview}</p>
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Full About</p>
                      <CopyButton text={result.bios.linkedin.aboutFull} />
                    </div>
                    <p className="text-sm text-foreground whitespace-pre-wrap">{result.bios.linkedin.aboutFull}</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Instagram */}
          {result.bios.instagram && (
            <div className="rounded-xl border border-border bg-card overflow-hidden">
              <button
                onClick={() => toggle('instagram')}
                className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-foreground hover:bg-muted/40 transition-colors"
              >
                Instagram
                {expanded.instagram ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>
              {expanded.instagram && (
                <div className="px-4 pb-4 space-y-3 border-t border-border/60">
                  <div className="pt-3">
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Bio</p>
                      <CopyButton text={result.bios.instagram.bio} />
                    </div>
                    <p className="text-sm text-foreground whitespace-pre-wrap">{result.bios.instagram.bio}</p>
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Link label</p>
                      <CopyButton text={result.bios.instagram.linkLabel} />
                    </div>
                    <p className="text-sm text-foreground">{result.bios.instagram.linkLabel}</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Twitter */}
          {result.bios.twitter && (
            <div className="rounded-xl border border-border bg-card overflow-hidden">
              <button
                onClick={() => toggle('twitter')}
                className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-foreground hover:bg-muted/40 transition-colors"
              >
                Twitter / X
                {expanded.twitter ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>
              {expanded.twitter && (
                <div className="px-4 pb-4 border-t border-border/60">
                  <div className="pt-3 flex items-start justify-between gap-3">
                    <p className="text-sm text-foreground whitespace-pre-wrap flex-1">{result.bios.twitter.bio}</p>
                    <CopyButton text={result.bios.twitter.bio} />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TikTok */}
          {result.bios.tiktok && (
            <div className="rounded-xl border border-border bg-card overflow-hidden">
              <button
                onClick={() => toggle('tiktok')}
                className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-foreground hover:bg-muted/40 transition-colors"
              >
                TikTok
                {expanded.tiktok ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>
              {expanded.tiktok && (
                <div className="px-4 pb-4 border-t border-border/60">
                  <div className="pt-3 flex items-start justify-between gap-3">
                    <p className="text-sm text-foreground whitespace-pre-wrap flex-1">{result.bios.tiktok.bio}</p>
                    <CopyButton text={result.bios.tiktok.bio} />
                  </div>
                </div>
              )}
            </div>
          )}

          <button
            onClick={handleGenerate}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Regenerate
          </button>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Mode: Article Writer
// ---------------------------------------------------------------------------

function ArticleMode({ projectId }: { projectId: string }) {
  const [platform, setPlatform] = useState('linkedin')
  const [topic, setTopic] = useState('')
  const [outline, setOutline] = useState('')
  const [showOutline, setShowOutline] = useState(false)
  const [loading, setLoading] = useState(false)
  const [steps, setSteps] = useState<{ label: string; status: 'running' | 'done' | 'error' }[]>([])
  const [result, setResult] = useState<GeneratedPost | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editedText, setEditedText] = useState('')
  const [editing, setEditing] = useState(false)
  const ctrlRef = useRef<AbortController | null>(null)

  function handleGenerate() {
    if (!topic.trim()) return
    setLoading(true)
    setSteps([])
    setResult(null)
    setError(null)
    setEditing(false)
    ctrlRef.current = new AbortController()
    api.persona.streamArticle(
      projectId,
      { topic: topic.trim(), platform, outline: outline.trim() || undefined },
      {
        onStep: (label, status) => setSteps((p) => {
          const idx = p.findIndex((s) => s.label === label)
          if (idx >= 0) { const n = [...p]; n[idx] = { label, status }; return n }
          return [...p, { label, status }]
        }),
        onDone: (event) => {
          const r = event.result as GeneratedPost
          setResult(r)
          setEditedText(r.content)
          setLoading(false)
        },
        onError: (msg) => { setError(msg); setLoading(false) },
      },
      ctrlRef.current.signal,
    )
  }

  const displayText = editing ? editedText : result?.content ?? ''

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1.5">Platform</p>
          <select
            value={platform}
            onChange={(e) => setPlatform(e.target.value)}
            className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          >
            {ARTICLE_PLATFORMS.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
        </div>
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1.5">Topic or angle</p>
          <textarea
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="e.g. Why most founders mistake hiring speed for hiring quality - and how I fixed it"
            rows={2}
            className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring resize-none"
          />
        </div>
        <div>
          <button
            onClick={() => setShowOutline(!showOutline)}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {showOutline ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            {showOutline ? 'Hide outline' : 'Add optional outline / key points'}
          </button>
          {showOutline && (
            <textarea
              value={outline}
              onChange={(e) => setOutline(e.target.value)}
              placeholder="- The problem with hiring for culture fit&#10;- What I learned after 3 bad hires&#10;- The framework I use now"
              rows={4}
              className="mt-2 w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring resize-none"
            />
          )}
        </div>
        <button
          onClick={handleGenerate}
          disabled={loading || !topic.trim()}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
          {loading ? 'Writing your article…' : 'Write article'}
        </button>
      </div>

      {loading && <StepsList steps={steps} />}
      {error && <p className="text-sm text-destructive">{error}</p>}

      {result && (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border/60 bg-muted/30">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-foreground capitalize">{platform}</span>
              <VoiceBadge score={result.voiceAccuracyScore} />
              {result.wordCount && (
                <span className="text-[10px] text-muted-foreground">{result.wordCount} words</span>
              )}
            </div>
            <div className="flex items-center gap-3">
              <CopyButton text={displayText} />
              <button
                onClick={() => setEditing(!editing)}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                {editing ? 'Done editing' : 'Edit'}
              </button>
            </div>
          </div>
          <div className="p-4 max-h-[500px] overflow-y-auto">
            {editing ? (
              <textarea
                value={editedText}
                onChange={(e) => setEditedText(e.target.value)}
                rows={20}
                className="w-full bg-transparent text-sm text-foreground resize-none focus:outline-none leading-relaxed"
              />
            ) : (
              <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">{result.content}</p>
            )}
          </div>
          <div className="flex items-center justify-between px-4 py-2.5 border-t border-border/60 bg-muted/20">
            <button
              onClick={handleGenerate}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Regenerate
            </button>
            <ApproveButton
              projectId={projectId}
              content={editing ? editedText : result.content}
              platform={platform as ContentPlatform}
              edited={editing && editedText !== result.content}
            />
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

const MODES: { key: Mode; label: string; icon: React.ReactNode; description: string }[] = [
  {
    key: 'quick',
    label: 'Quick Post',
    icon: <Zap className="w-4 h-4" />,
    description: 'Write about any topic in your voice',
  },
  {
    key: 'story',
    label: 'Story → Post',
    icon: <BookOpen className="w-4 h-4" />,
    description: 'Turn an experience into a compelling post',
  },
  {
    key: 'opinion',
    label: 'Hot Take',
    icon: <Flame className="w-4 h-4" />,
    description: 'Turn a strong opinion into a full post',
  },
  {
    key: 'bio',
    label: 'Bio Writer',
    icon: <User className="w-4 h-4" />,
    description: 'Generate bios for every platform',
  },
  {
    key: 'article',
    label: 'Article',
    icon: <FileText className="w-4 h-4" />,
    description: 'Write a long-form thought leadership piece',
  },
]

export default function PersonalBrandContentPage() {
  const params = useParams<{ projectId: string }>()
  const [mode, setMode] = useState<Mode>('quick')
  const active = MODES.find((m) => m.key === mode)!

  return (
    <div className="flex flex-col h-full overflow-hidden bg-background">
      {/* Header */}
      <div className="shrink-0 border-b border-border px-6 py-4">
        <h1 className="text-lg font-bold text-foreground">Content Engine</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Create content in your voice - not generic AI output.</p>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="max-w-2xl mx-auto space-y-6">
          {/* Mode selector */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            {MODES.map((m) => (
              <button
                key={m.key}
                onClick={() => setMode(m.key)}
                className={cn(
                  'flex flex-col items-start gap-1.5 p-3 rounded-xl border text-left transition-all',
                  mode === m.key
                    ? 'border-primary bg-primary/5 text-primary'
                    : 'border-border bg-card text-muted-foreground hover:text-foreground hover:border-border/80',
                )}
              >
                <div className={cn(
                  'w-7 h-7 rounded-lg flex items-center justify-center',
                  mode === m.key ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground',
                )}>
                  {m.icon}
                </div>
                <div>
                  <p className="text-xs font-semibold leading-tight">{m.label}</p>
                  <p className="text-[10px] leading-tight opacity-70 mt-0.5 hidden sm:block">{m.description}</p>
                </div>
              </button>
            ))}
          </div>

          {/* Mode panel */}
          <div className="rounded-2xl border border-border bg-card p-5">
            <div className="flex items-center gap-2 mb-5">
              <div className="w-7 h-7 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
                {active.icon}
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">{active.label}</p>
                <p className="text-xs text-muted-foreground">{active.description}</p>
              </div>
            </div>

            {mode === 'quick' && <QuickPostMode projectId={params.projectId} />}
            {mode === 'story' && <StoryMode projectId={params.projectId} />}
            {mode === 'opinion' && <OpinionMode projectId={params.projectId} />}
            {mode === 'bio' && <BioMode projectId={params.projectId} />}
            {mode === 'article' && <ArticleMode projectId={params.projectId} />}
          </div>
        </div>
      </div>
    </div>
  )
}
