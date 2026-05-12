'use client'

import { motion, AnimatePresence } from 'framer-motion'
import { Globe, Search, BookOpen, Newspaper, Sparkles, Brain, Database } from 'lucide-react'
import Image from 'next/image'
import { cn } from '@/lib/utils'

// ---------------------------------------------------------------------------
// Tool config - icon, label, accent colour, detail line
// ---------------------------------------------------------------------------

type ToolConfig = {
  icon: React.ReactNode
  label: string
  accent: string        // Tailwind text colour
  accentBg: string      // Tailwind bg colour for icon ring
  accentBorder: string  // Tailwind border colour
  verb: string          // "Searching", "Researching" …
}

const TOOL_CONFIG: Record<string, ToolConfig> = {
  web_search: {
    icon: <Globe className="w-3.5 h-3.5" />,
    label: 'Searching the web',
    accent: 'text-blue-500',
    accentBg: 'bg-blue-500/10',
    accentBorder: 'border-blue-500/20',
    verb: 'Searching',
  },
  find_similar_companies: {
    icon: <Search className="w-3.5 h-3.5" />,
    label: 'Finding similar companies',
    accent: 'text-violet-500',
    accentBg: 'bg-violet-500/10',
    accentBorder: 'border-violet-500/20',
    verb: 'Scanning',
  },
  research_topic: {
    icon: <BookOpen className="w-3.5 h-3.5" />,
    label: 'Researching topic',
    accent: 'text-emerald-500',
    accentBg: 'bg-emerald-500/10',
    accentBorder: 'border-emerald-500/20',
    verb: 'Researching',
  },
  get_brand_news: {
    icon: <Newspaper className="w-3.5 h-3.5" />,
    label: 'Fetching brand news',
    accent: 'text-amber-500',
    accentBg: 'bg-amber-500/10',
    accentBorder: 'border-amber-500/20',
    verb: 'Scanning news',
  },
}

// Status-phase config (pre-tool messages from the backend)
type StatusConfig = {
  icon: React.ReactNode
  accent: string
  accentBg: string
  accentBorder: string
}

function getStatusConfig(message: string): StatusConfig {
  const m = message.toLowerCase()
  if (m.includes('brand') || m.includes('context') || m.includes('memory')) {
    return {
      icon: <Database className="w-3.5 h-3.5" />,
      accent: 'text-primary',
      accentBg: 'bg-primary/10',
      accentBorder: 'border-primary/20',
    }
  }
  if (m.includes('think') || m.includes('analyz')) {
    return {
      icon: <Brain className="w-3.5 h-3.5" />,
      accent: 'text-primary',
      accentBg: 'bg-primary/10',
      accentBorder: 'border-primary/20',
    }
  }
  return {
    icon: <Sparkles className="w-3.5 h-3.5" />,
    accent: 'text-primary',
    accentBg: 'bg-primary/10',
    accentBorder: 'border-primary/20',
  }
}

// ---------------------------------------------------------------------------
// Shimmer sweep animation
// ---------------------------------------------------------------------------

function ShimmerBar() {
  return (
    <div className="relative h-px w-full overflow-hidden rounded-full bg-border/40 mt-3">
      <motion.div
        className="absolute inset-y-0 w-1/3 rounded-full bg-gradient-to-r from-transparent via-primary/60 to-transparent"
        animate={{ x: ['-100%', '400%'] }}
        transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Pulsing dots
// ---------------------------------------------------------------------------

function PulsingDots({ accent }: { accent: string }) {
  return (
    <span className="inline-flex items-center gap-[3px] ml-1.5">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className={cn('w-1 h-1 rounded-full', accent.replace('text-', 'bg-'))}
          animate={{ opacity: [0.2, 1, 0.2], scale: [0.8, 1, 0.8] }}
          transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.18, ease: 'easeInOut' }}
        />
      ))}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Tool indicator card
// ---------------------------------------------------------------------------

interface ToolIndicatorProps {
  tool: string
  query?: string
}

