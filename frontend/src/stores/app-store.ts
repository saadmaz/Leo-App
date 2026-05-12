/**
 * Zustand application store - single source of truth for all client state.
 *
 * Sections:
 *  - Auth        - current Firebase user
 *  - Projects    - list, active selection, CRUD helpers
 *  - Chats       - list for active project, active selection, CRUD helpers
 *  - Messages    - optimistic message list for the active chat
 *  - Streaming   - in-flight chat stream state and cancellation
 *  - UI          - sidebar open/close, panel visibility
 *  - Ingestion   - brand ingestion progress tracking
 *
 * Design notes:
 *  - Upsert helpers prevent duplicate entries when re-fetching data.
 *  - streamController holds an AbortController for the active SSE stream so
 *    callers can cancel mid-stream (e.g. on component unmount or user action).
 *  - UI state (sidebar, panels) is intentionally co-located with domain state
 *    to avoid prop-drilling; consider splitting into a separate uiStore if the
 *    app grows significantly.
 */

import { create } from 'zustand'
import type {
  AppUser,
  BillingStatus,
  BrandCore,
  CalendarEntry,
  Campaign,
  Chat,
  CreditsStatus,
  IngestionStep,
  OptimisticMessage,
  Project,
} from '@/types'
import type { ChannelKey } from '@/components/chat/channel-selector'

interface AppState {
  // ---------------------------------------------------------------------------
  // Auth
  // ---------------------------------------------------------------------------
  user: AppUser | null
  setUser: (user: AppUser | null) => void

  // ---------------------------------------------------------------------------
  // Projects
  // ---------------------------------------------------------------------------
  projects: Project[]
  activeProject: Project | null
  setProjects: (projects: Project[]) => void
  setActiveProject: (project: Project | null) => void
  /** Insert or replace a project by id. Prepends new projects to the list. */
  upsertProject: (project: Project) => void
  removeProject: (id: string) => void

  // ---------------------------------------------------------------------------
  // Chats
  // ---------------------------------------------------------------------------
  chats: Chat[]
  activeChat: Chat | null
  setChats: (chats: Chat[]) => void
  /** Switching the active chat also clears the message list. */
  setActiveChat: (chat: Chat | null) => void
  /** Insert or replace a chat by id. Prepends new chats to the list. */
  upsertChat: (chat: Chat) => void
  removeChat: (id: string) => void

  // ---------------------------------------------------------------------------
  // Messages
  // ---------------------------------------------------------------------------
  messages: OptimisticMessage[]
  setMessages: (messages: OptimisticMessage[]) => void
  /** Append a new optimistic message (displayed immediately, before server ack). */
  addMessage: (msg: OptimisticMessage) => void
  /** Append a text delta to an in-progress streaming message. */
  appendDelta: (id: string, delta: string) => void
  /** Mark a message as fully received and update its final content. */
  finaliseMessage: (id: string, content: string) => void

  // ---------------------------------------------------------------------------
  // Streaming - chat SSE state + cancellation
  // ---------------------------------------------------------------------------
  isStreaming: boolean
  setIsStreaming: (v: boolean) => void
  /**
   * AbortController for the active SSE stream.
   * Set this before calling api.streamMessage(), clear it on completion.
   * Components can call streamController?.abort() to stop the stream early.
   */
  streamController: AbortController | null
  setStreamController: (controller: AbortController | null) => void

  // ---------------------------------------------------------------------------
  // UI
  // ---------------------------------------------------------------------------
  sidebarOpen: boolean
  setSidebarOpen: (v: boolean) => void
  sidebarCollapsed: boolean
  setSidebarCollapsed: (v: boolean) => void

  // ---------------------------------------------------------------------------
  // Brand Core panel
  // ---------------------------------------------------------------------------
  brandCorePanelOpen: boolean
  setBrandCorePanelOpen: (v: boolean) => void

  // ---------------------------------------------------------------------------
  // Ingestion
  // ---------------------------------------------------------------------------
  ingestionOpen: boolean
  setIngestionOpen: (v: boolean) => void
  ingestionSteps: IngestionStep[]
  ingestionProgress: number
  ingestionRunning: boolean
  addIngestionStep: (step: IngestionStep) => void
  setIngestionProgress: (pct: number) => void
  setIngestionRunning: (v: boolean) => void
  resetIngestion: () => void
  /**
   * Called when ingestion completes successfully.
   * Updates the brand core on both the project list and the active project.
   */
  onIngestionDone: (projectId: string, brandCore: BrandCore) => void

