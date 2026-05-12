'use client'

import Image from 'next/image'
import { Sparkles, Zap, MessageSquare, ArrowRight } from 'lucide-react'
import { motion } from 'framer-motion'
import { useAppStore } from '@/stores/app-store'
import { cn } from '@/lib/utils'

const STEPS = [
  {
    icon: <Sparkles className="w-4 h-4" />,
    title: 'Create your brand',
    description: 'Give your brand a name, social links, and choose your AI models.',
  },
  {
    icon: <Zap className="w-4 h-4" />,
    title: 'Build your Brand Core',
    description: 'LEO scrapes your website and Instagram to extract tone, visuals, and messaging.',
  },
  {
    icon: <MessageSquare className="w-4 h-4" />,
    title: 'Start creating',
    description: 'Ask for captions, ad copy, campaign briefs, or content calendars - all on-brand.',
  },
]

export function OnboardingCard() {
  const { setWizardOpen } = useAppStore()

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="w-full max-w-lg mx-auto"
    >
      {/* Header */}
      <div className="text-center mb-8">
        <Image src="/Leo-agent.png" alt="LEO" width={72} height={72} className="mx-auto mb-4 rounded-2xl" />
        <h1 className="text-2xl font-bold">Welcome to LEO</h1>
        <p className="mt-1.5 text-sm text-muted-foreground max-w-xs mx-auto">
          Your brand-aware AI marketing co-pilot. Get started in under 2 minutes.
        </p>
      </div>

      {/* Steps */}
      <div className="space-y-3 mb-8">
        {STEPS.map((step, i) => (
          <div
            key={i}
            className={cn(
              'flex items-start gap-4 p-4 rounded-xl border transition-colors',
              i === 0
                ? 'border-primary/30 bg-primary/5'
                : 'border-border bg-card opacity-60',
            )}
          >
            <div className={cn(
              'w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-sm font-bold',
              i === 0
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground',
            )}>
              {i + 1}
            </div>
            <div className="min-w-0">
              <span className={cn('text-sm font-medium', i !== 0 && 'text-muted-foreground')}>
                {step.title}
              </span>
              <p className="text-xs text-muted-foreground mt-0.5">{step.description}</p>
            </div>
          </div>
        ))}
      </div>

      {/* CTA */}
      <button
        onClick={() => setWizardOpen(true)}
        className="flex items-center justify-center gap-2 w-full py-3 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
      >
        Get started
        <ArrowRight className="w-4 h-4" />
      </button>
    </motion.div>
  )
}
