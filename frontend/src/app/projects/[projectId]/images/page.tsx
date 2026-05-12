'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import {
  ImageIcon, Wand2, Loader2, Download, Trash2, RefreshCw, Sparkles,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { api } from '@/lib/api'
import { useAppStore } from '@/stores/app-store'
import { SidebarToggle } from '@/components/layout/sidebar'
import { BackButton } from '@/components/layout/back-button'
import type { GeneratedImage } from '@/types'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ASPECT_RATIOS = [
  { value: 'square',    label: 'Square',    hint: '1:1' },
  { value: 'landscape', label: 'Landscape', hint: '16:9' },
  { value: 'portrait',  label: 'Portrait',  hint: '9:16' },
] as const

const STYLES = [
  { value: 'vivid',   label: 'Vivid',   desc: 'Bold, high-contrast' },
  { value: 'natural', label: 'Natural', desc: 'Photorealistic' },
] as const

const PLATFORMS = ['Instagram', 'Facebook', 'TikTok', 'LinkedIn', 'X']

const STYLE_PRESETS = [
  { label: 'Minimal',       prefix: 'Minimalist, clean white background, studio light,' },
  { label: 'Dark & Moody',  prefix: 'Dark moody atmosphere, dramatic lighting, deep shadows,' },
  { label: 'Bright & Airy', prefix: 'Bright airy pastel tones, soft natural light, fresh,' },
  { label: 'Cinematic',     prefix: 'Cinematic wide shot, film grain, dramatic color grade,' },
  { label: 'Flat Illustr.', prefix: 'Flat illustration style, bold vector shapes, minimal,' },
  { label: 'Watercolor',    prefix: 'Soft watercolor painting, delicate brush strokes, artistic,' },
  { label: 'Product Shot',  prefix: 'Professional product photography, clean background, sharp focus,' },
]

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ImagesPage() {
  const params = useParams<{ projectId: string }>()
  const { activeProject } = useAppStore()

  const [tab, setTab] = useState<'generate' | 'gallery'>('generate')

  // Generate tab state
  const [brief, setBrief] = useState('')
  const [prompt, setPrompt] = useState('')
  const [aspectRatio, setAspectRatio] = useState<'square' | 'landscape' | 'portrait'>('square')
  const [style, setStyle] = useState<'vivid' | 'natural'>('vivid')
  const [platform, setPlatform] = useState('Instagram')
  const [generatingPrompt, setGeneratingPrompt] = useState(false)
  const [generatingImage, setGeneratingImage] = useState(false)
  const [results, setResults] = useState<string[]>([])
  const [saving, setSaving] = useState<number | null>(null) // index being saved

  // Gallery state
  const [images, setImages] = useState<GeneratedImage[]>([])
  const [galleryLoading, setGalleryLoading] = useState(false)

  const loadGallery = useCallback(async () => {
    setGalleryLoading(true)
    try {
      const data = await api.images.list(params.projectId)
      setImages(data.images)
    } catch (err) {
      console.error(err)
    } finally {
      setGalleryLoading(false)
    }
  }, [params.projectId])

  useEffect(() => { if (tab === 'gallery') loadGallery() }, [tab, loadGallery])

  async function handleGeneratePrompt() {
    if (!brief.trim()) { toast.error('Enter a brief first'); return }
    setGeneratingPrompt(true)
    try {
      const data = await api.generate.aiPrompt(params.projectId, { brief, platform, style })
      setPrompt(data.prompt)
    } catch {
      toast.error('Failed to generate prompt')
    } finally {
      setGeneratingPrompt(false)
    }
  }

  async function handleGenerateImage() {
    if (!prompt.trim()) { toast.error('Enter or generate a prompt first'); return }
    setGeneratingImage(true)
    setResults([])
    try {
      const [r1, r2, r3] = await Promise.all([
        api.generate.image(params.projectId, { prompt, style, aspectRatio }),
        api.generate.image(params.projectId, { prompt, style, aspectRatio }),
        api.generate.image(params.projectId, { prompt, style, aspectRatio }),
      ])
      setResults([r1.url, r2.url, r3.url])
    } catch {
      toast.error('Image generation failed - check that GEMINI_API_KEY is configured')
    } finally {
      setGeneratingImage(false)
    }
  }

  async function handleSave(idx: number) {
    const url = results[idx]
    if (!url) return
    setSaving(idx)
    try {
      await api.images.save(params.projectId, { dataUrl: url, prompt, aspectRatio, style, platform })
      toast.success('Saved to gallery')
    } catch {
      toast.error('Failed to save')
    } finally {
      setSaving(null)
    }
  }

  function handleDownload(idx: number) {
    const url = results[idx]
    if (!url) return
    const a = document.createElement('a')
    a.href = url
    a.download = `leo-image-${Date.now()}.png`
    a.click()
  }

  function applyPreset(prefix: string) {
    setBrief((prev) => {
      const stripped = STYLE_PRESETS.reduce((s, p) => s.replace(p.prefix + ' ', '').replace(p.prefix, ''), prev).trim()
      return `${prefix} ${stripped}`.trim()
    })
  }

  async function handleDelete(imageId: string) {
    try {
      await api.images.delete(params.projectId, imageId)
      setImages((prev) => prev.filter((i) => i.id !== imageId))
      toast.success('Deleted')
    } catch {
      toast.error('Failed to delete')
    }
  }

  const aspectClass = {
    square:    'aspect-square',
    landscape: 'aspect-video',
    portrait:  'aspect-[9/16]',
  }[aspectRatio]

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-3 sm:px-4 py-3 border-b border-border shrink-0">
        <SidebarToggle />
        <BackButton />
        <ImageIcon className="w-4 h-4 text-primary" />
        <span className="text-sm font-semibold">Image Studio</span>
        {activeProject && <span className="text-xs text-muted-foreground">- {activeProject.name}</span>}
        <div className="ml-auto flex items-center gap-1">
          {(['generate', 'gallery'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                'px-3 py-1.5 rounded-md text-xs font-medium capitalize transition-colors',
                tab === t ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-muted',
              )}
            >
              {t === 'gallery' ? `Gallery${images.length ? ` (${images.length})` : ''}` : 'Generate'}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4">
        {tab === 'generate' ? (
          <div className="max-w-3xl mx-auto space-y-5">
            {/* Controls */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Left: brief + prompt */}
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Platform</label>
                  <div className="flex flex-wrap gap-1.5">
                    {PLATFORMS.map((p) => (
                      <button
                        key={p}
                        onClick={() => setPlatform(p)}
                        className={cn(
                          'px-2.5 py-1 rounded-md text-xs transition-colors',
                          platform === p ? 'bg-primary text-primary-foreground' : 'bg-background border border-border text-muted-foreground hover:text-foreground',
                        )}
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Style Presets</label>
                  <div className="flex flex-wrap gap-1.5">
                    {STYLE_PRESETS.map((p) => (
                      <button
                        key={p.label}
                        onClick={() => applyPreset(p.prefix)}
                        className={cn(
                          'px-2.5 py-1 rounded-md text-xs transition-colors border',
                          brief.startsWith(p.prefix)
                            ? 'bg-primary text-primary-foreground border-primary'
                            : 'bg-background border-border text-muted-foreground hover:text-foreground',
                        )}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Brief</label>
                  <div className="flex gap-2">
                    <textarea
                      value={brief}
                      onChange={(e) => setBrief(e.target.value)}
                      placeholder="Describe what you want to show… (e.g. 'Our product on a minimalist desk with morning coffee')"
                      rows={3}
                      className="flex-1 text-xs bg-background border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary resize-none"
                    />
                  </div>
                </div>

                <button
                  onClick={handleGeneratePrompt}
                  disabled={generatingPrompt || !brief.trim()}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 disabled:opacity-50 transition-colors"
                >
                  {generatingPrompt ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                  Generate Brand-Aligned Prompt
                </button>

                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Image Prompt</label>
                  <textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder="AI-generated or manually written prompt…"
                    rows={4}
                    className="w-full text-xs bg-background border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary resize-none"
                  />
                </div>
              </div>

              {/* Right: options */}
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Aspect Ratio</label>
                  <div className="flex flex-col gap-1.5">
                    {ASPECT_RATIOS.map((ar) => (
                      <button
                        key={ar.value}
                        onClick={() => setAspectRatio(ar.value)}
                        className={cn(
                          'flex items-center justify-between px-3 py-2 rounded-lg border text-xs transition-colors',
                          aspectRatio === ar.value
                            ? 'border-primary bg-primary/5 text-foreground'
                            : 'border-border bg-background text-muted-foreground hover:text-foreground',
                        )}
                      >
                        <span className="font-medium">{ar.label}</span>
                        <span className="text-muted-foreground">{ar.hint}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Style</label>
                  <div className="flex flex-col gap-1.5">
                    {STYLES.map((s) => (
                      <button
                        key={s.value}
                        onClick={() => setStyle(s.value)}
                        className={cn(
                          'flex items-center justify-between px-3 py-2 rounded-lg border text-xs transition-colors',
                          style === s.value
                            ? 'border-primary bg-primary/5 text-foreground'
                            : 'border-border bg-background text-muted-foreground hover:text-foreground',
                        )}
                      >
                        <span className="font-medium">{s.label}</span>
                        <span className="text-muted-foreground">{s.desc}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <button
                  onClick={handleGenerateImage}
                  disabled={generatingImage || !prompt.trim()}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 transition-opacity"
                >
                  {generatingImage ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
                  {generatingImage ? 'Generating…' : 'Generate Image'}
                </button>
              </div>
            </div>

            {/* Results: 3 variants */}
            {generatingImage && (
              <div className="grid grid-cols-3 gap-3">
                {[0, 1, 2].map((i) => (
                  <div key={i} className={cn('rounded-xl border border-border bg-muted/30 flex items-center justify-center', aspectClass)}>
                    <div className="flex flex-col items-center gap-2">
                      <Loader2 className="w-6 h-6 animate-spin text-primary" />
                      <p className="text-[10px] text-muted-foreground">Variant {i + 1}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {results.length > 0 && !generatingImage && (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground font-medium">3 variants generated - save the ones you like</p>
                <div className="grid grid-cols-3 gap-3">
                  {results.map((url, i) => (
                    <div key={i} className="flex flex-col gap-2">
                      <div className={cn('rounded-xl overflow-hidden border border-border', aspectClass)}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={url} alt={`Variant ${i + 1}`} className="w-full h-full object-cover" />
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => handleDownload(i)}
                          className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg text-[10px] font-medium border border-border hover:bg-muted transition-colors"
                        >
                          <Download className="w-3 h-3" />
                          Download
                        </button>
                        <button
                          onClick={() => handleSave(i)}
                          disabled={saving === i}
                          className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg text-[10px] font-medium bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 transition-opacity"
                        >
                          {saving === i ? <Loader2 className="w-3 h-3 animate-spin" /> : <ImageIcon className="w-3 h-3" />}
                          Save
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                <button
                  onClick={handleGenerateImage}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-border hover:bg-muted transition-colors"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Regenerate all
                </button>
              </div>
            )}
          </div>
        ) : (
          /* Gallery tab */
          galleryLoading ? (
            <div className="flex items-center justify-center h-40">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : images.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-center">
              <ImageIcon className="w-12 h-12 text-muted-foreground/30 mb-4" />
              <h2 className="text-lg font-semibold mb-2">No saved images yet</h2>
              <p className="text-sm text-muted-foreground">Generate an image and save it to your gallery.</p>
            </div>
          ) : (
            <div className="columns-2 md:columns-3 xl:columns-4 gap-3 space-y-3 max-w-6xl mx-auto">
              {images.map((img) => (
                <GalleryCard key={img.id} image={img} onDelete={() => handleDelete(img.id)} />
              ))}
            </div>
          )
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// GalleryCard
// ---------------------------------------------------------------------------

function GalleryCard({ image, onDelete }: { image: GeneratedImage; onDelete: () => void }) {
  const [confirmDelete, setConfirmDelete] = useState(false)

  function handleDownload() {
    const a = document.createElement('a')
    a.href = image.dataUrl
    a.download = `leo-image-${image.id}.png`
    a.click()
  }

  return (
    <div className="relative group rounded-xl overflow-hidden border border-border bg-card break-inside-avoid mb-3">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={image.dataUrl} alt={image.prompt} className="w-full object-cover" />

      <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-2 gap-1">
        <p className="text-[10px] text-white/80 line-clamp-2">{image.prompt}</p>
        <div className="flex items-center gap-1">
          <span className="text-[10px] bg-white/20 text-white px-1.5 py-0.5 rounded-full capitalize">{image.platform}</span>
          <span className="text-[10px] bg-white/20 text-white px-1.5 py-0.5 rounded-full capitalize">{image.aspectRatio}</span>
          <div className="ml-auto flex items-center gap-1">
            <button
              onClick={handleDownload}
              className="p-1 rounded bg-white/20 text-white hover:bg-white/40 transition-colors"
            >
              <Download className="w-3 h-3" />
            </button>
            {confirmDelete ? (
              <>
                <button
                  onClick={onDelete}
                  className="text-[10px] px-1.5 py-0.5 rounded bg-red-500 text-white hover:bg-red-600 transition-colors"
                >
                  Delete
                </button>
                <button
                  onClick={() => setConfirmDelete(false)}
                  className="text-[10px] px-1.5 py-0.5 rounded bg-white/20 text-white hover:bg-white/40 transition-colors"
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                onClick={() => setConfirmDelete(true)}
                className="p-1 rounded bg-white/20 text-white hover:bg-red-500/80 transition-colors"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="px-2 py-1.5 text-[10px] text-muted-foreground">
        {new Date(image.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
      </div>
    </div>
  )
}
