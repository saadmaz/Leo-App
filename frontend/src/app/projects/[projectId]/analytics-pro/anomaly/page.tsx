'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import { usePillar7Store } from '@/stores/pillar7-store'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { ArrowLeft, Plus, Trash2, AlertTriangle, TrendingUp, TrendingDown, Activity, Eye } from 'lucide-react'
import { useRouter } from 'next/navigation'

interface MetricRow {
  id: string
  name: string
  unit: string
  data_points: string // "date:value,date:value,..."
}

const SENSITIVITY_OPTIONS = [
  { value: 'low', label: 'Low', desc: 'Only extreme outliers (3σ)' },
  { value: 'medium', label: 'Medium', desc: 'Moderate outliers (2σ)' },
  { value: 'high', label: 'High', desc: 'Sensitive detection (1.5σ)' },
]

const SEVERITY_COLORS: Record<string, string> = {
  critical: 'bg-red-100 text-red-700 border border-red-200',
  high: 'bg-orange-100 text-orange-700 border border-orange-200',
  medium: 'bg-yellow-100 text-yellow-700 border border-yellow-200',
  low: 'bg-blue-100 text-blue-700 border border-blue-200',
}

const URGENCY_COLORS: Record<string, string> = {
  immediate: 'text-red-600 font-semibold',
  this_week: 'text-orange-600 font-medium',
  monitor: 'text-yellow-600',
  informational: 'text-gray-500',
}

