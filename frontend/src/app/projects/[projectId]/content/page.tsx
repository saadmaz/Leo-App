'use client'

import { useParams, useRouter } from 'next/navigation'
import {
  Type, ImageIcon, Video, Mic, CheckCircle, Globe, BookOpen, Search,
} from 'lucide-react'
import { SidebarToggle } from '@/components/layout/sidebar'

const FEATURES = [
  {
    key: 'headline',
    icon: <Type className="w-5 h-5" />,
    title: 'Headline A/B Variants',
    description: 'Generate platform-optimised headline variants with angle rationale for any piece of content.',
    path: 'headline',
    credits: 5,
    tag: 'Claude',
  },
  {
    key: 'visual-brief',
    icon: <ImageIcon className="w-5 h-5" />,
    title: 'Visual Brief',
    description: 'Create a detailed creative brief for designers - colour palette, layout, Midjourney prompt included.',
    path: 'visual-brief',
    credits: 5,
    tag: 'Claude',
  },
  {
    key: 'video-script',
    icon: <Video className="w-5 h-5" />,
    title: 'Video Script',
    description: 'Write full video scripts with timestamps, B-roll suggestions, and CTA for YouTube, TikTok, or LinkedIn.',
    path: 'video-script',
    credits: 15,
    tag: 'Claude',
  },
  {
    key: 'podcast',
    icon: <Mic className="w-5 h-5" />,
    title: 'Podcast Show Notes',
    description: 'Upload an audio URL or paste a transcript - get show notes, timestamps, quotes, and a LinkedIn post.',
    path: 'podcast',
    credits: 20,
    tag: 'Whisper + Claude',
  },
  {
    key: 'quality',
    icon: <CheckCircle className="w-5 h-5" />,
    title: 'Content Quality Score',
    description: 'Score content across 6 dimensions - clarity, brand voice, engagement, SEO, platform fit, and CTA.',
    path: 'quality',
    credits: 10,
    tag: 'Claude',
  },
  {
    key: 'translate',
    icon: <Globe className="w-5 h-5" />,
    title: 'Multilingual Adaptation',
    description: 'Translate content with DeepL then adapt brand voice and cultural nuances with Claude.',
    path: 'translate',
    credits: 15,
    tag: 'DeepL + Claude',
  },
  {
    key: 'case-study',
    icon: <BookOpen className="w-5 h-5" />,
    title: 'Case Study Production',
    description: 'Turn client results into a publication-ready case study with key stats, sections, and a CTA.',
    path: 'case-study',
    credits: 15,
    tag: 'Claude',
  },
  {
    key: 'gap',
    icon: <Search className="w-5 h-5" />,
    title: 'Content Gap Analysis',
    description: 'Discover keywords your competitors rank for that you don\'t - with content angle suggestions.',
    path: 'gap',
    credits: 40,
    tag: 'DataForSEO + Claude',
  },
]

export default function ContentHubPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const router = useRouter()

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Header */}
      <div className="border-b border-border px-6 py-4 flex items-center gap-3">
        <SidebarToggle />
        <div>
          <h1 className="font-semibold">Content Studio</h1>
          <p className="text-xs text-muted-foreground">Pillar 2 - Content Creation & Management</p>
        </div>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-4xl mx-auto">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {FEATURES.map((f) => (
              <button
                key={f.key}
                onClick={() => router.push(`/projects/${projectId}/content/${f.path}`)}
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
