'use client'

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  APP_LOCALES,
  applyDocumentLocale,
  localeMeta,
  readStoredLocale,
  translate,
  writeStoredLocale,
  type AppLocale,
  type MessageKey,
} from '@/lib/i18n'

type LocaleContextValue = {
  locale: AppLocale
  locales: typeof APP_LOCALES
  setLocale: (next: AppLocale) => void
  t: (key: MessageKey, vars?: Record<string, string>) => string
  current: ReturnType<typeof localeMeta>
}

const LocaleContext = createContext<LocaleContextValue | null>(null)

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<AppLocale>('ko')

  useEffect(() => {
    const next = readStoredLocale()
    setLocaleState(next)
    applyDocumentLocale(next)
  }, [])

  const setLocale = (next: AppLocale) => {
    setLocaleState(next)
    writeStoredLocale(next)
    applyDocumentLocale(next)
  }

  const value = useMemo<LocaleContextValue>(
    () => ({
      locale,
      locales: APP_LOCALES,
      setLocale,
      t: (key, vars) => translate(locale, key, vars),
      current: localeMeta(locale),
    }),
    [locale],
  )

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
}

export function useLocale() {
  const value = useContext(LocaleContext)
  if (!value) {
    return {
      locale: 'ko' as AppLocale,
      locales: APP_LOCALES,
      setLocale: () => undefined,
      t: (key: MessageKey, vars?: Record<string, string>) => translate('ko', key, vars),
      current: localeMeta('ko'),
    }
  }
  return value
}