export default function AnomalyDetectionPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const router = useRouter()
  const { isStreaming, streamText, steps, upsertStep, clearSteps, clearStreamText, setStreaming } = usePillar7Store()

  const [metrics, setMetrics] = useState<MetricRow[]>([
    { id: '1', name: 'Daily Active Users', unit: 'users', data_points: '' },
  ])
  const [sensitivity, setSensitivity] = useState('medium')
  const [businessContext, setBusinessContext] = useState('')
  const [result, setResult] = useState<any>(null)
  const [error, setError] = useState('')

  const addMetric = () => {
    setMetrics(prev => [...prev, { id: Date.now().toString(), name: '', unit: '', data_points: '' }])
  }

  const removeMetric = (id: string) => {
    setMetrics(prev => prev.filter(m => m.id !== id))
  }

  const updateMetric = (id: string, field: keyof MetricRow, value: string) => {
    setMetrics(prev => prev.map(m => m.id === id ? { ...m, [field]: value } : m))
  }

  const parseDataPoints = (raw: string) => {
    return raw.split(',').map(pair => {
      const [date, value] = pair.trim().split(':')
      return { date: date?.trim() || '', value: parseFloat(value?.trim() || '0') }
    }).filter(dp => dp.date && !isNaN(dp.value))
  }

  const handleRun = async () => {
    const validMetrics = metrics.filter(m => m.name && m.data_points.trim())
    if (validMetrics.length === 0) {
      setError('Add at least one metric with data points.')
      return
    }
    setError('')
    setResult(null)
    clearSteps()
    clearStreamText()

    const payload = {
      metrics: validMetrics.map(m => ({
        name: m.name,
        unit: m.unit || 'count',
        data_points: parseDataPoints(m.data_points),
      })),
      sensitivity,
      business_context: businessContext,
    }

    let buffer = ''
    await api.pillar7.streamAnomalyDetection(projectId, payload, {
      onStep: (step: any) => upsertStep(step),
      onChunk: (chunk: string) => { buffer += chunk; clearStreamText(); usePillar7Store.getState().appendStreamText(chunk) },
      onDone: (data: any) => { setResult(data); setStreaming(false) },
      onError: (err: string) => { setError(err); setStreaming(false) },
    })
  }

  const anomalies: any[] = result?.anomalies || []
  const metricsHealth: any[] = result?.metrics_health || []
  const recommendations: string[] = result?.monitoring_recommendations || []
  const summary = result?.summary || ''

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-5xl mx-auto px-4 py-8">
        <button onClick={() => router.push(`/projects/${projectId}/analytics-pro`)} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 mb-6">
          <ArrowLeft className="w-4 h-4" /> Analytics & Reporting
        </button>

        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900">Anomaly Detection</h1>
          <p className="text-gray-500 mt-1">Automatically surface statistical outliers across your metrics and get AI-powered root cause analysis.</p>
        </div>

        {/* Input */}
        <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">Metric Time-Series Data</h2>
          <p className="text-xs text-gray-400 mb-4">Enter data points as <code className="bg-gray-100 px-1 rounded">date:value</code> pairs separated by commas. E.g. <code className="bg-gray-100 px-1 rounded">2024-01-01:1200, 2024-01-02:1180, 2024-01-03:850</code></p>

          <div className="space-y-4">
            {metrics.map((m, idx) => (
              <div key={m.id} className="border border-gray-200 rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-medium text-gray-500">Metric {idx + 1}</span>
                  {metrics.length > 1 && (
                    <button onClick={() => removeMetric(m.id)} className="text-gray-400 hover:text-red-500">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-3 gap-3 mb-3">
                  <div className="col-span-2">
                    <label className="text-xs text-gray-500 mb-1 block">Metric Name</label>
                    <input
                      type="text"
                      value={m.name}
                      onChange={e => updateMetric(m.id, 'name', e.target.value)}
                      placeholder="e.g. Daily Active Users"
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 mb-1 block">Unit</label>
                    <input
                      type="text"
                      value={m.unit}
                      onChange={e => updateMetric(m.id, 'unit', e.target.value)}
                      placeholder="users / $ / %"
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Data Points (date:value, ...)</label>
                  <textarea
                    value={m.data_points}
                    onChange={e => updateMetric(m.id, 'data_points', e.target.value)}
                    placeholder="2024-01-01:1200, 2024-01-02:1180, 2024-01-03:850, 2024-01-04:1190..."
                    rows={3}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                  />
                  <p className="text-xs text-gray-400 mt-1">{parseDataPoints(m.data_points).length} data points detected</p>
                </div>
              </div>
            ))}
          </div>

          <button onClick={addMetric} className="mt-3 flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-700">
            <Plus className="w-4 h-4" /> Add another metric
          </button>
        </div>

        {/* Sensitivity + Context */}
        <div className="grid grid-cols-2 gap-6 mb-6">
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h2 className="text-sm font-semibold text-gray-700 mb-4">Detection Sensitivity</h2>
            <div className="space-y-2">
              {SENSITIVITY_OPTIONS.map(opt => (
                <label key={opt.value} className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${sensitivity === opt.value ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'}`}>
                  <input type="radio" name="sensitivity" value={opt.value} checked={sensitivity === opt.value} onChange={() => setSensitivity(opt.value)} className="mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-gray-800">{opt.label}</p>
                    <p className="text-xs text-gray-500">{opt.desc}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h2 className="text-sm font-semibold text-gray-700 mb-4">Business Context</h2>
            <textarea
              value={businessContext}
              onChange={e => setBusinessContext(e.target.value)}
              placeholder="Add context that helps explain expected patterns - e.g. 'We ran a paid campaign in week 2', 'Q4 is typically our peak season', 'We migrated our database on Jan 15th'..."
              rows={7}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
          </div>
        </div>

        {error && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-600 mb-4">{error}</div>}

        <Button onClick={handleRun} disabled={isStreaming} className="w-full mb-8">
          {isStreaming ? 'Analysing...' : 'Detect Anomalies - 10 Credits'}
        </Button>

        {/* Steps */}
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

        {/* Results */}
        {result && (
          <div className="space-y-6">
            {summary && (
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex gap-3">
                <Activity className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-blue-800">{summary}</p>
              </div>
            )}

            {/* Anomalies */}
            {anomalies.length > 0 && (
              <div className="bg-white rounded-xl border border-gray-200 p-6">
                <h2 className="text-sm font-semibold text-gray-700 mb-4 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-orange-500" />
                  Detected Anomalies ({anomalies.length})
                </h2>
                <div className="space-y-4">
                  {anomalies.map((a: any, i: number) => (
                    <div key={i} className="border border-gray-200 rounded-lg p-4">
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex items-center gap-2">
                          {a.direction === 'spike' ? (
                            <TrendingUp className="w-4 h-4 text-orange-500" />
                          ) : (
                            <TrendingDown className="w-4 h-4 text-red-500" />
                          )}
                          <span className="text-sm font-semibold text-gray-800">{a.metric_name}</span>
                          <span className="text-xs text-gray-500">{a.date}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${SEVERITY_COLORS[a.severity] || 'bg-gray-100 text-gray-600'}`}>
                            {a.severity}
                          </span>
                          <span className={`text-xs ${URGENCY_COLORS[a.urgency] || 'text-gray-500'}`}>
                            {(a.urgency || '').replace(/_/g, ' ')}
                          </span>
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-3 mb-3 text-xs text-gray-600">
                        <div>
                          <p className="text-gray-400">Observed Value</p>
                          <p className="font-semibold">{a.observed_value}</p>
                        </div>
                        <div>
                          <p className="text-gray-400">Expected Range</p>
                          <p className="font-semibold">{a.expected_range || '-'}</p>
                        </div>
                        <div>
                          <p className="text-gray-400">Deviation</p>
                          <p className="font-semibold">{a.deviation_pct ? `${a.deviation_pct}%` : '-'}</p>
                        </div>
                      </div>

                      {a.root_cause_hypotheses?.length > 0 && (
                        <div className="mb-2">
                          <p className="text-xs font-medium text-gray-500 mb-1">Root Cause Hypotheses</p>
                          <ul className="space-y-1">
                            {a.root_cause_hypotheses.map((h: string, j: number) => (
                              <li key={j} className="text-xs text-gray-700 flex items-start gap-1.5">
                                <span className="text-gray-400 mt-0.5">→</span> {h}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {a.recommended_action && (
                        <div className="mt-2 bg-gray-50 rounded-lg px-3 py-2">
                          <p className="text-xs font-medium text-gray-500 mb-0.5">Recommended Action</p>
                          <p className="text-xs text-gray-700">{a.recommended_action}</p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Metrics Health */}
            {metricsHealth.length > 0 && (
              <div className="bg-white rounded-xl border border-gray-200 p-6">
                <h2 className="text-sm font-semibold text-gray-700 mb-4 flex items-center gap-2">
                  <Eye className="w-4 h-4 text-gray-500" />
                  Metrics Health Summary
                </h2>
                <div className="space-y-3">
                  {metricsHealth.map((m: any, i: number) => (
                    <div key={i} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
                      <div>
                        <p className="text-sm font-medium text-gray-800">{m.metric_name}</p>
                        {m.trend && <p className="text-xs text-gray-500">{m.trend}</p>}
                      </div>
                      <div className="flex items-center gap-3">
                        {m.anomaly_count !== undefined && (
                          <span className={`text-xs px-2 py-0.5 rounded-full ${m.anomaly_count > 0 ? 'bg-red-100 text-red-600' : 'bg-green-100 text-green-600'}`}>
                            {m.anomaly_count} anomalies
                          </span>
                        )}
                        {m.health_score && (
                          <span className={`text-sm font-bold ${m.health_score >= 80 ? 'text-green-600' : m.health_score >= 60 ? 'text-yellow-600' : 'text-red-600'}`}>
                            {m.health_score}/100
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Recommendations */}
            {recommendations.length > 0 && (
              <div className="bg-white rounded-xl border border-gray-200 p-6">
                <h2 className="text-sm font-semibold text-gray-700 mb-4">Monitoring Recommendations</h2>
                <ul className="space-y-2">
                  {recommendations.map((r: string, i: number) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                      <span className="text-blue-500 mt-0.5">•</span> {r}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
