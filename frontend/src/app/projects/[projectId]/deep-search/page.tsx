'use client'

import { useState, useRef, useEffect } from 'react'
import { useParams } from 'next/navigation'
import { Search, Loader2, Globe, FileText, ChevronDown, ChevronRight, Clock, Zap, ExternalLink } from 'lucide-react'
import { api } from '@/lib/api'
import { toast } from 'sonner'
import type { DeepSearchHistory } from '@/types'

// ---------------------------------------------------------------------------
// Types for SSE events
// ---------------------------------------------------------------------------
interface StepEvent { type: 'step'; step: string; message: string }
interface SerpEvent { type: 'serp_results'; results: Array<{ title: string; url: string; snippet: string; position: number }>; relatedSearches: string[]; peopleAlsoAsk: string[] }
interface ScrapedEvent { type: 'scraped_page'; url: string; title?: string; markdown: string; extract: Record<string, unknown> }
interface DoneEvent { type: 'done'; query: string; resultId: string }
type SearchEvent = StepEvent | SerpEvent | ScrapedEvent | DoneEvent

export default function DeepSearchPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const [query, setQuery] = useState('')
  const [scrapeN, setScrapeN] = useState(3)
  const [running, setRunning] = useState(false)
  const [events, setEvents] = useState<SearchEvent[]>([])
  const [history, setHistory] = useState<DeepSearchHistory[]>([])
  const [historyLoading, setHistoryLoading] = useState(true)
  const [expandedHistory, setExpandedHistory] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    api.deepSearch.history(projectId)
      .then((r) => setHistory(r.results))
      .catch(console.error)
      .finally(() => setHistoryLoading(false))
  }, [projectId])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [events])

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    if (!query.trim() || running) return
    setRunning(true)
    setEvents([])
    try {
      await api.deepSearch.run(
        projectId,
        query.trim(),
        scrapeN,
        (raw) => {
          const ev = raw as unknown as SearchEvent
          setEvents((prev) => [...prev, ev])
        },
        () => {
          setRunning(false)
          // Reload history
          api.deepSearch.history(projectId).then((r) => setHistory(r.results)).catch(console.error)
        },
        (msg) => {
          toast.error(msg)
          setRunning(false)
        },
      )
    } catch (err) {
      toast.error('Deep search failed')
      console.error(err)
      setRunning(false)
    }
  }

  const serpEvent = events.find((e): e is SerpEvent => e.type === 'serp_results')
  const scrapedEvents = events.filter((e): e is ScrapedEvent => e.type === 'scraped_page')
  const doneEvent = events.find((e): e is DoneEvent => e.type === 'done')
  const steps = events.filter((e): e is StepEvent => e.type === 'step')

  return (
    <div className="flex h-full min-h-screen bg-background">
      {/* Main area */}
      <div className="flex flex-col flex-1 min-w-0">
        {/* Header */}
        <div className="border-b border-border px-6 py-4">
          <div className="flex items-center gap-2 mb-1">
            <Search className="w-5 h-5 text-primary" />
            <h1 className="text-lg font-semibold">Deep Search</h1>
          </div>
          <p className="text-xs text-muted-foreground">Searches the web via SerpAPI and scrapes top pages with Firecrawl for deep analysis.</p>
        </div>

        {/* Search form */}
        <div className="px-6 py-4 border-b border-border">
          <form onSubmit={handleSearch} className="flex gap-2">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="What do you want to research? e.g. 'best email marketing tools 2025'"
                className="w-full pl-9 pr-4 py-2 text-sm rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                disabled={running}
              />
            </div>
            <select
              value={scrapeN}
              onChange={(e) => setScrapeN(Number(e.target.value))}
              className="text-xs border border-border rounded-lg px-2 bg-background text-muted-foreground focus:outline-none disabled:opacity-50"
              disabled={running}
            >
              <option value={1}>Scrape 1 page</option>
              <option value={3}>Scrape 3 pages</option>
              <option value={5}>Scrape 5 pages</option>
            </select>
            <button
              type="submit"
              disabled={running || !query.trim()}
              className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
              {running ? 'Searching…' : 'Deep Search'}
            </button>
          </form>
          <p className="mt-1.5 text-[10px] text-muted-foreground">Costs 25 credits per search</p>
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {/* Step log */}
          {steps.length > 0 && (
            <div className="flex flex-col gap-1">
              {steps.map((s, i) => (
                <div key={i} className="flex items-center gap-2 text-xs text-muted-foreground">
                  {running && i === steps.length - 1
                    ? <Loader2 className="w-3 h-3 animate-spin shrink-0" />
                    : <span className="w-3 h-3 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                        <span className="w-1.5 h-1.5 rounded-full bg-primary" />
                      </span>
                  }
                  {s.message}
                </div>
              ))}
            </div>
          )}

          {/* SERP results */}
          {serpEvent && (
            <div className="space-y-2">
              <h2 className="text-sm font-semibold flex items-center gap-1.5">
                <Globe className="w-4 h-4 text-blue-500" />
                Search Results
                <span className="text-xs font-normal text-muted-foreground">({serpEvent.results.length} results)</span>
              </h2>
              <div className="grid gap-2">
                {serpEvent.results.map((r, i) => (
                  <a
                    key={i}
                    href={r.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group block p-3 rounded-lg border border-border hover:border-primary/40 hover:bg-muted/30 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-primary group-hover:underline truncate">{r.title}</p>
                        <p className="text-[11px] text-muted-foreground truncate">{r.url}</p>
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{r.snippet}</p>
                      </div>
                      <ExternalLink className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                  </a>
                ))}
              </div>

              {serpEvent.relatedSearches.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {serpEvent.relatedSearches.slice(0, 6).map((s, i) => (
                    <button
                      key={i}
                      onClick={() => setQuery(s)}
                      className="text-[11px] px-2 py-1 rounded-full border border-border hover:border-primary/40 hover:bg-muted/30 text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Scraped pages */}
          {scrapedEvents.length > 0 && (
            <div className="space-y-2">
              <h2 className="text-sm font-semibold flex items-center gap-1.5">
                <FileText className="w-4 h-4 text-green-500" />
                Page Deep-Dives
                <span className="text-xs font-normal text-muted-foreground">({scrapedEvents.length} scraped)</span>
              </h2>
              {scrapedEvents.map((page, i) => (
                <ScrapedPageCard key={i} page={page} index={i} />
              ))}
            </div>
          )}

          {/* Done banner */}
          {doneEvent && (
            <div className="p-3 rounded-lg bg-primary/5 border border-primary/20 text-sm text-muted-foreground">
              Search complete - results saved to history.
            </div>
          )}

          {/* Empty state */}
          {!running && events.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <Search className="w-12 h-12 text-muted-foreground/20 mb-4" />
              <p className="text-sm font-medium text-muted-foreground">Enter a query to start a deep search</p>
              <p className="text-xs text-muted-foreground/60 mt-1">Results are scraped, structured, and saved for reuse</p>
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </div>

      {/* History panel */}
      <div className="w-72 shrink-0 border-l border-border flex flex-col">
        <div className="px-4 py-3 border-b border-border">
          <div className="flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5 text-muted-foreground" />
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">History</h2>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {historyLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
            </div>
          ) : history.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <p className="text-xs text-muted-foreground">No previous searches yet.</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {history.map((item) => (
                <HistoryItem
                  key={item.id}
                  item={item}
                  expanded={expandedHistory === item.id}
                  onToggle={() => setExpandedHistory((prev) => prev === item.id ? null : item.id)}
                  onRerun={() => setQuery(item.query)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// ScrapedPageCard
// ---------------------------------------------------------------------------
function ScrapedPageCard({ page, index }: { page: ScrapedEvent; index: number }) {
  const [expanded, setExpanded] = useState(index === 0)

  const extractEntries = Object.entries(page.extract).filter(([, v]) => v && String(v).trim())

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center justify-between w-full px-4 py-2.5 hover:bg-muted/30 transition-colors text-left"
      >
        <div className="min-w-0">
          <p className="text-sm font-medium truncate">{page.title ?? page.url}</p>
          <p className="text-[11px] text-muted-foreground truncate">{page.url}</p>
        </div>
        {expanded
          ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0 ml-2" />
          : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0 ml-2" />
        }
      </button>

      {expanded && (
        <div className="border-t border-border">
          {/* Structured extract */}
          {extractEntries.length > 0 && (
            <div className="px-4 py-3 space-y-1.5 bg-muted/20">
              {extractEntries.map(([k, v]) => (
                <div key={k} className="text-xs">
                  <span className="font-medium capitalize text-muted-foreground">{k.replace(/_/g, ' ')}: </span>
                  <span className="text-foreground">{String(v)}</span>
                </div>
              ))}
            </div>
          )}
          {/* Markdown content */}
          {page.markdown && (
            <div className="px-4 py-3 max-h-60 overflow-y-auto">
              <pre className="text-[11px] text-muted-foreground whitespace-pre-wrap font-sans leading-relaxed">{page.markdown.slice(0, 2000)}{page.markdown.length > 2000 ? '…' : ''}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// HistoryItem
// ---------------------------------------------------------------------------
function HistoryItem({ item, expanded, onToggle, onRerun }: {
  item: DeepSearchHistory
  expanded: boolean
  onToggle: () => void
  onRerun: () => void
}) {
  const date = new Date(item.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const scrapedCount = item.events.filter((e) => e.type === 'scraped_page').length
  const hasSerpResults = item.events.some((e) => e.type === 'serp_results')

  return (
    <div>
      <button
        onClick={onToggle}
        className="flex items-start gap-2 w-full px-4 py-3 hover:bg-muted/30 transition-colors text-left"
      >
        {expanded
          ? <ChevronDown className="w-3 h-3 text-muted-foreground shrink-0 mt-0.5" />
          : <ChevronRight className="w-3 h-3 text-muted-foreground shrink-0 mt-0.5" />
        }
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium truncate">{item.query}</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            {date} · {hasSerpResults ? 'web results' : 'no results'} · {scrapedCount} scraped
          </p>
        </div>
      </button>
      {expanded && (
        <div className="px-4 pb-3">
          <button
            onClick={onRerun}
            className="text-[11px] text-primary hover:underline"
          >
            Re-run this search
          </button>
        </div>
      )}
    </div>
  )
}
