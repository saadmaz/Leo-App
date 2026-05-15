'use client'

import { useEffect, useRef } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'

/**
 * Initialises PostHog once and captures route-change pageviews.
 * Reads NEXT_PUBLIC_POSTHOG_KEY from env — safe to omit in development.
 */
export function PostHogProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const initialised = useRef(false)

  useEffect(() => {
    const key = process.env.NEXT_PUBLIC_POSTHOG_KEY
    if (!key || initialised.current) return

    import('posthog-js').then(({ default: posthog }) => {
      posthog.init(key, {
        api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com',
        capture_pageview: false,      // manual pageviews below
        capture_pageleave: true,
        autocapture: false,           // opt-in — avoids capturing PII in clicks
        persistence: 'localStorage',
        loaded: (ph) => {
          if (process.env.NODE_ENV === 'development') ph.debug()
        },
      })
      initialised.current = true
    })
  }, [])

  // Capture a pageview on every client-side navigation
  useEffect(() => {
    const key = process.env.NEXT_PUBLIC_POSTHOG_KEY
    if (!key || !initialised.current) return

    import('posthog-js').then(({ default: posthog }) => {
      posthog.capture('$pageview', { $current_url: window.location.href })
    })
  }, [pathname, searchParams])

  return <>{children}</>
}

/** Thin helper — import this anywhere to fire a typed event. */
export async function trackEvent(event: string, properties?: Record<string, unknown>) {
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY
  if (!key) return
  const { default: posthog } = await import('posthog-js')
  posthog.capture(event, properties)
}

/** Identify the signed-in user so sessions are linked to an account. */
export async function identifyUser(uid: string, traits?: Record<string, unknown>) {
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY
  if (!key) return
  const { default: posthog } = await import('posthog-js')
  posthog.identify(uid, traits)
}

/** Call on logout to unlink the session from the user. */
export async function resetUser() {
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY
  if (!key) return
  const { default: posthog } = await import('posthog-js')
  posthog.reset()
}
