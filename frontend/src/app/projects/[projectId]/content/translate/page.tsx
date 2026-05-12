'use client'

import { useState, useRef } from 'react'
import { useParams } from 'next/navigation'
import { Globe } from 'lucide-react'
import { toast } from 'sonner'
import { SSEFeaturePage } from '@/components/pillar1/SSEFeaturePage'
import { api } from '@/lib/api'
import { usePillar2Store } from '@/stores/pillar2-store'
import type { TranslatePayload, ProgressStep } from '@/types'

const LANGUAGES = [
  { code: 'AR', name: 'Arabic' }, { code: 'ZH', name: 'Chinese' }, { code: 'CS', name: 'Czech' },
  { code: 'DA', name: 'Danish' }, { code: 'NL', name: 'Dutch' }, { code: 'ET', name: 'Estonian' },
  { code: 'FI', name: 'Finnish' }, { code: 'FR', name: 'French' }, { code: 'DE', name: 'German' },
  { code: 'EL', name: 'Greek' }, { code: 'HU', name: 'Hungarian' }, { code: 'ID', name: 'Indonesian' },
  { code: 'IT', name: 'Italian' }, { code: 'JA', name: 'Japanese' }, { code: 'KO', name: 'Korean' },
  { code: 'NB', name: 'Norwegian' }, { code: 'PL', name: 'Polish' }, { code: 'PT', name: 'Portuguese' },
  { code: 'RO', name: 'Romanian' }, { code: 'RU', name: 'Russian' }, { code: 'SK', name: 'Slovak' },
  { code: 'ES', name: 'Spanish' }, { code: 'SV', name: 'Swedish' }, { code: 'TR', name: 'Turkish' },
  { code: 'UK', name: 'Ukrainian' },
]

export default function TranslatePage() {
  const { projectId } = useParams<{ projectId: string }>()
  const store = usePillar2Store()
  const [content, setContent] = useState('')
  const [sourceLang, setSourceLang] = useState('EN')
  const [targetLangs, setTargetLangs] = useState<string[]>(['ES', 'FR'])
  const [preserveTone, setPreserveTone] = useState(true)
  const [result, setResult] = useState<TranslatePayload | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  function toggleLang(code: string) {
    setTargetLangs((prev) => prev.includes(code) ? prev.filter((l) => l !== code) : [...prev, code])
  }

  async function generate() {
    if (!content.trim()) { toast.error('Content is required'); return }
    if (targetLangs.length === 0) { toast.error('Select at least one target language'); return }
    abortRef.current?.abort()
    abortRef.current = new AbortController()
    store.setIsStreaming(true)
    store.clearSteps()
    store.clearStreamText()
    setResult(null)
    try {
      await api.pillar2.streamTranslate(projectId,
        { content: content.trim(), source_lang: sourceLang, target_langs: targetLangs, preserve_tone: preserveTone },
        {
          onStep: (step, label, status) => store.upsertStep(step, label, status as ProgressStep['status']),
          onDelta: (text) => store.appendStreamText(text),
          onSaved: (_id, payload) => { setResult(payload as unknown as TranslatePayload); store.clearStreamText(); store.setIsStreaming(false); toast.success('Translations ready!') },
          onError: (msg) => { toast.error(msg); store.setIsStreaming(false) },
          onDone: () => store.setIsStreaming(false),
        },
        abortRef.current.signal,
      )
    } catch { store.setIsStreaming(false) }
  }

  const credits = targetLangs.length * 15

  const form = (
    <>
      <h2 className="font-semibold text-sm">Multilingual Adaptation</h2>
      <div>
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Source Content *</label>
        <textarea value={content} onChange={(e) => setContent(e.target.value)} rows={5}
          placeholder="Paste the content you want to translate and adapt..."
          className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary resize-none" />
      </div>
      <div>
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Source Language</label>
        <select value={sourceLang} onChange={(e) => setSourceLang(e.target.value)}
          className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary">
          <option value="EN">English</option>
          {LANGUAGES.filter((l) => l.code !== 'EN').map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
        </select>
      </div>
      <div>
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2 block">Target Languages * ({targetLangs.length} selected)</label>
        <div className="flex flex-wrap gap-1.5">
          {LANGUAGES.map((l) => (
            <button key={l.code} onClick={() => toggleLang(l.code)}
              className={`px-2 py-1 rounded-full text-xs border transition-colors ${targetLangs.includes(l.code) ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground hover:border-primary'}`}>
              {l.name}
            </button>
          ))}
        </div>
      </div>
      <label className="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" checked={preserveTone} onChange={(e) => setPreserveTone(e.target.checked)} className="rounded" />
        <span className="text-sm">Preserve brand tone across languages</span>
      </label>
    </>
  )

  const resultNode = result ? (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-sm">Translations</h2>
        {result.deepl_used && (
          <span className="text-xs bg-blue-500/10 text-blue-600 px-2 py-0.5 rounded-full">DeepL + Claude</span>
        )}
      </div>
      {result.translations?.map((t, i) => (
        <div key={i} className="p-4 rounded-xl border border-border bg-card space-y-3">
          <p className="font-semibold text-sm">{t.lang_name} ({t.lang})</p>
          <p className="text-sm text-muted-foreground whitespace-pre-wrap">{t.translated_content}</p>
          {t.cultural_notes && (
            <p className="text-xs text-muted-foreground/70 italic">🌍 {t.cultural_notes}</p>
          )}
          {t.tone_notes && (
            <p className="text-xs text-muted-foreground/70 italic">🎯 {t.tone_notes}</p>
          )}
        </div>
      ))}
    </div>
  ) : null

  return (
    <SSEFeaturePage projectId={projectId} title="Multilingual Adaptation" subtitle="DeepL + Claude"
      icon={<Globe className="w-4 h-4" />} credits={credits} steps={store.steps}
      isStreaming={store.isStreaming} streamText={store.streamText} form={form} result={resultNode}
      onSubmit={generate} submitLabel={`Translate to ${targetLangs.length} language${targetLangs.length !== 1 ? 's' : ''} - ${credits} credits`}
      canSubmit={!!content.trim() && targetLangs.length > 0} />
  )
}
