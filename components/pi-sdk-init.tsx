'use client'

import { useEffect } from 'react'
import { preparePiSdk } from '@/components/pi-checkout'

export function PiSdkInit() {
  useEffect(() => {
    void preparePiSdk().catch((error) => {
      console.error('[Pi] SDK init failed', error)
    })
  }, [])
  return null
}
