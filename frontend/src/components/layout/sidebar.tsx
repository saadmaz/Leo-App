'use client'

import { useEffect, useState } from 'react'
import Image from 'next/image'
import { useRouter, useParams } from 'next/navigation'
import { signOut, updateProfile } from 'firebase/auth'
import {
  PlusIcon, LogOut, Layers,
  CreditCard, X, Moon, Sun, Settings, Menu, Megaphone, Sparkles,
  BarChart2, TrendingUp, ShieldCheck, Library, CalendarDays, Zap, LayoutDashboard, Send, Globe, Mail, BookOpen, Users, FileText,
  LayoutTemplate, ClipboardCheck, ImageIcon, CalendarRange, Search, ClipboardList,
  ChevronDown, ChevronRight, PanelLeft, User, ArrowLeftRight, Loader2, Check, Map,
  Mic2, Shield, DollarSign, Newspaper, FlaskConical,
} from 'lucide-react'
import { useTheme } from 'next-themes'
import { toast } from 'sonner'
import { auth } from '@/lib/firebase'
import { api } from '@/lib/api'
import { useAppStore } from '@/stores/app-store'
import { MyBrandPanel } from '@/components/personal-brand/my-brand-panel'
import { cn } from '@/lib/utils'
import { ChangelogModal, useHasUnseenChangelog } from '@/components/layout/changelog-modal'
import { NotificationBell } from '@/components/layout/notification-bell'
import { CommandPalette } from '@/components/layout/command-palette'

// ---------------------------------------------------------------------------
// My Account modal
// ---------------------------------------------------------------------------

