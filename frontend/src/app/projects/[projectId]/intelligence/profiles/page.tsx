'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import {
  Crosshair, Plus, Trash2, RefreshCw, ExternalLink, X, Globe, Users,
  Building2, DollarSign, Target, TrendingUp,
  Flame, Zap, Star, MapPin, ChevronRight, Loader2,
  AlertTriangle, CheckCircle2, Clock, Search, Sparkles, BarChart2,
  Info, LayoutGrid, List, SlidersHorizontal, ChevronDown,
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { api } from '@/lib/api'
import { SidebarToggle } from '@/components/layout/sidebar'
import { BackButton } from '@/components/layout/back-button'
import type {
  CompetitorProfile,
  GeographicScope,
  SizeTier,
  Directness,
  MarketPosition,
  OverlapScore,
  ConfidenceScore,
  ClassifyStreamEvent,
} from '@/types'

// ---------------------------------------------------------------------------
// Config maps
// ---------------------------------------------------------------------------

const GEO_CONFIG: Record<GeographicScope, { label: string; color: string; icon: React.ReactNode }> = {
  'Local':    { label: 'Local',    color: 'text-slate-600 bg-slate-500/10 border-slate-500/20',      icon: <MapPin className="w-3 h-3" /> },
  'Regional': { label: 'Regional', color: 'text-blue-600 bg-blue-500/10 border-blue-500/20',          icon: <MapPin className="w-3 h-3" /> },
  'National': { label: 'National', color: 'text-violet-600 bg-violet-500/10 border-violet-500/20',    icon: <Globe className="w-3 h-3" /> },
  'Global':   { label: 'Global',   color: 'text-emerald-600 bg-emerald-500/10 border-emerald-500/20', icon: <Globe className="w-3 h-3" /> },
}

const SIZE_CONFIG: Record<SizeTier, { label: string; color: string; icon: React.ReactNode }> = {
  'Micro':       { label: 'Micro',       color: 'text-slate-600 bg-slate-500/10 border-slate-500/20',     icon: <Users className="w-3 h-3" /> },
  'SMB':         { label: 'SMB',         color: 'text-blue-600 bg-blue-500/10 border-blue-500/20',         icon: <Building2 className="w-3 h-3" /> },
  'Mid-Market':  { label: 'Mid-Market',  color: 'text-amber-600 bg-amber-500/10 border-amber-500/20',      icon: <Building2 className="w-3 h-3" /> },
  'Enterprise':  { label: 'Enterprise',  color: 'text-red-600 bg-red-500/10 border-red-500/20',            icon: <Building2 className="w-3 h-3" /> },
}

const DIRECTNESS_CONFIG: Record<Directness, { label: string; color: string; icon: React.ReactNode; bg: string }> = {
  'Direct':     { label: 'Direct',     color: 'text-red-600',    bg: 'bg-red-500/10 border-red-500/20',      icon: <Flame className="w-3 h-3" /> },
  'Indirect':   { label: 'Indirect',   color: 'text-amber-600',  bg: 'bg-amber-500/10 border-amber-500/20',  icon: <AlertTriangle className="w-3 h-3" /> },
  'Substitute': { label: 'Substitute', color: 'text-blue-600',   bg: 'bg-blue-500/10 border-blue-500/20',    icon: <Zap className="w-3 h-3" /> },
}

const POSITION_CONFIG: Record<MarketPosition, { label: string; color: string; bg: string; icon: React.ReactNode }> = {
  'Market Leader': { label: 'Market Leader', color: 'text-amber-600',   bg: 'bg-amber-500/10 border-amber-500/20',   icon: <Star className="w-3 h-3" /> },
  'Challenger':    { label: 'Challenger',    color: 'text-red-600',     bg: 'bg-red-500/10 border-red-500/20',       icon: <TrendingUp className="w-3 h-3" /> },
  'Niche Player':  { label: 'Niche Player',  color: 'text-violet-600',  bg: 'bg-violet-500/10 border-violet-500/20', icon: <Target className="w-3 h-3" /> },
  'New Entrant':   { label: 'New Entrant',   color: 'text-emerald-600', bg: 'bg-emerald-500/10 border-emerald-500/20', icon: <Sparkles className="w-3 h-3" /> },
}

const OVERLAP_COLOR: Record<OverlapScore, string> = {
  'Low':    'text-emerald-600 bg-emerald-500/10',
  'Medium': 'text-amber-600 bg-amber-500/10',
  'High':   'text-red-600 bg-red-500/10',
}

const CONFIDENCE_COLOR: Record<ConfidenceScore, { dot: string; label: string }> = {
  'Low':    { dot: 'bg-red-500',     label: 'Low confidence' },
  'Medium': { dot: 'bg-amber-500',   label: 'Medium confidence' },
  'High':   { dot: 'bg-emerald-500', label: 'High confidence' },
}

