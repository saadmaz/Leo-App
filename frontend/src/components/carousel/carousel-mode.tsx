'use client'

import { useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Layers } from 'lucide-react'
import { useAppStore } from '@/stores/app-store'
import { api } from '@/lib/api'
import type { CarouselIntakeQuestion } from '@/types'
import { CarouselScrapingProgress } from './carousel-scraping-progress'
import { BrandProfileCard } from './brand-profile-card'
import { CarouselIntakeQuestion as IntakeQuestion } from './carousel-intake-question'
import { InstagramFramePreview } from './instagram-frame-preview'
import { CarouselActionBar } from './carousel-action-bar'
import { CarouselExportProgress } from './carousel-export-progress'

interface CarouselModeProps {
  projectId: string
  onLeoMessage: (content: string) => void
}

export function CarouselMode({ projectId, onLeoMessage }: CarouselModeProps) {
  const { carouselSession, updateCarouselSession, resetCarouselSession } = useAppStore()
  const [generationStatus, setGenerationStatus] = useState<string | null>(null)
  const [exportState, setExportState] = useState<{
    running: boolean
    current: number
    total: number
    zipUrl: string | null
    done: boolean
  }>({ running: false, current: 0, total: 0, zipUrl: null, done: false })
  const [editInput, setEditInput] = useState('')
  const [editMode, setEditMode] = useState(false)
  const [continuingToQ1, setContinuingToQ1] = useState(false)
  const [submittingAnswer, setSubmittingAnswer] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  const session = carouselSession
  const scrapingSteps = session?.scrapingSteps ?? []
  const scraping = session?.scraping ?? false
  const brandProfile = session?.brandProfile ?? null
  const currentQuestion = session?.currentQuestion ?? null
  const questionNumber = session?.questionNumber ?? 1
  const totalQuestions = session?.totalQuestions ?? 5
  const status = session?.status ?? 'intake'
  const sessionId = session?.sessionId ?? ''
  const htmlContent = session?.htmlContent ?? ''
  const slideCount = session?.slideCount ?? 0
  const carouselId = session?.carouselId ?? ''
  const intakeAnswers = session?.intakeAnswers ?? {}

  if (!session) return null

  // ── Handle intake answer ────────────────────────────────────────────────
  async function handleAnswer(answer: string) {
    if (!sessionId || !currentQuestion || submittingAnswer) return
    const questionNum = currentQuestion.index

    setSubmittingAnswer(true)
    updateCarouselSession({
      intakeAnswers: { ...intakeAnswers, [`q${questionNum}`]: answer },
    })

    try {
      const res = await api.carousel.submitIntake(projectId, sessionId, questionNum, answer)

      if (res.status === 'ready_to_generate') {
        updateCarouselSession({ status: 'generating', currentQuestion: null })
        onLeoMessage('Got it! Let me generate your carousel now…')
        await startGeneration(sessionId)
      } else if (res.next_question) {
        updateCarouselSession({
          currentQuestion: res.next_question,
          questionNumber: (res.question_number ?? questionNumber + 1),
          totalQuestions: res.total_questions ?? totalQuestions,
        })
      }
    } catch (err) {
      onLeoMessage('Something went wrong. Please try again.')
      console.error(err)
    } finally {
      setSubmittingAnswer(false)
    }
  }

  // ── Generation ──────────────────────────────────────────────────────────
  async function startGeneration(sid: string) {
    abortRef.current = new AbortController()
    setGenerationStatus('Generating your carousel…')

    await api.carousel.generate(
      projectId,
      sid,
      (msg) => setGenerationStatus(msg),
      (carouselId, html, slides, title) => {
        setGenerationStatus(null)
        updateCarouselSession({
          status: 'complete',
          carouselId,
          htmlContent: html,
          slideCount: slides,
        })
        onLeoMessage(`Your carousel is ready - "${title}" (${slides} slides). Use the action bar below to edit or export.`)
      },
      (err) => {
        setGenerationStatus(null)
        onLeoMessage(`Generation failed: ${err}`)
      },
      abortRef.current.signal,
    )
  }

  // ── Export ──────────────────────────────────────────────────────────────
  async function handleExport() {
    if (!carouselId) return
    const format = intakeAnswers?.q2 ?? 'portrait'
    setExportState({ running: true, current: 0, total: slideCount ?? 0, zipUrl: null, done: false })

    await api.carousel.export(
      projectId,
      carouselId,
      format,
      (slide, total) => setExportState((s) => ({ ...s, current: slide, total })),
      (zipUrl, _slideUrls, slideCount) => {
        setExportState({ running: false, current: slideCount, total: slideCount, zipUrl, done: true })
        onLeoMessage(`All ${slideCount} slides exported and ready to download.`)
      },
      (err) => {
        setExportState((s) => ({ ...s, running: false }))
        onLeoMessage(`Export failed: ${err}`)
      },
    )
  }

  // ── Edit slide ──────────────────────────────────────────────────────────
  async function handleEditSubmit() {
    if (!carouselId || !editInput.trim()) return
    const trimmed = editInput.trim()
    setEditInput('')
    setEditMode(false)

    onLeoMessage(`Applying edit: "${trimmed}"…`)
    try {
      // Parse slide number from instruction
      const slideMatch = trimmed.match(/slide\s+(\d+)/i)
      const slideIndex = slideMatch ? parseInt(slideMatch[1]) - 1 : 0

      const res = await api.carousel.editSlide(projectId, carouselId, slideIndex, trimmed)
      updateCarouselSession({ htmlContent: res.updated_html })
      onLeoMessage('Done! Here is the updated carousel.')
    } catch (err) {
      onLeoMessage('Edit failed. Please try again.')
      console.error(err)
    }
  }

  return (
    <div className="w-full space-y-4 mt-2">
      {/* Carousel Studio badge */}
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary/10 border border-primary/20">
          <Layers className="w-3 h-3 text-primary" />
          <span className="text-[11px] font-semibold text-primary uppercase tracking-wide">Carousel Studio</span>
        </div>
      </div>

      {/* Scraping progress */}
      <AnimatePresence>
        {scraping && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <CarouselScrapingProgress steps={scrapingSteps} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Brand profile card */}
      <AnimatePresence>
        {!scraping && brandProfile && status === 'intake' && !currentQuestion && (
          <BrandProfileCard
            brandProfile={brandProfile}
            onContinue={async () => {
              setContinuingToQ1(true)
              try {
                const q1res = await api.carousel.submitIntake(projectId, sessionId, 0, '__init__')
                updateCarouselSession({
                  currentQuestion: q1res.next_question ?? {
                    index: 1,
                    text: 'What type of carousel do you want?',
                  },
                  questionNumber: 1,
                })
              } catch {
                updateCarouselSession({
                  currentQuestion: { index: 1, text: 'What type of carousel do you want?' },
                  questionNumber: 1,
                })
              } finally {
                setContinuingToQ1(false)
              }
            }}
            loading={continuingToQ1}
            onEdit={() => {}}
          />
        )}
      </AnimatePresence>

      {/* Intake question */}
      <AnimatePresence mode="wait">
        {status === 'intake' && currentQuestion && (
          <IntakeQuestion
            key={String(currentQuestion.index)}
            question={currentQuestion as CarouselIntakeQuestion}
            questionNumber={questionNumber}
            totalQuestions={totalQuestions}
            brandProfile={brandProfile}
            disabled={submittingAnswer}
            onAnswer={handleAnswer}
          />
        )}
      </AnimatePresence>

      {/* Generation status */}
      {generationStatus && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex items-center gap-2 text-sm text-muted-foreground"
        >
          <span className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          {generationStatus}
        </motion.div>
      )}

      {/* Instagram preview */}
      <AnimatePresence>
        {status === 'complete' && htmlContent && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-3"
          >
            <InstagramFramePreview
              htmlContent={htmlContent}
              format={(intakeAnswers?.q2 ?? 'portrait') as 'portrait' | 'square' | 'landscape' | 'stories'}
            />

            {/* Edit input */}
            {editMode ? (
              <div className="flex gap-2">
                <input
                  type="text"
                  value={editInput}
                  onChange={(e) => setEditInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleEditSubmit() }}
                  placeholder="e.g. 'Make slide 2 headline shorter' or 'Change style to light'"
                  autoFocus
                  className="flex-1 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
                />
                <button
                  onClick={handleEditSubmit}
                  disabled={!editInput.trim()}
                  className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-40 transition-colors"
                >
                  Apply
                </button>
                <button
                  onClick={() => setEditMode(false)}
                  className="px-3 py-2 rounded-lg border border-border text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  Cancel
                </button>
              </div>
            ) : null}

            {/* Export progress */}
            {(exportState.running || exportState.done) && (
              <CarouselExportProgress
                current={exportState.current}
                total={exportState.total}
                zipUrl={exportState.zipUrl}
                done={exportState.done}
              />
            )}

            {/* Action bar */}
            {!exportState.running && (
              <CarouselActionBar
                onExport={handleExport}
                onEdit={() => setEditMode(true)}
                onRegenerate={() => {
                  resetCarouselSession()
                  onLeoMessage('Session reset. Start a new carousel any time.')
                }}
                onChangeFormat={() => onLeoMessage('Type your format preference, e.g. "switch to square format"')}
                onChangeStyle={() => onLeoMessage('Type your style preference, e.g. "make it light and clean"')}
                onStoriesVersion={() => {
                  if (carouselId) {
                    setExportState({ running: true, current: 0, total: slideCount ?? 0, zipUrl: null, done: false })
                    api.carousel.export(
                      projectId, carouselId, 'stories',
                      (s, t) => setExportState((prev) => ({ ...prev, current: s, total: t })),
                      (zipUrl, _, sc) => setExportState({ running: false, current: sc, total: sc, zipUrl, done: true }),
                      (err) => { setExportState((s) => ({ ...s, running: false })); onLeoMessage(`Stories export failed: ${err}`) },
                    )
                  }
                }}
                onSaveToLibrary={() => onLeoMessage('Saved to your project library.')}
                exporting={exportState.running}
              />
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
