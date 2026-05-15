'use client'

import Image from 'next/image'
import { motion } from 'framer-motion'
import type { StrategyQAPair } from '@/types'

interface IntakeSummaryProps {
  qaList: StrategyQAPair[]
  userPhotoURL?: string | null
  userDisplayName?: string | null
}

export function IntakeSummary({ qaList, userPhotoURL, userDisplayName }: IntakeSummaryProps) {
  if (!qaList.length) return null

  const userInitial = userDisplayName?.[0]?.toUpperCase() ?? '?'

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-xl border border-border bg-card/50 p-4 space-y-4 w-full max-w-md"
    >
      <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
        Your answers
      </p>

      <div className="space-y-4">
        {qaList.map((qa, i) => (
          <div key={i} className="space-y-2">
            {/* LEO question */}
            <div className="flex items-start gap-2.5">
              <div className="w-6 h-6 rounded-md bg-primary/10 border border-border flex items-center justify-center shrink-0 mt-0.5">
                <Image src="/Leo.png" alt="LEO" width={14} height={14} className="rounded" />
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed pt-0.5">{qa.questionText}</p>
            </div>

            {/* User answer */}
            <div className="flex items-start gap-2.5 justify-end">
              <div className="bg-primary/10 border border-primary/20 rounded-xl rounded-tr-sm px-3 py-1.5 max-w-[85%]">
                <p className="text-xs text-foreground font-medium leading-relaxed">{qa.answer}</p>
              </div>
              <div className="w-6 h-6 rounded-md overflow-hidden border border-border shrink-0 mt-0.5 flex items-center justify-center bg-muted">
                {userPhotoURL ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={userPhotoURL} alt="You" className="object-cover w-full h-full" referrerPolicy="no-referrer" />
                ) : (
                  <span className="text-[10px] font-bold text-muted-foreground">
                    {userInitial}
                  </span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </motion.div>
  )
}
