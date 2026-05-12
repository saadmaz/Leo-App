'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import {
  Loader2, ExternalLink, ShieldCheck, ShieldAlert,
  Shield, Search, MessageSquare, XCircle,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { api } from '@/lib/api'
import { SidebarToggle } from '@/components/layout/sidebar'
import { BackButton } from '@/components/layout/back-button'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GoogleResult {
  title: string
  url: string
  snippet: string
  position: number
  source: string
}

interface SocialMention {
  platform: string
  url: string
  title: string
  snippet: string
  sentiment: 'positive' | 'neutral' | 'negative'
  sentimentReason?: string
}

interface ReputationSummary {
  googleResultsFound: number
  topGoogleSource: string
  totalMentionsFound: number
  sentimentBreakdown: { positive: number; neutral: number; negative: number }
  overallSentiment: 'positive' | 'neutral' | 'negative'
}

interface ReputationData {
  projectId: string
  fullName: string
  checkedAt: string
  googleResults: GoogleResult[]
  socialMentions: SocialMention[]
  summary: ReputationSummary
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sentimentColor(s: string) {
  if (s === 'positive') return 'text-green-600 bg-green-500/10 border-green-500/20'
  if (s === 'negative') return 'text-red-500 bg-red-500/10 border-red-500/20'
  return 'text-muted-foreground bg-muted border-border'
}

function sentimentIcon(s: string) {
  if (s === 'positive') return <ShieldCheck className="w-4 h-4 text-green-600" />
  if (s === 'negative') return <ShieldAlert className="w-4 h-4 text-red-500" />
  return <Shield className="w-4 h-4 text-muted-foreground" />
}

// ---------------------------------------------------------------------------
// Sentiment badge
// ---------------------------------------------------------------------------

function SentimentBadge({ sentiment }: { sentiment: string }) {
  return (
    <span className={cn('text-[10px] font-semibold px-2 py-0.5 rounded-full border capitalize', sentimentColor(sentiment))}>
      {sentiment}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Google result card
// ---------------------------------------------------------------------------

function GoogleResultCard({ result }: { result: GoogleResult }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-1.5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <a
            href={result.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-medium text-primary hover:underline line-clamp-2 leading-snug"
          >
            {result.title}
          </a>
          <p className="text-[10px] text-muted-foreground mt-0.5">{result.source}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[10px] text-muted-foreground">#{result.position}</span>
          <a href={result.url} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="w-3 h-3 text-muted-foreground hover:text-foreground transition-colors" />
          </a>
        </div>
      </div>
      {result.snippet && (
        <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">{result.snippet}</p>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Social mention card
// ---------------------------------------------------------------------------

function MentionCard({ mention }: { mention: SocialMention }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="w-6 h-6 rounded-md bg-muted flex items-center justify-center text-[9px] font-bold uppercase text-muted-foreground shrink-0">
            {mention.platform[0]}
          </span>
          <a
            href={mention.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-medium text-primary hover:underline line-clamp-1"
          >
            {mention.title || `${mention.platform} mention`}
          </a>
        </div>
        <SentimentBadge sentiment={mention.sentiment} />
      </div>
      {mention.snippet && (
        <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">{mention.snippet}</p>
      )}
      {mention.sentimentReason && (
        <p className="text-[10px] text-muted-foreground italic">{mention.sentimentReason}</p>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Overall sentiment hero
// ---------------------------------------------------------------------------

function SentimentHero({ summary }: { summary: ReputationSummary }) {
  const { sentimentBreakdown: b, overallSentiment, googleResultsFound, totalMentionsFound } = summary
  const total = b.positive + b.neutral + b.negative || 1

  return (
    <div className="rounded-2xl border border-border bg-card p-6 space-y-5">
      <div className="flex items-center gap-4">
        <div className={cn(
          'w-14 h-14 rounded-2xl flex items-center justify-center',
          overallSentiment === 'positive' ? 'bg-green-500/10' :
          overallSentiment === 'negative' ? 'bg-red-500/10' : 'bg-muted',
        )}>
          {sentimentIcon(overallSentiment)}
        </div>
        <div>
          <p className="text-lg font-bold text-foreground capitalize">{overallSentiment} reputation</p>
          <p className="text-xs text-muted-foreground">
            {googleResultsFound} Google results · {totalMentionsFound} social mentions
          </p>
        </div>
      </div>

      {/* Sentiment bar */}
      {total > 1 && (
        <div className="space-y-2">
          <div className="flex h-2 rounded-full overflow-hidden gap-0.5">
            {b.positive > 0 && (
              <div className="bg-green-500 rounded-l-full" style={{ width: `${(b.positive / total) * 100}%` }} />
            )}
            {b.neutral > 0 && (
              <div className="bg-muted-foreground/30" style={{ width: `${(b.neutral / total) * 100}%` }} />
            )}
            {b.negative > 0 && (
              <div className="bg-red-500 rounded-r-full" style={{ width: `${(b.negative / total) * 100}%` }} />
            )}
          </div>
          <div className="flex gap-4 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500 inline-block" />{b.positive} positive</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-muted-foreground/30 inline-block" />{b.neutral} neutral</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500 inline-block" />{b.negative} negative</span>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ReputationPage() {
  const params = useParams<{ projectId: string }>()
  const projectId = params.projectId

  const [data, setData] = useState<ReputationData | null>(null)
  const [loading, setLoading] = useState(true)
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<'google' | 'mentions'>('google')

  const load = useCallback(async () => {
    try {
      const rep = await api.persona.getReputation(projectId) as unknown as ReputationData
      setData(rep)
      setError(null)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      // 404 means no check run yet - not an error, just empty state
      if (!msg.includes('404') && !msg.includes('No reputation')) {
        setError(msg)
      }
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => { load() }, [load])

  async function handleCheck() {
    setChecking(true)
    setError(null)
    try {
      const rep = await api.persona.checkReputation(projectId) as unknown as ReputationData
      setData(rep)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Reputation check failed')
    } finally {
      setChecking(false)
    }
  }

  const googleResults = data?.googleResults ?? []
  const mentions = data?.socialMentions ?? []

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="flex items-center gap-3 px-4 py-3 border-b border-border/60 bg-background/80 backdrop-blur-sm sticky top-0 z-10">
        <SidebarToggle />
        <BackButton />
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-semibold text-foreground leading-tight">Reputation Monitor</h1>
          <p className="text-xs text-muted-foreground">Google search presence + social mention sentiment</p>
        </div>
        <button
          onClick={handleCheck}
          disabled={checking}
          className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          {checking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
          {checking ? 'Checking…' : data ? 'Re-check' : 'Run check'}
        </button>
      </header>

      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive flex items-center gap-2">
            <XCircle className="w-4 h-4 shrink-0" />
            {error}
          </div>
        ) : !data ? (
          /* Empty state */
          <div className="flex flex-col items-center justify-center py-20 text-center space-y-4">
            <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center">
              <Shield className="w-7 h-7 text-muted-foreground" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">No reputation data yet</p>
              <p className="text-xs text-muted-foreground mt-1 max-w-xs">
                Run a check to scan Google for your name and analyse sentiment from social mentions.
              </p>
            </div>
            <button
              onClick={handleCheck}
              disabled={checking}
              className="flex items-center gap-1.5 text-sm font-medium px-4 py-2 rounded-xl bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              {checking ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              Run reputation check
            </button>
          </div>
        ) : (
          <>
            {/* Last checked */}
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                Last checked: {new Date(data.checkedAt).toLocaleString()}
              </p>
              {data.fullName && (
                <p className="text-xs text-muted-foreground">Searching for: <strong className="text-foreground">{data.fullName}</strong></p>
              )}
            </div>

            {/* Summary hero */}
            {data.summary && <SentimentHero summary={data.summary} />}

            {/* Stats row */}
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-xl border border-border bg-card p-4 text-center">
                <p className="text-2xl font-bold text-foreground">{googleResults.length}</p>
                <p className="text-xs text-muted-foreground mt-0.5">Google results</p>
              </div>
              <div className="rounded-xl border border-border bg-card p-4 text-center">
                <p className="text-2xl font-bold text-foreground">{mentions.length}</p>
                <p className="text-xs text-muted-foreground mt-0.5">Social mentions</p>
              </div>
              <div className="rounded-xl border border-border bg-card p-4 text-center">
                <p className={cn('text-2xl font-bold capitalize', sentimentColor(data.summary?.overallSentiment ?? 'neutral').split(' ')[0])}>
                  {data.summary?.overallSentiment ?? '–'}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">Overall tone</p>
              </div>
            </div>

            {/* Tabs */}
            <div className="flex gap-1">
              {([
                { value: 'google' as const, label: 'Google Results', count: googleResults.length, icon: <Search className="w-3.5 h-3.5" /> },
                { value: 'mentions' as const, label: 'Social Mentions', count: mentions.length, icon: <MessageSquare className="w-3.5 h-3.5" /> },
              ]).map((t) => (
                <button
                  key={t.value}
                  onClick={() => setTab(t.value)}
                  className={cn(
                    'flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium transition-colors',
                    tab === t.value
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground hover:text-foreground',
                  )}
                >
                  {t.icon}
                  {t.label}
                  {t.count > 0 && (
                    <span className={cn(
                      'text-[10px] font-bold px-1.5 py-0.5 rounded-full',
                      tab === t.value ? 'bg-white/20' : 'bg-muted-foreground/20',
                    )}>
                      {t.count}
                    </span>
                  )}
                </button>
              ))}
            </div>

            {/* Results */}
            {tab === 'google' && (
              <div className="space-y-2">
                {googleResults.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4">No Google results found.</p>
                ) : (
                  googleResults.map((r, i) => <GoogleResultCard key={i} result={r} />)
                )}
              </div>
            )}

            {tab === 'mentions' && (
              <div className="space-y-2">
                {mentions.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4">No social mentions found.</p>
                ) : (
                  mentions.map((m, i) => <MentionCard key={i} mention={m} />)
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
