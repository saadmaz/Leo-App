'use client'

import { useState, useRef, useEffect } from 'react'
import { Send, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Pillar1Message } from '@/types'

const STAGE_LABELS = [
  'Who are you for?',
  'What problem do you solve?',
  'How are you different?',
  "What's your proof?",
  'Draft statement',
  'Refinement',
  'Final statement',
]

interface PositioningChatProps {
  messages: Pillar1Message[]
  currentStage: number
  isStreaming: boolean
  streamingContent: string
  onSend: (message: string) => void
  className?: string
}

export function PositioningChat({
  messages, currentStage, isStreaming, streamingContent, onSend, className,
}: PositioningChatProps) {
  const [input, setInput] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingContent])

  function handleSend() {
    const text = input.trim()
    if (!text || isStreaming) return
    setInput('')
    onSend(text)
  }

  return (
    <div className={cn('flex flex-col h-full', className)}>
      {/* Stage progress */}
      <div className="px-4 py-3 border-b border-border">
        <div className="flex items-center gap-1.5 mb-2">
          {STAGE_LABELS.map((_, i) => (
            <div
              key={i}
              className={cn(
                'h-1.5 flex-1 rounded-full transition-colors',
                i < currentStage ? 'bg-emerald-500' : i === currentStage ? 'bg-primary' : 'bg-muted',
              )}
            />
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          Stage {currentStage + 1}/7 - <span className="text-foreground font-medium">{STAGE_LABELS[Math.min(currentStage, 6)]}</span>
        </p>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && !isStreaming && (
          <p className="text-sm text-muted-foreground text-center py-8">
            Start your positioning workshop by describing your brand...
          </p>
        )}
        {messages.map((m) => (
          <div
            key={m.id}
            className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}
          >
            <div
              className={cn(
                'max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed',
                m.role === 'user'
                  ? 'bg-primary text-primary-foreground rounded-br-sm'
                  : 'bg-muted rounded-bl-sm',
              )}
            >
              {m.content}
            </div>
          </div>
        ))}
        {isStreaming && streamingContent && (
          <div className="flex justify-start">
            <div className="max-w-[80%] bg-muted rounded-2xl rounded-bl-sm px-4 py-2.5 text-sm leading-relaxed">
              {streamingContent}
              <span className="inline-block w-1 h-3.5 bg-foreground ml-0.5 animate-pulse" />
            </div>
          </div>
        )}
        {isStreaming && !streamingContent && (
          <div className="flex justify-start">
            <div className="bg-muted rounded-2xl rounded-bl-sm px-4 py-2.5">
              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="border-t border-border p-4">
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
            }}
            placeholder="Type your answer..."
            rows={2}
            disabled={isStreaming}
            className="flex-1 resize-none rounded-xl border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || isStreaming}
            className="p-2.5 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors shrink-0"
          >
            {isStreaming ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </button>
        </div>
      </div>
    </div>
  )
}
