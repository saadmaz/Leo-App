'use client'

import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Globe, CheckCircle2, XCircle, Loader2, Zap } from 'lucide-react'
import { useAppStore } from '@/stores/app-store'
import { api } from '@/lib/api'
import type { IngestionStep } from '@/types'
import { cn } from '@/lib/utils'

// ---------------------------------------------------------------------------
// Platform icon helpers
// ---------------------------------------------------------------------------

function PlatformIcon({ platform, className }: { platform: string; className?: string }) {
  const base = cn('w-3.5 h-3.5 shrink-0', className)
  switch (platform) {
    case 'instagram':
      return (
        <svg className={base} viewBox="0 0 24 24" fill="none">
          <defs>
            <linearGradient id="ig-grad-io" x1="0%" y1="100%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#f09433"/>
              <stop offset="25%" stopColor="#e6683c"/>
              <stop offset="50%" stopColor="#dc2743"/>
              <stop offset="75%" stopColor="#cc2366"/>
              <stop offset="100%" stopColor="#bc1888"/>
            </linearGradient>
          </defs>
          <rect x="2" y="2" width="20" height="20" rx="5" stroke="url(#ig-grad-io)" strokeWidth="2"/>
          <circle cx="12" cy="12" r="4" stroke="url(#ig-grad-io)" strokeWidth="2"/>
          <circle cx="17.5" cy="6.5" r="1" fill="url(#ig-grad-io)"/>
        </svg>
      )
    case 'facebook':
      return (
        <svg className={base} viewBox="0 0 24 24" fill="#1877F2">
          <path d="M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073C0 18.1 4.388 23.094 10.125 24v-8.437H7.078v-3.49h3.047V9.41c0-3.025 1.792-4.697 4.533-4.697 1.313 0 2.686.235 2.686.235v2.97h-1.513c-1.491 0-1.956.93-1.956 1.887v2.254h3.328l-.532 3.49h-2.796V24C19.612 23.094 24 18.1 24 12.073z"/>
        </svg>
      )
    case 'tiktok':
      return (
        <svg className={base} viewBox="0 0 24 24" fill="currentColor">
          <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01a6.33 6.33 0 00-.79-.05 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.33-6.34V8.69a8.18 8.18 0 004.78 1.52V6.76a4.85 4.85 0 01-1.01-.07z"/>
        </svg>
      )
    case 'linkedin':
      return (
        <svg className={base} viewBox="0 0 24 24" fill="#0A66C2">
          <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
        </svg>
      )
    case 'x':
      return (
        <svg className={base} viewBox="0 0 24 24" fill="currentColor">
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.746l7.73-8.835L1.254 2.25H8.08l4.259 5.63 5.905-5.63zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
        </svg>
      )
    case 'youtube':
      return (
        <svg className={base} viewBox="0 0 24 24" fill="#FF0000">
          <path d="M23.498 6.186a3.016 3.016 0 00-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 00.502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 002.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 002.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
        </svg>
      )
    default:
      return <Globe className={base} />
  }
}

// ---------------------------------------------------------------------------
// Platform row in the "sources" section
// ---------------------------------------------------------------------------

interface PlatformRowProps {
  platform: string
  label: string
  value: string
  enabled: boolean
  onToggle: (v: boolean) => void
}

function PlatformRow({ platform, label, value, enabled, onToggle }: PlatformRowProps) {
  return (
    <label className="flex items-center gap-3 cursor-pointer group">
      <input
        type="checkbox"
        checked={enabled}
        onChange={(e) => onToggle(e.target.checked)}
        className="accent-primary w-3.5 h-3.5"
      />
      <PlatformIcon platform={platform} className="text-muted-foreground group-hover:text-foreground transition-colors" />
      <div className="min-w-0 flex-1">
        <span className="text-xs font-medium text-foreground">{label}</span>
        <p className="text-xs text-muted-foreground truncate">{value}</p>
      </div>
    </label>
  )
}

// ---------------------------------------------------------------------------
// Main overlay
// ---------------------------------------------------------------------------

