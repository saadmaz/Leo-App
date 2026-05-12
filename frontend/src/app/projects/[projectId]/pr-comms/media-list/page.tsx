'use client'

import { useState, useRef } from 'react'
import { useParams } from 'next/navigation'
import { Users, Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import { SSEFeaturePage } from '@/components/pillar1/SSEFeaturePage'
import { api } from '@/lib/api'
import { usePillar8Store } from '@/stores/pillar8-store'
import type { ProgressStep } from '@/types'
import { cn } from '@/lib/utils'

const TIER_COLORS: Record<string, string> = {
  A: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  B: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  C: 'bg-muted text-muted-foreground',
}

interface MediaContact {
  rank: number
  journalist_name: string
  title?: string
  publication: string
  beat: string
  email?: string
  linkedin_url?: string
  why_target: string
  personalisation_hook: string
  tier: 'A' | 'B' | 'C'
}

interface MediaListPayload {
  media_list: MediaContact[]
  outreach_strategy: string
  total_contacts: number
  industry: string
  news_angle: string
}

export default function MediaListPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const store = usePillar8Store()

  const [industry, setIndustry] = useState('')
  const [newsAngle, setNewsAngle] = useState('')
  const [geography, setGeography] = useState('')
  const [numContacts, setNumContacts] = useState(20)
  const [verifyEmails, setVerifyEmails] = useState(true)
  const [pubTypes, setPubTypes] = useState<string[]>(['tech press', 'trade publications', 'business media'])
  const [newPubType, setNewPubType] = useState('')
  const [result, setResult] = useState<MediaListPayload | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  function addPubType() {
    if (newPubType.trim() && !pubTypes.includes(newPubType.trim())) {
      setPubTypes([...pubTypes, newPubType.trim()])
      setNewPubType('')
    }
  }

  async function generate() {
    if (!industry.trim()) { toast.error('Enter the target industry'); return }
    if (!newsAngle.trim()) { toast.error('Describe your news angle'); return }

    abortRef.current?.abort()
    abortRef.current = new AbortController()
    store.setIsStreaming(true)
    store.clearSteps()
    store.clearStreamText()
    setResult(null)

    try {
      await api.pillar8.streamMediaList(
        projectId,
        {
          industry: industry.trim(),
          news_angle: newsAngle.trim(),
          geography: geography.trim() || undefined,
          publication_types: pubTypes,
          num_contacts: numContacts,
          verify_emails: verifyEmails,
        },
        {
          onStep: (step, label, status) => store.upsertStep(step, label, status as ProgressStep['status']),
          onDelta: (text) => store.appendStreamText(text),
          onSaved: (_id, payload) => {
            setResult(payload as unknown as MediaListPayload)
            store.clearStreamText()
            store.setIsStreaming(false)
            toast.success('Media list ready!')
          },
          onError: (msg) => { toast.error(msg); store.setIsStreaming(false) },
          onDone: () => store.setIsStreaming(false),
        },
        abortRef.current.signal,
      )
    } catch { store.setIsStreaming(false) }
  }

  const canSubmit = !!industry.trim() && !!newsAngle.trim()

  const form = (
    <>
      <h2 className="font-semibold text-sm">Media List Builder</h2>

      <div>
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Industry / Beat *</label>
        <input value={industry} onChange={(e) => setIndustry(e.target.value)} placeholder="e.g. B2B SaaS, fintech, climate tech"
          className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
      </div>

      <div>
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">News Angle *</label>
        <textarea value={newsAngle} onChange={(e) => setNewsAngle(e.target.value)} rows={2}
          placeholder="e.g. Series A announcement - AI logistics platform that cuts delivery costs by 30%"
          className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary resize-none" />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Geography</label>
          <input value={geography} onChange={(e) => setGeography(e.target.value)} placeholder="e.g. US, UK, global"
            className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Target Contacts</label>
          <select value={numContacts} onChange={(e) => setNumContacts(Number(e.target.value))}
            className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary">
            {[10, 15, 20, 30, 40, 50].map((n) => <option key={n} value={n}>{n} contacts</option>)}
          </select>
        </div>
      </div>

      <div>
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Publication Types</label>
        <div className="mt-1 flex flex-wrap gap-2">
          {pubTypes.map((t) => (
            <span key={t} className="flex items-center gap-1 px-2.5 py-1 text-xs rounded-full bg-primary/10 text-primary">
              {t}
              <button onClick={() => setPubTypes(pubTypes.filter((p) => p !== t))} className="hover:text-destructive">
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
        <div className="mt-2 flex gap-2">
          <input value={newPubType} onChange={(e) => setNewPubType(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addPubType()}
            placeholder="Add type… (press Enter)"
            className="flex-1 px-3 py-1.5 text-xs bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
          <button onClick={addPubType} className="px-3 py-1.5 text-xs rounded-lg border border-border hover:border-primary/50">
            <Plus className="w-3 h-3" />
          </button>
        </div>
      </div>

      <label className="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" checked={verifyEmails} onChange={(e) => setVerifyEmails(e.target.checked)}
          className="rounded border-border" />
        <span className="text-xs text-muted-foreground">Verify emails via Hunter.io (requires HUNTER_API_KEY)</span>
      </label>
    </>
  )

  const resultNode = result ? (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-sm">{result.industry} - {result.total_contacts} contacts</h2>
        <div className="flex gap-1.5">
          {(['A', 'B', 'C'] as const).map((t) => {
            const count = result.media_list?.filter((c) => c.tier === t).length || 0
            return <span key={t} className={cn('text-[10px] px-2 py-0.5 rounded-full font-medium', TIER_COLORS[t])}>Tier {t}: {count}</span>
          })}
        </div>
      </div>

      {result.outreach_strategy && (
        <div className="p-4 rounded-xl border border-border bg-card">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Outreach Strategy</p>
          <p className="text-sm">{result.outreach_strategy}</p>
        </div>
      )}

      <div className="space-y-3">
        {result.media_list?.map((contact, i) => (
          <div key={i} className="p-4 rounded-xl border border-border bg-card">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="w-5 h-5 rounded bg-muted text-muted-foreground text-[10px] font-bold flex items-center justify-center shrink-0">{contact.rank}</span>
                <div>
                  <p className="font-medium text-sm">{contact.journalist_name}</p>
                  {contact.title && <p className="text-xs text-muted-foreground">{contact.title}</p>}
                </div>
              </div>
              <span className={cn('text-[10px] px-2 py-0.5 rounded-full font-medium shrink-0', TIER_COLORS[contact.tier])}>
                Tier {contact.tier}
              </span>
            </div>

            <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span><span className="font-medium">Outlet:</span> {contact.publication}</span>
              <span><span className="font-medium">Beat:</span> {contact.beat}</span>
              {contact.email && <span><span className="font-medium">Email:</span> {contact.email}</span>}
              {contact.linkedin_url && (
                <a href={contact.linkedin_url} target="_blank" rel="noopener noreferrer"
                  className="text-primary hover:underline">LinkedIn ↗</a>
              )}
            </div>

            <div className="mt-2 space-y-1">
              <p className="text-[10px] text-muted-foreground">{contact.why_target}</p>
              <p className="text-[10px] text-primary/80 italic">Hook: {contact.personalisation_hook}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  ) : null

  return (
    <SSEFeaturePage
      projectId={projectId}
      title="Media List Builder"
      subtitle="Pillar 8 - Hunter.io + Claude"
      icon={<Users className="w-4 h-4" />}
      credits={20}
      steps={store.steps}
      isStreaming={store.isStreaming}
      streamText={store.streamText}
      form={form}
      result={resultNode}
      onSubmit={generate}
      submitLabel="Build Media List - 20 credits"
      canSubmit={canSubmit}
      backPath={`/projects/${projectId}/pr-comms`}
    />
  )
}
