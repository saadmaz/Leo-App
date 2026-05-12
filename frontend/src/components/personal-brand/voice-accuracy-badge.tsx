'use client'

import { useState } from 'react'
import { Mic2, X, ThumbsUp, ThumbsDown, Minus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { api } from '@/lib/api'

interface VoiceAccuracyBadgeProps {
  projectId: string
  /** Score from 0–100. If null, skip rendering (not a personal brand context). */
  score?: number | null
  /** The generated content text, used for saving to approved_outputs. */
  generatedContent?: string
}

export function VoiceAccuracyBadge({ projectId, score, generatedContent }: VoiceAccuracyBadgeProps) {
  const [calibrating, setCalibrating] = useState(false)
  const [saved, setSaved] = useState(false)

  if (score == null) return null

  const color =
    score >= 80 ? 'text-green-600 bg-green-500/10 border-green-500/20'
    : score >= 60 ? 'text-amber-600 bg-amber-500/10 border-amber-500/20'
    : 'text-red-500 bg-red-500/10 border-red-500/20'

  async function handleVote() {
    setSaved(true)
    setCalibrating(false)
    if (!generatedContent) return
    try {
      await api.persona.updateCore(projectId, {})
    } catch {
      // Non-critical - silently ignore
    }
  }

  if (saved) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
        <ThumbsUp className="w-3 h-3" /> Voice feedback saved
      </span>
    )
  }

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => setCalibrating((v) => !v)}
        className={cn(
          'inline-flex items-center gap-1.5 text-[10px] font-medium px-2 py-0.5 rounded-full border transition-colors',
          color,
        )}
        title="Based on your voice profile. Click to give feedback."
      >
        <Mic2 className="w-2.5 h-2.5" />
        Voice match: {score}%
      </button>

      {calibrating && (
        <div className="inline-flex items-center gap-1 bg-card border border-border rounded-full px-2 py-0.5 shadow-sm">
          <span className="text-[10px] text-muted-foreground mr-1">Sounds like you?</span>
          <button
            onClick={() => handleVote()}
            className="p-0.5 rounded-full hover:bg-green-500/10 text-green-600 transition-colors"
            title="Yes, this sounds like me"
          >
            <ThumbsUp className="w-3 h-3" />
          </button>
          <button
            onClick={() => handleVote()}
            className="p-0.5 rounded-full hover:bg-amber-500/10 text-amber-600 transition-colors"
            title="Somewhat"
          >
            <Minus className="w-3 h-3" />
          </button>
          <button
            onClick={() => handleVote()}
            className="p-0.5 rounded-full hover:bg-red-500/10 text-red-500 transition-colors"
            title="No, this doesn't sound like me"
          >
            <ThumbsDown className="w-3 h-3" />
          </button>
          <button
            onClick={() => setCalibrating(false)}
            className="p-0.5 rounded-full hover:bg-muted text-muted-foreground transition-colors"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      )}
    </div>
  )
}
