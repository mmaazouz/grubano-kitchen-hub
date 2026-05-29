import type { Config } from 'tailwindcss'
import { colors as t, radii, shadows, typography, spacing } from './lib/design-tokens'

// Helper — reference CSS variable as RGB channel list (Tailwind opacity support)
const v = (name: string) => `rgb(var(--${name}) / <alpha-value>)`

const config: Config = {
  darkMode: ['class'],
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      // ── Semantic colors (mapped to CSS variables) ──────────────────────
      colors: {
        background:  v('background'),
        foreground:  v('foreground'),

        card:        { DEFAULT: v('card'),    foreground: v('card-foreground') },
        popover:     { DEFAULT: v('popover'), foreground: v('popover-foreground') },
        primary:     { DEFAULT: v('primary'), foreground: v('primary-foreground') },
        secondary:   { DEFAULT: v('secondary'), foreground: v('secondary-foreground') },
        muted:       { DEFAULT: v('muted'),   foreground: v('muted-foreground') },
        accent:      { DEFAULT: v('accent'),  foreground: v('accent-foreground') },
        destructive: { DEFAULT: v('destructive'), foreground: v('destructive-foreground') },
        success:     { DEFAULT: v('success'), foreground: v('success-foreground') },
        warning:     { DEFAULT: v('warning'), foreground: v('warning-foreground') },
        border:      v('border'),
        input:       v('input'),
        ring:        v('ring'),

        navy: {
          DEFAULT:    v('navy'),
          elevated:   v('navy-elevated'),
          foreground: v('navy-foreground'),
        },

        // ── Unified Grubano design-system tokens (Agent 6) ────────────────
        // Single source: lib/design-tokens.ts. Use these in all new code.
        grubano: {
          primary:        t.primary,
          primaryHover:   t.primaryHover,
          tint:           t.primaryTint,
          dark:           t.dark,
          darkElevated:   t.darkElevated,
          bg:             t.background,
          surface:        t.card,
          'surface-muted':t.surfaceMuted,
          border:         t.border,
          'border-strong':t.borderStrong,
          ink:            t.ink,
          'ink-muted':    t.inkMuted,
          'ink-faint':    t.inkFaint,
          success:        t.success,
          'success-tint': t.successTint,
          danger:         t.danger,
          'danger-tint':  t.dangerTint,
          warning:        t.warning,
          'warning-tint': t.warningTint,
          info:           t.info,
          'info-tint':    t.infoTint,
          // Legacy operator-app aliases (kept for backward compat with
          // existing /dashboard code — do not use in new components)
          orange:         t.primary,
          'orange-hover': t.primaryHover,
          marine:         t.dark,
          'marine-light': t.darkElevated,
        },

        // ── Bolt consumer-app tokens (kept — used heavily by /eat) ────────
        // Aliased to the unified palette so the brand stays single-source.
        bolt: {
          primary:        t.primary,
          'primary-dark': t.primaryHover,
          tint:           t.primaryTint,
          ink:            t.ink,
          bg:             t.surfaceMuted,
          surface:        t.card,
          muted:          t.inkMuted,
          faint:          t.inkFaint,
          line:           t.border,
          success:        t.success,
          danger:         t.danger,
          'danger-bg':    t.dangerTint,
        },
      },

      // ── Shadows ────────────────────────────────────────────────────────
      boxShadow: {
        'grubano-sm':      shadows.sm,
        'grubano-md':      shadows.md,
        'grubano-lg':      shadows.lg,
        'grubano-premium': shadows.premium,
        'grubano-cta':     shadows.cta,
        // Legacy bolt aliases (kept — many /eat pages reference these)
        'bolt-card': shadows.md,
        'bolt-soft': shadows.md,
        'bolt-cta':  shadows.cta,
      },

      // ── Border radius ──────────────────────────────────────────────────
      borderRadius: {
        '3xl': 'calc(var(--radius) + 12px)',
        '2xl': 'calc(var(--radius) + 4px)',
        xl:    'calc(var(--radius))',
        lg:    'calc(var(--radius) - 2px)',
        md:    'calc(var(--radius) - 4px)',
        'grubano-sm':   radii.sm,
        'grubano-md':   radii.md,
        'grubano-lg':   radii.lg,
        'grubano-xl':   radii.xl,
        'grubano-2xl':  radii['2xl'],
        'grubano-pill': radii.pill,
      },

      // ── Typography ─────────────────────────────────────────────────────
      fontFamily: {
        sans:    ['Inter', 'system-ui', 'sans-serif'],
        display: ['Space Grotesk', 'system-ui', 'sans-serif'],
      },

      fontSize: {
        'grubano-xs':   typography.sizes.xs,
        'grubano-sm':   typography.sizes.sm,
        'grubano-base': typography.sizes.base,
        'grubano-lg':   typography.sizes.lg,
        'grubano-xl':   typography.sizes.xl,
        'grubano-2xl':  typography.sizes['2xl'],
        'grubano-3xl':  typography.sizes['3xl'],
        'grubano-4xl':  typography.sizes['4xl'],
        'grubano-5xl':  typography.sizes['5xl'],
      },

      spacing: {
        'grubano-1':  spacing[1],
        'grubano-2':  spacing[2],
        'grubano-3':  spacing[3],
        'grubano-4':  spacing[4],
        'grubano-6':  spacing[6],
        'grubano-8':  spacing[8],
        'grubano-12': spacing[12],
        'grubano-16': spacing[16],
      },

      // ── Animations ─────────────────────────────────────────────────────
      keyframes: {
        'fade-in':  { from: { opacity: '0' }, to: { opacity: '1' } },
        'slide-up': { from: { transform: 'translateY(8px)', opacity: '0' }, to: { transform: 'translateY(0)', opacity: '1' } },
        'pulse-soft': {
          '0%, 100%': { opacity: '1' },
          '50%':      { opacity: '0.6' },
        },
        'shimmer': {
          '0%':   { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
      },
      animation: {
        'fade-in':    'fade-in 0.2s ease-out',
        'slide-up':   'slide-up 0.25s ease-out',
        'pulse-soft': 'pulse-soft 2s ease-in-out infinite',
        'shimmer':    'shimmer 1.6s linear infinite',
      },
    },
  },
  plugins: [],
}

export default config
