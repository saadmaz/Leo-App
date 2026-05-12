'use client'

import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  X, User, Target, Mic2, BookOpen, BarChart2, ChevronDown, ChevronUp,
  Check, RefreshCw, Loader2, Plus, Sparkles,
} from 'lucide-react'
import { useAppStore } from '@/stores/app-store'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import type { PersonalVoiceProfile, VoiceCalibrationEvent } from '@/types'

// ---------------------------------------------------------------------------
// Completeness ring
// ---------------------------------------------------------------------------

function CompletenessRing({ score }: { score: number }) {
  const r = 28
  const circ = 2 * Math.PI * r
  const filled = circ * (score / 100)

  return (
    <div className="relative w-16 h-16">
      <svg className="w-full h-full -rotate-90" viewBox="0 0 72 72">
        <circle cx="36" cy="36" r={r} fill="none" stroke="currentColor" strokeWidth="4" className="text-muted" />
        <circle
          cx="36" cy="36" r={r} fill="none"
          stroke="currentColor" strokeWidth="4"
          strokeDasharray={`${filled} ${circ}`}
          strokeLinecap="round"
          className="text-primary transition-all duration-700"
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-xs font-bold text-foreground">
        {score}%
      </span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Collapsible section
// ---------------------------------------------------------------------------

function Section({
  icon,
  title,
  children,
  defaultOpen = true,
}: {
  icon: React.ReactNode
  title: string
  children: React.ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border-b border-border last:border-0">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3 hover:bg-muted/40 transition-colors"
      >
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {icon}
          {title}
        </div>
        {open ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 space-y-2">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Formality meter
// ---------------------------------------------------------------------------

function FormalityMeter({ level }: { level: number }) {
  const labels = ['Very Casual', 'Casual', 'Balanced', 'Formal', 'Very Formal']
  return (
    <div className="space-y-1">
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((i) => (
          <div
            key={i}
            className={cn(
              'h-1.5 flex-1 rounded-full transition-colors',
              i <= level ? 'bg-primary' : 'bg-muted',
            )}
          />
        ))}
      </div>
      <p className="text-[10px] text-muted-foreground">{labels[(level ?? 3) - 1]}</p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Voice accuracy ring
// ---------------------------------------------------------------------------

function AccuracyRing({ score }: { score: number }) {
  const color = score >= 85 ? 'text-green-500' : score >= 65 ? 'text-amber-500' : 'text-red-500'
  const r = 16
  const circ = 2 * Math.PI * r
  const filled = circ * (score / 100)
  return (
    <div className="relative w-10 h-10 shrink-0">
      <svg className="w-full h-full -rotate-90" viewBox="0 0 40 40">
        <circle cx="20" cy="20" r={r} fill="none" stroke="currentColor" strokeWidth="3" className="text-muted" />
        <circle
          cx="20" cy="20" r={r} fill="none" stroke="currentColor" strokeWidth="3"
          strokeDasharray={`${filled} ${circ}`} strokeLinecap="round"
          className={`${color} transition-all duration-700`}
        />
      </svg>
      <span className={`absolute inset-0 flex items-center justify-center text-[10px] font-bold ${color}`}>
        {score}
      </span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Voice section with calibration UI
// ---------------------------------------------------------------------------

function VoiceSection({
  voice,
  projectId,
  onCalibrated,
}: {
  voice: PersonalVoiceProfile | null | undefined
  projectId: string
  onCalibrated: (v: PersonalVoiceProfile) => void
}) {
  const [showImprove, setShowImprove] = useState(false)
  const [samples, setSamples] = useState(['', '', ''])
  const [calibrating, setCalibrating] = useState(false)
  const [calSteps, setCalSteps] = useState<{ label: string; status: 'running' | 'done' | 'error' }[]>([])
  const [calError, setCalError] = useState<string | null>(null)
  const ctrlRef = useRef<AbortController | null>(null)

  function handleRecalibrate() {
    if (!projectId) return
    setCalibrating(true)
    setCalSteps([])
    setCalError(null)
    ctrlRef.current = new AbortController()
    api.persona.streamCalibrate(
      projectId,
      {
        onStep: (label, status) => setCalSteps((p) => {
          const idx = p.findIndex((s) => s.label === label)
          if (idx >= 0) { const n = [...p]; n[idx] = { label, status }; return n }
          return [...p, { label, status }]
        }),
        onDone: (event) => {
          onCalibrated((event as VoiceCalibrationEvent & { type: 'done' }).voiceProfile)
          setCalibrating(false)
          setShowImprove(false)
        },
        onError: (msg) => { setCalError(msg); setCalibrating(false) },
      },
      ctrlRef.current.signal,
    )
  }

  function handleAddSamples() {
    const filled = samples.filter((s) => s.trim())
    if (!filled.length || !projectId) return
    setCalibrating(true)
    setCalSteps([])
    setCalError(null)
    ctrlRef.current = new AbortController()
    api.persona.streamAddSamples(
      projectId,
      filled,
      {
        onStep: (label, status) => setCalSteps((p) => {
          const idx = p.findIndex((s) => s.label === label)
          if (idx >= 0) { const n = [...p]; n[idx] = { label, status }; return n }
          return [...p, { label, status }]
        }),
        onDone: (event) => {
          onCalibrated((event as VoiceCalibrationEvent & { type: 'done' }).voiceProfile)
          setCalibrating(false)
          setShowImprove(false)
          setSamples(['', '', ''])
        },
        onError: (msg) => { setCalError(msg); setCalibrating(false) },
      },
      ctrlRef.current.signal,
    )
  }

  const lastCalibrated = voice?.lastCalibrated
    ? new Date(voice.lastCalibrated).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
    : null

  const approvedCount = voice?.approvedOutputs?.length ?? 0

  return (
    <Section icon={<Mic2 className="w-3.5 h-3.5" />} title="Voice Profile" defaultOpen={false}>
      {voice ? (
        <div className="space-y-4">
          {/* Accuracy score header */}
          <div className="flex items-center gap-3 p-3 rounded-xl bg-muted/50 border border-border/60">
            <AccuracyRing score={voice.accuracyScore ?? 0} />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-foreground">Voice accuracy</p>
              <p className="text-[10px] text-muted-foreground leading-tight">
                {lastCalibrated ? `Last calibrated ${lastCalibrated}` : 'Not yet calibrated'}
                {approvedCount > 0 && ` · ${approvedCount} approved post${approvedCount !== 1 ? 's' : ''}`}
              </p>
            </div>
            <button
              onClick={handleRecalibrate}
              disabled={calibrating || approvedCount < 3}
              title={approvedCount < 3 ? 'Approve 3+ posts from Content Engine first' : 'Recalibrate from approved posts'}
              className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {calibrating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            </button>
          </div>

          {/* Voice characteristics */}
          <div>
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1.5">Formality</p>
            <FormalityMeter level={voice.formalityLevel ?? 3} />
          </div>
          {voice.emotionalRegister && (
            <div>
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1">Register</p>
              <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-foreground capitalize">{voice.emotionalRegister}</span>
            </div>
          )}
          {voice.signaturePhrases?.length > 0 && (
            <div>
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1.5">Signature Phrases</p>
              <div className="space-y-1">
                {voice.signaturePhrases.slice(0, 5).map((p) => (
                  <p key={p} className="text-xs text-foreground italic">&quot;{p}&quot;</p>
                ))}
              </div>
            </div>
          )}
          {voice.avoidedPhrases?.length > 0 && (
            <div>
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1.5">Never Says</p>
              <div className="flex flex-wrap gap-1">
                {voice.avoidedPhrases.slice(0, 6).map((p) => (
                  <span key={p} className="text-[10px] px-2 py-0.5 rounded-full bg-destructive/10 text-destructive line-through">{p}</span>
                ))}
              </div>
            </div>
          )}
          {voice.writingPatterns && voice.writingPatterns.length > 0 && (
            <div>
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1.5">Writing Patterns</p>
              <ul className="space-y-1">
                {voice.writingPatterns.slice(0, 3).map((p, i) => (
                  <li key={i} className="text-xs text-foreground flex items-start gap-1.5">
                    <span className="text-primary mt-0.5">·</span>
                    {p}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Calibration steps (shown during calibration) */}
          {calibrating && calSteps.length > 0 && (
            <div className="space-y-1.5 py-1">
              {calSteps.map((s, i) => (
                <div key={i} className="flex items-center gap-1.5 text-xs">
                  {s.status === 'running' && <Loader2 className="w-3 h-3 animate-spin text-primary shrink-0" />}
                  {s.status === 'done' && <Check className="w-3 h-3 text-green-500 shrink-0" />}
                  <span className={s.status === 'running' ? 'text-foreground' : 'text-muted-foreground'}>{s.label}</span>
                </div>
              ))}
            </div>
          )}
          {calError && <p className="text-xs text-destructive">{calError}</p>}

          {/* Improve voice button */}
          <button
            onClick={() => setShowImprove(!showImprove)}
            className="flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 transition-colors font-medium"
          >
            <Plus className="w-3.5 h-3.5" />
            Improve my voice accuracy
          </button>

          {showImprove && (
            <div className="space-y-3 pt-1">
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                Paste 3 pieces of writing that sound most like you - posts, emails, messages, anything. LEO analyses them to sharpen your voice profile.
              </p>
              {samples.map((s, i) => (
                <textarea
                  key={i}
                  value={s}
                  onChange={(e) => { const n = [...samples]; n[i] = e.target.value; setSamples(n) }}
                  placeholder={`Sample ${i + 1} - paste your writing here`}
                  rows={3}
                  className="w-full rounded-xl border border-input bg-background px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring resize-none"
                />
              ))}
              <div className="flex gap-2">
                <button
                  onClick={handleAddSamples}
                  disabled={calibrating || !samples.some((s) => s.trim())}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
                >
                  {calibrating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                  {calibrating ? 'Calibrating…' : 'Calibrate'}
                </button>
                <button
                  onClick={() => setShowImprove(false)}
                  className="px-3 py-1.5 rounded-lg text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Voice profile not yet built. Complete Module C in your interview.</p>
      )}
    </Section>
  )
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

export function MyBrandPanel() {
  const { activeProject, personalCore, setPersonalCore, personalVoiceProfile, setPersonalVoiceProfile, myBrandPanelOpen, setMyBrandPanelOpen } = useAppStore()
  const [refreshing, setRefreshing] = useState(false)

  // Load personal core when panel opens
  useEffect(() => {
    if (!myBrandPanelOpen || !activeProject) return
    if (personalCore && personalCore.projectId === activeProject.id) return

    api.persona.getCore(activeProject.id)
      .then(setPersonalCore)
      .catch(console.error)

    api.persona.getVoice(activeProject.id)
      .then(setPersonalVoiceProfile)
      .catch(console.error)
  }, [myBrandPanelOpen, activeProject, personalCore, setPersonalCore, setPersonalVoiceProfile])

  async function handleRefresh() {
    if (!activeProject) return
    setRefreshing(true)
    try {
      const core = await api.persona.getCore(activeProject.id)
      setPersonalCore(core)
      const voice = await api.persona.getVoice(activeProject.id)
      setPersonalVoiceProfile(voice)
    } finally {
      setRefreshing(false)
    }
  }

  if (!myBrandPanelOpen) return null

  const core = personalCore
  const voice = personalVoiceProfile

  return (
    <>
      {/* Backdrop (mobile) */}
      <div
        className="fixed inset-0 z-40 bg-black/30 md:hidden"
        onClick={() => setMyBrandPanelOpen(false)}
      />

      <aside className="fixed inset-y-0 right-0 z-50 w-80 bg-card border-l border-border flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <User className="w-4 h-4 text-primary" />
            <span className="text-sm font-semibold">My Brand</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              title="Refresh"
              className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-40"
            >
              {refreshing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            </button>
            <button
              onClick={() => setMyBrandPanelOpen(false)}
              className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {!core ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 p-8 text-center">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Loading your brand…</p>
            </div>
          ) : (
            <>
              {/* Hero */}
              <div className="flex items-center gap-3 px-4 py-4 border-b border-border">
                <CompletenessRing score={core.completenessScore ?? 0} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-foreground truncate">{core.fullName || 'Your Name'}</p>
                  {core.headline && (
                    <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{core.headline}</p>
                  )}
                  <span className={cn(
                    'inline-flex items-center gap-1 mt-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full',
                    core.interviewStatus === 'complete'
                      ? 'bg-green-500/10 text-green-600'
                      : 'bg-amber-500/10 text-amber-600',
                  )}>
                    {core.interviewStatus === 'complete' ? <Check className="w-2.5 h-2.5" /> : null}
                    {core.interviewStatus === 'complete' ? 'Interview complete' : 'Interview in progress'}
                  </span>
                </div>
              </div>

              {/* Identity */}
              <Section icon={<Target className="w-3.5 h-3.5" />} title="Identity">
                {core.positioningStatement && (
                  <blockquote className="text-xs text-foreground italic border-l-2 border-primary pl-3 py-0.5 leading-relaxed">
                    &quot;{core.positioningStatement}&quot;
                  </blockquote>
                )}
                {core.uniqueAngle && (
                  <div>
                    <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1">Unique Angle</p>
                    <p className="text-xs text-foreground">{core.uniqueAngle}</p>
                  </div>
                )}
                {core.values?.length > 0 && (
                  <div>
                    <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1.5">Values</p>
                    <div className="flex flex-wrap gap-1">
                      {core.values.map((v) => (
                        <span key={v} className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium">{v}</span>
                      ))}
                    </div>
                  </div>
                )}
                {!core.positioningStatement && !core.uniqueAngle && (
                  <p className="text-xs text-muted-foreground">Complete your interview to build your identity profile.</p>
                )}
              </Section>

              {/* Voice */}
              <VoiceSection
                voice={voice}
                projectId={activeProject?.id ?? ''}
                onCalibrated={(updated) => setPersonalVoiceProfile(updated)}
              />

              {/* Content Pillars */}
              <Section icon={<BookOpen className="w-3.5 h-3.5" />} title="Content Pillars" defaultOpen={false}>
                {core.contentPillars?.length > 0 ? (
                  <div className="space-y-2">
                    {core.contentPillars.map((pillar, i) => (
                      <div key={i} className="flex items-start gap-2">
                        <span className="w-5 h-5 rounded-full bg-primary/10 text-primary text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                          {i + 1}
                        </span>
                        <div>
                          <p className="text-xs font-medium text-foreground">{pillar.name}</p>
                          {pillar.description && (
                            <p className="text-[10px] text-muted-foreground">{pillar.description}</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">Content pillars will appear after your interview is complete.</p>
                )}
              </Section>

              {/* Platform Strategy */}
              <Section icon={<BarChart2 className="w-3.5 h-3.5" />} title="Platforms" defaultOpen={false}>
                {core.platformStrategy && Object.keys(core.platformStrategy).length > 0 ? (
                  <div className="space-y-2">
                    {Object.entries(core.platformStrategy as Record<string, { focusLevel?: string; postsPerWeek?: number }>).map(([platform, cfg]) => (
                      <div key={platform} className="flex items-center justify-between py-1.5 border-b border-border/50 last:border-0">
                        <div>
                          <p className="text-xs font-medium text-foreground capitalize">{platform}</p>
                          <p className="text-[10px] text-muted-foreground capitalize">{cfg.focusLevel}</p>
                        </div>
                        <span className="text-[10px] font-medium text-muted-foreground">
                          {cfg.postsPerWeek}×/wk
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">Platform strategy will appear after your interview is complete.</p>
                )}
              </Section>

              {/* Goals */}
              {(core.goal90Day || core.goal12Month) && (
                <Section icon={<Target className="w-3.5 h-3.5" />} title="Goals" defaultOpen={false}>
                  {core.goal90Day && (
                    <div>
                      <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1">90-Day Goal</p>
                      <p className="text-xs text-foreground">{core.goal90Day}</p>
                    </div>
                  )}
                  {core.goal12Month && (
                    <div>
                      <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1">12-Month Vision</p>
                      <p className="text-xs text-foreground">{core.goal12Month}</p>
                    </div>
                  )}
                </Section>
              )}
            </>
          )}
        </div>
      </aside>
    </>
  )
}
