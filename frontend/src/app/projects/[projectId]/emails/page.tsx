'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import { Mail, Loader2, Copy, Check, ChevronDown, ChevronUp, Sparkles, BookmarkPlus } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { api } from '@/lib/api'
import { useAppStore } from '@/stores/app-store'
import { SidebarToggle } from '@/components/layout/sidebar'
import { BackButton } from '@/components/layout/back-button'
import type { EmailItem } from '@/types'

const SEQUENCE_TYPES = [
  { value: 'welcome',      label: 'Welcome Series',    desc: '4 emails · Onboard new subscribers' },
  { value: 'nurture',      label: 'Nurture Sequence',  desc: '5 emails · Build trust over time' },
  { value: 'launch',       label: 'Launch Sequence',   desc: '6 emails · Product/service launch' },
  { value: 're-engage',    label: 'Re-engagement',     desc: '3 emails · Win back cold subscribers' },
  { value: 'post-purchase',label: 'Post-Purchase',     desc: '4 emails · Delight & retain customers' },
]

const SINGLE_TYPES = [
  'Newsletter', 'Promotional Offer', 'Product Announcement',
  'Event Invitation', 'Follow-up', 'Thank You', 'Abandoned Cart',
]

type Tab = 'sequence' | 'single'

export default function EmailsPage() {
  const params = useParams<{ projectId: string }>()
  const { activeProject } = useAppStore()
  const [tab, setTab] = useState<Tab>('sequence')

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="flex items-center gap-3 px-3 sm:px-4 py-3 border-b border-border shrink-0">
        <SidebarToggle />
        <BackButton />
        <Mail className="w-4 h-4 text-primary" />
        <span className="text-sm font-semibold">Email Studio</span>
        {activeProject && <span className="text-xs text-muted-foreground">- {activeProject.name}</span>}
      </div>

      <div className="flex gap-1 px-4 py-2 border-b border-border shrink-0">
        {(['sequence', 'single'] as Tab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={cn(
              'px-3 py-1.5 rounded-md text-xs font-medium capitalize transition-colors',
              tab === t ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-muted',
            )}>
            {t === 'sequence' ? 'Email Sequence' : 'Single Email'}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4">
        {tab === 'sequence'
          ? <SequenceTab projectId={params.projectId} />
          : <SingleTab   projectId={params.projectId} />}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sequence Tab
// ---------------------------------------------------------------------------

function SequenceTab({ projectId }: { projectId: string }) {
  const [sequenceType, setSequenceType] = useState('welcome')
  const [goal, setGoal]                 = useState('')
  const [product, setProduct]           = useState('')
  const [loading, setLoading]           = useState(false)
  const [emails, setEmails]             = useState<EmailItem[]>([])
  const [expanded, setExpanded]         = useState<Set<number>>(new Set([0]))
  const [saved, setSaved]               = useState<Set<number>>(new Set())

  async function handleGenerate() {
    if (!goal.trim() || !product.trim()) {
      toast.error('Fill in goal and product/service fields.')
      return
    }
    setLoading(true)
    setEmails([])
    setSaved(new Set())
    try {
      const data = await api.emails.sequence(projectId, sequenceType, goal, product)
      setEmails(data.sequence)
      setExpanded(new Set([0]))
    } catch (err) {
      console.error(err)
      toast.error('Sequence generation failed.')
    } finally {
      setLoading(false)
    }
  }

  async function saveToLibrary(email: EmailItem, idx: number) {
    try {
      await api.contentLibrary.save(projectId, {
        platform: 'email',
        type: 'email',
        content: `Subject: ${email.subject}\n\nPreview: ${email.preview_text}\n\n${email.body}`,
        hashtags: [],
        status: 'draft',
        metadata: { notes: `Email ${email.number} of sequence · CTA: ${email.cta_text}` },
      })
      setSaved((prev) => new Set(prev).add(idx))
      toast.success(`Email ${email.number} saved to library`)
    } catch {
      toast.error('Failed to save')
    }
  }

  function toggle(i: number) {
    setExpanded((prev) => { const s = new Set(prev); if (s.has(i)) { s.delete(i) } else { s.add(i) }; return s })
  }

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <div className="border border-border rounded-xl bg-card p-4 space-y-3">
        {/* Sequence type picker */}
        <div className="grid grid-cols-1 gap-1.5">
          {SEQUENCE_TYPES.map((t) => (
            <button key={t.value} onClick={() => setSequenceType(t.value)}
              className={cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-lg border text-left transition-colors',
                sequenceType === t.value
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:bg-muted/40',
              )}>
              <div className={cn('w-2 h-2 rounded-full shrink-0', sequenceType === t.value ? 'bg-primary' : 'bg-muted-foreground/30')} />
              <div>
                <p className="text-xs font-semibold">{t.label}</p>
                <p className="text-[10px] text-muted-foreground">{t.desc}</p>
              </div>
            </button>
          ))}
        </div>

        <div>
          <label className="block text-xs font-medium mb-1">Goal *</label>
          <input value={goal} onChange={(e) => setGoal(e.target.value)}
            placeholder="e.g. Get subscribers to book a free demo call"
            className="w-full text-sm bg-background border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary" />
        </div>
        <div>
          <label className="block text-xs font-medium mb-1">Product / Service *</label>
          <input value={product} onChange={(e) => setProduct(e.target.value)}
            placeholder="e.g. LEO - AI marketing co-pilot for growing brands"
            className="w-full text-sm bg-background border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary" />
        </div>
        <button onClick={handleGenerate} disabled={loading || !goal.trim() || !product.trim()}
          className="w-full flex items-center justify-center gap-2 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
          {loading ? 'Generating sequence…' : 'Generate Sequence'}
        </button>
      </div>

      {emails.map((email, i) => (
        <EmailCard
          key={i}
          email={email}
          expanded={expanded.has(i)}
          onToggle={() => toggle(i)}
          onSave={() => saveToLibrary(email, i)}
          saved={saved.has(i)}
        />
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Single Email Tab
// ---------------------------------------------------------------------------

function SingleTab({ projectId }: { projectId: string }) {
  const [emailType, setEmailType] = useState('Newsletter')
  const [context, setContext]     = useState('')
  const [loading, setLoading]     = useState(false)
  const [email, setEmail]         = useState<EmailItem | null>(null)
  const [saved, setSaved]         = useState(false)

  async function handleGenerate() {
    if (!context.trim()) { toast.error('Describe what the email should achieve.'); return }
    setLoading(true)
    setEmail(null)
    setSaved(false)
    try {
      const data = await api.emails.single(projectId, emailType, context)
      setEmail(data as unknown as EmailItem)
    } catch (err) {
      console.error(err)
      toast.error('Email generation failed.')
    } finally {
      setLoading(false)
    }
  }

  async function saveToLibrary() {
    if (!email) return
    try {
      await api.contentLibrary.save(projectId, {
        platform: 'email',
        type: 'email',
        content: `Subject: ${email.subject}\n\nPreview: ${email.preview_text}\n\n${email.body}`,
        hashtags: [],
        status: 'draft',
        metadata: { notes: `CTA: ${email.cta_text}` },
      })
      setSaved(true)
      toast.success('Saved to Content Library')
    } catch { toast.error('Failed to save') }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <div className="border border-border rounded-xl bg-card p-4 space-y-3">
        <div>
          <label className="block text-xs font-medium mb-1.5">Email Type</label>
          <div className="flex flex-wrap gap-1.5">
            {SINGLE_TYPES.map((t) => (
              <button key={t} onClick={() => setEmailType(t)}
                className={cn(
                  'px-2.5 py-1 rounded-md text-xs font-medium border transition-colors',
                  emailType === t
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'border-border text-muted-foreground hover:text-foreground hover:bg-muted',
                )}>
                {t}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium mb-1">Goal / Context *</label>
          <textarea value={context} onChange={(e) => setContext(e.target.value)} rows={3}
            placeholder="e.g. Announce our new AI analytics feature to existing customers, highlight time savings, CTA to upgrade"
            className="w-full text-sm bg-background border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary resize-none" />
        </div>
        <button onClick={handleGenerate} disabled={loading || !context.trim()}
          className="w-full flex items-center justify-center gap-2 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
          {loading ? 'Generating…' : 'Generate Email'}
        </button>
      </div>

      {email && (
        <EmailCard
          email={{ ...email, number: 1, send_day: 0 }}
          expanded={true}
          onToggle={() => {}}
          onSave={saveToLibrary}
          saved={saved}
          single
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// EmailCard
// ---------------------------------------------------------------------------

function EmailCard({
  email, expanded, onToggle, onSave, saved, single = false,
}: {
  email: EmailItem
  expanded: boolean
  onToggle: () => void
  onSave: () => void
  saved: boolean
  single?: boolean
}) {
  const [copiedBody, setCopiedBody] = useState(false)

  function copyBody() {
    navigator.clipboard.writeText(email.body)
    setCopiedBody(true)
    toast.success('Email body copied!')
    setTimeout(() => setCopiedBody(false), 2000)
  }

  return (
    <div className="border border-border rounded-xl bg-card overflow-hidden">
      <button onClick={onToggle} className={cn('flex items-center justify-between w-full px-4 py-3 transition-colors', !single && 'hover:bg-muted/30')}>
        <div className="flex items-center gap-3">
          {!single && (
            <span className="w-6 h-6 rounded-full bg-primary/10 text-primary text-[10px] font-bold flex items-center justify-center shrink-0">
              {email.number}
            </span>
          )}
          <div className="text-left">
            <p className="text-sm font-semibold leading-tight">{email.subject}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{email.preview_text}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0 ml-2">
          {!single && (
            <span className="text-[10px] text-muted-foreground">Day {email.send_day}</span>
          )}
          {!single && (expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />)}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-border/50 px-4 pb-4 space-y-3">
          <div className="pt-3">
            <p className="text-[10px] font-medium text-muted-foreground uppercase mb-2">Body</p>
            <p className="text-sm text-foreground/80 whitespace-pre-wrap leading-relaxed">{email.body}</p>
          </div>
          {email.cta_text && (
            <div>
              <p className="text-[10px] font-medium text-muted-foreground uppercase mb-1">CTA</p>
              <span className="inline-block px-4 py-1.5 bg-primary text-primary-foreground text-xs font-semibold rounded-lg">{email.cta_text}</span>
            </div>
          )}
          <div className="flex items-center gap-2 pt-1">
            <button onClick={copyBody}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                copiedBody ? 'bg-green-500/10 text-green-600' : 'bg-muted text-foreground hover:bg-muted/70',
              )}>
              {copiedBody ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              {copiedBody ? 'Copied!' : 'Copy body'}
            </button>
            <button onClick={onSave} disabled={saved}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors',
                saved ? 'border-green-500/30 text-green-600 bg-green-500/5' : 'border-border text-muted-foreground hover:text-foreground hover:bg-muted',
              )}>
              <BookmarkPlus className="w-3.5 h-3.5" />
              {saved ? 'Saved' : 'Save to Library'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
