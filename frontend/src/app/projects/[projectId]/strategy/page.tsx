'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import {
  Users, TrendingUp, Target, DollarSign, UserCircle,
  BarChart3, MessageSquare, Map, Rocket, Shield,
} from 'lucide-react'
import { SidebarToggle } from '@/components/layout/sidebar'
import { HubFeatureCard } from '@/components/pillar1/HubFeatureCard'
import { api } from '@/lib/api'
import type { Pillar1Doc } from '@/types'

const FEATURES = [
  {
    key: 'icp',
    icon: <Users className="w-5 h-5" />,
    title: 'ICP Builder',
    description: 'Define your ideal customer profiles with Apollo enrichment and Brand Core alignment.',
    path: 'icp',
    credits: 40,
  },
  {
    key: 'gtm',
    icon: <TrendingUp className="w-5 h-5" />,
    title: 'GTM Strategy',
    description: 'Build a go-to-market plan backed by live market research and competitor analysis.',
    path: 'gtm',
    credits: 35,
  },
  {
    key: 'okr',
    icon: <Target className="w-5 h-5" />,
    title: 'OKR Drafting',
    description: 'Draft quarterly objectives and key results aligned with your brand goals.',
    path: 'okr',
    credits: 10,
  },
  {
    key: 'budget',
    icon: <DollarSign className="w-5 h-5" />,
    title: 'Budget Modelling',
    description: 'Allocate your marketing budget across channels with ROAS projections.',
    path: 'budget',
    credits: 30,
  },
  {
    key: 'persona',
    icon: <UserCircle className="w-5 h-5" />,
    title: 'Persona Generation',
    description: 'Create vivid buyer personas enriched with Apollo data and Brand Core.',
    path: 'personas',
    credits: 25,
  },
  {
    key: 'market_sizing',
    icon: <BarChart3 className="w-5 h-5" />,
    title: 'Market Sizing',
    description: 'Calculate TAM, SAM, and SOM with live market research and sourced benchmarks.',
    path: 'market-size',
    credits: 40,
  },
  {
    key: 'positioning',
    icon: <MessageSquare className="w-5 h-5" />,
    title: 'Positioning Workshop',
    description: 'A guided 7-stage conversation to craft your brand positioning statement.',
    path: 'positioning',
    credits: 5,
  },
  {
    key: 'comp_map',
    icon: <Map className="w-5 h-5" />,
    title: 'Positioning Map',
    description: 'Map your brand and competitors on a 2D grid to find your strategic white space.',
    path: 'comp-map',
    credits: 35,
  },
  {
    key: 'launch',
    icon: <Rocket className="w-5 h-5" />,
    title: 'Launch Planning',
    description: 'Build a pre-launch to post-launch timeline with channel-specific content hooks.',
    path: 'launch',
    credits: 20,
  },
  {
    key: 'risk_flag',
    icon: <Shield className="w-5 h-5" />,
    title: 'Risk Flagging',
    description: 'Scan for competitive, market, and regulatory risks using live signal monitoring.',
    path: 'risk',
    credits: 30,
  },
]

export default function StrategyHubPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const [latestDocs, setLatestDocs] = useState<Record<string, Pillar1Doc | null>>({})

  useEffect(() => {
    // Load latest doc for each feature to show last-run dates
    const docTypes = ['icp', 'gtm', 'okr', 'budget', 'persona', 'market_sizing', 'positioning', 'comp_map', 'launch', 'risk_flag']
    docTypes.forEach(async (dt) => {
      try {
        const res = await api.pillar1.listDocs(projectId, dt)
        setLatestDocs((prev) => ({ ...prev, [dt]: res.docs[0] ?? null }))
      } catch {
        // ignore - just show "never run"
      }
    })
  }, [projectId])

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Header */}
      <div className="border-b border-border px-6 py-4 flex items-center gap-3">
        <SidebarToggle />
        <div>
          <h1 className="font-semibold text-lg">Strategy & Planning</h1>
          <p className="text-xs text-muted-foreground">10 AI-powered strategy tools built on your Brand Core</p>
        </div>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 max-w-7xl mx-auto">
          {FEATURES.map((f) => {
            const doc = latestDocs[f.key]
            return (
              <HubFeatureCard
                key={f.key}
                icon={f.icon}
                title={f.title}
                description={f.description}
                href={`/projects/${projectId}/strategy/${f.path}`}
                lastRun={doc?.created_at ?? null}
                status={doc ? (doc.status === 'complete' ? 'complete' : 'draft') : 'never'}
                credits={f.credits}
              />
            )
          })}
        </div>
      </div>
    </div>
  )
}
