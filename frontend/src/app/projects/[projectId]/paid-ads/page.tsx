'use client'

import { useParams, useRouter } from 'next/navigation'
import { FileText, Copy, RefreshCw, BarChart2 } from 'lucide-react'
import { SidebarToggle } from '@/components/layout/sidebar'

const FEATURES = [
  {
    key: 'ad-brief',
    icon: <FileText className="w-5 h-5" />,
    title: 'Campaign Brief Generator',
    description: 'Build a comprehensive paid advertising brief - platform strategy, budget allocation, bidding approach, creative specs, and KPIs.',
    path: 'ad-brief',
    credits: 15,
    tag: 'Claude',
  },
  {
    key: 'ad-copy',
    icon: <Copy className="w-5 h-5" />,
    title: 'Ad Copy Generator',
    description: 'Generate multi-variant platform-specific ad copy with correct character limits - Google Search, Meta Feed, TikTok, LinkedIn, and more.',
    path: 'ad-copy',
    credits: 10,
    tag: 'Claude',
  },
  {
    key: 'retargeting',
    icon: <RefreshCw className="w-5 h-5" />,
    title: 'Retargeting Sequence Builder',
    description: 'Design a full TOFU → MOFU → BOFU retargeting funnel with per-touch-point copy, timing, creative direction, and audience exclusion logic.',
    path: 'retargeting',
    credits: 20,
    tag: 'Claude',
  },
  {
    key: 'attribution',
    icon: <BarChart2 className="w-5 h-5" />,
    title: 'Cross-Channel Attribution',
    description: 'Connect GA4 or enter channel data manually - Claude interprets attribution, compares models, and recommends budget reallocation.',
    path: 'attribution',
    credits: 20,
    tag: 'GA4 + Claude',
  },
]

export default function PaidAdsHubPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const router = useRouter()

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="border-b border-border px-6 py-4 flex items-center gap-3">
        <SidebarToggle />
        <div>
          <h1 className="font-semibold">Paid Advertising</h1>
          <p className="text-xs text-muted-foreground">Pillar 4 - Claude + GA4</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-4xl mx-auto">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {FEATURES.map((f) => (
              <button
                key={f.key}
                onClick={() => router.push(`/projects/${projectId}/paid-ads/${f.path}`)}
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
