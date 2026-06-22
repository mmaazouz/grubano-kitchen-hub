'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { Card } from '@/components/design-system'
import { MessageCircle, Send, Loader2, Sparkles, X } from 'lucide-react'

// ── OnboardingChat — constrained AI help chat (Agent 97) ──────────────────────────────
// SELF-GATING: probes GET /api/onboarding/chat; renders NOTHING when ONBOARDING_AI_CHAT_ENABLED
// is OFF → the establishment space stays byte-identical. When ON: a small "how-to" assistant
// for the onboarding. History lives IN MEMORY ONLY (component state, never localStorage / no
// server persistence). Each send POSTs the message + the current locale + the in-memory history;
// the SERVER builds the grounded, injection-hardened prompt and calls the LLM gateway. The
// assistant is constrained server-side (refuses legal/fiscal/financial, never quotes a rate).

type Turn = { role: 'user' | 'assistant'; content: string }

export default function OnboardingChat() {
  const t      = useTranslations('onboardingChat')
  const locale = useLocale()
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [open, setOpen]       = useState(false)
  const [turns, setTurns]     = useState<Turn[]>([])
  const [input, setInput]     = useState('')
  const [busy, setBusy]       = useState(false)
  const [error, setError]     = useState('')
  const scrollRef = useRef<HTMLDivElement | null>(null)

  // Flag probe — OFF → render nothing.
  useEffect(() => {
    let cancelled = false
    fetch('/api/onboarding/chat', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { enabled: false }))
      .then((d) => { if (!cancelled) setEnabled(!!d?.enabled) })
      .catch(() => { if (!cancelled) setEnabled(false) })
    return () => { cancelled = true }
  }, [])

  // Auto-scroll the transcript to the latest turn.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [turns, busy])

  if (!enabled) return null

  async function send(e: React.FormEvent) {
    e.preventDefault()
    const message = input.trim()
    if (!message || busy) return
    setError('')
    const nextTurns: Turn[] = [...turns, { role: 'user', content: message }]
    setTurns(nextTurns)
    setInput('')
    setBusy(true)
    try {
      const r = await fetch('/api/onboarding/chat', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        // Send only the prior turns as context (the new message is separate).
        body: JSON.stringify({ message, locale, history: turns.slice(-10) }),
      })
      if (r.status === 401) { window.location.href = '/auth/magic'; return }
      const d = await r.json().catch(() => null)
      if (!r.ok) {
        setError(
          r.status === 429 ? t('errorQuota')
          : r.status === 503 ? t('errorDisabled')
          : (d && (d.error as string)) || t('errorGeneric'),
        )
        return
      }
      const reply = typeof d?.reply === 'string' && d.reply.trim() ? d.reply.trim() : t('errorEmpty')
      setTurns((cur) => [...cur, { role: 'assistant', content: reply }])
    } catch {
      setError(t('errorGeneric'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card elevation="sm" padding="md" className="mb-4 border border-grubano-primary/25 bg-gradient-to-br from-grubano-tint/40 to-white">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 text-start"
      >
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-grubano-lg bg-grubano-primary text-white">
          <MessageCircle size={16} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold text-grubano-ink">{t('title')}</span>
          <span className="block text-[12px] text-grubano-ink-muted">{t('subtitle')}</span>
        </span>
        {open
          ? <X size={16} className="shrink-0 text-grubano-ink-faint" />
          : <Sparkles size={16} className="shrink-0 text-grubano-primary" />}
      </button>

      {open && (
        <div className="mt-3">
          {/* Transcript (in-memory only) */}
          <div
            ref={scrollRef}
            className="max-h-72 space-y-2 overflow-y-auto rounded-grubano-md bg-grubano-surface-muted/40 p-3"
          >
            {turns.length === 0 && (
              <p className="px-1 py-2 text-[13px] text-grubano-ink-muted">{t('greeting')}</p>
            )}
            {turns.map((m, i) => (
              <div key={i} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                <div
                  className={
                    m.role === 'user'
                      ? 'max-w-[85%] whitespace-pre-wrap rounded-grubano-md bg-grubano-primary px-3 py-2 text-[13px] text-white'
                      : 'max-w-[85%] whitespace-pre-wrap rounded-grubano-md bg-white px-3 py-2 text-[13px] text-grubano-ink shadow-grubano-sm'
                  }
                >
                  {m.content}
                </div>
              </div>
            ))}
            {busy && (
              <div className="flex justify-start">
                <div className="inline-flex items-center gap-1.5 rounded-grubano-md bg-white px-3 py-2 text-[13px] text-grubano-ink-muted shadow-grubano-sm">
                  <Loader2 size={13} className="animate-spin" /> {t('thinking')}
                </div>
              </div>
            )}
          </div>

          {error && (
            <p className="mt-2 rounded-grubano-md border border-grubano-danger/30 bg-grubano-danger-tint px-3 py-2 text-[12px] text-grubano-danger">
              {error}
            </p>
          )}

          <form onSubmit={send} className="mt-2 flex items-end gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(e) } }}
              rows={1}
              maxLength={1000}
              placeholder={t('placeholder')}
              disabled={busy}
              className="min-h-[40px] flex-1 resize-none rounded-grubano-md border border-grubano-border bg-grubano-surface px-3 py-2 text-[13px] text-grubano-ink outline-none transition focus:border-grubano-primary disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={busy || !input.trim()}
              aria-label={t('send')}
              className="grid h-10 w-10 shrink-0 place-items-center rounded-grubano-md bg-grubano-primary text-white transition-colors hover:bg-grubano-primaryHover disabled:opacity-50"
            >
              {busy ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} className="rtl:-scale-x-100" />}
            </button>
          </form>

          {/* Governance disclaimer — sets expectations: help with onboarding, not legal/fiscal/financial advice. */}
          <p className="mt-2 text-[11px] leading-snug text-grubano-ink-faint">{t('disclaimer')}</p>
        </div>
      )}
    </Card>
  )
}