  // ---------------------------------------------------------------------------
  // Channel
  // ---------------------------------------------------------------------------
  activeChannel: ChannelKey | null
  setActiveChannel: (channel: ChannelKey | null) => void

  // ---------------------------------------------------------------------------
  // Project Wizard
  // ---------------------------------------------------------------------------
  wizardOpen: boolean
  setWizardOpen: (v: boolean) => void

  // ---------------------------------------------------------------------------
  // Project Settings Panel
  // ---------------------------------------------------------------------------
  projectSettingsPanelOpen: boolean
  setProjectSettingsPanelOpen: (v: boolean) => void

  // ---------------------------------------------------------------------------
  // Campaigns
  // ---------------------------------------------------------------------------
  campaigns: Campaign[]
  setCampaigns: (campaigns: Campaign[]) => void
  upsertCampaign: (campaign: Campaign) => void
  removeCampaign: (id: string) => void
  campaignPanelOpen: boolean
  setCampaignPanelOpen: (v: boolean) => void
  campaignGeneratorOpen: boolean
  setCampaignGeneratorOpen: (v: boolean) => void
  activeCampaign: Campaign | null
  setActiveCampaign: (campaign: Campaign | null) => void

  // ---------------------------------------------------------------------------
  // Billing
  // ---------------------------------------------------------------------------
  billingStatus: BillingStatus | null
  setBillingStatus: (status: BillingStatus | null) => void
  upgradeModalOpen: boolean
  upgradeModalReason: string
  openUpgradeModal: (reason?: string) => void
  closeUpgradeModal: () => void

  // ---------------------------------------------------------------------------
  // Credits
  // ---------------------------------------------------------------------------
  credits: CreditsStatus | null
  setCredits: (credits: CreditsStatus | null) => void

  // ---------------------------------------------------------------------------
  // Brand Voice Scorer panel
  // ---------------------------------------------------------------------------
  brandVoiceScorerOpen: boolean
  setBrandVoiceScorerOpen: (v: boolean) => void
  // ---------------------------------------------------------------------------
  // Hashtag Research panel
  // ---------------------------------------------------------------------------
  hashtagPanelOpen: boolean
  setHashtagPanelOpen: (v: boolean) => void

  // ---------------------------------------------------------------------------
  // Funnel Strategy Engine
  // ---------------------------------------------------------------------------
  strategySession: import('@/types').StrategySession | null
  setStrategySession: (session: import('@/types').StrategySession | null) => void
  updateStrategySession: (patch: Partial<import('@/types').StrategySession>) => void
  resetStrategySession: () => void

  // ---------------------------------------------------------------------------
  // Carousel Studio
  // ---------------------------------------------------------------------------
  carouselSession: import('@/types').CarouselSession | null
  setCarouselSession: (session: import('@/types').CarouselSession | null) => void
  updateCarouselSession: (patch: Partial<import('@/types').CarouselSession>) => void
  resetCarouselSession: () => void

  // ---------------------------------------------------------------------------
  // Calendar Cache - keyed by "projectId-YYYY-MM"
  // ---------------------------------------------------------------------------
  calendarCache: Record<string, CalendarEntry[]>
  setCalendarCache: (key: string, entries: CalendarEntry[]) => void
  invalidateCalendarCache: (key: string) => void

  // ---------------------------------------------------------------------------
  // Checklist Cache - keyed by projectId; expires after 5 min
  // ---------------------------------------------------------------------------
  checklistCache: Record<string, { items: unknown[]; fetchedAt: number }>
  setChecklistCache: (projectId: string, items: unknown[]) => void
  invalidateChecklistCache: (projectId: string) => void

  // ---------------------------------------------------------------------------
  // Personal Brand
  // ---------------------------------------------------------------------------
  personalCore: import('@/types').PersonalCore | null
  setPersonalCore: (core: import('@/types').PersonalCore | null) => void
  personalVoiceProfile: import('@/types').PersonalVoiceProfile | null
  setPersonalVoiceProfile: (profile: import('@/types').PersonalVoiceProfile | null) => void
  myBrandPanelOpen: boolean
  setMyBrandPanelOpen: (v: boolean) => void
}

