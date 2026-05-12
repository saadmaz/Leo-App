'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import { BookOpen, Loader2, Copy, Check, Sparkles, Download, BookmarkPlus } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { api } from '@/lib/api'
import { useAppStore } from '@/stores/app-store'
import { SidebarToggle } from '@/components/layout/sidebar'
import { BackButton } from '@/components/layout/back-button'
import type { StyleGuide, StyleGuideSection } from '@/types'

const SECTION_ICONS: Record<string, string> = {
  'Brand Personality': '✦',
  'Voice & Tone':      '◎',
  'Writing Do\'s':     '✓',
  'Writing Don\'ts':   '✗',
  'Power Words':       '⚡',
  'Words to Avoid':    '⊘',
  'Example Headlines': '◈',
  'Audience Persona':  '◉',
  'Content Pillars':   '▣',
}

export default function StyleGuidePage() {
  const params = useParams<{ projectId: string }>()
  const { activeProject } = useAppStore()
  const [loading, setLoading]       = useState(false)
  const [guide, setGuide]           = useState<StyleGuide | null>(null)
  const [expanded, setExpanded]     = useState<Set<number>>(new Set())
  const [copiedIdx, setCopiedIdx]   = useState<number | null>(null)
  const [saving, setSaving]         = useState(false)

  async function handleGenerate() {
    setLoading(true)
    setGuide(null)
    try {
      const data = await api.styleGuide.generate(params.projectId)
      setGuide(data)
      setExpanded(new Set(data.sections.map((_, i) => i)))
    } catch (err) {
      console.error(err)
      toast.error('Style guide generation failed. Make sure Brand Core is set up.')
    } finally {
      setLoading(false)
    }
  }

  function toggleSection(i: number) {
    setExpanded((prev) => { const s = new Set(prev); if (s.has(i)) { s.delete(i) } else { s.add(i) }; return s })
  }

  function copySection(section: StyleGuideSection, i: number) {
    navigator.clipboard.writeText(`${section.title}\n\n${section.content}`)
    setCopiedIdx(i)
    toast.success('Copied!')
    setTimeout(() => setCopiedIdx(null), 1500)
  }

  async function saveToLibrary() {
    if (!guide) return
    setSaving(true)
    try {
      const fullContent = [
        `# ${activeProject?.name ?? 'Brand'} - Brand Style Guide`,
        '',
        guide.summary,
        '',
        ...guide.sections.flatMap((s) => [`## ${s.title}`, '', s.content, '']),
      ].join('\n')
      await api.contentLibrary.save(params.projectId, {
        platform: 'Website',
        type: 'ad_copy' as const,
        content: fullContent,
        hashtags: [],
        metadata: { savedFromStyleGuide: true, contentType: 'style_guide', brandName: activeProject?.name },
      })
      toast.success('Style guide saved to library')
    } catch (err) {
      console.error(err)
      toast.error('Failed to save to library')
    } finally {
      setSaving(false)
    }
  }

  function downloadGuide() {
    if (!guide) return
    const lines = [
      `# ${activeProject?.name ?? 'Brand'} - Brand Style Guide`,
      '',
      guide.summary,
      '',
      ...guide.sections.flatMap((s) => [`## ${s.title}`, '', s.content, '']),
    ]
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${activeProject?.name ?? 'brand'}-style-guide.md`
    a.click()
    URL.revokeObjectURL(url)
    toast.success('Downloaded!')
  }

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="flex items-center gap-3 px-3 sm:px-4 py-3 border-b border-border shrink-0">
        <SidebarToggle />
        <BackButton />
        <BookOpen className="w-4 h-4 text-primary" />
        <span className="text-sm font-semibold">Brand Style Guide</span>
        {activeProject && <span className="text-xs text-muted-foreground">- {activeProject.name}</span>}
        {guide && (
          <div className="ml-auto flex items-center gap-2">
            <button onClick={saveToLibrary} disabled={saving}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50">
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <BookmarkPlus className="w-3.5 h-3.5" />}
              Save to Library
            </button>
            <button onClick={downloadGuide}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
              <Download className="w-3.5 h-3.5" />
              Download .md
            </button>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4">
        <div className="max-w-3xl mx-auto space-y-4">
          {!guide && !loading && (
            <div className="border border-border rounded-xl bg-card p-8 text-center space-y-4">
              <div className="w-14 h-14 rounded-2xl bg-primary/10 text-primary flex items-center justify-center mx-auto">
                <BookOpen className="w-7 h-7" />
              </div>
              <div>
                <h2 className="text-base font-semibold">Generate Your Brand Style Guide</h2>
                <p className="text-sm text-muted-foreground mt-1 max-w-sm mx-auto">
                  LEO will analyse your Brand Core and produce a comprehensive guide covering voice, tone, dos/don&apos;ts, power words, content pillars, and more.
                </p>
              </div>
              <button onClick={handleGenerate}
                className="flex items-center gap-2 mx-auto px-6 py-2.5 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors">
                <Sparkles className="w-4 h-4" />
                Generate Style Guide
              </button>
            </div>
          )}

          {loading && (
            <div className="flex flex-col items-center justify-center gap-4 py-20">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">Analysing brand core and writing your guide…</p>
            </div>
          )}

          {guide && (
            <>
              {/* Summary */}
              <div className="border border-primary/20 bg-primary/5 rounded-xl p-4">
                <p className="text-xs font-semibold text-primary uppercase tracking-wide mb-2">Brand Summary</p>
                <p className="text-sm text-foreground/80 leading-relaxed">{guide.summary}</p>
              </div>

              {/* Regenerate */}
              <div className="flex justify-end">
                <button onClick={handleGenerate}
                  className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
                  <Sparkles className="w-3.5 h-3.5" />
                  Regenerate
                </button>
              </div>

              {/* Sections */}
              {guide.sections.map((section, i) => (
                <SectionCard
                  key={i}
                  section={section}
                  icon={SECTION_ICONS[section.title] ?? '◆'}
                  expanded={expanded.has(i)}
                  onToggle={() => toggleSection(i)}
                  onCopy={() => copySection(section, i)}
                  copied={copiedIdx === i}
                />
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// SectionCard
// ---------------------------------------------------------------------------

function SectionCard({
  section, icon, expanded, onToggle, onCopy, copied,
}: {
  section: StyleGuideSection
  icon: string
  expanded: boolean
  onToggle: () => void
  onCopy: () => void
  copied: boolean
}) {
  return (
    <div className="border border-border rounded-xl bg-card overflow-hidden">
      <button onClick={onToggle}
        className="flex items-center justify-between w-full px-4 py-3.5 hover:bg-muted/30 transition-colors">
        <div className="flex items-center gap-3">
          <span className="text-base text-primary w-5 text-center shrink-0">{icon}</span>
          <span className="text-sm font-semibold">{section.title}</span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={(e) => { e.stopPropagation(); onCopy() }}
            className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
            {copied ? <Check className="w-3.5 h-3.5 text-green-600" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
          <span className={cn('text-muted-foreground transition-transform', expanded ? 'rotate-90' : '')}>›</span>
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-4 pt-1 border-t border-border/50">
          <p className="text-sm text-foreground/80 whitespace-pre-wrap leading-relaxed">{section.content}</p>
        </div>
      )}
    </div>
  )
}
