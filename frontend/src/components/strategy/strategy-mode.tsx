'use client'

/**
 * StrategyMode - the full in-chat strategy session orchestrator.
 *
 * Renders into the chat message list based on the current strategySession
 * state from the Zustand store. Each phase renders a different widget:
 *
 *   funnel_select  → <FunnelSelector>
 *   intake         → question text + input (handled by the chat input)
 *   researching    → <ResearchProgress>
 *   generating     → <StrategyStreamPreview>
 *   complete       → <StrategyDocument> + <StrategyActionButtons>
 */

import { useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import Image from 'next/image'
import { api } from '@/lib/api'
import { useAppStore } from '@/stores/app-store'
import { FunnelSelector } from './funnel-selector'
import { QuestionCard } from './question-card'
import { IntakeSummary } from './intake-summary'
import { ResearchProgress } from './research-progress'
import { StrategyDocument, StrategyStreamPreview } from './strategy-document'
import { StrategyActionButtons } from './strategy-action-buttons'
import type { FunnelType, ResearchSearch, ResearchStep } from '@/types'

interface StrategyModeProps {
  projectId: string
  /** Called when the user triggers a follow-up (refine) request. */
  onFollowUp: (message: string) => void
  /** Called to inject a LEO message into the chat list (e.g. first question). */
  onLeoMessage?: (content: string) => void
}

export function StrategyMode({ projectId, onFollowUp, onLeoMessage }: StrategyModeProps) {
  const { strategySession, updateStrategySession, resetStrategySession, user } = useAppStore()
  const abortRef = useRef<AbortController | null>(null)

  // Cleanup on unmount
  useEffect(() => () => { abortRef.current?.abort() }, [])

  if (!strategySession) return null

  // ── Phase: funnel_select ─────────────────────────────────────────────────
  if (strategySession.status === 'intake' && !strategySession.funnelType) {
    return (
      <LeoMessageWrapper>
        <FunnelSelector
          onSelect={(type) => handleFunnelSelect(type)}
          disabled={false}
        />
      </LeoMessageWrapper>
    )
  }

  // ── Phase: intake with question - show QuestionCard with dropdown options ─
  if (strategySession.status === 'intake' && strategySession.funnelType && strategySession.currentQuestion) {
    return (
      <LeoMessageWrapper>
        <QuestionCard
          key={strategySession.currentQuestion.index}
          question={strategySession.currentQuestion}
          questionNumber={strategySession.questionNumber}
          totalQuestions={strategySession.totalQuestions}
          onAnswer={(answer) => handleQuestionAnswer(answer)}
        />
      </LeoMessageWrapper>
    )
  }

  // ── Phase: researching ───────────────────────────────────────────────────
  if (strategySession.status === 'researching') {
    return (
      <LeoMessageWrapper>
        <div className="space-y-4 w-full">
          <IntakeSummary
            qaList={strategySession.intakeQA ?? []}
            userPhotoURL={user?.photoURL}
            userDisplayName={user?.displayName}
          />
          <ResearchProgress
            steps={strategySession.researchSteps}
            searches={strategySession.researchSearches}
          />
        </div>
      </LeoMessageWrapper>
    )
  }

  // ── Phase: generating ────────────────────────────────────────────────────
  if (strategySession.status === 'generating') {
    return (
      <LeoMessageWrapper>
        <div className="space-y-4 w-full">
          <IntakeSummary
            qaList={strategySession.intakeQA ?? []}
            userPhotoURL={user?.photoURL}
            userDisplayName={user?.displayName}
          />
          <StrategyStreamPreview markdown={strategySession.streamedMarkdown} />
        </div>
      </LeoMessageWrapper>
    )
  }

  // ── Phase: complete ──────────────────────────────────────────────────────
  if (strategySession.status === 'complete' && strategySession.savedStrategy) {
    return (
      <LeoMessageWrapper>
        <div className="space-y-4 w-full">
          <IntakeSummary
            qaList={strategySession.intakeQA ?? []}
            userPhotoURL={user?.photoURL}
            userDisplayName={user?.displayName}
          />
          <StrategyDocument strategy={strategySession.savedStrategy} />
          <StrategyActionButtons
            strategy={strategySession.savedStrategy}
            onFollowUp={(msg) => {
              resetStrategySession()
              onFollowUp(msg)
            }}
          />
        </div>
      </LeoMessageWrapper>
    )
  }

  return null

  // ── Handlers ─────────────────────────────────────────────────────────────

  async function handleQuestionAnswer(answer: string) {
    if (!strategySession?.currentQuestion) return

    const questionText = strategySession.currentQuestion.text
    const newQA = [...(strategySession.intakeQA ?? []), { questionText, answer }]

    try {
      const res = await api.strategy.answer(projectId, strategySession.sessionId, {
        question_index: strategySession.currentQuestion.index,
        answer,
      })

      if (res.status === 'research_ready') {
        updateStrategySession({ currentQuestion: null, intakeQA: newQA })
        await runStrategyResearchAndGenerate(projectId, strategySession.sessionId, updateStrategySession)
      } else {
        updateStrategySession({
          currentQuestion: res.next_question ?? null,
          questionNumber: res.question_number ?? strategySession.questionNumber + 1,
          totalQuestions: res.total_questions ?? strategySession.totalQuestions,
          intakeAnswers: {
            ...strategySession.intakeAnswers,
            [`q${strategySession.currentQuestion.index}`]: answer,
          },
          intakeQA: newQA,
        })
      }
    } catch {
      onLeoMessage?.('Something went wrong - please try again.')
    }
  }

  async function handleFunnelSelect(type: FunnelType) {
    if (!strategySession) return

    try {
      const res = await api.strategy.answer(projectId, strategySession.sessionId, {
        question_index: -1,
        answer: type,
        funnel_type: type,
      })

      updateStrategySession({
        funnelType: type,
        currentQuestion: res.next_question ?? null,
        totalQuestions: res.total_questions ?? 6,
        questionNumber: 1,
      })

      // Inject the first question as a chat message
      if (res.next_question) {
        onLeoMessage?.(`**Question 1 of ${res.total_questions ?? 6}**\n\n${res.next_question.text}`)
      }
    } catch {
      // non-critical - user can retry
    }
  }
}

// ── Inline research runner (called from chat page after last answer) ──────
export async function runStrategyResearchAndGenerate(
  projectId: string,
  sessionId: string,
  updateStrategySession: (patch: Partial<import('@/types').StrategySession>) => void,
) {
  // Phase: researching
  updateStrategySession({ status: 'researching', researchSteps: [], researchSearches: [] })

  const steps: ResearchStep[] = []
  const searches: ResearchSearch[] = []

  await api.strategy.streamResearch(
    projectId,
    sessionId,
    (ev) => {
      if (ev.type === 'research_step') {
        const existing = steps.findIndex((s) => s.step === ev.step)
        if (existing >= 0) {
          steps[existing] = { step: ev.step, label: ev.label, status: ev.status }
        } else {
          steps.push({ step: ev.step, label: ev.label, status: ev.status })
        }
        updateStrategySession({ researchSteps: [...steps] })
      } else if (ev.type === 'research_search') {
        const existing = searches.findIndex((s) => s.query === ev.query && s.source === ev.source)
        const item: ResearchSearch = { query: ev.query, source: ev.source, engine: ev.engine, results: ev.results, result_count: ev.result_count, status: ev.status }
        if (existing >= 0) {
          searches[existing] = item
        } else {
          searches.push(item)
        }
        updateStrategySession({ researchSearches: [...searches] })
      }
    },
    () => {
      // research done - move to generating
      updateStrategySession({ status: 'generating', streamedMarkdown: '' })
      runGenerate()
    },
    (msg) => {
      updateStrategySession({ researchSteps: [...steps, { step: 'error', label: `Error: ${msg}`, status: 'skipped' }] })
    },
  )

  async function runGenerate() {
    let md = ''
    await api.strategy.streamGenerate(
      projectId,
      sessionId,
      (text) => {
        md += text
        updateStrategySession({ streamedMarkdown: md })
      },
      (strategyId) => {
        // Strategy saved - fetch it and move to complete
        api.strategy.list(projectId).then((res) => {
          const saved = res.strategies.find((s) => s.id === strategyId)
          if (saved) {
            updateStrategySession({ status: 'complete', savedStrategy: saved })
          }
        })
      },
      () => { /* done */ },
      (msg) => {
        updateStrategySession({ streamedMarkdown: md + `\n\n_Error: ${msg}_` })
      },
    )
  }
}

// ── Wrapper: renders a LEO avatar bubble ──────────────────────────────────

function LeoMessageWrapper({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex gap-3 px-4 py-2 max-w-3xl mx-auto w-full"
    >
      {/* LEO avatar */}
      <div className="w-8 h-8 rounded-lg bg-primary/10 border border-border flex items-center justify-center shrink-0 mt-0.5">
        <Image src="/Leo-agent.png" alt="LEO" width={20} height={20} className="rounded" />
      </div>

      <div className="flex-1 min-w-0">
        {children}
      </div>
    </motion.div>
  )
}
