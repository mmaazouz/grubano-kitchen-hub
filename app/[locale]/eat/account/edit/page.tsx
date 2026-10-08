'use client'

import { useEffect, useRef, useState } from 'react'
import { useSession } from 'next-auth/react'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/navigation'
import { showToast, sessionCartStamp } from '@/lib/eat-cart'
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
// REAL DATA: identity (name / phone) comes from the owner-scoped GET /api/eat/account; the
// read-only email on this screen comes from useSession() (always the live session's own).
// Avatar is display-only (no upload endpoint).
//
// ── IDENTITY ──────────────────────────────────────────────────────────────────────
// This page used to have NO owner notion beyond `sessionName` — no stamp on the loaded
// state, no re-key on identity, no server guard. A → logout → B inside one mount had TWO
// distinct leaks: a GET for A that answered under B's cookie was adopted as A's, and the
// user's typed values were PATCHed under whichever cookie happened to be attached at send
// time (A's text persisted onto B's row). The notifications lot closed the same two races
// with the same shape; this page follows it exactly.

interface ProfileState {
  owner: string | null
  name: string
  phone: string
}

/**
 * The CD neutral screen shown whenever the on-screen values are not the live identity's —
 * a visitor must never see the previous account's values, not even for one frame, so « we
 * do not know yet » renders as empty strings rather than as leftovers.
 */
const DEFAULT_PROFILE: Omit<ProfileState, 'owner'> = { name: '', phone: '' }

