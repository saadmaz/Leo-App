/**
 * Zustand store for Pillar 1 - Strategy & Planning features.
 * Separate from app-store to keep bundle impact minimal.
 */

import { create } from 'zustand'
import type { Pillar1Doc, Pillar1Message, ProgressStep } from '@/types'

export type { ProgressStep }

interface Pillar1State {
  /** Most recently loaded/generated doc per doc_type */
  activeDocs: Record<string, Pillar1Doc | null>
  setActiveDoc: (docType: string, doc: Pillar1Doc | null) => void

  /** Streaming state */
  isStreaming: boolean
  setIsStreaming: (v: boolean) => void

  /** Streaming delta text (accumulates during SSE) */
  streamText: string
  appendStreamText: (chunk: string) => void
  clearStreamText: () => void

  /** SSE step progress */
  steps: ProgressStep[]
  upsertStep: (step: string, label: string, status: ProgressStep['status']) => void
  clearSteps: () => void

  /** Positioning Workshop session */
  positioningDocId: string | null
  setPositioningDocId: (id: string | null) => void
  positioningStage: number
  setPositioningStage: (stage: number) => void
  positioningMessages: Pillar1Message[]
  setPositioningMessages: (msgs: Pillar1Message[]) => void
  appendPositioningMessage: (msg: Pillar1Message) => void
  positioningStreamText: string
  appendPositioningStreamText: (chunk: string) => void
  clearPositioningStreamText: () => void
}

export const usePillar1Store = create<Pillar1State>((set) => ({
  activeDocs: {},
  setActiveDoc: (docType, doc) =>
    set((s) => ({ activeDocs: { ...s.activeDocs, [docType]: doc } })),

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

  positioningDocId: null,
  setPositioningDocId: (id) => set({ positioningDocId: id }),
  positioningStage: 0,
  setPositioningStage: (stage) => set({ positioningStage: stage }),
  positioningMessages: [],
  setPositioningMessages: (msgs) => set({ positioningMessages: msgs }),
  appendPositioningMessage: (msg) =>
    set((s) => ({ positioningMessages: [...s.positioningMessages, msg] })),
  positioningStreamText: '',
  appendPositioningStreamText: (chunk) =>
    set((s) => ({ positioningStreamText: s.positioningStreamText + chunk })),
  clearPositioningStreamText: () => set({ positioningStreamText: '' }),
}))