const STEP_MESSAGES: Record<string, string> = {
  start:       'Initialising analysis',
  gathering:   'Searching web sources',
  scraping:    'Scraping company data',
  classifying: 'Running AI classification',
  saving:      'Saving profile',
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function DimensionBadge({ label, colorClass, icon }: { label: string; colorClass: string; icon: React.ReactNode }) {
  return (
    <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border', colorClass)}>
      {icon}
      {label}
    </span>
  )
}

function AnalyzingCard({ name }: { name: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.97 }}
      className="rounded-2xl border border-border bg-card overflow-hidden"
    >
      <div className="p-5">
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="h-5 w-32 bg-muted rounded animate-pulse mb-1" />
            <div className="h-3 w-20 bg-muted/60 rounded animate-pulse" />
          </div>
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary/10 border border-primary/20">
            <Loader2 className="w-3 h-3 text-primary animate-spin" />
            <span className="text-[11px] text-primary font-medium">Analyzing</span>
          </div>
        </div>
        <p className="text-sm text-muted-foreground mb-4">Classifying <span className="font-medium text-foreground">{name}</span> across 5 dimensions…</p>
        <div className="space-y-2">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="h-7 rounded-lg bg-muted/50 animate-pulse" style={{ animationDelay: `${i * 100}ms` }} />
          ))}
        </div>
      </div>
    </motion.div>
  )
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col items-center justify-center py-24 text-center"
    >
      <div className="w-16 h-16 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center mb-5">
        <Crosshair className="w-7 h-7 text-primary" />
      </div>
      <h3 className="text-base font-semibold mb-1.5">No competitor profiles yet</h3>
      <p className="text-sm text-muted-foreground max-w-xs mb-6">
        Add a competitor and Leo will automatically classify them across 5 strategic dimensions using live web data.
      </p>
      <button
        onClick={onAdd}
        className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
      >
        <Plus className="w-4 h-4" />
        Add First Competitor
      </button>
    </motion.div>
  )
}

// ---------------------------------------------------------------------------
// Profile Card
// ---------------------------------------------------------------------------

