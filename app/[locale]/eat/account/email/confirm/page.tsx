'use client'

import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useRouter } from '@/navigation'
import { useTranslations } from 'next-intl'
// gb-foundation FIRST (Material `.ms` @import must be the first route-stylesheet rule).
import '@/app/gb-foundation/gb-tokens.css'
import '@/app/gb-foundation/gb-components.css'
import '../../edit/profile-edit.css'

// /eat/account/email/confirm — confirmation landing for the account email change.
// Opened from the link emailed to the NEW address (possibly in a different browser /
// not logged in). Re-skinned to the FROZEN CD design language using the shared
// .gb-profile-edit result states. Material Symbols (not lucide).
//
// 🔒 AUTH-ADJACENT — the confirm FLOW is BYTE-IDENTICAL: same token read from the URL,
// same POST /api/account/email-change/confirm { token }, same status mapping
// (200 → ok, 409 → collision, else invalid). Only markup/CSS + the i18n migration
// (hard-coded `T` literals → t('eat.profileEdit.confirm*')) changed.

function ConfirmInner() {
  const t = useTranslations('eat.profileEdit')
  const params = useSearchParams()
  const router = useRouter()
  const token = params.get('token') ?? ''
  const [state, setState] = useState<'working' | 'ok' | 'invalid' | 'collision'>('working')

  useEffect(() => {
    let cancelled = false
    async function run() {
      if (!token) { setState('invalid'); return }
      try {
        const res = await fetch('/api/account/email-change/confirm', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ token }),
        })
        if (cancelled) return
        if (res.ok) { setState('ok'); return }
        if (res.status === 409) { setState('collision'); return }
        setState('invalid')
      } catch {
        if (!cancelled) setState('invalid')
      }
    }
    run()
    return () => { cancelled = true }
  }, [token])

  return (
    <main className="gb gb-profile-edit">
      <div className="bar">
        <h2>{t('emailTitle')}</h2>
      </div>
      <div className="body">
        {state === 'working' && (
          <div className="result">
            <span className="sk sk-circle" style={{ width: 84, height: 84, marginBottom: 18 }} />
            <h2>{t('confirmWorking')}</h2>
          </div>
        )}

        {state === 'ok' && (
          <div className="result">
            <div className="result__ico ok"><span className="ms" aria-hidden="true">mark_email_read</span></div>
            <h2>{t('confirmOkTitle')}</h2>
            <p>{t('confirmOkBody')}</p>
            <button type="button" className="save" onClick={() => router.push('/eat/auth')}>
              <span className="ms" aria-hidden="true">login</span><b>{t('confirmToAuth')}</b>
            </button>
          </div>
        )}

        {(state === 'invalid' || state === 'collision') && (
          <div className="result">
            <div className="result__ico bad"><span className="ms" aria-hidden="true">{state === 'collision' ? 'block' : 'link_off'}</span></div>
            <h2>{state === 'collision' ? t('confirmTakenTitle') : t('confirmKoTitle')}</h2>
            <p>{state === 'collision' ? t('confirmTakenBody') : t('confirmKoBody')}</p>
            <button type="button" className="save save--line" onClick={() => router.push('/eat/account')}>
              <span className="ms" aria-hidden="true">person</span><b>{t('confirmToAccount')}</b>
            </button>
          </div>
        )}
      </div>
    </main>
  )
}

export default function ConfirmEmailChangePage() {
  return (
    <Suspense fallback={<div className="gb gb-profile-edit"><div className="body" style={{ paddingTop: 40 }}><span className="sk sk-row" /></div></div>}>
      <ConfirmInner />
    </Suspense>
  )
}
