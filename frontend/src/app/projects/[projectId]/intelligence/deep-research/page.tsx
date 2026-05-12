'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import {
  Search, Plus, X, Loader2, CheckCircle2, AlertTriangle, Zap,
  Globe, Activity,
  ChevronDown, ChevronUp, ExternalLink,
  TrendingUp, TrendingDown, Minus, Shield, Flame,
  BarChart2, Megaphone, Users, Star, Target,
  ArrowRight, Eye, BookOpen, RefreshCw, Bell,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { api } from '@/lib/api'
import { SidebarToggle } from '@/components/layout/sidebar'
import { BackButton } from '@/components/layout/back-button'
import type {
  CompetitorInput,
  DeepResearchEvent,
  DeepResearchReport,
  DeepResearchReportSummary,
  DiscoveredCompetitor,
  CompetitorMonitor,
} from '@/types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Tab = 'overview' | 'ads' | 'social' | 'seo' | 'audience' | 'strategy'
type Phase = 'input' | 'researching' | 'report' | 'history'

interface LayerStatus {
  layer: number
  name: string
  label: string
  status: 'pending' | 'running' | 'done' | 'skipped'
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LAYER_LABELS: Record<number, string> = {
  1: 'Website & messaging',
  2: 'Meta Ad Library',
  3: 'Social content audit',
  4: 'SEO & keyword intelligence',
  5: 'Audience sentiment',
  6: 'Content topic gap map',
  7: 'Strategic SWOT synthesis',
}

const THREAT_CONFIG = {
  high:   { label: 'High threat',   color: 'text-red-500',    bg: 'bg-red-500/10 border-red-500/20',    icon: <Flame className="w-3.5 h-3.5" /> },
  medium: { label: 'Medium threat', color: 'text-amber-500',  bg: 'bg-amber-500/10 border-amber-500/20', icon: <AlertTriangle className="w-3.5 h-3.5" /> },
  low:    { label: 'Low threat',    color: 'text-emerald-500', bg: 'bg-emerald-500/10 border-emerald-500/20', icon: <Shield className="w-3.5 h-3.5" /> },
}

const TAB_CONFIG: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'overview',  label: 'Overview',  icon: <Eye className="w-3.5 h-3.5" /> },
  { id: 'ads',       label: 'Paid Ads',  icon: <Megaphone className="w-3.5 h-3.5" /> },
  { id: 'social',    label: 'Social',    icon: <Activity className="w-3.5 h-3.5" /> },
  { id: 'seo',       label: 'SEO',       icon: <Search className="w-3.5 h-3.5" /> },
  { id: 'audience',  label: 'Audience',  icon: <Users className="w-3.5 h-3.5" /> },
  { id: 'strategy',  label: 'Strategy',  icon: <Target className="w-3.5 h-3.5" /> },
]

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function Section({ title, children, defaultOpen = true }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-2.5 bg-muted/30 hover:bg-muted/50 transition-colors text-left"
      >
        <span className="text-xs font-semibold text-foreground">{title}</span>
        {open ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
      </button>
      {open && <div className="p-4">{children}</div>}
    </div>
  )
}

