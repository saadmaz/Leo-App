'use client'

import { useState, useEffect, useRef } from 'react'
import { useParams } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { BookOpen, Upload, Link2, Trash2, Loader2, FileText, Globe } from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/layout/page-header'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { api } from '@/lib/api'

interface KnowledgeDoc {
  id: string
  title: string
  source: string
  contentType: string
  chunkCount: number
  charCount: number
  createdAt: string
}

export default function KnowledgePage() {
  const { projectId } = useParams<{ projectId: string }>()
  const [docs, setDocs] = useState<KnowledgeDoc[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [urlInput, setUrlInput] = useState('')
  const [urlTitle, setUrlTitle] = useState('')
  const [ingestingUrl, setIngestingUrl] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const fetchDocs = async () => {
    try {
      const { documents } = await api.knowledge.list(projectId)
      setDocs(documents)
    } catch {
      toast.error('Failed to load knowledge base')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchDocs() }, [projectId])

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const doc = await api.knowledge.upload(projectId, file)
      setDocs(prev => [doc, ...prev])
      toast.success(`"${doc.title}" added to knowledge base`)
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const handleUrlIngest = async () => {
    if (!urlInput.trim()) return
    setIngestingUrl(true)
    try {
      const doc = await api.knowledge.ingestUrl(projectId, urlInput.trim(), urlTitle.trim() || undefined)
      setDocs(prev => [doc, ...prev])
      setUrlInput('')
      setUrlTitle('')
      toast.success(`"${doc.title}" added to knowledge base`)
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'URL ingestion failed')
    } finally {
      setIngestingUrl(false)
    }
  }

  const handleDelete = async (docId: string, title: string) => {
    try {
      await api.knowledge.delete(projectId, docId)
      setDocs(prev => prev.filter(d => d.id !== docId))
      toast.success(`"${title}" removed`)
    } catch {
      toast.error('Delete failed')
    }
  }

  const formatSize = (chars: number) => {
    if (chars > 10000) return `${Math.round(chars / 1000)}k chars`
    return `${chars} chars`
  }

  return (
    <div className="flex flex-col min-h-screen">
      <PageHeader
        title="Brand Knowledge Base"
        description="Upload brand documents, guidelines, and URLs. Leo retrieves relevant context for every chat."
        icon={<BookOpen className="w-5 h-5" />}
      />

      <div className="flex-1 p-6 max-w-3xl mx-auto w-full space-y-6">

        {/* Upload section */}
        <div className="rounded-lg border border-border bg-card p-5 space-y-4">
          <h2 className="text-sm font-semibold">Add documents</h2>

          {/* File upload */}
          <div>
            <input
              ref={fileRef}
              type="file"
              accept=".txt,.md,.pdf"
              className="hidden"
              onChange={handleFileUpload}
            />
            <Button
              variant="outline"
              className="w-full h-20 border-dashed flex-col gap-2"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
            >
              {uploading ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <Upload className="w-5 h-5 text-muted-foreground" />
              )}
              <span className="text-sm text-muted-foreground">
                {uploading ? 'Uploading...' : 'Upload PDF or text file (max 5 MB)'}
              </span>
            </Button>
          </div>

          {/* URL ingestion */}
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground font-medium">Or import from a URL</p>
            <Input
              placeholder="https://your-brand.com/about"
              value={urlInput}
              onChange={e => setUrlInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleUrlIngest()}
            />
            <Input
              placeholder="Document title (optional)"
              value={urlTitle}
              onChange={e => setUrlTitle(e.target.value)}
              className="text-sm"
            />
            <Button
              onClick={handleUrlIngest}
              disabled={ingestingUrl || !urlInput.trim()}
              size="sm"
              className="w-full"
            >
              {ingestingUrl ? (
                <><Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />Importing...</>
              ) : (
                <><Link2 className="w-3.5 h-3.5 mr-2" />Import URL</>
              )}
            </Button>
          </div>
        </div>

        {/* Document list */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Documents ({docs.length})</h2>
            {docs.length === 0 && !loading && (
              <span className="text-xs text-muted-foreground">No documents yet</span>
            )}
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <AnimatePresence>
              {docs.map(doc => (
                <motion.div
                  key={doc.id}
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, height: 0 }}
                  className="flex items-start gap-3 rounded-lg border border-border bg-card p-4"
                >
                  <div className="mt-0.5 shrink-0">
                    {doc.source === 'upload' ? (
                      <FileText className="w-4 h-4 text-muted-foreground" />
                    ) : (
                      <Globe className="w-4 h-4 text-muted-foreground" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{doc.title}</p>
                    <div className="flex flex-wrap items-center gap-2 mt-1">
                      <Badge variant="outline" className="text-xs">{doc.chunkCount} chunks</Badge>
                      <Badge variant="outline" className="text-xs">{formatSize(doc.charCount)}</Badge>
                      <span className="text-xs text-muted-foreground">
                        {new Date(doc.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                    {doc.source !== 'upload' && (
                      <p className="text-xs text-muted-foreground mt-1 truncate">{doc.source}</p>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-destructive shrink-0"
                    onClick={() => handleDelete(doc.id, doc.title)}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </motion.div>
              ))}
            </AnimatePresence>
          )}
        </div>

        {/* Empty state */}
        {!loading && docs.length === 0 && (
          <div className="rounded-lg border border-dashed border-border p-12 text-center">
            <BookOpen className="w-8 h-8 mx-auto text-muted-foreground mb-3" />
            <p className="text-sm font-medium">No documents yet</p>
            <p className="text-xs text-muted-foreground mt-1">
              Upload brand guidelines, case studies, or messaging docs and Leo will use them in every chat.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
