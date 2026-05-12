'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'
import { Copy, Check, Instagram, Megaphone, FileText, Palette, CalendarDays, Video, Mail, ImageIcon, Loader2, Download, ExternalLink, BookmarkPlus, BookmarkCheck, Globe, Users, TrendingUp, BarChart2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { useAppStore } from '@/stores/app-store'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ArtifactType = 'captions' | 'ad_copy' | 'campaign_brief' | 'colour_palette' | 'content_calendar' | 'video_script' | 'email_content' | 'image_prompt' | 'research_report' | 'competitor_landscape' | 'influencer_list'

export interface CaptionsArtifact {
  type: 'captions'
  platform: string
  captions: { text: string; hashtags: string[] }[]
}

export interface AdCopyArtifact {
  type: 'ad_copy'
  platform: string
  variants: { headline: string; body: string; cta: string }[]
}

export interface CampaignBriefArtifact {
  type: 'campaign_brief'
  name: string
  objective: string
  audience: string
  channels: string[]
  timeline: string
  kpis: string[]
  budget_guidance: string
  key_messages: string[]
}

export interface ColourPaletteArtifact {
  type: 'colour_palette'
  colours: { hex: string; name: string; usage: string }[]
}

export interface ContentCalendarEntry {
  day: string
  platform: string
  content: string
  time?: string
  hashtags?: string[]
}

export interface ContentCalendarArtifact {
  type: 'content_calendar'
  period: string
  entries: ContentCalendarEntry[]
}

export interface VideoScriptScene {
  timestamp: string
  visual: string
  audio: string
  caption?: string
}

export interface VideoScriptArtifact {
  type: 'video_script'
  platform: string
  duration: string
  scenes: VideoScriptScene[]
  hashtags?: string[]
}

export interface EmailContentArtifact {
  type: 'email_content'
  subject: string
  previewText?: string
  body: string
  cta?: string
}

export interface ImagePromptArtifact {
  type: 'image_prompt'
  prompt: string
  style: 'vivid' | 'natural'
  aspectRatio: 'square' | 'landscape' | 'portrait'
  context?: string
}

export interface ResearchReportSection {
  title: string
  content: string
}

export interface ResearchReportArtifact {
  type: 'research_report'
  title: string
  summary: string
  sections: ResearchReportSection[]
  sources?: { title: string; url: string }[]
  generated_at?: string
}

export interface CompetitorProfile {
  name: string
  strengths: string[]
  weaknesses: string[]
  opportunities?: string[]
  tone?: string
  top_content_themes?: string[]
}

export interface CompetitorLandscapeArtifact {
  type: 'competitor_landscape'
  brand_name: string
  competitors: CompetitorProfile[]
  market_gaps?: string[]
}

export interface InfluencerEntry {
  name: string
  handle: string
  platform?: string
  followers?: string
  alignment_score?: number
  bio?: string
  content_themes?: string[]
}

export interface InfluencerListArtifact {
  type: 'influencer_list'
  topic: string
  platform: string
  influencers: InfluencerEntry[]
}

export type Artifact =
  | CaptionsArtifact
  | AdCopyArtifact
  | CampaignBriefArtifact
  | ColourPaletteArtifact
  | ContentCalendarArtifact
  | VideoScriptArtifact
  | EmailContentArtifact
  | ImagePromptArtifact
  | ResearchReportArtifact
  | CompetitorLandscapeArtifact
  | InfluencerListArtifact

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

const ARTIFACT_RE = /<artifact\s+type="([^"]+)">([\s\S]*?)<\/artifact>/g