function StringList({ items }: { items: string[]; color?: 'red' | 'green' | 'amber' | 'blue' | 'default' }) {
  if (!items?.length) return <p className="text-xs text-muted-foreground italic">No data</p>
  return (
    <ul className="space-y-1">
      {items.map((item, i) => (
        <li key={i} className="text-xs text-foreground flex gap-2">
          <span className="text-muted-foreground shrink-0 mt-0.5">•</span>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  )
}

// ---------------------------------------------------------------------------
// Competitor input chip
// ---------------------------------------------------------------------------

function CompetitorChip({
  competitor,
  onRemove,
}: {
  competitor: CompetitorInput
  onRemove: () => void
}) {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-muted border border-border text-xs">
      <Globe className="w-3 h-3 text-muted-foreground shrink-0" />
      <span className="font-medium">{competitor.name}</span>
      {competitor.website && (
        <span className="text-muted-foreground">{competitor.website.replace(/^https?:\/\//, '')}</span>
      )}
      <button onClick={onRemove} className="text-muted-foreground hover:text-foreground ml-1">
        <X className="w-3 h-3" />
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Progress display
// ---------------------------------------------------------------------------

function ResearchProgress({
  layers,
  currentCompetitor,
}: {
  layers: LayerStatus[]
  currentCompetitor: string
}) {
  return (
    <div className="max-w-lg mx-auto space-y-3">
      <div className="text-center space-y-1 mb-6">
        <p className="text-sm font-semibold">Researching {currentCompetitor}</p>
        <p className="text-xs text-muted-foreground">Running 7-layer intelligence pipeline across all sources</p>
      </div>
      <div className="space-y-2">
        {layers.map((layer) => (
          <div key={layer.layer} className="flex items-center gap-3">
            <div className="w-6 h-6 shrink-0 flex items-center justify-center">
              {layer.status === 'done' && <CheckCircle2 className="w-4 h-4 text-emerald-500" />}
              {layer.status === 'running' && <Loader2 className="w-4 h-4 text-primary animate-spin" />}
              {layer.status === 'pending' && <div className="w-4 h-4 rounded-full border-2 border-border" />}
              {layer.status === 'skipped' && <div className="w-4 h-4 rounded-full border-2 border-border/50" />}
            </div>
            <div className="flex-1">
              <p className={cn(
                'text-xs',
                layer.status === 'done' ? 'text-foreground' :
                layer.status === 'running' ? 'text-primary font-medium' :
                'text-muted-foreground'
              )}>
                Layer {layer.layer} - {layer.label}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Report tabs
// ---------------------------------------------------------------------------

function OverviewTab({ report }: { report: DeepResearchReport }) {
  const { overview, competitor } = report
  const threat = THREAT_CONFIG[overview.threat_level] || THREAT_CONFIG.medium

  return (
    <div className="space-y-4">
      {/* Header card */}
      <div className="flex items-start gap-4 p-4 border border-border rounded-lg bg-muted/20">
        {competitor.logo_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={competitor.logo_url}
            alt={competitor.name}
            className="w-12 h-12 rounded-lg object-contain bg-white border border-border shrink-0"
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
          />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold text-sm">{competitor.name}</h3>
            <div className={cn('flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-medium', threat.bg, threat.color)}>
              {threat.icon}<span>{threat.label}</span>
            </div>
          </div>
          {competitor.website && (
            <a href={competitor.website} target="_blank" rel="noopener noreferrer"
              className="text-xs text-muted-foreground hover:text-primary flex items-center gap-1 mt-0.5">
              {competitor.website}<ExternalLink className="w-2.5 h-2.5" />
            </a>
          )}
          {overview.headline && <p className="text-xs mt-2 italic text-muted-foreground">&ldquo;{overview.headline}&rdquo;</p>}
        </div>
      </div>

      {/* Quick facts */}
      <div className="grid grid-cols-2 gap-3">
        <div className="p-3 border border-border rounded-lg">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Target customer</p>
          <p className="text-xs">{overview.target_customer || '-'}</p>
        </div>
        <div className="p-3 border border-border rounded-lg">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Pricing model</p>
          <p className="text-xs capitalize">{overview.pricing_model || '-'}
            {overview.price_anchor && <span className="text-muted-foreground ml-1">(from {overview.price_anchor})</span>}
          </p>
        </div>
        <div className="p-3 border border-border rounded-lg">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Brand tone</p>
          <p className="text-xs capitalize">{overview.tone || '-'}</p>
        </div>
        <div className="p-3 border border-border rounded-lg">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Value prop</p>
          <p className="text-xs line-clamp-2">{overview.value_prop || '-'}</p>
        </div>
      </div>

      <Section title="Their top claims">
        <StringList items={overview.top_claims} />
      </Section>

      <Section title="Trust signals">
        <StringList items={overview.trust_signals} />
      </Section>

      <div className="grid grid-cols-2 gap-4">
        <Section title="3 things they do better than us">
          <StringList items={overview.strengths_vs_us} color="red" />
        </Section>
        <Section title="3 things we do better than them">
          <StringList items={overview.weaknesses_vs_us} color="green" />
        </Section>
      </div>
    </div>
  )
}

function AdsTab({ report }: { report: DeepResearchReport }) {
  const ads = report.paid_ads
  if (!ads || ads.ads_found === 0) {
    return <p className="text-sm text-muted-foreground py-8 text-center">No active Meta ads found for this competitor.</p>
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <div className="p-3 border border-border rounded-lg text-center">
          <p className="text-2xl font-bold">{ads.ads_found}</p>
          <p className="text-[11px] text-muted-foreground">Active ads</p>
        </div>
        <div className="p-3 border border-border rounded-lg text-center">
          <p className="text-sm font-semibold capitalize">{ads.estimated_ad_budget_signal || '-'}</p>
          <p className="text-[11px] text-muted-foreground">Budget signal</p>
        </div>
        <div className="p-3 border border-border rounded-lg text-center">
          <p className="text-sm font-semibold">{ads.dominant_cta || '-'}</p>
          <p className="text-[11px] text-muted-foreground">Top CTA</p>
        </div>
      </div>

      {ads.ad_formats && (
        <div className="flex gap-3">
          {Object.entries(ads.ad_formats).map(([fmt, count]) => (
            <div key={fmt} className="flex-1 p-2 border border-border rounded-lg text-center">
              <p className="text-lg font-semibold">{count as number}</p>
              <p className="text-[10px] text-muted-foreground capitalize">{fmt}</p>
            </div>
          ))}
        </div>
      )}

      {ads.longest_running_ad?.copy && (
        <div className="p-4 border-2 border-amber-500/30 rounded-lg bg-amber-500/5">
          <div className="flex items-center gap-2 mb-2">
            <Star className="w-3.5 h-3.5 text-amber-500" />
            <p className="text-xs font-semibold text-amber-600">Longest-running ad - their most proven creative</p>
            {ads.longest_running_ad.days_active > 0 && (
              <span className="text-[10px] text-muted-foreground ml-auto">Active {ads.longest_running_ad.days_active} days</span>
            )}
          </div>
          <p className="text-xs">{ads.longest_running_ad.copy}</p>
        </div>
      )}

      <Section title="Messaging themes">
        <StringList items={ads.messaging_themes} />
      </Section>

      {ads.most_used_hook && (
        <Section title="Hook pattern they repeat">
          <p className="text-xs">{ads.most_used_hook}</p>
        </Section>
      )}

      {ads.winning_angle && (
        <Section title="Winning angle">
          <p className="text-xs">{ads.winning_angle}</p>
        </Section>
      )}

      {ads.primary_offer && (
        <Section title="Primary offer">
          <p className="text-xs">{ads.primary_offer}</p>
        </Section>
      )}
    </div>
  )
}

function SocialTab({ report }: { report: DeepResearchReport }) {
  const social = report.social_content
  if (!social || !social.platforms_scraped?.length) {
    return <p className="text-sm text-muted-foreground py-8 text-center">No social data found for this competitor.</p>
  }

  return (
    <div className="space-y-4">
      {/* Platform breakdown */}
      {social.platform_raw && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-2 text-muted-foreground font-medium">Platform</th>
                <th className="text-right py-2 text-muted-foreground font-medium">Followers</th>
                <th className="text-right py-2 text-muted-foreground font-medium">Posts scraped</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(social.platform_raw).map(([platform, data]) => (
                <tr key={platform} className="border-b border-border/50">
                  <td className="py-2 capitalize">{platform}</td>
                  <td className="py-2 text-right">{data.followers?.toLocaleString() || '-'}</td>
                  <td className="py-2 text-right">{data.post_count || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        {social.avg_engagement_rate && (
          <div className="p-3 border border-border rounded-lg">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Avg engagement rate</p>
            <p className="text-sm font-semibold">{social.avg_engagement_rate}</p>
          </div>
        )}
        {social.best_performing_format && (
          <div className="p-3 border border-border rounded-lg">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Best format</p>
            <p className="text-sm font-semibold capitalize">{social.best_performing_format}</p>
          </div>
        )}
      </div>

      {social.posting_frequency && Object.keys(social.posting_frequency).length > 0 && (
        <Section title="Posting frequency">
          <div className="flex flex-wrap gap-2">
            {Object.entries(social.posting_frequency).map(([platform, freq]) => (
              <div key={platform} className="flex items-center gap-1.5 px-2 py-1 rounded bg-muted text-xs">
                <span className="capitalize text-muted-foreground">{platform}:</span>
                <span className="font-medium">{freq as string}</span>
              </div>
            ))}
          </div>
        </Section>
      )}

      <Section title="Top content themes">
        <StringList items={social.top_content_themes} />
      </Section>

      {social.top_hashtags?.length > 0 && (
        <Section title="Hashtag clusters they own">
          <div className="flex flex-wrap gap-1.5">
            {social.top_hashtags.map((tag, i) => (
              <span key={i} className="px-2 py-0.5 rounded-full bg-muted text-[11px] text-muted-foreground">{tag}</span>
            ))}
          </div>
        </Section>
      )}

      {social.viral_content_pattern && (
        <Section title="What their best posts have in common">
          <p className="text-xs">{social.viral_content_pattern}</p>
        </Section>
      )}

      <Section title="Content they avoid">
        <StringList items={social.content_they_avoid} color="amber" />
      </Section>

      <Section title="Social weaknesses">
        <StringList items={social.weaknesses} color="red" />
      </Section>
    </div>
  )
}

function SeoTab({ report }: { report: DeepResearchReport }) {
  const seo = report.seo
  if (!seo) return <p className="text-sm text-muted-foreground py-8 text-center">SEO data unavailable.</p>

  const strengthColors = {
    high: 'text-red-500',
    medium: 'text-amber-500',
    low: 'text-emerald-500',
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <div className="p-3 border border-border rounded-lg text-center">
          <p className={cn('text-sm font-bold capitalize', strengthColors[seo.seo_strength] || 'text-foreground')}>
            {seo.seo_strength || '-'}
          </p>
          <p className="text-[11px] text-muted-foreground">SEO strength</p>
        </div>
        <div className="p-3 border border-border rounded-lg text-center">
          <p className="text-sm font-bold">{seo.indexed_pages?.toLocaleString() || '-'}</p>
          <p className="text-[11px] text-muted-foreground">Indexed pages</p>
        </div>
        <div className="p-3 border border-border rounded-lg text-center">
          <p className={cn('text-sm font-bold', seo.google_ads_running ? 'text-amber-500' : 'text-muted-foreground')}>
            {seo.google_ads_running ? 'Yes' : 'No'}
          </p>
          <p className="text-[11px] text-muted-foreground">Google Ads</p>
        </div>
      </div>

      {seo.google_ads_running && seo.google_ad_message && (
        <div className="p-3 border border-amber-500/30 rounded-lg bg-amber-500/5">
          <p className="text-[10px] text-amber-600 font-medium mb-1">Their Google Ad headline:</p>
          <p className="text-xs">{seo.google_ad_message}</p>
        </div>
      )}

      {seo.autocomplete_signals?.length > 0 && (
        <Section title="Google Autocomplete signals">
          <p className="text-[10px] text-muted-foreground mb-2">What people search when they type this brand name:</p>
          <div className="flex flex-wrap gap-1.5">
            {seo.autocomplete_signals.slice(0, 10).map((s, i) => (
              <span key={i} className="px-2 py-0.5 rounded bg-muted text-[11px] text-muted-foreground">{s}</span>
            ))}
          </div>
        </Section>
      )}

      <Section title="Keywords they rank for">
        <StringList items={seo.ranking_keywords} />
      </Section>

      {seo.seo_gap_for_us && (
        <Section title="SEO gap we could target">
          <p className="text-xs text-emerald-600">{seo.seo_gap_for_us}</p>
        </Section>
      )}

      {seo.trending_vs_us && (
        <div className="p-3 border border-border rounded-lg flex items-center gap-2">
          {seo.trending_vs_us === 'growing' && <TrendingUp className="w-4 h-4 text-red-500" />}
          {seo.trending_vs_us === 'declining' && <TrendingDown className="w-4 h-4 text-emerald-500" />}
          {seo.trending_vs_us === 'stable' && <Minus className="w-4 h-4 text-muted-foreground" />}
          <p className="text-xs">
            Search trend vs our brand:{' '}
            <span className={cn('font-medium capitalize',
              seo.trending_vs_us === 'growing' ? 'text-red-500' :
              seo.trending_vs_us === 'declining' ? 'text-emerald-500' :
              'text-muted-foreground'
            )}>{seo.trending_vs_us}</span>
          </p>
        </div>
      )}
    </div>
  )
}

function AudienceTab({ report }: { report: DeepResearchReport }) {
  const s = report.sentiment
  if (!s) return <p className="text-sm text-muted-foreground py-8 text-center">Audience sentiment data unavailable.</p>

  const sentimentColors = {
    positive: 'text-emerald-500',
    mixed: 'text-amber-500',
    negative: 'text-red-500',
    unknown: 'text-muted-foreground',
  }

  return (
    <div className="space-y-4">
      <div className="p-4 border border-border rounded-lg flex items-center gap-3">
        <div className={cn('text-xl font-bold capitalize', sentimentColors[s.overall_sentiment])}>
          {s.overall_sentiment}
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Overall audience sentiment</p>
          <p className="text-[10px] text-muted-foreground">Based on reviews, social comments, and Reddit discussions</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Section title="What customers love">
          <StringList items={s.top_praise} color="green" />
        </Section>
        <Section title="What customers hate">
          <StringList items={s.top_complaints} color="red" />
        </Section>
      </div>

      <Section title="Feature requests from their audience">
        <StringList items={s.feature_requests} color="blue" />
      </Section>

      <Section title="Why people leave (churn signals)">
        <StringList items={s.churn_signals} color="amber" />
      </Section>

      {s.unmet_needs?.length > 0 && (
        <div className="p-4 border-2 border-emerald-500/30 rounded-lg bg-emerald-500/5">
          <div className="flex items-center gap-2 mb-2">
            <Zap className="w-3.5 h-3.5 text-emerald-500" />
            <p className="text-xs font-semibold text-emerald-600">The gap - unmet needs their customers have</p>
          </div>
          <ul className="space-y-1">
            {s.unmet_needs.map((need, i) => (
              <li key={i} className="text-xs flex gap-2">
                <span className="text-emerald-500 shrink-0">→</span>
                <span>{need}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Section title="Why customers stay (loyalty signals)">
        <StringList items={s.brand_loyalty_signals} />
      </Section>
    </div>
  )
}

function StrategyTab({ report }: { report: DeepResearchReport }) {
  const swot = report.strategic_swot
  if (!swot) return <p className="text-sm text-muted-foreground py-8 text-center">Strategic analysis unavailable.</p>

  return (
    <div className="space-y-4">
      {swot.positioning_summary && (
        <div className="p-4 border border-border rounded-lg bg-muted/20">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-2">Positioning summary</p>
          <p className="text-xs leading-relaxed">{swot.positioning_summary}</p>
        </div>
      )}

      {/* SWOT 2×2 */}
      <div className="grid grid-cols-2 gap-3">
        <div className="p-3 border border-emerald-500/20 rounded-lg bg-emerald-500/5">
          <p className="text-[10px] font-semibold text-emerald-600 mb-2 uppercase tracking-wide">Strengths</p>
          <StringList items={swot.strengths} color="green" />
        </div>
        <div className="p-3 border border-red-500/20 rounded-lg bg-red-500/5">
          <p className="text-[10px] font-semibold text-red-600 mb-2 uppercase tracking-wide">Weaknesses</p>
          <StringList items={swot.weaknesses} color="red" />
        </div>
        <div className="p-3 border border-blue-500/20 rounded-lg bg-blue-500/5">
          <p className="text-[10px] font-semibold text-blue-600 mb-2 uppercase tracking-wide">Our opportunities</p>
          <StringList items={swot.opportunities_for_us} color="blue" />
        </div>
        <div className="p-3 border border-amber-500/20 rounded-lg bg-amber-500/5">
          <p className="text-[10px] font-semibold text-amber-600 mb-2 uppercase tracking-wide">Threats to us</p>
          <StringList items={swot.threats_to_us} color="amber" />
        </div>
      </div>

      {swot.how_they_win_customers && (
        <Section title="How they win customers">
          <p className="text-xs">{swot.how_they_win_customers}</p>
        </Section>
      )}

      {swot.how_we_beat_them && (
        <div className="p-4 border-2 border-primary/30 rounded-lg bg-primary/5">
          <p className="text-[10px] font-semibold text-primary mb-2 uppercase tracking-wide">How we beat them</p>
          <p className="text-xs leading-relaxed">{swot.how_we_beat_them}</p>
        </div>
      )}

      {swot.steal_this && (
        <div className="p-4 border border-border rounded-lg space-y-3">
          <div className="flex items-center gap-2">
            <Star className="w-3.5 h-3.5 text-amber-500" />
            <p className="text-xs font-semibold">Steal This</p>
          </div>
          <div className="space-y-2">
            <div>
              <p className="text-[10px] text-muted-foreground mb-0.5">The tactic</p>
              <p className="text-xs">{swot.steal_this.tactic}</p>
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground mb-0.5">Why it works</p>
              <p className="text-xs">{swot.steal_this.why_it_works}</p>
            </div>
            <div className="p-2 rounded bg-emerald-500/10 border border-emerald-500/20">
              <p className="text-[10px] text-emerald-600 font-medium mb-0.5">Our better version</p>
              <p className="text-xs">{swot.steal_this.our_version}</p>
            </div>
          </div>
        </div>
      )}

      {report.content_map?.our_opportunity_topics?.length > 0 && (
        <Section title="Content topics we could own">
          <StringList items={report.content_map.our_opportunity_topics} color="green" />
        </Section>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Full report card
// ---------------------------------------------------------------------------

function ReportCard({
  report,
  onMonitor,
}: {
  report: DeepResearchReport
  onMonitor: (competitor: CompetitorInput) => void
}) {
  const [activeTab, setActiveTab] = useState<Tab>('overview')
  const threat = THREAT_CONFIG[report.overview?.threat_level] || THREAT_CONFIG.medium

  return (
    <div className="border border-border rounded-xl overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 bg-muted/30 border-b border-border">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {report.competitor.logo_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={report.competitor.logo_url}
                alt={report.competitor.name}
                className="w-8 h-8 rounded object-contain bg-white border border-border"
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
              />
            )}
            <div>
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold">{report.competitor.name}</p>
                <div className={cn('flex items-center gap-1 px-1.5 py-0.5 rounded-full border text-[10px] font-medium', threat.bg, threat.color)}>
                  {threat.icon}<span>{threat.label}</span>
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Researched across 7 sources · {new Date(report.created_at).toLocaleDateString()}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => onMonitor(report.competitor)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-border text-xs hover:bg-muted transition-colors"
            >
              <Bell className="w-3 h-3" />
              Monitor weekly
            </button>
          </div>
        </div>
        {/* Tabs */}
        <div className="flex gap-1 mt-3 overflow-x-auto">
          {TAB_CONFIG.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs whitespace-nowrap transition-colors shrink-0',
                activeTab === tab.id
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted'
              )}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div className="p-4 max-h-[600px] overflow-y-auto">
        {activeTab === 'overview'  && <OverviewTab  report={report} />}
        {activeTab === 'ads'       && <AdsTab       report={report} />}
        {activeTab === 'social'    && <SocialTab    report={report} />}
        {activeTab === 'seo'       && <SeoTab       report={report} />}
        {activeTab === 'audience'  && <AudienceTab  report={report} />}
        {activeTab === 'strategy'  && <StrategyTab  report={report} />}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

const INITIAL_LAYERS = (): LayerStatus[] =>
  Object.entries(LAYER_LABELS).map(([key, label]) => ({
    layer: Number(key),
    name: '',
    label,
    status: 'pending' as const,
  }))

export default function DeepResearchPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const [phase, setPhase] = useState<Phase>('input')

  // Input state
  const [nameInput, setNameInput] = useState('')
  const [websiteInput, setWebsiteInput] = useState('')
  const [competitors, setCompetitors] = useState<CompetitorInput[]>([])
  const [discovering, setDiscovering] = useState(false)
  const [suggestions, setSuggestions] = useState<DiscoveredCompetitor[]>([])

  // Research state
  const [layers, setLayers] = useState<LayerStatus[]>(INITIAL_LAYERS())
  const [currentCompetitor, setCurrentCompetitor] = useState('')
  const abortRef = useRef<AbortController | null>(null)

  // Report state
  const [reports, setReports] = useState<DeepResearchReport[]>([])
  const [historyReports, setHistoryReports] = useState<DeepResearchReportSummary[]>([])
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [monitors, setMonitors] = useState<CompetitorMonitor[]>([])

  // Load history on mount
  useEffect(() => {
    if (!projectId) return
    setLoadingHistory(true)
    Promise.all([
      api.deepResearch.listReports(projectId).catch(() => ({ reports: [] })),
      api.deepResearch.listMonitors(projectId).catch(() => ({ monitors: [] })),
    ]).then(([r, m]) => {
      setHistoryReports(r.reports || [])
      setMonitors(m.monitors || [])
    }).finally(() => setLoadingHistory(false))
  }, [projectId])

  const addCompetitor = () => {
    if (!nameInput.trim()) return
    if (competitors.length >= 5) { toast.error('Maximum 5 competitors per research run'); return }
    setCompetitors(prev => [...prev, {
      name: nameInput.trim(),
      website: websiteInput.trim() || undefined,
    }])
    setNameInput('')
    setWebsiteInput('')
  }

  const handleDiscover = async () => {
    setDiscovering(true)
    try {
      const result = await api.deepResearch.discover(projectId)
      setSuggestions(result.competitors || [])
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Discovery failed')
    } finally {
      setDiscovering(false)
    }
  }

  const addSuggestion = (s: DiscoveredCompetitor) => {
    if (competitors.length >= 5) { toast.error('Maximum 5 competitors'); return }
    if (competitors.some(c => c.name.toLowerCase() === s.name.toLowerCase())) return
    let domain = ''
    try { domain = new URL(s.url).hostname.replace('www.', '') } catch { /* ignore */ }
    setCompetitors(prev => [...prev, { name: s.name, website: s.url, domain }])
  }

  const runResearch = useCallback(async () => {
    if (competitors.length === 0) return
    setPhase('researching')
    setLayers(INITIAL_LAYERS())
    setReports([])
    abortRef.current = new AbortController()

    try {
      await api.deepResearch.stream(
        projectId,
        competitors,
        (event: DeepResearchEvent) => {
          if (event.type === 'competitor_started') {
            setCurrentCompetitor(event.name)
            setLayers(INITIAL_LAYERS())
          } else if (event.type === 'layer_started') {
            setLayers(prev => prev.map(l => l.layer === event.layer ? { ...l, name: event.name, status: 'running' } : l))
          } else if (event.type === 'layer_done') {
            setLayers(prev => prev.map(l => l.layer === event.layer ? { ...l, status: 'done' } : l))
          } else if (event.type === 'error') {
            toast.error(event.message)
          }
        },
        async () => {
          // Stream done - fetch completed reports
          try {
            const result = await api.deepResearch.listReports(projectId)
            const fullReports: DeepResearchReport[] = []
            for (const summary of (result.reports || []).slice(0, competitors.length)) {
              try {
                const full = await api.deepResearch.getReport(projectId, summary.id)
                fullReports.push(full)
              } catch { /* skip */ }
            }
            setReports(fullReports)
          } catch { /* skip */ }
          setPhase('report')
        },
        abortRef.current.signal,
      )
    } catch (e: unknown) {
      if ((e as Error)?.name !== 'AbortError') {
        toast.error(e instanceof Error ? e.message : 'Research failed')
        setPhase('input')
      }
    }
  }, [projectId, competitors])

  const handleMonitor = async (competitor: CompetitorInput) => {
    try {
      const monitor = await api.deepResearch.createMonitor(projectId, { competitor, frequency: 'weekly' })
      setMonitors(prev => [...prev, monitor])
      toast.success(`Now monitoring ${competitor.name} weekly`)
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Failed to set up monitoring')
    }
  }

  const isMonitored = (name: string) => monitors.some(m => m.competitor.name.toLowerCase() === name.toLowerCase())

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="flex flex-col h-screen bg-background">
      {/* Top bar */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border shrink-0">
        <SidebarToggle />
        <BackButton />
        <div className="flex items-center gap-2">
          <BarChart2 className="w-4 h-4 text-primary" />
          <h1 className="text-sm font-semibold">Deep Competitor Intelligence</h1>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {historyReports.length > 0 && (
            <button
              onClick={() => setPhase(phase === 'history' ? 'input' : 'history')}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border text-xs hover:bg-muted transition-colors"
            >
              <BookOpen className="w-3.5 h-3.5" />
              {historyReports.length} past report{historyReports.length !== 1 ? 's' : ''}
            </button>
          )}
          {(phase === 'report' || phase === 'history') && (
            <button
              onClick={() => { setPhase('input'); setCompetitors([]); setSuggestions([]) }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-xs hover:bg-primary/90 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              New research
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {/* ── INPUT PHASE ── */}
        {phase === 'input' && (
          <div className="max-w-2xl mx-auto space-y-6">
            <div className="text-center space-y-1.5">
              <h2 className="text-lg font-semibold">7-Layer Competitor Intelligence</h2>
              <p className="text-sm text-muted-foreground">
                Enter up to 5 competitors. LEO hunts them across every data source simultaneously -
                ads, social, SEO, reviews, content - and delivers a strategic playbook.
              </p>
            </div>

            {/* Competitor input */}
            <div className="space-y-3">
              <div className="flex gap-2">
                <input
                  value={nameInput}
                  onChange={e => setNameInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && addCompetitor()}
                  placeholder="Competitor name"
                  className="flex-1 px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                />
                <input
                  value={websiteInput}
                  onChange={e => setWebsiteInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && addCompetitor()}
                  placeholder="Website (optional)"
                  className="flex-1 px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                />
                <button
                  onClick={addCompetitor}
                  disabled={!nameInput.trim()}
                  className="px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm hover:bg-primary/90 disabled:opacity-50 transition-colors"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>

              {competitors.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {competitors.map((c, i) => (
                    <CompetitorChip key={i} competitor={c} onRemove={() => setCompetitors(prev => prev.filter((_, j) => j !== i))} />
                  ))}
                </div>
              )}
            </div>

            {/* Auto-discover */}
            <div className="border border-dashed border-border rounded-lg p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Auto-discover competitors</p>
                  <p className="text-xs text-muted-foreground">LEO finds your top competitors from your brand core</p>
                </div>
                <button
                  onClick={handleDiscover}
                  disabled={discovering}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border text-xs hover:bg-muted disabled:opacity-50 transition-colors"
                >
                  {discovering ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
                  {discovering ? 'Discovering...' : 'Discover'}
                </button>
              </div>

              {suggestions.length > 0 && (
                <div className="space-y-2">
                  <p className="text-[11px] text-muted-foreground">Select competitors to add:</p>
                  <div className="flex flex-wrap gap-2">
                    {suggestions.map((s, i) => {
                      const added = competitors.some(c => c.name.toLowerCase() === s.name.toLowerCase())
                      return (
                        <button
                          key={i}
                          onClick={() => addSuggestion(s)}
                          disabled={added}
                          className={cn(
                            'flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs transition-colors',
                            added
                              ? 'bg-primary/10 border-primary/30 text-primary cursor-default'
                              : 'border-border hover:bg-muted hover:border-primary/30'
                          )}
                        >
                          {added && <CheckCircle2 className="w-3 h-3 shrink-0" />}
                          <Globe className="w-3 h-3 shrink-0 text-muted-foreground" />
                          {s.name}
                          {(s.relevance_score ?? 0) >= 0.85 && <Star className="w-2.5 h-2.5 text-amber-500" />}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>

            <button
              onClick={runResearch}
              disabled={competitors.length === 0}
              className="w-full py-3 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
            >
              <Zap className="w-4 h-4" />
              Run deep research on {competitors.length || 0} competitor{competitors.length !== 1 ? 's' : ''}
            </button>

            <p className="text-center text-[11px] text-muted-foreground">
              Researches website, Meta ads, Instagram, TikTok, YouTube, Google SEO, and audience sentiment.
              Target time: ~90 seconds per competitor.
            </p>
          </div>
        )}

        {/* ── RESEARCHING PHASE ── */}
        {phase === 'researching' && (
          <div className="max-w-lg mx-auto pt-8">
            <ResearchProgress layers={layers} currentCompetitor={currentCompetitor} />
          </div>
        )}

        {/* ── REPORT PHASE ── */}
        {phase === 'report' && reports.length > 0 && (
          <div className="max-w-3xl mx-auto space-y-6">
            {reports.map(report => (
              <ReportCard
                key={report.id}
                report={report}
                onMonitor={handleMonitor}
              />
            ))}

            {reports.length > 1 && (
              <div className="p-4 border border-border rounded-lg bg-muted/20">
                <p className="text-xs font-medium mb-2">Multi-competitor summary</p>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-left py-2 text-muted-foreground font-medium">Competitor</th>
                        <th className="text-center py-2 text-muted-foreground font-medium">Threat</th>
                        <th className="text-center py-2 text-muted-foreground font-medium">Ads</th>
                        <th className="text-center py-2 text-muted-foreground font-medium">SEO</th>
                        <th className="text-center py-2 text-muted-foreground font-medium">Sentiment</th>
                        <th className="text-center py-2 text-muted-foreground font-medium">Monitored</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reports.map(r => {
                        const tConfig = THREAT_CONFIG[r.overview?.threat_level] || THREAT_CONFIG.medium
                        return (
                          <tr key={r.id} className="border-b border-border/50">
                            <td className="py-2 font-medium">{r.competitor.name}</td>
                            <td className="py-2 text-center">
                              <span className={cn('font-medium', tConfig.color)}>{r.overview?.threat_level || '-'}</span>
                            </td>
                            <td className="py-2 text-center">{r.paid_ads?.ads_found ?? '-'}</td>
                            <td className="py-2 text-center capitalize">{r.seo?.seo_strength || '-'}</td>
                            <td className="py-2 text-center capitalize">{r.sentiment?.overall_sentiment || '-'}</td>
                            <td className="py-2 text-center">
                              {isMonitored(r.competitor.name)
                                ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 mx-auto" />
                                : <button onClick={() => handleMonitor(r.competitor)} className="text-muted-foreground hover:text-primary transition-colors"><Bell className="w-3.5 h-3.5 mx-auto" /></button>
                              }
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── HISTORY PHASE ── */}
        {phase === 'history' && (
          <div className="max-w-2xl mx-auto space-y-4">
            <h2 className="text-sm font-semibold">Past research reports</h2>
            {loadingHistory ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            ) : historyReports.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No reports yet.</p>
            ) : (
              <div className="space-y-2">
                {historyReports.map(r => {
                  const tConfig = THREAT_CONFIG[r.threat_level] || THREAT_CONFIG.medium
                  return (
                    <button
                      key={r.id}
                      onClick={async () => {
                        try {
                          const full = await api.deepResearch.getReport(projectId, r.id)
                          setReports([full])
                          setPhase('report')
                        } catch {
                          toast.error('Failed to load report')
                        }
                      }}
                      className="w-full flex items-center gap-3 p-3 rounded-lg border border-border hover:bg-muted transition-colors text-left"
                    >
                      {r.competitor.logo_url && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={r.competitor.logo_url}
                          alt=""
                          className="w-8 h-8 rounded object-contain bg-white border border-border shrink-0"
                          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                        />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">{r.competitor.name}</p>
                        <p className="text-[11px] text-muted-foreground">{new Date(r.created_at).toLocaleDateString()}</p>
                      </div>
                      <div className={cn('flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-medium', tConfig.bg, tConfig.color)}>
                        {tConfig.icon}<span>{tConfig.label}</span>
                      </div>
                      <ArrowRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    </button>
                  )
                })}
              </div>
            )}

            {monitors.length > 0 && (
              <div className="mt-6 space-y-3">
                <h3 className="text-sm font-semibold">Active monitors</h3>
                {monitors.map(m => (
                  <div key={m.id} className="flex items-center gap-3 p-3 rounded-lg border border-border">
                    <Bell className="w-4 h-4 text-primary shrink-0" />
                    <div className="flex-1">
                      <p className="text-sm font-medium">{m.competitor.name}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {m.frequency} · Last run: {m.last_run_at ? new Date(m.last_run_at).toLocaleDateString() : 'Never'}
                      </p>
                    </div>
                    {m.has_significant_changes && (
                      <span className="px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-600 text-[10px] font-medium">
                        Changes detected
                      </span>
                    )}
                    <button
                      onClick={async () => {
                        try {
                          await api.deepResearch.runMonitor(projectId, m.id)
                          toast.success('Monitor run complete')
                        } catch {
                          toast.error('Monitor run failed')
                        }
                      }}
                      className="p-1.5 rounded border border-border hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
