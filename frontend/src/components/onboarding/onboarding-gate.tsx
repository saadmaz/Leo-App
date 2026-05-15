'use client'

/**
 * OnboardingGate
 *
 * Wraps project pages and shows a guided setup overlay when a new user
 * lands in a project without a Brand Core. The overlay walks them through:
 *   Step 1 → Provide website/social URLs (triggers brand ingestion)
 *   Step 2 → Wait for ingestion to complete
 *   Step 3 → Done — redirect to first chat
 *
 * The gate is dismissed permanently once the brand core is set.
 * Users can also skip to manual setup at any time.
 */

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { Sparkles, Globe, Instagram, Linkedin, CheckCircle2, ArrowRight, X, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useAppStore } from '@/stores/app-store'
import { api } from '@/lib/api'
import { toast } from 'sonner'

const STEPS = ['Welcome', 'Your Brand', 'Building Brand Core', 'Done'] as const
type Step = 0 | 1 | 2 | 3

interface Props {
  projectId: string
  projectName: string
}

export function OnboardingGate({ projectId, projectName }: Props) {
  const router = useRouter()
  const { activeProject, setIngestionOpen } = useAppStore()
  const [step, setStep] = useState<Step>(0)
  const [dismissed, setDismissed] = useState(false)
  const [websiteUrl, setWebsiteUrl] = useState('')
  const [instagramUrl, setInstagramUrl] = useState('')
  const [linkedinUrl, setLinkedinUrl] = useState('')
  const [ingesting, setIngesting] = useState(false)

  // Only show when brand core is absent and user hasn't dismissed
  const hasBrandCore = !!(activeProject?.brandCore)
  const show = !hasBrandCore && !dismissed

  const handleStartIngestion = async () => {
    if (!websiteUrl.trim()) {
      toast.error('Please enter your website URL')
      return
    }
    setStep(2)
    setIngesting(true)
    try {
      // Patch project with provided URLs first
      await api.projects.update(projectId, {
        websiteUrl: websiteUrl.trim() || undefined,
        instagramUrl: instagramUrl.trim() || undefined,
        linkedinUrl: linkedinUrl.trim() || undefined,
      })
      // Open the ingestion overlay (reuses existing IngestionOverlay component)
      setIngestionOpen(true)
      setStep(3)
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Setup failed')
      setStep(1)
    } finally {
      setIngesting(false)
    }
  }

  const goToFirstChat = async () => {
    try {
      const { chat } = await api.chats.create(projectId, 'My first chat')
      router.push(`/projects/${projectId}/chats/${chat.id}`)
    } catch {
      router.push(`/projects/${projectId}/dashboard`)
    }
    setDismissed(true)
  }

  if (!show) return null

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-4"
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0, y: 12 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.95, opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="bg-card border border-border rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden"
        >
          {/* Header */}
          <div className="bg-gradient-to-br from-violet-600 to-purple-700 p-6 text-white relative">
            <button
              onClick={() => setDismissed(true)}
              className="absolute top-4 right-4 text-white/60 hover:text-white transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
            <div className="flex items-center gap-2 mb-3">
              <Sparkles className="w-5 h-5" />
              <span className="text-sm font-medium opacity-80">LEO Setup</span>
            </div>
            <h2 className="text-xl font-bold">Welcome to {projectName}</h2>
            <p className="text-sm text-white/70 mt-1">
              Let's build your Brand Core in 60 seconds.
            </p>

            {/* Progress dots */}
            <div className="flex items-center gap-2 mt-4">
              {STEPS.map((_, i) => (
                <div
                  key={i}
                  className={`h-1.5 rounded-full transition-all duration-300 ${
                    i <= step ? 'bg-white' : 'bg-white/30'
                  } ${i === step ? 'w-6' : 'w-2'}`}
                />
              ))}
            </div>
          </div>

          {/* Body */}
          <div className="p-6">
            {step === 0 && (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Leo learns your brand voice, tone, and visual identity automatically.
                  Just point it at your website and socials — setup takes under a minute.
                </p>
                <div className="grid grid-cols-3 gap-3 text-center">
                  {[
                    { icon: '🎨', label: 'Brand voice' },
                    { icon: '🎯', label: 'Tone & style' },
                    { icon: '💡', label: 'Key themes' },
                  ].map(({ icon, label }) => (
                    <div key={label} className="rounded-lg border border-border p-3">
                      <p className="text-xl mb-1">{icon}</p>
                      <p className="text-xs text-muted-foreground">{label}</p>
                    </div>
                  ))}
                </div>
                <Button className="w-full" onClick={() => setStep(1)}>
                  Get started <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
                <button
                  onClick={() => setDismissed(true)}
                  className="w-full text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  I'll set up manually later
                </button>
              </div>
            )}

            {step === 1 && (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Provide your brand's online presence. Leo will read these and extract your brand identity.
                </p>
                <div className="space-y-3">
                  <div className="relative">
                    <Globe className="absolute left-3 top-2.5 w-4 h-4 text-muted-foreground" />
                    <Input
                      placeholder="https://yourbrand.com"
                      value={websiteUrl}
                      onChange={e => setWebsiteUrl(e.target.value)}
                      className="pl-9"
                    />
                  </div>
                  <div className="relative">
                    <Instagram className="absolute left-3 top-2.5 w-4 h-4 text-muted-foreground" />
                    <Input
                      placeholder="https://instagram.com/yourbrand (optional)"
                      value={instagramUrl}
                      onChange={e => setInstagramUrl(e.target.value)}
                      className="pl-9"
                    />
                  </div>
                  <div className="relative">
                    <Linkedin className="absolute left-3 top-2.5 w-4 h-4 text-muted-foreground" />
                    <Input
                      placeholder="https://linkedin.com/company/yourbrand (optional)"
                      value={linkedinUrl}
                      onChange={e => setLinkedinUrl(e.target.value)}
                      className="pl-9"
                    />
                  </div>
                </div>
                <Button
                  className="w-full"
                  onClick={handleStartIngestion}
                  disabled={ingesting || !websiteUrl.trim()}
                >
                  {ingesting ? (
                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Building your Brand Core...</>
                  ) : (
                    <>Build my Brand Core <ArrowRight className="w-4 h-4 ml-2" /></>
                  )}
                </Button>
              </div>
            )}

            {step === 2 && (
              <div className="space-y-4 text-center py-4">
                <div className="flex items-center justify-center">
                  <div className="relative">
                    <div className="w-16 h-16 rounded-full border-4 border-violet-200 border-t-violet-600 animate-spin" />
                    <Sparkles className="w-6 h-6 text-violet-600 absolute inset-0 m-auto" />
                  </div>
                </div>
                <div>
                  <p className="font-medium">Analysing your brand...</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Leo is reading your website and social profiles. This usually takes 30–60 seconds.
                  </p>
                </div>
              </div>
            )}

            {step === 3 && (
              <div className="space-y-4 text-center py-4">
                <div className="flex items-center justify-center">
                  <div className="w-16 h-16 rounded-full bg-emerald-50 flex items-center justify-center">
                    <CheckCircle2 className="w-8 h-8 text-emerald-500" />
                  </div>
                </div>
                <div>
                  <p className="font-semibold text-lg">Your Brand Core is ready!</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Leo now knows your brand voice, tone, and content themes.
                    Every chat response will sound exactly like you.
                  </p>
                </div>
                <Button className="w-full" onClick={goToFirstChat}>
                  Start chatting with Leo <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </div>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
