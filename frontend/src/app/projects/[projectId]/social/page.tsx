'use client'

import { useParams, useRouter } from 'next/navigation'
import { MessageSquare, Star, Users } from 'lucide-react'
import { SidebarToggle } from '@/components/layout/sidebar'

const FEATURES = [
  {
    key: 'community',
    icon: <MessageSquare className="w-5 h-5" />,
    title: 'Community Management',
    description: 'Fetch comments from Ayrshare or paste them manually - Claude drafts brand-aligned replies with priority triage, escalation flags, and follow-up actions.',
    path: 'community',
    credits: 10,
    tag: 'Claude + Ayrshare',
  },
  {
    key: 'social-proof',
    icon: <Star className="w-5 h-5" />,
    title: 'Social Proof Harvesting',
    description: 'Search brand mentions across platforms, surface top testimonials and UGC moments, identify case study leads, and get a social proof gap analysis.',
    path: 'social-proof',
    credits: 15,
    tag: 'Claude + Tavily',
  },
  {
    key: 'employee-advocacy',
    icon: <Users className="w-5 h-5" />,
    title: 'Employee Advocacy',
    description: 'Generate pre-approved posts in authentic employee voice - first-person, platform-specific, weaving in brand key messages without sounding corporate.',
    path: 'employee-advocacy',
    credits: 10,
    tag: 'Claude + Ayrshare',
  },
]

const EXISTING = [
  { label: 'Multi-Platform Scheduling', where: 'Personal Brand → Publishing', note: 'Ayrshare OAuth + scheduler' },
  { label: 'Social Listening', where: 'Intelligence → Monitoring', note: 'Competitor + brand drift tracking' },
  { label: 'Trend Detection', where: 'Intelligence', note: 'Hashtag + trend alerts' },
  { label: 'Hashtag Strategy', where: 'Intelligence → Hashtag Suggest', note: '4-tier system' },
  { label: 'Platform Analytics', where: 'Personal Brand → Analytics', note: 'Ayrshare per-platform data' },
  { label: 'Social Ad Creative', where: 'Create → Image Studio', note: 'Carousel Studio (LEO)' },
]

export default function SocialHubPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const router = useRouter()

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="border-b border-border px-6 py-4 flex items-center gap-3">
        <SidebarToggle />
        <div>
          <h1 className="font-semibold">Social Media</h1>
          <p className="text-xs text-muted-foreground">Pillar 6 - Claude · Ayrshare · Tavily</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-4xl mx-auto space-y-8">

          {/* New gap features */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">New Features</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {FEATURES.map((f) => (
                <button
                  key={f.key}
                  onClick={() => router.push(`/projects/${projectId}/social/${f.path}`)}
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

          {/* Already built - pointer list */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Already Built in LEO</p>
            <div className="rounded-xl border border-border bg-card divide-y divide-border">
              {EXISTING.map((e) => (
                <div key={e.label} className="flex items-center justify-between px-4 py-3">
                  <div>
                    <p className="text-xs font-medium">{e.label}</p>
                    <p className="text-[10px] text-muted-foreground">{e.note}</p>
                  </div>
                  <span className="text-[10px] text-muted-foreground bg-muted px-2 py-0.5 rounded-full shrink-0">
                    {e.where}
                  </span>
                </div>
              ))}
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}
