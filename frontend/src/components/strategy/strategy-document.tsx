'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ChevronDown, ChevronUp, Copy, Check, FileDown, Sparkles } from 'lucide-react'
import type { MarketingStrategy, StrategySection } from '@/types'

// ---------------------------------------------------------------------------
// Section metadata - icon + accent color per heading keyword
// ---------------------------------------------------------------------------

const SECTION_META: { match: string; icon: string; accent: string; bg: string }[] = [
  { match: 'situation',    icon: '🔍', accent: 'border-blue-500/30',    bg: 'bg-blue-500/5' },
  { match: 'funnel',       icon: '🧭', accent: 'border-violet-500/30',  bg: 'bg-violet-500/5' },
  { match: 'content',      icon: '📝', accent: 'border-emerald-500/30', bg: 'bg-emerald-500/5' },
  { match: 'campaign',     icon: '📅', accent: 'border-amber-500/30',   bg: 'bg-amber-500/5' },
  { match: 'timeline',     icon: '📅', accent: 'border-amber-500/30',   bg: 'bg-amber-500/5' },
  { match: 'budget',       icon: '💰', accent: 'border-green-500/30',   bg: 'bg-green-500/5' },
  { match: 'kpi',          icon: '📊', accent: 'border-cyan-500/30',    bg: 'bg-cyan-500/5' },
  { match: 'competition',  icon: '🏆', accent: 'border-orange-500/30',  bg: 'bg-orange-500/5' },
  { match: 'competitor',   icon: '🏆', accent: 'border-orange-500/30',  bg: 'bg-orange-500/5' },
  { match: 'recommend',    icon: '⚡', accent: 'border-primary/40',     bg: 'bg-primary/5' },
  { match: 'leo',          icon: '⚡', accent: 'border-primary/40',     bg: 'bg-primary/5' },
  { match: 'seasonality',  icon: '📆', accent: 'border-red-500/30',     bg: 'bg-red-500/5' },
  { match: 'platform',     icon: '📱', accent: 'border-pink-500/30',    bg: 'bg-pink-500/5' },
]

function getSectionMeta(heading: string) {
  const lower = heading.toLowerCase()
  return (
    SECTION_META.find((m) => lower.includes(m.match)) ??
    { icon: '✦', accent: 'border-border', bg: 'bg-muted/20' }
  )
}

// ---------------------------------------------------------------------------
// Custom markdown components - clean, well-typed tables + lists
// ---------------------------------------------------------------------------

