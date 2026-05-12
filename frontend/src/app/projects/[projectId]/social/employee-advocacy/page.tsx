'use client'

import { useState, useRef } from 'react'
import { useParams } from 'next/navigation'
import { Users, Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import { SSEFeaturePage } from '@/components/pillar1/SSEFeaturePage'
import { api } from '@/lib/api'
import { usePillar6Store } from '@/stores/pillar6-store'
import type { ProgressStep } from '@/types'
import { cn } from '@/lib/utils'

const PLATFORMS = ['linkedin', 'twitter', 'instagram', 'facebook', 'threads', 'tiktok']
const TONES = ['authentic and personal', 'thought-leader', 'enthusiastic', 'storytelling', 'educational']
const ENGAGEMENT_COLORS: Record<string, string> = {
  high:   'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  medium: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
  low:    'bg-muted text-muted-foreground',
}
const ANGLE_ICONS: Record<string, string> = {
  personal_story: '📖', lesson_learned: '💡', behind_scenes: '🎬',
  hot_take: '🔥', question: '❓', win: '🏆', tip: '✨',
}

interface AdvocacyPost {
  post_number: number
  text: string
  hook: string
  angle: string
  estimated_engagement: string
  why_it_works: string
  hashtags: string[]
  best_time_to_post: string
}

interface PlatformBlock {
  platform: string
  character_limit: number
  posts: AdvocacyPost[]
}

interface EmployeeAdvocacyPayload {
  topic: string
  employee_persona: string
  advocacy_brief: string
  platforms: PlatformBlock[]
  key_message_weaving: string
  dos: string[]
  donts: string[]
  ab_variants: { platform: string; variant_a: string; variant_b: string }[]
  ayrshare_push_results?: { platform: string; result: unknown }[]
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

export default function EmployeeAdvocacyPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const store = usePillar6Store()

  const [topic, setTopic] = useState('')
  const [employeePersona, setEmployeePersona] = useState('')
  const [keyMessages, setKeyMessages] = useState<string[]>([''])
  const [platforms, setPlatforms] = useState<string[]>(['linkedin', 'twitter'])
  const [tone, setTone] = useState('authentic and personal')
  const [numPosts, setNumPosts] = useState(5)
  const [avoidPhrases, setAvoidPhrases] = useState('')
  const [pushToAyrshare, setPushToAyrshare] = useState(false)
  const [ayrshareProfileKey, setAyrshareProfileKey] = useState('')
  const [result, setResult] = useState<EmployeeAdvocacyPayload | null>(null)
  const [activePlatform, setActivePlatform] = useState<string>('')
  const abortRef = useRef<AbortController | null>(null)

  function togglePlatform(p: string) {
    setPlatforms((prev) => prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p])
  }
  function addMessage() { if (keyMessages.length < 5) setKeyMessages([...keyMessages, '']) }
  function removeMessage(i: number) { setKeyMessages(keyMessages.filter((_, idx) => idx !== i)) }
  function updateMessage(i: number, v: string) { const next = [...keyMessages]; next[i] = v; setKeyMessages(next) }

  async function generate() {
    if (!topic.trim()) { toast.error('Describe the topic'); return }
    if (!employeePersona.trim()) { toast.error('Describe the employee persona'); return }
    const validMessages = keyMessages.filter((m) => m.trim())
    if (validMessages.length === 0) { toast.error('Add at least one key message'); return }
    if (platforms.length === 0) { toast.error('Select at least one platform'); return }

    abortRef.current?.abort(); abortRef.current = new AbortController()
    store.setIsStreaming(true); store.clearSteps(); store.clearStreamText(); setResult(null)

    const phrases = avoidPhrases.split(',').map((s) => s.trim()).filter(Boolean)

    try {
      await api.pillar6.streamEmployeeAdvocacy(projectId,
        { topic: topic.trim(), key_messages: validMessages, employee_persona: employeePersona.trim(),
          platforms, num_posts: numPosts, tone,
          ...(phrases.length > 0 && { avoid_phrases: phrases }),
          push_to_ayrshare: pushToAyrshare,
          ...(pushToAyrshare && ayrshareProfileKey && { ayrshare_profile_key: ayrshareProfileKey.trim() }) },
        {
          onStep: (s, l, st) => store.upsertStep(s, l, st as ProgressStep['status']),
          onDelta: (t) => store.appendStreamText(t),
          onSaved: (_, p) => {
            const payload = p as unknown as EmployeeAdvocacyPayload
            setResult(payload)
            setActivePlatform(payload.platforms?.[0]?.platform ?? '')
            store.clearStreamText(); store.setIsStreaming(false); toast.success('Advocacy posts ready!')
          },
          onError: (m) => { toast.error(m); store.setIsStreaming(false) },
          onDone: () => store.setIsStreaming(false),
        }, abortRef.current.signal)
    } catch { store.setIsStreaming(false) }
  }

  const form = (
    <>
      <h2 className="font-semibold text-sm">Employee Advocacy</h2>

      <div>
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Topic *</label>
        <textarea value={topic} onChange={(e) => setTopic(e.target.value)} rows={2}
          placeholder="e.g. Our new AI reporting feature just shipped - employees sharing their behind-the-scenes perspective"
          className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary resize-none" />
      </div>

      <div>
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Employee Persona *</label>
        <textarea value={employeePersona} onChange={(e) => setEmployeePersona(e.target.value)} rows={2}
          placeholder="e.g. Senior Account Executive, 5 years in B2B SaaS, curious and conversational, posts on LinkedIn 3x/week"
          className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary resize-none" />
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Brand Key Messages *</label>
          {keyMessages.length < 5 && (
            <button onClick={addMessage} className="flex items-center gap-1 text-xs text-primary hover:text-primary/80"><Plus className="w-3 h-3" /> Add</button>
          )}
        </div>
        <div className="space-y-2">
          {keyMessages.map((m, i) => (
            <div key={i} className="flex gap-2">
              <input value={m} onChange={(e) => updateMessage(i, e.target.value)} placeholder={`e.g. Saves 5 hours/week per marketer`}
                className="flex-1 px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
              {keyMessages.length > 1 && (
                <button onClick={() => removeMessage(i)} className="text-muted-foreground hover:text-destructive transition-colors"><X className="w-4 h-4" /></button>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Platforms *</label>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {PLATFORMS.map((p) => (
              <button key={p} onClick={() => togglePlatform(p)}
                className={cn('px-2.5 py-1 text-xs rounded-lg border capitalize transition-colors',
                  platforms.includes(p) ? 'bg-primary text-primary-foreground border-primary' : 'bg-background border-border hover:border-primary/50')}>
                {p}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Tone</label>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {TONES.map((t) => (
              <button key={t} onClick={() => setTone(t)}
                className={cn('px-2.5 py-1 text-xs rounded-lg border transition-colors',
                  tone === t ? 'bg-primary text-primary-foreground border-primary' : 'bg-background border-border hover:border-primary/50')}>
                {t}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Posts per Platform</label>
          <select value={numPosts} onChange={(e) => setNumPosts(Number(e.target.value))}
            className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary">
            {[3, 5, 7, 10, 15].map((n) => <option key={n} value={n}>{n} posts</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Avoid Phrases (optional)</label>
          <input value={avoidPhrases} onChange={(e) => setAvoidPhrases(e.target.value)} placeholder="synergy, best-in-class, leverage (comma-separated)"
            className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
        </div>
      </div>

      <div className="space-y-2 p-3 rounded-lg border border-border bg-muted/30">
        <div className="flex items-center gap-2">
          <input type="checkbox" id="push-ayrshare" checked={pushToAyrshare} onChange={(e) => setPushToAyrshare(e.target.checked)} className="rounded" />
          <label htmlFor="push-ayrshare" className="text-xs font-medium cursor-pointer">Push first post per platform to Ayrshare</label>
        </div>
        {pushToAyrshare && (
          <input value={ayrshareProfileKey} onChange={(e) => setAyrshareProfileKey(e.target.value)}
            placeholder="Employee's Ayrshare profile key"
            className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary font-mono" />
        )}
      </div>
    </>
  )

  const currentPlatformBlock = result?.platforms?.find((p) => p.platform === activePlatform)

  const resultNode = result ? (
    <div className="space-y-4">
      <div>
        <p className="text-sm">{result.advocacy_brief}</p>
        {result.key_message_weaving && (
          <p className="text-xs text-muted-foreground mt-1 italic">{result.key_message_weaving}</p>
        )}
      </div>

      {/* Platform tabs */}
      <div className="flex gap-2 border-b border-border pb-2 flex-wrap">
        {result.platforms?.map((p) => (
          <button key={p.platform} onClick={() => setActivePlatform(p.platform)}
            className={cn('text-xs px-3 py-1.5 rounded-lg capitalize transition-colors',
              activePlatform === p.platform ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}>
            {p.platform} ({p.posts?.length ?? 0})
          </button>
        ))}
      </div>

      {currentPlatformBlock && (
        <div className="space-y-3">
          <p className="text-[10px] text-muted-foreground">Character limit: {currentPlatformBlock.character_limit.toLocaleString()}</p>
          {currentPlatformBlock.posts?.map((post, i) => (
            <div key={i} className="rounded-xl border border-border bg-card overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-2.5 bg-muted/40 border-b border-border">
                <span className="text-sm">{ANGLE_ICONS[post.angle] ?? '📝'}</span>
                <span className="text-xs font-medium capitalize">{post.angle?.replace(/_/g, ' ')}</span>
                <span className={cn('text-[10px] px-1.5 py-0.5 rounded-full font-medium ml-auto capitalize', ENGAGEMENT_COLORS[post.estimated_engagement] ?? 'bg-muted text-muted-foreground')}>
                  {post.estimated_engagement} engagement
                </span>
              </div>
              <div className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-xs whitespace-pre-wrap leading-relaxed flex-1">{post.text}</p>
                  <CopyBtn text={post.text} />
                </div>
                {post.hashtags?.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {post.hashtags.map((h, j) => (
                      <span key={j} className="text-[10px] px-1.5 py-0.5 bg-primary/10 text-primary rounded">{h.startsWith('#') ? h : `#${h}`}</span>
                    ))}
                  </div>
                )}
                <div className="flex items-center gap-3 text-[10px] text-muted-foreground border-t border-border pt-2">
                  <span>{post.text.length} / {currentPlatformBlock.character_limit} chars</span>
                  {post.best_time_to_post && <span>Best time: {post.best_time_to_post}</span>}
                </div>
                {post.why_it_works && <p className="text-[10px] text-muted-foreground italic">{post.why_it_works}</p>}
              </div>
            </div>
          ))}
        </div>
      )}

      {(result.dos?.length > 0 || result.donts?.length > 0) && (
        <div className="grid grid-cols-2 gap-3">
          {result.dos?.length > 0 && (
            <div className="p-3 rounded-xl border border-green-200/50 bg-green-50/50 dark:bg-green-900/10 dark:border-green-900/30">
              <p className="text-[10px] font-semibold text-green-600 dark:text-green-400 uppercase mb-1">Do</p>
              {result.dos.map((d, i) => <p key={i} className="text-[10px] text-muted-foreground">✓ {d}</p>)}
            </div>
          )}
          {result.donts?.length > 0 && (
            <div className="p-3 rounded-xl border border-red-200/50 bg-red-50/50 dark:bg-red-900/10 dark:border-red-900/30">
              <p className="text-[10px] font-semibold text-red-600 dark:text-red-400 uppercase mb-1">Don't</p>
              {result.donts.map((d, i) => <p key={i} className="text-[10px] text-muted-foreground">✗ {d}</p>)}
            </div>
          )}
        </div>
      )}

      {result.ab_variants?.length > 0 && (
        <div className="p-4 rounded-xl border border-border bg-card space-y-3">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">A/B Variants</p>
          {result.ab_variants.map((v, i) => (
            <div key={i} className="space-y-2">
              <p className="text-[10px] font-medium capitalize text-muted-foreground">{v.platform}</p>
              <div className="grid grid-cols-2 gap-2">
                <div className="p-2 rounded-lg bg-muted/40 border border-border">
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-[10px] font-medium">A</p><CopyBtn text={v.variant_a} />
                  </div>
                  <p className="text-[10px]">{v.variant_a}</p>
                </div>
                <div className="p-2 rounded-lg bg-muted/40 border border-border">
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-[10px] font-medium">B</p><CopyBtn text={v.variant_b} />
                  </div>
                  <p className="text-[10px]">{v.variant_b}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {result.ayrshare_push_results && (
        <div className="p-3 rounded-lg border border-border bg-muted/30">
          <p className="text-xs font-medium">Ayrshare: {result.ayrshare_push_results.length} posts pushed for review</p>
        </div>
      )}
    </div>
  ) : null

  const canSubmit = !!topic.trim() && !!employeePersona.trim() && keyMessages.some((m) => m.trim()) && platforms.length > 0

  return (
    <SSEFeaturePage projectId={projectId} title="Employee Advocacy" subtitle="Pillar 6 - Claude + Ayrshare"
      icon={<Users className="w-4 h-4" />} credits={10} steps={store.steps}
      isStreaming={store.isStreaming} streamText={store.streamText} form={form} result={resultNode}
      onSubmit={generate} submitLabel="Generate Advocacy Posts - 10 credits" canSubmit={canSubmit}
      backPath={`/projects/${projectId}/social`} />
  )
}
