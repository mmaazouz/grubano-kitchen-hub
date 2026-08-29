'use client'

import './magic.css'
// gb-* design FOUNDATION (Agent 168) — the screens are built from its primitives
// (.gb-brand, .hero, .btn--primary/.btn--white, .tip, .spin, .dots, .hero-ico). `.gb`-scoped.
import '@/app/gb-foundation/gb-tokens.css'
import '@/app/gb-foundation/gb-components.css'
import { Suspense, useCallback, useEffect, useState, type ReactNode } from 'react'
import { useSearchParams } from 'next/navigation'
import { signIn } from 'next-auth/react'
import { useLocale, useTranslations } from 'next-intl'
import { useRouter } from '@/navigation'
import { postLoginPath } from '@/lib/post-login-redirect'
import { requestMagicLink, type MagicLinkFailure } from '@/lib/magic-link-client'

// ── /eat/magic — CONSUMER passwordless magic-link screens (gated /eat) ─────────
//
// Two screens, reproducing the FROZEN CD refs with the gb-* foundation:
//   • "Check your email" (sent)      → reached from /eat/auth's magic CTA. The email
//     is handed over in sessionStorage; this page fires POST /api/auth/magic-link with
//     space:'eat' so the EMAILED link points back to /eat/magic (consumer "Signing in").
//   • "Signing you in…" (verifying)  → ?token present → signIn('credentials',{magicToken})
//     then route by role (consumer → /eat). The token mechanism (lib/magic-link, the verify
//     CredentialsProvider) is UNCHANGED — only the consumer skin + routing are added.
//
// The shared /auth/magic (operator/business) page is left BYTE-IDENTICAL.

const EMAIL_KEY = 'gb_magic_email'