function ToolIndicator({ tool, query }: ToolIndicatorProps) {
  const cfg = TOOL_CONFIG[tool] ?? {
    icon: <Search className="w-3.5 h-3.5" />,
    label: 'Working',
    accent: 'text-primary',
    accentBg: 'bg-primary/10',
    accentBorder: 'border-primary/20',
    verb: 'Processing',
  }

  return (
    <motion.div
      key={`tool-${tool}-${query}`}
      initial={{ opacity: 0, y: 6, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -6, scale: 0.98 }}
      transition={{ duration: 0.22, ease: 'easeOut' }}
      className="flex items-start gap-3 px-4 py-3.5 rounded-2xl border bg-card/80 backdrop-blur-sm shadow-sm max-w-sm"
      style={{ borderColor: 'color-mix(in srgb, var(--border) 80%, transparent)' }}
    >
      {/* Leo avatar + tool icon overlay */}
      <div className="relative shrink-0 mt-0.5">
        <div className="w-8 h-8 rounded-xl bg-primary/5 border border-border/50 flex items-center justify-center overflow-hidden">
          <Image src="/Leo-agent.png" alt="LEO" width={20} height={20} className="rounded-md opacity-90" />
        </div>
        <div className={cn(
          'absolute -bottom-1 -right-1 w-4.5 h-4.5 rounded-full border-2 border-background flex items-center justify-center',
          cfg.accentBg, cfg.accent
        )}
          style={{ width: 18, height: 18 }}
        >
          {cfg.icon}
        </div>
      </div>

      {/* Text */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1">
          <span className={cn('text-xs font-semibold', cfg.accent)}>{cfg.label}</span>
          <PulsingDots accent={cfg.accent} />
        </div>

        {query && (
          <p className="text-[11.5px] text-muted-foreground mt-0.5 leading-snug line-clamp-2">
            &ldquo;{query}&rdquo;
          </p>
        )}

        <ShimmerBar />
      </div>
    </motion.div>
  )
}

// ---------------------------------------------------------------------------
// Status indicator card (pre-tool: Analyzing, Loading brand context, Thinking)
// ---------------------------------------------------------------------------

interface StatusIndicatorProps {
  message: string
}

function StatusIndicator({ message }: StatusIndicatorProps) {
  const cfg = getStatusConfig(message)

  return (
    <motion.div
      key={`status-${message}`}
      initial={{ opacity: 0, y: 6, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -6, scale: 0.98 }}
      transition={{ duration: 0.22, ease: 'easeOut' }}
      className="flex items-center gap-3 px-4 py-3 rounded-2xl border bg-card/80 backdrop-blur-sm shadow-sm max-w-sm"
      style={{ borderColor: 'color-mix(in srgb, var(--border) 80%, transparent)' }}
    >
      {/* Spinning ring avatar */}
      <div className="relative shrink-0">
        <div className="w-8 h-8 rounded-xl bg-primary/5 border border-border/50 flex items-center justify-center overflow-hidden">
          <Image src="/Leo-agent.png" alt="LEO" width={20} height={20} className="rounded-md opacity-90" />
        </div>
        {/* Orbit ring */}
        <motion.div
          className="absolute inset-0 rounded-xl border border-primary/30"
          animate={{ opacity: [0.3, 0.8, 0.3] }}
          transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
        />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className={cn('text-xs font-medium', cfg.accent)}>{message}</span>
          <PulsingDots accent={cfg.accent} />
        </div>
      </div>
    </motion.div>
  )
}

// ---------------------------------------------------------------------------
// Public export - wraps both, picks the right one
// ---------------------------------------------------------------------------

interface ThinkingIndicatorProps {
  activeToolCall: { tool: string; query: string } | null
  streamStatus: string | null
}

export function ThinkingIndicator({ activeToolCall, streamStatus }: ThinkingIndicatorProps) {
  return (
    <AnimatePresence mode="wait">
      {activeToolCall ? (
        <ToolIndicator
          key={`tool-${activeToolCall.tool}`}
          tool={activeToolCall.tool}
          query={activeToolCall.query}
        />
      ) : streamStatus ? (
        <StatusIndicator
          key={`status-${streamStatus}`}
          message={streamStatus}
        />
      ) : null}
    </AnimatePresence>
  )
}
