import type { Config } from 'tailwindcss'

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

        // Legacy brand aliases kept for backward compat
        grubano: {
          orange:        '#E8593C',
          'orange-hover':'#d44e33',
          marine:        '#1a1a2e',
          'marine-light':'#252547',
        },

        // ── Bolt consumer-app design tokens (/eat only) ──────────────────────
        bolt: {
          primary:     '#F97316',
          'primary-dark': '#EA6A0C',
          tint:        '#FFF3ED',
          ink:         '#1a1a1a',
          bg:          '#f5f5f5',
          surface:     '#ffffff',
          muted:       '#888888',
          faint:       '#aaaaaa',
          line:        '#f0f0f0',
          success:     '#22C55E',
          danger:      '#EF4444',
          'danger-bg': '#FEE2E2',
        },
      },

      // ── Bolt soft shadows (/eat only) ──────────────────────────────────
      boxShadow: {
        'bolt-card': '0 2px 8px rgba(0,0,0,0.06)',
        'bolt-soft': '0 2px 8px rgba(0,0,0,0.05)',
        'bolt-cta':  '0 4px 10px rgba(249,115,22,0.3)',
      },

      // ── Border radius ──────────────────────────────────────────────────
      borderRadius: {
        '3xl': 'calc(var(--radius) + 12px)',
        '2xl': 'calc(var(--radius) + 4px)',
        xl:    'calc(var(--radius))',
        lg:    'calc(var(--radius) - 2px)',
        md:    'calc(var(--radius) - 4px)',
      },

      // ── Typography ─────────────────────────────────────────────────────
      fontFamily: {
        sans:    ['Inter', 'system-ui', 'sans-serif'],
        display: ['Space Grotesk', 'system-ui', 'sans-serif'],
      },

      // ── Animations ─────────────────────────────────────────────────────
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'slide-up': { from: { transform: 'translateY(8px)', opacity: '0' }, to: { transform: 'translateY(0)', opacity: '1' } },
      },
      animation: {
        'fade-in':  'fade-in 0.2s ease-out',
        'slide-up': 'slide-up 0.25s ease-out',
      },
    },
  },
  plugins: [],
}

export default config
