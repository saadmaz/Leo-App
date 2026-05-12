'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Zap, CheckCircle2, XCircle, Loader2, Plus } from 'lucide-react'
import { useAppStore } from '@/stores/app-store'
import { api } from '@/lib/api'
import type { IngestionStep } from '@/types'
import { cn } from '@/lib/utils'
import { CHANNELS } from '@/components/chat/channel-selector'

// ---------------------------------------------------------------------------
// Channel multi-select
// ---------------------------------------------------------------------------

function ChannelPicker({
  selected,
  onChange,
}: {
  selected: string[]
  onChange: (v: string[]) => void
}) {
  function toggle(key: string) {
    onChange(
      selected.includes(key) ? selected.filter((k) => k !== key) : [...selected, key],
    )
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {CHANNELS.map((ch) => (
        <button
          key={ch.key}
          type="button"
          onClick={() => toggle(ch.key)}
          className={cn(
            'flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors',
            selected.includes(ch.key)
              ? 'bg-primary text-primary-foreground'
              : 'bg-muted text-muted-foreground hover:text-foreground',
          )}
        >
          <span>{ch.icon}</span>
          <span>{ch.label}</span>
        </button>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Step icon (reused from ingestion overlay pattern)
// ---------------------------------------------------------------------------

function StepIcon({ status }: { status: IngestionStep['status'] }) {
  if (status === 'done')    return <CheckCircle2 className="w-4 h-4 text-primary shrink-0 mt-0.5" />
  if (status === 'error')   return <XCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
  if (status === 'running') return <Loader2 className="w-4 h-4 text-primary shrink-0 animate-spin mt-0.5" />
  return <div className="w-4 h-4 rounded-full border border-border shrink-0 mt-0.5" />
}

// ---------------------------------------------------------------------------
// Main modal
// ---------------------------------------------------------------------------

export function CampaignGenerator() {
  const router = useRouter()
  const {
    campaignGeneratorOpen, setCampaignGeneratorOpen,
    activeProject, upsertCampaign, setActiveCampaign,
    openUpgradeModal,
  } = useAppStore()

  const [name, setName] = useState('')
  const [objective, setObjective] = useState('')
  const [audience, setAudience] = useState('')
  const [channels, setChannels] = useState<string[]>(['instagram'])
  const [timeline, setTimeline] = useState('4 weeks')
  const [kpis, setKpis] = useState<string[]>([])
  const [kpiInput, setKpiInput] = useState('')
  const [budgetGuidance, setBudgetGuidance] = useState('')

  const [running, setRunning] = useState(false)
  const [steps, setSteps] = useState<IngestionStep[]>([])
  const [progress, setProgress] = useState(0)
  const [done, setDone] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  if (!campaignGeneratorOpen || !activeProject) return null

  const canStart = name.trim() && objective.trim() && audience.trim() && channels.length > 0 && !running && !done

  function addKpi() {
    const v = kpiInput.trim()
    if (v && !kpis.includes(v)) setKpis([...kpis, v])
    setKpiInput('')
  }

  function reset() {
    setName(''); setObjective(''); setAudience('')
    setChannels(['instagram']); setTimeline('4 weeks')
    setKpis([]); setKpiInput(''); setBudgetGuidance('')
    setSteps([]); setProgress(0); setDone(false); setErrorMsg('')
    setRunning(false)
  }

  function handleClose() {
    if (running) return
    setCampaignGeneratorOpen(false)
    reset()
  }

  async function handleGenerate() {
    if (!activeProject) return
    setSteps([]); setProgress(0); setDone(false); setErrorMsg('')
    setRunning(true)

    await api.streamCampaignGenerate(
      activeProject.id,
      { name, objective, audience, channels, timeline, kpis, budgetGuidance },
      {
        onStep: (step) => setSteps((prev) => [...prev.filter((s) => s.label !== step.label), step]),
        onProgress: (pct) => setProgress(pct),
        onDone: (campaign) => {
          upsertCampaign(campaign)
          setRunning(false)
          setDone(true)
        },
        onError: (msg) => {
          setRunning(false)
          if (msg.includes('402')) {
            setCampaignGeneratorOpen(false)
            reset()
            openUpgradeModal("You've reached your campaign limit. Upgrade to generate unlimited campaigns.")
          } else {
            setErrorMsg(msg)
          }
        },
      },
    )
  }

  function handleViewCampaign() {
    const latest = useAppStore.getState().campaigns[0]
    if (latest) setActiveCampaign(latest)
    handleClose()
    if (activeProject) router.push(`/projects/${activeProject.id}/campaigns`)
  }

  return (
    <AnimatePresence>
      {campaignGeneratorOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
            onClick={running ? undefined : handleClose}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ type: 'spring', stiffness: 300, damping: 28 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none"
          >
            <div
              className="w-full max-w-xl bg-card border border-border rounded-2xl shadow-2xl overflow-hidden pointer-events-auto max-h-[90vh] flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
                <div className="flex items-center gap-2">
                  <Zap className="w-4 h-4 text-primary" />
                  <h2 className="font-semibold text-sm">Generate Campaign</h2>
                </div>
                {!running && (
                  <button onClick={handleClose} className="p-1.5 rounded-md hover:bg-muted text-muted-foreground">
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-5">
                {/* Form - hidden while running */}
                {!running && !done && (
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
                    <Field label="Campaign name *" value={name} onChange={setName} placeholder="Summer product launch" />
                    <Field label="Objective *" value={objective} onChange={setObjective} placeholder="Increase brand awareness and drive 500 sign-ups" textarea />
                    <Field label="Target audience *" value={audience} onChange={setAudience} placeholder="25–40 year old professionals interested in wellness" />

                    <div>
                      <label className="block text-xs font-medium text-muted-foreground mb-2">Channels *</label>
                      <ChannelPicker selected={channels} onChange={setChannels} />
                    </div>

                    <Field label="Timeline" value={timeline} onChange={setTimeline} placeholder="4 weeks" />

                    <div>
                      <label className="block text-xs font-medium text-muted-foreground mb-2">KPIs</label>
                      <div className="flex flex-wrap gap-1.5 mb-2">
                        {kpis.map((k) => (
                          <span key={k} className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-muted text-xs">
                            {k}
                            <button onClick={() => setKpis(kpis.filter((x) => x !== k))}>
                              <X className="w-2.5 h-2.5" />
                            </button>
                          </span>
                        ))}
                      </div>
                      <div className="flex gap-1.5">
                        <input
                          className="flex-1 rounded-lg border border-input bg-background px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                          value={kpiInput}
                          onChange={(e) => setKpiInput(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addKpi() } }}
                          placeholder="e.g. 500 sign-ups, 10% CTR"
                        />
                        <button onClick={addKpi} disabled={!kpiInput.trim()} className="p-1.5 rounded-lg border border-border hover:bg-muted disabled:opacity-40">
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    <Field label="Budget guidance" value={budgetGuidance} onChange={setBudgetGuidance} placeholder="$5,000 total / $200 per day" />

                    {errorMsg && (
                      <p className="text-xs text-destructive bg-destructive/10 px-3 py-2 rounded-lg">{errorMsg}</p>
                    )}

                    <button
                      onClick={handleGenerate}
                      disabled={!canStart}
                      className="w-full py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium disabled:opacity-40 hover:opacity-90 transition-opacity"
                    >
                      Generate campaign
                    </button>
                  </motion.div>
                )}

                {/* Progress */}
                {(running || (done && steps.length > 0)) && (
                  <div className="space-y-4">
                    <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
                      <motion.div
                        className="h-full bg-primary rounded-full"
                        animate={{ width: `${progress}%` }}
                        transition={{ duration: 0.4, ease: 'easeOut' }}
                      />
                    </div>
                    <div className="space-y-2.5">
                      <AnimatePresence initial={false}>
                        {steps.map((step) => (
                          <motion.div
                            key={step.label}
                            initial={{ opacity: 0, x: -6 }}
                            animate={{ opacity: 1, x: 0 }}
                            className="flex items-start gap-3"
                          >
                            <StepIcon status={step.status} />
                            <p className={cn(
                              'text-sm',
                              step.status === 'done' && 'text-muted-foreground',
                              step.status === 'error' && 'text-destructive',
                              step.status === 'running' && 'font-medium',
                            )}>{step.label}</p>
                          </motion.div>
                        ))}
                      </AnimatePresence>
                      {running && (
                        <motion.div
                          animate={{ opacity: [0.4, 1, 0.4] }}
                          transition={{ duration: 1.5, repeat: Infinity }}
                          className="flex items-center gap-2 text-xs text-muted-foreground"
                        >
                          <Loader2 className="w-3 h-3 animate-spin" />
                          <span>LEO is crafting your campaign…</span>
                        </motion.div>
                      )}
                    </div>
                  </div>
                )}

                {/* Success */}
                {done && !errorMsg && (
                  <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
                    <div className="flex items-center gap-3 rounded-xl bg-primary/5 border border-primary/20 p-4">
                      <CheckCircle2 className="w-5 h-5 text-primary shrink-0" />
                      <div>
                        <p className="text-sm font-medium">Campaign ready</p>
                        <p className="text-xs text-muted-foreground">Brief and content packs generated.</p>
                      </div>
                    </div>
                    <div className="flex gap-3">
                      <button
                        onClick={handleViewCampaign}
                        className="flex-1 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity"
                      >
                        View campaign
                      </button>
                      <button
                        onClick={handleClose}
                        className="flex-1 py-2.5 rounded-xl border border-border text-sm text-muted-foreground hover:text-foreground transition-colors"
                      >
                        Done
                      </button>
                    </div>
                  </motion.div>
                )}
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

// ---------------------------------------------------------------------------
// Field helper
// ---------------------------------------------------------------------------

function Field({
  label, value, onChange, placeholder, textarea,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  textarea?: boolean
}) {
  const cls = "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50"
  return (
    <div>
      <label className="block text-xs font-medium text-muted-foreground mb-1.5">{label}</label>
      {textarea
        ? <textarea rows={2} className={cn(cls, 'resize-none')} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
        : <input type="text" className={cls} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />}
    </div>
  )
}
