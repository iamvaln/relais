// Le thème côté React Native : préférence stockée sur le device, schéma du
// téléphone, palette résolue. `useStyles` recalcule les styles d'un écran
// quand la palette change.

import { useMemo } from 'react'
import { useColorScheme } from 'react-native'
import { useStore } from 'zustand'
import { secureStorage } from '@/lib/device'
import { type Palette, type Scheme, type ThemePreference, paletteFor, resolveScheme } from '@/lib/theme'
import { createThemeStore } from '@/state/theme'

export const themeStore = createThemeStore(secureStorage)

export interface Theme {
  scheme: Scheme
  preference: ThemePreference
  colors: Palette
}

export function useTheme(): Theme {
  const preference = useStore(themeStore, (s) => s.preference)
  const system = useColorScheme()
  return useMemo(() => {
    const scheme = resolveScheme(preference, system)
    return { scheme, preference, colors: paletteFor(scheme) }
  }, [preference, system])
}

/** `const styles = useStyles(makeStyles)` avec `makeStyles = (colors: Palette) => StyleSheet.create({ … })`. */
export function useStyles<T>(factory: (colors: Palette) => T): T {
  const { colors } = useTheme()
  return useMemo(() => factory(colors), [factory, colors])
}
