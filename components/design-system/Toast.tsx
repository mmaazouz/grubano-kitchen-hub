'use client'

/**
 * Toast — design-system notification primitive.
 *
 * Provides a context provider + hook + portal. Keeps zero external deps so it
 * works everywhere (operator app & consumer /eat). Auto-dismiss with configurable
 * duration; tap-to-dismiss; stacked from the bottom on mobile, top-right on desktop.
 *
 * Usage:
 *   <ToastProvider>...</ToastProvider>           // mount once near root
 *   const { toast } = useToast()
 *   toast.success('Commande passée')
 *   toast.error('Adresse manquante', { description: '...' })
 */

import * as React from 'react'
import { createPortal } from 'react-dom'
import { CheckCircle2, AlertTriangle, Info, X, XCircle } from 'lucide-react'
import { cn } from '@/lib/utils'

export type ToastVariant = 'success' | 'error' | 'warning' | 'info'

export interface ToastOptions {
  description?: string
  durationMs?: number
}

interface ToastItem extends ToastOptions {
  id: number
  variant: ToastVariant
  title: string
}

interface ToastApi {
  success: (title: string, opts?: ToastOptions) => void
  error:   (title: string, opts?: ToastOptions) => void
  warning: (title: string, opts?: ToastOptions) => void
  info:    (title: string, opts?: ToastOptions) => void
  dismiss: (id: number) => void
}

const ToastCtx = React.createContext<ToastApi | null>(null)

let nextId = 0

const VARIANT_STYLES: Record<ToastVariant, { ring: string; icon: React.ReactNode }> = {
  success: { ring: 'border-grubano-success', icon: <CheckCircle2 className="text-grubano-success" size={20} /> },
  error:   { ring: 'border-grubano-danger',  icon: <XCircle      className="text-grubano-danger"  size={20} /> },
  warning: { ring: 'border-grubano-warning', icon: <AlertTriangle className="text-grubano-warning" size={20} /> },
  info:    { ring: 'border-grubano-info',    icon: <Info          className="text-grubano-info"    size={20} /> },
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = React.useState<ToastItem[]>([])
  const [mounted, setMounted] = React.useState(false)
  React.useEffect(() => setMounted(true), [])

  const dismiss = React.useCallback((id: number) => {
    setItems((s) => s.filter((t) => t.id !== id))
  }, [])

  const push = React.useCallback((variant: ToastVariant, title: string, opts?: ToastOptions) => {
    const id = ++nextId
    const duration = opts?.durationMs ?? 4000
    setItems((s) => [...s, { id, variant, title, ...opts }])
    if (duration > 0) {
      window.setTimeout(() => dismiss(id), duration)
    }
  }, [dismiss])

  const api = React.useMemo<ToastApi>(() => ({
    success: (t, o) => push('success', t, o),
    error:   (t, o) => push('error',   t, o),
    warning: (t, o) => push('warning', t, o),
    info:    (t, o) => push('info',    t, o),
    dismiss,
  }), [push, dismiss])

  return (
    <ToastCtx.Provider value={api}>
      {children}
      {mounted &&
        createPortal(
          <div
            className={cn(
              'fixed z-[100] flex flex-col gap-2 pointer-events-none',
              // Mobile: bottom-center stack
              'bottom-4 left-4 right-4 items-stretch',
              // Desktop: top-right
              'sm:top-4 sm:right-4 sm:bottom-auto sm:left-auto sm:items-end sm:w-[360px]',
            )}
            role="region"
            aria-label="Notifications"
          >
            {items.map((t) => (
              <ToastCard key={t.id} item={t} onDismiss={() => dismiss(t.id)} />
            ))}
          </div>,
          document.body,
        )}
    </ToastCtx.Provider>
  )
}

function ToastCard({ item, onDismiss }: { item: ToastItem; onDismiss: () => void }) {
  const v = VARIANT_STYLES[item.variant]
  return (
    <div
      role="status"
      className={cn(
        'pointer-events-auto bg-grubano-surface rounded-grubano-lg shadow-grubano-premium',
        'border-l-4 px-4 py-3 flex items-start gap-3 animate-slide-up',
        v.ring,
      )}
    >
      <span className="shrink-0 mt-0.5">{v.icon}</span>
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-grubano-sm text-grubano-ink">{item.title}</p>
        {item.description && (
          <p className="text-grubano-xs text-grubano-ink-muted mt-0.5">{item.description}</p>
        )}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Fermer"
        className="shrink-0 -mr-1 p-1 rounded-grubano-sm text-grubano-ink-muted hover:bg-grubano-surface-muted"
      >
        <X size={16} />
      </button>
    </div>
  )
}

export function useToast(): ToastApi {
  const ctx = React.useContext(ToastCtx)
  if (!ctx) {
    throw new Error('useToast must be used inside <ToastProvider>')
  }
  return ctx
}

export default ToastProvider
