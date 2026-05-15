'use client'

import { useEffect, useState } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import {
  MessageSquare, Library, BarChart2, Plus, Sparkles,
  CheckCircle2, Clock, ArrowRight, Globe,
} from 'lucide-react'
import { useAppStore } from '@/stores/app-store'
import { api } from '@/lib/api'
import { Sidebar, SidebarToggle } from '@/components/layout/sidebar'
import { AnnouncementBanner } from '@/components/layout/announcement-banner'
import { OnboardingCard } from '@/components/onboarding/onboarding-card'
import { Skeleton } from '@/components/ui/skeleton'
import type { Project } from '@/types'

// ---------------------------------------------------------------------------
// Greeting
// ---------------------------------------------------------------------------

function greeting(name: string | null) {
  const hour = new Date().getHours()
  const time = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  return name ? `${time}, ${name.split(' ')[0]}` : time
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const days = Math.floor(diff / 86400000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days}d ago`
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

// ---------------------------------------------------------------------------
// Project card
// ---------------------------------------------------------------------------

function ProjectCard({
  project,
  onOpenChat,
  onNavigate,
}: {
  project: Project
  onOpenChat: () => void
  onNavigate: (path: string) => void
}) {
  const hasBrandCore = !!project.brandCore
  const initials = project.name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)

  return (
    <div
      className="group relative bg-card border border-border rounded-2xl overflow-hidden hover:border-primary/30 hover:shadow-md transition-all cursor-pointer"
      onClick={() => onNavigate(`/projects/${project.id}/dashboard`)}
    >
      {/* Card header */}
      <div className="p-5 pb-3">
        <div className="flex items-start gap-3">
          {/* Logo or initials avatar */}
          {project.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={project.logoUrl}
              alt={project.name}
              className="w-10 h-10 rounded-xl object-cover shrink-0 border border-border"
            />
          ) : (
            <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center font-bold text-sm shrink-0">
              {initials}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-sm leading-tight truncate group-hover:text-primary transition-colors">
              {project.name}
            </h3>
            {project.description && (
              <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{project.description}</p>
            )}
            {/* Website link */}
            {project.websiteUrl && (
              <a
                href={project.websiteUrl.startsWith('http') ? project.websiteUrl : `https://${project.websiteUrl}`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center gap-1 mt-1 text-[10px] text-primary/70 hover:text-primary hover:underline transition-colors"
              >
                <Globe className="w-2.5 h-2.5" />
                {project.websiteUrl.replace(/^https?:\/\//, '').replace(/\/$/, '')}
              </a>
            )}
          </div>
        </div>

        {/* Brand Core status */}
        <div className="flex items-center gap-1.5 mt-3">
          {hasBrandCore ? (
            <span className="inline-flex items-center gap-1 text-[10px] font-medium text-green-600 bg-green-500/10 px-2 py-0.5 rounded-full">
              <CheckCircle2 className="w-2.5 h-2.5" />
              Brand Core ready
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-[10px] font-medium text-amber-600 bg-amber-500/10 px-2 py-0.5 rounded-full">
              <Clock className="w-2.5 h-2.5" />
              Brand Core needed
            </span>
          )}
          {project.createdAt && (
            <span className="text-[10px] text-muted-foreground/60 ml-auto">
              {timeAgo(project.createdAt)}
            </span>
          )}
        </div>
      </div>

      {/* Quick actions - stop propagation so they don't trigger card click */}
      <div className="px-4 pb-4 flex items-center gap-1.5">
        <button
          onClick={(e) => { e.stopPropagation(); onOpenChat() }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          <MessageSquare className="w-3 h-3" />
          Chat
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onNavigate(`/projects/${project.id}/library`) }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-muted-foreground border border-border hover:bg-muted transition-colors"
        >
          <Library className="w-3 h-3" />
          Library
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onNavigate(`/projects/${project.id}/analytics`) }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-muted-foreground border border-border hover:bg-muted transition-colors"
        >
          <BarChart2 className="w-3 h-3" />
          Analytics
        </button>
        <div className="ml-auto p-1.5 rounded-lg text-muted-foreground group-hover:text-primary transition-colors">
          <ArrowRight className="w-3.5 h-3.5" />
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// New project card
// ---------------------------------------------------------------------------

