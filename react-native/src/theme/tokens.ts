// Design tokens ported from the web app's public/css/base.css :root block — that file is the
// single source of truth for colors/fonts on the web side (every other stylesheet just consumes
// these same vars, confirmed by grep). The web app has exactly one theme (dark) — no light-mode
// variant exists anywhere in its CSS — so this is a fixed constant, not a light/dark switcher.
export const colors = {
    bg:         '#131210',
    bgRaised:   '#1b1916',
    bgHover:    '#232119',
    // Sidebar-only chrome color — layout.css's #sidebar/.sidebar-gutter-btn/mobile-overlay all use
    // this literal hex directly (not the --clr-bg var), distinct from and darker than the main
    // content background.
    bgSidebar:  '#0a0908',
    border:     'rgba(255, 255, 255, 0.10)',
    borderHi:   'rgba(255, 255, 255, 0.22)',
    borderAct:  '#c9a84c',
    text:       '#ede9df',
    textMuted:  'rgba(237, 233, 223, 0.38)',
    accent:     '#c9a84c',
    accentBg:   'rgba(201, 168, 76, 0.08)',
    // Secondary accent: emphasis (<em>) and text stripped of an outbound anchor
    // (.gv-keyword). Mirrors --clr-accent-2.
    accent2:    '#e0a996',
    progress:   '#4ecdc4',
    progressBg: 'rgba(78, 205, 196, 0.12)',
} as const

export const fonts = {
    title: 'Cinzel_600SemiBold',
    ui:    'Nunito_400Regular',
    uiBold: 'Nunito_700Bold',
} as const

export const radius = 3 // web: --radius: 3px

// No spacing scale exists on the web side (components use ad hoc px values in each .css file) —
// this is a new convention for the RN app, not a port of an existing token.
export const spacing = {
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 24,
    xxl: 32,
} as const

export const theme = { colors, fonts, radius, spacing } as const
export type Theme = typeof theme
