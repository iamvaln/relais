// Apparence : le thème du système par défaut, un réglage manuel possible.
// Palette de la marque (landing) : crème, encre, sable, brun, doré. Le mode
// sombre renverse fond et encre ; le doré ne bouge pas. Pur, testé sous Node.

export type ThemePreference = 'system' | 'light' | 'dark'
export type Scheme = 'light' | 'dark'

export const THEME_PREFERENCES: readonly ThemePreference[] = ['system', 'light', 'dark']

export interface Palette {
  /** fond des écrans */
  bg: string
  /** fond des cartes et champs */
  field: string
  /** texte principal */
  ink: string
  /** texte secondaire */
  muted: string
  /** séparateurs et bordures */
  line: string
  /** couleur d'action (boutons, puces) */
  brand: string
  /** texte posé sur `brand` */
  onBrand: string
  /** doré de la transmission, identique dans les deux modes */
  accent: string
  danger: string
}

export const PALETTES: Record<Scheme, Palette> = {
  light: {
    bg: '#faf8f5',
    field: '#f1ebe2',
    ink: '#2a1f12',
    muted: '#7a6a55',
    line: '#e8e1d6',
    brand: '#8b5c2a',
    onBrand: '#faf8f5',
    accent: '#f4a335',
    danger: '#b00020',
  },
  dark: {
    bg: '#1f1a15',
    field: '#2e2620',
    ink: '#f3ede4',
    muted: '#b8a993',
    line: '#3d332a',
    brand: '#d9b07c',
    onBrand: '#1f1a15',
    accent: '#f4a335',
    danger: '#ff7b6b',
  },
}

export function paletteFor(scheme: Scheme): Palette {
  return PALETTES[scheme]
}

/** « système » suit le téléphone ; sans information (ou « unspecified » d'Android), clair. */
export function resolveScheme(preference: ThemePreference, system: string | null | undefined): Scheme {
  if (preference === 'system') return system === 'dark' ? 'dark' : 'light'
  return preference
}

/** Ce qui est stocké sur le device ; tout ce qui n'est pas connu redonne « système ». */
export function parsePreference(raw: string | null | undefined): ThemePreference {
  return raw === 'light' || raw === 'dark' ? raw : 'system'
}
