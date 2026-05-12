'use client'

import { useState, useRef } from 'react'
import { useParams } from 'next/navigation'
import { Clock, Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import { SSEFeaturePage } from '@/components/pillar1/SSEFeaturePage'
import { api } from '@/lib/api'
import { usePillar5Store } from '@/stores/pillar5-store'
import type { ProgressStep } from '@/types'
import { cn } from '@/lib/utils'

const EMAIL_TYPES = ['newsletter', 'promotional', 'transactional', 're-engagement', 'event']
const TIMEZONES = ['US Eastern', 'US Pacific', 'US Central', 'UK / GMT', 'CET / Europe', 'AEST / Australia', 'IST / India', 'JST / Japan']
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const RATE_COLORS: Record<string, string> = {
  high: 'bg-green-500', above_avg: 'bg-lime-400', average: 'bg-yellow-400',
  below_avg: 'bg-orange-400', low: 'bg-red-500',
}

interface OpenDataRow { day: string; hour: string; open_rate: string }

interface SendTimePayload {
  recommendation_summary: string
  primary_send_window: { day: string; time_range: string; timezone: string; confidence: string; rationale: string }
  secondary_send_window: { day: string; time_range: string; timezone: string; rationale: string }
  windows_to_avoid: { window: string; reason: string }[]
  day_of_week_analysis: { day: string; relative_open_rate: string; notes: string }[]
  time_of_day_analysis: { time_block: string; relative_open_rate: string; notes: string }[]
  data_insights: string[]
  personalisation_tip: string
  frequency_recommendation: string
  ab_test_suggestion: string
}

export default function SendTimePage() {
  const { projectId } = useParams<{ projectId: string }>()
  const store = usePillar5Store()

  const [audience, setAudience] = useState('')
  const [emailType, setEmailType] = useState('newsletter')
  const [timezone, setTimezone] = useState('US Eastern')
  const [industry, setIndustry] = useState('')
  const [openData, setOpenData] = useState<OpenDataRow[]>([])
  const [result, setResult] = useState<SendTimePayload | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  function addRow() { setOpenData([...openData, { day: 'Monday', hour: '9', open_rate: '' }]) }
  function removeRow(i: number) { setOpenData(openData.filter((_, idx) => idx !== i)) }
  function updateRow(i: number, field: keyof OpenDataRow, val: string) {
    const next = [...openData]; next[i] = { ...next[i], [field]: val }; setOpenData(next)
  }

  async function generate() {
    if (!audience.trim()) { toast.error('Describe your audience'); return }
    abortRef.current?.abort(); abortRef.current = new AbortController()
    store.setIsStreaming(true); store.clearSteps(); store.clearStreamText(); setResult(null)

    const existingData = openData.length > 0
      ? openData.filter(r => r.day && r.hour && r.open_rate).map(r => ({ day: r.day, hour: parseInt(r.hour), open_rate: parseFloat(r.open_rate) }))
      : undefined

    try {
      await api.pillar5.streamSendTime(projectId,
        { audience_description: audience.trim(), email_type: emailType, timezone_focus: timezone,
          industry: industry.trim() || undefined, existing_open_data: existingData },
        {
          onStep: (s, l, st) => store.upsertStep(s, l, st as ProgressStep['status']),
          onDelta: (t) => store.appendStreamText(t),
          onSaved: (_, p) => { setResult(p as unknown as SendTimePayload); store.clearStreamText(); store.setIsStreaming(false); toast.success('Send time analysis ready!') },
          onError: (m) => { toast.error(m); store.setIsStreaming(false) },
          onDone: () => store.setIsStreaming(false),
        }, abortRef.current.signal)
    } catch { store.setIsStreaming(false) }
  }

  const form = (
    <>
      <h2 className="font-semibold text-sm">Send Time Optimiser</h2>
      <div>
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Audience *</label>
        <textarea value={audience} onChange={(e) => setAudience(e.target.value)} rows={2}
          placeholder="e.g. B2B marketing managers at tech companies, mostly US-based, inbox-heavy"
          className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary resize-none" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Email Type</label>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {EMAIL_TYPES.map((t) => (
              <button key={t} onClick={() => setEmailType(t)}
                className={cn('px-2.5 py-1 text-xs rounded-lg border capitalize transition-colors',
                  emailType === t ? 'bg-primary text-primary-foreground border-primary' : 'bg-background border-border hover:border-primary/50')}>
                {t.replace(/-/g, ' ')}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Primary Timezone</label>
          <select value={timezone} onChange={(e) => setTimezone(e.target.value)}
            className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary">
            {TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
          </select>
        </div>
      </div>
      <div>
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Industry (optional)</label>
        <input value={industry} onChange={(e) => setIndustry(e.target.value)} placeholder="e.g. SaaS, E-commerce, Healthcare"
          className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
      </div>
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Historical Open Data (optional)</label>
          <button onClick={addRow} className="flex items-center gap-1 text-xs text-primary hover:text-primary/80">
            <Plus className="w-3 h-3" /> Add row
          </button>
        </div>
        {openData.length > 0 && (
          <div className="rounded-lg border border-border overflow-hidden">
            <div className="grid grid-cols-[1.5fr_1fr_1fr_auto] gap-0 bg-muted px-3 py-2">
              {['Day', 'Hour (24h)', 'Open Rate %', ''].map((h) => (
                <p key={h} className="text-[10px] font-semibold text-muted-foreground">{h}</p>
              ))}
            </div>
            {openData.map((row, i) => (
              <div key={i} className="grid grid-cols-[1.5fr_1fr_1fr_auto] gap-1 px-2 py-1.5 border-t border-border items-center">
                <select value={row.day} onChange={(e) => updateRow(i, 'day', e.target.value)}
                  className="px-2 py-1 text-xs bg-background border border-border rounded focus:outline-none">
                  {DAYS.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
                <input value={row.hour} onChange={(e) => updateRow(i, 'hour', e.target.value)}
                  placeholder="9" type="number" min="0" max="23"
                  className="px-2 py-1 text-xs bg-background border border-border rounded focus:outline-none" />
                <input value={row.open_rate} onChange={(e) => updateRow(i, 'open_rate', e.target.value)}
                  placeholder="24.5" type="number" min="0" max="100" step="0.1"
                  className="px-2 py-1 text-xs bg-background border border-border rounded focus:outline-none" />
                <button onClick={() => removeRow(i)} className="text-muted-foreground hover:text-destructive transition-colors p-1">
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}
        {openData.length === 0 && (
          <p className="text-[10px] text-muted-foreground">No data? Claude will use industry benchmarks for your audience.</p>
        )}
      </div>
    </>
  )

  const resultNode = result ? (
    <div className="space-y-4">
      <p className="text-sm">{result.recommendation_summary}</p>
      <div className="grid grid-cols-2 gap-3">
        {result.primary_send_window && (
          <div className="p-4 rounded-xl border border-primary/50 bg-primary/5">
            <p className="text-[10px] font-semibold text-primary uppercase tracking-wide mb-1">Primary Window</p>
            <p className="text-sm font-bold">{result.primary_send_window.day}</p>
            <p className="text-sm text-primary">{result.primary_send_window.time_range}</p>
            <p className="text-[10px] text-muted-foreground mt-1">{result.primary_send_window.timezone}</p>
            <span className={cn('inline-block mt-1 text-[10px] px-1.5 py-0.5 rounded-full font-medium capitalize',
              result.primary_send_window.confidence === 'high' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
              : 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400')}>
              {result.primary_send_window.confidence} confidence
            </span>
            <p className="text-xs text-muted-foreground mt-2">{result.primary_send_window.rationale}</p>
          </div>
        )}
        {result.secondary_send_window && (
          <div className="p-4 rounded-xl border border-border bg-card">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">Secondary Window</p>
            <p className="text-sm font-bold">{result.secondary_send_window.day}</p>
            <p className="text-sm">{result.secondary_send_window.time_range}</p>
            <p className="text-[10px] text-muted-foreground mt-1">{result.secondary_send_window.timezone}</p>
            <p className="text-xs text-muted-foreground mt-2">{result.secondary_send_window.rationale}</p>
          </div>
        )}
      </div>

      {result.day_of_week_analysis?.length > 0 && (
        <div className="p-4 rounded-xl border border-border bg-card space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Day of Week</p>
          {result.day_of_week_analysis.map((d, i) => (
            <div key={i} className="flex items-center gap-3">
              <span className="text-xs font-medium w-20 shrink-0">{d.day}</span>
              <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: '' }}>
                <div className={cn('w-2 h-2 rounded-full', RATE_COLORS[d.relative_open_rate] ?? 'bg-muted')} />
              </div>
              <span className={cn('text-[10px] px-1.5 py-0.5 rounded-full shrink-0 capitalize',
                d.relative_open_rate === 'high' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                : d.relative_open_rate === 'low' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                : 'bg-muted text-muted-foreground')}>
                {d.relative_open_rate.replace(/_/g, ' ')}
              </span>
              <span className="text-[10px] text-muted-foreground">{d.notes}</span>
            </div>
          ))}
        </div>
      )}

      {result.windows_to_avoid?.length > 0 && (
        <div className="p-4 rounded-xl border border-red-200/50 bg-red-50/50 dark:bg-red-900/10 dark:border-red-900/30 space-y-1">
          <p className="text-xs font-semibold text-red-600 dark:text-red-400 uppercase tracking-wide mb-1">Avoid These Windows</p>
          {result.windows_to_avoid.map((w, i) => (
            <div key={i} className="text-xs flex gap-2">
              <span className="font-medium shrink-0">{w.window}:</span>
              <span className="text-muted-foreground">{w.reason}</span>
            </div>
          ))}
        </div>
      )}

      {result.data_insights?.length > 0 && (
        <div className="p-4 rounded-xl border border-border bg-card space-y-1">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Data Insights</p>
          {result.data_insights.map((s, i) => <p key={i} className="text-xs text-muted-foreground">• {s}</p>)}
        </div>
      )}

      {result.personalisation_tip && (
        <div className="p-3 rounded-lg border border-primary/20 bg-primary/5 text-xs text-muted-foreground">
          <span className="font-medium text-primary">Per-contact tip: </span>{result.personalisation_tip}
        </div>
      )}

      {result.frequency_recommendation && (
        <div className="p-3 rounded-lg border border-border text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Frequency: </span>{result.frequency_recommendation}
        </div>
      )}
      {result.ab_test_suggestion && (
        <div className="p-3 rounded-lg border border-border text-xs text-muted-foreground">
          <span className="font-medium text-foreground">A/B Test: </span>{result.ab_test_suggestion}
        </div>
      )}
    </div>
  ) : null

  return (
    <SSEFeaturePage projectId={projectId} title="Send Time Optimiser" subtitle="Pillar 5 - Claude"
      icon={<Clock className="w-4 h-4" />} credits={5} steps={store.steps}
      isStreaming={store.isStreaming} streamText={store.streamText} form={form} result={resultNode}
      onSubmit={generate} submitLabel="Analyse Send Times - 5 credits" canSubmit={!!audience.trim()}
      backPath={`/projects/${projectId}/email-crm`} />
  )
}
