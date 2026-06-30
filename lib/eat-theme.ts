'use client'

// Consumer theme preference (P1-THEME) — light / dark / auto, persisted in localStorage
// and applied as `data-theme="dark"` on <html> (the gb-foundation + globals already ship
// the `[data-theme="dark"]` rules). DEFAULT = 'light' (no stored value → light, exactly
// today's behaviour — an OS in dark mode does NOT flip the app unless the user picks
// 'auto'/'dark'). A small inline script in the root layout applies the saved theme before
// first paint (no flash); this module is the runtime + the source the account toggle uses.

export type Theme = 'light' | 'dark' | 'auto'

const KEY = 'grubano_theme'
export const THEME_EVENT = 'grubano:theme'

export function getTheme(): Theme {
  if (typeof window === 'undefined') return 'light'
  try {
    const v = localStorage.getItem(KEY)
    return v === 'light' || v === 'dark' || v === 'auto' ? v : 'light'
  } catch {
    return 'light'
  }
}

function systemDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
}

/** Resolve + apply `data-theme` on <html>. 'auto' follows the OS. */
export function applyTheme(t: Theme) {
  if (typeof document === 'undefined') return
  const dark = t === 'dark' || (t === 'auto' && systemDark())
  if (dark) document.documentElement.setAttribute('data-theme', 'dark')
  else document.documentElement.removeAttribute('data-theme')
}

export function setTheme(t: Theme) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(KEY, t)
  } catch {
    /* ignore quota / private-mode errors */
  }
  applyTheme(t)
  window.dispatchEvent(new CustomEvent(THEME_EVENT))
}

/** Re-apply on OS scheme change while in 'auto'. Returns an unsubscribe fn. */
export function watchSystem(): () => void {
  if (typeof window === 'undefined') return () => {}
  const mq = window.matchMedia('(prefers-color-scheme: dark)')
  const handler = () => { if (getTheme() === 'auto') applyTheme('auto') }
  mq.addEventListener('change', handler)
  return () => mq.removeEventListener('change', handler)
}
