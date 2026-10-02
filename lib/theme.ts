export type ThemeMode = 'light' | 'dark' | 'auto'
export type ResolvedTheme = 'light' | 'dark'

export const THEME_KEY = 'taxitago.theme'

// Auto mode: dark between 19:00 and 07:00 local time.
const NIGHT_START = 19
const NIGHT_END = 7

export function loadThemeMode(): ThemeMode {
  if (typeof window === 'undefined') return 'light'
  try {
    const stored = window.localStorage.getItem(THEME_KEY)
    return stored === 'dark' || stored === 'auto' ? stored : 'light'
  } catch {
    return 'light'
  }
}

export function saveThemeMode(mode: ThemeMode) {
  try {
    window.localStorage.setItem(THEME_KEY, mode)
  } catch {
    undefined
  }
}

export function resolveTheme(mode: ThemeMode, date = new Date()): ResolvedTheme {
  if (mode !== 'auto') return mode
  const hour = date.getHours()
  return hour >= NIGHT_START || hour < NIGHT_END ? 'dark' : 'light'
}

export function applyThemeMode(mode: ThemeMode) {
  if (typeof document === 'undefined') return
  const dark = resolveTheme(mode) === 'dark'
  const root = document.documentElement
  root.classList.toggle('dark', dark)
  const scheme = document.querySelector('meta[name="color-scheme"]')
  if (scheme) scheme.setAttribute('content', dark ? 'dark' : 'light only')
  const themeColor = document.querySelector('meta[name="theme-color"]')
  if (themeColor) themeColor.setAttribute('content', dark ? '#0B1220' : '#F8FAFC')
}

/** Applies the saved mode and keeps 'auto' re-evaluating as time passes. */
export function initTheme() {
  const mode = loadThemeMode()
  applyThemeMode(mode)
  const timer = window.setInterval(() => applyThemeMode(loadThemeMode()), 60_000)
  const onStorage = (event: StorageEvent) => {
    if (event.key === THEME_KEY) applyThemeMode(loadThemeMode())
  }
  window.addEventListener('storage', onStorage)
  return () => {
    window.clearInterval(timer)
    window.removeEventListener('storage', onStorage)
  }
}