function MagicInner() {
  const params = useSearchParams()
  const token = params.get('token')
  const router = useRouter()
  const locale = useLocale()
  const t = useTranslations('eat.auth')

  const [phase, setPhase] = useState<'verifying' | 'sent' | 'error'>(token ? 'verifying' : 'sent')
  const [email, setEmail] = useState('')
  // Échec de TRANSPORT du mint (429 / 5xx / réseau) : l'écran « vérifiez votre boîte »
  // devient un état honnête + Réessayer (fini le faux « envoyé » — reality check 2026-08-29).
  const [sendFail, setSendFail] = useState<MagicLinkFailure | null>(null)
  const [resending, setResending] = useState(false)

  const fireSend = useCallback(async (addr: string) => {
    setResending(true)
    // 2xx reste générique (anti-énumération) ; seuls les échecs de transport sont montrés.
    const res = await requestMagicLink(addr, { locale, space: 'eat' })
    setSendFail(res.ok ? null : res.reason)
    setResending(false)
  }, [locale])

  // No token → "Check your email": take the email from /eat/auth (sessionStorage), fire the
  // link with space:'eat', then show the screen (or the honest failure state).
  // No email in context (direct navigation) → back to /eat/auth.
  useEffect(() => {
    if (token) return
    const stored = typeof window !== 'undefined' ? sessionStorage.getItem(EMAIL_KEY) : null
    if (!stored) { router.replace('/eat/auth'); return }
    setEmail(stored)
    void fireSend(stored)
  }, [token, router, fireSend])

  // Token present → verify, then route by role (consumer → /eat).
  useEffect(() => {
    if (!token) return
    let cancelled = false
    ;(async () => {
      const res = await signIn('credentials', { magicToken: token, redirect: false })
      if (cancelled) return
      if (res?.ok) {
        const session = await fetch('/api/auth/session', { cache: 'no-store' }).then((r) => r.json()).catch(() => null)
        const role = (session?.user as { role?: string } | undefined)?.role
        router.push(postLoginPath(role))
      } else {
        setPhase('error')
      }
    })()
    return () => { cancelled = true }
  }, [token, router])

  function goBack() {
    if (typeof window !== 'undefined') sessionStorage.removeItem(EMAIL_KEY)
    router.push('/eat/auth')
  }
  function openMailApp() {
    // Best-effort: launch the device mail client (no reliable cross-client "inbox" deep-link).
    if (typeof window !== 'undefined') { try { window.location.href = 'mailto:' } catch { /* noop */ } }
  }

  const emailValue = email || '…'
  const bold = (chunks: ReactNode) => <b>{chunks}</b>

  return (
    <>
      {/* ════ DESKTOP (≥768px) — brand panel left + centered card right ════ */}
      <div className="gb eat-magic">
        <aside className="gb-brand">
          <div className="gb-brand__logo">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/grubano-symbol-white.svg" alt="Grubano" />
            <b>Grubano</b>
          </div>
          <div className="gb-brand__pitch">
            <h2 style={{ color: '#fff' }}>{phase === 'verifying' ? t('magicBrandVerifyingTitle') : t('panelTitle')}</h2>
            <p>{phase === 'verifying' ? t('magicBrandVerifyingBody') : sendFail ? t(sendFail === 'rate_limited' ? 'magicSendFailRate' : 'magicSendFailDown') : t('magicBrandSentBody')}</p>
          </div>
          <div className="gb-brand__meta">
            {phase === 'verifying' ? (
              <span><span className="ms" style={{ fontSize: '17px', color: '#41BD78' }} aria-hidden="true">lock</span>{t('magicMetaEncrypted')}</span>
            ) : (
              <>
                <span><span className="ms" style={{ fontSize: '17px', color: '#41BD78' }} aria-hidden="true">verified_user</span>{t('metaSecure')}</span>
                <span><span className="ms" style={{ fontSize: '17px', color: '#FF9A4D' }} aria-hidden="true">bolt</span>{t('metaPasswordless')}</span>
              </>
            )}
          </div>
        </aside>

        <section className="eat-magic__panel">
          {phase === 'verifying' ? (
            <div className="eat-magic__card" role="status" aria-live="polite">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="landing-logo" src="/brand/grubano-symbol-color.svg" alt="Grubano" />
              <div className="spin" aria-hidden="true" />
              <h1 className="title">{t('magicVerifyingTitle')}</h1>
              <p className="sub">{t('magicVerifyingBody')}</p>
              <div className="dots" aria-hidden="true"><i /><i /><i /></div>
            </div>
          ) : phase === 'error' ? (
            <div className="eat-magic__card" role="alert">
              <div className="hero"><span className="ms" aria-hidden="true">link_off</span></div>
              <h1 className="title">{t('magicErrorTitle')}</h1>
              <p className="sub">{t('magicErrorBody')}</p>
              <button className="btn btn--primary" type="button" onClick={goBack}>{t('magicErrorCta')}</button>
            </div>
          ) : sendFail ? (
            <div className="eat-magic__card" role="alert">
              <div className="hero"><span className="ms" aria-hidden="true">error</span></div>
              <h1 className="title">{t('magicSendFailTitle')}</h1>
              <p className="sub">{t(sendFail === 'rate_limited' ? 'magicSendFailRate' : 'magicSendFailDown')}</p>
              <button className="btn btn--primary" type="button" disabled={resending} onClick={() => { if (email) void fireSend(email) }}>
                <span className="ms" style={{ fontSize: '19px' }} aria-hidden="true">refresh</span>{t('magicSendFailRetry')}
              </button>
              <p className="linkback">{t('magicWrongAddress')}{' '}
                {/* eslint-disable-next-line jsx-a11y/anchor-is-valid */}
                <a href="#" onClick={(e) => { e.preventDefault(); goBack() }}>{t('magicGoBack')}</a>
              </p>
            </div>
          ) : (
            <div className="eat-magic__card">
              <div className="hero"><span className="ms" aria-hidden="true">mark_email_unread</span></div>
              <h1 className="title">{t('magicCheckTitle')}</h1>
              <p className="sub">{t.rich('magicCheckBody', { email: emailValue, b: bold })}</p>
              <button className="btn btn--primary" type="button" onClick={openMailApp}>
                <span className="ms" style={{ fontSize: '19px' }} aria-hidden="true">mail</span>{t('magicOpenMail')}
              </button>
              <p className="linkback">{t('magicWrongAddress')}{' '}
                {/* eslint-disable-next-line jsx-a11y/anchor-is-valid */}
                <a href="#" onClick={(e) => { e.preventDefault(); goBack() }}>{t('magicGoBack')}</a>
              </p>
            </div>
          )}
          {phase === 'sent' && !sendFail && (
            <div className="tip">
              <span className="ms" aria-hidden="true">auto_awesome</span>
              <span>{t('magicSmartTip')}</span>
              <span className="soon">{t('magicAiSoon')}</span>
            </div>
          )}
        </section>
      </div>

      {/* ════ MOBILE (<768px) — single centered column ════ */}
      <div className="gb eat-magic-mobile">
        <div className="screen__bar" />
        {phase === 'verifying' ? (
          <div className="screen__body center" role="status" aria-live="polite">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="landing-logo" src="/brand/grubano-symbol-color.svg" alt="Grubano" />
            <div className="spin" aria-hidden="true" />
            <h1 className="title">{t('magicVerifyingTitle')}</h1>
            <p className="sub">{t('magicVerifyingBody')}</p>
          </div>
        ) : phase === 'error' ? (
          <div className="screen__body center" role="alert">
            <div className="hero-ico"><span className="ms" aria-hidden="true">link_off</span></div>
            <h1 className="title">{t('magicErrorTitle')}</h1>
            <p className="sub">{t('magicErrorBody')}</p>
            <button className="btn btn--primary" type="button" onClick={goBack}>{t('magicErrorCta')}</button>
          </div>
        ) : sendFail ? (
          <div className="screen__body center" role="alert">
            <div className="spacer" />
            <div className="hero-ico"><span className="ms" aria-hidden="true">error</span></div>
            <h1 className="title">{t('magicSendFailTitle')}</h1>
            <p className="sub">{t(sendFail === 'rate_limited' ? 'magicSendFailRate' : 'magicSendFailDown')}</p>
            <button className="btn btn--primary" type="button" disabled={resending} onClick={() => { if (email) void fireSend(email) }} style={{ marginBottom: '10px' }}>
              <span className="ms" style={{ fontSize: '18px' }} aria-hidden="true">refresh</span>{t('magicSendFailRetry')}
            </button>
            <p className="resend">{t('magicWrongAddress')}{' '}
              <b onClick={goBack} role="button" tabIndex={0} style={{ cursor: 'pointer' }} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); goBack() } }}>{t('magicGoBack')}</b>
            </p>
            <div className="spacer" />
          </div>
        ) : (
          <div className="screen__body center">
            <div className="spacer" />
            <div className="hero-ico"><span className="ms" aria-hidden="true">mark_email_unread</span></div>
            <h1 className="title">{t('magicCheckTitle')}</h1>
            <p className="sub">{t.rich('magicCheckBody', { email: emailValue, b: bold })}</p>
            <button className="btn btn--white" type="button" onClick={openMailApp} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '8px', marginBottom: '10px' }}>
              <span className="ms" style={{ fontSize: '18px' }} aria-hidden="true">mail</span>{t('magicOpenMail')}
            </button>
            <p className="resend">{t('magicWrongAddress')}{' '}
              {/* eslint-disable-next-line jsx-a11y/anchor-is-valid */}
              <b onClick={goBack} role="button" tabIndex={0} style={{ cursor: 'pointer' }} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); goBack() } }}>{t('magicGoBack')}</b>
            </p>
            <div className="spacer" />
            <div className="tipbar">
              <span className="ms" aria-hidden="true">auto_awesome</span>
              <span>{t('magicSmartTip')}</span>
              <span className="ai-soon">{t('magicAiSoon')}</span>
            </div>
          </div>
        )}
      </div>
    </>
  )
}

export default function EatMagicPage() {
  // useSearchParams must sit under a Suspense boundary (Next.js 14 App Router).
  return (
    <Suspense fallback={null}>
      <MagicInner />
    </Suspense>
  )
}
