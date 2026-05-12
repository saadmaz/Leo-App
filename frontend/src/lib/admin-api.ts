/**
 * Admin API client - talks to /admin/* backend routes.
 *
 * All calls are authenticated via Firebase ID token. The token must carry
 * the `superAdmin: true` custom claim, otherwise the backend returns 403.
 */

import { auth } from './firebase'

const API = '/api/backend/admin'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AdminUser {
  uid: string
  email: string
  displayName: string
  tier: 'free' | 'pro' | 'agency'
  suspended: boolean
  createdAt: string
  updatedAt: string
  billing: {
    messagesUsed: number
    messagesResetAt: number | null
    ingestionsUsed: number
    stripeCustomerId: string | null
    subscriptionStatus: string | null
    currentPeriodEnd: number | null
  }
  adminOverrides: Record<string, number>
  projectCount?: number
  credits?: {
    balance: number
    lifetimeUsed: number
    resetsAt?: number
  }
}

export interface DashboardStats {
  totalUsers: number
  usersByTier: { free: number; pro: number; agency: number }
  newSignups7d: number
  suspendedUsers: number
  totalProjects: number
  totalMessagesThisMonth: number
  estimatedMrr: number
}

// ---------------------------------------------------------------------------
// Auth header
// ---------------------------------------------------------------------------

async function adminHeaders(): Promise<HeadersInit> {
  const user = auth.currentUser
  if (!user) throw new Error('Not authenticated')
  const token = await user.getIdToken()
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  }
}

