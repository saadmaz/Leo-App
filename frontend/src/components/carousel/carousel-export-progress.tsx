'use client'

import { motion } from 'framer-motion'
import { Check, Download, Loader2 } from 'lucide-react'

interface CarouselExportProgressProps {
  current: number
  total: number
  zipUrl?: string | null
  done?: boolean
}

export function CarouselExportProgress({
  current,
  total,
  zipUrl,
  done,
}: CarouselExportProgressProps) {
  const pct = total > 0 ? Math.round((current / total) * 100) : 0

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-xl border border-border bg-card p-4 w-full max-w-sm space-y-3"
    >
      {done ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <Check className="w-4 h-4 text-primary" />
            All {total} slides exported
          </div>
          {zipUrl && (
            <a
              href={zipUrl}
              download
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 w-full px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
            >
              <Download className="w-4 h-4" />
              Download ZIP ({total} slides)
            </a>
          )}
          {!zipUrl && (
            <p className="text-xs text-muted-foreground">
              Slides exported. R2 storage not configured - files are saved locally on the server.
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm text-foreground">
            <Loader2 className="w-4 h-4 text-primary animate-spin" />
            Exporting slide {current} of {total}…
          </div>
          <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
            <motion.div
              className="h-full bg-primary rounded-full"
              initial={{ width: 0 }}
              animate={{ width: `${pct}%` }}
              transition={{ duration: 0.3 }}
            />
          </div>
          <div className="flex justify-between text-[11px] text-muted-foreground">
            <span>{pct}%</span>
            <span>{total - current} remaining</span>
          </div>
        </div>
      )}
    </motion.div>
  )
}