function AccountModal({ onClose }: { onClose: () => void }) {
  const { user, setUser, billingStatus, credits } = useAppStore()
  const [displayName, setDisplayName] = useState(user?.displayName ?? '')
  const [saving, setSaving] = useState(false)
  const router = useRouter()

  const initials = (user?.displayName || user?.email || 'U')
    .split(/[\s@]/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('')

  async function save() {
    setSaving(true)
    try {
      if (auth.currentUser) {
        await updateProfile(auth.currentUser, { displayName: displayName.trim() })
        setUser({ ...user!, displayName: displayName.trim() })
        toast.success('Profile updated')
      }
    } catch {
      toast.error('Failed to update profile')
    } finally {
      setSaving(false)
    }
  }

  async function handleSignOut() {
    await signOut(auth)
    onClose()
    router.replace('/login')
  }

  const plan = credits?.plan ?? billingStatus?.plan ?? null

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/50 sm:p-4"
      onClick={onClose}
    >
      <div
        className="bg-card border border-border rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-sm flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Mobile drag handle */}
        <div className="sm:hidden flex justify-center pt-3 pb-1 shrink-0">
          <div className="w-8 h-1 rounded-full bg-muted-foreground/30" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <User className="w-4 h-4 text-primary" />
            <span className="font-semibold text-sm">My Account</span>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          {/* Avatar */}
          <div className="flex justify-center">
            <div className="w-16 h-16 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-xl select-none">
              {initials}
            </div>
          </div>

          {/* Plan badge */}
          {plan && (
            <div className="flex justify-center">
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide px-2.5 py-1 rounded-full bg-primary/10 text-primary">
                <Zap className="w-2.5 h-2.5" />
                {plan} plan
              </span>
            </div>
          )}

          {/* Display name */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Display name
            </label>
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') save() }}
              placeholder="Your name"
              className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          {/* Email */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Email
            </label>
            <input
              value={user?.email ?? ''}
              readOnly
              className="w-full px-3 py-2 text-sm bg-muted border border-border rounded-lg text-muted-foreground cursor-not-allowed"
            />
          </div>

          {/* Credits */}
          {credits && (
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Credits remaining</span>
                <span className="font-medium text-foreground">
                  {credits.balance.toLocaleString()} / {credits.planAllotment.toLocaleString()}
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                <div
                  className={cn(
                    'h-full rounded-full transition-all',
                    credits.balance / credits.planAllotment <= 0.1 ? 'bg-red-500'
                    : credits.balance / credits.planAllotment <= 0.3 ? 'bg-amber-500'
                    : 'bg-primary',
                  )}
                  style={{ width: `${Math.min((credits.balance / credits.planAllotment) * 100, 100)}%` }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-border shrink-0 flex items-center gap-2">
          <button
            onClick={save}
            disabled={saving}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
            {saving ? 'Saving…' : 'Save changes'}
          </button>
          <button
            onClick={() => { router.push('/billing'); onClose() }}
            className="px-3 py-2 text-xs border border-border rounded-lg hover:bg-muted transition-colors flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
          >
            <CreditCard className="w-3.5 h-3.5" />
            Plans
          </button>
          <button
            onClick={handleSignOut}
            className="px-3 py-2 text-xs text-destructive border border-destructive/20 rounded-lg hover:bg-destructive/5 transition-colors flex items-center gap-1.5"
          >
            <LogOut className="w-3.5 h-3.5" />
            Sign out
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sidebar shell
// ---------------------------------------------------------------------------

export function Sidebar() {
  const router = useRouter()
  const params = useParams<{ projectId?: string }>()
  const { resolvedTheme, setTheme } = useTheme()

  const {
    user, projects, setProjects, activeProject, setActiveProject,
    setChats,
    billingStatus, credits, setCredits,
    sidebarOpen, setSidebarOpen,
    sidebarCollapsed, setSidebarCollapsed,
    setWizardOpen,
    setMyBrandPanelOpen,
  } = useAppStore()


  const [mounted, setMounted] = useState(false)
  const [changelogOpen, setChangelogOpen] = useState(false)
  const [cmdOpen, setCmdOpen] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)
  const hasUnseenChangelog = useHasUnseenChangelog()

  useEffect(() => { setMounted(true) }, [])

  // ⌘K / Ctrl+K to open command palette
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setCmdOpen((v) => !v)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    if (!user) return
    api.projects.list()
      .then(setProjects)
      .catch(console.error)
    api.credits.getBalance().then(setCredits).catch(console.error)
  }, [user, setProjects, setCredits])

  useEffect(() => {
    if (!activeProject) { setChats([]); return }
    api.chats.list(activeProject.id).then(setChats).catch(console.error)
  }, [activeProject, setChats])

  useEffect(() => {
    if (!params.projectId || !projects.length) return
    const found = projects.find((p) => p.id === params.projectId)
    if (found && found.id !== activeProject?.id) setActiveProject(found)
  }, [params.projectId, projects, activeProject, setActiveProject])

  // Close on Escape key (mobile UX)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setSidebarOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setSidebarOpen])

  const isDark = mounted && resolvedTheme === 'dark'

  const userInitials = (user?.displayName || user?.email || 'U')
    .split(/[\s@]/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('')

  return (
    <>
      {/* Mobile backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside
        className={cn(
          // Base layout
          'flex flex-col shrink-0 border-r border-border bg-card h-screen z-50',
          // Desktop: collapse by reducing width (smooth transition)
          'hidden md:flex md:relative md:translate-x-0 transition-all duration-200',
          sidebarCollapsed ? 'md:w-0 md:overflow-hidden md:border-r-0' : 'md:w-60',
          // Mobile: fixed overlay, slide in/out
          'fixed inset-y-0 left-0',
          sidebarOpen ? 'flex w-64' : 'hidden md:flex',
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <Image src="/Leo.png" alt="LEO" width={28} height={28} className="rounded-lg" />
            <span className="text-base font-bold tracking-tight">LEO</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setCmdOpen(true)}
              title="Command palette (⌘K)"
              className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <Search className="w-3.5 h-3.5" />
            </button>
            {activeProject && <NotificationBell projectId={activeProject.id} />}
            <button
              onClick={() => setSidebarCollapsed(true)}
              title="Collapse sidebar"
              className="hidden md:flex p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <PanelLeft className="w-3.5 h-3.5" />
            </button>
            {/* Close button - mobile only */}
            <button
              onClick={() => setSidebarOpen(false)}
              className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors md:hidden"
              title="Close sidebar"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Scrollable nav */}
        <div className="flex-1 overflow-y-auto py-2">

          {/* Active project context + switch link */}
          <div className="px-3 pb-2">
            {activeProject ? (
              <div className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg bg-primary/5 border border-primary/10">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-5 h-5 rounded bg-primary/15 text-primary flex items-center justify-center font-bold text-[9px] shrink-0">
                    {activeProject.name.slice(0, 2).toUpperCase()}
                  </div>
                  <span className="text-xs font-medium truncate">{activeProject.name}</span>
                </div>
                <button
                  onClick={() => { router.push('/projects'); setSidebarOpen(false) }}
                  title="Switch brand"
                  className="shrink-0 p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                >
                  <ArrowLeftRight className="w-3 h-3" />
                </button>
              </div>
            ) : (
              <button
                onClick={() => { router.push('/projects'); setSidebarOpen(false) }}
                className="flex items-center gap-2 w-full px-2 py-1.5 rounded-lg border border-dashed border-border text-xs text-muted-foreground hover:text-foreground hover:border-primary/30 transition-colors"
              >
                <Layers className="w-3.5 h-3.5" />
                Select a brand
              </button>
            )}
          </div>

          {/* New project shortcut */}
          <button
            onClick={() => { setWizardOpen(true); setSidebarOpen(false) }}
            className="flex items-center gap-2 w-full px-5 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
          >
            <PlusIcon className="w-3.5 h-3.5" />
            New brand
          </button>

          {/* Project-scoped nav groups - only visible when a project is active */}
          {activeProject && (
            <div className="mt-1 border-t border-border/50 pt-1">

              {/* Personal Brand section - only for personal brand projects */}
              {activeProject.projectType === 'personal' && (
                <>
                  <NavGroup label="Personal Brand" storageKey="nav_personal_brand">
                    <NavItem icon={<User className="w-3.5 h-3.5" />}            label="My Brand"        onClick={() => { setMyBrandPanelOpen(true); setSidebarOpen(false) }} />
                    <NavItem icon={<LayoutDashboard className="w-3.5 h-3.5" />} label="Dashboard"       onClick={() => { router.push(`/projects/${activeProject.id}/personal-brand/dashboard`); setSidebarOpen(false) }} />
                    <NavItem icon={<Sparkles className="w-3.5 h-3.5" />}        label="Interview"       onClick={() => { router.push(`/projects/${activeProject.id}/personal-brand/onboarding`); setSidebarOpen(false) }} />
                    <NavItem icon={<Map className="w-3.5 h-3.5" />}             label="Strategy"        onClick={() => { router.push(`/projects/${activeProject.id}/personal-brand/strategy`); setSidebarOpen(false) }} />
                    <NavItem icon={<Mic2 className="w-3.5 h-3.5" />}            label="Content Engine"  onClick={() => { router.push(`/projects/${activeProject.id}/personal-brand/content`); setSidebarOpen(false) }} />
                  </NavGroup>
                  <NavGroup label="Personal Publish" storageKey="nav_personal_publish">
                    <NavItem icon={<Send className="w-3.5 h-3.5" />}            label="Publishing"      onClick={() => { router.push(`/projects/${activeProject.id}/personal-brand/publishing`); setSidebarOpen(false) }} />
                    <NavItem icon={<CalendarDays className="w-3.5 h-3.5" />}    label="Calendar"        onClick={() => { router.push(`/projects/${activeProject.id}/personal-brand/calendar`); setSidebarOpen(false) }} />
                  </NavGroup>
                  <NavGroup label="Personal Insights" storageKey="nav_personal_insights">
                    <NavItem icon={<BarChart2 className="w-3.5 h-3.5" />}       label="Analytics"       onClick={() => { router.push(`/projects/${activeProject.id}/personal-brand/analytics`); setSidebarOpen(false) }} />
                    <NavItem icon={<Shield className="w-3.5 h-3.5" />}          label="Reputation"      onClick={() => { router.push(`/projects/${activeProject.id}/personal-brand/reputation`); setSidebarOpen(false) }} />
                  </NavGroup>
                </>
              )}

              <NavGroup label="Workspace" storageKey="nav_workspace">
                <NavItem icon={<Megaphone className="w-3.5 h-3.5" />}     label="Campaigns"       onClick={() => { router.push(`/projects/${activeProject.id}/campaigns`); setSidebarOpen(false) }} />
                <NavItem icon={<ClipboardList className="w-3.5 h-3.5" />} label="Posts"           onClick={() => { router.push(`/projects/${activeProject.id}/posts`); setSidebarOpen(false) }} />
                <NavItem icon={<Users className="w-3.5 h-3.5" />}         label="Team"            onClick={() => { router.push(`/projects/${activeProject.id}/team`); setSidebarOpen(false) }} />
              </NavGroup>

              <NavGroup label="Create" storageKey="nav_content">
                <NavItem icon={<LayoutDashboard className="w-3.5 h-3.5" />} label="Dashboard"       onClick={() => { router.push(`/projects/${activeProject.id}/dashboard`); setSidebarOpen(false) }} />
                <NavItem icon={<Library className="w-3.5 h-3.5" />}         label="Library"         onClick={() => { router.push(`/projects/${activeProject.id}/library`); setSidebarOpen(false) }} />
                <NavItem icon={<Zap className="w-3.5 h-3.5" />}             label="Bulk Generate"   onClick={() => { router.push(`/projects/${activeProject.id}/bulk`); setSidebarOpen(false) }} />
                <NavItem icon={<CalendarRange className="w-3.5 h-3.5" />}   label="Content Planner" onClick={() => { router.push(`/projects/${activeProject.id}/planner`); setSidebarOpen(false) }} />
                <NavItem icon={<ImageIcon className="w-3.5 h-3.5" />}       label="Image Studio"    onClick={() => { router.push(`/projects/${activeProject.id}/images`); setSidebarOpen(false) }} />
              </NavGroup>

              <NavGroup label="Publish" storageKey="nav_schedule">
                <NavItem icon={<ClipboardCheck className="w-3.5 h-3.5" />} label="Review Queue" onClick={() => { router.push(`/projects/${activeProject.id}/review`); setSidebarOpen(false) }} />
                <NavItem icon={<CalendarDays className="w-3.5 h-3.5" />}   label="Calendar"      onClick={() => { router.push(`/projects/${activeProject.id}/calendar`); setSidebarOpen(false) }} />
                <NavItem icon={<Send className="w-3.5 h-3.5" />}           label="Publish Queue" onClick={() => { router.push(`/projects/${activeProject.id}/publish`); setSidebarOpen(false) }} />
              </NavGroup>

              <NavGroup label="Insights" storageKey="nav_intelligence">
                <NavItem icon={<TrendingUp className="w-3.5 h-3.5" />} label="Analytics"      onClick={() => { router.push(`/projects/${activeProject.id}/analytics`); setSidebarOpen(false) }} />
                <NavItem icon={<FileText className="w-3.5 h-3.5" />}   label="Reports"        onClick={() => { router.push(`/projects/${activeProject.id}/reports`); setSidebarOpen(false) }} />
                <NavItem icon={<Search className="w-3.5 h-3.5" />}     label="Deep Search"    onClick={() => { router.push(`/projects/${activeProject.id}/deep-search`); setSidebarOpen(false) }} />
                <NavItem icon={<BarChart2 className="w-3.5 h-3.5" />}  label="Competitors"    onClick={() => { router.push(`/projects/${activeProject.id}/intelligence`); setSidebarOpen(false) }} />
                <NavItem icon={<Zap className="w-3.5 h-3.5" />}        label="Deep Research"  onClick={() => { router.push(`/projects/${activeProject.id}/intelligence/deep-research`); setSidebarOpen(false) }} />
              </NavGroup>

              <NavGroup label="Strategy" storageKey="nav_strategy">
                <NavItem icon={<Map className="w-3.5 h-3.5" />} label="Strategy Hub" onClick={() => { router.push(`/projects/${activeProject.id}/strategy`); setSidebarOpen(false) }} />
              </NavGroup>

              <NavGroup label="Content Studio" storageKey="nav_content_studio">
                <NavItem icon={<Layers className="w-3.5 h-3.5" />}         label="Content Studio"   onClick={() => { router.push(`/projects/${activeProject.id}/content`); setSidebarOpen(false) }} />
              </NavGroup>

              <NavGroup label="SEO &amp; Organic" storageKey="nav_seo_organic">
                <NavItem icon={<Search className="w-3.5 h-3.5" />}          label="SEO Engine"       onClick={() => { router.push(`/projects/${activeProject.id}/seo-pro`); setSidebarOpen(false) }} />
              </NavGroup>

              <NavGroup label="Paid Advertising" storageKey="nav_paid_ads">
                <NavItem icon={<DollarSign className="w-3.5 h-3.5" />}      label="Paid Ads Engine"  onClick={() => { router.push(`/projects/${activeProject.id}/paid-ads`); setSidebarOpen(false) }} />
              </NavGroup>

              <NavGroup label="Email &amp; CRM" storageKey="nav_email_crm">
                <NavItem icon={<Mail className="w-3.5 h-3.5" />}            label="Email CRM Engine" onClick={() => { router.push(`/projects/${activeProject.id}/email-crm`); setSidebarOpen(false) }} />
              </NavGroup>

              <NavGroup label="Social Media" storageKey="nav_social">
                <NavItem icon={<Send className="w-3.5 h-3.5" />}            label="Social Engine"    onClick={() => { router.push(`/projects/${activeProject.id}/social`); setSidebarOpen(false) }} />
              </NavGroup>

              <NavGroup label="Analytics & Reporting" storageKey="nav_analytics_pro">
                <NavItem icon={<BarChart2 className="w-3.5 h-3.5" />}      label="Analytics Pro"    onClick={() => { router.push(`/projects/${activeProject.id}/analytics-pro`); setSidebarOpen(false) }} />
              </NavGroup>

              <NavGroup label="PR & Communications" storageKey="nav_pr_comms">
                <NavItem icon={<Newspaper className="w-3.5 h-3.5" />}      label="PR & Comms Engine" onClick={() => { router.push(`/projects/${activeProject.id}/pr-comms`); setSidebarOpen(false) }} />
              </NavGroup>

              <NavGroup label="Experimentation" storageKey="nav_experiments">
                <NavItem icon={<FlaskConical className="w-3.5 h-3.5" />}   label="Experiments Engine" onClick={() => { router.push(`/projects/${activeProject.id}/experiments`); setSidebarOpen(false) }} />
              </NavGroup>

              <NavGroup label="Studio" storageKey="nav_studio">
                <NavItem icon={<Globe className="w-3.5 h-3.5" />}          label="SEO Studio"    onClick={() => { router.push(`/projects/${activeProject.id}/seo`); setSidebarOpen(false) }} />
                <NavItem icon={<Mail className="w-3.5 h-3.5" />}           label="Email Studio"  onClick={() => { router.push(`/projects/${activeProject.id}/emails`); setSidebarOpen(false) }} />
                <NavItem icon={<LayoutTemplate className="w-3.5 h-3.5" />} label="Templates"     onClick={() => { router.push(`/projects/${activeProject.id}/templates`); setSidebarOpen(false) }} />
                <NavItem icon={<BookOpen className="w-3.5 h-3.5" />}       label="Style Guide"   onClick={() => { router.push(`/projects/${activeProject.id}/style-guide`); setSidebarOpen(false) }} />
                <NavItem icon={<ShieldCheck className="w-3.5 h-3.5" />}    label="Brand Health"  onClick={() => { router.push(`/projects/${activeProject.id}/brand-health`); setSidebarOpen(false) }} />
              </NavGroup>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-border p-3 space-y-1 shrink-0">
          {/* Credits bar */}
          {credits ? (
            <div className="px-1 mb-2 space-y-1">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span className="capitalize">{credits.plan} plan</span>
                <span>{credits.balance.toLocaleString()} / {credits.planAllotment.toLocaleString()} cr</span>
              </div>
              <div className="h-1 rounded-full bg-muted overflow-hidden">
                <div
                  className={cn(
                    'h-full rounded-full transition-all',
                    credits.balance / credits.planAllotment <= 0.1 ? 'bg-red-500'
                    : credits.balance / credits.planAllotment <= 0.3 ? 'bg-amber-500'
                    : 'bg-primary',
                  )}
                  style={{ width: `${Math.min((credits.balance / credits.planAllotment) * 100, 100)}%` }}
                />
              </div>
            </div>
          ) : billingStatus && (
            <div className="px-1 mb-2 space-y-1">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span className="capitalize">{billingStatus.plan} plan</span>
                <span>{billingStatus.messages.used}/{billingStatus.messages.limit >= 999 ? '∞' : billingStatus.messages.limit} msgs</span>
              </div>
              <div className="h-1 rounded-full bg-muted overflow-hidden">
                <div
                  className={cn(
                    'h-full rounded-full transition-all',
                    billingStatus.messages.used / billingStatus.messages.limit >= 0.9 ? 'bg-red-500'
                    : billingStatus.messages.used / billingStatus.messages.limit >= 0.7 ? 'bg-amber-500'
                    : 'bg-primary',
                  )}
                  style={{
                    width: billingStatus.messages.limit >= 999
                      ? '5%'
                      : `${Math.min((billingStatus.messages.used / billingStatus.messages.limit) * 100, 100)}%`,
                  }}
                />
              </div>
            </div>
          )}

          {/* What's New */}
          <button
            onClick={() => setChangelogOpen(true)}
            className="flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <span className="relative">
              <Sparkles className="w-3.5 h-3.5" />
              {hasUnseenChangelog && (
                <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-primary" />
              )}
            </span>
            <span>What&apos;s New</span>
          </button>

          {/* Theme toggle */}
          <button
            onClick={() => setTheme(isDark ? 'light' : 'dark')}
            className="flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            {isDark ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
            <span>{isDark ? 'Light mode' : 'Dark mode'}</span>
          </button>

          {/* Settings */}
          <button
            onClick={() => { router.push('/settings'); setSidebarOpen(false) }}
            className="flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <Settings className="w-3.5 h-3.5" />
            <span>Settings</span>
          </button>

          {/* My Account - user avatar + name */}
          <button
            onClick={() => setAccountOpen(true)}
            className="flex items-center gap-2.5 w-full px-2 py-2 rounded-md hover:bg-muted transition-colors group"
          >
            <div className="w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center font-semibold text-[10px] shrink-0 group-hover:bg-primary/20 transition-colors">
              {userInitials}
            </div>
            <div className="flex-1 min-w-0 text-left">
              <p className="text-xs font-medium truncate">{user?.displayName || user?.email || 'Account'}</p>
              {user?.displayName && (
                <p className="text-[10px] text-muted-foreground truncate">{user.email}</p>
              )}
            </div>
            <User className="w-3 h-3 text-muted-foreground shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
          </button>
        </div>
      </aside>

      {/* Modals */}
      {accountOpen && <AccountModal onClose={() => setAccountOpen(false)} />}
      <ChangelogModal open={changelogOpen} onClose={() => setChangelogOpen(false)} />
      <CommandPalette open={cmdOpen} onClose={() => setCmdOpen(false)} />

      {/* Personal Brand panel */}
      <MyBrandPanel />
    </>
  )
}

// ---------------------------------------------------------------------------
// NavGroup - collapsible section with localStorage persistence
// ---------------------------------------------------------------------------

function NavGroup({ label, storageKey, children }: {
  label: string
  storageKey: string
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(() => {
    if (typeof window === 'undefined') return false
    return localStorage.getItem(storageKey) === 'true'
  })

  function toggle() {
    setOpen((v) => {
      const next = !v
      localStorage.setItem(storageKey, String(next))
      return next
    })
  }

  return (
    <div>
      <button
        onClick={toggle}
        className="flex items-center gap-1.5 w-full px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 hover:text-muted-foreground transition-colors"
      >
        {open
          ? <ChevronDown className="w-2.5 h-2.5" />
          : <ChevronRight className="w-2.5 h-2.5" />
        }
        {label}
      </button>
      {open && <div className="pb-1">{children}</div>}
    </div>
  )
}

function NavItem({ icon, label, onClick }: {
  icon: React.ReactNode
  label: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2 w-full pl-6 pr-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
    >
      <span className="shrink-0">{icon}</span>
      <span>{label}</span>
    </button>
  )
}

// ---------------------------------------------------------------------------
// Sidebar toggle - works for both mobile (open) and desktop (uncollapse)
// ---------------------------------------------------------------------------

export function SidebarToggle({ className }: { className?: string }) {
  const { setSidebarOpen, sidebarCollapsed, setSidebarCollapsed } = useAppStore()
  return (
    <>
      {/* Mobile: open sidebar overlay */}
      <button
        onClick={() => setSidebarOpen(true)}
        className={cn(
          'md:hidden p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors',
          className,
        )}
        title="Open sidebar"
      >
        <Menu className="w-4 h-4" />
      </button>
      {/* Desktop: show when collapsed */}
      {sidebarCollapsed && (
        <button
          onClick={() => setSidebarCollapsed(false)}
          className={cn(
            'hidden md:flex p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors',
            className,
          )}
          title="Show sidebar"
        >
          <PanelLeft className="w-4 h-4" />
        </button>
      )}
    </>
  )
}
