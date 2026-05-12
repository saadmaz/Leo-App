'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import { usePillar7Store } from '@/stores/pillar7-store'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { ArrowLeft, Plus, Trash2, FileText, CheckCircle, XCircle, Copy, Check } from 'lucide-react'
import { useRouter } from 'next/navigation'

interface MetricRow {
  id: string
  name: string
  value: string
  vs_prior: string
  context: string
}

interface ListItem {
  id: string
  text: string
}

const REPORT_TYPES = [
  { value: 'board_update', label: 'Board Update' },
  { value: 'investor_update', label: 'Investor Update' },
  { value: 'exec_summary', label: 'Exec Summary' },
  { value: 'monthly_review', label: 'Monthly Review' },
]

const TONES = ['professional', 'confident', 'transparent', 'optimistic']

const STATUS_STYLES: Record<string, string> = {
  on_track: 'bg-green-100 text-green-700',
  exceeded: 'bg-blue-100 text-blue-700',
  at_risk: 'bg-yellow-100 text-yellow-700',
  below_target: 'bg-red-100 text-red-700',
}

export default function BoardReportPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const router = useRouter()
  const { isStreaming, steps, upsertStep, clearSteps, clearStreamText, setStreaming } = usePillar7Store()

  const [companyName, setCompanyName] = useState('')
  const [reportPeriod, setReportPeriod] = useState('')
  const [reportType, setReportType] = useState('board_update')
  const [tone, setTone] = useState('professional')
  const [includeAppendix, setIncludeAppendix] = useState(true)
  const [narrativeContext, setNarrativeContext] = useState('')

  const [metrics, setMetrics] = useState<MetricRow[]>([
    { id: '1', name: '', value: '', vs_prior: '', context: '' },
  ])

  const [wins, setWins] = useState<ListItem[]>([{ id: '1', text: '' }])
  const [challenges, setChallenges] = useState<ListItem[]>([{ id: '1', text: '' }])
  const [priorities, setPriorities] = useState<ListItem[]>([{ id: '1', text: '' }])

  const [result, setResult] = useState<any>(null)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState('')

  const addMetric = () => setMetrics(prev => [...prev, { id: Date.now().toString(), name: '', value: '', vs_prior: '', context: '' }])
  const removeMetric = (id: string) => setMetrics(prev => prev.filter(m => m.id !== id))
  const updateMetric = (id: string, field: keyof MetricRow, value: string) => setMetrics(prev => prev.map(m => m.id === id ? { ...m, [field]: value } : m))

  const addItem = (setter: any) => setter((prev: ListItem[]) => [...prev, { id: Date.now().toString(), text: '' }])
  const removeItem = (setter: any, id: string) => setter((prev: ListItem[]) => prev.filter((i: ListItem) => i.id !== id))
  const updateItem = (setter: any, id: string, text: string) => setter((prev: ListItem[]) => prev.map((i: ListItem) => i.id === id ? { ...i, text } : i))

  const copyText = (text: string, key: string) => {
    navigator.clipboard.writeText(text)
    setCopied(key)
    setTimeout(() => setCopied(''), 2000)
  }

  const handleRun = async () => {
    if (!companyName || !reportPeriod) { setError('Enter company name and report period.'); return }
    setError('')
    setResult(null)
    clearSteps()
    clearStreamText()

    const payload = {
      company_name: companyName,
      report_period: reportPeriod,
      report_type: reportType,
      tone,
      include_appendix: includeAppendix,
      narrative_context: narrativeContext,
      metrics: metrics.filter(m => m.name).map(m => ({
        name: m.name,
        value: m.value,
        vs_prior: m.vs_prior,
        context: m.context,
      })),
      wins: wins.map(w => w.text).filter(Boolean),
      challenges: challenges.map(c => c.text).filter(Boolean),
      priorities_next_period: priorities.map(p => p.text).filter(Boolean),
    }

    await api.pillar7.streamBoardReport(projectId, payload, {
      onStep: (step: any) => upsertStep(step),
      onChunk: (chunk: string) => usePillar7Store.getState().appendStreamText(chunk),
      onDone: (data: any) => { setResult(data); setStreaming(false) },
      onError: (err: string) => { setError(err); setStreaming(false) },
    })
  }

  const kpiTable: any[] = result?.kpi_table || []

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-5xl mx-auto px-4 py-8">
        <button onClick={() => router.push(`/projects/${projectId}/analytics-pro`)} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 mb-6">
          <ArrowLeft className="w-4 h-4" /> Analytics & Reporting
        </button>

        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900">Board-Ready Reporting</h1>
          <p className="text-gray-500 mt-1">Generate polished, board-ready narratives with executive summaries, KPI tables, and talk tracks.</p>
        </div>

        {/* Header Info */}
        <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">Report Details</h2>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Company Name</label>
              <input type="text" value={companyName} onChange={e => setCompanyName(e.target.value)} placeholder="Acme Corp" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Report Period</label>
              <input type="text" value={reportPeriod} onChange={e => setReportPeriod(e.target.value)} placeholder="Q1 2025 / March 2025 / FY2024" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-gray-500 mb-2 block">Report Type</label>
              <div className="grid grid-cols-2 gap-2">
                {REPORT_TYPES.map(rt => (
                  <button
                    key={rt.value}
                    onClick={() => setReportType(rt.value)}
                    className={`py-2 px-3 rounded-lg text-xs font-medium border transition-colors ${reportType === rt.value ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'}`}
                  >
                    {rt.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-2 block">Tone</label>
              <div className="grid grid-cols-2 gap-2">
                {TONES.map(t => (
                  <button
                    key={t}
                    onClick={() => setTone(t)}
                    className={`py-2 px-3 rounded-lg text-xs font-medium border transition-colors capitalize ${tone === t ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'}`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="mt-4 flex items-center gap-2">
            <input type="checkbox" id="appendix" checked={includeAppendix} onChange={e => setIncludeAppendix(e.target.checked)} className="rounded" />
            <label htmlFor="appendix" className="text-sm text-gray-700 cursor-pointer">Include appendix with supporting data</label>
          </div>
        </div>

        {/* KPI Metrics */}
        <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">Key Metrics</h2>
          <div className="space-y-3">
            {metrics.map((m, idx) => (
              <div key={m.id} className="grid grid-cols-12 gap-2 items-center">
                <div className="col-span-3">
                  {idx === 0 && <label className="text-xs text-gray-400 mb-1 block">Metric Name</label>}
                  <input type="text" value={m.name} onChange={e => updateMetric(m.id, 'name', e.target.value)} placeholder="e.g. ARR" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div className="col-span-2">
                  {idx === 0 && <label className="text-xs text-gray-400 mb-1 block">Value</label>}
                  <input type="text" value={m.value} onChange={e => updateMetric(m.id, 'value', e.target.value)} placeholder="$1.2M" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div className="col-span-2">
                  {idx === 0 && <label className="text-xs text-gray-400 mb-1 block">vs Prior Period</label>}
                  <input type="text" value={m.vs_prior} onChange={e => updateMetric(m.id, 'vs_prior', e.target.value)} placeholder="+18%" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div className="col-span-4">
                  {idx === 0 && <label className="text-xs text-gray-400 mb-1 block">Context / Note</label>}
                  <input type="text" value={m.context} onChange={e => updateMetric(m.id, 'context', e.target.value)} placeholder="Driven by enterprise deals" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div className="col-span-1 flex justify-end">
                  {idx === 0 && <div className="h-5 mb-1" />}
                  {metrics.length > 1 && (
                    <button onClick={() => removeMetric(m.id)} className="text-gray-400 hover:text-red-500">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
          <button onClick={addMetric} className="mt-3 flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-700">
            <Plus className="w-4 h-4" /> Add metric
          </button>
        </div>

        {/* Wins / Challenges / Priorities */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          {[
            { label: 'Key Wins', icon: <CheckCircle className="w-4 h-4 text-green-500" />, items: wins, setter: setWins, placeholder: 'e.g. Closed $500K enterprise deal' },
            { label: 'Challenges', icon: <XCircle className="w-4 h-4 text-red-400" />, items: challenges, setter: setChallenges, placeholder: 'e.g. Sales cycle elongating in mid-market' },
            { label: 'Priorities Next Period', icon: <FileText className="w-4 h-4 text-blue-500" />, items: priorities, setter: setPriorities, placeholder: 'e.g. Launch self-serve onboarding' },
          ].map(section => (
            <div key={section.label} className="bg-white rounded-xl border border-gray-200 p-4">
              <h2 className="text-xs font-semibold text-gray-700 mb-3 flex items-center gap-1.5">
                {section.icon} {section.label}
              </h2>
              <div className="space-y-2">
                {section.items.map((item: ListItem) => (
                  <div key={item.id} className="flex items-center gap-2">
                    <input
                      type="text"
                      value={item.text}
                      onChange={e => updateItem(section.setter, item.id, e.target.value)}
                      placeholder={section.placeholder}
                      className="flex-1 border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    {section.items.length > 1 && (
                      <button onClick={() => removeItem(section.setter, item.id)} className="text-gray-400 hover:text-red-500 flex-shrink-0">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <button onClick={() => addItem(section.setter)} className="mt-2 flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700">
                <Plus className="w-3.5 h-3.5" /> Add
              </button>
            </div>
          ))}
        </div>

        {/* Narrative Context */}
        <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
          <h2 className="text-sm font-semibold text-gray-700 mb-2">Narrative Context</h2>
          <textarea
            value={narrativeContext}
            onChange={e => setNarrativeContext(e.target.value)}
            placeholder="Add any context that should shape the narrative - e.g. 'We're preparing for a Series B raise in Q3', 'Board has flagged burn rate as primary concern', 'Competitor X just raised $50M'..."
            rows={4}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
          />
        </div>

        {error && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-600 mb-4">{error}</div>}

        <Button onClick={handleRun} disabled={isStreaming} className="w-full mb-8">
          {isStreaming ? 'Generating Report...' : 'Generate Board Report - 25 Credits'}
        </Button>

        {steps.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
            {steps.map((s: any) => (
              <div key={s.id} className="flex items-center gap-3 py-2 border-b border-gray-100 last:border-0">
                <div className={`w-2 h-2 rounded-full ${s.status === 'done' ? 'bg-green-500' : s.status === 'running' ? 'bg-blue-500 animate-pulse' : 'bg-gray-300'}`} />
                <span className="text-sm text-gray-600">{s.label}</span>
              </div>
            ))}
          </div>
        )}

        {/* Report Output */}
        {result && (
          <div className="space-y-6">
            {/* Executive Summary */}
            {result.executive_summary && (
              <div className="bg-white rounded-xl border border-gray-200 p-6">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-sm font-semibold text-gray-700">Executive Summary</h2>
                  <button onClick={() => copyText(result.executive_summary, 'exec')} className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600">
                    {copied === 'exec' ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
                    {copied === 'exec' ? 'Copied' : 'Copy'}
                  </button>
                </div>
                <p className="text-sm text-gray-700 leading-relaxed">{result.executive_summary}</p>
              </div>
            )}

            {/* Business Narrative */}
            {result.business_narrative && (
              <div className="bg-white rounded-xl border border-gray-200 p-6">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-sm font-semibold text-gray-700">Business Narrative</h2>
                  <button onClick={() => copyText(result.business_narrative, 'narrative')} className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600">
                    {copied === 'narrative' ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
                    {copied === 'narrative' ? 'Copied' : 'Copy'}
                  </button>
                </div>
                <div className="prose prose-sm max-w-none text-gray-700 leading-relaxed whitespace-pre-wrap">
                  {result.business_narrative}
                </div>
              </div>
            )}

            {/* KPI Table */}
            {kpiTable.length > 0 && (
              <div className="bg-white rounded-xl border border-gray-200 p-6">
                <h2 className="text-sm font-semibold text-gray-700 mb-4">KPI Dashboard</h2>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-200 text-xs text-gray-500">
                        <th className="text-left py-2 pr-4">Metric</th>
                        <th className="text-right py-2 px-3">Value</th>
                        <th className="text-right py-2 px-3">vs Prior</th>
                        <th className="text-right py-2 px-3">Status</th>
                        <th className="text-left py-2 pl-3">Commentary</th>
                      </tr>
                    </thead>
                    <tbody>
                      {kpiTable.map((k: any, i: number) => (
                        <tr key={i} className="border-b border-gray-100 last:border-0">
                          <td className="py-2 pr-4 font-medium text-gray-800">{k.metric}</td>
                          <td className="text-right py-2 px-3 text-gray-700">{k.value}</td>
                          <td className="text-right py-2 px-3 text-gray-600">{k.vs_prior || '-'}</td>
                          <td className="text-right py-2 px-3">
                            <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_STYLES[k.status] || 'bg-gray-100 text-gray-600'}`}>
                              {(k.status || '').replace(/_/g, ' ')}
                            </span>
                          </td>
                          <td className="text-left py-2 pl-3 text-xs text-gray-500 max-w-[200px]">{k.commentary || '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Wins / Challenges / Priorities */}
            <div className="grid grid-cols-3 gap-4">
              {[
                { key: 'wins_section', label: 'Wins', color: 'text-green-700', bg: 'bg-green-50 border-green-200' },
                { key: 'challenges_section', label: 'Challenges', color: 'text-red-700', bg: 'bg-red-50 border-red-200' },
                { key: 'priorities_section', label: 'Next Period', color: 'text-blue-700', bg: 'bg-blue-50 border-blue-200' },
              ].map(section => result[section.key]?.length > 0 && (
                <div key={section.key} className={`rounded-xl border p-4 ${section.bg}`}>
                  <h3 className={`text-xs font-semibold mb-3 ${section.color}`}>{section.label}</h3>
                  <ul className="space-y-2">
                    {result[section.key].map((item: any, i: number) => (
                      <li key={i} className={`text-xs ${section.color}`}>
                        <p className="font-medium">{item.title || item.priority || item}</p>
                        {item.detail && <p className="mt-0.5 opacity-75">{item.detail}</p>}
                        {item.mitigation && <p className="mt-0.5 opacity-75">→ {item.mitigation}</p>}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>

            {/* Talk Track */}
            {result.talk_track && (
              <div className="bg-gray-900 rounded-xl p-6">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-sm font-semibold text-white">Presenter Talk Track</h2>
                  <button onClick={() => copyText(result.talk_track, 'talk')} className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-200">
                    {copied === 'talk' ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
                    {copied === 'talk' ? 'Copied' : 'Copy'}
                  </button>
                </div>
                <p className="text-sm text-gray-300 leading-relaxed whitespace-pre-wrap">{result.talk_track}</p>
              </div>
            )}

            {/* Appendix */}
            {result.appendix && (
              <div className="bg-white rounded-xl border border-gray-200 p-6">
                <h2 className="text-sm font-semibold text-gray-700 mb-3">Appendix</h2>
                <p className="text-sm text-gray-600 whitespace-pre-wrap leading-relaxed">{result.appendix}</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
