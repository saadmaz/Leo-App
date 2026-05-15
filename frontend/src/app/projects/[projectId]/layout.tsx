'use client'

import { useParams } from 'next/navigation'
import { Sidebar } from '@/components/layout/sidebar'
import { AnnouncementBanner } from '@/components/layout/announcement-banner'
import { OnboardingGate } from '@/components/onboarding/onboarding-gate'
import { useAppStore } from '@/stores/app-store'

export default function ProjectLayout({ children }: { children: React.ReactNode }) {
  const params = useParams<{ projectId: string }>()
  const { activeProject } = useAppStore()

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      <Sidebar />
      <div className="flex flex-col flex-1 overflow-hidden">
        <AnnouncementBanner />
        {children}
      </div>
      {/* Show onboarding gate for new projects without a Brand Core */}
      {activeProject && params.projectId && activeProject.projectType !== 'personal' && (
        <OnboardingGate
          projectId={params.projectId}
          projectName={activeProject.name ?? 'your project'}
        />
      )}
    </div>
  )
}
