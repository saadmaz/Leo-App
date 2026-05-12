/**
 * API client - thin wrapper around fetch for all backend communication.
 *
 * Design principles:
 *  - All requests are authenticated via Firebase ID tokens (injected by authHeaders()).
 *  - REST operations (get/post/patch/del) are generic and typed at call sites.
 *  - SSE streaming uses a shared readSSEStream() helper to avoid duplication
 *    and ensure consistent buffer handling across chat and ingestion.
 *  - AbortSignal support lets callers cancel in-flight requests (important
 *    for cleaning up when a component unmounts mid-stream).
 */

import { auth } from './firebase'
import type {
  BillingStatus,
  BrandCore,
  BrandDriftResult,
  BrandVoiceScore,
  BulkGenerateEvent,
  CalendarEntry,
  Campaign,
  CampaignEvent,
  CampaignGenerateRequest,
  Chat,
  CompetitorSnapshot,
  ContentLibraryItem,
  ContentPrediction,
  ImageAttachment,
  IngestionEvent,
  MemoryFeedbackItem,
  Message,
  Project,
  BlogPostMeta,
  EmailItem,
  HashtagResult,
  MetaTagsResult,
  PerformanceRecord,
  ProjectAnalytics,
  ProjectCreate,
  ProjectInsight,
  PublishQueueDay,
  ProjectMember,
  ContentTemplate,
  ContentPlanItem,
  GeneratedImage,
  ReviewDecision,
  ReviewHistoryEntry,
  StreamEvent,
  StyleGuide,
  TransformResult,
  WebsiteCopySection,
  ContentMetrics,
  AnalyticsOverview,
  ContentPerformanceRow,
  AnalyticsTrends,
  ActivityEvent,
  WeeklyDigest,
  ContentScoreResult,
  MonitorAlert,
  ResearchReport,
  ContentGap,
  ContentTopic,
  DiscoveredCompetitor,
  DiscoveredInfluencer,
  CompetitiveStrategy,
  CompetitorReport,
  Post,
  PostCreate,
  PostUpdate,
  CreditsStatus,
  CreditTransaction,
  DeepSearchHistory,
  CompetitorProfile,
  ClassifyStreamEvent,
  DeepResearchEvent,
  DeepResearchReport,
  DeepResearchReportSummary,
  CompetitorMonitor,
  MonitorChangeAlert,
  CompetitorInput,
  PersonalCore,
  PersonalVoiceProfile,
  InterviewNextResponse,
  PersonalCoreExtractionEvent,
  ContentEngineEvent,
  ContentPlatform,
  VoiceCalibrationEvent,
  PublishingProfile,
  ConnectedPlatform,
  AyrsharePostResult,
  PublishedPost,
  Pillar1Doc,
  Pillar1Message,
  Pillar1SSEEvent,
  Pillar1StreamCallbacks,
  ICPGenerateBody,
} from '@/types'

// All backend requests are proxied through Next.js rewrites defined in
// next.config.js so the browser never talks to the backend directly.
const API = '/api/backend'

// ---------------------------------------------------------------------------
// Intelligence stream event type
// ---------------------------------------------------------------------------

export type IntelligenceStreamEvent =
  | { type: 'step'; message: string; icon: string; detail?: string; competitor?: string }
  | { type: 'result'; competitors?: DiscoveredCompetitor[]; refreshed?: { name: string; platforms_scraped: string[] }[] }
  | { type: 'error'; message: string }

// ---------------------------------------------------------------------------
// Auth headers
// ---------------------------------------------------------------------------

async function authHeaders(): Promise<HeadersInit> {
  // Wait for Firebase to restore the persisted auth session before reading
  // currentUser - without this, requests made on initial page load race against
  // auth initialisation and arrive with no token, causing 401s.
  await auth.authStateReady()
  const user = auth.currentUser
  const token = user ? await user.getIdToken() : null
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
}

// ---------------------------------------------------------------------------
// Core HTTP helpers
// ---------------------------------------------------------------------------

async function extractErrorMessage(res: Response): Promise<string> {
  const text = await res.text()
  if (res.status === 402) {
    try {
      const json = JSON.parse(text)
      const detail = json?.detail
      if (typeof detail === 'object' && detail?.message) return detail.message as string
      if (typeof detail === 'string') return detail
    } catch { /* fall through */ }
  }
  return `${res.status === 402 ? 'Insufficient credits' : `${res.status}`}: ${text}`
}

async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    headers: await authHeaders(),
    signal,
  })
  if (!res.ok) throw new Error(await extractErrorMessage(res))
  return res.json()
}

async function post<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify(body),
    signal,
  })
  if (!res.ok) throw new Error(await extractErrorMessage(res))
  return res.json()
}

async function patch<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: 'PATCH',
    headers: await authHeaders(),
    body: JSON.stringify(body),
    signal,
  })
  if (!res.ok) throw new Error(await extractErrorMessage(res))
  return res.json()
}

async function del(path: string, signal?: AbortSignal): Promise<void> {
  const res = await fetch(`${API}${path}`, {
    method: 'DELETE',
    headers: await authHeaders(),
    signal,
  })
  if (!res.ok) throw new Error(await extractErrorMessage(res))
}

// ---------------------------------------------------------------------------
// Shared SSE stream reader
// ---------------------------------------------------------------------------

/**
 * Read a Server-Sent Events stream from a ReadableStream, parsing each
 * `data: ...` line as JSON and dispatching to the appropriate callback.
 *
 * This is used by both streamMessage() and streamIngestion() so the
 * buffering and parsing logic lives in exactly one place.
 *
 * @param reader   ReadableStreamDefaultReader obtained from response.body.
 * @param onEvent  Called for each parsed event object.
 * @param onDone   Called when the sentinel `data: [DONE]` is received OR
 *                 when the stream closes naturally (done === true).
 */
async function readSSEStream<TEvent>(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  onEvent: (event: TEvent) => void,
  onDone: () => void,
): Promise<void> {
  const decoder = new TextDecoder()
  // Incomplete line fragments are buffered here across read() calls.
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })

      // SSE lines are separated by \n. The last element may be an incomplete
      // line; keep it in the buffer for the next iteration.
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue

        const raw = line.slice(6).trim()

        // The [DONE] sentinel signals the end of the logical stream.
        if (raw === '[DONE]') {
          onDone()
          return
        }

        try {
          const event = JSON.parse(raw) as TEvent
          onEvent(event)
        } catch {
          // Malformed JSON - skip the line. The backend logs these.
        }
      }
    }
  } finally {
    reader.releaseLock()
  }

  // Stream closed without an explicit [DONE] - treat as completion.
  onDone()
}

// ---------------------------------------------------------------------------
// SSE streaming helpers
// ---------------------------------------------------------------------------

async function streamPost<TEvent>(
  path: string,
  body: unknown,
  onEvent: (event: TEvent) => void,
  onDone: () => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { ...(await authHeaders()), 'Accept': 'text/event-stream' },
    body: JSON.stringify(body),
    signal,
  })
  if (!res.ok) throw new Error(`POST ${path} → ${res.status}: ${await res.text()}`)
  if (!res.body) { onDone(); return }
  await readSSEStream(res.body.getReader(), onEvent, onDone)
}

