'use client'

import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/navigation'
import { showToast } from '@/lib/eat-cart'
// gb-foundation FIRST: gb-tokens.css opens with `@import …Material+Symbols…`, valid
// only when it is the route stylesheet's first rule — keep it before page CSS so the
// `.ms` icon ligatures don't fall back to raw text.
import '@/app/gb-foundation/gb-tokens.css'
import '@/app/gb-foundation/gb-components.css'
import './profile-edit.css'

// /eat/account/edit — « Modifier mon profil » (consumer). VERBATIM reproduction of the
// FROZEN CD ref (Notion 38efd2c9-…-6ffe25, file eat/edit-profile.html). Renders INSIDE
// the EatShell nav shell (page CONTENT only — never duplicates the rail/topbar/botnav).
// Material Symbols (not lucide); --gb-* tokens; design CSS in profile-edit.css.
//
// REAL DATA: identity (name / email) comes from useSession(). Phone + avatar have no
// source in the Operator session, so they are display-only placeholders.
//
// ⚠️ PERSISTENCE GAP (reported): there is NO consumer profile-update endpoint in the app
// (no /api/account update route — only the email-change + password-reset flows exist).
// So « Enregistrer » does NOT persist name/phone/avatar — it surfaces a « bientôt » toast
// and the form is visual. The email row links to the REAL /eat/account/email flow; the
// password row links to the REAL /eat/account/password screen; « Supprimer mon compte »
// is also inert (no delete-account endpoint) → « bientôt » toast.

export default function EditProfileScreen() {
  const t = useTranslations('eat.profileEdit')
  const router = useRouter()
  const { data: session, status } = useSession()

  const sessionName = (session?.user?.name as string | undefined) ?? ''
  const sessionEmail = (session?.user?.email as string | undefined) ?? ''

  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/eat/auth')
  }, [status, router])

  useEffect(() => {
    if (status === 'authenticated') setName(sessionName)
  }, [status, sessionName])

  const initials =
    (sessionName || sessionEmail).split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || '🙂'

  // No update endpoint → visual save (reported gap).
  const onSave = () => showToast(t('saveSoon'))

  // ── Loading skeleton (foundation .sk primitive) ────────────────────────────
  if (status === 'loading') {
    return (
      <div className="gb gb-profile-edit">
        <div className="bar">
          <button type="button" className="back" onClick={() => router.back()} aria-label={t('back')}>
            <span className="ms" aria-hidden="true">arrow_back</span>
          </button>
          <h2>{t('title')}</h2>
        </div>
        <div className="body">
          <span className="sk sk-circle sk-ava" />
          <span className="sk sk-row" />
          <span className="sk sk-row" />
          <span className="sk sk-row" />
        </div>
      </div>
    )
  }

  return (
    <main className="gb gb-profile-edit">
      <div className="bar">
        <button type="button" className="back" onClick={() => router.back()} aria-label={t('back')}>
          <span className="ms" aria-hidden="true">arrow_back</span>
        </button>
        <h2>{t('title')}</h2>
      </div>

      <div className="body">
        {/* avatar (display-only — no avatar source / upload endpoint) */}
        <div className="ava">
          <div className="ph">
            {initials}
            <button type="button" className="cam" aria-label={t('changePhoto')} onClick={() => showToast(t('photoSoon'))}>
              <span className="ms" aria-hidden="true">photo_camera</span>
            </button>
          </div>
          <button type="button" className="ch" onClick={() => showToast(t('photoSoon'))}>{t('changePhoto')}</button>
        </div>

        {/* ─── Informations ─── */}
        <p className="lbl">{t('sectionInfo')}</p>
        <div className="grid2">
          <div className="pe-field">
            <span>{t('fullName')}</span>
            <div className="ctrl">
              <span className="ms" aria-hidden="true">person</span>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('fullNamePh')} autoComplete="name" />
            </div>
          </div>
          <div className="pe-field">
            <span>{t('phone')}</span>
            <div className="ctrl">
              <span className="ms" aria-hidden="true">phone</span>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder={t('phonePh')} inputMode="tel" autoComplete="tel" />
            </div>
          </div>
        </div>

        <div className="pe-field">
          <span>{t('email')}</span>
          <div className="ctrl">
            <span className="ms" aria-hidden="true">mail</span>
            <input value={sessionEmail} readOnly aria-label={t('email')} />
            <button type="button" className="act" onClick={() => router.push('/eat/account/email')}>{t('emailEdit')}</button>
          </div>
          <p className="hlp">{t('emailHint')}</p>
        </div>

        {/* ─── Sécurité ─── */}
        <p className="lbl">{t('sectionSecurity')}</p>
        <button type="button" className="linkrow" onClick={() => router.push('/eat/account/password')}>
          <span className="ic"><span className="ms" aria-hidden="true">lock</span></span>
          <div className="m"><b>{t('password')}</b><span>{t('passwordSub')}</span></div>
          <span className="ms ms-flip" aria-hidden="true">chevron_right</span>
        </button>

        {/* « Supprimer mon compte » — inert (no delete-account endpoint) → reported gap */}
        <button type="button" className="danger" onClick={() => showToast(t('deleteSoon'))}>
          <span className="ms" aria-hidden="true">delete_forever</span>{t('deleteAccount')}
        </button>
      </div>

      <div className="foot">
        <div className="inner">
          <button type="button" className="save" onClick={onSave}>
            <span className="ms" aria-hidden="true">check</span><b>{t('save')}</b>
          </button>
        </div>
      </div>
    </main>
  )
}
