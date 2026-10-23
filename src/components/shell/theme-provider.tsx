'use client'

import * as React from 'react'
import { ThemeProvider as NextThemesProvider } from 'next-themes'

export const ACCENT_PALETTES = ['teal', 'emerald', 'amber', 'violet', 'ocean'] as const
export type AccentPalette = (typeof ACCENT_PALETTES)[number]
export const ACCENT_PALETTE_LABELS: Record<AccentPalette, string> = {
  teal: 'Бирюзовая', emerald: 'Изумрудная', amber: 'Янтарная', violet: 'Фиолетовая', ocean: 'Океанская',
}
const ACCENT_PALETTE_STORAGE_KEY = 's2.accent-palette.v1'
const ACCENT_PALETTE_CHANGE_EVENT = 's2-accent-palette-change'
const AccentPaletteContext = React.createContext<{ palette: AccentPalette; setPalette: (palette: AccentPalette) => void } | null>(null)

function readStoredPalette(): AccentPalette {
  if (typeof window === 'undefined') return 'teal'
  try {
    const value = window.localStorage.getItem(ACCENT_PALETTE_STORAGE_KEY)
    return ACCENT_PALETTES.includes(value as AccentPalette) ? value as AccentPalette : 'teal'
  } catch { return 'teal' }
}

function subscribeToPalette(callback: () => void) {
  window.addEventListener('storage', callback)
  window.addEventListener(ACCENT_PALETTE_CHANGE_EVENT, callback)
  return () => {
    window.removeEventListener('storage', callback)
    window.removeEventListener(ACCENT_PALETTE_CHANGE_EVENT, callback)
  }
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const getServerPalette = React.useCallback<() => AccentPalette>(() => 'teal', [])
  const palette = React.useSyncExternalStore(subscribeToPalette, readStoredPalette, getServerPalette)
  React.useEffect(() => {
    document.documentElement.dataset.accentPalette = palette
  }, [palette])
  const setPalette = React.useCallback((next: AccentPalette) => {
    document.documentElement.dataset.accentPalette = next
    try { window.localStorage.setItem(ACCENT_PALETTE_STORAGE_KEY, next) } catch { /* Selection remains active until reload. */ }
    window.dispatchEvent(new Event(ACCENT_PALETTE_CHANGE_EVENT))
  }, [])
  const paletteValue = React.useMemo(() => ({ palette, setPalette }), [palette, setPalette])
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem={false}
      disableTransitionOnChange
    >
      <AccentPaletteContext.Provider value={paletteValue}>{children}</AccentPaletteContext.Provider>
    </NextThemesProvider>
  )
}

export function useAccentPalette() {
  const context = React.useContext(AccentPaletteContext)
  if (!context) throw new Error('useAccentPalette must be used within ThemeProvider')
  return context
}