function ProfileCard({
  profile,
  onSelect,
  onDelete,
  onRefresh,
  onDeepDive,
  deleting,
  refreshing,
}: {
  profile: CompetitorProfile
  onSelect: () => void
  onDelete: () => void
  onRefresh: () => void
  onDeepDive: () => void
  deleting: boolean
  refreshing: boolean
}) {
  const isComplete = profile.status === 'complete'
  const isError = profile.status === 'error'

  const geo       = profile.geographic_scope  ? GEO_CONFIG[profile.geographic_scope]       : null
  const size      = profile.size_tier          ? SIZE_CONFIG[profile.size_tier]              : null
  const direct    = profile.directness         ? DIRECTNESS_CONFIG[profile.directness]       : null
  const position  = profile.market_position    ? POSITION_CONFIG[profile.market_position]    : null
  const confidence = profile.confidence_score  ? CONFIDENCE_COLOR[profile.confidence_score]  : null

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      className={cn(
        'group rounded-2xl border bg-card overflow-hidden transition-all duration-200',
        isComplete ? 'border-border hover:border-primary/30 hover:shadow-md cursor-pointer' : 'border-border',
        isError && 'border-red-500/30',
      )}
      onClick={isComplete ? onSelect : undefined}
    >
      {/* Header */}
      <div className="p-5 pb-4">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold text-sm text-foreground truncate leading-tight">
              {profile.competitor_name}
            </h3>
            {profile.website && (
              <a
                href={profile.website.startsWith('http') ? profile.website : `https://${profile.website}`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={e => e.stopPropagation()}
                className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-primary transition-colors mt-0.5"
              >
                <Globe className="w-2.5 h-2.5" />
                {profile.website.replace(/^https?:\/\//, '').replace(/\/$/, '')}
                <ExternalLink className="w-2.5 h-2.5" />
              </a>
            )}
          </div>
          {/* Confidence + actions */}
          <div className="flex items-center gap-1.5 shrink-0" onClick={e => e.stopPropagation()}>
            {confidence && isComplete && (
              <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-muted/60 text-[10px] text-muted-foreground">
                <span className={cn('w-1.5 h-1.5 rounded-full', confidence.dot)} />
                {confidence.label}
              </div>
            )}
            <button
              onClick={onRefresh}
              disabled={refreshing || deleting}
              title="Re-classify"
              className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors opacity-0 group-hover:opacity-100"
            >
              {refreshing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            </button>
            <button
              onClick={onDelete}
              disabled={deleting || refreshing}
              title="Delete"
              className="p-1.5 rounded-lg hover:bg-red-500/10 text-muted-foreground hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"
            >
              {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>

        {isError && (
          <div className="flex items-center gap-2 text-xs text-red-500 bg-red-500/10 rounded-lg px-3 py-2">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            Classification failed - click refresh to retry
          </div>
        )}

        {isComplete && (
          <>
            {/* 5 Dimension badges */}
            <div className="space-y-2">
              {/* Row 1: Geo + Size */}
              <div className="flex flex-wrap gap-1.5">
                {geo && (
                  <DimensionBadge label={geo.label} colorClass={geo.color} icon={geo.icon} />
                )}
                {size && (
                  <DimensionBadge label={size.label} colorClass={size.color} icon={size.icon} />
                )}
              </div>

              {/* Row 2: Directness + Overlap */}
              {direct && (
                <div className="flex items-center gap-1.5">
                  <DimensionBadge label={direct.label} colorClass={cn(direct.color, direct.bg)} icon={direct.icon} />
                  {profile.overlap_score && (
                    <span className={cn('px-2 py-0.5 rounded-full text-[10px] font-medium', OVERLAP_COLOR[profile.overlap_score])}>
                      {profile.overlap_score} overlap
                    </span>
                  )}
                </div>
              )}

              {/* Row 3: Market Position */}
              {position && (
                <DimensionBadge label={position.label} colorClass={cn(position.color, position.bg)} icon={position.icon} />
              )}

              {/* Row 4: Segment tags */}
              {profile.customer_segment_tags && profile.customer_segment_tags.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {profile.customer_segment_tags.slice(0, 4).map(tag => (
                    <span key={tag} className="px-1.5 py-0.5 rounded-md bg-muted text-[10px] text-muted-foreground font-medium">
                      {tag}
                    </span>
                  ))}
                  {profile.customer_segment_tags.length > 4 && (
                    <span className="px-1.5 py-0.5 rounded-md bg-muted text-[10px] text-muted-foreground">
                      +{profile.customer_segment_tags.length - 4}
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Action row */}
            <div className="flex items-center justify-between mt-3 opacity-0 group-hover:opacity-100 transition-opacity">
              <span className="text-[11px] text-primary flex items-center gap-0.5">
                View profile <ChevronRight className="w-3 h-3" />
              </span>
              <button
                onClick={e => { e.stopPropagation(); onDeepDive() }}
                className="text-[11px] text-violet-400 hover:text-violet-300 flex items-center gap-0.5 transition-colors"
              >
                <Zap className="w-3 h-3" /> Deep Dive
              </button>
            </div>
          </>
        )}
      </div>

      {/* Footer */}
      {isComplete && profile.last_updated && (
        <div className="px-5 py-2.5 border-t border-border/50 bg-muted/20">
          <span className="text-[10px] text-muted-foreground flex items-center gap-1">
            <Clock className="w-2.5 h-2.5" />
            Updated {new Date(profile.last_updated).toLocaleDateString()}
          </span>
        </div>
      )}
    </motion.div>
  )
}

// ---------------------------------------------------------------------------
// Detail Panel
// ---------------------------------------------------------------------------

function DetailPanel({
  profile,
  onClose,
  onDeepDive,
}: {
  profile: CompetitorProfile
  onClose: () => void
  onDeepDive: () => void
}) {
  const geo      = profile.geographic_scope ? GEO_CONFIG[profile.geographic_scope]     : null
  const size     = profile.size_tier        ? SIZE_CONFIG[profile.size_tier]            : null
  const direct   = profile.directness       ? DIRECTNESS_CONFIG[profile.directness]     : null
  const position = profile.market_position  ? POSITION_CONFIG[profile.market_position]  : null

  const Section = ({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) => (
    <div className="border border-border rounded-2xl overflow-hidden">
      <div className="flex items-center gap-2.5 px-4 py-3 bg-muted/30 border-b border-border">
        <span className="text-primary">{icon}</span>
        <span className="text-sm font-semibold">{title}</span>
      </div>
      <div className="p-4">{children}</div>
    </div>
  )

  const EvidenceNote = ({ text }: { text: string }) => (
    <p className="text-xs text-muted-foreground bg-muted/40 rounded-lg px-3 py-2 mt-2 leading-relaxed">{text}</p>
  )

  return (
    <motion.div
      initial={{ opacity: 0, x: 32 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 32 }}
      transition={{ duration: 0.25 }}
      className="fixed right-0 top-0 h-full w-full max-w-md bg-background border-l border-border shadow-2xl z-50 flex flex-col overflow-hidden"
    >
      {/* Panel Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
        <div>
          <h2 className="font-semibold text-base">{profile.competitor_name}</h2>
          {profile.website && (
            <a
              href={profile.website.startsWith('http') ? profile.website : `https://${profile.website}`}
              target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors"
            >
              <Globe className="w-3 h-3" />
              {profile.website.replace(/^https?:\/\//, '').replace(/\/$/, '')}
              <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onDeepDive}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-violet-500/10 text-violet-400 hover:bg-violet-500/20 text-xs font-medium transition-colors border border-violet-500/20"
          >
            <Zap className="w-3.5 h-3.5" />
            Deep Dive
          </button>
          <button
            onClick={onClose}
            className="p-2 rounded-xl hover:bg-muted transition-colors text-muted-foreground"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">

        {/* Executive Summary */}
        {profile.executive_summary && (
          <div className="p-4 rounded-2xl bg-primary/5 border border-primary/20">
            <p className="text-sm text-foreground leading-relaxed">{profile.executive_summary}</p>
          </div>
        )}

        {/* Confidence */}
        {profile.confidence_score && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Analysis confidence:</span>
            <span className={cn(
              'inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full',
              profile.confidence_score === 'High'   && 'bg-emerald-500/10 text-emerald-600',
              profile.confidence_score === 'Medium' && 'bg-amber-500/10 text-amber-600',
              profile.confidence_score === 'Low'    && 'bg-red-500/10 text-red-600',
            )}>
              <span className={cn(
                'w-1.5 h-1.5 rounded-full',
                profile.confidence_score === 'High'   && 'bg-emerald-500',
                profile.confidence_score === 'Medium' && 'bg-amber-500',
                profile.confidence_score === 'Low'    && 'bg-red-500',
              )} />
              {profile.confidence_score} confidence
            </span>
          </div>
        )}

        {/* Dimension 1: Geographic Scope */}
        <Section title="Geographic Scope" icon={<Globe className="w-4 h-4" />}>
          {geo && (
            <DimensionBadge label={geo.label} colorClass={geo.color} icon={geo.icon} />
          )}
          {profile.geographic_locations && profile.geographic_locations.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {profile.geographic_locations.map(loc => (
                <span key={loc} className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-lg bg-muted text-muted-foreground">
                  <MapPin className="w-2.5 h-2.5" /> {loc}
                </span>
              ))}
            </div>
          )}
          {profile.geographic_evidence && <EvidenceNote text={profile.geographic_evidence} />}
        </Section>

        {/* Dimension 2: Size & Revenue */}
        <Section title="Size & Revenue" icon={<Building2 className="w-4 h-4" />}>
          {size && (
            <DimensionBadge label={size.label} colorClass={size.color} icon={size.icon} />
          )}
          <div className="mt-3 grid grid-cols-2 gap-2">
            {profile.employee_count && (
              <div className="rounded-xl bg-muted/40 px-3 py-2.5">
                <div className="flex items-center gap-1.5 mb-0.5">
                  <Users className="w-3 h-3 text-muted-foreground" />
                  <span className="text-[10px] text-muted-foreground uppercase tracking-wide">Employees</span>
                </div>
                <span className="text-sm font-semibold">{profile.employee_count}</span>
              </div>
            )}
            {profile.revenue_range && (
              <div className="rounded-xl bg-muted/40 px-3 py-2.5">
                <div className="flex items-center gap-1.5 mb-0.5">
                  <DollarSign className="w-3 h-3 text-muted-foreground" />
                  <span className="text-[10px] text-muted-foreground uppercase tracking-wide">Revenue</span>
                </div>
                <span className="text-sm font-semibold">{profile.revenue_range}</span>
              </div>
            )}
          </div>
          {profile.size_evidence && <EvidenceNote text={profile.size_evidence} />}
        </Section>

        {/* Dimension 3: Directness */}
        <Section title="Directness of Competition" icon={<Target className="w-4 h-4" />}>
          <div className="flex items-center gap-2 flex-wrap">
            {direct && (
              <DimensionBadge label={direct.label} colorClass={cn(direct.color, direct.bg)} icon={direct.icon} />
            )}
            {profile.overlap_score && (
              <span className={cn('px-2.5 py-0.5 rounded-full text-xs font-medium', OVERLAP_COLOR[profile.overlap_score])}>
                {profile.overlap_score} overlap
              </span>
            )}
          </div>
          {profile.directness_reason && <EvidenceNote text={profile.directness_reason} />}
        </Section>

        {/* Dimension 4: Market Position */}
        <Section title="Market Position" icon={<BarChart2 className="w-4 h-4" />}>
          {position && (
            <DimensionBadge label={position.label} colorClass={cn(position.color, position.bg)} icon={position.icon} />
          )}
          {profile.market_position_signals && profile.market_position_signals.length > 0 && (
            <ul className="mt-3 space-y-1.5">
              {profile.market_position_signals.map((sig, i) => (
                <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                  <CheckCircle2 className="w-3 h-3 text-primary shrink-0 mt-0.5" />
                  {sig}
                </li>
              ))}
            </ul>
          )}
        </Section>

        {/* Dimension 5: Customer Segment */}
        <Section title="Customer Segment" icon={<Users className="w-4 h-4" />}>
          {profile.customer_segment_tags && profile.customer_segment_tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {profile.customer_segment_tags.map(tag => (
                <span key={tag} className="px-2.5 py-1 rounded-xl bg-muted text-xs font-medium text-foreground">
                  {tag}
                </span>
              ))}
            </div>
          )}
          {profile.segment_evidence && <EvidenceNote text={profile.segment_evidence} />}
        </Section>

        {/* Sources */}
        {profile.sources_used && profile.sources_used.length > 0 && (
          <div>
            <p className="text-[11px] text-muted-foreground mb-2 flex items-center gap-1">
              <Info className="w-3 h-3" /> Sources used
            </p>
            <div className="space-y-1">
              {profile.sources_used.map((src, i) => (
                <p key={i} className="text-[11px] text-muted-foreground truncate px-2 py-1 bg-muted/30 rounded-lg">
                  {src}
                </p>
              ))}
            </div>
          </div>
        )}

        <div className="h-6" />
      </div>
    </motion.div>
  )
}

// ---------------------------------------------------------------------------
// Add Competitor Modal
// ---------------------------------------------------------------------------

function AddCompetitorModal({
  onClose,
  onSubmit,
  loading,
  stepMessage,
}: {
  onClose: () => void
  onSubmit: (name: string, website: string) => void
  loading: boolean
  stepMessage: string | null
}) {
  const [name, setName] = useState('')
  const [website, setWebsite] = useState('')

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    onSubmit(name.trim(), website.trim() || '')
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.96 }}
        className="bg-background rounded-2xl border border-border shadow-2xl w-full max-w-md overflow-hidden"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div>
            <h2 className="text-base font-semibold">Add Competitor</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Leo will automatically classify them across 5 dimensions</p>
          </div>
          <button
            onClick={onClose}
            disabled={loading}
            className="p-2 rounded-xl hover:bg-muted transition-colors text-muted-foreground disabled:opacity-50"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="text-xs font-medium text-foreground mb-1.5 block">
              Competitor name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. HubSpot, Salesforce, Notion…"
              disabled={loading}
              autoFocus
              className="w-full px-3.5 py-2.5 rounded-xl border border-border bg-muted/30 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/60 disabled:opacity-60 transition-colors"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-foreground mb-1.5 block">
              Website <span className="text-muted-foreground font-normal">(optional but improves accuracy)</span>
            </label>
            <input
              type="url"
              value={website}
              onChange={e => setWebsite(e.target.value)}
              placeholder="https://competitor.com"
              disabled={loading}
              className="w-full px-3.5 py-2.5 rounded-xl border border-border bg-muted/30 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/60 disabled:opacity-60 transition-colors"
            />
          </div>

          {/* 5 dimensions preview */}
          <div className="p-4 rounded-xl bg-muted/30 border border-border">
            <p className="text-[11px] text-muted-foreground font-medium mb-2.5 flex items-center gap-1.5">
              <Sparkles className="w-3 h-3 text-primary" />
              Leo will automatically classify
            </p>
            <div className="space-y-1.5">
              {[
                { icon: <Globe className="w-3 h-3" />,     label: 'Geographic scope' },
                { icon: <Building2 className="w-3 h-3" />, label: 'Company size & revenue' },
                { icon: <Target className="w-3 h-3" />,    label: 'Directness of competition' },
                { icon: <BarChart2 className="w-3 h-3" />, label: 'Market position' },
                { icon: <Users className="w-3 h-3" />,     label: 'Customer segment' },
              ].map(d => (
                <div key={d.label} className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="text-primary">{d.icon}</span>
                  {d.label}
                </div>
              ))}
            </div>
          </div>

          {/* Live step progress */}
          <AnimatePresence>
            {loading && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl bg-primary/5 border border-primary/20"
              >
                <Loader2 className="w-3.5 h-3.5 text-primary animate-spin shrink-0" />
                <span className="text-xs text-primary font-medium">
                  {stepMessage || 'Starting analysis…'}
                  <span className="inline-flex gap-0.5 ml-1">
                    {[0, 1, 2].map(i => (
                      <motion.span
                        key={i}
                        animate={{ opacity: [0, 1, 0] }}
                        transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2 }}
                      >·</motion.span>
                    ))}
                  </span>
                </span>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="flex-1 px-4 py-2.5 rounded-xl border border-border text-sm font-medium text-muted-foreground hover:bg-muted transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !name.trim()}
              className="flex-1 px-4 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Analyzing…
                </>
              ) : (
                <>
                  <Crosshair className="w-3.5 h-3.5" />
                  Classify Competitor
                </>
              )}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Classification group types
