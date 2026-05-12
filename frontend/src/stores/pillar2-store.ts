/**
 * Zustand store for Pillar 2 - Content Creation & Management.
 * Mirrors the pillar1-store pattern but isolated to avoid state collisions.
 */

import { create } from 'zustand'
import type { ProgressStep } from '@/types'

export type { ProgressStep }

interface Pillar2State {
  isStreaming: boolean
  setIsStreaming: (v: boolean) => void

  streamText: string
  appendStreamText: (chunk: string) => void
  clearStreamText: () => void

  steps: ProgressStep[]
  upsertStep: (step: string, label: string, status: ProgressStep['status']) => void
  clearSteps: () => void
}

export const usePillar2Store = create<Pillar2State>((set) => ({
  isStreaming: false,
  setIsStreaming: (v) => set({ isStreaming: v }),

  streamText: '',
  appendStreamText: (chunk) => set((s) => ({ streamText: s.streamText + chunk })),
  clearStreamText: () => set({ streamText: '' }),

  steps: [],
  upsertStep: (step, label, status) =>
    set((s) => {
      const existing = s.steps.find((x) => x.step === step)
      if (existing) {
        return { steps: s.steps.map((x) => x.step === step ? { ...x, label, status } : x) }
      }
      return { steps: [...s.steps, { step, label, status }] }
    }),
  clearSteps: () => set({ steps: [] }),
}))
