'use client'

import { useEffect } from 'react'
import { initPiMainnet } from '@/lib/pi-client'

export function PiSdkInit() {
  useEffect(() => {
    initPiMainnet()
  }, [])
  return null
}