// ---------------------------------------------------------------------------

type GroupBy = 'geographic_scope' | 'size_tier' | 'directness' | 'market_position'

const GROUP_OPTIONS: { value: GroupBy; label: string; icon: React.ReactNode }[] = [
  { value: 'geographic_scope',  label: 'Geographic Reach',  icon: <Globe className="w-3.5 h-3.5" /> },
  { value: 'size_tier',         label: 'Revenue / Size',    icon: <DollarSign className="w-3.5 h-3.5" /> },
  { value: 'directness',        label: 'Threat Level',      icon: <Flame className="w-3.5 h-3.5" /> },
  { value: 'market_position',   label: 'Market Position',   icon: <TrendingUp className="w-3.5 h-3.5" /> },
]

const GROUP_BUCKETS: Record<GroupBy, { key: string; label: string; color: string; icon: React.ReactNode }[]> = {
  geographic_scope: [
    { key: 'Local',    label: 'Local',    color: 'text-slate-600 bg-slate-500/10 border-slate-500/20',      icon: <MapPin className="w-3 h-3" /> },
    { key: 'Regional', label: 'Regional', color: 'text-blue-600 bg-blue-500/10 border-blue-500/20',          icon: <MapPin className="w-3 h-3" /> },
    { key: 'National', label: 'National', color: 'text-violet-600 bg-violet-500/10 border-violet-500/20',    icon: <Globe className="w-3 h-3" /> },
    { key: 'Global',   label: 'Global',   color: 'text-emerald-600 bg-emerald-500/10 border-emerald-500/20', icon: <Globe className="w-3 h-3" /> },
  ],
  size_tier: [
    { key: 'Micro',      label: 'Micro (<10 employees)',         color: 'text-slate-600 bg-slate-500/10 border-slate-500/20',  icon: <Users className="w-3 h-3" /> },
    { key: 'SMB',        label: 'SMB (10–500 employees)',        color: 'text-blue-600 bg-blue-500/10 border-blue-500/20',     icon: <Building2 className="w-3 h-3" /> },
    { key: 'Mid-Market', label: 'Mid-Market (500–5k employees)', color: 'text-amber-600 bg-amber-500/10 border-amber-500/20',  icon: <Building2 className="w-3 h-3" /> },
    { key: 'Enterprise', label: 'Enterprise (5k+ employees)',    color: 'text-red-600 bg-red-500/10 border-red-500/20',        icon: <Building2 className="w-3 h-3" /> },
  ],
  directness: [
    { key: 'Direct',     label: 'Direct Competitors',   color: 'text-red-600 bg-red-500/10 border-red-500/20',      icon: <Flame className="w-3 h-3" /> },
    { key: 'Indirect',   label: 'Indirect Competitors', color: 'text-amber-600 bg-amber-500/10 border-amber-500/20', icon: <AlertTriangle className="w-3 h-3" /> },
    { key: 'Substitute', label: 'Substitutes',          color: 'text-blue-600 bg-blue-500/10 border-blue-500/20',   icon: <Zap className="w-3 h-3" /> },
  ],
  market_position: [
    { key: 'Market Leader', label: 'Market Leaders',  color: 'text-amber-600 bg-amber-500/10 border-amber-500/20',   icon: <Star className="w-3 h-3" /> },
    { key: 'Challenger',    label: 'Challengers',     color: 'text-red-600 bg-red-500/10 border-red-500/20',         icon: <TrendingUp className="w-3 h-3" /> },
    { key: 'Niche Player',  label: 'Niche Players',   color: 'text-violet-600 bg-violet-500/10 border-violet-500/20', icon: <Target className="w-3 h-3" /> },
    { key: 'New Entrant',   label: 'New Entrants',    color: 'text-emerald-600 bg-emerald-500/10 border-emerald-500/20', icon: <Sparkles className="w-3 h-3" /> },
  ],
}

