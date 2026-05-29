/**
 * Grubano Design Tokens — single source of truth for the brand visual language.
 *
 * Owned by Agent 6 (Design System). Imported by tailwind.config.ts and any
 * component that needs raw values outside the Tailwind class layer.
 *
 * Decision (2026-05-30): unified brand orange is #F97316 — the Bolt-derived
 * primary already shipped on /eat. Replaces the legacy #E8593C used by the
 * operator app. See components/design-system/README.md for migration notes.
 */

export const colors = {
  // ── Brand
  primary:        '#F97316', // signature orange — CTAs, active states, focus rings
  primaryHover:   '#EA6A0C',
  primaryTint:    '#FFF3ED', // very-light orange wash for badges/pills
  primaryRing:    'rgba(249, 115, 22, 0.30)',

  // ── Surfaces
  dark:           '#1a1a2e', // navy — sidebars, headers, dark wallets
  darkElevated:   '#252547',
  background:     '#FAFAFA',
  card:           '#FFFFFF',
  surfaceMuted:   '#F5F5F5',

  // ── Lines & text
  border:         '#EFEFEF',
  borderStrong:   '#E4E4E7',
  ink:            '#1a1a1a',
  inkMuted:       '#6B6B6B',
  inkFaint:       '#9B9B9B',

  // ── Semantic
  success:        '#22C55E',
  successTint:    '#DCFCE7',
  danger:         '#EF4444',
  dangerTint:     '#FEE2E2',
  warning:        '#F59E0B',
  warningTint:    '#FEF3C7',
  info:           '#3B82F6',
  infoTint:       '#DBEAFE',
} as const

export const typography = {
  fontDisplay: "'Space Grotesk', system-ui, sans-serif",
  fontBody:    "'Inter', system-ui, sans-serif",

  sizes: {
    xs:   '0.75rem',  // 12
    sm:   '0.875rem', // 14
    base: '1rem',     // 16
    lg:   '1.125rem', // 18
    xl:   '1.25rem',  // 20
    '2xl':'1.5rem',   // 24
    '3xl':'1.875rem', // 30
    '4xl':'2.25rem',  // 36
    '5xl':'3rem',     // 48
  },

  weights: {
    regular:  400,
    medium:   500,
    semibold: 600,
    bold:     700,
  },

  lineHeights: {
    tight:   1.15,
    snug:    1.3,
    normal:  1.5,
    relaxed: 1.65,
  },
} as const

/** 4-px scale — multiply index by 4 (e.g. spacing[4] = 16px). */
export const spacing = {
  0: '0',
  1: '0.25rem', // 4
  2: '0.5rem',  // 8
  3: '0.75rem', // 12
  4: '1rem',    // 16
  6: '1.5rem',  // 24
  8: '2rem',    // 32
  12:'3rem',    // 48
  16:'4rem',    // 64
} as const

export const radii = {
  sm:   '8px',
  md:   '12px',
  lg:   '16px',
  xl:   '20px',
  '2xl':'28px',
  pill: '9999px',
} as const

export const shadows = {
  sm:      '0 1px 2px rgba(0, 0, 0, 0.04)',
  md:      '0 2px 8px rgba(0, 0, 0, 0.06)',
  lg:      '0 8px 24px rgba(0, 0, 0, 0.08)',
  premium: '0 12px 40px rgba(0, 0, 0, 0.10), 0 2px 8px rgba(0, 0, 0, 0.04)',
  cta:     '0 4px 14px rgba(249, 115, 22, 0.35)',
  ring:    `0 0 0 4px ${colors.primaryRing}`,
} as const

export const designTokens = {
  colors,
  typography,
  spacing,
  radii,
  shadows,
} as const

export type DesignTokens = typeof designTokens
