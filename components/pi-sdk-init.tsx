'use client'

import { useEffect } from 'react'
import { preparePiSdk } from '@/components/pi-checkout'

export function PiSdkInit() {
  useEffect(() => {
    void preparePiSdk().catch((error) => {
      console.error('[Pi] SDK init failed', error, {
        sandboxHint: 'developer portal testnet → Pi.init({ version: "2.0", sandbox: true })',
      })
    })
  }, [])
  return null
}
