export const dynamic = 'force-dynamic'

import type { Metadata } from 'next'
import localFont from 'next/font/local'
import { Suspense } from 'react'
import './globals.css'
import { Toaster } from 'sonner'
import ThemeProvider from '@/components/providers/theme-provider'
import { AuthProvider } from '@/components/providers/auth-provider'
import { ErrorBoundary } from '@/components/providers/error-boundary'
import { PostHogProvider } from '@/components/providers/posthog-provider'

const geistSans = localFont({
  src: './fonts/GeistVF.woff',
  variable: '--font-geist-sans',
  weight: '100 900',
})
const geistMono = localFont({
  src: './fonts/GeistMonoVF.woff',
  variable: '--font-geist-mono',
  weight: '100 900',
})

export const metadata: Metadata = {
  title: 'LEO - Your Brand. One Chat. Every Channel.',
  description: 'Brand-aware AI marketing co-pilot. Build your Brand Core and create on-brand campaigns, content, and copy - all in one chat.',
  manifest: '/manifest.json',
  themeColor: '#7c3aed',
  icons: {
    icon: '/Leo.png',
    apple: '/Leo.png',
    shortcut: '/Leo.png',
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'LEO',
  },
  other: {
    'mobile-web-app-capable': 'yes',
  },
  openGraph: {
    type: 'website',
    title: 'LEO - Your Brand. One Chat. Every Channel.',
    description: 'Brand-aware AI marketing co-pilot. Build your Brand Core and create on-brand campaigns, content, and copy - all in one chat.',
    siteName: 'LEO',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'LEO - Your Brand. One Chat. Every Channel.',
    description: 'Brand-aware AI marketing co-pilot. Build your Brand Core and create on-brand campaigns, content, and copy - all in one chat.',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} min-h-screen antialiased font-[family-name:var(--font-geist-sans)] bg-background text-foreground`}
      >
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem disableTransitionOnChange>
          <ErrorBoundary>
            <AuthProvider>
              <Suspense fallback={null}>
                <PostHogProvider>
                  {children}
                </PostHogProvider>
              </Suspense>
            </AuthProvider>
          </ErrorBoundary>
          <Toaster position="bottom-right" richColors closeButton />
        </ThemeProvider>
      </body>
    </html>
  )
}
