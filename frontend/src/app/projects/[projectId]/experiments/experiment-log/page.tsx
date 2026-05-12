'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'next/navigation'
import { ClipboardList, Plus, ChevronDown, ChevronUp, Trash2, Edit2, Check, X } from 'lucide-react'
import { toast } from 'sonner'
import { SidebarToggle } from '@/components/layout/sidebar'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'

const STATUS_COLORS: Record<string, string> = {
  planned:    'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  running:    'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
  concluded:  'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  paused:     'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  cancelled:  'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
}

const STATUSES = ['planned', 'running', 'paused', 'concluded', 'cancelled']

interface Experiment {
  id: string
  name: string
  hypothesis: string
  control_description: string
  variant_description: string
  metric: string
  status: string
  winner?: string
  lift_achieved?: string
  learnings?: string
  channel?: string
  created_at?: string
}

function ExperimentCard({ exp, onUpdate, onDelete }: {
  exp: Experiment
  onUpdate: (id: string, patch: Partial<Experiment>) => void
  onDelete: (id: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [editing, setEditing] = useState(false)
  const [status, setStatus] = useState(exp.status)
  const [winner, setWinner] = useState(exp.winner ?? '')
  const [lift, setLift] = useState(exp.lift_achieved ?? '')
  const [learnings, setLearnings] = useState(exp.learnings ?? '')

  async function save() {
    await onUpdate(exp.id, { status, winner: winner || undefined, lift_achieved: lift || undefined, learnings: learnings || undefined })
    setEditing(false)
  }

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="p-4 flex items-start gap-3">
        <button onClick={() => setExpanded((v) => !v)} className="mt-0.5 text-muted-foreground hover:text-primary shrink-0">
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-sm font-semibold truncate">{exp.name}</p>
              {exp.channel && <p className="text-[10px] text-muted-foreground">{exp.channel}</p>}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className={cn('text-[10px] px-2 py-0.5 rounded-full font-medium capitalize', STATUS_COLORS[exp.status] ?? 'bg-muted text-muted-foreground')}>
                {exp.status}
              </span>
              <button onClick={() => setEditing((v) => !v)} className="text-muted-foreground hover:text-primary">
                <Edit2 className="w-3.5 h-3.5" />
              </button>
              <button onClick={() => onDelete(exp.id)} className="text-muted-foreground hover:text-destructive">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{exp.hypothesis}</p>

          {exp.status === 'concluded' && exp.winner && (
            <div className="mt-2 flex items-center gap-3 text-xs">
              <span className="text-green-600 dark:text-green-400 font-medium">Winner: {exp.winner}</span>
              {exp.lift_achieved && <span className="text-muted-foreground">Lift: {exp.lift_achieved}</span>}
            </div>
          )}
        </div>
      </div>

      {expanded && (
        <div className="border-t border-border px-4 pb-4 pt-3 space-y-2">
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <p className="font-medium text-muted-foreground mb-0.5">Control</p>
              <p>{exp.control_description}</p>
            </div>
            <div>
              <p className="font-medium text-muted-foreground mb-0.5">Variant</p>
              <p>{exp.variant_description}</p>
            </div>
          </div>
          <div className="text-xs">
            <p className="font-medium text-muted-foreground mb-0.5">Primary Metric</p>
            <p>{exp.metric}</p>
          </div>
          {exp.learnings && (
            <div className="text-xs">
              <p className="font-medium text-muted-foreground mb-0.5">Learnings</p>
              <p className="text-muted-foreground">{exp.learnings}</p>
            </div>
          )}
        </div>
      )}

      {editing && (
        <div className="border-t border-border px-4 pb-4 pt-3 space-y-3 bg-muted/30">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Update Experiment</p>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Status</label>
              <select value={status} onChange={(e) => setStatus(e.target.value)}
                className="mt-1 w-full px-2 py-1.5 text-xs bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary">
                {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Winner</label>
              <input value={winner} onChange={(e) => setWinner(e.target.value)} placeholder="e.g. Variant B"
                className="mt-1 w-full px-2 py-1.5 text-xs bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
            </div>
          </div>

          <div>
            <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Lift Achieved</label>
            <input value={lift} onChange={(e) => setLift(e.target.value)} placeholder="e.g. +12% conversion rate"
              className="mt-1 w-full px-2 py-1.5 text-xs bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
          </div>

          <div>
            <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Learnings</label>
            <textarea value={learnings} onChange={(e) => setLearnings(e.target.value)} rows={2}
              placeholder="What did you learn from this experiment?"
              className="mt-1 w-full px-2 py-1.5 text-xs bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary resize-none" />
          </div>

          <div className="flex gap-2">
            <button onClick={save} className="flex items-center gap-1 px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded-lg hover:bg-primary/90">
              <Check className="w-3 h-3" /> Save
            </button>
            <button onClick={() => setEditing(false)} className="flex items-center gap-1 px-3 py-1.5 text-xs border border-border rounded-lg hover:bg-muted">
              <X className="w-3 h-3" /> Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function CreateForm({ projectId, onCreated }: { projectId: string; onCreated: () => void }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [hypothesis, setHypothesis] = useState('')
  const [control, setControl] = useState('')
  const [variant, setVariant] = useState('')
  const [metric, setMetric] = useState('')
  const [channel, setChannel] = useState('')
  const [saving, setSaving] = useState(false)

  async function create() {
    if (!name.trim() || !hypothesis.trim() || !control.trim() || !variant.trim() || !metric.trim()) {
      toast.error('Fill in all required fields')
      return
    }
    setSaving(true)
    try {
      await api.pillar10.createExperiment(projectId, {
        name: name.trim(),
        hypothesis: hypothesis.trim(),
        control_description: control.trim(),
        variant_description: variant.trim(),
        metric: metric.trim(),
        channel: channel.trim() || undefined,
        status: 'planned',
      })
      toast.success('Experiment logged!')
      setName(''); setHypothesis(''); setControl(''); setVariant(''); setMetric(''); setChannel('')
      setOpen(false)
      onCreated()
    } catch {
      toast.error('Failed to save experiment')
    } finally {
      setSaving(false)
    }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)}
        className="flex items-center gap-2 px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90">
        <Plus className="w-4 h-4" /> Log Experiment
      </button>
    )
  }

  return (
    <div className="p-4 rounded-xl border border-primary/30 bg-primary/5 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">New Experiment</p>
        <button onClick={() => setOpen(false)} className="text-muted-foreground hover:text-primary"><X className="w-4 h-4" /></button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Experiment Name *</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Homepage CTA Button Colour"
            className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
        </div>
        <div>
          <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Channel</label>
          <input value={channel} onChange={(e) => setChannel(e.target.value)} placeholder="e.g. Landing page, Email, Ads"
            className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
        </div>
      </div>

      <div>
        <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Hypothesis *</label>
        <textarea value={hypothesis} onChange={(e) => setHypothesis(e.target.value)} rows={2}
          placeholder="If we [change X], then [metric Y] will improve by [Z%] because [reasoning]"
          className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary resize-none" />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Control *</label>
          <input value={control} onChange={(e) => setControl(e.target.value)} placeholder="Current version"
            className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
        </div>
        <div>
          <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Variant *</label>
          <input value={variant} onChange={(e) => setVariant(e.target.value)} placeholder="New version being tested"
            className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
        </div>
      </div>

      <div>
        <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Primary Metric *</label>
        <input value={metric} onChange={(e) => setMetric(e.target.value)} placeholder="e.g. Conversion rate, Click-through rate"
          className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
      </div>

      <button onClick={create} disabled={saving}
        className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50">
        {saving ? 'Saving…' : 'Save Experiment'}
      </button>
    </div>
  )
}

export default function ExperimentLogPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const [experiments, setExperiments] = useState<Experiment[]>([])
  const [loading, setLoading] = useState(true)
  const [filterStatus, setFilterStatus] = useState('all')

  const load = useCallback(async () => {
    try {
      const data = await api.pillar10.listExperiments(projectId)
      setExperiments(data as Experiment[])
    } catch {
      toast.error('Failed to load experiments')
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => { load() }, [load])

  async function handleUpdate(id: string, patch: Partial<Experiment>) {
    try {
      await api.pillar10.updateExperiment(projectId, id, patch)
      setExperiments((prev) => prev.map((e) => e.id === id ? { ...e, ...patch } : e))
      toast.success('Updated')
    } catch {
      toast.error('Update failed')
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this experiment?')) return
    try {
      await api.pillar10.deleteExperiment(projectId, id)
      setExperiments((prev) => prev.filter((e) => e.id !== id))
      toast.success('Deleted')
    } catch {
      toast.error('Delete failed')
    }
  }

  const filtered = filterStatus === 'all' ? experiments : experiments.filter((e) => e.status === filterStatus)

  const counts = STATUSES.reduce((acc, s) => {
    acc[s] = experiments.filter((e) => e.status === s).length
    return acc
  }, {} as Record<string, number>)

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="border-b border-border px-6 py-4 flex items-center gap-3">
        <SidebarToggle />
        <div className="flex-1">
          <h1 className="font-semibold">Experiment Log</h1>
          <p className="text-xs text-muted-foreground">Pillar 10 - Native DB</p>
        </div>
        <CreateForm projectId={projectId} onCreated={load} />
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-4xl mx-auto space-y-4">
          {/* Status summary */}
          <div className="grid grid-cols-5 gap-2">
            {STATUSES.map((s) => (
              <button key={s} onClick={() => setFilterStatus(filterStatus === s ? 'all' : s)}
                className={cn('p-2 rounded-lg border text-center transition-colors',
                  filterStatus === s ? 'border-primary bg-primary/5' : 'border-border bg-card hover:border-primary/50')}>
                <p className="text-lg font-bold">{counts[s] ?? 0}</p>
                <p className="text-[10px] text-muted-foreground capitalize">{s}</p>
              </button>
            ))}
          </div>

          {/* Filter indicator */}
          {filterStatus !== 'all' && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Showing: <span className="capitalize font-medium text-foreground">{filterStatus}</span></span>
              <button onClick={() => setFilterStatus('all')} className="text-xs text-primary hover:underline">Clear</button>
            </div>
          )}

          {/* List */}
          {loading ? (
            <div className="text-center py-12 text-sm text-muted-foreground">Loading experiments…</div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12 space-y-2">
              <ClipboardList className="w-8 h-8 text-muted-foreground mx-auto" />
              <p className="text-sm text-muted-foreground">
                {filterStatus === 'all' ? 'No experiments yet. Log your first one!' : `No ${filterStatus} experiments.`}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {filtered.map((exp) => (
                <ExperimentCard key={exp.id} exp={exp} onUpdate={handleUpdate} onDelete={handleDelete} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