export const useAppStore = create<AppState>((set) => ({
  // ---------------------------------------------------------------------------
  // Auth
  // ---------------------------------------------------------------------------
  user: null,
  setUser: (user) => set({ user }),

  // ---------------------------------------------------------------------------
  // Projects
  // ---------------------------------------------------------------------------
  projects: [],
  activeProject: null,
  setProjects: (projects) => set({ projects }),
  setActiveProject: (activeProject) => set({ activeProject }),
  upsertProject: (project) =>
    set((s) => ({
      projects: s.projects.some((p) => p.id === project.id)
        ? s.projects.map((p) => (p.id === project.id ? project : p))
        : [project, ...s.projects],
      // Keep activeProject in sync if it's the one being updated.
      activeProject: s.activeProject?.id === project.id ? project : s.activeProject,
    })),
  removeProject: (id) =>
    set((s) => ({
      projects: s.projects.filter((p) => p.id !== id),
      activeProject: s.activeProject?.id === id ? null : s.activeProject,
    })),

  // ---------------------------------------------------------------------------
  // Chats
  // ---------------------------------------------------------------------------
  chats: [],
  activeChat: null,
  setChats: (chats) => set({ chats }),
  setActiveChat: (activeChat) => set({ activeChat, messages: [] }),
  upsertChat: (chat) =>
    set((s) => ({
      chats: s.chats.some((c) => c.id === chat.id)
        ? s.chats.map((c) => (c.id === chat.id ? chat : c))
        : [chat, ...s.chats],
      activeChat: s.activeChat?.id === chat.id ? chat : s.activeChat,
    })),
  removeChat: (id) =>
    set((s) => ({
      chats: s.chats.filter((c) => c.id !== id),
      activeChat: s.activeChat?.id === id ? null : s.activeChat,
    })),

  // ---------------------------------------------------------------------------
  // Messages
  // ---------------------------------------------------------------------------
  messages: [],
  setMessages: (messages) => set({ messages }),
  addMessage: (msg) => set((s) => ({ messages: [...s.messages, msg] })),
  appendDelta: (id, delta) =>
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === id ? { ...m, content: m.content + delta } : m,
      ),
    })),
  finaliseMessage: (id, content) =>
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === id ? { ...m, content, pending: false } : m,
      ),
    })),

  // ---------------------------------------------------------------------------
  // Streaming
  // ---------------------------------------------------------------------------
  isStreaming: false,
  setIsStreaming: (isStreaming) => set({ isStreaming }),
  streamController: null,
  setStreamController: (streamController) => set({ streamController }),

  // ---------------------------------------------------------------------------
  // UI
  // ---------------------------------------------------------------------------
  sidebarOpen: true,
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
  sidebarCollapsed: false,
  setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),

  // ---------------------------------------------------------------------------
  // Brand Core panel
  // ---------------------------------------------------------------------------
  brandCorePanelOpen: false,
  setBrandCorePanelOpen: (brandCorePanelOpen) => set({ brandCorePanelOpen }),

  // ---------------------------------------------------------------------------
  // Ingestion
  // ---------------------------------------------------------------------------
  ingestionOpen: false,
  setIngestionOpen: (ingestionOpen) => set({ ingestionOpen }),
  ingestionSteps: [],
  ingestionProgress: 0,
  ingestionRunning: false,
  addIngestionStep: (step) =>
    set((s) => ({
      // Replace existing step with the same label (e.g. running → done).
      ingestionSteps: [...s.ingestionSteps.filter((x) => x.label !== step.label), step],
    })),
  setIngestionProgress: (ingestionProgress) => set({ ingestionProgress }),
  setIngestionRunning: (ingestionRunning) => set({ ingestionRunning }),
  resetIngestion: () =>
    set({ ingestionSteps: [], ingestionProgress: 0, ingestionRunning: false }),
  onIngestionDone: (projectId, brandCore) =>
    set((s) => {
      const updated = s.projects.map((p) =>
        p.id === projectId
          ? { ...p, brandCore, ingestionStatus: 'complete' as const }
          : p,
      )
      const activeProject =
        s.activeProject?.id === projectId
          ? { ...s.activeProject, brandCore, ingestionStatus: 'complete' as const }
          : s.activeProject
      return { projects: updated, activeProject }
    }),

  // ---------------------------------------------------------------------------
  // Channel
  // ---------------------------------------------------------------------------
  activeChannel: null,
  setActiveChannel: (activeChannel) => set({ activeChannel }),

  // ---------------------------------------------------------------------------
  // Project Wizard
  // ---------------------------------------------------------------------------
  wizardOpen: false,
  setWizardOpen: (wizardOpen) => set({ wizardOpen }),

  // ---------------------------------------------------------------------------
  // Project Settings Panel
  // ---------------------------------------------------------------------------
  projectSettingsPanelOpen: false,
  setProjectSettingsPanelOpen: (projectSettingsPanelOpen) => set({ projectSettingsPanelOpen }),

  // ---------------------------------------------------------------------------
  // Campaigns
  // ---------------------------------------------------------------------------
  campaigns: [],
  setCampaigns: (campaigns) => set({ campaigns }),
  upsertCampaign: (campaign) =>
    set((s) => ({
      campaigns: s.campaigns.some((c) => c.id === campaign.id)
        ? s.campaigns.map((c) => (c.id === campaign.id ? campaign : c))
        : [campaign, ...s.campaigns],
      activeCampaign: s.activeCampaign?.id === campaign.id ? campaign : s.activeCampaign,
    })),
  removeCampaign: (id) =>
    set((s) => ({
      campaigns: s.campaigns.filter((c) => c.id !== id),
      activeCampaign: s.activeCampaign?.id === id ? null : s.activeCampaign,
    })),
  campaignPanelOpen: false,
  setCampaignPanelOpen: (campaignPanelOpen) => set({ campaignPanelOpen }),
  campaignGeneratorOpen: false,
  setCampaignGeneratorOpen: (campaignGeneratorOpen) => set({ campaignGeneratorOpen }),
  activeCampaign: null,
  setActiveCampaign: (activeCampaign) => set({ activeCampaign }),

  // ---------------------------------------------------------------------------
  // Billing
  // ---------------------------------------------------------------------------
  billingStatus: null,
  setBillingStatus: (billingStatus) => set({ billingStatus }),
  upgradeModalOpen: false,
  upgradeModalReason: '',
  openUpgradeModal: (reason = '') => set({ upgradeModalOpen: true, upgradeModalReason: reason }),
  closeUpgradeModal: () => set({ upgradeModalOpen: false, upgradeModalReason: '' }),

  // ---------------------------------------------------------------------------
  // Credits
  // ---------------------------------------------------------------------------
  credits: null,
  setCredits: (credits) => set({ credits }),

  // ---------------------------------------------------------------------------
  // Brand Voice Scorer panel
  // ---------------------------------------------------------------------------
  brandVoiceScorerOpen: false,
  setBrandVoiceScorerOpen: (brandVoiceScorerOpen) => set({ brandVoiceScorerOpen }),
  hashtagPanelOpen: false,
  setHashtagPanelOpen: (hashtagPanelOpen) => set({ hashtagPanelOpen }),

  // ---------------------------------------------------------------------------
  // Funnel Strategy Engine
  // ---------------------------------------------------------------------------
  strategySession: null,
  setStrategySession: (strategySession) => set({ strategySession }),
  updateStrategySession: (patch) =>
    set((s) => ({
      strategySession: s.strategySession ? { ...s.strategySession, ...patch } : null,
    })),
  resetStrategySession: () => set({ strategySession: null }),

  // ---------------------------------------------------------------------------
  // Carousel Studio
  // ---------------------------------------------------------------------------
  carouselSession: null,
  setCarouselSession: (carouselSession) => set({ carouselSession }),
  updateCarouselSession: (patch) =>
    set((s) => ({
      carouselSession: s.carouselSession ? { ...s.carouselSession, ...patch } : null,
    })),
  resetCarouselSession: () => set({ carouselSession: null }),

  // ---------------------------------------------------------------------------
  // Calendar Cache
  // ---------------------------------------------------------------------------
  calendarCache: {},
  setCalendarCache: (key, entries) =>
    set((s) => ({ calendarCache: { ...s.calendarCache, [key]: entries } })),
  invalidateCalendarCache: (key) =>
    set((s) => {
      const next = { ...s.calendarCache }
      delete next[key]
      return { calendarCache: next }
    }),

  // ---------------------------------------------------------------------------
  // Checklist Cache
  // ---------------------------------------------------------------------------
  checklistCache: {},
  setChecklistCache: (projectId, items) =>
    set((s) => ({
      checklistCache: {
        ...s.checklistCache,
        [projectId]: { items, fetchedAt: Date.now() },
      },
    })),
  invalidateChecklistCache: (projectId) =>
    set((s) => {
      const next = { ...s.checklistCache }
      delete next[projectId]
      return { checklistCache: next }
    }),

  // ---------------------------------------------------------------------------
  // Personal Brand
  // ---------------------------------------------------------------------------
  personalCore: null,
  setPersonalCore: (personalCore) => set({ personalCore }),
  personalVoiceProfile: null,
  setPersonalVoiceProfile: (personalVoiceProfile) => set({ personalVoiceProfile }),
  myBrandPanelOpen: false,
  setMyBrandPanelOpen: (myBrandPanelOpen) => set({ myBrandPanelOpen }),
}))
