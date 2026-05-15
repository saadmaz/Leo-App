'use client'

import { useEffect } from 'react'
import { onAuthStateChanged } from 'firebase/auth'
import { auth } from '@/lib/firebase'
import { api } from '@/lib/api'
import { useAppStore } from '@/stores/app-store'
import { UpgradeModal } from '@/components/billing/upgrade-modal'
import { ProjectWizard } from '@/components/onboarding/project-wizard'
import { CampaignGenerator } from '@/components/campaigns/campaign-generator'
import { CampaignPanel } from '@/components/campaigns/campaign-panel'
import { ProjectSettingsPanel } from '@/components/projects/project-settings-panel'
import { identifyUser, resetUser } from '@/components/providers/posthog-provider'

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const setUser = useAppStore((s) => s.setUser)
  const setBillingStatus = useAppStore((s) => s.setBillingStatus)
  const upgradeModalOpen = useAppStore((s) => s.upgradeModalOpen)
  const upgradeModalReason = useAppStore((s) => s.upgradeModalReason)
  const closeUpgradeModal = useAppStore((s) => s.closeUpgradeModal)

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      if (firebaseUser) {
        setUser({
          uid: firebaseUser.uid,
          email: firebaseUser.email,
          displayName: firebaseUser.displayName,
          photoURL: firebaseUser.photoURL,
        })
        // Load billing status once on sign-in
        api.billing.status().then(setBillingStatus).catch(() => {})
        // Link PostHog session to this account
        identifyUser(firebaseUser.uid, {
          email: firebaseUser.email,
          name: firebaseUser.displayName,
        })
      } else {
        setUser(null)
        setBillingStatus(null)
        resetUser()
      }
    })
    return unsubscribe
  }, [setUser, setBillingStatus])

  return (
    <>
      {children}
      <UpgradeModal
        open={upgradeModalOpen}
        onClose={closeUpgradeModal}
        reason={upgradeModalReason}
      />
      <ProjectWizard />
      <CampaignGenerator />
      <CampaignPanel />
      <ProjectSettingsPanel />
    </>
  )
}
