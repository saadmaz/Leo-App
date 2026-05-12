'use client'

import { useParams, useRouter } from 'next/navigation'
import { Mail, Sparkles, Clock, Newspaper, AlertTriangle, Star, TrendingUp } from 'lucide-react'
import { SidebarToggle } from '@/components/layout/sidebar'

const FEATURES = [
  {
    key: 'email-sequence',
    icon: <Mail className="w-5 h-5" />,
    title: 'Email Sequence Builder',
    description: 'Write complete multi-email sequences - onboarding, nurture, re-engagement, or upsell. Optionally push directly to Loops.so.',
    path: 'email-sequence',
    credits: 15,
    tag: 'Claude + Loops',
  },
  {
    key: 'subject-lines',
    icon: <Sparkles className="w-5 h-5" />,
    title: 'Subject Line Optimiser',
    description: 'Generate subject line variants across 9 psychological angles with predicted open-rate scores, spam checks, and A/B pairs.',
    path: 'subject-lines',
    credits: 5,
    tag: 'Claude',
  },
  {
    key: 'send-time',
    icon: <Clock className="w-5 h-5" />,
    title: 'Send Time Optimiser',
    description: 'Recommend the best day and time window to send - using your historical open data or industry benchmarks for your audience.',
    path: 'send-time',
    credits: 5,
    tag: 'Claude',
  },
  {
    key: 'newsletter',
    icon: <Newspaper className="w-5 h-5" />,
    title: 'Newsletter Production',
    description: 'Write a full newsletter edition with intro, main story, quick hits, tip of the week, and CTA - HTML-ready, with Loops push option.',
    path: 'newsletter',
    credits: 15,
    tag: 'Claude + Loops',
  },
  {
    key: 'churn-risk',
    icon: <AlertTriangle className="w-5 h-5" />,
    title: 'Churn Risk Detection',
    description: 'Score each contact\'s churn risk from engagement signals, flag at-risk users, and generate personalised win-back emails automatically.',
    path: 'churn-risk',
    credits: 20,
    tag: 'Claude',
  },
  {
    key: 'lead-scoring',
    icon: <Star className="w-5 h-5" />,
    title: 'Lead Scoring',
    description: 'Score leads A–D against your ICP using firmographic and behavioural signals. Optionally sync scores back to HubSpot contacts.',
    path: 'lead-scoring',
    credits: 20,
    tag: 'Claude + HubSpot',
  },
  {
    key: 'win-loss',
    icon: <TrendingUp className="w-5 h-5" />,
    title: 'Win/Loss Analysis',
    description: 'Paste deal outcomes, reasons, and competitor intel - Claude finds patterns, builds an objection playbook, and surfaces product gaps.',
    path: 'win-loss',
    credits: 15,
    tag: 'Claude',
  },
]

export default function EmailCrmHubPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const router = useRouter()

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="border-b border-border px-6 py-4 flex items-center gap-3">
        <SidebarToggle />
        <div>
          <h1 className="font-semibold">Email Marketing &amp; CRM</h1>
          <p className="text-xs text-muted-foreground">Pillar 5 - Claude · Loops · HubSpot · ZeroBounce</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-4xl mx-auto">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {FEATURES.map((f) => (
              <button
                key={f.key}
                onClick={() => router.push(`/projects/${projectId}/email-crm/${f.path}`)}
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