// ---------------------------------------------------------------------------
// Core helpers
// ---------------------------------------------------------------------------

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, { headers: await adminHeaders() })
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}: ${await res.text()}`)
  return res.json()
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: await adminHeaders(),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) throw new Error(`POST ${path} → ${res.status}: ${await res.text()}`)
  return res.json()
}

async function patch<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: 'PATCH',
    headers: await adminHeaders(),
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`PATCH ${path} → ${res.status}: ${await res.text()}`)
  return res.json()
}

async function del(path: string): Promise<void> {
  const res = await fetch(`${API}${path}`, {
    method: 'DELETE',
    headers: await adminHeaders(),
  })
  if (!res.ok) throw new Error(`DELETE ${path} → ${res.status}: ${await res.text()}`)
}

// ---------------------------------------------------------------------------
// Public admin API surface
// ---------------------------------------------------------------------------

export interface AdminProject {
  id: string
  name: string
  description: string
  ownerId: string
  memberCount: number
  ingestionStatus: string | null
  websiteUrl: string | null
  hasBrandCore: boolean
  createdAt: string
  updatedAt: string
}

export interface AnalyticsData {
  signupsLast30d: { date: string; signups: number }[]
  topUsersByMessages: {
    uid: string
    email: string
    displayName: string
    tier: string
    messagesUsed: number
  }[]
  usageHistogram: { bucket: string; users: number }[]
  totalMessagesThisMonth: number
}

export interface AuditLogEntry {
  id: string
  adminUid: string
  action: string
  targetUid: string
  details: Record<string, unknown>
  timestamp: string
}

export const adminApi = {
  dashboard: {
    stats: () => get<DashboardStats>('/dashboard'),
  },

  analytics: {
    get: () => get<AnalyticsData>('/analytics'),
  },

  auditLog: {
    list: (limit?: number) => {
      const qs = limit ? `?limit=${limit}` : ''
      return get<AuditLogEntry[]>(`/audit-log${qs}`)
    },
  },

  users: {
    list: (params?: { search?: string; tier?: string }) => {
      const qs = new URLSearchParams()
      if (params?.search) qs.set('search', params.search)
      if (params?.tier) qs.set('tier', params.tier)
      const query = qs.toString() ? `?${qs}` : ''
      return get<AdminUser[]>(`/users${query}`)
    },

    get: (uid: string) => get<AdminUser>(`/users/${uid}`),

    updateTier: (uid: string, tier: 'free' | 'pro' | 'agency') =>
      patch<AdminUser>(`/users/${uid}`, { tier }),

    resetUsage: (uid: string) =>
      post<{ ok: boolean }>(`/users/${uid}/reset-usage`),

    suspend: (uid: string) =>
      post<{ ok: boolean; suspended: boolean }>(`/users/${uid}/suspend`),

    unsuspend: (uid: string) =>
      post<{ ok: boolean; suspended: boolean }>(`/users/${uid}/unsuspend`),

    overrideLimits: (uid: string, limits: {
      messagesLimit?: number
      projectsLimit?: number
      ingestionsLimit?: number
      campaignsLimit?: number
    }) => post<{ ok: boolean; overrides: Record<string, number> }>(`/users/${uid}/override-limits`, limits),

    delete: (uid: string) => del(`/users/${uid}`),

    grantAdmin: (uid: string) =>
      post<{ ok: boolean }>(`/users/${uid}/grant-admin`),

    revokeAdmin: (uid: string) =>
      post<{ ok: boolean }>(`/users/${uid}/revoke-admin`),
  },

  projects: {
    list: (params?: { search?: string }) => {
      const qs = params?.search ? `?search=${encodeURIComponent(params.search)}` : ''
      return get<AdminProject[]>(`/projects${qs}`)
    },
    delete: (projectId: string) => del(`/projects/${projectId}`),
  },

  featureFlags: {
    list: () => get<FeatureFlag[]>('/feature-flags'),

    toggle: (flagId: string, enabled: boolean) =>
      patch<FeatureFlag>(`/feature-flags/${flagId}`, { enabled }),

    setTiers: (flagId: string, allowedTiers: string[] | null) =>
      patch<FeatureFlag>(`/feature-flags/${flagId}`, { allowedTiers }),

    upsert: async (flagId: string, body: {
      name: string
      description?: string
      enabled?: boolean
      allowedTiers?: string[] | null
      userOverrides?: Record<string, boolean>
    }): Promise<FeatureFlag> => {
      const res = await fetch(`${API}/feature-flags/${flagId}`, {
        method: 'PUT',
        headers: await adminHeaders(),
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error(`PUT /feature-flags/${flagId} → ${res.status}: ${await res.text()}`)
      return res.json()
    },

    setUserOverride: (flagId: string, uid: string, value: boolean) =>
      post<{ ok: boolean }>(`/feature-flags/${flagId}/overrides`, { uid, value }),

    removeUserOverride: (flagId: string, uid: string) =>
      del(`/feature-flags/${flagId}/overrides/${uid}`),

    delete: (flagId: string) => del(`/feature-flags/${flagId}`),
  },

  system: {
    health: () => get<SystemHealth>('/system/health'),
  },

  announcements: {
    list: () => get<Announcement[]>('/communications/announcements'),
    create: (body: Omit<Announcement, 'id' | 'createdAt' | 'updatedAt'>) =>
      post<Announcement>('/communications/announcements', body),
    update: (id: string, body: Partial<Omit<Announcement, 'id' | 'createdAt' | 'updatedAt'>>) =>
      patch<Announcement>(`/communications/announcements/${id}`, body),
    delete: (id: string) => del(`/communications/announcements/${id}`),
  },

  changelog: {
    list: (limit?: number) => {
      const qs = limit ? `?limit=${limit}` : ''
      return get<ChangelogEntry[]>(`/communications/changelog${qs}`)
    },
    create: (body: Omit<ChangelogEntry, 'id' | 'createdAt'>) =>
      post<ChangelogEntry>('/communications/changelog', body),
    delete: (id: string) => del(`/communications/changelog/${id}`),
  },

  broadcast: {
    send: (body: {
      subject: string
      html_body: string
      segment: 'all' | 'free' | 'pro' | 'agency'
    }) => post<BroadcastResult>('/communications/broadcast', body),
  },

  moderation: {
    stats: () => get<ModerationStats>('/moderation/stats'),

    list: (params?: { status?: string }) => {
      const qs = params?.status ? `?status=${params.status}` : ''
      return get<FlaggedItem[]>(`/moderation${qs}`)
    },

    dismiss: (flagId: string, note?: string) =>
      post<{ ok: boolean }>(`/moderation/${flagId}/dismiss`, { note }),

    action: (flagId: string, note?: string) =>
      post<{ ok: boolean }>(`/moderation/${flagId}/action`, { note }),

    abuse: () => get<AbuseReport>('/moderation/abuse'),
  },

  credits: {
    /** Add credits to any user. Hits /credits/topup (not under /admin prefix). */
    topup: async (uid: string, amount: number, reason: string) => {
      const user = auth.currentUser
      if (!user) throw new Error('Not authenticated')
      const token = await user.getIdToken()
      const res = await fetch('/api/backend/credits/topup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ uid, amount, reason }),
      })
      if (!res.ok) throw new Error(`Credits topup failed: ${res.status}`)
      return res.json() as Promise<{ ok: boolean; uid: string; added: number }>
    },
  },
}

export interface FeatureFlag {
  id: string
  name: string
  description: string
  enabled: boolean
  allowedTiers: string[] | null
  userOverrides: Record<string, boolean>
  createdAt: string
  updatedAt: string
}

export interface HealthCheck {
  name: string
  status: 'ok' | 'error'
  detail: string
  latencyMs: number
}

export interface SystemHealth {
  overall: 'healthy' | 'degraded' | 'down'
  checks: HealthCheck[]
  checkedAt: string
}

export interface ModerationStats {
  pending: number
  actioned: number
  dismissed: number
  total: number
}

export interface FlaggedItem {
  id: string
  uid: string
  email: string
  projectId: string
  chatId: string
  messageId: string | null
  content: string
  reason: string
  patterns: string[]
  status: 'pending' | 'dismissed' | 'actioned'
  flaggedAt: string
  reviewedAt: string | null
  reviewedBy: string | null
  note: string | null
}

export interface AbuseReport {
  platformAvg: number
  suspects: {
    uid: string
    email: string
    displayName: string
    tier: string
    messagesUsed: number
    threshold: number
  }[]
}

export interface Announcement {
  id: string
  title: string
  body: string
  type: 'info' | 'warning' | 'success' | 'error'
  active: boolean
  expiresAt: string | null
  createdAt: string
  updatedAt: string
}

export interface ChangelogEntry {
  id: string
  version: string
  title: string
  body: string
  tags: string[]
  publishedAt: string
  createdAt: string
}

export interface BroadcastResult {
  sent: number
  failed: number
  errors: string[]
}

// ---------------------------------------------------------------------------
// Check if the current Firebase user has the superAdmin claim
// ---------------------------------------------------------------------------

export async function isSuperAdmin(): Promise<boolean> {
  const user = auth.currentUser
  if (!user) return false
  const result = await user.getIdTokenResult()
  return result.claims['superAdmin'] === true
}