export function parseArtifacts(text: string): { clean: string; artifacts: Artifact[] } {
  const artifacts: Artifact[] = []
  const clean = text.replace(ARTIFACT_RE, (_, type, body) => {
    try {
      const data = JSON.parse(body.trim())
      artifacts.push({ type, ...data } as Artifact)
    } catch {
      // malformed artifact - drop silently
    }
    return '' // remove artifact block from visible text
  }).trim()

  return { clean, artifacts }
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

export function ArtifactCard({ artifact }: { artifact: Artifact }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="mt-3"
    >
      {artifact.type === 'captions' && <CaptionsCard artifact={artifact} />}
      {artifact.type === 'ad_copy' && <AdCopyCard artifact={artifact} />}
      {artifact.type === 'campaign_brief' && <CampaignBriefCard artifact={artifact} />}
      {artifact.type === 'colour_palette' && <ColourPaletteCard artifact={artifact} />}
      {artifact.type === 'content_calendar' && <ContentCalendarCard artifact={artifact} />}
      {artifact.type === 'video_script' && <VideoScriptCard artifact={artifact} />}
      {artifact.type === 'email_content' && <EmailContentCard artifact={artifact} />}
      {artifact.type === 'image_prompt' && <ImagePromptCard artifact={artifact} />}
      {artifact.type === 'research_report' && <ResearchReportCard artifact={artifact} />}
      {artifact.type === 'competitor_landscape' && <CompetitorLandscapeCard artifact={artifact} />}
      {artifact.type === 'influencer_list' && <InfluencerListCard artifact={artifact} />}
    </motion.div>
  )
}

// ---------------------------------------------------------------------------
// Captions card
// ---------------------------------------------------------------------------

