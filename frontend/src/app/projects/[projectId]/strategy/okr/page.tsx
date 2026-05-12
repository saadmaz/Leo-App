'use client'

import { useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Target, Loader2, ChevronLeft } from 'lucide-react'
import { toast } from 'sonner'
import { SidebarToggle } from '@/components/layout/sidebar'
import { api } from '@/lib/api'
import type { Pillar1Doc, OKRPayload } from '@/types'

export default function OKRPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const router = useRouter()

  const [quarter, setQuarter] = useState('')
  const [goals, setGoals] = useState('')
  const [teamFocus, setTeamFocus] = useState('')
  const [numObjectives, setNumObjectives] = useState(3)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<Pillar1Doc | null>(null)

  async function generate() {
    if (!quarter.trim() || !goals.trim()) {
      toast.error('Quarter and company goals are required')
      return
    }
    setLoading(true)
    try {
      const doc = await api.pillar1.generateOKR(projectId, {
        quarter: quarter.trim(),
        company_goals: goals.trim(),
        team_focus: teamFocus.trim() || undefined,
        num_objectives: numObjectives,
      })
      setResult(doc)
      toast.success('OKRs generated!')
    } catch (err) {
      toast.error('Failed to generate OKRs')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const payload = result?.payload as OKRPayload | undefined

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="border-b border-border px-6 py-4 flex items-center gap-3">
        <SidebarToggle />
        <button onClick={() => router.push(`/projects/${projectId}/strategy`)} className="text-muted-foreground hover:text-foreground">
          <ChevronLeft className="w-4 h-4" />
        </button>
        <Target className="w-4 h-4 text-primary" />
        <div>
          <h1 className="font-semibold">OKR Drafting</h1>
          <p className="text-xs text-muted-foreground">10 credits per generation</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-2xl mx-auto space-y-6">
          {/* Form */}
          <div className="p-5 rounded-xl border border-border bg-card space-y-4">
            <h2 className="font-semibold text-sm">Generate OKRs</h2>

            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Quarter *</label>
              <input
                value={quarter}
                onChange={(e) => setQuarter(e.target.value)}
                placeholder="e.g. Q3 2026"
                className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Company Goals *</label>
              <textarea
                value={goals}
                onChange={(e) => setGoals(e.target.value)}
                placeholder="e.g. Grow revenue 50%, expand into US market, launch mobile app"
                rows={3}
                className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary resize-none"
              />
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Team Focus (optional)</label>
              <input
                value={teamFocus}
                onChange={(e) => setTeamFocus(e.target.value)}
                placeholder="e.g. Marketing team, growth, retention"
                className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Number of Objectives</label>
              <select
                value={numObjectives}
                onChange={(e) => setNumObjectives(Number(e.target.value))}
                className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary"
              >
                {[2, 3, 4, 5].map((n) => <option key={n} value={n}>{n} objectives</option>)}
              </select>
            </div>

            <button
              onClick={generate}
              disabled={loading}
              className="w-full py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 flex items-center justify-center gap-2 transition-colors"
            >
              {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Generating...</> : 'Generate OKRs - 10 credits'}
            </button>
          </div>

          {/* Result */}
          {payload && (
            <div className="space-y-4">
              <h2 className="font-semibold text-sm">{payload.quarter} OKRs</h2>
              {payload.objectives?.map((obj, i) => (
                <div key={i} className="p-4 rounded-xl border border-border bg-card">
                  <p className="font-semibold text-sm">{obj.title}</p>
                  {obj.description && <p className="text-xs text-muted-foreground mt-1">{obj.description}</p>}
                  <div className="mt-3 space-y-2">
                    {obj.key_results?.map((kr, j) => (
                      <div key={j} className="flex items-start gap-2 text-xs">
                        <span className="text-primary font-mono mt-0.5">KR{j + 1}</span>
                        <span className="text-muted-foreground">{kr.metric}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              {payload.summary && (
                <p className="text-sm text-muted-foreground italic">{payload.summary}</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
