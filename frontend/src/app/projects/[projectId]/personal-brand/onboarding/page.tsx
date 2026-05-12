'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { AnimatePresence, motion } from 'framer-motion'
import { Loader2 } from 'lucide-react'
import { api } from '@/lib/api'
import { useAppStore } from '@/stores/app-store'
import type { InterviewQuestion, InterviewNextResponse, PersonalCore } from '@/types'
import { InterviewProgressBar } from '@/components/personal-brand/interview/interview-progress-bar'
import { InterviewModuleIntro } from '@/components/personal-brand/interview/interview-module-intro'
import { InterviewQuestionCard } from '@/components/personal-brand/interview/interview-question-card'
import { InterviewExtractionProgress } from '@/components/personal-brand/interview/interview-extraction-progress'

// Module question counts (matches backend interview_questions.py)
const MODULE_COUNTS: Record<string, number> = { A: 6, B: 5, C: 5, D: 5, E: 3 }

type Stage = 'loading' | 'module_intro' | 'question' | 'extracting' | 'done'

export default function PersonalBrandOnboardingPage() {
  const params = useParams<{ projectId: string }>()
  const router = useRouter()
  const { setPersonalCore, setPersonalVoiceProfile } = useAppStore()

  const [stage, setStage] = useState<Stage>('loading')
  const [currentQuestion, setCurrentQuestion] = useState<InterviewQuestion | null>(null)
  const [answeredCount, setAnsweredCount] = useState(0)
  const [totalCount, setTotalCount] = useState(24)
  const [currentModule, setCurrentModule] = useState('A')
  const [lastModule, setLastModule] = useState('')
  const [answerLoading, setAnswerLoading] = useState(false)
  const [questionInModule, setQuestionInModule] = useState(1)

  const loadNext = useCallback(async (prevModule?: string) => {
    try {
      const res: InterviewNextResponse = await api.persona.getNextQuestion(params.projectId)
      setAnsweredCount(res.answeredCount)
      setTotalCount(res.totalCount)

      if (res.interviewStatus === 'complete' || !res.question) {
        setStage('extracting')
        return
      }

      const q = res.question
      const mod = q.module

      // Count which question within the module this is
      const modStart: Record<string, number> = { A: 0, B: 6, C: 11, D: 16, E: 21 }
      const posInModule = res.answeredCount - modStart[mod] + 1

      setQuestionInModule(Math.max(1, posInModule))
      setCurrentQuestion(q)
      setCurrentModule(mod)

      // Show module intro if we just switched modules
      if (prevModule && prevModule !== mod) {
        setLastModule(mod)
        setStage('module_intro')
      } else {
        setStage('question')
      }
    } catch (e) {
      console.error('Failed to load next question:', e)
      setStage('question') // fallback - don't leave user on loading screen
    }
  }, [params.projectId])

  useEffect(() => {
    async function init() {
      try {
        // Try to get existing core; if 404, init it
        let core: PersonalCore
        try {
          core = await api.persona.getCore(params.projectId)
        } catch {
          core = await api.persona.initCore(params.projectId, { fullName: '' })
        }

        // Already complete → go straight to dashboard
        if (core.interviewStatus === 'complete') {
          router.replace(`/projects/${params.projectId}/personal-brand/dashboard`)
          return
        }

        // In progress or not started - fetch next question
        const res: InterviewNextResponse = await api.persona.getNextQuestion(params.projectId)
        setAnsweredCount(res.answeredCount)
        setTotalCount(res.totalCount)

        if (res.interviewStatus === 'complete' || !res.question) {
          setStage('extracting')
          return
        }

        const q = res.question
        setCurrentQuestion(q)
        setCurrentModule(q.module)

        const modStart: Record<string, number> = { A: 0, B: 6, C: 11, D: 16, E: 21 }
        const pos = res.answeredCount - modStart[q.module] + 1
        setQuestionInModule(Math.max(1, pos))

        // First question ever → show Module A intro
        if (res.answeredCount === 0) {
          setLastModule('A')
          setStage('module_intro')
        } else {
          setStage('question')
        }
      } catch (e) {
        console.error('Failed to initialise interview:', e)
        setStage('question')
      }
    }
    init()
  }, [params.projectId, router])

  async function handleAnswer(answer: string) {
    if (!currentQuestion) return
    setAnswerLoading(true)
    const prevModule = currentModule
    try {
      await api.persona.saveAnswer(params.projectId, currentQuestion.key, answer)
      await loadNext(prevModule)
    } catch (e) {
      console.error('Failed to save answer:', e)
    } finally {
      setAnswerLoading(false)
    }
  }

  async function handleSkip() {
    if (!currentQuestion) return
    const prevModule = currentModule
    // Save an empty answer to mark it skipped, then advance
    try {
      await api.persona.saveAnswer(params.projectId, currentQuestion.key, '')
    } catch {
      // ignore skip errors
    }
    await loadNext(prevModule)
  }

  function handleExtractionDone(core: PersonalCore) {
    setPersonalCore(core)
    // Also load voice profile in the background
    api.persona.getVoice(params.projectId)
      .then(setPersonalVoiceProfile)
      .catch(() => {})
    router.replace(`/projects/${params.projectId}/personal-brand/dashboard`)
  }

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Top bar */}
      <div className="shrink-0 border-b border-border px-6 py-4">
        <div className="max-w-lg mx-auto">
          {stage !== 'loading' && stage !== 'extracting' && (
            <InterviewProgressBar
              currentModule={currentModule}
              answeredCount={answeredCount}
              totalCount={totalCount}
            />
          )}
          {stage === 'loading' && (
            <div className="flex items-center justify-center h-16">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          )}
          {stage === 'extracting' && (
            <div className="flex items-center justify-center h-16">
              <p className="text-sm font-medium text-foreground">Building your Personal Core…</p>
            </div>
          )}
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 overflow-y-auto flex items-start justify-center py-12 px-4">
        <div className="w-full max-w-lg">
          <AnimatePresence mode="wait">
            {stage === 'loading' && (
              <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex justify-center py-20">
                <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
              </motion.div>
            )}

            {stage === 'module_intro' && (
              <motion.div key={`intro-${lastModule}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <InterviewModuleIntro
                  moduleKey={lastModule}
                  questionCount={MODULE_COUNTS[lastModule] ?? 5}
                  onStart={() => setStage('question')}
                />
              </motion.div>
            )}

            {stage === 'question' && currentQuestion && (
              <motion.div key={currentQuestion.key} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <InterviewQuestionCard
                  question={currentQuestion}
                  questionNumber={questionInModule}
                  totalInModule={MODULE_COUNTS[currentModule] ?? 5}
                  onAnswer={handleAnswer}
                  onSkip={handleSkip}
                  loading={answerLoading}
                />
              </motion.div>
            )}

            {stage === 'extracting' && (
              <motion.div key="extracting" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <InterviewExtractionProgress
                  projectId={params.projectId}
                  onDone={handleExtractionDone}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  )
}
