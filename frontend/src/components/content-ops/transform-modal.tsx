'use client'

import { useState } from 'react'
import { X, Shuffle, Loader2, BookmarkPlus } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import type { ContentLibraryItem } from '@/types'

interface TransformModalProps {
  item: ContentLibraryItem
  projectId: string
  onClose: () => void
  onSaved: () => void
}

// Backend returns lowercase keys - map both cases
const PLATFORM_LABELS: Record<string, string> = {
  instagram: 'Instagram',
  facebook: 'Facebook',
  tiktok: 'TikTok',
  linkedin: 'LinkedIn',
  x: 'X (Twitter)',
  email: 'Email',
}

const ALL_TARGET_PLATFORMS = ['Instagram', 'Facebook', 'TikTok', 'LinkedIn', 'X', 'Email']

export function TransformModal({ item, projectId, onClose, onSaved }: TransformModalProps) {
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState<Record<string, { content: string; hashtags: string[]; notes: string }> | null>(null)
  const [saving, setSaving] = useState<Set<string>>(new Set())
  const [saved, setSaved] = useState<Set<string>>(new Set())

  async function handleTransform() {
    setLoading(true)
    setResults(null)
    try {
      // Transform to all platforms except the source platform
      const targets = ALL_TARGET_PLATFORMS.filter(
        (p) => p.toLowerCase() !== item.platform.toLowerCase(),
      )
      const result = await api.contentOps.transform(projectId, item.content, targets)
      setResults(result.results)
    } catch (err) {
      toast.error('Transform failed. Try again.')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  async function handleSave(platform: string, data: { content: string; hashtags: string[]; notes: string }) {
    setSaving((s) => new Set(s).add(platform))
    try {
      await api.contentLibrary.save(projectId, {
        platform,
        type: item.type,
        content: data.content,
        hashtags: data.hashtags,
        metadata: { notes: data.notes, transformedFrom: item.id, sourcePlatform: item.platform },
      })
      setSaved((s) => new Set(s).add(platform))
      toast.success(`Saved ${platform} version`)
      onSaved()
    } catch {
      toast.error('Failed to save')
    } finally {
      setSaving((s) => { const n = new Set(s); n.delete(platform); return n })
    }
  }

  const platforms = results ? Object.keys(results) : []

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <Shuffle className="w-4 h-4 text-primary" />
            <span className="font-semibold text-sm">Platform Transformer</span>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Original */}
          <div>
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
              Original ({item.platform})
            </div>
            <div className="bg-muted/40 rounded-lg p-3 text-sm text-foreground/80 line-clamp-3">{item.content}</div>
          </div>

          {/* Action */}
          <div className="flex items-center gap-3">
            <p className="text-xs text-muted-foreground flex-1">
              Adapt this content for all major platforms simultaneously - each version optimised for that platform&apos;s format and audience expectations.
            </p>
            <button
              onClick={handleTransform}
              disabled={loading}
              className="shrink-0 flex items-center gap-1.5 px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Shuffle className="w-3.5 h-3.5" />}
              {loading ? 'Transforming…' : 'Transform for all platforms'}
            </button>
          </div>

          {/* Results */}
          {results && platforms.length > 0 && (
            <div className="space-y-3">
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Platform Versions</div>
              {platforms.map((platform) => {
                const data = results[platform]
                return (
                  <div key={platform} className="rounded-xl border border-border bg-background p-4 space-y-2">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 space-y-1.5">
                        <div className="text-[10px] font-semibold text-primary uppercase tracking-wide">
                          {PLATFORM_LABELS[platform] ?? platform}
                        </div>
                        <p className="text-sm leading-relaxed">{data.content}</p>
                        {data.hashtags.length > 0 && (
                          <p className="text-xs text-primary/70">
                            {data.hashtags.map((h) => `#${h.replace(/^#/, '')}`).join(' ')}
                          </p>
                        )}
                        {data.notes && (
                          <p className="text-[10px] text-muted-foreground italic">{data.notes}</p>
                        )}
                      </div>
                      <button
                        onClick={() => handleSave(platform, data)}
                        disabled={saving.has(platform) || saved.has(platform)}
                        className={`shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                          saved.has(platform)
                            ? 'bg-green-500/10 text-green-600'
                            : 'bg-muted text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        {saving.has(platform) ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <BookmarkPlus className="w-3 h-3" />
                        )}
                        {saved.has(platform) ? 'Saved' : 'Save'}
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
