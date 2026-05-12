'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'
import { ArrowRight, SkipForward } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { InterviewQuestion } from '@/types'
import { WritingSamplesInput } from './writing-samples-input'

interface InterviewQuestionCardProps {
  question: InterviewQuestion
  questionNumber: number
  totalInModule: number
  onAnswer: (answer: string) => void
  onSkip?: () => void
  loading?: boolean
}

export function InterviewQuestionCard({
  question,
  questionNumber,
  totalInModule,
  onAnswer,
  onSkip,
  loading,
}: InterviewQuestionCardProps) {
  const [selected, setSelected] = useState<string[]>([])
  const [freeText, setFreeText] = useState('')

  const hasChips = question.chips && question.chips.length > 0
  // Writing samples question gets special treatment
  const isWritingSamples = question.key === 'C_writing_samples'
  function toggleChip(chip: string) {
    setSelected((prev) =>
      prev.includes(chip) ? prev.filter((c) => c !== chip) : [...prev, chip],
    )
  }

  function buildAnswer(): string {
    const parts: string[] = []
    if (selected.length > 0) parts.push(selected.join(', '))
    if (freeText.trim()) parts.push(freeText.trim())
    return parts.join('\n')
  }

  function handleSubmit() {
    const answer = buildAnswer()
    if (!answer) return
    onAnswer(answer)
    setSelected([])
    setFreeText('')
  }

  const canSubmit = selected.length > 0 || freeText.trim().length > 0

  if (isWritingSamples) {
    return (
      <motion.div
        key={question.key}
        initial={{ opacity: 0, x: 30 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: -30 }}
        className="w-full max-w-lg space-y-4"
      >
        <div className="space-y-1">
          <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-wide">
            Question {questionNumber} of {totalInModule}
          </p>
          <h3 className="text-base font-semibold text-foreground">{question.prompt}</h3>
          {question.hint && (
            <p className="text-xs text-muted-foreground">{question.hint}</p>
          )}
        </div>
        <WritingSamplesInput onSubmit={onAnswer} loading={loading} />
        {onSkip && (
          <button
            onClick={onSkip}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors mx-auto"
          >
            <SkipForward className="w-3 h-3" /> Skip for now
          </button>
        )}
      </motion.div>
    )
  }

  return (
    <motion.div
      key={question.key}
      initial={{ opacity: 0, x: 30 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -30 }}
      className="w-full max-w-lg space-y-5"
    >
      {/* Header */}
      <div className="space-y-1">
        <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-wide">
          Question {questionNumber} of {totalInModule}
        </p>
        <h3 className="text-base font-semibold text-foreground leading-snug">{question.prompt}</h3>
        {question.hint && (
          <p className="text-xs text-muted-foreground">{question.hint}</p>
        )}
      </div>

      {/* Chips */}
      {hasChips && (
        <div className="flex flex-wrap gap-2">
          {question.chips.map((chip) => (
            <button
              key={chip}
              onClick={() => toggleChip(chip)}
              disabled={loading}
              className={cn(
                'px-3 py-1.5 rounded-full text-xs font-medium border transition-all',
                selected.includes(chip)
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border text-muted-foreground hover:border-primary/40 hover:text-foreground hover:bg-muted/60',
              )}
            >
              {chip}
            </button>
          ))}
        </div>
      )}

      {/* Textarea - shown for all questions; labelled "or type your own" when chips exist */}
      <div className="space-y-2">
        {hasChips && (
          <p className="text-[11px] text-muted-foreground">Or type your own:</p>
        )}
        <textarea
          value={freeText}
          onChange={(e) => setFreeText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSubmit()
          }}
          placeholder={hasChips ? 'Add anything not listed above…' : 'Type your answer…'}
          rows={hasChips ? 2 : 4}
          disabled={loading}
          className="w-full rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-sm placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-primary/40 resize-none disabled:opacity-50"
        />
        <p className="text-[10px] text-muted-foreground text-right">⌘+Enter to continue</p>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between">
        {onSkip ? (
          <button
            onClick={onSkip}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <SkipForward className="w-3 h-3" /> Skip for now
          </button>
        ) : (
          <span />
        )}
        <button
          onClick={handleSubmit}
          disabled={!canSubmit || loading}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {loading ? 'Saving…' : 'Continue'}
          {!loading && <ArrowRight className="w-4 h-4" />}
        </button>
      </div>
    </motion.div>
  )
}
