'use client'

import { useParams, useRouter } from 'next/navigation'
import { FileText, Users, Mail, Eye, AlertTriangle, Trophy, BarChart2, Handshake } from 'lucide-react'
import { SidebarToggle } from '@/components/layout/sidebar'

const FEATURES = [
  {
    key: 'press-release',
    icon: <FileText className="w-5 h-5" />,
    title: 'Press Release Writer',
    description: 'Draft a brand-aligned, AP-style press release for product launches, funding rounds, partnerships, milestones, and more.',
    path: 'press-release',
    credits: 10,
    tag: 'Claude',
  },
  {
    key: 'media-list',
    icon: <Users className="w-5 h-5" />,
    title: 'Media List Builder',
    description: 'Identify target journalists and publications for your story. Hunter.io verifies emails. Claude prioritises and annotates the list.',
    path: 'media-list',
    credits: 20,
    tag: 'Hunter.io + Claude',
  },
  {
    key: 'pitch-email',
    icon: <Mail className="w-5 h-5" />,
    title: 'Pitch Email Generator',
    description: 'Write a personalised journalist pitch with 3 subject line variants, a follow-up template, and an angle-fit score.',
    path: 'pitch-email',
    credits: 10,
    tag: 'Claude',
  },
  {
    key: 'coverage-monitor',
    icon: <Eye className="w-5 h-5" />,
    title: 'Coverage Monitoring',
    description: 'Scan news and Reddit for brand mentions over a rolling window. Claude synthesises sentiment, key themes, and alerts.',
    path: 'coverage-monitor',
    credits: 15,
    tag: 'SerpAPI + Apify + Claude',
  },
  {
    key: 'crisis-comms',
    icon: <AlertTriangle className="w-5 h-5" />,
    title: 'Crisis Communications',
    description: 'Generate a complete crisis playbook - holding statement, stakeholder communications, internal FAQ, action checklist, and media Q&A.',
    path: 'crisis-comms',
    credits: 20,
    tag: 'Claude',
  },
  {
    key: 'awards',
    icon: <Trophy className="w-5 h-5" />,
    title: 'Award Submissions',
    description: 'Firecrawl reads the award criteria. Claude drafts a compelling, evidence-based submission aligned to what judges are looking for.',
    path: 'awards',
    credits: 15,
    tag: 'Firecrawl + Claude',
  },
  {
    key: 'analyst-relations',
    icon: <BarChart2 className="w-5 h-5" />,
    title: 'Analyst Relations',
    description: 'Prepare briefing documents for Gartner, Forrester, IDC, and others. Claude reads their research and prepares your positioning + Q&A.',
    path: 'analyst-relations',
    credits: 20,
    tag: 'Firecrawl + Claude',
  },
  {
    key: 'partnership-comms',
    icon: <Handshake className="w-5 h-5" />,
    title: 'Partnership Communications',
    description: 'Draft partnership outreach emails, proposals, joint press releases, or internal announcements - with follow-up sequences and objection handling.',
    path: 'partnership-comms',
    credits: 10,
    tag: 'Claude',
  },
]

export default function PRCommsHubPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const router = useRouter()

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="border-b border-border px-6 py-4 flex items-center gap-3">
        <SidebarToggle />
        <div>
          <h1 className="font-semibold">PR & Communications</h1>
          <p className="text-xs text-muted-foreground">Pillar 8 - Claude + Hunter.io + Firecrawl</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-4xl mx-auto">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {FEATURES.map((f) => (
              <button
                key={f.key}
                onClick={() => router.push(`/projects/${projectId}/pr-comms/${f.path}`)}
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
