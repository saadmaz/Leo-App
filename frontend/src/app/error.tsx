'use client'

import { useEffect } from 'react'
import { AlertTriangle } from 'lucide-react'

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background text-center px-4">
      <div className="w-12 h-12 rounded-2xl bg-destructive/5 border border-destructive/20 flex items-center justify-center mb-6">
        <AlertTriangle className="w-5 h-5 text-destructive" />
      </div>
      <h1 className="text-xl font-semibold mb-2">Something went wrong</h1>
      <p className="text-sm text-muted-foreground mb-8 max-w-xs">
        An unexpected error occurred. Your data is safe - try reloading the page.
      </p>
      <div className="flex gap-3">
        <button
          onClick={reset}
          className="px-5 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          Try again
        </button>
        <a
          href="/"
          className="px-5 py-2.5 rounded-xl border border-border text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          Go home
        </a>
      </div>
    </div>
  )
}
