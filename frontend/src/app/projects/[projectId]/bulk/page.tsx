'use client'

import { useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import { Zap, Check, X, Loader2, BookmarkPlus, ChevronRight, ChevronLeft, Pencil, RefreshCw, Hash } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { useAppStore } from '@/stores/app-store'
import { SidebarToggle } from '@/components/layout/sidebar'
import { BackButton } from '@/components/layout/back-button'
import type { BulkGenerateItem } from '@/types'

const PLATFORM_OPTIONS = ['Instagram', 'Facebook', 'TikTok', 'LinkedIn', 'X', 'Email']

export default function BulkGeneratePage() {
  const params = useParams<{ projectId: string }>()
  const { activeProject, setHashtagPanelOpen } = useAppStore()

  const [goal, setGoal] = useState('')
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>(['Instagram', 'Facebook', 'TikTok'])
  const [count, setCount] = useState(3)

  const [generating, setGenerating] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [items, setItems] = useState<BulkGenerateItem[]>([])
  const [currentIdx, setCurrentIdx] = useState(0)
  const [saving, setSaving] = useState(false)
  const [savedIds, setSavedIds] = useState<Set<number>>(new Set())
  const [rejectedIds, setRejectedIds] = useState<Set<number>>(new Set())

  // Inline editing state
  const [editingIdx, setEditingIdx] = useState<number | null>(null)
  const [edits, setEdits] = useState<Record<number, string>>({})

  // Per-item regen state
  const [regenIdx, setRegenIdx] = useState<number | null>(null)

  const togglePlatform = useCallback((p: string) => {
    setSelectedPlatforms((prev) =>
      prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p],
    )
  }, [])

  async function handleGenerate() {
    if (selectedPlatforms.length === 0) {
      toast.error('Select at least one platform')
      return
    }
    setGenerating(true)
    setItems([])
    setProgress(null)
    setCurrentIdx(0)
    setSavedIds(new Set())
    setRejectedIds(new Set())
    setEdits({})
    setEditingIdx(null)

    api.streamBulkGenerate(
      params.projectId,
      {
        platforms: selectedPlatforms,
        count_per_platform: count,
        goal: goal.trim() || undefined,
      },
      {
        onItem: (event) => setItems((prev) => [...prev, event.item]),
        onProgress: (done, total) => setProgress({ done, total }),
        onDone: () => setGenerating(false),
        onError: (err) => {
          toast.error(err)
          setGenerating(false)
        },
      },
    ).catch((err) => {
      toast.error('Failed to start generation')
      setGenerating(false)
      console.error(err)
    })
  }

  async function handleRegenItem(idx: number) {
    const item = items[idx]
    setRegenIdx(idx)
    setEditingIdx(null)

    try {
      await api.streamBulkGenerate(
        params.projectId,
        {
          platforms: [item.platform],
          count_per_platform: 1,
          goal: goal.trim() || undefined,
        },
        {
          onItem: (event) => {
            setItems((prev) => {
              const next = [...prev]
              next[idx] = event.item
              return next
            })
            setEdits((prev) => {
              const next = { ...prev }
              delete next[idx]
              return next
            })
          },
          onProgress: () => {},
          onDone: () => setRegenIdx(null),
          onError: (err) => {
            toast.error(err)
            setRegenIdx(null)
          },
        },
      )
    } catch {
      toast.error('Failed to regenerate item')
      setRegenIdx(null)
    }
  }

  async function handleApprove(idx: number) {
    const item = items[idx]
    const content = edits[idx] ?? item.content
    setSaving(true)
    try {
      await api.contentLibrary.save(params.projectId, {
        platform: item.platform,
        type: item.type as 'caption' | 'ad_copy' | 'video_script' | 'email' | 'image_prompt',
        content,
        hashtags: item.hashtags,
        metadata: { hook: item.hook, headline: item.headline, cta: item.cta, bulkGenerated: true },
      })
      setSavedIds((s) => new Set(s).add(idx))
      toast.success('Saved to library')
      if (currentIdx < items.length - 1) setCurrentIdx((i) => i + 1)
    } catch {
      toast.error('Failed to save')
    } finally {
      setSaving(false)
    }
  }

  function handleReject(idx: number) {
    setRejectedIds((s) => new Set(s).add(idx))
    if (currentIdx < items.length - 1) setCurrentIdx((i) => i + 1)
  }

  const current = items[currentIdx]
  const pending = items.filter((_, i) => !savedIds.has(i) && !rejectedIds.has(i)).length
  const done = savedIds.size + rejectedIds.size
  const isRegening = regenIdx === currentIdx

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-3 sm:px-4 py-3 border-b border-border shrink-0">
        <SidebarToggle />
        <BackButton />
        <Zap className="w-4 h-4 text-primary" />
        <span className="text-sm font-semibold">Bulk Content Generator</span>
        {activeProject && <span className="text-xs text-muted-foreground">- {activeProject.name}</span>}
        <div className="ml-auto">
          <button
            onClick={() => setHashtagPanelOpen(true)}
            title="Hashtag Research"
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <Hash className="w-3.5 h-3.5" />
            Hashtags
          </button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Left: Config panel */}
        <div className="w-72 border-r border-border p-5 flex flex-col gap-5 shrink-0 overflow-y-auto">
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Goal <span className="normal-case font-normal">(optional)</span>
            </label>
            <textarea
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder="e.g. Promote summer sale, drive traffic to website"
              rows={3}
              className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary resize-none"
            />
          </div>

          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Platforms</label>
            <div className="flex flex-wrap gap-1.5">
              {PLATFORM_OPTIONS.map((p) => (
                <button
                  key={p}
                  onClick={() => togglePlatform(p)}
                  className={`px-2.5 py-1 rounded-md text-xs transition-colors ${
                    selectedPlatforms.includes(p)
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Pieces per platform
            </label>
            <div className="flex gap-1.5">
              {[1, 2, 3, 5].map((n) => (
                <button
                  key={n}
                  onClick={() => setCount(n)}
                  className={`w-9 h-9 rounded-md text-sm font-medium transition-colors ${
                    count === n ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={handleGenerate}
            disabled={generating}
            className="flex items-center justify-center gap-2 py-2.5 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
            {generating ? 'Generating…' : 'Generate'}
          </button>

          {progress && (
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{progress.done} / {progress.total} complete</span>
                <span>{Math.round((progress.done / progress.total) * 100)}%</span>
              </div>
              <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary transition-all duration-300"
                  style={{ width: `${(progress.done / progress.total) * 100}%` }}
                />
              </div>
            </div>
          )}

          {items.length > 0 && (
            <div className="pt-2 border-t border-border space-y-1 text-xs text-muted-foreground">
              <div className="flex justify-between">
                <span>Total</span><span className="font-medium text-foreground">{items.length}</span>
              </div>
              <div className="flex justify-between">
                <span>Saved</span><span className="font-medium text-green-600">{savedIds.size}</span>
              </div>
              <div className="flex justify-between">
                <span>Rejected</span><span className="font-medium text-destructive">{rejectedIds.size}</span>
              </div>
              <div className="flex justify-between">
                <span>Remaining</span><span className="font-medium text-foreground">{pending}</span>
              </div>
            </div>
          )}
        </div>

        {/* Right: Triage area */}
        <div className="flex-1 flex flex-col items-center justify-center p-8 overflow-y-auto">
          {items.length === 0 && !generating && (
            <div className="text-center space-y-3">
              <Zap className="w-12 h-12 text-muted-foreground/30 mx-auto" />
              <h2 className="text-lg font-semibold">Ready to generate</h2>
              <p className="text-sm text-muted-foreground max-w-xs">
                Configure your topic and platforms, then hit Generate to create a batch of content ready for review.
              </p>
            </div>
          )}

          {generating && items.length === 0 && (
            <div className="text-center space-y-3">
              <Loader2 className="w-8 h-8 animate-spin text-primary mx-auto" />
              <p className="text-sm text-muted-foreground">Generating content…</p>
            </div>
          )}

          {current && done < items.length && (
            <div className="w-full max-w-lg space-y-4">
              {/* Progress indicator */}
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{currentIdx + 1} of {items.length}</span>
                <span className="font-medium text-foreground">{current.platform}</span>
              </div>

              {/* Card */}
              <div className="bg-card border border-border rounded-2xl p-6 shadow-sm space-y-3">
                {isRegening ? (
                  <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground">
                    <Loader2 className="w-5 h-5 animate-spin" />
                    <span className="text-sm">Regenerating…</span>
                  </div>
                ) : (
                  <>
                    {(current.hook || current.headline) && (
                      <div className="text-xs font-semibold text-primary uppercase tracking-wide">
                        {current.hook || current.headline}
                      </div>
                    )}

                    {/* Editable content area */}
                    <div className="relative group/edit">
                      {editingIdx === currentIdx ? (
                        <textarea
                          autoFocus
                          value={edits[currentIdx] ?? current.content}
                          onChange={(e) => setEdits((prev) => ({ ...prev, [currentIdx]: e.target.value }))}
                          rows={5}
                          className="w-full text-sm leading-relaxed bg-muted/40 border border-primary/30 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary resize-none"
                        />
                      ) : (
                        <p className="text-sm leading-relaxed">
                          {edits[currentIdx] ?? current.content}
                        </p>
                      )}
                      <button
                        onClick={() => setEditingIdx(editingIdx === currentIdx ? null : currentIdx)}
                        className="absolute top-0 right-0 p-1 rounded opacity-0 group-hover/edit:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
                        title={editingIdx === currentIdx ? 'Done editing' : 'Edit content'}
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {edits[currentIdx] !== undefined && edits[currentIdx] !== current.content && (
                      <p className="text-[10px] text-primary/60 italic">Edited - will save with your changes</p>
                    )}

                    {current.hashtags.length > 0 && (
                      <p className="text-xs text-primary/70">
                        {current.hashtags.map((h) => `#${h.replace(/^#/, '')}`).join(' ')}
                      </p>
                    )}
                    {current.cta && (
                      <p className="text-xs text-muted-foreground italic">CTA: {current.cta}</p>
                    )}
                    <div className="text-[10px] text-muted-foreground/60 capitalize">
                      {current.type.replace('_', ' ')} · {current.platform}
                    </div>
                  </>
                )}
              </div>

              {/* Actions */}
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setCurrentIdx((i) => Math.max(0, i - 1))}
                  disabled={currentIdx === 0}
                  className="p-2 rounded-lg border border-border text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>

                <button
                  onClick={() => handleReject(currentIdx)}
                  disabled={saving || isRegening || rejectedIds.has(currentIdx) || savedIds.has(currentIdx)}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-sm font-medium border border-destructive/30 text-destructive rounded-lg hover:bg-destructive/5 disabled:opacity-40 transition-colors"
                >
                  <X className="w-4 h-4" />
                  Skip
                </button>

                <button
                  onClick={() => handleRegenItem(currentIdx)}
                  disabled={saving || isRegening || savedIds.has(currentIdx)}
                  className="p-2.5 rounded-lg border border-border text-muted-foreground hover:text-foreground disabled:opacity-40 transition-colors"
                  title="Regenerate this item"
                >
                  {isRegening ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                </button>

                <button
                  onClick={() => handleApprove(currentIdx)}
                  disabled={saving || isRegening || savedIds.has(currentIdx)}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-40 transition-colors"
                >
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <BookmarkPlus className="w-4 h-4" />}
                  {savedIds.has(currentIdx) ? 'Saved' : 'Save to library'}
                </button>

                <button
                  onClick={() => setCurrentIdx((i) => Math.min(items.length - 1, i + 1))}
                  disabled={currentIdx === items.length - 1}
                  className="p-2 rounded-lg border border-border text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>

              {/* Status indicators */}
              <div className="flex gap-1 justify-center">
                {items.map((_, i) => (
                  <button
                    key={i}
                    onClick={() => setCurrentIdx(i)}
                    className={`w-2 h-2 rounded-full transition-colors ${
                      i === currentIdx
                        ? 'bg-primary'
                        : savedIds.has(i)
                        ? 'bg-green-500'
                        : rejectedIds.has(i)
                        ? 'bg-destructive/40'
                        : 'bg-muted-foreground/30'
                    }`}
                  />
                ))}
              </div>
            </div>
          )}

          {items.length > 0 && done === items.length && !generating && (
            <div className="text-center space-y-3">
              <Check className="w-12 h-12 text-green-500 mx-auto" />
              <h2 className="text-lg font-semibold">All done!</h2>
              <p className="text-sm text-muted-foreground">
                {savedIds.size} item{savedIds.size !== 1 ? 's' : ''} saved to your content library.
              </p>
              <button
                onClick={() => {
                  setItems([])
                  setProgress(null)
                  setSavedIds(new Set())
                  setRejectedIds(new Set())
                  setCurrentIdx(0)
                  setEdits({})
                  setEditingIdx(null)
                }}
                className="px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
              >
                Generate another batch
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
