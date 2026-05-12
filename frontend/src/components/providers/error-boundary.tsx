'use client'

/**
 * React Error Boundary - catches unhandled render errors and shows a
 * fallback UI instead of a blank/crashed screen.
 *
 * React error boundaries must be class components (there is no hook
 * equivalent for componentDidCatch as of React 19). This component wraps
 * the functional-component world and provides a clean escape hatch.
 *
 * Usage:
 *   <ErrorBoundary>
 *     <SomeComponent />
 *   </ErrorBoundary>
 *
 * Or with a custom fallback:
 *   <ErrorBoundary fallback={<MyErrorPage />}>
 *     ...
 *   </ErrorBoundary>
 */

import React from 'react'

interface Props {
  children: React.ReactNode
  /** Optional custom fallback. Defaults to the built-in error card. */
  fallback?: React.ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    // Update state so the next render shows the fallback UI.
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Log to the console in development. In production, send to an error
    // tracking service (Sentry, Datadog RUM, etc.) here.
    console.error('[ErrorBoundary] Uncaught error:', error, info.componentStack)
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null })
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback
      }

      return (
        <div className="flex min-h-screen items-center justify-center bg-background p-6">
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-8 text-center shadow-sm space-y-4">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
              {/* Simple X icon without importing lucide to keep this self-contained */}
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-6 w-6 text-destructive"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>

            <div className="space-y-1">
              <h2 className="text-lg font-semibold">Something went wrong</h2>
              <p className="text-sm text-muted-foreground">
                An unexpected error occurred. Reloading the page usually fixes this.
              </p>
            </div>

            {/* Show error message in development for faster debugging */}
            {process.env.NODE_ENV === 'development' && this.state.error && (
              <pre className="mt-2 rounded-md bg-muted px-3 py-2 text-left text-xs text-muted-foreground overflow-auto max-h-40">
                {this.state.error.message}
              </pre>
            )}

            <div className="flex gap-3 justify-center pt-2">
              <button
                onClick={this.handleReset}
                className="rounded-md border border-border px-4 py-2 text-sm hover:bg-muted transition-colors"
              >
                Try again
              </button>
              <button
                onClick={() => window.location.reload()}
                className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                Reload page
              </button>
            </div>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