const mdComponents = {
  // Tables
  table: ({ children }: { children?: React.ReactNode }) => (
    <div className="my-4 overflow-x-auto rounded-lg border border-border/60">
      <table className="w-full text-xs">{children}</table>
    </div>
  ),
  thead: ({ children }: { children?: React.ReactNode }) => (
    <thead className="bg-muted/60 border-b border-border/60">{children}</thead>
  ),
  tbody: ({ children }: { children?: React.ReactNode }) => (
    <tbody className="divide-y divide-border/40">{children}</tbody>
  ),
  tr: ({ children }: { children?: React.ReactNode }) => (
    <tr className="hover:bg-muted/20 transition-colors">{children}</tr>
  ),
  th: ({ children }: { children?: React.ReactNode }) => (
    <th className="px-3 py-2 text-left font-semibold text-foreground/80 whitespace-nowrap">
      {children}
    </th>
  ),
  td: ({ children }: { children?: React.ReactNode }) => (
    <td className="px-3 py-2 text-foreground/70 align-top">{children}</td>
  ),

  // Headings - strip the ## prefix since the card already has a header
  h1: ({ children }: { children?: React.ReactNode }) => (
    <h3 className="text-sm font-bold text-foreground mt-4 mb-1.5 first:mt-0">{children}</h3>
  ),
  h2: ({ children }: { children?: React.ReactNode }) => (
    <h3 className="text-sm font-bold text-foreground mt-4 mb-1.5 first:mt-0">{children}</h3>
  ),
  h3: ({ children }: { children?: React.ReactNode }) => (
    <h4 className="text-xs font-semibold text-foreground/90 mt-3 mb-1 first:mt-0 uppercase tracking-wide">{children}</h4>
  ),

  // Paragraphs
  p: ({ children }: { children?: React.ReactNode }) => (
    <p className="text-sm text-foreground/80 leading-relaxed mb-2 last:mb-0">{children}</p>
  ),

  // Lists
  ul: ({ children }: { children?: React.ReactNode }) => (
    <ul className="my-2 space-y-1">{children}</ul>
  ),
  ol: ({ children }: { children?: React.ReactNode }) => (
    <ol className="my-2 space-y-1 list-decimal list-inside">{children}</ol>
  ),
  li: ({ children }: { children?: React.ReactNode }) => (
    <li className="flex items-start gap-2 text-sm text-foreground/80 leading-relaxed">
      <span className="text-primary/60 mt-1 shrink-0 text-[10px]">▸</span>
      <span>{children}</span>
    </li>
  ),

  // Inline
  strong: ({ children }: { children?: React.ReactNode }) => (
    <strong className="font-semibold text-foreground">{children}</strong>
  ),
  em: ({ children }: { children?: React.ReactNode }) => (
    <em className="italic text-foreground/70">{children}</em>
  ),
  code: ({ children }: { children?: React.ReactNode }) => (
    <code className="px-1 py-0.5 rounded bg-muted text-xs font-mono text-foreground/80">{children}</code>
  ),

  // Blockquote - used for callouts
  blockquote: ({ children }: { children?: React.ReactNode }) => (
    <blockquote className="my-3 pl-3 border-l-2 border-primary/40 text-sm text-foreground/70 italic">
      {children}
    </blockquote>
  ),

  // HR
  hr: () => <hr className="my-4 border-border/40" />,
}

// ---------------------------------------------------------------------------
// Collapsible section card
// ---------------------------------------------------------------------------

