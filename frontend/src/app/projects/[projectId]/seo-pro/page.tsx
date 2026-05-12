'use client'

import { useParams, useRouter } from 'next/navigation'
import { Search, TrendingUp, FileSearch, Star, RefreshCw, Wrench } from 'lucide-react'
import { SidebarToggle } from '@/components/layout/sidebar'

const FEATURES = [
  {
    key: 'keywords',
    icon: <Search className="w-5 h-5" />,
    title: 'Keyword Research',
    description: 'Discover keyword ideas with search volume, difficulty, CPC, and Claude-generated content angles.',
    path: 'keywords',
    credits: 10,
    tag: 'DataForSEO + Claude',
  },
  {
    key: 'serp-intent',
    icon: <TrendingUp className="w-5 h-5" />,
    title: 'SERP Intent Mapping',
    description: 'Classify search intent across top-10 results and get the ideal content format and angle.',
    path: 'serp-intent',
    credits: 10,
    tag: 'DataForSEO + Claude',
  },
  {
    key: 'on-page',
    icon: <FileSearch className="w-5 h-5" />,
    title: 'On-Page SEO Audit',
    description: 'Full page audit - title, meta, content score, internal links, structured data issues, and fixes.',
    path: 'on-page',
    credits: 15,
    tag: 'DataForSEO + Claude',
  },
  {
    key: 'featured-snippet',
    icon: <Star className="w-5 h-5" />,
    title: 'Featured Snippet Optimizer',
    description: 'Win position zero - detect existing snippets, get Claude-optimised content to claim them.',
    path: 'featured-snippet',
    credits: 10,
    tag: 'DataForSEO + Claude',
  },
  {
    key: 'freshness',
    icon: <RefreshCw className="w-5 h-5" />,
    title: 'Content Freshness Check',
    description: 'Check if a page is losing rank, diagnose staleness signals, and get a prioritised refresh plan.',
    path: 'freshness',
    credits: 10,
    tag: 'DataForSEO + Claude',
  },
  {
    key: 'technical',
    icon: <Wrench className="w-5 h-5" />,
    title: 'Technical SEO Monitor',
    description: 'Deep technical audit - Core Web Vitals, crawlability, structured data, canonicals, and mobile.',
    path: 'technical',
    credits: 20,
    tag: 'DataForSEO + Claude',
  },
]

export default function SeoProHubPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const router = useRouter()

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="border-b border-border px-6 py-4 flex items-center gap-3">
        <SidebarToggle />
        <div>
          <h1 className="font-semibold">SEO &amp; Organic Search</h1>
          <p className="text-xs text-muted-foreground">Pillar 3 - DataForSEO + Claude</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-4xl mx-auto">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {FEATURES.map((f) => (
              <button
                key={f.key}
                onClick={() => router.push(`/projects/${projectId}/seo-pro/${f.path}`)}
                className="text-left p-5 rounded-xl border border-border bg-card hover:border-primary/50 hover:shadow-sm transition-all group"
              >
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="p-2 rounded-lg bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                    {f.icon}
                  </div>
                  <div className="text-right">
                    <span className="text-xs font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                      {f.tag}
                    </span>
                    <p className="text-xs text-muted-foreground mt-1">{f.credits} credits</p>
                  </div>
                </div>
                <h3 className="font-semibold text-sm mb-1">{f.title}</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">{f.description}</p>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
