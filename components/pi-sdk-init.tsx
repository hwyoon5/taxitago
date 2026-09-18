'use client'

import { useEffect } from 'react'
import { initPiMainnet } from '@/lib/pi-client'

export function PiSdkInit() {
  useEffect(() => {
    void initPiMainnet().catch(() => undefined)
  }, [])
  return null
}
