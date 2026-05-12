'use client'

import { useState, useRef } from 'react'
import { useParams } from 'next/navigation'
import { MessageSquare, Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import { SSEFeaturePage } from '@/components/pillar1/SSEFeaturePage'
import { api } from '@/lib/api'
import { usePillar6Store } from '@/stores/pillar6-store'
import type { ProgressStep } from '@/types'
import { cn } from '@/lib/utils'

const PLATFORMS = ['instagram', 'twitter', 'facebook', 'linkedin', 'tiktok', 'threads']
const SENTIMENT_HINTS = ['positive', 'neutral', 'negative', 'question']
const PRIORITY_STYLES: Record<string, string> = {
  high:   'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  medium: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
  low:    'bg-muted text-muted-foreground',
}
const ACTION_STYLES: Record<string, string> = {
  reply:    'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  escalate: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  delete:   'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  ignore:   'bg-muted text-muted-foreground',
}

interface CommentRow {
  comment_id: string
  author: string
  platform: string
  text: string
  sentiment_hint: string
}

interface CommentReply {
  comment_id: string
  author: string
  platform: string
  original_comment: string
  sentiment: string
  priority: string
  action_type: string
  suggested_reply: string
  reply_rationale: string
  follow_up_action: string | null
}

interface CommunityPayload {
  community_summary: string
  platform_notes: string
  replies: CommentReply[]
  recurring_themes: string[]
  escalation_required: string[]
  engagement_tips: string[]
  total_comments: number
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

function newComment(i: number): CommentRow {
  return { comment_id: '', author: '', platform: 'instagram', text: '', sentiment_hint: '' }
}

export default function CommunityManagementPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const store = usePillar6Store()

  const [replyTone, setReplyTone] = useState('warm, helpful, and on-brand')
  const [brandGuidelines, setBrandGuidelines] = useState('')
  const [ayrshareIds, setAyrshareIds] = useState('')
  const [comments, setComments] = useState<CommentRow[]>([newComment(0)])
  const [result, setResult] = useState<CommunityPayload | null>(null)
  const [filter, setFilter] = useState<string>('all')
  const abortRef = useRef<AbortController | null>(null)

  function addComment() { if (comments.length < 50) setComments([...comments, newComment(comments.length)]) }
  function removeComment(i: number) { setComments(comments.filter((_, idx) => idx !== i)) }
  function updateComment(i: number, field: keyof CommentRow, val: string) {
    const next = [...comments]; next[i] = { ...next[i], [field]: val }; setComments(next)
  }

  async function generate() {
    const validComments = comments.filter((c) => c.text.trim() && c.platform)
    const ids = ayrshareIds.split('\n').map((s) => s.trim()).filter(Boolean)
    if (validComments.length === 0 && ids.length === 0) {
      toast.error('Enter at least one comment or Ayrshare post ID'); return
    }

    abortRef.current?.abort(); abortRef.current = new AbortController()
    store.setIsStreaming(true); store.clearSteps(); store.clearStreamText(); setResult(null)

    const body: Record<string, unknown> = {
      reply_tone: replyTone.trim(),
      ...(brandGuidelines.trim() && { brand_guidelines: brandGuidelines.trim() }),
      ...(ids.length > 0 && { ayrshare_post_ids: ids }),
      ...(validComments.length > 0 && {
        manual_comments: validComments.map((c, i) => ({
          comment_id: c.comment_id || `c${i}`,
          author: c.author || 'unknown',
          platform: c.platform,
          text: c.text,
          ...(c.sentiment_hint && { sentiment_hint: c.sentiment_hint }),
        })),
      }),
    }

    try {
      await api.pillar6.streamCommunityManagement(projectId, body,
        {
          onStep: (s, l, st) => store.upsertStep(s, l, st as ProgressStep['status']),
          onDelta: (t) => store.appendStreamText(t),
          onSaved: (_, p) => { setResult(p as unknown as CommunityPayload); store.clearStreamText(); store.setIsStreaming(false); toast.success('Replies ready!') },
          onError: (m) => { toast.error(m); store.setIsStreaming(false) },
          onDone: () => store.setIsStreaming(false),
        }, abortRef.current.signal)
    } catch { store.setIsStreaming(false) }
  }

  const filteredReplies = result?.replies?.filter((r) =>
    filter === 'all' ? true : filter === 'escalate' ? r.action_type === 'escalate' : r.priority === filter
  ) ?? []

  const form = (
    <>
      <h2 className="font-semibold text-sm">Community Management</h2>

      <div>
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Reply Tone</label>
        <input value={replyTone} onChange={(e) => setReplyTone(e.target.value)}
          placeholder="e.g. warm, helpful, and on-brand"
          className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
      </div>

      <div>
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Brand Guidelines (optional)</label>
        <textarea value={brandGuidelines} onChange={(e) => setBrandGuidelines(e.target.value)} rows={2}
          placeholder="e.g. Never offer refunds in public comments. Always sign off with our brand name."
          className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary resize-none" />
      </div>

      <div className="p-3 rounded-lg border border-border bg-muted/20">
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Ayrshare Post IDs (optional)</label>
        <textarea value={ayrshareIds} onChange={(e) => setAyrshareIds(e.target.value)} rows={2}
          placeholder="One post ID per line - Claude pulls live comments via Ayrshare API"
          className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary resize-none font-mono" />
        <p className="text-[10px] text-muted-foreground mt-1">Requires AYRSHARE_API_KEY + connected Ayrshare profile</p>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Manual Comments ({comments.length})</label>
          {comments.length < 50 && (
            <button onClick={addComment} className="flex items-center gap-1 text-xs text-primary hover:text-primary/80"><Plus className="w-3 h-3" /> Add</button>
          )}
        </div>
        <div className="space-y-2">
          {comments.map((c, i) => (
            <div key={i} className="p-3 rounded-lg border border-border bg-muted/20 space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <div className="flex gap-1 flex-wrap">
                  {PLATFORMS.map((p) => (
                    <button key={p} onClick={() => updateComment(i, 'platform', p)}
                      className={cn('px-2 py-1 text-[10px] rounded border capitalize transition-colors',
                        c.platform === p ? 'bg-primary text-primary-foreground border-primary' : 'bg-background border-border hover:border-primary/50')}>
                      {p}
                    </button>
                  ))}
                </div>
                <div className="flex items-center justify-between">
                  <select value={c.sentiment_hint} onChange={(e) => updateComment(i, 'sentiment_hint', e.target.value)}
                    className="px-2 py-1 text-xs bg-background border border-border rounded focus:outline-none flex-1">
                    <option value="">Sentiment hint</option>
                    {SENTIMENT_HINTS.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                  {comments.length > 1 && (
                    <button onClick={() => removeComment(i)} className="ml-2 text-muted-foreground hover:text-destructive transition-colors">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <input value={c.author} onChange={(e) => updateComment(i, 'author', e.target.value)} placeholder="Author / username"
                  className="px-2 py-1.5 text-xs bg-background border border-border rounded focus:outline-none" />
                <input value={c.comment_id} onChange={(e) => updateComment(i, 'comment_id', e.target.value)} placeholder="Comment ID (optional)"
                  className="px-2 py-1.5 text-xs bg-background border border-border rounded focus:outline-none" />
              </div>
              <textarea value={c.text} onChange={(e) => updateComment(i, 'text', e.target.value)} rows={2}
                placeholder="Paste the comment text here…"
                className="w-full px-2 py-1.5 text-xs bg-background border border-border rounded focus:outline-none resize-none" />
            </div>
          ))}
        </div>
      </div>
    </>
  )

  const resultNode = result ? (
    <div className="space-y-4">
      <p className="text-sm">{result.community_summary}</p>
      {result.platform_notes && <p className="text-xs text-muted-foreground italic">{result.platform_notes}</p>}

      {/* Stats row */}
      <div className="grid grid-cols-4 gap-2">
        {[
          { label: 'Total', value: result.total_comments },
          { label: 'Escalate', value: result.escalation_required?.length ?? 0, color: 'text-orange-500' },
          { label: 'High Pri', value: result.replies?.filter((r) => r.priority === 'high').length ?? 0, color: 'text-red-500' },
          { label: 'Themes', value: result.recurring_themes?.length ?? 0, color: 'text-primary' },
        ].map((s) => (
          <div key={s.label} className="p-3 rounded-xl border border-border bg-card text-center">
            <p className={cn('text-lg font-bold', s.color ?? '')}>{s.value}</p>
            <p className="text-[10px] text-muted-foreground">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 flex-wrap border-b border-border pb-2">
        {['all', 'high', 'medium', 'low', 'escalate'].map((f) => (
          <button key={f} onClick={() => setFilter(f)}
            className={cn('text-xs px-3 py-1.5 rounded-lg capitalize transition-colors',
              filter === f ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}>
            {f}
          </button>
        ))}
      </div>

      {/* Reply cards */}
      <div className="space-y-3">
        {filteredReplies.map((r, i) => (
          <div key={i} className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-2.5 bg-muted/40 border-b border-border flex-wrap">
              <span className="text-xs font-medium">{r.author}</span>
              <span className="text-[10px] text-muted-foreground capitalize">· {r.platform}</span>
              <span className={cn('text-[10px] px-1.5 py-0.5 rounded-full font-medium capitalize ml-auto', PRIORITY_STYLES[r.priority] ?? 'bg-muted text-muted-foreground')}>{r.priority}</span>
              <span className={cn('text-[10px] px-1.5 py-0.5 rounded-full font-medium capitalize', ACTION_STYLES[r.action_type] ?? 'bg-muted text-muted-foreground')}>{r.action_type}</span>
            </div>
            <div className="p-4 space-y-3">
              <p className="text-xs text-muted-foreground bg-muted/40 rounded-lg px-3 py-2 italic">"{r.original_comment}"</p>
              {r.action_type === 'reply' && r.suggested_reply && (
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase">Suggested reply</p>
                    <CopyBtn text={r.suggested_reply} />
                  </div>
                  <p className="text-xs leading-relaxed">{r.suggested_reply}</p>
                </div>
              )}
              {r.reply_rationale && <p className="text-[10px] text-muted-foreground italic">{r.reply_rationale}</p>}
              {r.follow_up_action && (
                <div className="flex items-center gap-2 text-[10px]">
                  <span className="font-semibold text-primary">Follow-up:</span>
                  <span className="text-muted-foreground">{r.follow_up_action}</span>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {result.recurring_themes?.length > 0 && (
        <div className="p-4 rounded-xl border border-border bg-card space-y-1">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Recurring Themes</p>
          {result.recurring_themes.map((t, i) => <p key={i} className="text-xs text-muted-foreground">• {t}</p>)}
        </div>
      )}

      {result.engagement_tips?.length > 0 && (
        <div className="p-4 rounded-xl border border-primary/20 bg-primary/5 space-y-1">
          <p className="text-xs font-semibold text-primary uppercase tracking-wide mb-1">Engagement Tips</p>
          {result.engagement_tips.map((t, i) => <p key={i} className="text-xs text-muted-foreground">• {t}</p>)}
        </div>
      )}
    </div>
  ) : null

  const canSubmit = comments.some((c) => c.text.trim()) || ayrshareIds.trim().length > 0

  return (
    <SSEFeaturePage projectId={projectId} title="Community Management" subtitle="Pillar 6 - Claude + Ayrshare"
      icon={<MessageSquare className="w-4 h-4" />} credits={10} steps={store.steps}
      isStreaming={store.isStreaming} streamText={store.streamText} form={form} result={resultNode}
      onSubmit={generate} submitLabel="Draft Replies - 10 credits" canSubmit={canSubmit}
      backPath={`/projects/${projectId}/social`} />
  )
}