function NewProjectCard({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="group bg-muted/30 border border-dashed border-border rounded-2xl p-5 flex flex-col items-center justify-center gap-2 hover:bg-muted/50 hover:border-primary/30 transition-all min-h-36"
    >
      <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center group-hover:bg-primary/10 transition-colors">
        <Plus className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
      </div>
      <span className="text-xs font-medium text-muted-foreground group-hover:text-foreground transition-colors">
        New brand
      </span>
    </button>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ProjectsPage() {
  const router = useRouter()
  const { user, projects, setProjects, setChats, setActiveChat, setWizardOpen } = useAppStore()
  const [loading, setLoading] = useState(true)
  const [greetingText, setGreetingText] = useState('')

  useEffect(() => {
    setGreetingText(greeting(user?.displayName ?? null))
  }, [user?.displayName])

  useEffect(() => {
    if (!user) { router.replace('/login'); return }
    setLoading(true)
    api.projects.list()
      .then(setProjects)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [user, router, setProjects])

  async function openChat(projectId: string) {
    try {
      const chats = await api.chats.list(projectId)
      if (chats.length > 0) {
        setActiveChat(chats[0])
        router.push(`/projects/${projectId}/chats/${chats[0].id}`)
      } else {
        const chat = await api.chats.create(projectId)
        setChats([chat])
        setActiveChat(chat)
        router.push(`/projects/${projectId}/chats/${chat.id}`)
      }
    } catch {
      router.push(`/projects/${projectId}/dashboard`)
    }
  }

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      <Sidebar />

      <main className="flex-1 flex flex-col overflow-hidden">
        <AnnouncementBanner />

        {/* Top bar */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border shrink-0">
          <SidebarToggle />
          <Image src="/Leo.png" alt="LEO" width={24} height={24} className="rounded-md" />
          <span className="font-bold text-sm">LEO</span>
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 space-y-8">

            {/* Greeting */}
            <div>
              <h1 className="text-xl font-bold">
                {greetingText}
              </h1>
              <p className="text-sm text-muted-foreground mt-1">
                {loading
                  ? 'Loading your brands…'
                  : projects.length === 0
                  ? 'Create your first brand to get started.'
                  : `You have ${projects.length} brand${projects.length !== 1 ? 's' : ''}.`}
              </p>
            </div>

            {/* Loading skeleton */}
            {loading && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {[1, 2].map((i) => (
                  <div key={i} className="bg-card border border-border rounded-2xl p-5 space-y-3">
                    <div className="flex items-center gap-3">
                      <Skeleton className="w-10 h-10 rounded-xl" />
                      <div className="space-y-1.5 flex-1">
                        <Skeleton className="h-3.5 w-32" />
                        <Skeleton className="h-2.5 w-24" />
                      </div>
                    </div>
                    <Skeleton className="h-2 w-28 rounded-full" />
                    <div className="flex gap-1.5 pt-1">
                      <Skeleton className="h-7 w-16 rounded-lg" />
                      <Skeleton className="h-7 w-16 rounded-lg" />
                      <Skeleton className="h-7 w-20 rounded-lg" />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* No projects - onboarding */}
            {!loading && projects.length === 0 && (
              <OnboardingCard />
            )}

            {/* Project cards grid */}
            {!loading && projects.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {projects.map((project) => (
                  <ProjectCard
                    key={project.id}
                    project={project}
                    onOpenChat={() => openChat(project.id)}
                    onNavigate={(path) => router.push(path)}
                  />
                ))}
                <NewProjectCard onClick={() => setWizardOpen(true)} />
              </div>
            )}

            {/* Tips section - shown when has projects */}
            {!loading && projects.length > 0 && (
              <div className="bg-muted/30 border border-border rounded-2xl p-5">
                <div className="flex items-center gap-2 mb-3">
                  <Sparkles className="w-4 h-4 text-primary" />
                  <span className="text-sm font-semibold">Quick tips</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {[
                    { icon: <MessageSquare className="w-3.5 h-3.5" />, title: 'Chat to create', desc: 'Ask for captions, scripts, or campaigns directly in chat.' },
                    { icon: <Library className="w-3.5 h-3.5" />,        title: 'Build your library', desc: 'Save generated content and schedule it to your calendar.' },
                    { icon: <BarChart2 className="w-3.5 h-3.5" />,      title: 'Track performance', desc: 'Log metrics and get AI-powered weekly digests.' },
                  ].map((tip) => (
                    <div key={tip.title} className="flex items-start gap-2.5">
                      <div className="p-1.5 rounded-md bg-muted text-muted-foreground shrink-0 mt-0.5">{tip.icon}</div>
                      <div>
                        <p className="text-xs font-medium">{tip.title}</p>
                        <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">{tip.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

          </div>
        </div>
      </main>
    </div>
  )
}
