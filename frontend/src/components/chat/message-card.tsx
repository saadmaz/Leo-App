'use client'

import { useState } from 'react'
import Image from 'next/image'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { User, Copy, Check, RefreshCw, ThumbsUp, ThumbsDown, X } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import type { OptimisticMessage } from '@/types'
import { ArtifactCard, parseArtifacts } from './artifact-cards'

interface MessageCardProps {
  message: OptimisticMessage
  isLast?: boolean
  onRegenerate?: () => void
  projectId?: string
}

// ---------------------------------------------------------------------------
// Code block with language badge + copy button
// ---------------------------------------------------------------------------

function CodeBlock({ className, children }: { className?: string; children?: React.ReactNode }) {
  const [copied, setCopied] = useState(false)
  const lang = className?.replace('language-', '') ?? ''

  function handleCopy() {
    const text = typeof children === 'string' ? children : String(children ?? '')
    navigator.clipboard.writeText(text.trimEnd())
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="my-3 rounded-xl overflow-hidden border border-border/60 bg-[#0d0d0d] dark:bg-[#0d0d0d]">
      {/* Header bar */}
      <div className="flex items-center justify-between px-4 py-2 bg-white/[0.04] border-b border-border/40">
        <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">
          {lang || 'code'}
        </span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] text-muted-foreground hover:text-foreground hover:bg-white/10 transition-colors"
        >
          {copied
            ? <><Check className="w-3 h-3 text-emerald-400" /><span className="text-emerald-400">Copied</span></>
            : <><Copy className="w-3 h-3" /><span>Copy</span></>
          }
        </button>
      </div>
      {/* Code body */}
      <code className="block px-4 py-3 text-[13px] font-mono leading-relaxed text-slate-200 overflow-x-auto whitespace-pre">
        {children}
      </code>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Inline code
// ---------------------------------------------------------------------------

function InlineCode({ children }: { children?: React.ReactNode }) {
  return (
    <code className="bg-muted/80 border border-border/50 px-1.5 py-0.5 rounded-md text-[12.5px] font-mono text-foreground">
      {children}
    </code>
  )
}

// ---------------------------------------------------------------------------
// MessageCard
// ---------------------------------------------------------------------------

export function MessageCard({ message, isLast, onRegenerate, projectId }: MessageCardProps) {
  const isAssistant = message.role === 'assistant'
  const [copied, setCopied] = useState(false)
  const [feedback, setFeedback] = useState<'approved' | 'rejected' | null>(null)
  const [showRejectInput, setShowRejectInput] = useState(false)
  const [rejectReason, setRejectReason] = useState('')

  const { clean, artifacts } = isAssistant
    ? parseArtifacts(message.content)
    : { clean: message.content, artifacts: [] }

  function handleCopy() {
    navigator.clipboard.writeText(clean || message.content)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  async function handleApprove() {
    if (!projectId || feedback) return
    setFeedback('approved')
    try {
      await api.memory.feedback(projectId, {
        type: 'approve',
        original: (clean || message.content).slice(0, 500),
      })
    } catch { /* non-critical */ }
  }

  async function handleReject() {
    if (!projectId || feedback) return
    setShowRejectInput(true)
  }

  async function submitReject() {
    if (!projectId) return
    setFeedback('rejected')
    setShowRejectInput(false)
    try {
      await api.memory.feedback(projectId, {
        type: 'reject',
        original: (clean || message.content).slice(0, 500),
        reason: rejectReason || undefined,
      })
      toast.success('Leo will avoid this in future responses.')
    } catch { /* non-critical */ }
    setRejectReason('')
  }

  // -------------------------------------------------------------------------
  // User message
  // -------------------------------------------------------------------------
  if (!isAssistant) {
    return (
      <div className="w-full py-3 flex justify-end px-4">
        <div className="flex items-end gap-3 max-w-[75%]">
          <div className="bg-primary text-primary-foreground px-4 py-3 rounded-2xl rounded-br-sm text-[14.5px] leading-[1.7] whitespace-pre-wrap shadow-sm">
            {message.content}
          </div>
          <div className="w-7 h-7 shrink-0 rounded-full bg-secondary border border-border/40 flex items-center justify-center mb-0.5">
            <User className="w-3.5 h-3.5 text-muted-foreground" />
          </div>
        </div>
      </div>
    )
  }

  // -------------------------------------------------------------------------
  // Assistant message
  // -------------------------------------------------------------------------
  return (
    <div className="w-full py-5 px-4">
      <div className="flex gap-4 max-w-3xl mx-auto">
        {/* Avatar */}
        <div className="w-8 h-8 shrink-0 rounded-xl bg-primary/5 border border-border/50 flex items-center justify-center mt-0.5 overflow-hidden">
          <Image src="/Leo.png" alt="LEO" width={20} height={20} className="rounded-md" />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0 group/msg">
          {(clean || message.pending) && (
            <div className="text-[14.5px] leading-[1.8] text-foreground space-y-0">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  // Code blocks
                  code({ className, children, ...props }) {
                    const isBlock = className?.includes('language-')
                    return isBlock
                      ? <CodeBlock className={className}>{children}</CodeBlock>
                      : <InlineCode {...props}>{children}</InlineCode>
                  },

                  // Paragraphs - generous bottom margin, no top margin
                  p({ children }) {
                    return (
                      <p className="mb-4 last:mb-0 leading-[1.8] text-[14.5px] text-foreground">
                        {children}
                      </p>
                    )
                  },

                  // Unordered list
                  ul({ children }) {
                    return (
                      <ul className="mb-4 last:mb-0 space-y-2 pl-0 list-none">
                        {children}
                      </ul>
                    )
                  },
                  // Ordered list
                  ol({ children }) {
                    return (
                      <ol className="mb-4 last:mb-0 space-y-2 list-none counter-reset-[item] pl-0">
                        {children}
                      </ol>
                    )
                  },
                  li({ ordered, index, children }: { ordered?: boolean; index?: number; children?: React.ReactNode }) {
                    return ordered ? (
                      <li className="flex gap-3 items-start text-[14.5px] leading-[1.8] text-foreground">
                        <span className="shrink-0 min-w-[1.5rem] text-right text-muted-foreground font-medium tabular-nums">
                          {(index ?? 0) + 1}.
                        </span>
                        <span className="flex-1">{children}</span>
                      </li>
                    ) : (
                      <li className="flex gap-3 items-start text-[14.5px] leading-[1.8] text-foreground">
                        <span className="shrink-0 mt-[0.55em] w-[5px] h-[5px] rounded-full bg-foreground/40 flex-none" />
                        <span className="flex-1">{children}</span>
                      </li>
                    )
                  },

                  // Headings - clear hierarchy with generous spacing
                  h1({ children }) {
                    return (
                      <h1 className="text-[20px] font-bold mb-3 mt-7 first:mt-0 text-foreground tracking-tight leading-tight">
                        {children}
                      </h1>
                    )
                  },
                  h2({ children }) {
                    return (
                      <h2 className="text-[17px] font-semibold mb-2.5 mt-6 first:mt-0 text-foreground tracking-tight leading-snug">
                        {children}
                      </h2>
                    )
                  },
                  h3({ children }) {
                    return (
                      <h3 className="text-[15px] font-semibold mb-2 mt-5 first:mt-0 text-foreground leading-snug">
                        {children}
                      </h3>
                    )
                  },
                  h4({ children }) {
                    return (
                      <h4 className="text-[14px] font-semibold mb-1.5 mt-4 first:mt-0 text-foreground/90">
                        {children}
                      </h4>
                    )
                  },

                  // Blockquote
                  blockquote({ children }) {
                    return (
                      <blockquote className="my-4 pl-4 border-l-[3px] border-primary/50 text-foreground/70 text-[14px] leading-[1.8] bg-muted/30 py-2.5 pr-3 rounded-r-lg">
                        {children}
                      </blockquote>
                    )
                  },

                  // Strong / em
                  strong({ children }) {
                    return <strong className="font-semibold text-foreground">{children}</strong>
                  },
                  em({ children }) {
                    return <em className="italic text-foreground/80">{children}</em>
                  },

                  // HR
                  hr() {
                    return <hr className="my-6 border-border/40" />
                  },

                  // Tables - scrollable, clean borders, no text cramming
                  table({ children }) {
                    return (
                      <div className="my-5 w-full overflow-x-auto rounded-xl border border-border/70 shadow-sm">
                        <table className="w-full text-[13.5px] border-collapse">
                          {children}
                        </table>
                      </div>
                    )
                  },
                  thead({ children }) {
                    return (
                      <thead className="bg-muted/60 border-b border-border/70">
                        {children}
                      </thead>
                    )
                  },
                  tbody({ children }) {
                    return (
                      <tbody className="divide-y divide-border/40">
                        {children}
                      </tbody>
                    )
                  },
                  tr({ children }) {
                    return (
                      <tr className="hover:bg-muted/20 transition-colors">
                        {children}
                      </tr>
                    )
                  },
                  th({ children }) {
                    return (
                      <th className="px-4 py-3 text-left font-semibold text-foreground/80 text-[12px] uppercase tracking-wider whitespace-nowrap">
                        {children}
                      </th>
                    )
                  },
                  td({ children }) {
                    return (
                      <td className="px-4 py-3 text-foreground/80 align-top leading-relaxed">
                        {children}
                      </td>
                    )
                  },

                  // Links
                  a({ children, href }) {
                    return (
                      <a
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary underline underline-offset-2 hover:text-primary/80 decoration-primary/40 transition-colors"
                      >
                        {children}
                      </a>
                    )
                  },
                }}
              >
                {clean}
              </ReactMarkdown>

              {/* Streaming cursor */}
              {message.pending && (
                <motion.span
                  animate={{ opacity: [1, 0] }}
                  transition={{ duration: 0.6, repeat: Infinity, ease: 'easeInOut' }}
                  className="inline-block w-[3px] h-[1.1em] ml-0.5 bg-primary/70 rounded-sm align-middle"
                />
              )}
            </div>
          )}

          {/* Artifact cards */}
          {!message.pending && artifacts.map((artifact, i) => (
            <ArtifactCard key={i} artifact={artifact} />
          ))}

          {/* Action bar */}
          {!message.pending && (clean || artifacts.length > 0) && (
            <div className="mt-3 space-y-2">
              <div className={cn(
                'flex items-center gap-0.5 transition-opacity duration-150',
                isLast ? 'opacity-100' : 'opacity-0 group-hover/msg:opacity-100',
              )}>
                {/* Copy */}
                <ActionButton onClick={handleCopy} title="Copy response">
                  {copied
                    ? <><Check className="w-3.5 h-3.5 text-emerald-500" /><span className="text-emerald-500">Copied</span></>
                    : <><Copy className="w-3.5 h-3.5" /><span>Copy</span></>
                  }
                </ActionButton>

                {/* Regenerate */}
                {isLast && onRegenerate && (
                  <ActionButton onClick={onRegenerate} title="Regenerate response">
                    <RefreshCw className="w-3.5 h-3.5" /><span>Retry</span>
                  </ActionButton>
                )}

                {/* Feedback */}
                {projectId && (
                  <div className="flex items-center gap-0.5 ml-auto">
                    <button
                      onClick={handleApprove}
                      title="Good response"
                      className={cn(
                        'p-1.5 rounded-lg text-xs transition-all',
                        feedback === 'approved'
                          ? 'text-emerald-500 bg-emerald-500/10'
                          : 'text-muted-foreground/60 hover:text-emerald-500 hover:bg-emerald-500/10',
                      )}
                    >
                      <ThumbsUp className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={handleReject}
                      title="Bad response"
                      className={cn(
                        'p-1.5 rounded-lg text-xs transition-all',
                        feedback === 'rejected'
                          ? 'text-red-500 bg-red-500/10'
                          : 'text-muted-foreground/60 hover:text-red-500 hover:bg-red-500/10',
                      )}
                    >
                      <ThumbsDown className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>

              {/* Reject reason input */}
              <AnimatePresence>
                {showRejectInput && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="flex items-center gap-1.5"
                  >
                    <input
                      autoFocus
                      value={rejectReason}
                      onChange={e => setRejectReason(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') submitReject()
                        if (e.key === 'Escape') { setShowRejectInput(false); setRejectReason('') }
                      }}
                      placeholder="What was wrong? (optional, press Enter)"
                      className="flex-1 text-xs bg-muted border border-border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-all"
                    />
                    <button
                      onClick={submitReject}
                      className="text-xs px-3 py-1.5 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors font-medium"
                    >
                      Send
                    </button>
                    <button
                      onClick={() => { setShowRejectInput(false); setRejectReason('') }}
                      className="p-1.5 text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted transition-colors"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Small reusable action button
// ---------------------------------------------------------------------------

function ActionButton({ onClick, title, children }: {
  onClick: () => void
  title: string
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12px] text-muted-foreground/70 hover:text-foreground hover:bg-muted transition-all font-medium"
    >
      {children}
    </button>
  )
}
