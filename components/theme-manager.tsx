'use client'

import { useEffect } from 'react'
import { initTheme } from '@/lib/theme'

export default function ThemeManager() {
  useEffect(() => initTheme(), [])
  return null
}