export default function EditProfileScreen() {
  const t = useTranslations('eat.profileEdit')
  const router = useRouter()
  const { data: session, status } = useSession()

  // ── IDENTITY — the repository's own stamp, called rather than restated ──────────
  const liveUserId = (session?.user as { id?: string } | undefined)?.id
  const liveOwner = sessionCartStamp(status, liveUserId)
  // Read by the save callback when the server answers. The identity can move between the
  // click and the response, so the live value has to be reachable from outside the closure.
  // WRITTEN DURING RENDER (not in an effect): an effect runs after the paint, so between the
  // identity changing and the effect firing the ref would still name the previous account —
  // exactly the window this check exists to close.
  const liveOwnerRef = useRef<string | null>(liveOwner)
  liveOwnerRef.current = liveOwner

  const sessionEmail = (session?.user?.email as string | undefined) ?? ''

  /** The profile AND the identity it belongs to — never one without the other. */
  const [profile, setProfile] = useState<ProfileState>({ owner: null, ...DEFAULT_PROFILE })
  const [saving, setSaving] = useState(false)
  // A load that failed is recoverable: the screen SAYS so and offers the retry. Without it,
  // the screen would stay inert for ever — correct about ownership and useless to the user.
  const [loadFailed, setLoadFailed] = useState(false)
  const [reloadNonce, setReloadNonce] = useState(0)

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/eat/auth')
  }, [status, router])

  // Load the profile FOR THE LIVE IDENTITY. Keyed on the owner, so a sign-in, a sign-out and
  // a cross-tab account switch each re-run it; it used to be keyed on `[status, sessionName]`,
  // which is why the next account inherited the previous one's values.
  useEffect(() => {
    setLoadFailed(false)
    // FAIL CLOSED FIRST, before any request: the previous account's values leave the screen
    // immediately rather than lingering until a response arrives.
    setProfile({ owner: null, ...DEFAULT_PROFILE })
    // An identity we cannot name is one we cannot attribute data to: no request at all.
    if (liveOwner === null) return
    // A guest has no account to read or write — handled by the `unauthenticated` redirect
    // above, but asserted explicitly here so a race cannot slip a GET through under 'guest'.
    if (liveOwner === 'guest') return
    const requestOwner = liveOwner
    // THE RAW ID THE SERVER HAS TO CONFIRM, captured from the SAME render as `requestOwner`
    // and kept separate from it. `alive` closes the case where React has already moved on —
    // it cannot close the case where React has NOT moved yet: the cookie becomes B's before
    // the broadcast reaches this mount, the GET leaves believing it is A's, the server
    // authenticates B, and the effect is still live. Stamping that response with
    // `requestOwner` would publish B's profile as A's, and `mine` would be true.
    const requestUserId = liveUserId
    let alive = true
    fetch('/api/eat/account', { headers: { accept: 'application/json' } })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('not ok'))))
      .then((d: { ownerId?: unknown; name?: unknown; phone?: unknown } | null) => {
        if (!alive) return
        // NEVER STAMP A RESPONSE THE SERVER HAS NOT ATTRIBUTED TO THE SAME RAW ID. The
        // comparison is against the captured `requestUserId`, not the live one. The `typeof`
        // half matters as much as the equality: a response that omits the field — an older
        // server, a cache, a proxy — must not slip through on `undefined === undefined`.
        if (typeof d?.ownerId !== 'string' || d.ownerId !== requestUserId) {
          setLoadFailed(true)
          return
        }
        const nextName = typeof d.name === 'string' ? d.name : ''
        const nextPhone = typeof d.phone === 'string' ? d.phone : ''
        setProfile({ owner: requestOwner, name: nextName, phone: nextPhone })
      })
      // A REQUEST THAT HAS NOT ANSWERED IS NOT AN ANSWER. A failure leaves the state
      // unstamped, so the screen stays inert — which also means the next click cannot
      // PATCH defaults the user never chose over the profile the server actually holds.
      .catch(() => { if (alive) setLoadFailed(true) })
    return () => { alive = false }
    // `liveUserId` is declared, not suppressed: the effect genuinely reads it now. It cannot
    // cause an extra run — whenever the owner is a real account `liveOwner` IS `u:${liveUserId}`,
    // so the two always move together, and for guest/unresolved the id is undefined and stable.
  }, [liveOwner, liveUserId, reloadNonce])

  // ── EVALUATED DURING RENDER ───────────────────────────────────────────────────────
  // The profile is shown only to the identity it was loaded under; this is a render-time
  // derivation, because the owner changes during a render and effects run after the frame
  // that already painted.
  const mine = liveOwner !== null && profile.owner === liveOwner
  const name = mine ? profile.name : DEFAULT_PROFILE.name
  const phone = mine ? profile.phone : DEFAULT_PROFILE.phone

  // Avatar initials: based on the OWNER's name when it is this owner's, otherwise fall back
  // to the live session's email — never on the previous account's values.
  const initialsSource = mine && name ? name : sessionEmail
  const initials =
    initialsSource.split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || '🙂'

  // Every typing event is refused unless the on-screen values belong to the live identity —
  // checked at the call AND inside the updater, because a state update is deferred and the
  // identity can move between the two.
  const setName = (v: string) => {
    if (!mine) return
    setProfile((p) => (p.owner === liveOwner ? { ...p, name: v } : p))
  }
  const setPhone = (v: string) => {
    if (!mine) return
    setProfile((p) => (p.owner === liveOwner ? { ...p, phone: v } : p))
  }

  // Real save (P1-PROFILE) → PATCH /api/eat/account (name + phone). The mutation NAMES the
  // identity it was prepared for; the server refuses a mismatch 409. Not a new owner format:
  // `expectedUserId` is the raw Operator id, the same value the session carries.
  const onSave = async () => {
    if (saving || !mine) return
    const trimmed = name.trim()
    if (!trimmed) {
      showToast(t('nameRequired'))
      return
    }
    // Captured at CLICK time. The identity can move between here and the server's answer;
    // the comparisons below read the LIVE value from the ref, not from these captures.
    const saveOwner = liveOwner
    const saveUserId = liveUserId
    if (saveUserId === undefined) return
    setSaving(true)
    try {
      const res = await fetch('/api/eat/account', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ expectedUserId: saveUserId, name: trimmed, phone: phone.trim() }),
      })
      // 409 owner_changed — the identity moved between arming this save and sending it, and
      // the server refused it. The mutation is STALE: never a « saveOk » for a write that
      // did not happen, and never a retry with the same payload.
      if (res.status === 409) return
      if (!res.ok) throw new Error('save_failed')
      const d = (await res.json().catch(() => null)) as { name?: string; phone?: string } | null
      if (d) {
        setProfile((p) => (p.owner === saveOwner ? { ...p, name: d.name ?? p.name, phone: typeof d.phone === 'string' ? d.phone : p.phone } : p))
      }
      if (liveOwnerRef.current === saveOwner) showToast(t('saveOk'))
    } catch {
      if (liveOwnerRef.current === saveOwner) showToast(t('saveError'))
    } finally {
      setSaving(false)
    }
  }

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

        {/* The load failed: say so, and offer the only action that can fix it. The controls
            stay inert meanwhile — nothing may be written over a profile we were unable to read. */}
        {loadFailed && (
          <p className="pe-error" role="alert">
            <span>{t('loadError')}</span>
            <button type="button" className="pe-retry" onClick={() => setReloadNonce((n) => n + 1)}>
              {t('retry')}
            </button>
          </p>
        )}

        {/* ─── Informations ─── */}
        <p className="lbl">{t('sectionInfo')}</p>
        <div className="grid2">
          <div className="pe-field">
            <span>{t('fullName')}</span>
            <div className="ctrl">
              <span className="ms" aria-hidden="true">person</span>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('fullNamePh')} autoComplete="name" disabled={!mine} aria-busy={!mine && !loadFailed} />
            </div>
          </div>
          <div className="pe-field">
            <span>{t('phone')}</span>
            <div className="ctrl">
              <span className="ms" aria-hidden="true">phone</span>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder={t('phonePh')} inputMode="tel" autoComplete="tel" disabled={!mine} aria-busy={!mine && !loadFailed} />
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
          <button type="button" className="save" onClick={onSave} disabled={saving || !mine} aria-busy={saving}>
            <span className="ms" aria-hidden="true">check</span><b>{t('save')}</b>
          </button>
        </div>
      </div>
    </main>
  )
}
