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
  Mic2, Shield, DollarSign, Newspaper, FlaskConical, MessageSquare,
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
        <div className="sm:hidden flex justify-center pt-3 pb-1 shrink-0">
          <div className="w-8 h-1 rounded-full bg-muted-foreground/30" />
        </div>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <User className="w-4 h-4 text-primary" />
            <span className="font-semibold text-sm">My Account</span>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div className="flex justify-center">
            <div className="w-16 h-16 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-xl select-none">
              {initials}
            </div>
          </div>
          {plan && (
            <div className="flex justify-center">
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide px-2.5 py-1 rounded-full bg-primary/10 text-primary">
                <Zap className="w-2.5 h-2.5" />
                {plan} plan
              </span>
            </div>
          )}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Display name</label>
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') save() }}
              placeholder="Your name"
              className="w-full px-3 py-2 text-sm bg-background border border-border rounded-xl focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Email</label>
            <input
              value={user?.email ?? ''}
              readOnly
              className="w-full px-3 py-2 text-sm bg-muted border border-border rounded-xl text-muted-foreground cursor-not-allowed"
            />
          </div>
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
                    : 'bg-emerald-500',
                  )}
                  style={{ width: `${Math.min((credits.balance / credits.planAllotment) * 100, 100)}%` }}
                />
              </div>
            </div>
          )}
        </div>
        <div className="px-5 py-4 border-t border-border shrink-0 flex items-center gap-2">
          <button
            onClick={save}
            disabled={saving}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-medium bg-primary text-primary-foreground rounded-xl hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
            {saving ? 'Saving…' : 'Save changes'}
          </button>
          <button
            onClick={() => { router.push('/billing'); onClose() }}
            className="px-3 py-2 text-xs border border-border rounded-xl hover:bg-muted transition-colors flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
          >
            <CreditCard className="w-3.5 h-3.5" />
            Plans
          </button>
          <button
            onClick={handleSignOut}
            className="px-3 py-2 text-xs text-destructive border border-destructive/20 rounded-xl hover:bg-destructive/5 transition-colors flex items-center gap-1.5"
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
    api.projects.list().then(setProjects).catch(console.error)
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

  function nav(path: string) {
    router.push(path)
    setSidebarOpen(false)
  }

  async function openLatestChat() {
    if (!activeProject) return
    try {
      const chats = await api.chats.list(activeProject.id)
      if (chats.length > 0) {
        nav(`/projects/${activeProject.id}/chats/${chats[0].id}`)
      } else {
        const chat = await api.chats.create(activeProject.id)
        nav(`/projects/${activeProject.id}/chats/${chat.id}`)
      }
    } catch {
      nav(`/projects/${activeProject.id}/dashboard`)
    }
  }

  return (
    <>
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside
        className={cn(
          'flex flex-col shrink-0 border-r border-border bg-card h-screen z-50',
          'hidden md:flex md:relative md:translate-x-0 transition-all duration-200',
          sidebarCollapsed ? 'md:w-0 md:overflow-hidden md:border-r-0' : 'md:w-60',
          'fixed inset-y-0 left-0',
          sidebarOpen ? 'flex w-64' : 'hidden md:flex',
          'dark:bg-[#0a0a0b] dark:border-white/[0.06]',
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-4 border-b border-border shrink-0 bg-gradient-to-b from-primary/[0.06] to-transparent">
          <div className="flex items-center gap-2.5">
            <Image src="/Leo.png" alt="LEO" width={28} height={28} className="rounded-xl" />
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
            <button
              onClick={() => setSidebarOpen(false)}
              className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors md:hidden"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Scrollable nav */}
        <div className="flex-1 overflow-y-auto py-2 sidebar-scroll">

          {/* Brand switcher */}
          <div className="px-3 pb-2">
            {activeProject ? (
              <div className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-xl bg-primary/5 border border-primary/10">
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
                className="flex items-center gap-2 w-full px-2 py-1.5 rounded-xl border border-dashed border-border text-xs text-muted-foreground hover:text-foreground hover:border-primary/30 transition-colors"
              >
                <Layers className="w-3.5 h-3.5" />
                Select a brand
              </button>
            )}
          </div>

          {/* New brand shortcut */}
          <button
            onClick={() => { setWizardOpen(true); setSidebarOpen(false) }}
            className="flex items-center gap-2 w-full px-5 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
          >
            <PlusIcon className="w-3.5 h-3.5" />
            New brand
          </button>

          {/* ── Quick-action pills ────────────────────────────────────────── */}
          {activeProject && (
            <div className="px-3 pt-2 pb-1 grid grid-cols-2 gap-1.5">
              {[
                { label: 'Chat', icon: <MessageSquare className="w-3 h-3" />, action: openLatestChat },
                { label: 'Dashboard', icon: <LayoutDashboard className="w-3 h-3" />, action: () => nav(`/projects/${activeProject.id}/dashboard`) },
                { label: 'Library', icon: <Library className="w-3 h-3" />, action: () => nav(`/projects/${activeProject.id}/library`) },
                { label: 'Analytics', icon: <BarChart2 className="w-3 h-3" />, action: () => nav(`/projects/${activeProject.id}/analytics`) },
              ].map(({ label, icon, action }) => (
                <button
                  key={label}
                  onClick={action}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-muted-foreground bg-muted/40 hover:bg-primary/10 hover:text-primary transition-colors"
                >
                  {icon}
                  {label}
                </button>
              ))}
            </div>
          )}

          {/* ── Project nav groups ────────────────────────────────────────── */}
          {activeProject && (
            <div className="mt-1 border-t border-border/40 pt-1">

              {/* Personal Brand — only for personal projects */}
              {activeProject.projectType === 'personal' && (
                <>
                  <NavGroup label="Personal Brand" storageKey="nav_personal" color="text-violet-500">
                    <NavItem icon={<User className="w-3.5 h-3.5" />}            label="My Brand"       onClick={() => { setMyBrandPanelOpen(true); setSidebarOpen(false) }} />
                    <NavItem icon={<LayoutDashboard className="w-3.5 h-3.5" />} label="Dashboard"      onClick={() => nav(`/projects/${activeProject.id}/personal-brand/dashboard`)} />
                    <NavItem icon={<Sparkles className="w-3.5 h-3.5" />}        label="Interview"      onClick={() => nav(`/projects/${activeProject.id}/personal-brand/onboarding`)} />
                    <NavItem icon={<Map className="w-3.5 h-3.5" />}             label="Strategy"       onClick={() => nav(`/projects/${activeProject.id}/personal-brand/strategy`)} />
                    <NavItem icon={<Mic2 className="w-3.5 h-3.5" />}            label="Content Engine" onClick={() => nav(`/projects/${activeProject.id}/personal-brand/content`)} />
                    <NavItem icon={<Send className="w-3.5 h-3.5" />}            label="Publishing"     onClick={() => nav(`/projects/${activeProject.id}/personal-brand/publishing`)} />
                    <NavItem icon={<CalendarDays className="w-3.5 h-3.5" />}    label="Calendar"       onClick={() => nav(`/projects/${activeProject.id}/personal-brand/calendar`)} />
                    <NavItem icon={<BarChart2 className="w-3.5 h-3.5" />}       label="Analytics"      onClick={() => nav(`/projects/${activeProject.id}/personal-brand/analytics`)} />
                  </NavGroup>
                </>
              )}

              {/* Create */}
              <NavGroup label="Create" storageKey="nav_create_v2" color="text-violet-500">
                <NavItem icon={<Layers className="w-3.5 h-3.5" />}        label="Content Studio"  onClick={() => nav(`/projects/${activeProject.id}/content`)} />
                <NavItem icon={<Library className="w-3.5 h-3.5" />}       label="Library"         onClick={() => nav(`/projects/${activeProject.id}/library`)} />
                <NavItem icon={<Zap className="w-3.5 h-3.5" />}           label="Bulk Generate"   onClick={() => nav(`/projects/${activeProject.id}/bulk`)} />
                <NavItem icon={<CalendarRange className="w-3.5 h-3.5" />} label="Content Planner" onClick={() => nav(`/projects/${activeProject.id}/planner`)} />
                <NavItem icon={<ImageIcon className="w-3.5 h-3.5" />}     label="Image Studio"    onClick={() => nav(`/projects/${activeProject.id}/images`)} />
              </NavGroup>

              {/* Publish */}
              <NavGroup label="Publish" storageKey="nav_publish_v2" color="text-emerald-500">
                <NavItem icon={<ClipboardCheck className="w-3.5 h-3.5" />} label="Review Queue"  onClick={() => nav(`/projects/${activeProject.id}/review`)} />
                <NavItem icon={<CalendarDays className="w-3.5 h-3.5" />}   label="Calendar"      onClick={() => nav(`/projects/${activeProject.id}/calendar`)} />
                <NavItem icon={<Send className="w-3.5 h-3.5" />}           label="Publish Queue" onClick={() => nav(`/projects/${activeProject.id}/publish`)} />
              </NavGroup>

              {/* Grow */}
              <NavGroup label="Grow" storageKey="nav_grow" color="text-rose-500">
                <NavItem icon={<Search className="w-3.5 h-3.5" />}       label="SEO Engine"    onClick={() => nav(`/projects/${activeProject.id}/seo-pro`)} />
                <NavItem icon={<DollarSign className="w-3.5 h-3.5" />}   label="Paid Ads"      onClick={() => nav(`/projects/${activeProject.id}/paid-ads`)} />
                <NavItem icon={<Mail className="w-3.5 h-3.5" />}         label="Email CRM"     onClick={() => nav(`/projects/${activeProject.id}/email-crm`)} />
                <NavItem icon={<Send className="w-3.5 h-3.5" />}         label="Social Engine" onClick={() => nav(`/projects/${activeProject.id}/social`)} />
                <NavItem icon={<Newspaper className="w-3.5 h-3.5" />}    label="PR & Comms"    onClick={() => nav(`/projects/${activeProject.id}/pr-comms`)} />
                <NavItem icon={<FlaskConical className="w-3.5 h-3.5" />} label="Experiments"   onClick={() => nav(`/projects/${activeProject.id}/experiments`)} />
              </NavGroup>

              {/* Intelligence */}
              <NavGroup label="Intelligence" storageKey="nav_intel_v2" color="text-blue-500">
                <NavItem icon={<TrendingUp className="w-3.5 h-3.5" />} label="Analytics"      onClick={() => nav(`/projects/${activeProject.id}/analytics`)} />
                <NavItem icon={<BarChart2 className="w-3.5 h-3.5" />}  label="Analytics Pro"  onClick={() => nav(`/projects/${activeProject.id}/analytics-pro`)} />
                <NavItem icon={<FileText className="w-3.5 h-3.5" />}   label="Reports"        onClick={() => nav(`/projects/${activeProject.id}/reports`)} />
                <NavItem icon={<Search className="w-3.5 h-3.5" />}     label="Deep Search"    onClick={() => nav(`/projects/${activeProject.id}/deep-search`)} />
                <NavItem icon={<BarChart2 className="w-3.5 h-3.5" />}  label="Competitors"    onClick={() => nav(`/projects/${activeProject.id}/intelligence`)} />
                <NavItem icon={<Zap className="w-3.5 h-3.5" />}        label="Deep Research"  onClick={() => nav(`/projects/${activeProject.id}/intelligence/deep-research`)} />
                <NavItem icon={<ShieldCheck className="w-3.5 h-3.5" />} label="Brand Health"  onClick={() => nav(`/projects/${activeProject.id}/brand-health`)} />
              </NavGroup>

              {/* Strategy */}
              <NavGroup label="Strategy" storageKey="nav_strategy_v2" color="text-amber-500">
                <NavItem icon={<Map className="w-3.5 h-3.5" />}           label="Strategy Hub" onClick={() => nav(`/projects/${activeProject.id}/strategy`)} />
                <NavItem icon={<Megaphone className="w-3.5 h-3.5" />}     label="Campaigns"    onClick={() => nav(`/projects/${activeProject.id}/campaigns`)} />
                <NavItem icon={<ClipboardList className="w-3.5 h-3.5" />} label="Posts"        onClick={() => nav(`/projects/${activeProject.id}/posts`)} />
              </NavGroup>

              {/* Brand */}
              <NavGroup label="Brand" storageKey="nav_brand_v2" color="text-muted-foreground/60">
                <NavItem icon={<BookOpen className="w-3.5 h-3.5" />}      label="Style Guide"      onClick={() => nav(`/projects/${activeProject.id}/style-guide`)} />
                <NavItem icon={<LayoutTemplate className="w-3.5 h-3.5" />} label="Templates"       onClick={() => nav(`/projects/${activeProject.id}/templates`)} />
                <NavItem icon={<Shield className="w-3.5 h-3.5" />}         label="Brand Audit"     onClick={() => nav(`/projects/${activeProject.id}/brand-audit`)} />
                <NavItem icon={<FileText className="w-3.5 h-3.5" />}       label="Knowledge Base"  onClick={() => nav(`/projects/${activeProject.id}/knowledge`)} />
                <NavItem icon={<Globe className="w-3.5 h-3.5" />}          label="SEO Studio"      onClick={() => nav(`/projects/${activeProject.id}/seo`)} />
                <NavItem icon={<Mail className="w-3.5 h-3.5" />}           label="Email Studio"    onClick={() => nav(`/projects/${activeProject.id}/emails`)} />
                <NavItem icon={<Users className="w-3.5 h-3.5" />}          label="Team"            onClick={() => nav(`/projects/${activeProject.id}/team`)} />
              </NavGroup>

            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-border p-3 space-y-1 shrink-0">
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
                    : 'bg-emerald-500',
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
                    : 'bg-emerald-500',
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

          <button
            onClick={() => setTheme(isDark ? 'light' : 'dark')}
            className="flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            {isDark ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
            <span>{isDark ? 'Light mode' : 'Dark mode'}</span>
          </button>

          <button
            onClick={() => { router.push('/settings'); setSidebarOpen(false) }}
            className="flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <Settings className="w-3.5 h-3.5" />
            <span>Settings</span>
          </button>

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

      {accountOpen && <AccountModal onClose={() => setAccountOpen(false)} />}
      <ChangelogModal open={changelogOpen} onClose={() => setChangelogOpen(false)} />
      <CommandPalette open={cmdOpen} onClose={() => setCmdOpen(false)} />
      <MyBrandPanel />
    </>
  )
}

// ---------------------------------------------------------------------------
// NavGroup — collapsible section with colour accent + left-border indicator
// ---------------------------------------------------------------------------

function NavGroup({
  label, storageKey, children, color,
}: {
  label: string
  storageKey: string
  children: React.ReactNode
  color?: string
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
        className={cn(
          'flex items-center gap-1.5 w-full px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider transition-colors',
          open ? (color ?? 'text-muted-foreground/70') : 'text-muted-foreground/45 hover:text-muted-foreground/70',
        )}
      >
        {open
          ? <ChevronDown className="w-2.5 h-2.5 shrink-0" />
          : <ChevronRight className="w-2.5 h-2.5 shrink-0" />
        }
        {label}
      </button>
      {open && (
        <div className="pb-1 relative">
          <div className={cn(
            'absolute left-[14px] top-0 bottom-1 w-px opacity-20',
            color?.replace('text-', 'bg-') ?? 'bg-muted-foreground',
          )} />
          {children}
        </div>
      )}
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
      className="flex items-center gap-2 w-full pl-7 pr-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
    >
      <span className="shrink-0">{icon}</span>
      <span>{label}</span>
    </button>
  )
}

// ---------------------------------------------------------------------------
// SidebarToggle
// ---------------------------------------------------------------------------

export function SidebarToggle({ className }: { className?: string }) {
  const { setSidebarOpen, sidebarCollapsed, setSidebarCollapsed } = useAppStore()
  return (
    <>
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
