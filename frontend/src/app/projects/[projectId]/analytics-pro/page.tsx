'use client'

import { useParams, useRouter } from 'next/navigation'
import { LayoutDashboard, Users, TrendingUp, AlertTriangle, BarChart2, DollarSign, FileText } from 'lucide-react'
import { SidebarToggle } from '@/components/layout/sidebar'

const FEATURES = [
  {
    key: 'unified-dashboard',
    icon: <LayoutDashboard className="w-5 h-5" />,
    title: 'Unified Dashboard',
    description: 'Aggregate GA4, Meta Ads, and manual channel data into one cross-channel executive view - with Claude narrative and budget shift recommendations.',
    path: 'unified-dashboard',
    credits: 15,
    tag: 'Claude + GA4 + Meta',
  },
  {
    key: 'cohort',
    icon: <Users className="w-5 h-5" />,
    title: 'Cohort Analysis',
    description: 'Paste retention or activation cohort data - Claude identifies the critical drop-off period, diagnoses root causes, and prescribes quick wins.',
    path: 'cohort',
    credits: 20,
    tag: 'Claude',
  },
  {
    key: 'funnel',
    icon: <TrendingUp className="w-5 h-5" />,
    title: 'Funnel Conversion Analysis',
    description: 'Enter funnel step counts - Claude calculates conversion rates, finds the biggest leak, and produces a prioritised CRO fix list with expected impact.',
    path: 'funnel',
    credits: 15,
    tag: 'Claude',
  },
  {
    key: 'anomaly',
    icon: <AlertTriangle className="w-5 h-5" />,
    title: 'Anomaly Detection',
    description: 'Paste time-series metric data - LEO runs statistical threshold analysis (IQR + Z-score), then Claude interprets each anomaly with urgency ratings.',
    path: 'anomaly',
    credits: 10,
    tag: 'Claude + Statistics',
  },
  {
    key: 'forecast',
    icon: <BarChart2 className="w-5 h-5" />,
    title: 'Forecasting Model',
    description: 'Provide historical monthly/weekly data - Claude projects base, optimistic, and pessimistic scenarios with confidence ratings and target recommendations.',
    path: 'forecast',
    credits: 15,
    tag: 'Claude',
  },
  {
    key: 'cac-ltv',
    icon: <DollarSign className="w-5 h-5" />,
    title: 'CAC + LTV Tracking',
    description: 'Calculate customer acquisition cost and lifetime value by channel. Optionally pull from Stripe and HubSpot. Claude rates your unit economics against SaaS benchmarks.',
    path: 'cac-ltv',
    credits: 20,
    tag: 'Claude + Stripe + HubSpot',
  },
  {
    key: 'board-report',
    icon: <FileText className="w-5 h-5" />,
    title: 'Board-Ready Reporting',
    description: 'Enter your metrics, wins, challenges, and priorities - Claude writes a polished board update or investor memo with narrative, KPI table, and talk track.',
    path: 'board-report',
    credits: 25,
    tag: 'Claude',
  },
]

const EXISTING = [
  { label: 'Weekly Brand Health Report', where: 'Reports → Weekly Digest', note: 'AI digest of content + performance' },
  { label: 'Research Reports', where: 'Reports → Research', note: 'Deep async reports with download' },
  { label: 'Content Analytics Overview', where: 'Analytics', note: 'LEO content performance tracking' },
  { label: 'Competitive Benchmarking', where: 'Intelligence', note: 'DataForSEO + Apify competitor intel' },
  { label: 'Revenue Attribution (v1)', where: 'Paid Ads → Attribution', note: 'GA4 channel attribution model' },
]

export default function AnalyticsProHubPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const router = useRouter()

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="border-b border-border px-6 py-4 flex items-center gap-3">
        <SidebarToggle />
        <div>
          <h1 className="font-semibold">Analytics & Reporting</h1>
          <p className="text-xs text-muted-foreground">Pillar 7 - Claude · GA4 · Stripe · HubSpot · Meta</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-4xl mx-auto space-y-8">
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Analytics Features</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {FEATURES.map((f) => (
                <button
                  key={f.key}
                  onClick={() => router.push(`/projects/${projectId}/analytics-pro/${f.path}`)}
                  className="text-left p-5 rounded-xl border border-border bg-card hover:border-primary/50 hover:shadow-sm transition-all group"
                >
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="p-2 rounded-lg bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                      {f.icon}
                    </div>
                    <div className="text-right">
                      <span className="text-xs font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded-full">{f.tag}</span>
                      <p className="text-xs text-muted-foreground mt-1">{f.credits} credits</p>
                    </div>
                  </div>
                  <h3 className="font-semibold text-sm mb-1">{f.title}</h3>
                  <p className="text-xs text-muted-foreground leading-relaxed">{f.description}</p>
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Already Built in LEO</p>
            <div className="rounded-xl border border-border bg-card divide-y divide-border">
              {EXISTING.map((e) => (
                <div key={e.label} className="flex items-center justify-between px-4 py-3">
                  <div>
                    <p className="text-xs font-medium">{e.label}</p>
                    <p className="text-[10px] text-muted-foreground">{e.note}</p>
                  </div>
                  <span className="text-[10px] text-muted-foreground bg-muted px-2 py-0.5 rounded-full shrink-0">{e.where}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
