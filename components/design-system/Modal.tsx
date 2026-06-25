'use client'

/**
 * Modal — responsive dialog.
 *
 * On mobile (<sm), renders as a bottom-sheet that slides up. On desktop, a
 * centred dialog with backdrop. Zero external deps; closes on Esc, backdrop
 * click, or programmatically. Uses a portal so it always renders above app chrome.
 */

import * as React from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

export type ModalSize = 'sm' | 'md' | 'lg'

const SIZES: Record<ModalSize, string> = {
  sm: 'sm:max-w-sm',
  md: 'sm:max-w-md',
  lg: 'sm:max-w-2xl',
}

export interface ModalProps {
  open: boolean
  onClose: () => void
  title?: React.ReactNode
  description?: React.ReactNode
  children?: React.ReactNode
  footer?: React.ReactNode
  /** Hide the default close button. */
  hideClose?: boolean
  /** Disable backdrop click to close. */
  staticBackdrop?: boolean
  size?: ModalSize
  className?: string
  /** Opt-in Grubano DS (gb-) skin — additive, /eat-only (Agent 152). Default
   *  ('grubano') keeps the operator rendering byte-identical. */
  skin?: 'grubano' | 'gb'
}

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  hideClose,
  staticBackdrop,
  size = 'md',
  className,
  skin = 'grubano',
}: ModalProps) {
  const [mounted, setMounted] = React.useState(false)
  React.useEffect(() => setMounted(true), [])

  // Escape key + body scroll lock
  React.useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [open, onClose])

  if (!mounted || !open) return null

  const gb = skin === 'gb'

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={typeof title === 'string' ? 'modal-title' : undefined}
      className="fixed inset-0 z-[90] flex items-end sm:items-center justify-center p-0 sm:p-4"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 animate-fade-in"
        onClick={() => !staticBackdrop && onClose()}
        aria-hidden
      />

      {/* Panel */}
      <div
        className={cn(
          gb
            ? 'relative w-full bg-gb-surface-elevated flex flex-col animate-slide-up'
            : 'relative w-full bg-grubano-surface flex flex-col animate-slide-up',
          // Mobile: full-width bottom-sheet
          gb
            ? 'rounded-t-gb-xl pb-[env(safe-area-inset-bottom)]'
            : 'rounded-t-grubano-2xl pb-[env(safe-area-inset-bottom)]',
          // Desktop: centred card
          gb
            ? 'sm:rounded-gb-xl sm:w-auto sm:max-h-[85vh] sm:shadow-gb-lg'
            : 'sm:rounded-grubano-2xl sm:w-auto sm:max-h-[85vh] sm:shadow-grubano-premium',
          SIZES[size],
          className,
        )}
      >
        {/* Mobile grabber */}
        <div className="sm:hidden flex justify-center pt-2 pb-1" aria-hidden>
          <span className={gb ? 'h-1 w-10 rounded-full bg-gb-stroke-strong' : 'h-1 w-10 rounded-full bg-grubano-border-strong'} />
        </div>

        {(title || !hideClose) && (
          <div className="flex items-start justify-between gap-3 px-5 pt-4 pb-2">
            <div className="flex-1 min-w-0">
              {title && (
                <h2 id="modal-title" className={gb ? 'font-gb-display font-bold text-xl text-gb-content' : 'font-display font-bold text-grubano-xl text-grubano-ink'}>
                  {title}
                </h2>
              )}
              {description && (
                <p className={gb ? 'text-sm text-gb-content-muted mt-1' : 'text-grubano-sm text-grubano-ink-muted mt-1'}>{description}</p>
              )}
            </div>
            {!hideClose && (
              <button
                type="button"
                onClick={onClose}
                aria-label="Fermer"
                className={gb
                  ? 'shrink-0 -mr-1 -mt-1 p-2 rounded-gb-md text-gb-content-muted hover:bg-gb-oat-100'
                  : 'shrink-0 -mr-1 -mt-1 p-2 rounded-grubano-md text-grubano-ink-muted hover:bg-grubano-surface-muted'}
              >
                <X size={20} />
              </button>
            )}
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-5 py-3">{children}</div>

        {footer && (
          <div className={gb
            ? 'px-5 py-4 border-t border-gb-stroke flex flex-col-reverse sm:flex-row sm:justify-end gap-2'
            : 'px-5 py-4 border-t border-grubano-border flex flex-col-reverse sm:flex-row sm:justify-end gap-2'}>
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}

export default Modal
