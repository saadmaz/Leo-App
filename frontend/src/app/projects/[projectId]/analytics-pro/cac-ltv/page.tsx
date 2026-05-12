'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import { usePillar7Store } from '@/stores/pillar7-store'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { ArrowLeft, Plus, Trash2, TrendingUp, AlertTriangle, CheckCircle, DollarSign } from 'lucide-react'
import { useRouter } from 'next/navigation'

interface ChannelRow {
  id: string
  name: string
  spend: string
  customers_acquired: string
}

const HEALTH_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  excellent: { bg: 'bg-green-50', text: 'text-green-700', label: 'Excellent' },
  good: { bg: 'bg-blue-50', text: 'text-blue-700', label: 'Good' },
  fair: { bg: 'bg-yellow-50', text: 'text-yellow-700', label: 'Fair' },
  poor: { bg: 'bg-red-50', text: 'text-red-700', label: 'Poor' },
}

export default function CacLtvPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const router = useRouter()
  const { isStreaming, steps, upsertStep, clearSteps, clearStreamText, setStreaming } = usePillar7Store()

  const [productName, setProductName] = useState('')
  const [timePeriod, setTimePeriod] = useState('last_quarter')
  const [totalRevenue, setTotalRevenue] = useState('')
  const [newCustomers, setNewCustomers] = useState('')
  const [churnedCustomers, setChurnedCustomers] = useState('')
  const [avgSubscriptionValue, setAvgSubscriptionValue] = useState('')
  const [grossMarginPct, setGrossMarginPct] = useState('')
  const [totalAcquisitionCost, setTotalAcquisitionCost] = useState('')
  const [channels, setChannels] = useState<ChannelRow[]>([
    { id: '1', name: '', spend: '', customers_acquired: '' },
  ])
  const [pullFromStripe, setPullFromStripe] = useState(false)
  const [pullFromHubspot, setPullFromHubspot] = useState(false)
  const [result, setResult] = useState<any>(null)
  const [error, setError] = useState('')

  const addChannel = () => setChannels(prev => [...prev, { id: Date.now().toString(), name: '', spend: '', customers_acquired: '' }])
  const removeChannel = (id: string) => setChannels(prev => prev.filter(c => c.id !== id))
  const updateChannel = (id: string, field: keyof ChannelRow, value: string) => {
    setChannels(prev => prev.map(c => c.id === id ? { ...c, [field]: value } : c))
  }

  const handleRun = async () => {
    if (!productName) { setError('Enter a product name.'); return }
    setError('')
    setResult(null)
    clearSteps()
    clearStreamText()

    const payload = {
      product_name: productName,
      time_period: timePeriod,
      total_revenue: totalRevenue ? parseFloat(totalRevenue) : undefined,
      new_customers: newCustomers ? parseInt(newCustomers) : undefined,
      churned_customers: churnedCustomers ? parseInt(churnedCustomers) : undefined,
      avg_subscription_value: avgSubscriptionValue ? parseFloat(avgSubscriptionValue) : undefined,
      gross_margin_pct: grossMarginPct ? parseFloat(grossMarginPct) : undefined,
      total_acquisition_cost: totalAcquisitionCost ? parseFloat(totalAcquisitionCost) : undefined,
      acquisition_channels: channels.filter(c => c.name).map(c => ({
        channel: c.name,
        spend: parseFloat(c.spend || '0'),
        customers_acquired: parseInt(c.customers_acquired || '0'),
      })),
      pull_from_stripe: pullFromStripe,
      pull_from_hubspot: pullFromHubspot,
    }

    await api.pillar7.streamCacLtv(projectId, payload, {
      onStep: (step: any) => upsertStep(step),
      onChunk: (chunk: string) => usePillar7Store.getState().appendStreamText(chunk),
      onDone: (data: any) => { setResult(data); setStreaming(false) },
      onError: (err: string) => { setError(err); setStreaming(false) },
    })
  }

  const health = result?.health_score ? HEALTH_COLORS[result.health_score] || HEALTH_COLORS.fair : null
  const channelTable: any[] = result?.channel_cac_table || []
  const levers: any[] = result?.improvement_levers || []
  const redFlags: string[] = result?.red_flags || []
  const targets: any[] = result?.six_month_targets || []

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-5xl mx-auto px-4 py-8">
        <button onClick={() => router.push(`/projects/${projectId}/analytics-pro`)} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 mb-6">
          <ArrowLeft className="w-4 h-4" /> Analytics & Reporting
        </button>

        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900">CAC + LTV Tracking</h1>
          <p className="text-gray-500 mt-1">Calculate your blended and per-channel CAC, LTV:CAC ratio, payback period, and get actionable improvement levers.</p>
        </div>

        {/* Inputs */}
        <div className="grid grid-cols-2 gap-6 mb-6">
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h2 className="text-sm font-semibold text-gray-700 mb-4">Business Metrics</h2>
            <div className="space-y-4">
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Product Name</label>
                <input type="text" value={productName} onChange={e => setProductName(e.target.value)} placeholder="e.g. Leo Pro" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Time Period</label>
                <select value={timePeriod} onChange={e => setTimePeriod(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="last_month">Last Month</option>
                  <option value="last_quarter">Last Quarter</option>
                  <option value="last_6_months">Last 6 Months</option>
                  <option value="last_year">Last Year</option>
                  <option value="ytd">Year to Date</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Total Revenue ($)</label>
                  <input type="number" value={totalRevenue} onChange={e => setTotalRevenue(e.target.value)} placeholder="0" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">New Customers</label>
                  <input type="number" value={newCustomers} onChange={e => setNewCustomers(e.target.value)} placeholder="0" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Churned Customers</label>
                  <input type="number" value={churnedCustomers} onChange={e => setChurnedCustomers(e.target.value)} placeholder="0" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Avg Subscription Value ($)</label>
                  <input type="number" value={avgSubscriptionValue} onChange={e => setAvgSubscriptionValue(e.target.value)} placeholder="0" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Gross Margin (%)</label>
                  <input type="number" value={grossMarginPct} onChange={e => setGrossMarginPct(e.target.value)} placeholder="70" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Total Acquisition Cost ($)</label>
                  <input type="number" value={totalAcquisitionCost} onChange={e => setTotalAcquisitionCost(e.target.value)} placeholder="0" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h2 className="text-sm font-semibold text-gray-700 mb-4">Acquisition Channels</h2>
            <div className="space-y-3">
              {channels.map((c, idx) => (
                <div key={c.id} className="border border-gray-200 rounded-lg p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium text-gray-500">Channel {idx + 1}</span>
                    {channels.length > 1 && (
                      <button onClick={() => removeChannel(c.id)} className="text-gray-400 hover:text-red-500">
                        <Trash2 className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <input type="text" value={c.name} onChange={e => updateChannel(c.id, 'name', e.target.value)} placeholder="e.g. Paid Search" className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    <input type="number" value={c.spend} onChange={e => updateChannel(c.id, 'spend', e.target.value)} placeholder="Spend ($)" className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    <input type="number" value={c.customers_acquired} onChange={e => updateChannel(c.id, 'customers_acquired', e.target.value)} placeholder="Customers" className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                </div>
              ))}
            </div>
            <button onClick={addChannel} className="mt-3 flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-700">
              <Plus className="w-4 h-4" /> Add channel
            </button>

            <div className="mt-6 pt-4 border-t border-gray-100">
              <p className="text-xs font-medium text-gray-500 mb-3">Pull Live Data</p>
              <div className="space-y-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={pullFromStripe} onChange={e => setPullFromStripe(e.target.checked)} className="rounded" />
                  <span className="text-sm text-gray-700">Pull revenue from Stripe</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={pullFromHubspot} onChange={e => setPullFromHubspot(e.target.checked)} className="rounded" />
                  <span className="text-sm text-gray-700">Pull deal data from HubSpot</span>
                </label>
              </div>
            </div>
          </div>
        </div>

        {error && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-600 mb-4">{error}</div>}

        <Button onClick={handleRun} disabled={isStreaming} className="w-full mb-8">
          {isStreaming ? 'Calculating...' : 'Calculate CAC + LTV - 20 Credits'}
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
            {/* KPI Cards */}
            <div className="grid grid-cols-4 gap-4">
              <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
                <p className="text-xs text-gray-500 mb-1">Blended CAC</p>
                <p className="text-2xl font-bold text-gray-900">${(result.blended_cac || 0).toLocaleString()}</p>
              </div>
              <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
                <p className="text-xs text-gray-500 mb-1">LTV</p>
                <p className="text-2xl font-bold text-gray-900">${(result.ltv || 0).toLocaleString()}</p>
              </div>
              <div className={`rounded-xl border p-4 text-center ${health ? health.bg : 'bg-white border-gray-200'}`}>
                <p className={`text-xs mb-1 ${health ? health.text : 'text-gray-500'}`}>LTV:CAC Ratio</p>
                <p className={`text-2xl font-bold ${health ? health.text : 'text-gray-900'}`}>{result.ltv_cac_ratio || '-'}x</p>
                <p className={`text-xs mt-0.5 ${health ? health.text : 'text-gray-400'}`}>{health?.label}</p>
              </div>
              <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
                <p className="text-xs text-gray-500 mb-1">Payback Period</p>
                <p className="text-2xl font-bold text-gray-900">{result.payback_period_months || '-'}</p>
                <p className="text-xs text-gray-400">months</p>
              </div>
            </div>

            {result.benchmark_commentary && (
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex gap-3">
                <DollarSign className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-blue-800">{result.benchmark_commentary}</p>
              </div>
            )}

            {/* Channel CAC Table */}
            {channelTable.length > 0 && (
              <div className="bg-white rounded-xl border border-gray-200 p-6">
                <h2 className="text-sm font-semibold text-gray-700 mb-4">Channel CAC Breakdown</h2>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-200 text-xs text-gray-500">
                        <th className="text-left py-2 pr-4">Channel</th>
                        <th className="text-right py-2 px-3">Spend</th>
                        <th className="text-right py-2 px-3">Customers</th>
                        <th className="text-right py-2 px-3">CAC</th>
                        <th className="text-right py-2 pl-3">Efficiency</th>
                      </tr>
                    </thead>
                    <tbody>
                      {channelTable.map((c: any, i: number) => (
                        <tr key={i} className="border-b border-gray-100 last:border-0">
                          <td className="py-2 pr-4 font-medium text-gray-800">{c.channel}</td>
                          <td className="text-right py-2 px-3 text-gray-600">${(c.spend || 0).toLocaleString()}</td>
                          <td className="text-right py-2 px-3 text-gray-600">{(c.customers_acquired || 0).toLocaleString()}</td>
                          <td className="text-right py-2 px-3 font-semibold text-gray-800">${(c.cac || 0).toLocaleString()}</td>
                          <td className="text-right py-2 pl-3">
                            <span className={`text-xs px-2 py-0.5 rounded-full ${c.efficiency === 'efficient' ? 'bg-green-100 text-green-600' : c.efficiency === 'moderate' ? 'bg-yellow-100 text-yellow-600' : 'bg-red-100 text-red-600'}`}>
                              {c.efficiency || '-'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Red Flags */}
            {redFlags.length > 0 && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-6">
                <h2 className="text-sm font-semibold text-red-700 mb-3 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4" /> Red Flags
                </h2>
                <ul className="space-y-2">
                  {redFlags.map((f: string, i: number) => (
                    <li key={i} className="text-sm text-red-700 flex items-start gap-2">
                      <span className="mt-0.5">•</span> {f}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Improvement Levers */}
            {levers.length > 0 && (
              <div className="bg-white rounded-xl border border-gray-200 p-6">
                <h2 className="text-sm font-semibold text-gray-700 mb-4 flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-green-500" /> Improvement Levers
                </h2>
                <div className="space-y-3">
                  {levers.map((l: any, i: number) => (
                    <div key={i} className="border border-gray-200 rounded-lg p-4">
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-sm font-medium text-gray-800">{l.lever}</p>
                        <div className="flex gap-2">
                          {l.effort && <span className={`text-xs px-2 py-0.5 rounded-full ${l.effort === 'low' ? 'bg-green-100 text-green-600' : l.effort === 'medium' ? 'bg-yellow-100 text-yellow-600' : 'bg-red-100 text-red-600'}`}>{l.effort} effort</span>}
                          {l.impact && <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-600">{l.impact} impact</span>}
                        </div>
                      </div>
                      {l.description && <p className="text-xs text-gray-600">{l.description}</p>}
                      {l.expected_improvement && <p className="text-xs text-green-600 mt-1 font-medium">{l.expected_improvement}</p>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 6-Month Targets */}
            {targets.length > 0 && (
              <div className="bg-white rounded-xl border border-gray-200 p-6">
                <h2 className="text-sm font-semibold text-gray-700 mb-4 flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-blue-500" /> 6-Month Targets
                </h2>
                <div className="grid grid-cols-2 gap-3">
                  {targets.map((t: any, i: number) => (
                    <div key={i} className="border border-gray-200 rounded-lg p-3">
                      <p className="text-xs font-medium text-gray-500">{t.metric}</p>
                      <div className="flex items-center justify-between mt-1">
                        <p className="text-sm text-gray-500">Current: <span className="font-semibold text-gray-700">{t.current}</span></p>
                        <p className="text-sm text-blue-600">Target: <span className="font-bold">{t.target}</span></p>
                      </div>
                      {t.actions?.length > 0 && (
                        <ul className="mt-2 space-y-1">
                          {t.actions.map((a: string, j: number) => (
                            <li key={j} className="text-xs text-gray-500 flex items-start gap-1">
                              <span className="text-gray-300">→</span> {a}
                            </li>
                          ))}
                        </ul>
                      )}
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
