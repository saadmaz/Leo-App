'use client'

import { useParams, useRouter } from 'next/navigation'
import { FlaskConical, Globe, MessageSquare, Mail, ClipboardList, Zap } from 'lucide-react'
import { SidebarToggle } from '@/components/layout/sidebar'

const FEATURES = [
  {
    key: 'ab-test',
    icon: <FlaskConical className="w-5 h-5" />,
    title: 'A/B Test Designer',
    description: 'Design statistically rigorous experiments - Claude writes hypotheses, generates variants, calculates required sample size, and produces a pre-launch checklist.',
    path: 'ab-test',
    credits: 10,
    tag: 'Claude',
  },
  {
    key: 'cro',
    icon: <Globe className="w-5 h-5" />,
    title: 'Landing Page CRO',
    description: 'Firecrawl reads your page, Claude generates multiple copy variants per section (headline, CTA, value prop). You implement winners in VWO, Optimizely, or your CMS.',
    path: 'cro',
    credits: 15,
    tag: 'Firecrawl + Claude',
  },
  {
    key: 'messaging-resonance',
    icon: <MessageSquare className="w-5 h-5" />,
    title: 'Messaging Resonance',
    description: 'Run small paid tests on Meta, then LEO reads the results and identifies which message angle resonated most - with transferable learnings for other channels.',
    path: 'messaging-resonance',
    credits: 15,
    tag: 'Meta Ads + Claude',
  },
  {
    key: 'email-ab',
    icon: <Mail className="w-5 h-5" />,
    title: 'Email A/B Analysis',
    description: 'Paste your Loops or Brevo A/B results - Claude identifies the winner, explains why it worked, and recommends the next iteration to test.',
    path: 'email-ab',
    credits: 10,
    tag: 'Loops + Claude',
  },
  {
    key: 'experiment-log',
    icon: <ClipboardList className="w-5 h-5" />,
    title: 'Experiment Log',
    description: 'Track all experiments in one place - hypothesis, variants, status, winner, lift achieved. The source of truth that powers Learning Propagation.',
    path: 'experiment-log',
    credits: 0,
    tag: 'Native DB',
  },
  {
    key: 'learning-propagation',
    icon: <Zap className="w-5 h-5" />,
    title: 'Learning Propagation',
    description: 'Claude reads your concluded experiments and generates a synthesised learning report - with a prioritised action plan for applying insights across all your content.',
    path: 'learning-propagation',
    credits: 20,
    tag: 'Claude',
  },
]

export default function ExperimentsHubPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const router = useRouter()

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="border-b border-border px-6 py-4 flex items-center gap-3">
        <SidebarToggle />
        <div>
          <h1 className="font-semibold">Experimentation & Optimisation</h1>
          <p className="text-xs text-muted-foreground">Pillar 10 - Claude + Meta Ads + Loops</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-4xl mx-auto">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {FEATURES.map((f) => (
              <button
                key={f.key}
                onClick={() => router.push(`/projects/${projectId}/experiments/${f.path}`)}
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
                    <p className="text-xs text-muted-foreground mt-1">
                      {f.credits > 0 ? `${f.credits} credits` : 'Free'}
                    </p>
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
