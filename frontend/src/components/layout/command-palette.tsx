'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Search, LayoutDashboard, Library, CalendarDays, BarChart2, Users,
  Zap, Globe, Mail, ImageIcon, FileText, ClipboardCheck, ClipboardList,
  Send, Hash, BookOpen, LayoutTemplate, TrendingUp, Sparkles, X,
  ArrowRight, ShieldCheck, Bell,
} from 'lucide-react'
import { useAppStore } from '@/stores/app-store'
import { cn } from '@/lib/utils'

// ---------------------------------------------------------------------------
// Command definitions
// ---------------------------------------------------------------------------

type CommandSection = 'navigation' | 'action'

interface Command {
  id: string
  label: string
  description?: string
  icon: React.ReactNode
  section: CommandSection
  projectRequired?: boolean
  action: (projectId: string) => void
}

function buildCommands(
  router: ReturnType<typeof useRouter>,
  actions: {
    openCampaigns: () => void
    openWizard: () => void
    openHashtags: () => void
    openVoiceScorer: () => void
  },
): Command[] {
  return [
    // Navigation - project pages
    {
      id: 'dashboard',
      label: 'Dashboard',
      description: 'Overview & stats',
      icon: <LayoutDashboard className="w-4 h-4" />,
      section: 'navigation',
      projectRequired: true,
      action: (pid) => router.push(`/projects/${pid}/dashboard`),
    },
    {
      id: 'library',
      label: 'Content Library',
      description: 'Manage your content',
      icon: <Library className="w-4 h-4" />,
      section: 'navigation',
      projectRequired: true,
      action: (pid) => router.push(`/projects/${pid}/library`),
    },
    {
      id: 'calendar',
      label: 'Content Calendar',
      description: 'Schedule & plan posts',
      icon: <CalendarDays className="w-4 h-4" />,
      section: 'navigation',
      projectRequired: true,
      action: (pid) => router.push(`/projects/${pid}/calendar`),
    },
    {
      id: 'planner',
      label: 'Content Planner',
      description: 'AI content plan generator',
      icon: <Sparkles className="w-4 h-4" />,
      section: 'navigation',
      projectRequired: true,
      action: (pid) => router.push(`/projects/${pid}/planner`),
    },
    {
      id: 'analytics',
      label: 'Analytics',
      description: 'Performance insights',
      icon: <BarChart2 className="w-4 h-4" />,
      section: 'navigation',
      projectRequired: true,
      action: (pid) => router.push(`/projects/${pid}/analytics`),
    },
    {
      id: 'posts',
      label: 'Posts',
      description: 'Task board for posts',
      icon: <ClipboardList className="w-4 h-4" />,
      section: 'navigation',
      projectRequired: true,
      action: (pid) => router.push(`/projects/${pid}/posts`),
    },
    {
      id: 'review',
      label: 'Review Queue',
      description: 'Approve or reject content',
      icon: <ClipboardCheck className="w-4 h-4" />,
      section: 'navigation',
      projectRequired: true,
      action: (pid) => router.push(`/projects/${pid}/review`),
    },
    {
      id: 'publish',
      label: 'Publish Queue',
      description: 'Ready to publish content',
      icon: <Send className="w-4 h-4" />,
      section: 'navigation',
      projectRequired: true,
      action: (pid) => router.push(`/projects/${pid}/publish`),
    },
    {
      id: 'intelligence',
      label: 'Intelligence',
      description: 'Competitor analysis',
      icon: <TrendingUp className="w-4 h-4" />,
      section: 'navigation',
      projectRequired: true,
      action: (pid) => router.push(`/projects/${pid}/intelligence`),
    },
    {
      id: 'deep-research',
      label: 'Deep Competitor Research',
      description: '7-layer competitor intelligence engine',
      icon: <BarChart2 className="w-4 h-4" />,
      section: 'navigation',
      projectRequired: true,
      action: (pid) => router.push(`/projects/${pid}/intelligence/deep-research`),
    },
    {
      id: 'deep-search',
      label: 'Deep Search',
      description: 'AI-powered web research',
      icon: <Search className="w-4 h-4" />,
      section: 'navigation',
      projectRequired: true,
      action: (pid) => router.push(`/projects/${pid}/deep-search`),
    },
    {
      id: 'seo',
      label: 'SEO Studio',
      description: 'Blog posts, meta tags & website copy',
      icon: <Globe className="w-4 h-4" />,
      section: 'navigation',
      projectRequired: true,
      action: (pid) => router.push(`/projects/${pid}/seo`),
    },
    {
      id: 'emails',
      label: 'Email Studio',
      description: 'Email sequences & campaigns',
      icon: <Mail className="w-4 h-4" />,
      section: 'navigation',
      projectRequired: true,
      action: (pid) => router.push(`/projects/${pid}/emails`),
    },
    {
      id: 'images',
      label: 'Image Studio',
      description: 'AI image generation',
      icon: <ImageIcon className="w-4 h-4" />,
      section: 'navigation',
      projectRequired: true,
      action: (pid) => router.push(`/projects/${pid}/images`),
    },
    {
      id: 'bulk',
      label: 'Bulk Generate',
      description: 'Generate multiple content pieces',
      icon: <Zap className="w-4 h-4" />,
      section: 'navigation',
      projectRequired: true,
      action: (pid) => router.push(`/projects/${pid}/bulk`),
    },
    {
      id: 'templates',
      label: 'Templates',
      description: 'Reusable content templates',
      icon: <LayoutTemplate className="w-4 h-4" />,
      section: 'navigation',
      projectRequired: true,
      action: (pid) => router.push(`/projects/${pid}/templates`),
    },
    {
      id: 'reports',
      label: 'Reports',
      description: 'AI digest & research reports',
      icon: <FileText className="w-4 h-4" />,
      section: 'navigation',
      projectRequired: true,
      action: (pid) => router.push(`/projects/${pid}/reports`),
    },
    {
      id: 'team',
      label: 'Team',
      description: 'Manage project members',
      icon: <Users className="w-4 h-4" />,
      section: 'navigation',
      projectRequired: true,
      action: (pid) => router.push(`/projects/${pid}/team`),
    },
    {
      id: 'style-guide',
      label: 'Style Guide',
      description: 'Brand voice & guidelines',
      icon: <BookOpen className="w-4 h-4" />,
      section: 'navigation',
      projectRequired: true,
      action: (pid) => router.push(`/projects/${pid}/style-guide`),
    },
    {
      id: 'hashtags',
      label: 'Hashtag Finder',
      description: 'Research relevant hashtags',
      icon: <Hash className="w-4 h-4" />,
      section: 'navigation',
      projectRequired: true,
      action: () => actions.openHashtags(),
    },
    {
      id: 'monitoring',
      label: 'Monitoring',
      description: 'Brand mention alerts',
      icon: <Bell className="w-4 h-4" />,
      section: 'navigation',
      projectRequired: true,
      action: (pid) => router.push(`/projects/${pid}/intelligence/monitoring`),
    },
    {
      id: 'voice-scorer',
      label: 'Voice Scorer',
      description: 'Check content brand alignment',
      icon: <ShieldCheck className="w-4 h-4" />,
      section: 'navigation',
      projectRequired: true,
      action: () => actions.openVoiceScorer(),
    },
    // Actions
    {
      id: 'new-campaign',
      label: 'New Campaign',
      description: 'Generate a campaign brief',
      icon: <Sparkles className="w-4 h-4" />,
      section: 'action',
      projectRequired: true,
      action: () => actions.openCampaigns(),
    },
    {
      id: 'new-project',
      label: 'New Project',
      description: 'Create a new brand project',
      icon: <Zap className="w-4 h-4" />,
      section: 'action',
      projectRequired: false,
      action: () => actions.openWizard(),
    },
    {
      id: 'all-projects',
      label: 'All Projects',
      description: 'Switch to another project',
      icon: <LayoutDashboard className="w-4 h-4" />,
      section: 'action',
      projectRequired: false,
      action: () => router.push('/projects'),
    },
    {
      id: 'settings',
      label: 'Settings',
      description: 'Account & preferences',
      icon: <Users className="w-4 h-4" />,
      section: 'action',
      projectRequired: false,
      action: () => router.push('/settings'),
    },
    {
      id: 'billing',
      label: 'Billing & Plans',
      description: 'Manage your subscription',
      icon: <Zap className="w-4 h-4" />,
      section: 'action',
      projectRequired: false,
      action: () => router.push('/billing'),
    },
  ]
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface CommandPaletteProps {
  open: boolean
  onClose: () => void
}

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const router = useRouter()
  const { activeProject, setCampaignPanelOpen, setWizardOpen, setHashtagPanelOpen, setBrandVoiceScorerOpen } = useAppStore()
  const [query, setQuery] = useState('')
  const [activeIdx, setActiveIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const commands = buildCommands(router, {
    openCampaigns: () => { setCampaignPanelOpen(true); onClose() },
    openWizard: () => { setWizardOpen(true); onClose() },
    openHashtags: () => { setHashtagPanelOpen(true); onClose() },
    openVoiceScorer: () => { setBrandVoiceScorerOpen(true); onClose() },
  })

  const filtered = commands.filter((cmd) => {
    if (cmd.projectRequired && !activeProject) return false
    if (!query.trim()) return true
    const q = query.toLowerCase()
    return (
      cmd.label.toLowerCase().includes(q) ||
      (cmd.description?.toLowerCase().includes(q) ?? false)
    )
  })

  // Group by section
  const navItems = filtered.filter((c) => c.section === 'navigation')
  const actionItems = filtered.filter((c) => c.section === 'action')
  const allVisible = [...navItems, ...actionItems]

  useEffect(() => {
    setActiveIdx(0)
  }, [query, open])

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 10)
      setQuery('')
    }
  }, [open])

  // Scroll active item into view
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-idx="${activeIdx}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [activeIdx])

  const handleSelect = useCallback((cmd: Command) => {
    cmd.action(activeProject?.id ?? '')
    onClose()
  }, [activeProject, onClose])

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIdx((i) => Math.min(i + 1, allVisible.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIdx((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const cmd = allVisible[activeIdx]
      if (cmd) handleSelect(cmd)
    } else if (e.key === 'Escape') {
      onClose()
    }
  }

  if (!open) return null

  let globalIdx = 0

  function renderSection(title: string, items: Command[]) {
    if (items.length === 0) return null
    return (
      <div key={title}>
        <p className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
          {title}
        </p>
        {items.map((cmd) => {
          const idx = globalIdx++
          const isActive = idx === activeIdx
          return (
            <button
              key={cmd.id}
              data-idx={idx}
              onClick={() => handleSelect(cmd)}
              onMouseEnter={() => setActiveIdx(idx)}
              className={cn(
                'w-full flex items-center gap-3 px-3 py-2 text-left transition-colors rounded-md mx-1',
                isActive ? 'bg-primary/10 text-foreground' : 'text-foreground hover:bg-muted/50',
              )}
            >
              <span className={cn(
                'shrink-0 w-7 h-7 rounded-md flex items-center justify-center',
                isActive ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground',
              )}>
                {cmd.icon}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{cmd.label}</p>
                {cmd.description && (
                  <p className="text-[11px] text-muted-foreground truncate">{cmd.description}</p>
                )}
              </div>
              {isActive && <ArrowRight className="w-3.5 h-3.5 text-primary shrink-0" />}
            </button>
          )
        })}
      </div>
    )
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="fixed left-1/2 top-[15%] -translate-x-1/2 z-50 w-full max-w-xl px-4">
        <div className="bg-card border border-border rounded-xl shadow-2xl overflow-hidden">
          {/* Search input */}
          <div className="flex items-center gap-2 px-3 border-b border-border">
            <Search className="w-4 h-4 text-muted-foreground shrink-0" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Jump to page or action…"
              className="flex-1 py-3 text-sm bg-transparent focus:outline-none placeholder:text-muted-foreground/50"
            />
            {query && (
              <button
                onClick={() => setQuery('')}
                className="p-0.5 rounded hover:bg-muted text-muted-foreground"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
            <kbd className="hidden sm:flex items-center gap-0.5 px-1.5 py-0.5 rounded border border-border text-[10px] text-muted-foreground font-mono">
              ESC
            </kbd>
          </div>

          {/* Results */}
          <div ref={listRef} className="overflow-y-auto max-h-80 py-1.5 px-1">
            {allVisible.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                No results for &ldquo;{query}&rdquo;
              </div>
            ) : (
              <>
                {renderSection('Navigate', navItems)}
                {renderSection('Actions', actionItems)}
              </>
            )}
          </div>

          {/* Footer hint */}
          <div className="flex items-center gap-3 px-3 py-2 border-t border-border bg-muted/20">
            <span className="text-[10px] text-muted-foreground flex items-center gap-1">
              <kbd className="px-1 py-0.5 rounded border border-border font-mono text-[9px]">↑↓</kbd> navigate
            </span>
            <span className="text-[10px] text-muted-foreground flex items-center gap-1">
              <kbd className="px-1 py-0.5 rounded border border-border font-mono text-[9px]">↵</kbd> select
            </span>
            <span className="text-[10px] text-muted-foreground flex items-center gap-1">
              <kbd className="px-1 py-0.5 rounded border border-border font-mono text-[9px]">ESC</kbd> close
            </span>
          </div>
        </div>
      </div>
    </>
  )
}