function CaptionsCard({ artifact }: { artifact: CaptionsArtifact }) {
  const allText = artifact.captions.map((c) => c.text).join('\n\n---\n\n')
  const allHashtags = artifact.captions.flatMap((c) => c.hashtags).filter((h, i, arr) => arr.indexOf(h) === i)
  // Build first caption + hashtags as the Threads publish text
  const firstCaption = artifact.captions[0]
  const threadsText = firstCaption
    ? firstCaption.text + (firstCaption.hashtags.length ? '\n\n' + firstCaption.hashtags.map((h) => `#${h.replace(/^#/, '')}`).join(' ') : '')
    : allText
  return (
    <Card
      icon={<Instagram className="w-3.5 h-3.5" />}
      title={`${artifact.platform} Captions`}
      count={artifact.captions.length}
      saveProps={{ platform: artifact.platform, type: 'caption', content: allText, hashtags: allHashtags }}
      publishThreadsText={threadsText}
    >
      <div className="space-y-3">
        {artifact.captions.map((cap, i) => (
          <div key={i} className="group relative rounded-lg border border-border bg-background p-3">
            <p className="text-sm leading-relaxed pr-8">{cap.text}</p>
            {cap.hashtags.length > 0 && (
              <p className="mt-1.5 text-xs text-primary/70">
                {cap.hashtags.map((h) => `#${h.replace(/^#/, '')}`).join(' ')}
              </p>
            )}
            <CopyButton text={cap.text + (cap.hashtags.length ? '\n\n' + cap.hashtags.map((h) => `#${h.replace(/^#/, '')}`).join(' ') : '')} />
          </div>
        ))}
      </div>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Ad copy card
// ---------------------------------------------------------------------------

function AdCopyCard({ artifact }: { artifact: AdCopyArtifact }) {
  const allText = artifact.variants.map((v) => `Headline: ${v.headline}\n\n${v.body}${v.cta ? `\n\nCTA: ${v.cta}` : ''}`).join('\n\n---\n\n')
  return (
    <Card
      icon={<Megaphone className="w-3.5 h-3.5" />}
      title={`${artifact.platform} Ad Copy`}
      count={artifact.variants.length}
      saveProps={{ platform: artifact.platform, type: 'ad_copy', content: allText, metadata: { variants: artifact.variants } }}
    >
      <div className="space-y-3">
        {artifact.variants.map((v, i) => (
          <div key={i} className="group relative rounded-lg border border-border bg-background p-3">
            <div className="pr-8 space-y-1.5">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Headline</p>
              <p className="text-sm font-medium">{v.headline}</p>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mt-2">Body</p>
              <p className="text-sm leading-relaxed">{v.body}</p>
              {v.cta && (
                <>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mt-2">CTA</p>
                  <span className="inline-block px-2 py-0.5 rounded-md bg-primary/10 text-primary text-xs font-medium">{v.cta}</span>
                </>
              )}
            </div>
            <CopyButton text={`Headline: ${v.headline}\n\n${v.body}${v.cta ? `\n\nCTA: ${v.cta}` : ''}`} />
          </div>
        ))}
      </div>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Campaign brief card
// ---------------------------------------------------------------------------

function CampaignBriefCard({ artifact }: { artifact: CampaignBriefArtifact }) {
  const copyText = [
    `Campaign: ${artifact.name}`,
    `Objective: ${artifact.objective}`,
    `Audience: ${artifact.audience}`,
    `Channels: ${artifact.channels.join(', ')}`,
    `Timeline: ${artifact.timeline}`,
    `KPIs: ${artifact.kpis.join(', ')}`,
    `Budget: ${artifact.budget_guidance}`,
    `Key messages:\n${artifact.key_messages.map((m) => `• ${m}`).join('\n')}`,
  ].join('\n\n')

  return (
    <Card icon={<FileText className="w-3.5 h-3.5" />} title={artifact.name || 'Campaign Brief'} copyText={copyText}>
      <div className="space-y-3">
        <BriefRow label="Objective" value={artifact.objective} />
        <BriefRow label="Audience" value={artifact.audience} />
        {artifact.channels?.length > 0 && (
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-1.5">Channels</p>
            <div className="flex flex-wrap gap-1.5">
              {artifact.channels.map((c) => (
                <span key={c} className="px-2 py-0.5 rounded-full bg-muted text-xs">{c}</span>
              ))}
            </div>
          </div>
        )}
        <BriefRow label="Timeline" value={artifact.timeline} />
        {artifact.kpis?.length > 0 && (
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-1">KPIs</p>
            <ul className="space-y-0.5">
              {artifact.kpis.map((k) => (
                <li key={k} className="text-xs flex gap-1.5"><span className="text-primary">•</span>{k}</li>
              ))}
            </ul>
          </div>
        )}
        {artifact.budget_guidance && <BriefRow label="Budget" value={artifact.budget_guidance} />}
        {artifact.key_messages?.length > 0 && (
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-1">Key messages</p>
            <ul className="space-y-0.5">
              {artifact.key_messages.map((m) => (
                <li key={m} className="text-xs flex gap-1.5"><span className="text-primary">•</span>{m}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Card>
  )
}

function BriefRow({ label, value }: { label: string; value: string }) {
  if (!value) return null
  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground mb-0.5">{label}</p>
      <p className="text-sm">{value}</p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Colour palette card
// ---------------------------------------------------------------------------

function ColourPaletteCard({ artifact }: { artifact: ColourPaletteArtifact }) {
  return (
    <Card icon={<Palette className="w-3.5 h-3.5" />} title="Colour Palette" count={artifact.colours.length}>
      <div className="flex flex-wrap gap-3">
        {artifact.colours.map((c) => (
          <SwatchItem key={c.hex} colour={c} />
        ))}
      </div>
    </Card>
  )
}

function SwatchItem({ colour }: { colour: { hex: string; name: string; usage: string } }) {
  const [copied, setCopied] = useState(false)

  function copy() {
    navigator.clipboard.writeText(colour.hex)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <button onClick={copy} title={`Copy ${colour.hex}`} className="flex flex-col items-center gap-1.5 group">
      <div
        className="w-14 h-14 rounded-xl border border-border shadow-sm group-hover:scale-105 transition-transform"
        style={{ backgroundColor: colour.hex }}
      />
      <p className="text-[11px] font-mono text-muted-foreground">{copied ? '✓ Copied' : colour.hex}</p>
      {colour.name && <p className="text-[11px] text-muted-foreground font-medium">{colour.name}</p>}
      {colour.usage && <p className="text-[10px] text-muted-foreground/60">{colour.usage}</p>}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Content calendar card
// ---------------------------------------------------------------------------

const PLATFORM_ICONS: Record<string, string> = {
  Instagram: '📸', LinkedIn: '💼', X: '𝕏', Twitter: '𝕏',
  TikTok: '🎵', Facebook: '📘', Email: '✉️', YouTube: '▶️',
}

function ContentCalendarCard({ artifact }: { artifact: ContentCalendarArtifact }) {
  const copyText = artifact.entries
    .map((e) => `${e.day} - ${e.platform}${e.time ? ` (${e.time})` : ''}\n${e.content}${e.hashtags?.length ? '\n' + e.hashtags.map((h) => `#${h}`).join(' ') : ''}`)
    .join('\n\n')

  return (
    <Card icon={<CalendarDays className="w-3.5 h-3.5" />} title={artifact.period || 'Content Calendar'} copyText={copyText}>
      <div className="space-y-2">
        {artifact.entries.map((entry, i) => (
          <div key={i} className="group relative rounded-lg border border-border bg-background p-3">
            <div className="flex items-center gap-2 mb-1.5 pr-8">
              <span className="text-sm">{PLATFORM_ICONS[entry.platform] ?? '📄'}</span>
              <span className="text-xs font-semibold">{entry.day}</span>
              <span className="text-xs text-muted-foreground">{entry.platform}</span>
              {entry.time && <span className="ml-auto text-xs text-muted-foreground">{entry.time}</span>}
            </div>
            <p className="text-sm leading-relaxed">{entry.content}</p>
            {entry.hashtags && entry.hashtags.length > 0 && (
              <p className="mt-1 text-xs text-primary/70">
                {entry.hashtags.map((h) => `#${h.replace(/^#/, '')}`).join(' ')}
              </p>
            )}
            <CopyButton text={entry.content + (entry.hashtags?.length ? '\n\n' + entry.hashtags.map((h) => `#${h}`).join(' ') : '')} />
          </div>
        ))}
      </div>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Video script card
// ---------------------------------------------------------------------------

function VideoScriptCard({ artifact }: { artifact: VideoScriptArtifact }) {
  const copyText = artifact.scenes
    .map((s) => `[${s.timestamp}]\nVisual: ${s.visual}\nAudio: ${s.audio}${s.caption ? `\nCaption: ${s.caption}` : ''}`)
    .join('\n\n')
    + (artifact.hashtags?.length ? '\n\n' + artifact.hashtags.map((h) => `#${h}`).join(' ') : '')

  return (
    <Card
      icon={<Video className="w-3.5 h-3.5" />}
      title={`${artifact.platform} Script`}
      copyText={copyText}
      saveProps={{ platform: artifact.platform, type: 'video_script', content: copyText, hashtags: artifact.hashtags ?? [], metadata: { duration: artifact.duration, scenes: artifact.scenes } }}
    >
      <div className="space-y-0.5 mb-3">
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-muted text-xs text-muted-foreground font-medium">
          {artifact.duration}
        </span>
      </div>
      <div className="space-y-2">
        {artifact.scenes.map((scene, i) => (
          <div key={i} className="rounded-lg border border-border bg-background p-3 space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded">{scene.timestamp}</span>
            </div>
            <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-xs">
              <span className="font-semibold text-muted-foreground uppercase tracking-wide pt-0.5">Visual</span>
              <p className="text-sm leading-snug">{scene.visual}</p>
              <span className="font-semibold text-muted-foreground uppercase tracking-wide pt-0.5">Audio</span>
              <p className="text-sm leading-snug">{scene.audio}</p>
              {scene.caption && (
                <>
                  <span className="font-semibold text-muted-foreground uppercase tracking-wide pt-0.5">Caption</span>
                  <p className="text-sm leading-snug text-primary">{scene.caption}</p>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
      {artifact.hashtags && artifact.hashtags.length > 0 && (
        <p className="mt-3 text-xs text-primary/70">
          {artifact.hashtags.map((h) => `#${h.replace(/^#/, '')}`).join(' ')}
        </p>
      )}
    </Card>
  )
}


// ---------------------------------------------------------------------------
// Email content card
// ---------------------------------------------------------------------------

function EmailContentCard({ artifact }: { artifact: EmailContentArtifact }) {
  const copyText = [
    `Subject: ${artifact.subject}`,
    artifact.previewText ? `Preview: ${artifact.previewText}` : '',
    `\n${artifact.body}`,
    artifact.cta ? `\nCTA: ${artifact.cta}` : '',
  ].filter(Boolean).join('\n')

  return (
    <Card
      icon={<Mail className="w-3.5 h-3.5" />}
      title="Email"
      copyText={copyText}
      saveProps={{ platform: 'Email', type: 'email', content: artifact.body, metadata: { subject: artifact.subject, previewText: artifact.previewText, cta: artifact.cta } }}
    >
      <div className="space-y-3">
        <div className="rounded-lg border border-border bg-background p-3 space-y-2">
          <div>
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-0.5">Subject</p>
            <p className="text-sm font-medium">{artifact.subject}</p>
          </div>
          {artifact.previewText && (
            <div>
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-0.5">Preview text</p>
              <p className="text-xs text-muted-foreground">{artifact.previewText}</p>
            </div>
          )}
        </div>
        <div className="rounded-lg border border-border bg-background p-3">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Body</p>
          <p className="text-sm leading-relaxed whitespace-pre-wrap">{artifact.body}</p>
        </div>
        {artifact.cta && (
          <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 flex items-center justify-between">
            <p className="text-xs text-muted-foreground">CTA button</p>
            <span className="text-sm font-medium text-primary">{artifact.cta}</span>
          </div>
        )}
      </div>
    </Card>
  )
}


// ---------------------------------------------------------------------------
// Image prompt card (generates image on demand via DALL-E 3)
// ---------------------------------------------------------------------------

const ASPECT_LABELS: Record<string, string> = {
  square: '1:1 Square',
  landscape: '16:9 Landscape',
  portrait: '9:16 Portrait',
}

function ImagePromptCard({ artifact }: { artifact: ImagePromptArtifact }) {
  const { activeProject } = useAppStore()
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState('')

  async function handleGenerate() {
    if (!activeProject) return
    setStatus('loading')
    setErrorMsg('')
    try {
      const { url } = await api.generate.image(activeProject.id, {
        prompt: artifact.prompt,
        style: artifact.style ?? 'vivid',
        aspectRatio: artifact.aspectRatio ?? 'square',
      })
      setImageUrl(url)
      setStatus('done')
    } catch (err) {
      const msg = String(err)
      // 503 = OPENAI_API_KEY not configured server-side
      if (msg.includes('503') || msg.includes('RuntimeError')) {
        setErrorMsg('Image generation isn\'t configured for this workspace.')
      } else {
        setErrorMsg('Image generation failed - please try again.')
      }
      setStatus('error')
    }
  }

  return (
    <Card icon={<ImageIcon className="w-3.5 h-3.5" />} title="Image Generation">
      <div className="space-y-3">
        {artifact.context && (
          <p className="text-xs text-muted-foreground italic">{artifact.context}</p>
        )}
        <div className="rounded-lg border border-border bg-muted/30 p-3">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">Prompt</p>
          <p className="text-sm leading-relaxed">{artifact.prompt}</p>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="px-2 py-0.5 rounded-full bg-muted capitalize">{artifact.style ?? 'vivid'}</span>
          <span className="px-2 py-0.5 rounded-full bg-muted">{ASPECT_LABELS[artifact.aspectRatio ?? 'square']}</span>
        </div>

        {status === 'idle' && (
          <button
            onClick={handleGenerate}
            disabled={!activeProject}
            className="w-full py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-40"
          >
            Generate with DALL-E 3
          </button>
        )}

        {status === 'loading' && (
          <div className="flex items-center justify-center gap-2 py-3 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" />
            Generating image…
          </div>
        )}

        {status === 'error' && (
          <div className="space-y-2">
            <p className="text-xs text-destructive bg-destructive/10 px-3 py-2 rounded-lg">{errorMsg}</p>
            <button
              onClick={handleGenerate}
              className="w-full py-2 rounded-lg border border-border text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Try again
            </button>
          </div>
        )}

        {status === 'done' && imageUrl && (
          <div className="space-y-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={imageUrl}
              alt="Generated image"
              className={cn(
                'w-full rounded-xl border border-border object-cover',
                artifact.aspectRatio === 'portrait' ? 'max-h-[480px]' :
                artifact.aspectRatio === 'landscape' ? 'max-h-[280px]' : 'max-h-[380px]',
              )}
            />
            <div className="flex gap-2">
              <a
                href={imageUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg border border-border text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <ExternalLink className="w-3 h-3" />
                Open full size
              </a>
              <a
                href={imageUrl}
                download="leo-generated.png"
                className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg border border-border text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <Download className="w-3 h-3" />
                Download
              </a>
              <button
                onClick={() => { setStatus('idle'); setImageUrl(null) }}
                className="px-3 py-1.5 rounded-lg border border-border text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Regenerate
              </button>
            </div>
          </div>
        )}
      </div>
    </Card>
  )
}


// ---------------------------------------------------------------------------
// Research report card
// ---------------------------------------------------------------------------

function ResearchReportCard({ artifact }: { artifact: ResearchReportArtifact }) {
  const [expandedSection, setExpandedSection] = useState<number | null>(0)

  const copyText = [
    `# ${artifact.title}`,
    `\n${artifact.summary}`,
    ...artifact.sections.map((s) => `\n## ${s.title}\n${s.content}`),
    artifact.sources?.length
      ? `\n## Sources\n${artifact.sources.map((s) => `- ${s.title}: ${s.url}`).join('\n')}`
      : '',
  ].filter(Boolean).join('\n')

  return (
    <Card icon={<Globe className="w-3.5 h-3.5" />} title={artifact.title} copyText={copyText}>
      <div className="space-y-3">
        {/* Summary */}
        <div className="rounded-lg border border-border bg-muted/20 p-3">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Summary</p>
          <p className="text-sm leading-relaxed">{artifact.summary}</p>
        </div>

        {/* Sections */}
        {artifact.sections.map((section, i) => (
          <div key={i} className="rounded-lg border border-border bg-background overflow-hidden">
            <button
              onClick={() => setExpandedSection(expandedSection === i ? null : i)}
              className="w-full flex items-center justify-between px-3 py-2.5 text-left hover:bg-muted/30 transition-colors"
            >
              <span className="text-xs font-semibold">{section.title}</span>
              <span className="text-muted-foreground text-xs">{expandedSection === i ? '▲' : '▼'}</span>
            </button>
            {expandedSection === i && (
              <div className="px-3 pb-3">
                <p className="text-sm leading-relaxed text-muted-foreground">{section.content}</p>
              </div>
            )}
          </div>
        ))}

        {/* Sources */}
        {artifact.sources && artifact.sources.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Sources</p>
            {artifact.sources.map((src, i) => (
              <a
                key={i}
                href={src.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-xs text-primary hover:underline truncate"
              >
                <ExternalLink className="w-3 h-3 shrink-0" />
                {src.title || src.url}
              </a>
            ))}
          </div>
        )}
      </div>
    </Card>
  )
}


// ---------------------------------------------------------------------------
// Competitor landscape card
// ---------------------------------------------------------------------------

function CompetitorLandscapeCard({ artifact }: { artifact: CompetitorLandscapeArtifact }) {
  const [selected, setSelected] = useState(0)
  const competitor = artifact.competitors[selected]

  const copyText = artifact.competitors
    .map((c) => [
      `## ${c.name}`,
      `Strengths: ${c.strengths.join(', ')}`,
      `Weaknesses: ${c.weaknesses.join(', ')}`,
      c.opportunities?.length ? `Opportunities: ${c.opportunities.join(', ')}` : '',
      c.tone ? `Tone: ${c.tone}` : '',
    ].filter(Boolean).join('\n'))
    .join('\n\n')

  return (
    <Card icon={<BarChart2 className="w-3.5 h-3.5" />} title={`${artifact.brand_name} - Competitor Landscape`} count={artifact.competitors.length} copyText={copyText}>
      {/* Competitor selector tabs */}
      <div className="flex gap-1.5 flex-wrap mb-3">
        {artifact.competitors.map((c, i) => (
          <button
            key={i}
            onClick={() => setSelected(i)}
            className={cn(
              'px-2.5 py-1 rounded-full text-xs font-medium transition-colors',
              selected === i
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:text-foreground',
            )}
          >
            {c.name}
          </button>
        ))}
      </div>

      {competitor && (
        <div className="space-y-3">
          {/* Tone badge */}
          {competitor.tone && (
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground">Tone:</span>
              <span className="px-2 py-0.5 rounded-full bg-muted text-xs font-medium">{competitor.tone}</span>
            </div>
          )}

          {/* Strengths */}
          <div>
            <p className="text-xs font-semibold text-emerald-600 uppercase tracking-wide mb-1.5">Strengths</p>
            <ul className="space-y-0.5">
              {competitor.strengths.map((s, i) => (
                <li key={i} className="flex items-start gap-1.5 text-xs"><span className="text-emerald-500 mt-0.5 shrink-0">✓</span>{s}</li>
              ))}
            </ul>
          </div>

          {/* Weaknesses */}
          <div>
            <p className="text-xs font-semibold text-rose-500 uppercase tracking-wide mb-1.5">Weaknesses</p>
            <ul className="space-y-0.5">
              {competitor.weaknesses.map((w, i) => (
                <li key={i} className="flex items-start gap-1.5 text-xs"><span className="text-rose-400 mt-0.5 shrink-0">✗</span>{w}</li>
              ))}
            </ul>
          </div>

          {/* Opportunities */}
          {competitor.opportunities && competitor.opportunities.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-amber-500 uppercase tracking-wide mb-1.5">Opportunities for you</p>
              <ul className="space-y-0.5">
                {competitor.opportunities.map((o, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-xs"><span className="text-amber-400 mt-0.5 shrink-0">→</span>{o}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Content themes */}
          {competitor.top_content_themes && competitor.top_content_themes.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1.5">Top content themes</p>
              <div className="flex flex-wrap gap-1.5">
                {competitor.top_content_themes.map((t) => (
                  <span key={t} className="px-2 py-0.5 rounded-full bg-muted text-xs">{t}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Market gaps */}
      {artifact.market_gaps && artifact.market_gaps.length > 0 && (
        <div className="mt-4 pt-3 border-t border-border">
          <p className="text-xs font-semibold text-primary uppercase tracking-wide mb-1.5">Market gaps you can own</p>
          <ul className="space-y-0.5">
            {artifact.market_gaps.map((g, i) => (
              <li key={i} className="flex items-start gap-1.5 text-xs"><span className="text-primary mt-0.5 shrink-0">✦</span>{g}</li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  )
}


// ---------------------------------------------------------------------------
// Influencer list card
// ---------------------------------------------------------------------------

function InfluencerListCard({ artifact }: { artifact: InfluencerListArtifact }) {
  const copyText = artifact.influencers
    .map((inf) => [
      `${inf.name} (@${inf.handle})`,
      inf.platform ? `Platform: ${inf.platform}` : '',
      inf.followers ? `Followers: ${inf.followers}` : '',
      inf.alignment_score !== undefined ? `Alignment: ${inf.alignment_score}/10` : '',
      inf.bio ? `Bio: ${inf.bio}` : '',
    ].filter(Boolean).join(' | '))
    .join('\n')

  return (
    <Card
      icon={<Users className="w-3.5 h-3.5" />}
      title={`${artifact.platform} Influencers - ${artifact.topic}`}
      count={artifact.influencers.length}
      copyText={copyText}
    >
      <div className="space-y-2.5">
        {artifact.influencers.map((inf, i) => (
          <div key={i} className="rounded-lg border border-border bg-background p-3 space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-semibold truncate">{inf.name}</p>
                <p className="text-xs text-primary">@{inf.handle}</p>
              </div>
              <div className="flex flex-col items-end gap-0.5 shrink-0">
                {inf.alignment_score !== undefined && (
                  <div className="flex items-center gap-1">
                    <TrendingUp className="w-3 h-3 text-emerald-500" />
                    <span className="text-xs font-semibold text-emerald-600">{inf.alignment_score}/10</span>
                  </div>
                )}
                {inf.followers && (
                  <span className="text-[11px] text-muted-foreground">{inf.followers}</span>
                )}
              </div>
            </div>
            {inf.bio && (
              <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">{inf.bio}</p>
            )}
            {inf.content_themes && inf.content_themes.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {inf.content_themes.map((t) => (
                  <span key={t} className="px-1.5 py-0.5 rounded-full bg-muted text-[10px]">{t}</span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </Card>
  )
}


// ---------------------------------------------------------------------------
// Save to Library button
// ---------------------------------------------------------------------------

function SaveToLibraryButton({
  platform,
  type,
  content,
  hashtags = [],
  metadata = {},
}: {
  platform: string
  type: string
  content: string
  hashtags?: string[]
  metadata?: Record<string, unknown>
}) {
  const { activeProject } = useAppStore()
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)

  async function handleSave(e: React.MouseEvent) {
    e.stopPropagation()
    if (!activeProject || saved) return
    setSaving(true)
    try {
      await api.contentLibrary.save(activeProject.id, { platform, type, content, hashtags, metadata })
      setSaved(true)
      toast.success('Saved to Content Library')
    } catch {
      toast.error('Failed to save to library')
    } finally {
      setSaving(false)
    }
  }

  if (!activeProject) return null

  return (
    <button
      onClick={handleSave}
      disabled={saving || saved}
      title={saved ? 'Saved to library' : 'Save to Content Library'}
      className={cn(
        'flex items-center gap-1 text-xs transition-colors',
        saved
          ? 'text-green-600'
          : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {saving ? (
        <Loader2 className="w-3 h-3 animate-spin" />
      ) : saved ? (
        <BookmarkCheck className="w-3 h-3" />
      ) : (
        <BookmarkPlus className="w-3 h-3" />
      )}
      <span>{saved ? 'Saved' : 'Save'}</span>
    </button>
  )
}

// ---------------------------------------------------------------------------
// Publish to Threads button
// ---------------------------------------------------------------------------

function PublishToThreadsButton({ text }: { text: string }) {
  const { activeProject } = useAppStore()
  const [publishing, setPublishing] = useState(false)
  const [published, setPublished] = useState(false)

  async function handlePublish(e: React.MouseEvent) {
    e.stopPropagation()
    if (!activeProject || published) return
    setPublishing(true)
    try {
      await api.threads.publish(activeProject.id, { text })
      setPublished(true)
      toast.success('Published to Threads!')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('401')) {
        toast.error('Connect your Threads account in Project Settings first')
      } else {
        toast.error('Failed to publish to Threads')
      }
    } finally {
      setPublishing(false)
    }
  }

  if (!activeProject) return null

  return (
    <button
      onClick={handlePublish}
      disabled={publishing || published}
      title={published ? 'Published to Threads' : 'Publish to Threads'}
      className={cn(
        'flex items-center gap-1 text-xs transition-colors',
        published
          ? 'text-green-600'
          : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {publishing ? (
        <Loader2 className="w-3 h-3 animate-spin" />
      ) : published ? (
        <Check className="w-3 h-3" />
      ) : (
        <span className="w-3 h-3 inline-flex items-center justify-center rounded-sm bg-black text-white text-[8px] font-bold leading-none">T</span>
      )}
      <span>{published ? 'Published' : 'Threads'}</span>
    </button>
  )
}

// ---------------------------------------------------------------------------
// Shared card shell
// ---------------------------------------------------------------------------

function Card({
  icon, title, count, copyText, saveProps, publishThreadsText, children,
}: {
  icon: React.ReactNode
  title: string
  count?: number
  copyText?: string
  saveProps?: Parameters<typeof SaveToLibraryButton>[0]
  publishThreadsText?: string
  children: React.ReactNode
}) {
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      {/* Card header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-muted/30">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">{icon}</span>
          <span className="text-xs font-semibold">{title}</span>
          {count !== undefined && (
            <span className="text-xs text-muted-foreground">({count})</span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {saveProps && <SaveToLibraryButton {...saveProps} />}
          {publishThreadsText && <PublishToThreadsButton text={publishThreadsText} />}
          {copyText && <CopyButton text={copyText} inline />}
        </div>
      </div>

      <div className="p-4">{children}</div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Copy button
// ---------------------------------------------------------------------------

function CopyButton({ text, inline = false }: { text: string; inline?: boolean }) {
  const [copied, setCopied] = useState(false)

  function copy(e: React.MouseEvent) {
    e.stopPropagation()
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  if (inline) {
    return (
      <button
        onClick={copy}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
        <span>{copied ? 'Copied' : 'Copy all'}</span>
      </button>
    )
  }

  return (
    <button
      onClick={copy}
      className={cn(
        'absolute top-2.5 right-2.5 p-1.5 rounded-md transition-all',
        'opacity-0 group-hover:opacity-100',
        'bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground',
      )}
      title="Copy"
    >
      {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
    </button>
  )
}