async function streamGet<TEvent>(
  path: string,
  onEvent: (event: TEvent) => void,
  onDone: () => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`${API}${path}`, {
    headers: { ...(await authHeaders()), 'Accept': 'text/event-stream' },
    signal,
  })
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}: ${await res.text()}`)
  if (!res.body) { onDone(); return }
  await readSSEStream(res.body.getReader(), onEvent, onDone)
}

// ---------------------------------------------------------------------------
// Pillar 1 SSE handler factory
// ---------------------------------------------------------------------------

function makePillar1Handler(callbacks: Pillar1StreamCallbacks) {
  return (event: Pillar1SSEEvent) => {
    switch (event.type) {
      case 'research_step':
        callbacks.onStep?.(event.step ?? '', event.label ?? '', event.status ?? '')
        break
      case 'delta':
        callbacks.onDelta?.(event.content ?? '')
        break
      case 'stage_advance':
        callbacks.onStageAdvance?.(event.new_stage ?? 0, event.label ?? '')
        break
      case 'icp_saved':
      case 'gtm_saved':
      case 'okr_saved':
      case 'budget_saved':
      case 'personas_saved':
      case 'market_sizing_saved':
      case 'positioning_saved':
      case 'comp_map_saved':
      case 'launch_saved':
      case 'risk_scan_saved':
      // Pillar 2 saved events
      case 'headline_saved':
      case 'visual_brief_saved':
      case 'video_script_saved':
      case 'podcast_saved':
      case 'quality_saved':
      case 'translate_saved':
      case 'case_study_saved':
      case 'content_gap_saved':
      // Pillar 3 saved events
      case 'keyword_research_saved':
      case 'serp_intent_saved':
      case 'on_page_seo_saved':
      case 'featured_snippet_saved':
      case 'content_freshness_saved':
      case 'technical_seo_saved':
        callbacks.onSaved?.(event.doc_id ?? '', event.payload ?? {})
        break
      case 'error':
        callbacks.onError?.(event.message ?? 'Unknown error')
        break
    }
  }
}

// ---------------------------------------------------------------------------
// Public API surface
// ---------------------------------------------------------------------------

export const api = {
  // -------------------------------------------------------------------------
  // Projects
  // -------------------------------------------------------------------------
  projects: {
    list: (signal?: AbortSignal) => get<Project[]>('/projects', signal),
    get: (id: string, signal?: AbortSignal) => get<Project>(`/projects/${id}`, signal),
    create: (body: ProjectCreate, signal?: AbortSignal) =>
      post<Project>('/projects', body, signal),
    update: (id: string, body: Partial<ProjectCreate>, signal?: AbortSignal) =>
      patch<Project>(`/projects/${id}`, body, signal),
    delete: (id: string, signal?: AbortSignal) => del(`/projects/${id}`, signal),
  },

  // -------------------------------------------------------------------------
  // Chats
  // -------------------------------------------------------------------------
  chats: {
    list: (projectId: string, signal?: AbortSignal) =>
      get<Chat[]>(`/projects/${projectId}/chats`, signal),
    get: (projectId: string, chatId: string, signal?: AbortSignal) =>
      get<Chat>(`/projects/${projectId}/chats/${chatId}`, signal),
    create: (projectId: string, name?: string, signal?: AbortSignal) =>
      post<Chat>(`/projects/${projectId}/chats`, { name: name ?? 'New Chat' }, signal),
    rename: (projectId: string, chatId: string, name: string, signal?: AbortSignal) =>
      patch<Chat>(`/projects/${projectId}/chats/${chatId}`, { name }, signal),
    delete: (projectId: string, chatId: string, signal?: AbortSignal) =>
      del(`/projects/${projectId}/chats/${chatId}`, signal),
    messages: (projectId: string, chatId: string, before?: string, signal?: AbortSignal) =>
      get<Message[]>(
        `/projects/${projectId}/chats/${chatId}/messages${before ? `?before=${encodeURIComponent(before)}` : ''}`,
        signal,
      ),
  },

  // -------------------------------------------------------------------------
  // Posts
  // -------------------------------------------------------------------------
  posts: {
    list: (projectId: string, signal?: AbortSignal) =>
      get<Post[]>(`/projects/${projectId}/posts`, signal),
    get: (projectId: string, postId: string, signal?: AbortSignal) =>
      get<Post>(`/projects/${projectId}/posts/${postId}`, signal),
    create: (projectId: string, body: PostCreate, signal?: AbortSignal) =>
      post<Post>(`/projects/${projectId}/posts`, body, signal),
    update: (projectId: string, postId: string, body: PostUpdate, signal?: AbortSignal) =>
      patch<Post>(`/projects/${projectId}/posts/${postId}`, body, signal),
    delete: (projectId: string, postId: string, signal?: AbortSignal) =>
      del(`/projects/${projectId}/posts/${postId}`, signal),
  },

  // -------------------------------------------------------------------------
  // Chat streaming (SSE)
  // -------------------------------------------------------------------------

  /**
   * Send a user message and stream the assistant's response via SSE.
   *
   * @param signal  Optional AbortSignal to cancel the request (e.g. on
   *                component unmount or when the user hits "Stop").
   */
  async streamMessage(
    projectId: string,
    chatId: string,
    content: string,
    callbacks: {
      onDelta: (text: string) => void
      onDone: () => void
      onError: (err: string) => void
      onToolCall?: (tool: string, query: string) => void
      onToolResult?: (tool: string, preview: string) => void
      onStatus?: (message: string) => void
    },
    signal?: AbortSignal,
    channel?: string | null,
    images?: Pick<ImageAttachment, 'base64' | 'mediaType'>[],
  ): Promise<void> {
    const user = auth.currentUser
    if (!user) { callbacks.onError('Not authenticated'); return }

    const token = await user.getIdToken()

    let res: Response
    try {
      res = await fetch(`${API}/projects/${projectId}/chats/${chatId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          content,
          ...(channel ? { channel } : {}),
          ...(images && images.length > 0 ? { images } : {}),
        }),
        signal,
      })
    } catch (err) {
      // AbortError is expected when signal.abort() is called - don't surface it as an error.
      if (err instanceof DOMException && err.name === 'AbortError') return
      callbacks.onError(String(err))
      return
    }

    if (!res.ok) { callbacks.onError(await extractErrorMessage(res)); return }

    const reader = res.body?.getReader()
    if (!reader) { callbacks.onError('No readable stream in response'); return }

    await readSSEStream<StreamEvent>(
      reader,
      (event) => {
        if (event.type === 'delta') callbacks.onDelta(event.content)
        if (event.type === 'error') callbacks.onError(event.error)
        if (event.type === 'tool_call') callbacks.onToolCall?.(event.tool, event.query)
        if (event.type === 'tool_result') callbacks.onToolResult?.(event.tool, event.preview)
        if (event.type === 'status') callbacks.onStatus?.(event.message)
      },
      callbacks.onDone,
    )
  },

  // -------------------------------------------------------------------------
  // Brand Core
  // -------------------------------------------------------------------------
  brandCore: {
    get: (projectId: string, signal?: AbortSignal) =>
      get<{ brandCore: BrandCore | null; ingestionStatus: string | null }>(
        `/projects/${projectId}/brand-core`,
        signal,
      ),
    update: (projectId: string, data: Partial<BrandCore>, signal?: AbortSignal) =>
      patch<{ brandCore: BrandCore }>(`/projects/${projectId}/brand-core`, data, signal),
    clear: (projectId: string, signal?: AbortSignal) =>
      del(`/projects/${projectId}/brand-core`, signal),
  },

  // -------------------------------------------------------------------------
  // Brand ingestion streaming (SSE)
  // -------------------------------------------------------------------------

  /**
   * Start brand ingestion and stream progress events via SSE.
   *
   * @param signal  Optional AbortSignal to cancel mid-ingestion.
   */
  async streamIngestion(
    projectId: string,
    body: {
      websiteUrl?: string
      instagramHandle?: string
      facebookUrl?: string
      tiktokUrl?: string
      linkedinUrl?: string
      xUrl?: string
      youtubeUrl?: string
    },
    callbacks: {
      onStep: (step: import('@/types').IngestionStep) => void
      onProgress: (pct: number) => void
      onDone: (brandCore: BrandCore) => void
      onError: (message: string) => void
    },
    signal?: AbortSignal,
  ): Promise<void> {
    const user = auth.currentUser
    if (!user) { callbacks.onError('Not authenticated'); return }
    const token = await user.getIdToken()

    let res: Response
    try {
      res = await fetch(`${API}/projects/${projectId}/ingest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
        signal,
      })
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return
      callbacks.onError(String(err))
      return
    }

    if (!res.ok) { callbacks.onError(await extractErrorMessage(res)); return }

    const reader = res.body?.getReader()
    if (!reader) { callbacks.onError('No stream'); return }

    await readSSEStream<IngestionEvent>(
      reader,
      (event) => {
        if (event.type === 'step')     callbacks.onStep(event)
        if (event.type === 'progress') callbacks.onProgress(event.pct)
        if (event.type === 'done')     callbacks.onDone(event.brandCore)
        if (event.type === 'error')    callbacks.onError(event.message)
      },
      () => {/* ingestion done is signalled via the 'done' event type, not [DONE] sentinel */},
    )
  },

  // -------------------------------------------------------------------------
  // Assets
  // -------------------------------------------------------------------------

  async uploadLogo(projectId: string, file: File): Promise<{ url: string }> {
    const user = auth.currentUser
    if (!user) throw new Error('Not authenticated')
    const token = await user.getIdToken()
    const form = new FormData()
    form.append('file', file)
    const res = await fetch(`${API}/projects/${projectId}/assets/logo`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    })
    if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`)
    return res.json()
  },

  async uploadMedia(projectId: string, file: File): Promise<{ url: string; content_type: string }> {
    const user = auth.currentUser
    if (!user) throw new Error('Not authenticated')
    const token = await user.getIdToken()
    const form = new FormData()
    form.append('file', file)
    const res = await fetch(`${API}/projects/${projectId}/assets/media`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    })
    if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`)
    return res.json()
  },

  // -------------------------------------------------------------------------
  // Campaigns
  // -------------------------------------------------------------------------
  campaigns: {
    list: (projectId: string, signal?: AbortSignal) =>
      get<Campaign[]>(`/projects/${projectId}/campaigns`, signal),
    get: (projectId: string, campaignId: string, signal?: AbortSignal) =>
      get<Campaign>(`/projects/${projectId}/campaigns/${campaignId}`, signal),
    update: (projectId: string, campaignId: string, body: { contentPacks?: Record<string, unknown>; name?: string }, signal?: AbortSignal) =>
      patch<Campaign>(`/projects/${projectId}/campaigns/${campaignId}`, body, signal),
    duplicate: (projectId: string, campaignId: string, signal?: AbortSignal) =>
      post<Campaign>(`/projects/${projectId}/campaigns/${campaignId}/duplicate`, {}, signal),
    delete: (projectId: string, campaignId: string, signal?: AbortSignal) =>
      del(`/projects/${projectId}/campaigns/${campaignId}`, signal),
  },

  async streamCampaignGenerate(
    projectId: string,
    body: CampaignGenerateRequest,
    callbacks: {
      onStep: (step: import('@/types').IngestionStep) => void
      onProgress: (pct: number) => void
      onDone: (campaign: Campaign, campaignId: string) => void
      onError: (message: string) => void
    },
    signal?: AbortSignal,
  ): Promise<void> {
    const user = auth.currentUser
    if (!user) { callbacks.onError('Not authenticated'); return }
    const token = await user.getIdToken()

    let res: Response
    try {
      res = await fetch(`${API}/projects/${projectId}/campaigns/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
        signal,
      })
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return
      callbacks.onError(String(err))
      return
    }

    if (!res.ok) { callbacks.onError(await extractErrorMessage(res)); return }

    const reader = res.body?.getReader()
    if (!reader) { callbacks.onError('No stream'); return }

    await readSSEStream<CampaignEvent>(
      reader,
      (event) => {
        if (event.type === 'step')     callbacks.onStep(event)
        if (event.type === 'progress') callbacks.onProgress(event.pct)
        if (event.type === 'done')     callbacks.onDone(event.campaign, event.campaignId)
        if (event.type === 'error')    callbacks.onError(event.message)
      },
      () => {},
    )
  },

  // -------------------------------------------------------------------------
  // Generate (image, etc.)
  // -------------------------------------------------------------------------
  generate: {
    image: (
      projectId: string,
      body: { prompt: string; style?: string; aspectRatio?: string },
      signal?: AbortSignal,
    ) => post<{ url: string }>(`/projects/${projectId}/generate/image`, body, signal),

    aiPrompt: (
      projectId: string,
      body: { brief: string; platform?: string; style?: string },
      signal?: AbortSignal,
    ) => post<{ prompt: string }>(`/projects/${projectId}/generate/ai-prompt`, body, signal),
  },

  // -------------------------------------------------------------------------
  images: {
    list: (projectId: string, signal?: AbortSignal) =>
      get<{ images: GeneratedImage[]; count: number }>(
        `/projects/${projectId}/images`,
        signal,
      ),

    save: (
      projectId: string,
      body: { dataUrl: string; prompt: string; aspectRatio?: string; style?: string; platform?: string },
      signal?: AbortSignal,
    ) => post<GeneratedImage>(`/projects/${projectId}/images`, body, signal),

    delete: (projectId: string, imageId: string, signal?: AbortSignal) =>
      del(`/projects/${projectId}/images/${imageId}`, signal),
  },

  // -------------------------------------------------------------------------
  planner: {
    generate: (
      projectId: string,
      body: { duration?: string; platforms?: string[]; goal?: string; postsPerWeek?: number },
      signal?: AbortSignal,
    ) =>
      post<{ items: ContentPlanItem[]; count: number }>(
        `/projects/${projectId}/planner/generate`,
        body,
        signal,
      ),

    apply: (
      projectId: string,
      items: ContentPlanItem[],
      mode: 'library' | 'calendar' = 'library',
      signal?: AbortSignal,
    ) =>
      post<{ saved: number; total: number; mode: string }>(
        `/projects/${projectId}/planner/apply`,
        { items, mode },
        signal,
      ),
  },

  // -------------------------------------------------------------------------
  // Billing
  // -------------------------------------------------------------------------
  billing: {
    status: (signal?: AbortSignal) => get<BillingStatus>('/billing/status', signal),
    checkout: (plan: 'pro' | 'agency', signal?: AbortSignal) =>
      post<{ url: string }>('/billing/checkout', { plan }, signal),
    portal: (signal?: AbortSignal) =>
      post<{ url: string }>('/billing/portal', {}, signal),
  },

  // -------------------------------------------------------------------------
  // Team members
  // -------------------------------------------------------------------------
  members: {
    list: (projectId: string, signal?: AbortSignal) =>
      get<ProjectMember[]>(`/projects/${projectId}/members`, signal),
    invite: (projectId: string, email: string, role: string, signal?: AbortSignal) =>
      post<ProjectMember>(`/projects/${projectId}/members`, { email, role }, signal),
    updateRole: (projectId: string, uid: string, role: string) =>
      patch<ProjectMember>(`/projects/${projectId}/members/${uid}`, { role }),
    remove: (projectId: string, uid: string, signal?: AbortSignal) =>
      del(`/projects/${projectId}/members/${uid}`, signal),
  },

  // -------------------------------------------------------------------------
  // Health
  // -------------------------------------------------------------------------
  health: (signal?: AbortSignal) => get<{ status: string }>('/health', signal),

  // -------------------------------------------------------------------------
  // Intelligence - Phase 1
  // -------------------------------------------------------------------------
  intelligence: {
    get: (projectId: string, signal?: AbortSignal) =>
      get<{ snapshots: CompetitorSnapshot[] }>(`/projects/${projectId}/intelligence`, signal),

    refresh: (
      projectId: string,
      competitors: { name: string; website?: string; instagram?: string; facebook?: string; tiktok?: string; linkedin?: string; youtube?: string }[],
      onEvent: (event: IntelligenceStreamEvent) => void,
      onDone: () => void,
      signal?: AbortSignal,
    ) => streamPost(`/projects/${projectId}/intelligence/refresh`, { competitors }, onEvent, onDone, signal),

    addDiscovered: (
      projectId: string,
      competitor: import('@/types').DiscoveredCompetitor,
      onEvent: (event: IntelligenceStreamEvent) => void,
      onDone: () => void,
      signal?: AbortSignal,
    ) => streamPost(`/projects/${projectId}/intelligence/add-discovered`, { competitor }, onEvent, onDone, signal),

    strategy: (projectId: string, signal?: AbortSignal) =>
      get<CompetitiveStrategy>(`/projects/${projectId}/intelligence/strategy`, signal),

    report: (projectId: string, competitorName: string, signal?: AbortSignal) =>
      get<CompetitorReport>(`/projects/${projectId}/intelligence/competitors/${encodeURIComponent(competitorName)}/report`, signal),
  },

  // -------------------------------------------------------------------------
  // Competitor Profiles - 5-Dimension Classification
  // -------------------------------------------------------------------------
  competitorProfiles: {
    list: (projectId: string, signal?: AbortSignal) =>
      get<{ profiles: CompetitorProfile[] }>(`/projects/${projectId}/competitors/profiles`, signal),

    get: (projectId: string, profileId: string, signal?: AbortSignal) =>
      get<CompetitorProfile>(`/projects/${projectId}/competitors/profiles/${profileId}`, signal),

    delete: (projectId: string, profileId: string, signal?: AbortSignal) =>
      del(`/projects/${projectId}/competitors/profiles/${profileId}`, signal),

    classify: (
      projectId: string,
      name: string,
      website: string | undefined,
      onEvent: (event: ClassifyStreamEvent) => void,
      onDone: () => void,
      signal?: AbortSignal,
    ) => streamPost<ClassifyStreamEvent>(
      `/projects/${projectId}/competitors/profiles/classify`,
      { name, website },
      onEvent,
      onDone,
      signal,
    ),

    refresh: (
      projectId: string,
      profileId: string,
      onEvent: (event: ClassifyStreamEvent) => void,
      onDone: () => void,
      signal?: AbortSignal,
    ) => streamPost<ClassifyStreamEvent>(
      `/projects/${projectId}/competitors/profiles/${profileId}/refresh`,
      {},
      onEvent,
      onDone,
      signal,
    ),
  },

  // -------------------------------------------------------------------------
  // Brand Voice Scorer
  // -------------------------------------------------------------------------
  brandVoice: {
    score: (
      projectId: string,
      text: string,
      signal?: AbortSignal,
    ) =>
      post<BrandVoiceScore>(`/projects/${projectId}/brand-voice/score`, { text }, signal),
  },

  // -------------------------------------------------------------------------
  // Content Performance Predictor
  // -------------------------------------------------------------------------
  contentPredict: {
    predict: (
      projectId: string,
      content: string,
      platform: string,
      signal?: AbortSignal,
    ) =>
      post<ContentPrediction>(
        `/projects/${projectId}/content/predict`,
        { content, platform },
        signal,
      ),
  },

  // -------------------------------------------------------------------------
  // Brand Memory
  // -------------------------------------------------------------------------
  memory: {
    get: (projectId: string, signal?: AbortSignal) =>
      get<{ items: MemoryFeedbackItem[]; summary: string; count: number }>(
        `/projects/${projectId}/memory`,
        signal,
      ),

    feedback: (
      projectId: string,
      body: {
        type: 'edit' | 'approve' | 'reject' | 'instruction'
        original?: string
        edited?: string
        reason?: string
        instruction?: string
        platform?: string
      },
      signal?: AbortSignal,
    ) =>
      post<{ saved: boolean }>(`/projects/${projectId}/memory/feedback`, body, signal),
  },

  // -------------------------------------------------------------------------
  // Brand Drift Detector
  // -------------------------------------------------------------------------
  drift: {
    check: (projectId: string, ownContent: string[], signal?: AbortSignal) =>
      post<BrandDriftResult>(
        `/projects/${projectId}/drift/check`,
        { own_content: ownContent },
        signal,
      ),
  },

  // -------------------------------------------------------------------------
  // Content Library
  // -------------------------------------------------------------------------
  contentLibrary: {
    list: (
      projectId: string,
      filters?: { platform?: string; status?: string; type?: string; limit?: number },
      signal?: AbortSignal,
    ) => {
      const params = new URLSearchParams()
      if (filters?.platform) params.set('platform', filters.platform)
      if (filters?.status) params.set('status', filters.status)
      if (filters?.type) params.set('type', filters.type)
      if (filters?.limit) params.set('limit', String(filters.limit))
      const qs = params.toString()
      return get<{ items: ContentLibraryItem[] }>(
        `/projects/${projectId}/content-library${qs ? `?${qs}` : ''}`,
        signal,
      )
    },
    save: (
      projectId: string,
      item: {
        platform: string
        type: string
        content: string
        hashtags?: string[]
        metadata?: Record<string, unknown>
        status?: string
        tags?: string[]
      },
      signal?: AbortSignal,
    ) => post<ContentLibraryItem>(`/projects/${projectId}/content-library`, item, signal),

    update: (
      projectId: string,
      itemId: string,
      updates: { status?: string; content?: string; tags?: string[]; scheduledAt?: string },
      signal?: AbortSignal,
    ) => patch<ContentLibraryItem>(`/projects/${projectId}/content-library/${itemId}`, updates, signal),

    delete: (projectId: string, itemId: string, signal?: AbortSignal) =>
      del(`/projects/${projectId}/content-library/${itemId}`, signal),

    bulkSchedule: (
      projectId: string,
      itemIds: string[],
      startDate: string,
      signal?: AbortSignal,
    ) =>
      post<{ scheduled: number; errors: number }>(
        `/projects/${projectId}/content-library/bulk-schedule`,
        { item_ids: itemIds, start_date: startDate },
        signal,
      ),
  },

  // -------------------------------------------------------------------------
  // Content Operations
  // -------------------------------------------------------------------------
  contentOps: {
    recycle: (
      projectId: string,
      content: string,
      platform: string,
      count?: number,
      signal?: AbortSignal,
    ) =>
      post<{ variants: { content: string; hashtags: string[]; angle: string; hook: string }[] }>(
        `/projects/${projectId}/content/recycle`,
        { content, platform, count: count ?? 3 },
        signal,
      ),

    transform: (
      projectId: string,
      content: string,
      targetPlatforms: string[],
      signal?: AbortSignal,
    ) =>
      post<TransformResult>(
        `/projects/${projectId}/content/transform`,
        { content, target_platforms: targetPlatforms },
        signal,
      ),
  },

  // -------------------------------------------------------------------------
  // Bulk Content Generation (SSE)
  // -------------------------------------------------------------------------
  async streamBulkGenerate(
    projectId: string,
    body: {
      platforms: string[]
      count_per_platform?: number
      themes?: string[]
      period?: string
      goal?: string
    },
    callbacks: {
      onItem: (item: BulkGenerateEvent & { type: 'item' }) => void
      onProgress: (done: number, total: number) => void
      onDone: (total: number) => void
      onError: (err: string) => void
    },
    signal?: AbortSignal,
  ): Promise<void> {
    const user = auth.currentUser
    if (!user) { callbacks.onError('Not authenticated'); return }
    const token = await user.getIdToken()

    let res: Response
    try {
      res = await fetch(`${API}/projects/${projectId}/content/bulk-generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
        signal,
      })
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return
      callbacks.onError(String(err))
      return
    }

    if (!res.ok) { callbacks.onError(await extractErrorMessage(res)); return }

    const reader = res.body?.getReader()
    if (!reader) { callbacks.onError('No stream'); return }

    await readSSEStream<BulkGenerateEvent>(
      reader,
      (event) => {
        if (event.type === 'item') callbacks.onItem(event as BulkGenerateEvent & { type: 'item' })
        if (event.type === 'progress') callbacks.onProgress(event.done, event.total)
        if (event.type === 'done') callbacks.onDone(event.total)
        if (event.type === 'error') callbacks.onError(event.error)
      },
      () => {},
    )
  },

  // -------------------------------------------------------------------------
  // Calendar
  // -------------------------------------------------------------------------
  calendar: {
    get: (
      projectId: string,
      fromDate?: string,
      toDate?: string,
      signal?: AbortSignal,
    ) => {
      const params = new URLSearchParams()
      if (fromDate) params.set('from_date', fromDate)
      if (toDate) params.set('to_date', toDate)
      const qs = params.toString()
      return get<{ entries: CalendarEntry[] }>(
        `/projects/${projectId}/calendar${qs ? `?${qs}` : ''}`,
        signal,
      )
    },

    generate: (
      projectId: string,
      body: {
        platforms: string[]
        period?: string
        goals?: string
        posts_per_week?: number
      },
      signal?: AbortSignal,
    ) =>
      post<{ entries: CalendarEntry[]; count: number }>(
        `/projects/${projectId}/calendar/generate`,
        body,
        signal,
      ),

    createEntry: (
      projectId: string,
      entry: {
        date: string
        platform: string
        content: string
        title?: string
        time?: string
        hashtags?: string[]
        type?: string
        content_format?: string
        status?: string
      },
      signal?: AbortSignal,
    ) =>
      post<CalendarEntry>(`/projects/${projectId}/calendar/entries`, entry, signal),

    updateEntry: (
      projectId: string,
      entryId: string,
      updates: {
        content?: string
        title?: string | null
        date?: string
        time?: string
        status?: string
        hashtags?: string[]
        platform?: string
        type?: string
        content_format?: string
        media_url?: string | null
        media_type?: string | null
      },
      signal?: AbortSignal,
    ) =>
      patch<CalendarEntry>(`/projects/${projectId}/calendar/entries/${entryId}`, updates, signal),

    deleteEntry: (projectId: string, entryId: string, signal?: AbortSignal) =>
      del(`/projects/${projectId}/calendar/entries/${entryId}`, signal),
  },

  // -------------------------------------------------------------------------
  // Analytics & Performance (Phase 3)
  // -------------------------------------------------------------------------
  analytics: {
    get: (projectId: string, signal?: AbortSignal) =>
      get<ProjectAnalytics>(`/projects/${projectId}/analytics`, signal),
    logMetrics: (projectId: string, itemId: string, metrics: ContentMetrics) =>
      post<ContentMetrics>(`/projects/${projectId}/analytics/${itemId}/metrics`, metrics),
    getOverview: (projectId: string) =>
      get<AnalyticsOverview>(`/projects/${projectId}/analytics/overview`),
    getContent: (projectId: string) =>
      get<ContentPerformanceRow[]>(`/projects/${projectId}/analytics/content`),
    getTrends: (projectId: string) =>
      get<AnalyticsTrends>(`/projects/${projectId}/analytics/trends`),
    getActivity: (projectId: string) =>
      get<ActivityEvent[]>(`/projects/${projectId}/analytics/activity`),
    getAiSummary: (projectId: string) =>
      get<{ summary: string }>(`/projects/${projectId}/analytics/ai-summary`),
    compare: (projectId: string, period: '7d' | '30d' = '7d') =>
      get<{ period_days: number; library: { current: number; previous: number; pct_change: number | null }; calendar: { current: number; previous: number; pct_change: number | null } }>(`/projects/${projectId}/analytics/compare?period=${period}`),
  },

  performance: {
    record: (
      projectId: string,
      itemId: string,
      data: PerformanceRecord,
      signal?: AbortSignal,
    ) =>
      post<{ id: string }>(
        `/projects/${projectId}/content-library/${itemId}/performance`,
        data,
        signal,
      ),
  },

  // -------------------------------------------------------------------------
  // Publishing Queue (Phase 4)
  // -------------------------------------------------------------------------
  publishQueue: {
    get: (projectId: string, signal?: AbortSignal) =>
      get<{ days: PublishQueueDay[]; total: number }>(
        `/projects/${projectId}/publish-queue`,
        signal,
      ),
  },

  // -------------------------------------------------------------------------
  // Hashtag Research (Phase 4)
  // -------------------------------------------------------------------------
  hashtags: {
    suggest: (
      projectId: string,
      topic: string,
      platform: string,
      content?: string,
      signal?: AbortSignal,
    ) =>
      post<HashtagResult>(
        `/projects/${projectId}/hashtags/suggest`,
        { topic, platform, content },
        signal,
      ),
  },

  // -------------------------------------------------------------------------
  // AI Proactive Insights (Phase 4)
  // -------------------------------------------------------------------------
  insights: {
    get: (projectId: string, signal?: AbortSignal) =>
      get<{ insights: ProjectInsight[] }>(`/projects/${projectId}/insights`, signal),
  },

  // -------------------------------------------------------------------------
  // SEO Studio (Phase 5)
  // -------------------------------------------------------------------------
  seo: {
    metaTags: (
      projectId: string,
      pageTitle: string,
      pageDescription: string,
      pageType: string,
      signal?: AbortSignal,
    ) =>
      post<MetaTagsResult>(
        `/projects/${projectId}/seo/meta-tags`,
        { page_title: pageTitle, page_description: pageDescription, page_type: pageType },
        signal,
      ),

    websiteCopy: (
      projectId: string,
      pageType: string,
      context?: string,
      signal?: AbortSignal,
    ) =>
      post<{ sections: WebsiteCopySection[] }>(
        `/projects/${projectId}/seo/website-copy`,
        { page_type: pageType, context },
        signal,
      ),
  },

  // -------------------------------------------------------------------------
  // Email Studio (Phase 5)
  // -------------------------------------------------------------------------
  emails: {
    sequence: (
      projectId: string,
      sequenceType: string,
      goal: string,
      productOrService: string,
      signal?: AbortSignal,
    ) =>
      post<{ sequence: EmailItem[] }>(
        `/projects/${projectId}/emails/sequence`,
        { sequence_type: sequenceType, goal, product_or_service: productOrService },
        signal,
      ),

    single: (
      projectId: string,
      emailType: string,
      context: string,
      signal?: AbortSignal,
    ) =>
      post<EmailItem>(
        `/projects/${projectId}/emails/single`,
        { email_type: emailType, context },
        signal,
      ),
  },

  // -------------------------------------------------------------------------
  // Brand Style Guide (Phase 5)
  // -------------------------------------------------------------------------
  styleGuide: {
    generate: (projectId: string, signal?: AbortSignal) =>
      post<StyleGuide>(`/projects/${projectId}/brand/style-guide`, {}, signal),
  },

  // -------------------------------------------------------------------------
  // Content Templates (Phase 6)
  // -------------------------------------------------------------------------
  templates: {
    list: (projectId: string, category?: string, signal?: AbortSignal) =>
      get<{ templates: ContentTemplate[] }>(
        `/projects/${projectId}/templates${category ? `?category=${category}` : ''}`,
        signal,
      ),

    create: (
      projectId: string,
      data: Omit<ContentTemplate, 'id' | 'createdAt' | 'updatedAt'>,
      signal?: AbortSignal,
    ) =>
      post<ContentTemplate>(`/projects/${projectId}/templates`, data, signal),

    update: (
      projectId: string,
      templateId: string,
      data: Partial<Pick<ContentTemplate, 'name' | 'description' | 'body' | 'placeholders' | 'hashtags' | 'tags'>>,
      signal?: AbortSignal,
    ) =>
      patch<ContentTemplate>(`/projects/${projectId}/templates/${templateId}`, data, signal),

    delete: (projectId: string, templateId: string, signal?: AbortSignal) =>
      del(`/projects/${projectId}/templates/${templateId}`, signal),
  },

  // -------------------------------------------------------------------------
  // Approval Workflow (Phase 6)
  // -------------------------------------------------------------------------
  approval: {
    submitForReview: (projectId: string, itemId: string, note?: string, signal?: AbortSignal) =>
      post<ContentLibraryItem>(
        `/projects/${projectId}/content-library/${itemId}/submit-review`,
        { note },
        signal,
      ),

    decide: (
      projectId: string,
      itemId: string,
      decision: ReviewDecision,
      note?: string,
      signal?: AbortSignal,
    ) =>
      post<ContentLibraryItem>(
        `/projects/${projectId}/content-library/${itemId}/review`,
        { decision, note },
        signal,
      ),

    queue: (projectId: string, signal?: AbortSignal) =>
      get<{ items: ContentLibraryItem[]; count: number }>(
        `/projects/${projectId}/review-queue`,
        signal,
      ),

    history: (projectId: string, itemId: string, signal?: AbortSignal) =>
      get<{ history: ReviewHistoryEntry[] }>(
        `/projects/${projectId}/content-library/${itemId}/review-history`,
        signal,
      ),
  },

  // -------------------------------------------------------------------------
  // Blog Post SSE stream (Phase 5)
  // -------------------------------------------------------------------------
  async streamBlogPost(
    projectId: string,
    body: {
      topic: string
      keywords?: string[]
      tone?: string
      word_count?: number
    },
    onMeta: (meta: BlogPostMeta) => void,
    onChunk: (text: string) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    const headers = await authHeaders()
    const res = await fetch(`${API}/projects/${projectId}/seo/blog-post`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    })
    if (!res.ok) throw new Error(`Blog post stream failed: ${res.status}`)
    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      const lines = buf.split('\n')
      buf = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.startsWith('data:')) continue
        const raw = line.slice(5).trim()
        if (!raw || raw === '[DONE]') continue
        try {
          const evt = JSON.parse(raw)
          if (evt.type === 'meta') onMeta(evt as BlogPostMeta)
          else if (evt.type === 'chunk') onChunk(evt.text)
        } catch { /* skip malformed */ }
      }
    }
  },

  // Reports - Phase 10
  reports: {
    getDigest: (projectId: string) =>
      get<WeeklyDigest>(`/projects/${projectId}/reports/digest`),
    scoreContent: (projectId: string, itemIds: string[]) =>
      post<Record<string, ContentScoreResult>>(`/projects/${projectId}/reports/score-content`, { item_ids: itemIds }),
  },

  // ---------------------------------------------------------------------------
  // Brand Monitoring (Exa + Tavily)
  // ---------------------------------------------------------------------------
  monitoring: {
    run: (
      projectId: string,
      onEvent: (event: { type: string; message?: string; alert?: MonitorAlert; new_alerts?: number; targets?: string[] }) => void,
      onDone: () => void,
      signal?: AbortSignal,
    ) => streamPost(
      `/projects/${projectId}/monitor/run`,
      {},
      onEvent,
      onDone,
      signal,
    ),
    alerts: (projectId: string, params?: { unread_only?: boolean; days?: number; limit?: number }) => {
      const qs = new URLSearchParams()
      if (params?.unread_only) qs.set('unread_only', 'true')
      if (params?.days !== undefined) qs.set('days', String(params.days))
      if (params?.limit !== undefined) qs.set('limit', String(params.limit))
      const q = qs.toString()
      return get<{ alerts: MonitorAlert[] }>(`/projects/${projectId}/monitor/alerts${q ? `?${q}` : ''}`)
    },
    markRead: (projectId: string, alertId: string) =>
      post<{ updated: boolean }>(`/projects/${projectId}/monitor/alerts/${alertId}/read`, {}),
  },

  // ---------------------------------------------------------------------------
  // Research Reports (Exa async deep-research)
  // ---------------------------------------------------------------------------
  research: {
    start: (projectId: string, topic: string, report_type?: string) =>
      post<{ report_id: string; status: string; task_id?: string }>(
        `/projects/${projectId}/reports/research/start`,
        { topic, report_type },
      ),
    status: (projectId: string, reportId: string) =>
      get<ResearchReport>(`/projects/${projectId}/reports/research/${reportId}/status`),
    list: (projectId: string) =>
      get<{ reports: ResearchReport[] }>(`/projects/${projectId}/reports/research`),
    get: (projectId: string, reportId: string) =>
      get<ResearchReport>(`/projects/${projectId}/reports/research/${reportId}`),
    delete: (projectId: string, reportId: string) =>
      del(`/projects/${projectId}/reports/research/${reportId}`),
  },

  // ---------------------------------------------------------------------------
  // SEO & Competitor Discovery (Exa + Tavily)
  // ---------------------------------------------------------------------------
  seoIntel: {
    contentGaps: (projectId: string, competitors: string[], topic?: string) =>
      post<{ gaps: ContentGap[]; total_gaps: number }>(
        `/projects/${projectId}/seo/content-gaps`,
        { competitors, topic },
      ),
    contentTopics: (projectId: string, gaps: ContentGap[], num_topics?: number) =>
      post<{ topics: ContentTopic[]; total: number }>(
        `/projects/${projectId}/seo/content-topics`,
        { gaps, num_topics },
      ),
    discoverCompetitors: (
      projectId: string,
      onEvent: (event: IntelligenceStreamEvent) => void,
      onDone: () => void,
      signal?: AbortSignal,
    ) => streamGet(`/projects/${projectId}/intelligence/discover-competitors`, onEvent, onDone, signal),
    discoverInfluencers: (
      projectId: string,
      topic: string,
      platform: string,
      audience_size?: string,
      location?: string,
    ) =>
      post<{ influencers: DiscoveredInfluencer[]; total: number; topic: string; platform: string }>(
        `/projects/${projectId}/influencers/discover`,
        { topic, platform, audience_size: audience_size ?? 'micro', location },
      ),
  },

  // -------------------------------------------------------------------------
  // Credits
  // -------------------------------------------------------------------------
  credits: {
    getBalance: () => get<CreditsStatus>('/credits/balance'),
    getHistory: (limit = 20) => get<{ transactions: CreditTransaction[] }>(`/credits/history?limit=${limit}`),
  },

  // -------------------------------------------------------------------------
  // Deep Search
  // -------------------------------------------------------------------------
  deepSearch: {
    run: async (
      projectId: string,
      query: string,
      scrapeTopN: number = 3,
      onEvent: (event: Record<string, unknown>) => void,
      onDone: () => void,
      onError: (msg: string) => void,
    ) => {
      const headers = await authHeaders()
      const res = await fetch(`${API}/projects/${projectId}/deep-search`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ query, scrape_top_n: scrapeTopN }),
      })
      if (!res.ok) throw new Error(`Deep search failed: ${res.status}`)
      const reader = res.body?.getReader()
      if (!reader) { onError('No stream'); return }
      const decoder = new TextDecoder()
      let buf = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('data:')) continue
          const payload = line.slice(5).trim()
          if (payload === '[DONE]') { onDone(); return }
          try { onEvent(JSON.parse(payload)) } catch { /* skip */ }
        }
      }
      onDone()
    },
    history: (projectId: string) =>
      get<{ results: DeepSearchHistory[] }>(`/projects/${projectId}/deep-search/history`),
  },

  // -------------------------------------------------------------------------
  // Funnel Strategy Engine
  // -------------------------------------------------------------------------
  strategy: {
    /** Create a new strategy session; returns session_id + first question. */
    start: (projectId: string, userGoal: string) =>
      post<{ session_id: string; status: string; next_question: import('@/types').StrategyQuestion; message: string }>(
        `/projects/${projectId}/strategy/start`,
        { user_goal: userGoal },
      ),

    /** Submit an intake answer; returns next question or research_ready status. */
    answer: (
      projectId: string,
      sessionId: string,
      opts: { question_index: number; answer: string; funnel_type?: string },
    ) =>
      post<{
        session_id: string
        status: string
        next_question: import('@/types').StrategyQuestion | null
        question_number?: number
        total_questions?: number
        message?: string
      }>(`/projects/${projectId}/strategy/${sessionId}/answer`, opts),

    /** Stream research progress events (SSE). */
    streamResearch: async (
      projectId: string,
      sessionId: string,
      onEvent: (ev: import('@/types').StrategyResearchEvent) => void,
      onDone: () => void,
      onError: (msg: string) => void,
      signal?: AbortSignal,
    ) => {
      const headers = await authHeaders()
      const res = await fetch(`${API}/projects/${projectId}/strategy/${sessionId}/research`, {
        method: 'POST',
        headers,
        signal,
      })
      if (!res.ok) { onError(`Research failed: ${res.status}`); return }
      const reader = res.body?.getReader()
      if (!reader) { onError('No stream'); return }
      const decoder = new TextDecoder()
      let buf = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('data:')) continue
          const payload = line.slice(5).trim()
          if (payload === '[DONE]') { onDone(); return }
          try { onEvent(JSON.parse(payload) as import('@/types').StrategyResearchEvent) } catch { /* skip */ }
        }
      }
      onDone()
    },

    /** Stream strategy generation (SSE token deltas). */
    streamGenerate: async (
      projectId: string,
      sessionId: string,
      onDelta: (text: string) => void,
      onSaved: (strategyId: string, title: string, version: number) => void,
      onDone: () => void,
      onError: (msg: string) => void,
      signal?: AbortSignal,
    ) => {
      const headers = await authHeaders()
      const res = await fetch(`${API}/projects/${projectId}/strategy/${sessionId}/generate`, {
        method: 'POST',
        headers,
        signal,
      })
      if (!res.ok) { onError(`Generation failed: ${res.status}`); return }
      const reader = res.body?.getReader()
      if (!reader) { onError('No stream'); return }
      const decoder = new TextDecoder()
      let buf = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('data:')) continue
          const payload = line.slice(5).trim()
          if (payload === '[DONE]') { onDone(); return }
          try {
            const ev = JSON.parse(payload) as import('@/types').StrategyGenerateEvent
            if (ev.type === 'delta') onDelta(ev.content)
            else if (ev.type === 'strategy_saved') onSaved(ev.strategy_id, ev.title, ev.version)
            else if (ev.type === 'error') { onError(ev.message); return }
          } catch { /* skip */ }
        }
      }
      onDone()
    },

    /** List saved strategies for a project. */
    list: (projectId: string) =>
      get<{ strategies: import('@/types').MarketingStrategy[] }>(`/projects/${projectId}/strategy/list`),

    /** Stream a follow-up / refinement response (SSE). */
    streamRefine: async (
      projectId: string,
      strategyId: string,
      followUpMessage: string,
      onDelta: (text: string) => void,
      onDone: () => void,
      onError: (msg: string) => void,
      signal?: AbortSignal,
    ) => {
      const headers = await authHeaders()
      const res = await fetch(`${API}/projects/${projectId}/strategy/${strategyId}/refine`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ follow_up_message: followUpMessage }),
        signal,
      })
      if (!res.ok) { onError(`Refine failed: ${res.status}`); return }
      const reader = res.body?.getReader()
      if (!reader) { onError('No stream'); return }
      const decoder = new TextDecoder()
      let buf = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('data:')) continue
          const payload = line.slice(5).trim()
          if (payload === '[DONE]') { onDone(); return }
          try {
            const ev = JSON.parse(payload)
            if (ev.type === 'delta') onDelta(ev.content)
            else if (ev.type === 'error') { onError(ev.message); return }
          } catch { /* skip */ }
        }
      }
      onDone()
    },
  },

  // -------------------------------------------------------------------------
  // Carousel Studio
  // -------------------------------------------------------------------------
  carousel: {
    /** Stream brand scraping progress. Calls onStep, onDone, onError. */
    scrapeBrand: async (
      projectId: string,
      websiteUrl: string,
      instagramUrl: string | null,
      onStep: (message: string, done: boolean) => void,
      onDone: (brandProfile: import('@/types').BrandProfile) => void,
      onError: (msg: string) => void,
      signal?: AbortSignal,
    ) => {
      const headers = await authHeaders()
      const res = await fetch(`${API}/projects/${projectId}/carousel/scrape-brand`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ project_id: projectId, website_url: websiteUrl, instagram_url: instagramUrl }),
        signal,
      })
      if (!res.ok) { onError(`Scrape failed: ${res.status}`); return }
      const reader = res.body?.getReader()
      if (!reader) { onError('No stream'); return }
      const decoder = new TextDecoder()
      let buf = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('data:')) continue
          const payload = line.slice(5).trim()
          try {
            const ev = JSON.parse(payload) as import('@/types').CarouselScrapeEvent
            if (ev.type === 'step') onStep(ev.message, ev.done)
            else if (ev.type === 'done') { onDone(ev.brand_profile); return }
            else if (ev.type === 'error') { onError(ev.message); return }
          } catch { /* skip */ }
        }
      }
    },

    /** Create a new carousel session. */
    createSession: (projectId: string) =>
      post<{ session_id: string; status: string }>(
        `/projects/${projectId}/carousel/session`,
        { project_id: projectId },
      ),

    /** Submit one intake answer, get back next question or ready signal. */
    submitIntake: (
      projectId: string,
      sessionId: string,
      question: number | string,
      answer: string,
    ) =>
      post<{
        session_id: string
        status: string
        next_question: import('@/types').CarouselIntakeQuestion | null
        question_number?: number
        total_questions?: number
      }>(`/projects/${projectId}/carousel/intake`, {
        session_id: sessionId,
        question,
        answer,
      }),

    /** Stream carousel generation. */
    generate: async (
      projectId: string,
      sessionId: string,
      onStatus: (message: string) => void,
      onDone: (carouselId: string, htmlContent: string, slideCount: number, title: string) => void,
      onError: (msg: string) => void,
      signal?: AbortSignal,
    ) => {
      const headers = await authHeaders()
      const res = await fetch(`${API}/projects/${projectId}/carousel/generate`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ session_id: sessionId }),
        signal,
      })
      if (!res.ok) { onError(`Generation failed: ${res.status}`); return }
      const reader = res.body?.getReader()
      if (!reader) { onError('No stream'); return }
      const decoder = new TextDecoder()
      let buf = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('data:')) continue
          const payload = line.slice(5).trim()
          try {
            const ev = JSON.parse(payload) as import('@/types').CarouselGenerateEvent
            if (ev.type === 'status') onStatus(ev.message)
            else if (ev.type === 'done') { onDone(ev.carousel_id, ev.html_content, ev.slide_count, ev.title); return }
            else if (ev.type === 'error') { onError(ev.message); return }
          } catch { /* skip */ }
        }
      }
    },

    /** Apply a natural-language edit to a single slide. */
    editSlide: (
      projectId: string,
      carouselId: string,
      slideIndex: number,
      instruction: string,
    ) =>
      post<{ updated_html: string; updated_slide: import('@/types').CarouselSlide }>(
        `/projects/${projectId}/carousel/edit-slide`,
        { carousel_id: carouselId, slide_index: slideIndex, instruction },
      ),

    /** Stream PNG export progress. */
    export: async (
      projectId: string,
      carouselId: string,
      format: string,
      onProgress: (slide: number, total: number) => void,
      onDone: (zipUrl: string | null, slideUrls: string[], slideCount: number) => void,
      onError: (msg: string) => void,
      signal?: AbortSignal,
    ) => {
      const headers = await authHeaders()
      const res = await fetch(`${API}/projects/${projectId}/carousel/export`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ carousel_id: carouselId, format }),
        signal,
      })
      if (!res.ok) { onError(`Export failed: ${res.status}`); return }
      const reader = res.body?.getReader()
      if (!reader) { onError('No stream'); return }
      const decoder = new TextDecoder()
      let buf = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('data:')) continue
          const payload = line.slice(5).trim()
          try {
            const ev = JSON.parse(payload) as import('@/types').CarouselExportEvent
            if (ev.type === 'progress') onProgress(ev.slide, ev.total)
            else if (ev.type === 'done') { onDone(ev.zip_url, ev.slide_urls, ev.slide_count); return }
            else if (ev.type === 'error') { onError(ev.message); return }
          } catch { /* skip */ }
        }
      }
    },

    /** List all carousels for a project. */
    list: (projectId: string) =>
      get<{ carousels: import('@/types').Carousel[] }>(`/projects/${projectId}/carousel/list`),

    /** Fetch a single carousel with html_content. */
    get: (projectId: string, carouselId: string) =>
      get<import('@/types').Carousel>(`/projects/${projectId}/carousel/${carouselId}`),
  },

  threads: {
    /** Check whether the current user has connected their Threads account. */
    status: () =>
      get<{ connected: boolean; threads_user_id?: string; expires_at?: string }>('/auth/threads/status'),

    /** Get the OAuth URL to redirect the user to Threads for authorisation. */
    connect: () =>
      get<{ auth_url: string }>('/auth/threads/connect'),

    /** Remove the stored Threads token (disconnect). */
    disconnect: () =>
      post<{ ok: boolean }>('/auth/threads/disconnect', {}),

    /** Fetch the connected user's Threads profile for a project. */
    profile: (projectId: string) =>
      get<{ id: string; username: string; name: string; followers_count: number }>(`/projects/${projectId}/threads/profile`),

    /** Publish a post to Threads. */
    publish: (
      projectId: string,
      payload: { text: string; image_url?: string; carousel_items?: { media_type: string; image_url: string }[] },
    ) => post<{ ok: boolean; thread_id: string }>(`/projects/${projectId}/publish/threads`, payload),
  },

  deepResearch: {
    /** Auto-discover competitors via Tavily + Exa + Claude synthesis. */
    discover: (projectId: string) =>
      post<{ competitors: DiscoveredCompetitor[] }>(`/projects/${projectId}/competitors/discover`, {}),

    /**
     * Stream 7-layer deep research for up to 5 competitors.
     * Yields DeepResearchEvent objects via SSE.
     */
    async stream(
      projectId: string,
      competitors: CompetitorInput[],
      onEvent: (event: DeepResearchEvent) => void,
      onDone: () => void,
      signal?: AbortSignal,
    ): Promise<void> {
      const headers = await authHeaders()
      const res = await fetch(`${API}/projects/${projectId}/competitors/research`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ competitors }),
        signal,
      })
      if (!res.ok) throw new Error(await extractErrorMessage(res))
      const reader = res.body!.getReader()
      return readSSEStream<DeepResearchEvent>(reader, onEvent, onDone)
    },

    /** List all deep research reports for a project (lightweight). */
    listReports: (projectId: string) =>
      get<{ reports: DeepResearchReportSummary[] }>(`/projects/${projectId}/competitors/reports`),

    /** Fetch a single full research report. */
    getReport: (projectId: string, reportId: string) =>
      get<DeepResearchReport>(`/projects/${projectId}/competitors/reports/${reportId}`),

    /** Set up weekly competitor monitoring. */
    createMonitor: (
      projectId: string,
      payload: { competitor: CompetitorInput; frequency?: 'weekly' | 'monthly' },
    ) => post<CompetitorMonitor>(`/projects/${projectId}/competitors/monitor`, payload),

    /** List all active competitor monitors. */
    listMonitors: (projectId: string) =>
      get<{ monitors: CompetitorMonitor[] }>(`/projects/${projectId}/competitors/monitors`),

    /** Deactivate a monitor. */
    deleteMonitor: (projectId: string, monitorId: string) =>
      del(`/projects/${projectId}/competitors/monitors/${monitorId}`),

    /** Manually trigger a monitor diff run. */
    runMonitor: (projectId: string, monitorId: string) =>
      post<{ changes: MonitorChangeAlert[]; has_significant_changes: boolean }>(
        `/projects/${projectId}/competitors/monitors/${monitorId}/run`,
        {},
      ),

    /** Get alerts for a monitor. */
    listAlerts: (projectId: string, monitorId: string) =>
      get<{ alerts: MonitorChangeAlert[] }>(`/projects/${projectId}/competitors/monitors/${monitorId}/alerts`),
  },

  // -------------------------------------------------------------------------
  // Personal Branding Module
  // -------------------------------------------------------------------------
  persona: {
    /** Create the initial Personal Core (called once after personal brand project creation). */
    initCore: (projectId: string, body: { fullName: string; linkedinUrl?: string }) =>
      post<PersonalCore>(`/projects/${projectId}/persona/core/init`, body),

    /** Get the Personal Core for a personal brand project. */
    getCore: (projectId: string) =>
      get<PersonalCore>(`/projects/${projectId}/persona/core`),

    /** Update Personal Core fields. */
    updateCore: (projectId: string, updates: Partial<PersonalCore>) =>
      patch<PersonalCore>(`/projects/${projectId}/persona/core`, updates),

    /** Get all interview questions grouped by module. */
    getQuestions: (projectId: string) =>
      get<{ modules: Record<string, unknown> }>(`/projects/${projectId}/persona/interview/questions`),

    /** Get the next unanswered question and current progress. */
    getNextQuestion: (projectId: string) =>
      get<InterviewNextResponse>(`/projects/${projectId}/persona/interview/next`),

    /** Save a single interview answer. */
    saveAnswer: (projectId: string, questionKey: string, answer: string) =>
      post<InterviewNextResponse>(`/projects/${projectId}/persona/interview/answer`, {
        module: questionKey.split('_')[0],
        questionKey,
        answer,
      }),

    /** Extract Personal Core from interview answers (SSE stream). */
    streamExtract: (
      projectId: string,
      callbacks: {
        onStep?: (label: string, status: 'running' | 'done' | 'error') => void
        onProgress?: (pct: number) => void
        onDone?: (personalCore: PersonalCore) => void
        onError?: (message: string) => void
      },
      signal?: AbortSignal,
    ) =>
      streamPost<PersonalCoreExtractionEvent>(
        `/projects/${projectId}/persona/interview/extract`,
        {},
        (event) => {
          if (event.type === 'step') callbacks.onStep?.(event.label, event.status)
          else if (event.type === 'progress') callbacks.onProgress?.(event.pct)
          else if (event.type === 'done') callbacks.onDone?.(event.personalCore)
          else if (event.type === 'error') callbacks.onError?.(event.message)
        },
        () => {},
        signal,
      ),

    /** Get the voice profile for a personal brand project. */
    getVoice: (projectId: string) =>
      get<PersonalVoiceProfile>(`/projects/${projectId}/persona/voice`),

    /** Generate the full personal platform strategy (SSE). */
    streamStrategy: (
      projectId: string,
      callbacks: {
        onStep?: (label: string) => void
        onDone?: (strategy: Record<string, unknown>) => void
        onError?: (msg: string) => void
      },
      signal?: AbortSignal,
    ) =>
      streamPost<{ type: string; label?: string; strategy?: Record<string, unknown>; message?: string }>(
        `/projects/${projectId}/persona/strategy/generate`,
        {},
        (event) => {
          if (event.type === 'step' && event.label) callbacks.onStep?.(event.label)
          else if (event.type === 'done' && event.strategy) callbacks.onDone?.(event.strategy)
          else if (event.type === 'error' && event.message) callbacks.onError?.(event.message)
        },
        () => {},
        signal,
      ),

    /** Get saved personal strategy. */
    getStrategy: (projectId: string) =>
      get<Record<string, unknown>>(`/projects/${projectId}/persona/strategy`),

    /** Run niche competitor research (SSE). */
    streamNicheResearch: (
      projectId: string,
      callbacks: {
        onStep?: (label: string) => void
        onDone?: (result: Record<string, unknown>) => void
        onError?: (msg: string) => void
      },
      signal?: AbortSignal,
    ) =>
      streamPost<{ type: string; label?: string; result?: Record<string, unknown>; message?: string }>(
        `/projects/${projectId}/persona/strategy/niche`,
        {},
        (event) => {
          if (event.type === 'step' && event.label) callbacks.onStep?.(event.label)
          else if (event.type === 'done' && event.result) callbacks.onDone?.(event.result)
          else if (event.type === 'error' && event.message) callbacks.onError?.(event.message)
        },
        () => {},
        signal,
      ),

    /** Get personal brand analytics snapshots. */
    getAnalytics: (projectId: string) =>
      get<Record<string, unknown>[]>(`/projects/${projectId}/persona/analytics`),

    /** Get or generate the weekly brief. */
    getWeeklyBrief: (projectId: string) =>
      get<Record<string, unknown>>(`/projects/${projectId}/persona/analytics/brief`),

    /** Manually trigger an analytics snapshot for all connected platforms. */
    triggerSnapshot: (projectId: string) =>
      post<Record<string, unknown>>(`/projects/${projectId}/persona/analytics/snapshot`, {}),

    /** Force-regenerate the weekly brief. */
    regenerateBrief: (projectId: string) =>
      post<Record<string, unknown>>(`/projects/${projectId}/persona/analytics/brief/regenerate`, {}),

    /** Check reputation (Google + social mentions). */
    checkReputation: (projectId: string) =>
      post<Record<string, unknown>>(`/projects/${projectId}/persona/reputation/check`, {}),

    /** Get last reputation snapshot. */
    getReputation: (projectId: string) =>
      get<Record<string, unknown>>(`/projects/${projectId}/persona/reputation`),

    /** Get post-level analytics from Ayrshare for a specific post. */
    getPostAnalytics: (projectId: string, postId: string) =>
      get<Record<string, unknown>>(`/projects/${projectId}/persona/publishing/analytics/${postId}`),

    // -----------------------------------------------------------------------
    // Content Engine
    // -----------------------------------------------------------------------

    /** Generate a quick on-brand post for any platform (SSE). */
    streamGeneratePost: (
      projectId: string,
      body: { platform: ContentPlatform; topic: string },
      callbacks: {
        onStep?: (label: string, status: 'running' | 'done' | 'error') => void
        onProgress?: (pct: number) => void
        onDone?: (result: ContentEngineEvent & { type: 'done' }) => void
        onError?: (message: string) => void
      },
      signal?: AbortSignal,
    ) =>
      streamPost<ContentEngineEvent>(
        `/projects/${projectId}/persona/content/generate`,
        body,
        (event) => {
          if (event.type === 'step') callbacks.onStep?.(event.label, event.status)
          else if (event.type === 'progress') callbacks.onProgress?.(event.pct)
          else if (event.type === 'done') callbacks.onDone?.(event as ContentEngineEvent & { type: 'done' })
          else if (event.type === 'error') callbacks.onError?.(event.message)
        },
        () => {},
        signal,
      ),

    /** Convert a story/experience into a platform-native post (SSE). */
    streamStoryToPost: (
      projectId: string,
      body: { story: string; platform: ContentPlatform },
      callbacks: {
        onStep?: (label: string, status: 'running' | 'done' | 'error') => void
        onProgress?: (pct: number) => void
        onDone?: (result: ContentEngineEvent & { type: 'done' }) => void
        onError?: (message: string) => void
      },
      signal?: AbortSignal,
    ) =>
      streamPost<ContentEngineEvent>(
        `/projects/${projectId}/persona/content/story`,
        body,
        (event) => {
          if (event.type === 'step') callbacks.onStep?.(event.label, event.status)
          else if (event.type === 'progress') callbacks.onProgress?.(event.pct)
          else if (event.type === 'done') callbacks.onDone?.(event as ContentEngineEvent & { type: 'done' })
          else if (event.type === 'error') callbacks.onError?.(event.message)
        },
        () => {},
        signal,
      ),

    /** Opinion extractor - phase 1 returns questions, phase 2 returns the post (SSE). */
    streamOpinion: (
      projectId: string,
      body: { take: string; platform: ContentPlatform; answers?: string[] },
      callbacks: {
        onStep?: (label: string, status: 'running' | 'done' | 'error') => void
        onProgress?: (pct: number) => void
        onDone?: (result: ContentEngineEvent & { type: 'done' }) => void
        onError?: (message: string) => void
      },
      signal?: AbortSignal,
    ) =>
      streamPost<ContentEngineEvent>(
        `/projects/${projectId}/persona/content/opinion`,
        body,
        (event) => {
          if (event.type === 'step') callbacks.onStep?.(event.label, event.status)
          else if (event.type === 'progress') callbacks.onProgress?.(event.pct)
          else if (event.type === 'done') callbacks.onDone?.(event as ContentEngineEvent & { type: 'done' })
          else if (event.type === 'error') callbacks.onError?.(event.message)
        },
        () => {},
        signal,
      ),

    /** Generate per-platform bios and headlines (SSE). */
    streamBioWriter: (
      projectId: string,
      callbacks: {
        onStep?: (label: string, status: 'running' | 'done' | 'error') => void
        onProgress?: (pct: number) => void
        onDone?: (result: ContentEngineEvent & { type: 'done' }) => void
        onError?: (message: string) => void
      },
      signal?: AbortSignal,
    ) =>
      streamPost<ContentEngineEvent>(
        `/projects/${projectId}/persona/content/bio`,
        {},
        (event) => {
          if (event.type === 'step') callbacks.onStep?.(event.label, event.status)
          else if (event.type === 'progress') callbacks.onProgress?.(event.pct)
          else if (event.type === 'done') callbacks.onDone?.(event as ContentEngineEvent & { type: 'done' })
          else if (event.type === 'error') callbacks.onError?.(event.message)
        },
        () => {},
        signal,
      ),

    /** Reformat one piece of content for multiple platforms simultaneously (SSE). */
    streamReformat: (
      projectId: string,
      body: { content: string; sourcePlatform: ContentPlatform; targetPlatforms: ContentPlatform[] },
      callbacks: {
        onStep?: (label: string, status: 'running' | 'done' | 'error') => void
        onProgress?: (pct: number) => void
        onDone?: (result: ContentEngineEvent & { type: 'done' }) => void
        onError?: (message: string) => void
      },
      signal?: AbortSignal,
    ) =>
      streamPost<ContentEngineEvent>(
        `/projects/${projectId}/persona/content/reformat`,
        body,
        (event) => {
          if (event.type === 'step') callbacks.onStep?.(event.label, event.status)
          else if (event.type === 'progress') callbacks.onProgress?.(event.pct)
          else if (event.type === 'done') callbacks.onDone?.(event as ContentEngineEvent & { type: 'done' })
          else if (event.type === 'error') callbacks.onError?.(event.message)
        },
        () => {},
        signal,
      ),

    /** Mark a generated output as approved - saves to voice profile for calibration. */
    approveOutput: (
      projectId: string,
      body: { content: string; platform: ContentPlatform; editedByUser?: boolean },
    ) =>
      post<{ saved: boolean; approvedAt: string }>(
        `/projects/${projectId}/persona/content/approve`,
        { editedByUser: false, ...body },
      ),

    /** Write a full thought leadership article (SSE). */
    streamArticle: (
      projectId: string,
      body: { topic: string; platform?: string; outline?: string },
      callbacks: {
        onStep?: (label: string, status: 'running' | 'done' | 'error') => void
        onProgress?: (pct: number) => void
        onDone?: (result: ContentEngineEvent & { type: 'done' }) => void
        onError?: (message: string) => void
      },
      signal?: AbortSignal,
    ) =>
      streamPost<ContentEngineEvent>(
        `/projects/${projectId}/persona/content/article`,
        body,
        (event) => {
          if (event.type === 'step') callbacks.onStep?.(event.label, event.status)
          else if (event.type === 'progress') callbacks.onProgress?.(event.pct)
          else if (event.type === 'done') callbacks.onDone?.(event as ContentEngineEvent & { type: 'done' })
          else if (event.type === 'error') callbacks.onError?.(event.message)
        },
        () => {},
        signal,
      ),

    /** Add new writing samples and re-calibrate voice profile (SSE). */
    streamAddSamples: (
      projectId: string,
      samples: string[],
      callbacks: {
        onStep?: (label: string, status: 'running' | 'done' | 'error') => void
        onProgress?: (pct: number) => void
        onDone?: (voiceProfile: VoiceCalibrationEvent & { type: 'done' }) => void
        onError?: (message: string) => void
      },
      signal?: AbortSignal,
    ) =>
      streamPost<VoiceCalibrationEvent>(
        `/projects/${projectId}/persona/voice/samples`,
        { samples },
        (event) => {
          if (event.type === 'step') callbacks.onStep?.(event.label, event.status)
          else if (event.type === 'progress') callbacks.onProgress?.(event.pct)
          else if (event.type === 'done') callbacks.onDone?.(event as VoiceCalibrationEvent & { type: 'done' })
          else if (event.type === 'error') callbacks.onError?.(event.message)
        },
        () => {},
        signal,
      ),

    /** Re-calibrate voice profile from accumulated approved outputs (SSE). */
    streamCalibrate: (
      projectId: string,
      callbacks: {
        onStep?: (label: string, status: 'running' | 'done' | 'error') => void
        onProgress?: (pct: number) => void
        onDone?: (event: VoiceCalibrationEvent & { type: 'done' }) => void
        onError?: (message: string) => void
      },
      signal?: AbortSignal,
    ) =>
      streamPost<VoiceCalibrationEvent>(
        `/projects/${projectId}/persona/voice/calibrate`,
        {},
        (event) => {
          if (event.type === 'step') callbacks.onStep?.(event.label, event.status)
          else if (event.type === 'progress') callbacks.onProgress?.(event.pct)
          else if (event.type === 'done') callbacks.onDone?.(event as VoiceCalibrationEvent & { type: 'done' })
          else if (event.type === 'error') callbacks.onError?.(event.message)
        },
        () => {},
        signal,
      ),

    // -------------------------------------------------------------------------
    // Publishing (Ayrshare)
    // -------------------------------------------------------------------------

    getPublishingProfile: (projectId: string): Promise<{ profile: PublishingProfile; connectedPlatforms: ConnectedPlatform[] }> =>
      get(`/projects/${projectId}/persona/publishing/profile`),

    getConnectUrl: (projectId: string, platform: string): Promise<{ url: string }> =>
      get(`/projects/${projectId}/persona/publishing/connect/${platform}`),

    publishNow: (
      projectId: string,
      postText: string,
      platforms: string[],
      mediaUrls?: string[],
    ): Promise<AyrsharePostResult> =>
      post(`/projects/${projectId}/persona/publishing/publish`, { post: postText, platforms, mediaUrls }),

    schedulePost: (
      projectId: string,
      postText: string,
      platforms: string[],
      scheduledDate: string,
      mediaUrls?: string[],
    ): Promise<AyrsharePostResult> =>
      post(`/projects/${projectId}/persona/publishing/schedule`, { post: postText, platforms, scheduledDate, mediaUrls }),

    listScheduled: (projectId: string): Promise<{ posts: PublishedPost[] }> =>
      get(`/projects/${projectId}/persona/publishing/scheduled`),

    cancelScheduled: async (projectId: string, postId: string): Promise<unknown> => {
      const res = await fetch(`${API}/projects/${projectId}/persona/publishing/scheduled`, {
        method: 'DELETE',
        headers: { ...(await authHeaders()), 'Content-Type': 'application/json' },
        body: JSON.stringify({ postId }),
      })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },

    getPublishHistory: (projectId: string): Promise<{ posts: PublishedPost[] }> =>
      get(`/projects/${projectId}/persona/publishing/history`),
  },

  // ---------------------------------------------------------------------------
  // Pillar 1 - Strategy & Planning
  // ---------------------------------------------------------------------------
  pillar1: {
    /** List saved documents of a given type ('icp' | 'gtm' | 'okr' | etc.) */
    listDocs: (projectId: string, docType?: string): Promise<{ docs: Pillar1Doc[] }> =>
      get(`/projects/${projectId}/strategy/pillar1/${docType ?? 'icp'}/list`),

    /** Generate ICP segments - SSE stream */
    streamICP: (
      projectId: string,
      body: ICPGenerateBody,
      callbacks: Pillar1StreamCallbacks,
      signal?: AbortSignal,
    ) =>
      streamPost<Pillar1SSEEvent>(
        `/projects/${projectId}/strategy/pillar1/icp/generate`,
        body,
        makePillar1Handler(callbacks),
        () => callbacks.onDone?.(),
        signal,
      ),

    /** Generate GTM strategy - SSE stream */
    streamGTM: (
      projectId: string,
      body: Record<string, unknown>,
      callbacks: Pillar1StreamCallbacks,
      signal?: AbortSignal,
    ) =>
      streamPost<Pillar1SSEEvent>(
        `/projects/${projectId}/strategy/pillar1/gtm/generate`,
        body,
        makePillar1Handler(callbacks),
        () => callbacks.onDone?.(),
        signal,
      ),

    /** Generate OKRs - returns JSON directly (non-streaming) */
    generateOKR: (projectId: string, body: Record<string, unknown>): Promise<Pillar1Doc> =>
      post(`/projects/${projectId}/strategy/pillar1/okr/generate`, body),

    /** Generate budget model - SSE stream */
    streamBudget: (
      projectId: string,
      body: Record<string, unknown>,
      callbacks: Pillar1StreamCallbacks,
      signal?: AbortSignal,
    ) =>
      streamPost<Pillar1SSEEvent>(
        `/projects/${projectId}/strategy/pillar1/budget/model`,
        body,
        makePillar1Handler(callbacks),
        () => callbacks.onDone?.(),
        signal,
      ),

    /** Generate personas - SSE stream */
    streamPersonas: (
      projectId: string,
      body: Record<string, unknown>,
      callbacks: Pillar1StreamCallbacks,
      signal?: AbortSignal,
    ) =>
      streamPost<Pillar1SSEEvent>(
        `/projects/${projectId}/strategy/pillar1/personas/generate`,
        body,
        makePillar1Handler(callbacks),
        () => callbacks.onDone?.(),
        signal,
      ),

    /** Generate market sizing (TAM/SAM/SOM) - SSE stream */
    streamMarketSize: (
      projectId: string,
      body: Record<string, unknown>,
      callbacks: Pillar1StreamCallbacks,
      signal?: AbortSignal,
    ) =>
      streamPost<Pillar1SSEEvent>(
        `/projects/${projectId}/strategy/pillar1/market-size/analyze`,
        body,
        makePillar1Handler(callbacks),
        () => callbacks.onDone?.(),
        signal,
      ),

    /** Start a Positioning Workshop session */
    startPositioning: (projectId: string, body: Record<string, unknown>): Promise<{ doc_id: string; stage: number; stage_label: string }> =>
      post(`/projects/${projectId}/strategy/pillar1/positioning/start`, body),

    /** Send a message in a Positioning Workshop session - SSE stream */
    streamPositioningMessage: (
      projectId: string,
      docId: string,
      message: string,
      callbacks: Pillar1StreamCallbacks,
      signal?: AbortSignal,
    ) =>
      streamPost<Pillar1SSEEvent>(
        `/projects/${projectId}/strategy/pillar1/positioning/${docId}/message`,
        { message },
        makePillar1Handler(callbacks),
        () => callbacks.onDone?.(),
        signal,
      ),

    /** Get a positioning session with its message history */
    getPositioningSession: (projectId: string, docId: string): Promise<{ doc: Pillar1Doc; messages: Pillar1Message[] }> =>
      get(`/projects/${projectId}/strategy/pillar1/positioning/${docId}`),

    /** Generate competitive positioning map - SSE stream */
    streamCompMap: (
      projectId: string,
      body: Record<string, unknown>,
      callbacks: Pillar1StreamCallbacks,
      signal?: AbortSignal,
    ) =>
      streamPost<Pillar1SSEEvent>(
        `/projects/${projectId}/strategy/pillar1/comp-map/generate`,
        body,
        makePillar1Handler(callbacks),
        () => callbacks.onDone?.(),
        signal,
      ),

    /** Generate launch plan - SSE stream */
    streamLaunch: (
      projectId: string,
      body: Record<string, unknown>,
      callbacks: Pillar1StreamCallbacks,
      signal?: AbortSignal,
    ) =>
      streamPost<Pillar1SSEEvent>(
        `/projects/${projectId}/strategy/pillar1/launch/plan`,
        body,
        makePillar1Handler(callbacks),
        () => callbacks.onDone?.(),
        signal,
      ),

    /** Run risk scan - SSE stream */
    streamRiskScan: (
      projectId: string,
      body: Record<string, unknown>,
      callbacks: Pillar1StreamCallbacks,
      signal?: AbortSignal,
    ) =>
      streamPost<Pillar1SSEEvent>(
        `/projects/${projectId}/strategy/pillar1/risk/scan`,
        body,
        makePillar1Handler(callbacks),
        () => callbacks.onDone?.(),
        signal,
      ),

    /** List risk alerts (list of risk_flag docs) */
    listRiskAlerts: (projectId: string): Promise<{ docs: Pillar1Doc[] }> =>
      get(`/projects/${projectId}/strategy/pillar1/risk/alerts`),

    /** Dismiss a specific risk alert */
    dismissRiskAlert: (projectId: string, docId: string, riskId: string): Promise<{ status: string }> =>
      post(`/projects/${projectId}/strategy/pillar1/risk/alerts/${docId}/dismiss/${riskId}`, {}),
  },

  // ---------------------------------------------------------------------------
  // Pillar 2 - Content Creation & Management
  // ---------------------------------------------------------------------------
  pillar2: {
    /** List saved Pillar 2 documents */
    listDocs: (projectId: string, docType: string): Promise<{ docs: Pillar1Doc[] }> =>
      get(`/projects/${projectId}/strategy/pillar2/${docType}/list`),

    /** Generate headline A/B variants - SSE stream */
    streamHeadlines: (
      projectId: string,
      body: Record<string, unknown>,
      callbacks: Pillar1StreamCallbacks,
      signal?: AbortSignal,
    ) =>
      streamPost<Pillar1SSEEvent>(
        `/projects/${projectId}/strategy/pillar2/headline/generate`,
        body,
        makePillar1Handler(callbacks),
        () => callbacks.onDone?.(),
        signal,
      ),

    /** Generate visual brief - SSE stream */
    streamVisualBrief: (
      projectId: string,
      body: Record<string, unknown>,
      callbacks: Pillar1StreamCallbacks,
      signal?: AbortSignal,
    ) =>
      streamPost<Pillar1SSEEvent>(
        `/projects/${projectId}/strategy/pillar2/visual-brief/generate`,
        body,
        makePillar1Handler(callbacks),
        () => callbacks.onDone?.(),
        signal,
      ),

    /** Generate video script - SSE stream */
    streamVideoScript: (
      projectId: string,
      body: Record<string, unknown>,
      callbacks: Pillar1StreamCallbacks,
      signal?: AbortSignal,
    ) =>
      streamPost<Pillar1SSEEvent>(
        `/projects/${projectId}/strategy/pillar2/video-script/generate`,
        body,
        makePillar1Handler(callbacks),
        () => callbacks.onDone?.(),
        signal,
      ),

    /** Process podcast audio/transcript - SSE stream */
    streamPodcast: (
      projectId: string,
      body: Record<string, unknown>,
      callbacks: Pillar1StreamCallbacks,
      signal?: AbortSignal,
    ) =>
      streamPost<Pillar1SSEEvent>(
        `/projects/${projectId}/strategy/pillar2/podcast/process`,
        body,
        makePillar1Handler(callbacks),
        () => callbacks.onDone?.(),
        signal,
      ),

    /** Score content quality - SSE stream */
    streamQualityScore: (
      projectId: string,
      body: Record<string, unknown>,
      callbacks: Pillar1StreamCallbacks,
      signal?: AbortSignal,
    ) =>
      streamPost<Pillar1SSEEvent>(
        `/projects/${projectId}/strategy/pillar2/quality/score`,
        body,
        makePillar1Handler(callbacks),
        () => callbacks.onDone?.(),
        signal,
      ),

    /** Translate and adapt content - SSE stream */
    streamTranslate: (
      projectId: string,
      body: Record<string, unknown>,
      callbacks: Pillar1StreamCallbacks,
      signal?: AbortSignal,
    ) =>
      streamPost<Pillar1SSEEvent>(
        `/projects/${projectId}/strategy/pillar2/translate/adapt`,
        body,
        makePillar1Handler(callbacks),
        () => callbacks.onDone?.(),
        signal,
      ),

    /** Generate case study - SSE stream */
    streamCaseStudy: (
      projectId: string,
      body: Record<string, unknown>,
      callbacks: Pillar1StreamCallbacks,
      signal?: AbortSignal,
    ) =>
      streamPost<Pillar1SSEEvent>(
        `/projects/${projectId}/strategy/pillar2/case-study/generate`,
        body,
        makePillar1Handler(callbacks),
        () => callbacks.onDone?.(),
        signal,
      ),

    /** Analyse content gaps - SSE stream */
    streamContentGap: (
      projectId: string,
      body: Record<string, unknown>,
      callbacks: Pillar1StreamCallbacks,
      signal?: AbortSignal,
    ) =>
      streamPost<Pillar1SSEEvent>(
        `/projects/${projectId}/strategy/pillar2/content-gap/analyze`,
        body,
        makePillar1Handler(callbacks),
        () => callbacks.onDone?.(),
        signal,
      ),
  },

  // -------------------------------------------------------------------------
  // Pillar 3 - SEO & Organic Search
  // -------------------------------------------------------------------------
  pillar3: {
    streamKeywordResearch: (
      projectId: string,
      body: unknown,
      callbacks: Pillar1StreamCallbacks,
      signal?: AbortSignal,
    ) =>
      streamPost<Pillar1SSEEvent>(
        `/projects/${projectId}/strategy/pillar3/keywords/research`,
        body,
        makePillar1Handler(callbacks),
        () => callbacks.onDone?.(),
        signal,
      ),

    streamSerpIntent: (
      projectId: string,
      body: unknown,
      callbacks: Pillar1StreamCallbacks,
      signal?: AbortSignal,
    ) =>
      streamPost<Pillar1SSEEvent>(
        `/projects/${projectId}/strategy/pillar3/serp-intent/map`,
        body,
        makePillar1Handler(callbacks),
        () => callbacks.onDone?.(),
        signal,
      ),

    streamOnPageAudit: (
      projectId: string,
      body: unknown,
      callbacks: Pillar1StreamCallbacks,
      signal?: AbortSignal,
    ) =>
      streamPost<Pillar1SSEEvent>(
        `/projects/${projectId}/strategy/pillar3/on-page/audit`,
        body,
        makePillar1Handler(callbacks),
        () => callbacks.onDone?.(),
        signal,
      ),

    streamFeaturedSnippet: (
      projectId: string,
      body: unknown,
      callbacks: Pillar1StreamCallbacks,
      signal?: AbortSignal,
    ) =>
      streamPost<Pillar1SSEEvent>(
        `/projects/${projectId}/strategy/pillar3/featured-snippet/optimize`,
        body,
        makePillar1Handler(callbacks),
        () => callbacks.onDone?.(),
        signal,
      ),

    streamFreshnessCheck: (
      projectId: string,
      body: unknown,
      callbacks: Pillar1StreamCallbacks,
      signal?: AbortSignal,
    ) =>
      streamPost<Pillar1SSEEvent>(
        `/projects/${projectId}/strategy/pillar3/freshness/check`,
        body,
        makePillar1Handler(callbacks),
        () => callbacks.onDone?.(),
        signal,
      ),

    streamTechnicalAudit: (
      projectId: string,
      body: unknown,
      callbacks: Pillar1StreamCallbacks,
      signal?: AbortSignal,
    ) =>
      streamPost<Pillar1SSEEvent>(
        `/projects/${projectId}/strategy/pillar3/technical/audit`,
        body,
        makePillar1Handler(callbacks),
        () => callbacks.onDone?.(),
        signal,
      ),
  },

  // -------------------------------------------------------------------------
  // Pillar 4 - Paid Advertising
  // -------------------------------------------------------------------------
  pillar4: {
    streamAdBrief: (
      projectId: string,
      body: unknown,
      callbacks: Pillar1StreamCallbacks,
      signal?: AbortSignal,
    ) =>
      streamPost<Pillar1SSEEvent>(
        `/projects/${projectId}/strategy/pillar4/ad-brief/generate`,
        body,
        makePillar1Handler(callbacks),
        () => callbacks.onDone?.(),
        signal,
      ),

    streamAdCopy: (
      projectId: string,
      body: unknown,
      callbacks: Pillar1StreamCallbacks,
      signal?: AbortSignal,
    ) =>
      streamPost<Pillar1SSEEvent>(
        `/projects/${projectId}/strategy/pillar4/ad-copy/generate`,
        body,
        makePillar1Handler(callbacks),
        () => callbacks.onDone?.(),
        signal,
      ),

    streamRetargeting: (
      projectId: string,
      body: unknown,
      callbacks: Pillar1StreamCallbacks,
      signal?: AbortSignal,
    ) =>
      streamPost<Pillar1SSEEvent>(
        `/projects/${projectId}/strategy/pillar4/retargeting/build`,
        body,
        makePillar1Handler(callbacks),
        () => callbacks.onDone?.(),
        signal,
      ),

    streamAttribution: (
      projectId: string,
      body: unknown,
      callbacks: Pillar1StreamCallbacks,
      signal?: AbortSignal,
    ) =>
      streamPost<Pillar1SSEEvent>(
        `/projects/${projectId}/strategy/pillar4/attribution/analyse`,
        body,
        makePillar1Handler(callbacks),
        () => callbacks.onDone?.(),
        signal,
      ),
  },

  // -------------------------------------------------------------------------
  // Pillar 5 - Email Marketing & CRM
  // -------------------------------------------------------------------------
  pillar5: {
    streamEmailSequence: (projectId: string, body: unknown, callbacks: Pillar1StreamCallbacks, signal?: AbortSignal) =>
      streamPost<Pillar1SSEEvent>(`/projects/${projectId}/strategy/pillar5/email-sequence/build`, body, makePillar1Handler(callbacks), () => callbacks.onDone?.(), signal),

    streamSubjectLines: (projectId: string, body: unknown, callbacks: Pillar1StreamCallbacks, signal?: AbortSignal) =>
      streamPost<Pillar1SSEEvent>(`/projects/${projectId}/strategy/pillar5/subject-lines/optimise`, body, makePillar1Handler(callbacks), () => callbacks.onDone?.(), signal),

    streamSendTime: (projectId: string, body: unknown, callbacks: Pillar1StreamCallbacks, signal?: AbortSignal) =>
      streamPost<Pillar1SSEEvent>(`/projects/${projectId}/strategy/pillar5/send-time/optimise`, body, makePillar1Handler(callbacks), () => callbacks.onDone?.(), signal),

    streamNewsletter: (projectId: string, body: unknown, callbacks: Pillar1StreamCallbacks, signal?: AbortSignal) =>
      streamPost<Pillar1SSEEvent>(`/projects/${projectId}/strategy/pillar5/newsletter/produce`, body, makePillar1Handler(callbacks), () => callbacks.onDone?.(), signal),

    streamChurnRisk: (projectId: string, body: unknown, callbacks: Pillar1StreamCallbacks, signal?: AbortSignal) =>
      streamPost<Pillar1SSEEvent>(`/projects/${projectId}/strategy/pillar5/churn-risk/analyse`, body, makePillar1Handler(callbacks), () => callbacks.onDone?.(), signal),

    streamLeadScoring: (projectId: string, body: unknown, callbacks: Pillar1StreamCallbacks, signal?: AbortSignal) =>
      streamPost<Pillar1SSEEvent>(`/projects/${projectId}/strategy/pillar5/lead-scoring/score`, body, makePillar1Handler(callbacks), () => callbacks.onDone?.(), signal),

    streamWinLoss: (projectId: string, body: unknown, callbacks: Pillar1StreamCallbacks, signal?: AbortSignal) =>
      streamPost<Pillar1SSEEvent>(`/projects/${projectId}/strategy/pillar5/winloss/analyse`, body, makePillar1Handler(callbacks), () => callbacks.onDone?.(), signal),

    validateEmails: (projectId: string, emails: string[]) =>
      post<{ results: unknown[]; validated?: number }>(`/projects/${projectId}/strategy/pillar5/list-hygiene/validate`, { emails }),
  },

  // -------------------------------------------------------------------------
  // Pillar 6 - Social Media (gap features)
  // -------------------------------------------------------------------------
  pillar6: {
    streamCommunityManagement: (projectId: string, body: unknown, callbacks: Pillar1StreamCallbacks, signal?: AbortSignal) =>
      streamPost<Pillar1SSEEvent>(`/projects/${projectId}/strategy/pillar6/community/manage`, body, makePillar1Handler(callbacks), () => callbacks.onDone?.(), signal),

    streamSocialProof: (projectId: string, body: unknown, callbacks: Pillar1StreamCallbacks, signal?: AbortSignal) =>
      streamPost<Pillar1SSEEvent>(`/projects/${projectId}/strategy/pillar6/social-proof/harvest`, body, makePillar1Handler(callbacks), () => callbacks.onDone?.(), signal),

    streamEmployeeAdvocacy: (projectId: string, body: unknown, callbacks: Pillar1StreamCallbacks, signal?: AbortSignal) =>
      streamPost<Pillar1SSEEvent>(`/projects/${projectId}/strategy/pillar6/employee-advocacy/generate`, body, makePillar1Handler(callbacks), () => callbacks.onDone?.(), signal),
  },

  // -------------------------------------------------------------------------
  // Pillar 7 - Analytics & Reporting
  // -------------------------------------------------------------------------
  pillar7: {
    streamUnifiedDashboard: (projectId: string, body: unknown, callbacks: Pillar1StreamCallbacks, signal?: AbortSignal) =>
      streamPost<Pillar1SSEEvent>(`/projects/${projectId}/strategy/pillar7/unified-dashboard/generate`, body, makePillar1Handler(callbacks), () => callbacks.onDone?.(), signal),

    streamCohortAnalysis: (projectId: string, body: unknown, callbacks: Pillar1StreamCallbacks, signal?: AbortSignal) =>
      streamPost<Pillar1SSEEvent>(`/projects/${projectId}/strategy/pillar7/cohort/analyse`, body, makePillar1Handler(callbacks), () => callbacks.onDone?.(), signal),

    streamFunnelAnalysis: (projectId: string, body: unknown, callbacks: Pillar1StreamCallbacks, signal?: AbortSignal) =>
      streamPost<Pillar1SSEEvent>(`/projects/${projectId}/strategy/pillar7/funnel/analyse`, body, makePillar1Handler(callbacks), () => callbacks.onDone?.(), signal),

    streamAnomalyDetection: (projectId: string, body: unknown, callbacks: Pillar1StreamCallbacks, signal?: AbortSignal) =>
      streamPost<Pillar1SSEEvent>(`/projects/${projectId}/strategy/pillar7/anomaly/detect`, body, makePillar1Handler(callbacks), () => callbacks.onDone?.(), signal),

    streamForecast: (projectId: string, body: unknown, callbacks: Pillar1StreamCallbacks, signal?: AbortSignal) =>
      streamPost<Pillar1SSEEvent>(`/projects/${projectId}/strategy/pillar7/forecast/generate`, body, makePillar1Handler(callbacks), () => callbacks.onDone?.(), signal),

    streamCacLtv: (projectId: string, body: unknown, callbacks: Pillar1StreamCallbacks, signal?: AbortSignal) =>
      streamPost<Pillar1SSEEvent>(`/projects/${projectId}/strategy/pillar7/cac-ltv/calculate`, body, makePillar1Handler(callbacks), () => callbacks.onDone?.(), signal),

    streamBoardReport: (projectId: string, body: unknown, callbacks: Pillar1StreamCallbacks, signal?: AbortSignal) =>
      streamPost<Pillar1SSEEvent>(`/projects/${projectId}/strategy/pillar7/board-report/generate`, body, makePillar1Handler(callbacks), () => callbacks.onDone?.(), signal),
  },

  // -------------------------------------------------------------------------
  // Pillar 8 - PR & Communications
  // -------------------------------------------------------------------------
  pillar8: {
    streamPressRelease: (projectId: string, body: unknown, callbacks: Pillar1StreamCallbacks, signal?: AbortSignal) =>
      streamPost<Pillar1SSEEvent>(`/projects/${projectId}/strategy/pillar8/press-release/write`, body, makePillar1Handler(callbacks), () => callbacks.onDone?.(), signal),

    streamMediaList: (projectId: string, body: unknown, callbacks: Pillar1StreamCallbacks, signal?: AbortSignal) =>
      streamPost<Pillar1SSEEvent>(`/projects/${projectId}/strategy/pillar8/media-list/build`, body, makePillar1Handler(callbacks), () => callbacks.onDone?.(), signal),

    streamPitchEmail: (projectId: string, body: unknown, callbacks: Pillar1StreamCallbacks, signal?: AbortSignal) =>
      streamPost<Pillar1SSEEvent>(`/projects/${projectId}/strategy/pillar8/pitch-email/generate`, body, makePillar1Handler(callbacks), () => callbacks.onDone?.(), signal),

    streamCoverageMonitor: (projectId: string, body: unknown, callbacks: Pillar1StreamCallbacks, signal?: AbortSignal) =>
      streamPost<Pillar1SSEEvent>(`/projects/${projectId}/strategy/pillar8/coverage/monitor`, body, makePillar1Handler(callbacks), () => callbacks.onDone?.(), signal),

    streamCrisisComms: (projectId: string, body: unknown, callbacks: Pillar1StreamCallbacks, signal?: AbortSignal) =>
      streamPost<Pillar1SSEEvent>(`/projects/${projectId}/strategy/pillar8/crisis/respond`, body, makePillar1Handler(callbacks), () => callbacks.onDone?.(), signal),

    streamAwardSubmission: (projectId: string, body: unknown, callbacks: Pillar1StreamCallbacks, signal?: AbortSignal) =>
      streamPost<Pillar1SSEEvent>(`/projects/${projectId}/strategy/pillar8/awards/submit`, body, makePillar1Handler(callbacks), () => callbacks.onDone?.(), signal),

    streamAnalystBriefing: (projectId: string, body: unknown, callbacks: Pillar1StreamCallbacks, signal?: AbortSignal) =>
      streamPost<Pillar1SSEEvent>(`/projects/${projectId}/strategy/pillar8/analyst/brief`, body, makePillar1Handler(callbacks), () => callbacks.onDone?.(), signal),

    streamPartnershipComms: (projectId: string, body: unknown, callbacks: Pillar1StreamCallbacks, signal?: AbortSignal) =>
      streamPost<Pillar1SSEEvent>(`/projects/${projectId}/strategy/pillar8/partnership/draft`, body, makePillar1Handler(callbacks), () => callbacks.onDone?.(), signal),
  },

  pillar10: {
    streamABTestDesign: (projectId: string, body: unknown, callbacks: Pillar1StreamCallbacks, signal?: AbortSignal) =>
      streamPost<Pillar1SSEEvent>(`/projects/${projectId}/strategy/pillar10/ab-test/design`, body, makePillar1Handler(callbacks), () => callbacks.onDone?.(), signal),

    streamLandingPageCRO: (projectId: string, body: unknown, callbacks: Pillar1StreamCallbacks, signal?: AbortSignal) =>
      streamPost<Pillar1SSEEvent>(`/projects/${projectId}/strategy/pillar10/cro/generate`, body, makePillar1Handler(callbacks), () => callbacks.onDone?.(), signal),

    streamMessagingResonance: (projectId: string, body: unknown, callbacks: Pillar1StreamCallbacks, signal?: AbortSignal) =>
      streamPost<Pillar1SSEEvent>(`/projects/${projectId}/strategy/pillar10/messaging-resonance/analyse`, body, makePillar1Handler(callbacks), () => callbacks.onDone?.(), signal),

    streamEmailAB: (projectId: string, body: unknown, callbacks: Pillar1StreamCallbacks, signal?: AbortSignal) =>
      streamPost<Pillar1SSEEvent>(`/projects/${projectId}/strategy/pillar10/email-ab/analyse`, body, makePillar1Handler(callbacks), () => callbacks.onDone?.(), signal),

    streamLearningPropagation: (projectId: string, body: unknown, callbacks: Pillar1StreamCallbacks, signal?: AbortSignal) =>
      streamPost<Pillar1SSEEvent>(`/projects/${projectId}/strategy/pillar10/learning-propagation/generate`, body, makePillar1Handler(callbacks), () => callbacks.onDone?.(), signal),

    // Experiment Log - REST (no SSE)
    listExperiments: (projectId: string) =>
      get<unknown[]>(`/projects/${projectId}/strategy/pillar10/experiment-log`),

    createExperiment: (projectId: string, body: unknown) =>
      post<unknown>(`/projects/${projectId}/strategy/pillar10/experiment-log`, body),

    updateExperiment: (projectId: string, experimentId: string, body: unknown) =>
      patch<unknown>(`/projects/${projectId}/strategy/pillar10/experiment-log/${experimentId}`, body),

    deleteExperiment: (projectId: string, experimentId: string) =>
      del(`/projects/${projectId}/strategy/pillar10/experiment-log/${experimentId}`),
  },
}