function ClassificationView({
  profiles,
  groupBy,
  onSelectProfile,
  onDelete,
  onRefresh,
  onDeepDive,
  deletingIds,
  refreshingIds,
}: {
  profiles: CompetitorProfile[]
  groupBy: GroupBy
  onSelectProfile: (p: CompetitorProfile) => void
  onDelete: (p: CompetitorProfile) => void
  onRefresh: (p: CompetitorProfile) => void
  onDeepDive: (p: CompetitorProfile) => void
  deletingIds: Set<string>
  refreshingIds: Set<string>
}) {
  const complete = profiles.filter(p => p.status === 'complete')
  const buckets = GROUP_BUCKETS[groupBy]
  const unclassified = complete.filter(p => !p[groupBy])

  return (
    <div className="space-y-6">
      {buckets.map(bucket => {
        const members = complete.filter(p => p[groupBy] === bucket.key)
        if (members.length === 0) return null
        return (
          <div key={bucket.key}>
            {/* Bucket header */}
            <div className="flex items-center gap-2.5 mb-3">
              <span className={cn('inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border', bucket.color)}>
                {bucket.icon}
                {bucket.label}
              </span>
              <span className="text-xs text-muted-foreground">{members.length} {members.length === 1 ? 'competitor' : 'competitors'}</span>
              <div className="flex-1 h-px bg-border/60" />
            </div>
            {/* Compact rows */}
            <div className="space-y-2">
              {members.map(profile => {
                const geo      = profile.geographic_scope  ? GEO_CONFIG[profile.geographic_scope]      : null
                const size     = profile.size_tier          ? SIZE_CONFIG[profile.size_tier]             : null
                const direct   = profile.directness         ? DIRECTNESS_CONFIG[profile.directness]      : null
                const position = profile.market_position    ? POSITION_CONFIG[profile.market_position]   : null
                return (
                  <div
                    key={profile.id}
                    onClick={() => onSelectProfile(profile)}
                    className="group flex items-center gap-3 px-4 py-3 rounded-xl border border-border bg-card hover:border-primary/30 hover:shadow-sm cursor-pointer transition-all"
                  >
                    {/* Name + website */}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground truncate">{profile.competitor_name}</p>
                      {profile.website && (
                        <p className="text-[11px] text-muted-foreground truncate">
                          {profile.website.replace(/^https?:\/\//, '').replace(/\/$/, '')}
                        </p>
                      )}
                    </div>
                    {/* Dimension badges */}
                    <div className="hidden sm:flex items-center gap-1.5 flex-wrap justify-end">
                      {geo      && groupBy !== 'geographic_scope' && <DimensionBadge label={geo.label}      colorClass={geo.color}                        icon={geo.icon} />}
                      {size     && groupBy !== 'size_tier'         && <DimensionBadge label={size.label}     colorClass={size.color}                       icon={size.icon} />}
                      {direct   && groupBy !== 'directness'        && <DimensionBadge label={direct.label}   colorClass={cn(direct.color, direct.bg)}      icon={direct.icon} />}
                      {position && groupBy !== 'market_position'   && <DimensionBadge label={position.label} colorClass={cn(position.color, position.bg)}  icon={position.icon} />}
                      {profile.overlap_score && (
                        <span className={cn('px-2 py-0.5 rounded-full text-[10px] font-medium', OVERLAP_COLOR[profile.overlap_score])}>
                          {profile.overlap_score} overlap
                        </span>
                      )}
                    </div>
                    {/* Actions */}
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" onClick={e => e.stopPropagation()}>
                      <button
                        onClick={() => onDeepDive(profile)}
                        className="flex items-center gap-1 px-2 py-1 rounded-lg bg-violet-500/10 text-violet-400 hover:bg-violet-500/20 transition-colors text-[10px] font-medium"
                        title="Run 7-layer deep research"
                      >
                        <Zap className="w-3 h-3" /> Deep Dive
                      </button>
                      <button
                        onClick={() => onRefresh(profile)}
                        disabled={refreshingIds.has(profile.id) || deletingIds.has(profile.id)}
                        className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                        title="Re-classify"
                      >
                        {refreshingIds.has(profile.id) ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                      </button>
                      <button
                        onClick={() => onDelete(profile)}
                        disabled={deletingIds.has(profile.id) || refreshingIds.has(profile.id)}
                        className="p-1.5 rounded-lg hover:bg-red-500/10 text-muted-foreground hover:text-red-500 transition-colors"
                        title="Delete"
                      >
                        {deletingIds.has(profile.id) ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                    <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/40 group-hover:text-primary transition-colors shrink-0" />
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}

      {/* Unclassified */}
      {unclassified.length > 0 && (
        <div>
          <div className="flex items-center gap-2.5 mb-3">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border text-muted-foreground bg-muted/40 border-border">
              <AlertTriangle className="w-3 h-3" /> Unclassified
            </span>
            <span className="text-xs text-muted-foreground">{unclassified.length}</span>
            <div className="flex-1 h-px bg-border/60" />
          </div>
          <div className="space-y-2">
            {unclassified.map(p => (
              <div key={p.id} className="flex items-center gap-3 px-4 py-3 rounded-xl border border-dashed border-border bg-muted/10 text-sm text-muted-foreground">
                {p.competitor_name}
                <span className="ml-auto text-[11px]">pending classification</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function CompetitorProfilesPage() {
  const params = useParams<{ projectId: string }>()
  const router = useRouter()
  const [profiles, setProfiles] = useState<CompetitorProfile[]>([])
  const [loading, setLoading] = useState(true)
  const [showAddModal, setShowAddModal] = useState(false)
  const [classifying, setClassifying] = useState(false)
  const [classifyStep, setClassifyStep] = useState<string | null>(null)
  const [pendingProfile, setPendingProfile] = useState<{ name: string } | null>(null)
  const [selectedProfile, setSelectedProfile] = useState<CompetitorProfile | null>(null)
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set())
  const [refreshingIds, setRefreshingIds] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')
  const [viewMode, setViewMode] = useState<'grid' | 'classify'>('grid')
  const [groupBy, setGroupBy] = useState<GroupBy>('geographic_scope')
  const [showGroupMenu, setShowGroupMenu] = useState(false)

  const classifyControllerRef = useRef<AbortController | null>(null)

  // ---------------------------------------------------------------------------
  // Load
  // ---------------------------------------------------------------------------
  const loadProfiles = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.competitorProfiles.list(params.projectId)
      setProfiles(data.profiles ?? [])
    } catch {
      toast.error('Failed to load competitor profiles.')
    } finally {
      setLoading(false)
    }
  }, [params.projectId])

  useEffect(() => {
    if (params.projectId) loadProfiles()
  }, [params.projectId, loadProfiles])

  // Keep selected profile in sync with list updates
  useEffect(() => {
    if (selectedProfile) {
      const updated = profiles.find(p => p.id === selectedProfile.id)
      if (updated) setSelectedProfile(updated)
    }
  }, [profiles]) // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------------------
  // Classify
  // ---------------------------------------------------------------------------
  async function handleClassify(name: string, website: string) {
    setClassifying(true)
    setClassifyStep('Starting analysis')
    setPendingProfile({ name })

    const controller = new AbortController()
    classifyControllerRef.current = controller

    try {
      await new Promise<void>((resolve) => {
        api.competitorProfiles.classify(
          params.projectId,
          name,
          website || undefined,
          (event: ClassifyStreamEvent) => {
            if (event.type === 'step') {
              setClassifyStep(STEP_MESSAGES[event.step] ?? event.message)
            }
            if (event.type === 'complete') {
              setProfiles(prev => {
                const without = prev.filter(p => p.id !== event.profile.id)
                return [event.profile, ...without]
              })
              toast.success(`${name} classified successfully!`)
              setShowAddModal(false)
            }
            if (event.type === 'error') {
              toast.error(event.message ?? 'Classification failed.')
            }
          },
          () => resolve(),
          controller.signal,
        )
      })
    } catch {
      toast.error('Something went wrong.')
    } finally {
      setClassifying(false)
      setClassifyStep(null)
      setPendingProfile(null)
    }
  }

  // ---------------------------------------------------------------------------
  // Deep Dive - navigate to intelligence analysis tab with prefill
  // ---------------------------------------------------------------------------
  function handleDeepDive(profile: CompetitorProfile) {
    const qs = new URLSearchParams()
    qs.set('prefill', profile.competitor_name)
    if (profile.website) qs.set('website', profile.website)
    router.push(`/projects/${params.projectId}/intelligence?${qs.toString()}`)
  }

  // ---------------------------------------------------------------------------
  // Delete
  // ---------------------------------------------------------------------------
  async function handleDelete(profile: CompetitorProfile) {
    if (!profile.id) return
    setDeletingIds(prev => { const s = new Set(prev); s.add(profile.id); return s })
    try {
      await api.competitorProfiles.delete(params.projectId, profile.id)
      setProfiles(prev => prev.filter(p => p.id !== profile.id))
      if (selectedProfile?.id === profile.id) setSelectedProfile(null)
      toast.success(`${profile.competitor_name} removed.`)
    } catch {
      toast.error('Failed to delete profile.')
    } finally {
      setDeletingIds(prev => { const s = new Set(prev); s.delete(profile.id); return s })
    }
  }

  // ---------------------------------------------------------------------------
  // Refresh (re-classify)
  // ---------------------------------------------------------------------------
  async function handleRefresh(profile: CompetitorProfile) {
    if (!profile.id) return
    setRefreshingIds(prev => { const s = new Set(prev); s.add(profile.id); return s })

    // Optimistically mark as analyzing in the list
    setProfiles(prev => prev.map(p => p.id === profile.id ? { ...p, status: 'analyzing' } : p))

    try {
      await new Promise<void>((resolve) => {
        api.competitorProfiles.refresh(
          params.projectId,
          profile.id,
          (event: ClassifyStreamEvent) => {
            if (event.type === 'complete') {
              setProfiles(prev => prev.map(p => p.id === event.profile.id ? event.profile : p))
              if (selectedProfile?.id === event.profile.id) setSelectedProfile(event.profile)
              toast.success(`${profile.competitor_name} re-classified.`)
            }
            if (event.type === 'error') {
              toast.error(`Re-classification failed: ${event.message}`)
              setProfiles(prev => prev.map(p => p.id === profile.id ? { ...p, status: 'error' } : p))
            }
          },
          () => resolve(),
        )
      })
    } catch {
      toast.error('Re-classification failed.')
      setProfiles(prev => prev.map(p => p.id === profile.id ? { ...p, status: 'error' } : p))
    } finally {
      setRefreshingIds(prev => { const s = new Set(prev); s.delete(profile.id); return s })
    }
  }

  // ---------------------------------------------------------------------------
  // Filtered list
  // ---------------------------------------------------------------------------
  const filtered = profiles.filter(p =>
    !search || p.competitor_name.toLowerCase().includes(search.toLowerCase())
  )

  // Stats
  const complete = profiles.filter(p => p.status === 'complete')
  const directCount = complete.filter(p => p.directness === 'Direct').length
  const enterpriseCount = complete.filter(p => p.size_tier === 'Enterprise' || p.size_tier === 'Mid-Market').length

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className="flex h-full w-full overflow-hidden">
      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">

        {/* Header */}
        <div className="shrink-0 flex items-center gap-3 px-6 py-4 border-b border-border bg-background/80 backdrop-blur-sm">
          <SidebarToggle />
          <BackButton />
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
              <Crosshair className="w-4 h-4 text-primary" />
            </div>
            <div className="min-w-0">
              <h1 className="text-sm font-semibold leading-tight">Competitors</h1>
              <p className="text-[11px] text-muted-foreground leading-tight">5-dimension classification engine</p>
            </div>
          </div>
          {/* Section tabs */}
          <div className="hidden sm:flex items-center gap-0.5 rounded-lg border border-border p-0.5 bg-muted/40 ml-2">
            <button
              onClick={() => router.push(`/projects/${params.projectId}/intelligence`)}
              className="px-3 py-1 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              Analysis
            </button>
            <button className="px-3 py-1 rounded-md text-xs font-medium bg-background text-foreground shadow-sm">
              Profiles
            </button>
            <button
              onClick={() => router.push(`/projects/${params.projectId}/intelligence/monitoring`)}
              className="px-3 py-1 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              Monitoring
            </button>
          </div>
          <div className="flex-1" />
          {/* Stats strip */}
          {complete.length > 0 && (
            <div className="hidden md:flex items-center gap-4 pr-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                {complete.length} profiled
              </span>
              {directCount > 0 && (
                <span className="flex items-center gap-1">
                  <Flame className="w-3 h-3 text-red-500" />
                  {directCount} direct
                </span>
              )}
              {enterpriseCount > 0 && (
                <span className="flex items-center gap-1">
                  <Building2 className="w-3 h-3 text-amber-500" />
                  {enterpriseCount} enterprise+
                </span>
              )}
            </div>
          )}
          <button
            onClick={() => setShowAddModal(true)}
            disabled={classifying}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-60 transition-colors shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">Add Competitor</span>
          </button>
        </div>

        {/* Toolbar: search + view toggle + group selector */}
        {profiles.length > 0 && (
          <div className="shrink-0 px-6 py-3 border-b border-border/50 flex items-center gap-3 flex-wrap">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search competitors…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-9 pr-3 py-2 rounded-xl border border-border bg-muted/30 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 transition-colors w-48"
              />
            </div>

            <div className="flex-1" />

            {/* Group-by selector (only in classify mode) */}
            {viewMode === 'classify' && (
              <div className="relative">
                <button
                  onClick={() => setShowGroupMenu(v => !v)}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-border bg-muted/30 text-xs font-medium text-foreground hover:bg-muted transition-colors"
                >
                  <SlidersHorizontal className="w-3.5 h-3.5 text-muted-foreground" />
                  Group by: {GROUP_OPTIONS.find(o => o.value === groupBy)?.label}
                  <ChevronDown className="w-3 h-3 text-muted-foreground" />
                </button>
                <AnimatePresence>
                  {showGroupMenu && (
                    <motion.div
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      className="absolute right-0 top-full mt-1.5 z-20 bg-background border border-border rounded-xl shadow-xl overflow-hidden min-w-[180px]"
                    >
                      {GROUP_OPTIONS.map(opt => (
                        <button
                          key={opt.value}
                          onClick={() => { setGroupBy(opt.value); setShowGroupMenu(false) }}
                          className={cn(
                            'w-full flex items-center gap-2 px-4 py-2.5 text-sm hover:bg-muted transition-colors text-left',
                            groupBy === opt.value && 'text-primary font-medium bg-primary/5',
                          )}
                        >
                          <span className="text-muted-foreground">{opt.icon}</span>
                          {opt.label}
                        </button>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}

            {/* View toggle */}
            <div className="flex items-center rounded-lg border border-border p-0.5 bg-muted/40 gap-0.5">
              <button
                onClick={() => setViewMode('grid')}
                title="Grid view"
                className={cn(
                  'p-1.5 rounded-md transition-colors',
                  viewMode === 'grid'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <LayoutGrid className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setViewMode('classify')}
                title="Classify view"
                className={cn(
                  'p-1.5 rounded-md transition-colors',
                  viewMode === 'classify'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <List className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-6" onClick={() => showGroupMenu && setShowGroupMenu(false)}>
          {loading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {[1, 2, 3].map(i => (
                <div key={i} className="h-52 rounded-2xl bg-muted/40 animate-pulse" />
              ))}
            </div>
          ) : filtered.length === 0 && !pendingProfile ? (
            search ? (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <Search className="w-8 h-8 text-muted-foreground/40 mb-3" />
                <p className="text-sm text-muted-foreground">No competitors match &ldquo;{search}&rdquo;</p>
                <button onClick={() => setSearch('')} className="text-xs text-primary mt-2 hover:underline">Clear search</button>
              </div>
            ) : (
              <EmptyState onAdd={() => setShowAddModal(true)} />
            )
          ) : viewMode === 'classify' ? (
            <ClassificationView
              profiles={filtered}
              groupBy={groupBy}
              onSelectProfile={setSelectedProfile}
              onDelete={handleDelete}
              onRefresh={handleRefresh}
              onDeepDive={handleDeepDive}
              deletingIds={deletingIds}
              refreshingIds={refreshingIds}
            />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <AnimatePresence mode="popLayout">
                {pendingProfile && (
                  <AnalyzingCard key="pending" name={pendingProfile.name} />
                )}
                {filtered.map(profile => (
                  profile.status === 'analyzing' ? (
                    <AnalyzingCard key={profile.id} name={profile.competitor_name} />
                  ) : (
                    <ProfileCard
                      key={profile.id}
                      profile={profile}
                      onSelect={() => setSelectedProfile(profile)}
                      onDelete={() => handleDelete(profile)}
                      onRefresh={() => handleRefresh(profile)}
                      onDeepDive={() => handleDeepDive(profile)}
                      deleting={deletingIds.has(profile.id)}
                      refreshing={refreshingIds.has(profile.id)}
                    />
                  )
                ))}
              </AnimatePresence>
            </div>
          )}
        </div>
      </div>

      {/* Detail panel overlay */}
      <AnimatePresence>
        {selectedProfile && (
          <>
            {/* Backdrop */}
            <motion.div
              key="backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedProfile(null)}
              className="fixed inset-0 bg-black/30 z-40"
            />
            <DetailPanel
              key="panel"
              profile={selectedProfile}
              onClose={() => setSelectedProfile(null)}
              onDeepDive={() => handleDeepDive(selectedProfile)}
            />
          </>
        )}
      </AnimatePresence>

      {/* Add Modal */}
      <AnimatePresence>
        {showAddModal && (
          <AddCompetitorModal
            onClose={() => { if (!classifying) setShowAddModal(false) }}
            onSubmit={handleClassify}
            loading={classifying}
            stepMessage={classifyStep}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
