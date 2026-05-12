'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import { usePillar7Store } from '@/stores/pillar7-store'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { ArrowLeft, Plus, Trash2, TrendingUp, Target, BarChart2 } from 'lucide-react'
import { useRouter } from 'next/navigation'

interface ForecastMetricRow {
  id: string
  name: string
  unit: string
  historical: string // "period:value,..."
  target?: string
}

const PERIOD_TYPES = ['days', 'weeks', 'months', 'quarters']
const SCENARIO_OPTIONS = ['base', 'optimistic', 'pessimistic']

export default function ForecastPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const router = useRouter()
  const { isStreaming, steps, upsertStep, clearSteps, clearStreamText, setStreaming } = usePillar7Store()

  const [metrics, setMetrics] = useState<ForecastMetricRow[]>([
    { id: '1', name: 'Monthly Revenue', unit: '$', historical: '' },
  ])
  const [forecastPeriods, setForecastPeriods] = useState(6)
  const [periodType, setPeriodType] = useState('months')
  const [growthAssumptions, setGrowthAssumptions] = useState('')
  const [scenarios, setScenarios] = useState<string[]>(['base', 'optimistic', 'pessimistic'])
  const [result, setResult] = useState<any>(null)
  const [error, setError] = useState('')

  const addMetric = () => {
    setMetrics(prev => [...prev, { id: Date.now().toString(), name: '', unit: '', historical: '' }])
  }
  const removeMetric = (id: string) => setMetrics(prev => prev.filter(m => m.id !== id))
  const updateMetric = (id: string, field: keyof ForecastMetricRow, value: string) => {
    setMetrics(prev => prev.map(m => m.id === id ? { ...m, [field]: value } : m))
  }

  const parseHistorical = (raw: string) => {
    return raw.split(',').map(pair => {
      const [period, value] = pair.trim().split(':')
      return { period: period?.trim() || '', value: parseFloat(value?.trim() || '0') }
    }).filter(dp => dp.period && !isNaN(dp.value))
  }

  const toggleScenario = (s: string) => {
    setScenarios(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s])
  }

  const handleRun = async () => {
    const validMetrics = metrics.filter(m => m.name && m.historical.trim())
    if (validMetrics.length === 0) { setError('Add at least one metric with historical data.'); return }
    setError('')
    setResult(null)
    clearSteps()
    clearStreamText()

    const payload = {
      metrics: validMetrics.map(m => ({
        name: m.name,
        unit: m.unit || 'count',
        historical_data: parseHistorical(m.historical),
        target: m.target ? parseFloat(m.target) : undefined,
      })),
      forecast_periods: forecastPeriods,
      period_type: periodType,
      growth_assumptions: growthAssumptions,
      scenarios,
    }

    await api.pillar7.streamForecast(projectId, payload, {
      onStep: (step: any) => upsertStep(step),
      onChunk: (chunk: string) => usePillar7Store.getState().appendStreamText(chunk),
      onDone: (data: any) => { setResult(data); setStreaming(false) },
      onError: (err: string) => { setError(err); setStreaming(false) },
    })
  }

  const forecasts: any[] = result?.forecasts || []
  const recommendedTargets: any[] = result?.recommended_targets || []
  const dataQualityNotes: string[] = result?.data_quality_notes || []

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-5xl mx-auto px-4 py-8">
        <button onClick={() => router.push(`/projects/${projectId}/analytics-pro`)} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 mb-6">
          <ArrowLeft className="w-4 h-4" /> Analytics & Reporting
        </button>

        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900">Forecasting Model</h1>
          <p className="text-gray-500 mt-1">Generate base, optimistic, and pessimistic forecasts across your key metrics using trend analysis and seasonality detection.</p>
        </div>

        {/* Metric Inputs */}
        <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
          <h2 className="text-sm font-semibold text-gray-700 mb-2">Historical Data</h2>
          <p className="text-xs text-gray-400 mb-4">Format: <code className="bg-gray-100 px-1 rounded">period:value</code> pairs separated by commas. E.g. <code className="bg-gray-100 px-1 rounded">Jan:42000, Feb:45000, Mar:51000</code></p>
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
                      placeholder="Monthly Revenue"
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 mb-1 block">Unit</label>
                    <input
                      type="text"
                      value={m.unit}
                      onChange={e => updateMetric(m.id, 'unit', e.target.value)}
                      placeholder="$ / users / %"
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>
                <div className="mb-3">
                  <label className="text-xs text-gray-500 mb-1 block">Historical Data Points</label>
                  <textarea
                    value={m.historical}
                    onChange={e => updateMetric(m.id, 'historical', e.target.value)}
                    placeholder="Jan:42000, Feb:45000, Mar:51000, Apr:48000, May:55000, Jun:62000"
                    rows={3}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                  />
                  <p className="text-xs text-gray-400 mt-1">{parseHistorical(m.historical).length} data points</p>
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Target Value (optional)</label>
                  <input
                    type="number"
                    value={m.target || ''}
                    onChange={e => updateMetric(m.id, 'target', e.target.value)}
                    placeholder="e.g. 100000"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
            ))}
          </div>
          <button onClick={addMetric} className="mt-3 flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-700">
            <Plus className="w-4 h-4" /> Add another metric
          </button>
        </div>

        {/* Config */}
        <div className="grid grid-cols-2 gap-6 mb-6">
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h2 className="text-sm font-semibold text-gray-700 mb-4">Forecast Settings</h2>
            <div className="space-y-4">
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Forecast Periods</label>
                <input
                  type="number"
                  min={1}
                  max={24}
                  value={forecastPeriods}
                  onChange={e => setForecastPeriods(parseInt(e.target.value) || 6)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Period Type</label>
                <div className="flex gap-2 flex-wrap">
                  {PERIOD_TYPES.map(pt => (
                    <button
                      key={pt}
                      onClick={() => setPeriodType(pt)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${periodType === pt ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'}`}
                    >
                      {pt}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Scenarios</label>
                <div className="flex gap-2">
                  {SCENARIO_OPTIONS.map(s => (
                    <button
                      key={s}
                      onClick={() => toggleScenario(s)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${scenarios.includes(s) ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'}`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h2 className="text-sm font-semibold text-gray-700 mb-4">Growth Assumptions</h2>
            <textarea
              value={growthAssumptions}
              onChange={e => setGrowthAssumptions(e.target.value)}
              placeholder="Add context to improve accuracy - e.g. 'We're launching a new pricing tier in Q3', 'Seasonality: Q4 is typically 40% higher', 'New sales headcount added in month 7'..."
              rows={8}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
          </div>
        </div>

        {error && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-600 mb-4">{error}</div>}

        <Button onClick={handleRun} disabled={isStreaming} className="w-full mb-8">
          {isStreaming ? 'Forecasting...' : 'Generate Forecast - 15 Credits'}
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

        {/* Results */}
        {result && (
          <div className="space-y-6">
            {dataQualityNotes.length > 0 && (
              <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4">
                <p className="text-xs font-semibold text-yellow-700 mb-2">Data Quality Notes</p>
                <ul className="space-y-1">
                  {dataQualityNotes.map((n: string, i: number) => (
                    <li key={i} className="text-xs text-yellow-700 flex items-start gap-1.5">
                      <span className="mt-0.5">•</span> {n}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {forecasts.map((f: any, fi: number) => (
              <div key={fi} className="bg-white rounded-xl border border-gray-200 p-6">
                <div className="flex items-center gap-2 mb-2">
                  <TrendingUp className="w-4 h-4 text-blue-500" />
                  <h2 className="text-sm font-semibold text-gray-800">{f.metric_name}</h2>
                  {f.unit && <span className="text-xs text-gray-400">({f.unit})</span>}
                </div>

                {f.trend_summary && (
                  <p className="text-sm text-gray-600 mb-4">{f.trend_summary}</p>
                )}

                {f.seasonality_detected && (
                  <div className="mb-4 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2">
                    <p className="text-xs font-medium text-blue-700">Seasonality Detected</p>
                    <p className="text-xs text-blue-600">{f.seasonality_pattern}</p>
                  </div>
                )}

                {/* Forecast Table */}
                {f.periods?.length > 0 && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-gray-200">
                          <th className="text-left py-2 pr-4 font-medium text-gray-500">Period</th>
                          {scenarios.includes('pessimistic') && <th className="text-right py-2 px-3 font-medium text-red-500">Pessimistic</th>}
                          {scenarios.includes('base') && <th className="text-right py-2 px-3 font-medium text-blue-600">Base</th>}
                          {scenarios.includes('optimistic') && <th className="text-right py-2 px-3 font-medium text-green-600">Optimistic</th>}
                          <th className="text-right py-2 pl-3 font-medium text-gray-500">Confidence</th>
                        </tr>
                      </thead>
                      <tbody>
                        {f.periods.map((p: any, pi: number) => (
                          <tr key={pi} className="border-b border-gray-100 last:border-0">
                            <td className="py-2 pr-4 font-medium text-gray-700">{p.period}</td>
                            {scenarios.includes('pessimistic') && (
                              <td className="text-right py-2 px-3 text-red-600">{f.unit === '$' ? '$' : ''}{(p.pessimistic || 0).toLocaleString()}</td>
                            )}
                            {scenarios.includes('base') && (
                              <td className="text-right py-2 px-3 text-blue-700 font-semibold">{f.unit === '$' ? '$' : ''}{(p.base || 0).toLocaleString()}</td>
                            )}
                            {scenarios.includes('optimistic') && (
                              <td className="text-right py-2 px-3 text-green-600">{f.unit === '$' ? '$' : ''}{(p.optimistic || 0).toLocaleString()}</td>
                            )}
                            <td className="text-right py-2 pl-3 text-gray-400">{p.confidence_pct ? `${p.confidence_pct}%` : '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {f.key_drivers?.length > 0 && (
                  <div className="mt-4 pt-4 border-t border-gray-100">
                    <p className="text-xs font-medium text-gray-500 mb-2">Key Forecast Drivers</p>
                    <div className="flex flex-wrap gap-2">
                      {f.key_drivers.map((d: string, i: number) => (
                        <span key={i} className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded-full">{d}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}

            {recommendedTargets.length > 0 && (
              <div className="bg-white rounded-xl border border-gray-200 p-6">
                <h2 className="text-sm font-semibold text-gray-700 mb-4 flex items-center gap-2">
                  <Target className="w-4 h-4 text-green-500" />
                  Recommended Targets
                </h2>
                <div className="space-y-3">
                  {recommendedTargets.map((t: any, i: number) => (
                    <div key={i} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
                      <div>
                        <p className="text-sm font-medium text-gray-800">{t.metric_name}</p>
                        {t.rationale && <p className="text-xs text-gray-500">{t.rationale}</p>}
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-bold text-green-600">{t.recommended_target?.toLocaleString()}</p>
                        {t.stretch_target && <p className="text-xs text-gray-400">stretch: {t.stretch_target?.toLocaleString()}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