function SectionCard({ section, defaultOpen }: { section: StrategySection; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen ?? false)
  const [copied, setCopied] = useState(false)
  const meta = getSectionMeta(section.heading)

  // Strip leading emoji from heading (we re-render it from meta)
  // Strip leading emoji / whitespace (any non-letter, non-digit chars at start)
  const cleanHeading = section.heading.replace(/^[^a-zA-Z0-9]+/, '').trim()

  function handleCopy() {
    navigator.clipboard.writeText(section.content)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className={`rounded-xl border overflow-hidden transition-all ${open ? meta.accent : 'border-border/60'}`}>
      {/* Header */}
      <button
        onClick={() => setOpen((v) => !v)}
        className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors ${open ? `${meta.bg}` : 'hover:bg-muted/30'}`}
      >
        <span className="text-base leading-none shrink-0">{meta.icon}</span>
        <span className="flex-1 text-sm font-semibold text-foreground">{cleanHeading}</span>
        <div className="flex items-center gap-2 shrink-0">
          {open && (
            <button
              onClick={(e) => { e.stopPropagation(); handleCopy() }}
              className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors px-2 py-0.5 rounded-md hover:bg-muted"
            >
              {copied
                ? <><Check className="w-3 h-3 text-emerald-500" /><span className="text-emerald-500">Copied</span></>
                : <><Copy className="w-3 h-3" /><span>Copy</span></>
              }
            </button>
          )}
          {open
            ? <ChevronUp className="w-4 h-4 text-muted-foreground" />
            : <ChevronDown className="w-4 h-4 text-muted-foreground" />
          }
        </div>
      </button>

      {/* Content */}
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-5 pt-3 pb-5 border-t border-border/40">
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents as never}>
                {section.content}
              </ReactMarkdown>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Streaming preview
// ---------------------------------------------------------------------------

export function StrategyStreamPreview({ markdown }: { markdown: string }) {
  // Count how many ## sections have started to show progress
  const sectionCount = (markdown.match(/^## /gm) ?? []).length

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-xl border border-primary/20 bg-card w-full overflow-hidden"
    >
      {/* Animated header */}
      <div className="flex items-center gap-2.5 px-5 py-3 border-b border-border/50 bg-primary/5">
        <motion.div
          animate={{ opacity: [0.4, 1, 0.4] }}
          transition={{ duration: 1.5, repeat: Infinity }}
        >
          <Sparkles className="w-4 h-4 text-primary" />
        </motion.div>
        <span className="text-sm font-medium text-foreground">Building your strategy</span>
        {sectionCount > 0 && (
          <span className="ml-auto text-xs text-muted-foreground">
            {sectionCount} section{sectionCount > 1 ? 's' : ''} written
          </span>
        )}
      </div>

      {/* Live markdown preview */}
      <div className="px-5 py-4 max-h-80 overflow-y-auto">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents as never}>
          {markdown}
        </ReactMarkdown>
      </div>
    </motion.div>
  )
}

// ---------------------------------------------------------------------------
// Full saved strategy document
// ---------------------------------------------------------------------------

const FUNNEL_LABELS: Record<string, string> = {
  tofu:      'Top of Funnel',
  mofu:      'Mid Funnel',
  bofu:      'Bottom of Funnel',
  full:      'Full Funnel',
  retention: 'Retention',
}

interface StrategyDocumentProps {
  strategy: MarketingStrategy
}

export function StrategyDocument({ strategy }: StrategyDocumentProps) {
  const [allCopied, setAllCopied] = useState(false)
  const sections = strategy.sections?.length ? strategy.sections : []
  const funnelLabel = FUNNEL_LABELS[strategy.funnelType] ?? strategy.funnelType

  function handleExport() {
    const blob = new Blob([strategy.fullMarkdown], { type: 'text/markdown' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `${strategy.title.replace(/[^a-z0-9]/gi, '_')}.md`
    a.click()
    URL.revokeObjectURL(url)
  }

  function copyAll() {
    navigator.clipboard.writeText(strategy.fullMarkdown)
    setAllCopied(true)
    setTimeout(() => setAllCopied(false), 1500)
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="rounded-2xl border border-border bg-card w-full overflow-hidden shadow-sm"
    >
      {/* ── Document header ────────────────────────────────────────────────── */}
      <div className="px-5 py-4 border-b border-border bg-gradient-to-r from-primary/5 via-transparent to-transparent">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            {/* Meta badges */}
            <div className="flex items-center gap-2 mb-1.5 flex-wrap">
              <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
                ⚡ Strategy v{strategy.version}
              </span>
              <span className="text-[11px] text-muted-foreground px-2 py-0.5 rounded-full bg-muted border border-border/60">
                {funnelLabel}
              </span>
              <span className="text-[11px] text-muted-foreground">
                {sections.length} sections
              </span>
            </div>

            {/* Title */}
            <h3 className="text-base font-bold text-foreground leading-tight truncate">
              {strategy.title}
            </h3>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={copyAll}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted transition-all border border-transparent hover:border-border/60"
            >
              {allCopied
                ? <><Check className="w-3 h-3 text-emerald-500" /><span className="text-emerald-500">Copied</span></>
                : <><Copy className="w-3 h-3" />Copy all</>
              }
            </button>
            <button
              onClick={handleExport}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted transition-all border border-transparent hover:border-border/60"
            >
              <FileDown className="w-3 h-3" />
              Export
            </button>
          </div>
        </div>
      </div>

      {/* ── Sections ───────────────────────────────────────────────────────── */}
      <div className="p-4 space-y-2">
        {sections.map((section, i) => (
          <SectionCard
            key={section.heading}
            section={section}
            defaultOpen={i === 0}
          />
        ))}

        {/* Fallback: no parsed sections */}
        {sections.length === 0 && (
          <div className="px-2 py-1">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents as never}>
              {strategy.fullMarkdown}
            </ReactMarkdown>
          </div>
        )}
      </div>
    </motion.div>
  )
}
