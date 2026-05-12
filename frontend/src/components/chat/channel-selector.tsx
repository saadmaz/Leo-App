'use client'

import { cn } from '@/lib/utils'

export type ChannelKey =
  | 'instagram'
  | 'linkedin'
  | 'twitter'
  | 'tiktok'
  | 'meta_ads'
  | 'google_ads'
  | 'email'

export interface Channel {
  key: ChannelKey
  label: string
  icon: string
}

export const CHANNELS: Channel[] = [
  { key: 'instagram',  label: 'Instagram',   icon: '📸' },
  { key: 'linkedin',   label: 'LinkedIn',     icon: '💼' },
  { key: 'twitter',    label: 'X / Twitter',  icon: '𝕏' },
  { key: 'tiktok',     label: 'TikTok',       icon: '🎵' },
  { key: 'meta_ads',   label: 'Meta Ads',     icon: '📢' },
  { key: 'google_ads', label: 'Google Ads',   icon: '🔍' },
  { key: 'email',      label: 'Email',        icon: '✉️' },
]

interface ChannelSelectorProps {
  value: ChannelKey | null
  onChange: (channel: ChannelKey | null) => void
}

export function ChannelSelector({ value, onChange }: ChannelSelectorProps) {
  return (
    <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
      <span className="shrink-0 text-xs text-muted-foreground/60 pr-1">Channel:</span>

      {/* "All" pill - clears selection */}
      <button
        onClick={() => onChange(null)}
        className={cn(
          'shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors whitespace-nowrap',
          value === null
            ? 'bg-primary text-primary-foreground'
            : 'bg-muted text-muted-foreground hover:text-foreground hover:bg-muted/80',
        )}
      >
        General
      </button>

      {CHANNELS.map((ch) => (
        <button
          key={ch.key}
          onClick={() => onChange(value === ch.key ? null : ch.key)}
          className={cn(
            'shrink-0 flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors whitespace-nowrap',
            value === ch.key
              ? 'bg-primary text-primary-foreground'
              : 'bg-muted text-muted-foreground hover:text-foreground hover:bg-muted/80',
          )}
        >
          <span>{ch.icon}</span>
          <span>{ch.label}</span>
        </button>
      ))}
    </div>
  )
}