export function IngestionOverlay() {
  const {
    ingestionOpen, setIngestionOpen,
    ingestionSteps, ingestionProgress, ingestionRunning,
    addIngestionStep, setIngestionProgress, setIngestionRunning,
    resetIngestion, onIngestionDone,
    activeProject, setBrandCorePanelOpen,
  } = useAppStore()

  // Which platforms are enabled (checked) for this run
  const [enabled, setEnabled] = useState<Record<string, boolean>>({})
  const [done, setDone] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  // Build the list of stored social links on the active project
  interface PlatformDef {
    key: string
    platform: string
    label: string
    value: string
  }

  function buildPlatforms(): PlatformDef[] {
    if (!activeProject) return []
    const defs: PlatformDef[] = []
    if (activeProject.websiteUrl)   defs.push({ key: 'websiteUrl',   platform: 'website',   label: 'Website',   value: activeProject.websiteUrl })
    if (activeProject.instagramUrl) defs.push({ key: 'instagramUrl', platform: 'instagram', label: 'Instagram', value: activeProject.instagramUrl })
    if (activeProject.facebookUrl)  defs.push({ key: 'facebookUrl',  platform: 'facebook',  label: 'Facebook',  value: activeProject.facebookUrl })
    if (activeProject.tiktokUrl)    defs.push({ key: 'tiktokUrl',    platform: 'tiktok',    label: 'TikTok',    value: activeProject.tiktokUrl })
    if (activeProject.linkedinUrl)  defs.push({ key: 'linkedinUrl',  platform: 'linkedin',  label: 'LinkedIn',  value: activeProject.linkedinUrl })
    if (activeProject.xUrl)         defs.push({ key: 'xUrl',         platform: 'x',         label: 'X / Twitter', value: activeProject.xUrl })
    if (activeProject.youtubeUrl)   defs.push({ key: 'youtubeUrl',   platform: 'youtube',   label: 'YouTube',   value: activeProject.youtubeUrl })
    return defs
  }

  const platforms = buildPlatforms()

  // Reset enabled map whenever the overlay opens for a (possibly new) project
  useEffect(() => {
    if (ingestionOpen && activeProject) {
      const initial: Record<string, boolean> = {}
      buildPlatforms().forEach((p) => { initial[p.key] = true })
      setEnabled(initial)
      setDone(false)
      setErrorMsg('')
    }
  }, [ingestionOpen, activeProject?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!ingestionOpen || !activeProject) return null

  const canStart = platforms.some((p) => enabled[p.key]) && !ingestionRunning && !done

  async function startIngestion() {
    if (!activeProject) return

    resetIngestion()
    setDone(false)
    setErrorMsg('')
    setIngestionRunning(true)

    // Build the instagram handle from URL if stored
    const igUrl = activeProject.instagramUrl ?? ''
    const igHandle = igUrl ? igUrl.replace(/.*instagram\.com\//, '').replace(/\/$/, '') : undefined

    await api.streamIngestion(
      activeProject.id,
      {
        websiteUrl:      enabled['websiteUrl']   ? activeProject.websiteUrl   ?? undefined : undefined,
        instagramHandle: enabled['instagramUrl'] ? igHandle                               : undefined,
        facebookUrl:     enabled['facebookUrl']  ? activeProject.facebookUrl  ?? undefined : undefined,
        tiktokUrl:       enabled['tiktokUrl']    ? activeProject.tiktokUrl    ?? undefined : undefined,
        linkedinUrl:     enabled['linkedinUrl']  ? activeProject.linkedinUrl  ?? undefined : undefined,
        xUrl:            enabled['xUrl']         ? activeProject.xUrl         ?? undefined : undefined,
        youtubeUrl:      enabled['youtubeUrl']   ? activeProject.youtubeUrl   ?? undefined : undefined,
      },
      {
        onStep:     (step) => addIngestionStep(step),
        onProgress: (pct)  => setIngestionProgress(pct),
        onDone: (brandCore) => {
          onIngestionDone(activeProject.id, brandCore)
          setIngestionRunning(false)
          setDone(true)
        },
        onError: (message) => {
          setIngestionRunning(false)
          setErrorMsg(message)
        },
      },
    )
  }

  function handleClose() {
    if (ingestionRunning) return
    setIngestionOpen(false)
    resetIngestion()
    setDone(false)
    setErrorMsg('')
  }

  function handleViewBrandCore() {
    handleClose()
    setBrandCorePanelOpen(true)
  }

  return (
    <AnimatePresence>
      {ingestionOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
            onClick={ingestionRunning ? undefined : handleClose}
          >
            {/* Modal */}
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ type: 'spring', stiffness: 300, damping: 28 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-lg bg-card border border-border rounded-2xl shadow-2xl overflow-hidden"
            >
              {/* Header */}
              <div className="flex items-center justify-between px-6 py-5 border-b border-border">
                <div className="flex items-center gap-2">
                  <Zap className="w-4 h-4 text-primary" />
                  <h2 className="font-semibold text-sm">Build Brand Core</h2>
                </div>
                {!ingestionRunning && (
                  <button
                    onClick={handleClose}
                    className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>

              <div className="p-6 space-y-5">
                {/* Source selection - hide while running */}
                {!ingestionRunning && !done && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="space-y-4"
                  >
                    <p className="text-sm text-muted-foreground">
                      LEO will crawl your brand&apos;s digital presence and extract a Brand Core profile.
                      Select the sources to include:
                    </p>

                    {platforms.length === 0 ? (
                      <p className="text-sm text-muted-foreground bg-muted/40 rounded-xl px-4 py-3">
                        No social links are stored for this project. Edit the project to add them.
                      </p>
                    ) : (
                      <div className="space-y-3 bg-muted/30 rounded-xl px-4 py-3">
                        {platforms.map((p) => (
                          <PlatformRow
                            key={p.key}
                            platform={p.platform}
                            label={p.label}
                            value={p.value}
                            enabled={!!enabled[p.key]}
                            onToggle={(v) => setEnabled((prev) => ({ ...prev, [p.key]: v }))}
                          />
                        ))}
                      </div>
                    )}

                    {errorMsg && (
                      <p className="text-xs text-destructive bg-destructive/10 px-3 py-2 rounded-lg">{errorMsg}</p>
                    )}

                    <button
                      onClick={startIngestion}
                      disabled={!canStart}
                      className="w-full py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium disabled:opacity-40 hover:opacity-90 transition-opacity"
                    >
                      Analyse brand
                    </button>
                  </motion.div>
                )}

                {/* Progress steps */}
                {(ingestionRunning || (done && ingestionSteps.length > 0)) && (
                  <div className="space-y-4">
                    {/* Progress bar */}
                    <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
                      <motion.div
                        className="h-full bg-primary rounded-full"
                        animate={{ width: `${ingestionProgress}%` }}
                        transition={{ duration: 0.4, ease: 'easeOut' }}
                      />
                    </div>

                    {/* Steps list */}
                    <div className="space-y-2.5">
                      <AnimatePresence initial={false}>
                        {ingestionSteps.map((step) => (
                          <motion.div
                            key={step.label}
                            initial={{ opacity: 0, x: -6 }}
                            animate={{ opacity: 1, x: 0 }}
                            className="flex items-start gap-3"
                          >
                            <StepIcon status={step.status} />
                            <div className="min-w-0">
                              <p className={cn(
                                'text-sm',
                                step.status === 'done' && 'text-muted-foreground',
                                step.status === 'error' && 'text-destructive',
                                step.status === 'running' && 'text-foreground font-medium',
                              )}>
                                {step.label}
                              </p>
                              {step.detail && (
                                <p className="text-xs text-muted-foreground mt-0.5 truncate">{step.detail}</p>
                              )}
                            </div>
                          </motion.div>
                        ))}
                      </AnimatePresence>

                      {ingestionRunning && (
                        <motion.div
                          animate={{ opacity: [0.4, 1, 0.4] }}
                          transition={{ duration: 1.5, repeat: Infinity }}
                          className="flex items-center gap-2 text-xs text-muted-foreground"
                        >
                          <Loader2 className="w-3 h-3 animate-spin" />
                          <span>Analysing…</span>
                        </motion.div>
                      )}
                    </div>
                  </div>
                )}

                {/* Success state */}
                {done && !errorMsg && (
                  <motion.div
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="space-y-4"
                  >
                    <div className="flex items-center gap-3 rounded-xl bg-primary/5 border border-primary/20 p-4">
                      <CheckCircle2 className="w-5 h-5 text-primary shrink-0" />
                      <div>
                        <p className="text-sm font-medium">Brand Core built</p>
                        <p className="text-xs text-muted-foreground">Your brand intelligence is ready.</p>
                      </div>
                    </div>

                    <div className="flex gap-3">
                      <button
                        onClick={handleViewBrandCore}
                        className="flex-1 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity"
                      >
                        View Brand Core
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
            </motion.div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

// ---------------------------------------------------------------------------
// Step icon
// ---------------------------------------------------------------------------

function StepIcon({ status }: { status: IngestionStep['status'] }) {
  if (status === 'done')    return <CheckCircle2 className="w-4 h-4 text-primary shrink-0 mt-0.5" />
  if (status === 'error')   return <XCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
  if (status === 'running') return <Loader2 className="w-4 h-4 text-primary shrink-0 animate-spin mt-0.5" />
  return <div className="w-4 h-4 rounded-full border border-border shrink-0 mt-0.5" />
}
