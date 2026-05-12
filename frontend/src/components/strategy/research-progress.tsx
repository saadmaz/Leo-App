'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Check, ChevronDown, ChevronUp, Globe, Loader2, Minus, Search } from 'lucide-react'
import type { ResearchSearch, ResearchStep } from '@/types'

// ---------------------------------------------------------------------------
// Helper - derive a display hostname from a URL or query string
// ---------------------------------------------------------------------------

function toHostname(urlOrQuery: string): string {
  try {
    return new URL(urlOrQuery).hostname.replace(/^www\./, '')
  } catch {
    return urlOrQuery.length > 40 ? urlOrQuery.slice(0, 40) + '…' : urlOrQuery
  }
}

function getFaviconUrl(urlOrQuery: string): string {
  try {
    const host = new URL(urlOrQuery).hostname
    return `https://www.google.com/s2/favicons?domain=${host}&sz=16`
  } catch {
    return ''
  }
}

// ---------------------------------------------------------------------------
// "Searched the web" collapsible card (mirrors the screenshot UI)
// ---------------------------------------------------------------------------

interface SearchCardProps {
  search: ResearchSearch
  index: number
}

function SearchCard({ search, index }: SearchCardProps) {
  const [open, setOpen] = useState(false)
  const isSearching = search.status === 'searching'

  const hasResults = search.results.length > 0

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.08 }}
      className="rounded-xl border border-border/60 bg-card overflow-hidden"
    >
      {/* Header row - always visible */}
      <button
        onClick={() => hasResults && setOpen((v) => !v)}
        className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left hover:bg-muted/30 transition-colors"
        disabled={!hasResults}
      >
        {/* Globe icon */}
        <div className="w-5 h-5 rounded-full bg-muted flex items-center justify-center shrink-0">
          <Globe className="w-3 h-3 text-muted-foreground" />
        </div>

        {/* Engine label */}
        <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide shrink-0">
          {search.engine}
        </span>

        {/* Query text */}
        <span className="text-xs text-foreground flex-1 truncate">
          {search.query}
        </span>

        {/* Right side: spinner / count / chevron */}
        <div className="flex items-center gap-1.5 shrink-0">
          {isSearching ? (
            <Loader2 className="w-3 h-3 text-primary animate-spin" />
          ) : (
            <>
              {search.result_count > 0 && (
                <span className="text-[11px] text-muted-foreground">
                  {search.result_count} {search.result_count === 1 ? 'result' : 'results'}
                </span>
              )}
              {hasResults && (
                open
                  ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" />
                  : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
              )}
            </>
          )}
        </div>
      </button>

      {/* Expandable results list */}
      <AnimatePresence initial={false}>
        {open && hasResults && (
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: 'auto' }}
            exit={{ height: 0 }}
            className="overflow-hidden border-t border-border/40"
          >
            <div className="px-3.5 py-2 space-y-1.5">
              {search.results.map((result, i) => {
                const isUrl = result.startsWith('http')
                const favicon = isUrl ? getFaviconUrl(result) : ''
                const label = isUrl ? toHostname(result) : result
                return (
                  <div key={i} className="flex items-center gap-2">
                    {favicon ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img src={favicon} alt="" width={12} height={12} className="rounded-sm shrink-0" />
                    ) : (
                      <div className="w-3 h-3 rounded-sm bg-muted shrink-0" />
                    )}
                    {isUrl ? (
                      <a
                        href={result}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-muted-foreground hover:text-foreground transition-colors truncate"
                      >
                        {label}
                      </a>
                    ) : (
                      <span className="text-xs text-muted-foreground truncate">{label}</span>
                    )}
                  </div>
                )
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

// ---------------------------------------------------------------------------
// Step row (the existing progress steps)
// ---------------------------------------------------------------------------

function StepRow({ step }: { step: ResearchStep }) {
  return (
    <div className="flex items-center gap-2.5">
      <StatusIcon status={step.status} />
      <span
        className={`text-xs ${
          step.status === 'done'     ? 'text-foreground' :
          step.status === 'running'  ? 'text-foreground font-medium' :
                                       'text-muted-foreground'
        }`}
      >
        {step.label}
      </span>
    </div>
  )
}

function StatusIcon({ status }: { status: ResearchStep['status'] }) {
  if (status === 'done') {
    return (
      <span className="w-4 h-4 rounded-full bg-emerald-500/15 flex items-center justify-center shrink-0">
        <Check className="w-2.5 h-2.5 text-emerald-500" />
      </span>
    )
  }
  if (status === 'running') {
    return (
      <span className="w-4 h-4 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
        <Loader2 className="w-2.5 h-2.5 text-primary animate-spin" />
      </span>
    )
  }
  return (
    <span className="w-4 h-4 rounded-full bg-muted flex items-center justify-center shrink-0">
      <Minus className="w-2.5 h-2.5 text-muted-foreground" />
    </span>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface ResearchProgressProps {
  steps: ResearchStep[]
  searches: ResearchSearch[]
}

export function ResearchProgress({ steps, searches }: ResearchProgressProps) {
  const totalDone  = steps.filter((s) => s.status === 'done').length
  const totalSteps = Math.max(steps.length, 4)   // 4 expected phases

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-3 w-full max-w-lg"
    >
      {/* ── "Searching the web" header card ─────────────────────────────── */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/50">
          <div className="flex items-center gap-2">
            <Search className="w-3.5 h-3.5 text-primary" />
            <span className="text-sm font-semibold text-foreground">Searching the web</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-muted-foreground">~20–30 seconds</span>
            {totalDone < totalSteps && (
              <Loader2 className="w-3 h-3 text-primary animate-spin" />
            )}
          </div>
        </div>

        {/* Search cards */}
        {searches.length > 0 && (
          <div className="p-3 space-y-2">
            <AnimatePresence initial={false}>
              {searches.map((s, i) => (
                <SearchCard key={`${s.source}-${i}`} search={s} index={i} />
              ))}
            </AnimatePresence>
          </div>
        )}

        {searches.length === 0 && (
          <div className="flex items-center gap-2 px-4 py-3 text-xs text-muted-foreground">
            <Loader2 className="w-3 h-3 animate-spin" />
            Starting research…
          </div>
        )}
      </div>

      {/* ── Step-by-step progress list ───────────────────────────────────── */}
      {steps.length > 0 && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="rounded-xl border border-border bg-card px-4 py-3 space-y-2.5"
        >
          <AnimatePresence initial={false}>
            {steps.map((s, i) => (
              <motion.div
                key={s.step}
                initial={{ opacity: 0, x: -4 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.04 }}
              >
                <StepRow step={s} />
              </motion.div>
            ))}
          </AnimatePresence>
        </motion.div>
      )}
    </motion.div>
  )
}
