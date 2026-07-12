import type { Config } from 'tailwindcss'
import { colors as t, radii, shadows, typography, spacing } from './lib/design-tokens'

// Helper — reference CSS variable as RGB channel list (Tailwind opacity support)
const v = (name: string) => `rgb(var(--${name}) / <alpha-value>)`

const config: Config = {
  // Agent 148 — also flip the dark variant on [data-theme="dark"] (Grubano DS).
  // ADDITIVE: the existing `.dark` class trigger is preserved; the attribute is inert
  // until a screen sets data-theme, so non-migrated screens are unaffected.
  darkMode: ['class', '[data-theme="dark"]'],
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
          // Partner-role accents (business portal role icons/badges)
          'role-creator':    t.roleCreator,
          'role-logistics':  t.roleLogistics,
          'role-franchise':  t.roleFranchise,
          'role-influencer': t.roleInfluencer,
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

        // ── Stellar Unity — consumer redesign tokens (Agent 128) ──────────
        // ADDITIVE namespace. Maps to the `--st-*` CSS variables defined SCOPED
        // under `.grubano-v2` (app/stellar-theme.css), so these classes only
        // resolve inside that wrapper and NEVER affect the existing app.
        stellar: {
          bg:              'var(--st-background)',
          fg:              'var(--st-foreground)',
          ink:             'var(--st-ink)',
          'surface-1':     'var(--st-surface-1)',
          'surface-2':     'var(--st-surface-2)',
          card:            'var(--st-card)',
          'card-fg':       'var(--st-card-foreground)',
          primary:         'var(--st-primary)',
          'primary-fg':    'var(--st-primary-foreground)',
          'primary-soft':  'var(--st-primary-soft)',
          secondary:       'var(--st-secondary)',
          'secondary-fg':  'var(--st-secondary-foreground)',
          muted:           'var(--st-muted)',
          'muted-fg':      'var(--st-muted-foreground)',
          accent:          'var(--st-accent)',
          'accent-fg':     'var(--st-accent-foreground)',
          destructive:     'var(--st-destructive)',
          'destructive-fg':'var(--st-destructive-foreground)',
          success:         'var(--st-success)',
          warning:         'var(--st-warning)',
          'warning-soft':  'var(--st-warning-soft)',
          info:            'var(--st-info)',
          'info-soft':     'var(--st-info-soft)',
          ai:              'var(--st-ai)',
          'ai-fg':         'var(--st-ai-foreground)',
          'ai-soft':       'var(--st-ai-soft)',
          'destructive-soft': 'var(--st-destructive-soft)',
          border:          'var(--st-border)',
          input:           'var(--st-input)',
          ring:            'var(--st-ring)',
        },

        // ── Grubano Design System v1 (Agent 148) ──────────────────────────
        // ADDITIVE, fully `gb`-namespaced → never clobbers the default keys
        // (colors.accent/success/warning/ring) the non-migrated screens use.
        // Backed by the CSS vars in app/tokens.css. Name by INTENTION in code
        // (bg-gb-surface, text-gb-content, bg-gb-accent-strong) — the raw ramps
        // (gb-zest-*, gb-ink-*…) are only for composing neutrals.
        gb: {
          zest:  { 50:'#FFF3EA',100:'#FFE3CE',200:'#FFC59B',300:'#FFA468',400:'#FF8A3D',500:'#FF6A1F',600:'#F2570E',700:'#C7430A',800:'#963308',900:'#5E2207', DEFAULT:'#FF6A1F' },
          basil: { 50:'#EAF7EF',100:'#CDEBD8',200:'#A2DCBA',300:'#6FCB95',400:'#41BD78',500:'#2BA45C',600:'#1E8C4B',700:'#176E3B',800:'#12552E',900:'#0C3A20', DEFAULT:'#2BA45C' },
          ink:   { 50:'#F1F5FA',100:'#E0E8F1',200:'#BFCDDF',300:'#91A4C0',400:'#5D739B',500:'#36527C',600:'#1E3E60',700:'#163450',800:'#0F2742',900:'#0A1A2C', DEFAULT:'#0F2742' },
          oat:   { 0:'#FFFFFF',50:'#FAF8F4',100:'#F2EEE7',200:'#E7E1D7',300:'#D4CCBE',400:'#ADA496',500:'#837A6C',600:'#5E574B',700:'#423D33',800:'#2A261F',900:'#1A1713', DEFAULT:'#837A6C' },
          surface: { DEFAULT:'var(--surface-bg)', elevated:'var(--surface-elevated)', inverse:'var(--surface-inverse)' },
          content: { DEFAULT:'var(--text-primary)', muted:'var(--text-muted)', 'on-accent':'var(--text-on-accent)' },
          stroke:  { DEFAULT:'var(--border-subtle)', strong:'var(--border-strong)' },
          accent:  { DEFAULT:'var(--accent-primary)', hover:'var(--accent-primary-hover)', strong:'var(--accent-primary-strong)', secondary:'var(--accent-secondary)' },
          success: { DEFAULT:'var(--gb-success)', soft:'var(--gb-success-soft)' },
          warning: { DEFAULT:'var(--gb-warning)', soft:'var(--gb-warning-soft)' },
          error:   { DEFAULT:'var(--gb-error)',   soft:'var(--gb-error-soft)' },
          info:    { DEFAULT:'var(--gb-info)',    soft:'var(--gb-info-soft)' },
          ring:    'var(--gb-ring)',
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
        // Stellar Unity (Agent 128) — additive; values from --st-* (scoped).
        'stellar-soft': 'var(--st-shadow-soft)',
        'stellar-elev': 'var(--st-shadow-elev)',
        'stellar-glow': 'var(--st-shadow-glow)',
        'stellar-ai':   'var(--st-shadow-ai)',
        // Grubano DS v1 (Agent 148) — warm tinted-Ink elevation. gb-prefixed so the
        // default shadow-sm/md/lg (used everywhere) stay untouched.
        'gb-sm':    'var(--shadow-sm)',
        'gb-md':    'var(--shadow-md)',
        'gb-lg':    'var(--shadow-lg)',
        'gb-xl':    'var(--shadow-xl)',
        'gb-glow':  'var(--shadow-glow)',
        'gb-focus': 'var(--focus-ring)',
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
        // Stellar Unity (Agent 128) — additive.
        'stellar-sm':  'var(--st-radius-sm)',
        'stellar-md':  'var(--st-radius-md)',
        'stellar-lg':  'var(--st-radius-lg)',
        'stellar-xl':  'var(--st-radius-xl)',
        'stellar-2xl': 'var(--st-radius-2xl)',
        'stellar-3xl': 'var(--st-radius-3xl)',
        // Grubano DS v1 (Agent 148) — gb-prefixed; default rounded-sm/md/lg/xl untouched.
        'gb-xs':   '6px',
        'gb-sm':   '8px',
        'gb-md':   '12px',
        'gb-lg':   '16px',
        'gb-xl':   '20px',
        'gb-full': '9999px',
      },

      // ── Typography ─────────────────────────────────────────────────────
      fontFamily: {
        sans:    ['Inter', 'system-ui', 'sans-serif'],
        display: ['Space Grotesk', 'system-ui', 'sans-serif'],
        // Stellar Unity (Agent 128) — additive; used inside .grubano-v2 only.
        'stellar-display': ['Plus Jakarta Sans', 'system-ui', 'sans-serif'],
        'stellar-mono':    ['JetBrains Mono', 'ui-monospace', 'monospace'],
        // Grubano DS v1 (Agent 148) — gb-prefixed so the default `sans`/`display`
        // families stay Inter/Space Grotesk on the non-migrated screens.
        'gb-display': ['Gabarito', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        'gb-sans':    ['"Hanken Grotesk"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        'gb-mono':    ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
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
        // Grubano DS v1 (Agent 148) — intent-named type scale (gb-prefixed, all NEW keys).
        'gb-display':  ['60px', { lineHeight: '1.05', letterSpacing: '-0.04em', fontWeight: '800' }],
        'gb-h1':       ['44px', { lineHeight: '1.08', letterSpacing: '-0.03em', fontWeight: '700' }],
        'gb-h2':       ['32px', { lineHeight: '1.15', letterSpacing: '-0.02em', fontWeight: '700' }],
        'gb-h3':       ['24px', { lineHeight: '1.25', letterSpacing: '-0.01em', fontWeight: '600' }],
        'gb-h4':       ['19px', { lineHeight: '1.35', fontWeight: '700' }],
        'gb-body-lg':  ['18px', { lineHeight: '1.6', fontWeight: '400' }],
        'gb-body':     ['16px', { lineHeight: '1.6', fontWeight: '400' }],
        'gb-caption':  ['13px', { lineHeight: '1.4', fontWeight: '500' }],
        'gb-micro':    ['11px', { lineHeight: '1.4', letterSpacing: '0.14em', fontWeight: '600' }],
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
        // Grubano DS v1 (Agent 148) — 4pt scale, gb-prefixed (distinct from grubano-*).
        'gb-1':'var(--space-1)', 'gb-2':'var(--space-2)', 'gb-3':'var(--space-3)', 'gb-4':'var(--space-4)',
        'gb-5':'var(--space-5)', 'gb-6':'var(--space-6)', 'gb-8':'var(--space-8)', 'gb-10':'var(--space-10)', 'gb-12':'var(--space-12)',
      },

      // ── Grubano DS v1 (Agent 148) — sunrise gradient + motion tokens ─────
      // All gb-prefixed / new keys. `screens`, `animation.spin` and the default
      // transition easing are intentionally NOT merged (they would shift the
      // breakpoints / spinner / default easing of the non-migrated screens).
      backgroundImage: {
        'gb-sunrise': 'var(--gradient-sunrise)',
      },
      transitionDuration: {
        'gb-fast': '150ms',
        'gb-base': '200ms',
        'gb-slow': '300ms',
      },
      transitionTimingFunction: {
        'gb-standard': 'cubic-bezier(.4,0,.2,1)',
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
  plugins: [require('tailwindcss-rtl')],
}

export default config
