'use client'

import { motion } from 'framer-motion'
import type { FunnelType } from '@/types'

const FUNNEL_OPTIONS: {
  type: FunnelType
  emoji: string
  label: string
  description: string
  color: string
}[] = [
  { type: 'tofu',      emoji: '🔺', label: 'TOFU',      description: 'Top of Funnel - Build Awareness',        color: 'hover:border-blue-500/60 hover:bg-blue-500/5' },
  { type: 'mofu',      emoji: '🔶', label: 'MOFU',      description: 'Mid Funnel - Nurture & Convert',          color: 'hover:border-amber-500/60 hover:bg-amber-500/5' },
  { type: 'bofu',      emoji: '🔻', label: 'BOFU',      description: 'Bottom of Funnel - Close Sales',          color: 'hover:border-red-500/60 hover:bg-red-500/5' },
  { type: 'full',      emoji: '⚡', label: 'FULL',      description: 'Full Funnel - End-to-End Strategy',       color: 'hover:border-primary/60 hover:bg-primary/5' },
  { type: 'retention', emoji: '🔁', label: 'RETENTION', description: 'Post-Purchase - Loyalty & LTV',           color: 'hover:border-emerald-500/60 hover:bg-emerald-500/5' },
]

interface FunnelSelectorProps {
  onSelect: (type: FunnelType) => void
  disabled?: boolean
}

export function FunnelSelector({ onSelect, disabled }: FunnelSelectorProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-xl border border-border bg-card p-4 space-y-3 w-full max-w-md"
    >
      <p className="text-sm font-medium text-foreground">Which funnel are you working on?</p>
      <div className="space-y-2">
        {FUNNEL_OPTIONS.map((opt) => (
          <button
            key={opt.type}
            onClick={() => !disabled && onSelect(opt.type)}
            disabled={disabled}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border border-border text-left transition-all ${opt.color} disabled:opacity-40 disabled:cursor-not-allowed`}
          >
            <span className="text-lg leading-none">{opt.emoji}</span>
            <div>
              <span className="text-xs font-bold text-foreground tracking-wide">{opt.label}</span>
              <span className="text-xs text-muted-foreground ml-2">{opt.description}</span>
            </div>
          </button>
        ))}
      </div>
    </motion.div>
  )
}
