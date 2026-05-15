'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { BarChart2, Plus, Trash2, Loader2, AlertCircle, CheckCircle2, XCircle, FileText } from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/layout/page-header'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'

interface AuditItem {
  id: string
  label: string
  content: string
}

interface AuditResult {
  id: string | null
  label: string
  content: string
  score: number | null
  grade: string | null
  summary?: string
  strengths?: string[]
  issues?: string[]
  suggestions?: string[]
  on_brand_words?: string[]
  off_brand_words?: string[]
  error?: string
}

interface AuditReport {
  itemCount: number
  scoredCount: number
  averageScore: number | null
  gradeCounts: Record<string, number>
  results: AuditResult[]
}

const GRADE_COLORS: Record<string, string> = {
  A: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  B: 'bg-green-100 text-green-800 border-green-200',
  C: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  D: 'bg-orange-100 text-orange-800 border-orange-200',
  F: 'bg-red-100 text-red-800 border-red-200',
}

const SCORE_BG: Record<string, string> = {
  A: 'bg-emerald-500',
  B: 'bg-green-500',
  C: 'bg-yellow-500',
  D: 'bg-orange-500',
  F: 'bg-red-500',
}

export default function BrandAuditPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const [items, setItems] = useState<AuditItem[]>([{ id: '1', label: '', content: '' }])
  const [running, setRunning] = useState(false)
  const [report, setReport] = useState<AuditReport | null>(null)

  const addItem = () => {
    if (items.length >= 20) return
    setItems(prev => [...prev, { id: Date.now().toString(), label: '', content: '' }])
  }

  const removeItem = (id: string) => {
    if (items.length <= 1) return
    setItems(prev => prev.filter(i => i.id !== id))
  }

  const updateItem = (id: string, field: keyof AuditItem, value: string) => {
    setItems(prev => prev.map(i => i.id === id ? { ...i, [field]: value } : i))
  }

  const runAudit = async () => {
    const valid = items.filter(i => i.content.trim().length >= 10)
    if (valid.length === 0) {
      toast.error('Add at least one content piece (10+ characters)')
      return
    }
    setRunning(true)
    setReport(null)
    try {
      const result = await api.brandAudit.run(projectId, valid.map(i => ({
        id: i.id,
        label: i.label || undefined,
        content: i.content,
      })))
      setReport(result)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Audit failed'
      toast.error(msg)
    } finally {
      setRunning(false)
    }
  }

  const gradeScore = (score: number | null): string => {
    if (score === null) return '?'
    if (score >= 85) return 'A'
    if (score >= 70) return 'B'
    if (score >= 55) return 'C'
    if (score >= 40) return 'D'
    return 'F'
  }

  return (
    <div className="flex flex-col min-h-screen">
      <PageHeader
        title="Brand Audit"
        description="Paste your existing content and get each piece scored against your Brand Core."
        icon={<BarChart2 className="w-5 h-5" />}
      />

      <div className="flex-1 p-6 max-w-4xl mx-auto w-full space-y-6">

        {/* Input section */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">Content to audit ({items.length}/20)</h2>
            <Button variant="outline" size="sm" onClick={addItem} disabled={items.length >= 20}>
              <Plus className="w-3.5 h-3.5 mr-1.5" />
              Add piece
            </Button>
          </div>

          <AnimatePresence>
            {items.map((item, idx) => (
              <motion.div
                key={item.id}
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, height: 0 }}
                className="rounded-lg border border-border bg-card p-4 space-y-3"
              >
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-muted-foreground w-5">{idx + 1}.</span>
                  <Input
                    placeholder="Label (e.g. 'Instagram post — May 14')"
                    value={item.label}
                    onChange={e => updateItem(item.id, 'label', e.target.value)}
                    className="h-8 text-sm"
                  />
                  {items.length > 1 && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
                      onClick={() => removeItem(item.id)}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  )}
                </div>
                <Textarea
                  placeholder="Paste your content here..."
                  value={item.content}
                  onChange={e => updateItem(item.id, 'content', e.target.value)}
                  rows={3}
                  className="text-sm resize-none"
                />
                <p className="text-xs text-muted-foreground text-right">{item.content.length} chars</p>
              </motion.div>
            ))}
          </AnimatePresence>

          <Button onClick={runAudit} disabled={running} className="w-full">
            {running ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Scoring {items.filter(i => i.content.length >= 10).length} pieces...</>
            ) : (
              <><BarChart2 className="w-4 h-4 mr-2" />Run Brand Audit</>
            )}
          </Button>
        </div>

        {/* Results */}
        <AnimatePresence>
          {report && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-6"
            >
              {/* Summary strip */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="rounded-lg border border-border bg-card p-4 text-center">
                  <p className="text-2xl font-bold text-foreground">{report.averageScore ?? '—'}</p>
                  <p className="text-xs text-muted-foreground mt-1">Avg score</p>
                </div>
                <div className="rounded-lg border border-border bg-card p-4 text-center">
                  <p className="text-2xl font-bold text-foreground">{report.scoredCount}</p>
                  <p className="text-xs text-muted-foreground mt-1">Scored</p>
                </div>
                {Object.entries(report.gradeCounts).map(([grade, count]) => (
                  <div key={grade} className={cn('rounded-lg border p-4 text-center', GRADE_COLORS[grade])}>
                    <p className="text-2xl font-bold">{count}</p>
                    <p className="text-xs mt-1">Grade {grade}</p>
                  </div>
                ))}
              </div>

              {/* Individual results */}
              <div className="space-y-4">
                {report.results.map((result, idx) => (
                  <div key={idx} className="rounded-lg border border-border bg-card overflow-hidden">
                    <div className="flex items-center gap-3 p-4 border-b border-border">
                      <div className={cn(
                        'w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm shrink-0',
                        result.grade ? SCORE_BG[result.grade] : 'bg-muted'
                      )}>
                        {result.grade ?? '?'}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{result.label}</p>
                        {result.summary && (
                          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{result.summary}</p>
                        )}
                      </div>
                      {result.score !== null && (
                        <Badge variant="outline" className={cn('text-xs', result.grade ? GRADE_COLORS[result.grade] : '')}>
                          {result.score}/100
                        </Badge>
                      )}
                      {result.error && <AlertCircle className="w-4 h-4 text-destructive shrink-0" />}
                    </div>

                    {/* Score bar */}
                    {result.score !== null && (
                      <div className="h-1 bg-muted">
                        <div
                          className={cn('h-full transition-all', result.grade ? SCORE_BG[result.grade] : 'bg-primary')}
                          style={{ width: `${result.score}%` }}
                        />
                      </div>
                    )}

                    {/* Details */}
                    {(result.strengths?.length || result.issues?.length || result.suggestions?.length) && (
                      <div className="p-4 grid sm:grid-cols-3 gap-4 text-xs">
                        {result.strengths && result.strengths.length > 0 && (
                          <div>
                            <p className="font-semibold text-emerald-700 mb-1.5 flex items-center gap-1">
                              <CheckCircle2 className="w-3 h-3" />Strengths
                            </p>
                            <ul className="space-y-1 text-muted-foreground">
                              {result.strengths.map((s, i) => <li key={i}>· {s}</li>)}
                            </ul>
                          </div>
                        )}
                        {result.issues && result.issues.length > 0 && (
                          <div>
                            <p className="font-semibold text-red-700 mb-1.5 flex items-center gap-1">
                              <XCircle className="w-3 h-3" />Issues
                            </p>
                            <ul className="space-y-1 text-muted-foreground">
                              {result.issues.map((s, i) => <li key={i}>· {s}</li>)}
                            </ul>
                          </div>
                        )}
                        {result.suggestions && result.suggestions.length > 0 && (
                          <div>
                            <p className="font-semibold text-blue-700 mb-1.5 flex items-center gap-1">
                              <FileText className="w-3 h-3" />Suggestions
                            </p>
                            <ul className="space-y-1 text-muted-foreground">
                              {result.suggestions.map((s, i) => <li key={i}>· {s}</li>)}
                            </ul>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
