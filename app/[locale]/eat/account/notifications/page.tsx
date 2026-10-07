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
import './notifications.css'

// /eat/account/notifications — « Préférences de notifications » (consumer). VERBATIM
// reproduction of the FROZEN CD ref (Notion 38efd2c9-…-644055ce, file
// eat/notification-preferences.html). Renders INSIDE the EatShell with the `is-bare`
// (immersive) treatment, so the shell drops its own header → this page supplies its own
// back-bar. Material Symbols (not lucide); --gb-* tokens; design CSS in notifications.css.
//
// ⚠️ THE PREFERENCES ARE PERSISTED. This comment used to read « INERT, NO BACKEND … nothing
// is saved and no endpoint is called », and it stopped being true when the load/save pair
// against /api/eat/account was added: this screen GETs the saved preferences and PATCHes
// them back on every change. A comment that denies the backend its own file talks to is how
// the identity question stops being asked — which is exactly what happened here, and the
// account isolation had to be retrofitted. There is still NO sending pipeline (nothing acts
// on these preferences yet) and the « bientôt » pill says so. The CD's `.sw.dis` behaviour
// (a row greys out when its parent channel is OFF) is reproduced so the preview reads
// correctly.
//
// The CD's generic `.row`/`.group`/`.body`/`.bar`/`.lbl`/`.sw` collide with nothing in the
// foundation once scoped under `.gb-notifprefs`, but `.bar`/`.body`/`.row`/`.group` are
// renamed to `.np-*` to stay clear of any future generic + match the addresses pattern.

type Channel = 'push' | 'email' | 'sms'

const CHANNELS: { key: Channel; icon: string }[] = [
  { key: 'push', icon: 'notifications' },
  { key: 'email', icon: 'mail' },
  { key: 'sms', icon: 'sms' },
]

// Order + marketing rows (CD verbatim icons/copy → i18n keys).
const ORDER_ROWS = [
  { key: 'status', icon: 'local_shipping' },
  { key: 'courier', icon: 'near_me' },
  { key: 'reviews', icon: 'rate_review' },
] as const
const MARKETING_ROWS = [
  { key: 'offers', icon: 'sell' },
  { key: 'newResto', icon: 'restaurant' },
  { key: 'rewards', icon: 'redeem' },
] as const

type RowKey =
  | (typeof ORDER_ROWS)[number]['key']
  | (typeof MARKETING_ROWS)[number]['key']

/**
 * The CD defaults. ALSO the neutral screen shown whenever the preferences on display are
 * not the live identity's — a visitor must never see the previous account's choices, not
 * even for one frame, so « we do not know yet » renders as these rather than as leftovers.
 */
const DEFAULT_PREFS: Omit<PrefsState, 'owner'> = {
  channels: { push: true, email: true, sms: false },
  rows: {
    status: true, courier: true, reviews: false,
    offers: true, newResto: false, rewards: true,
  },
  quiet: true,
}

/** The preferences, carrying the identity they were loaded FOR. */
interface PrefsState {
  owner: string | null
  channels: Record<Channel, boolean>
  rows: Record<RowKey, boolean>
  quiet: boolean
}

export default function NotificationsPrefsPage() {
  const t = useTranslations('eat.notifPrefs')
  const router = useRouter()

  // ── IDENTITY ───────────────────────────────────────────────────────────────────
  // The repository's own stamp, called rather than restated: 'u:<id>' | 'guest' | null when
  // the session has not resolved. This page had NO identity at all — the load effect was
  // keyed on `[]` and the values sat in plain state, so a cross-tab sign-in (NextAuth's
  // broadcast calls setSession without setLoading, so `status` goes authenticated →
  // authenticated and nothing remounts) left the previous account's preferences on screen,
  // and the next toggle PATCHed them onto the new account.
  const { data: session, status } = useSession()
  const liveUserId = (session?.user as { id?: string } | undefined)?.id
  const liveOwner = sessionCartStamp(status, liveUserId)
  // Read by the debounce when it FIRES. A timer armed under A cannot see a switch through
  // its own closure, so the live value has to be reachable from outside it.
  const liveOwnerRef = useRef<string | null>(liveOwner)
  liveOwnerRef.current = liveOwner

  /** The preferences AND the identity they belong to — never one without the other. */
  const [prefs, setPrefs] = useState<PrefsState>({ owner: null, ...DEFAULT_PREFS })
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const firstSave = useRef(true)
  // A load that failed is recoverable. Without these the screen stayed inert for ever —
  // correct about ownership and useless to the user, which is not a trade worth making.
  const [loadFailed, setLoadFailed] = useState(false)
  const [reloadNonce, setReloadNonce] = useState(0)

  // ── EVALUATED DURING RENDER ────────────────────────────────────────────────────
  // A preference is a statement about a person. It is shown only to the identity it was
  // loaded under, and this has to be a render-time derivation: the owner changes during a
  // render, and effects run after the frame that already painted.
  const mine = liveOwner !== null && prefs.owner === liveOwner
  const channels = mine ? prefs.channels : DEFAULT_PREFS.channels
  const rows = mine ? prefs.rows : DEFAULT_PREFS.rows
  const quiet = mine ? prefs.quiet : DEFAULT_PREFS.quiet

  // Load the preferences FOR THE LIVE IDENTITY. Keyed on the owner, so a sign-in, a
  // sign-out and a cross-tab account switch each re-run it; it used to be keyed on `[]`,
  // which is precisely why the next account inherited the previous one's screen.
  useEffect(() => {
    // Whatever the previous identity left armed stops existing here: a debounce it set, and
    // the « do not echo the load back » flag, which the next load has to consume afresh.
    if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null }
    firstSave.current = true
    setLoadFailed(false)
    // FAIL CLOSED FIRST, before any request: the previous account's values leave the screen
    // immediately rather than lingering until a response arrives.
    setPrefs({ owner: null, ...DEFAULT_PREFS })
    // An identity we cannot name is one we cannot attribute data to: no request at all.
    if (liveOwner === null) return
    // A guest has no account to read or write. Stamped so the screen is usable, never
    // fetched, and the save effect refuses it explicitly.
    if (liveOwner === 'guest') { setPrefs({ owner: 'guest', ...DEFAULT_PREFS }); return }
    const requestOwner = liveOwner
    // THE RAW ID THE SERVER HAS TO CONFIRM, captured from the SAME render as `requestOwner`
    // and kept separate from it. `alive` closes the case where React has already moved on —
    // it cannot close the case where React has NOT moved yet: the cookie becomes B's before
    // the broadcast reaches this mount, the GET leaves believing it is A's, the server
    // authenticates B, and the effect is still live. Stamping that response with
    // `requestOwner` would publish B's preferences as A's, and `mine` would be true.
    const requestUserId = liveUserId
    let alive = true
    fetch('/api/eat/account', { headers: { accept: 'application/json' } })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('not ok'))))
      .then((d: { ownerId?: unknown; notifPrefs?: unknown } | null) => {
        if (!alive) return
        // NEVER STAMP A RESPONSE THE SERVER HAS NOT ATTRIBUTED TO THE SAME RAW ID. The
        // comparison is against the captured `requestUserId`, not the live one, and the
        // `typeof` half matters as much as the equality: a response that omits the field
        // entirely — an older server, a cache, a proxy — must not slip through on
        // `undefined === undefined`. A mismatch is a FAILED load, not a loaded screen: the
        // state stays unstamped, so the defaults on display are never writable back, and
        // `loadFailed` makes it say so and offers the retry.
        if (typeof d?.ownerId !== 'string' || d.ownerId !== requestUserId) {
          setLoadFailed(true)
          return
        }
        const p = (d?.notifPrefs ?? {}) as {
          channels?: Partial<Record<Channel, boolean>>
          rows?: Partial<Record<RowKey, boolean>>
          quiet?: boolean
        }
        const nextChannels = { ...DEFAULT_PREFS.channels, ...(p.channels ?? {}) }
        const nextRows = { ...DEFAULT_PREFS.rows, ...(p.rows ?? {}) }
        const nextQuiet = typeof p.quiet === 'boolean' ? p.quiet : DEFAULT_PREFS.quiet
        setPrefs({ owner: requestOwner, channels: nextChannels, rows: nextRows, quiet: nextQuiet })
      })
      // A REQUEST THAT HAS NOT ANSWERED IS NOT AN ANSWER. A failure leaves the state
      // unstamped, so the screen stays inert — which also means the next toggle cannot
      // PATCH defaults the user never chose over the preferences the server actually holds.
      // It is SAID, and it is recoverable: a dead screen is not an acceptable price for
      // correctness about ownership.
      .catch(() => { if (alive) setLoadFailed(true) })
    return () => { alive = false }
    // `liveUserId` is declared, not suppressed: the effect genuinely reads it now. It cannot
    // cause an extra run — whenever the owner is a real account `liveOwner` IS `u:${liveUserId}`,
    // so the two always move together, and for guest/unresolved the id is undefined and stable.
  }, [liveOwner, liveUserId, reloadNonce])

  // Auto-save (debounced). Keyed on the identity too, so a switch tears the effect down
  // and the cleanup disarms whatever it had pending.
  useEffect(() => {
    // `mine` is false until the preferences on screen are this owner's — which also covers
    // « not loaded yet » and « the load failed », so neither can be written back.
    if (!mine) return
    if (liveOwner === 'guest') return
    if (firstSave.current) { firstSave.current = false; return }
    const saveOwner = liveOwner
    // The RAW id from THE SAME RENDER that produced `saveOwner`, sent with the mutation so
    // the server can refuse it if the identity it authenticates is not this one. The client
    // cannot make that check itself: the browser attaches the cookie at SEND time, after
    // this closure was built, and the client's own belief lags a broadcast behind.
    const saveUserId = liveUserId
    if (saveUserId === undefined) return
    const payload = { channels, rows, quiet }
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      // RE-READ AT FIRE TIME. The cleanup above normally disarms this, but the closure's
      // own copy of the owner cannot see a switch, so the decision is made against the live
      // value — the same discipline as the geolocation hook's late callbacks.
      if (liveOwnerRef.current !== saveOwner) return
      fetch('/api/eat/account', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ expectedUserId: saveUserId, notifPrefs: payload }),
      })
        .then((r) => {
          // 409 owner_changed — the identity moved between arming this save and sending it,
          // and the server refused it. The mutation is STALE: never a « enregistré » for a
          // write that did not happen, and never a retry with the same payload. Nothing else
          // is needed here: the identity change has already fail-closed this screen and
          // started loading the right account.
          if (r.status === 409) return
          if (r.ok && liveOwnerRef.current === saveOwner) showToast(t('saved'))
        })
        .catch(() => {})
    }, 600)
    return () => { if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null } }
  }, [channels, rows, quiet, liveOwner, liveUserId, mine, t])

  // A channel-row is « dis » (greyed, inert) only when EVERY channel is cut — there is no
  // way to receive the notif at all. Mirrors the CD `.sw.dis` "parent channel coupé" note.
  const noChannel = !channels.push && !channels.email && !channels.sms

  // Every mutation is refused unless the values on screen belong to the live identity —
  // checked at the call AND inside the updater, because a state update is deferred and the
  // identity can move between the two.
  const toggleChannel = (k: Channel) => {
    if (!mine) return
    setPrefs((p) => (p.owner === liveOwner ? { ...p, channels: { ...p.channels, [k]: !p.channels[k] } } : p))
  }
  const toggleRow = (k: RowKey) => {
    if (!mine || noChannel) return
    setPrefs((p) => (p.owner === liveOwner ? { ...p, rows: { ...p.rows, [k]: !p.rows[k] } } : p))
  }
  const toggleQuiet = () => {
    if (!mine) return
    setPrefs((p) => (p.owner === liveOwner ? { ...p, quiet: !p.quiet } : p))
  }

  return (
    <div className="gb gb-notifprefs">
      <main className="screen">
        {/* OWN back-bar — the shell is `is-bare` on this route, so the page header governs. */}
        <div className="np-bar">
          <button type="button" className="np-back" onClick={() => router.back()} aria-label={t('back')}>
            <span className="ms ms-flip" aria-hidden="true">arrow_back</span>
          </button>
          <h2>{t('title')}</h2>
          <span className="np-soon-top">{t('soon')}</span>
        </div>

        <div className="np-body">
          {/* Preview banner — makes the « not persisted yet » framing explicit (no CD ref;
              on-brand, replaces nothing). */}
          <div className="np-preview">
            <span className="ms" aria-hidden="true">info</span>
            {/* A guest's PATCH is refused by design, so the « enregistrées automatiquement »
                promise is not made to them. */}
            <span>{liveOwner === 'guest' ? t('previewNoteGuest') : t('previewNote')}</span>
          </div>

          {/* The load failed: say so, and offer the only action that can fix it. The
              controls stay inert meanwhile — nothing may be written over preferences we
              were unable to read. */}
          {loadFailed && (
            <p className="np-error" role="alert">
              <span>{t('loadError')}</span>
              <button type="button" className="np-retry" onClick={() => setReloadNonce((n) => n + 1)}>
                {t('retry')}
              </button>
            </p>
          )}

          {/* ── Canaux ── */}
          <p className="np-lbl">{t('channels')}</p>
          <div className="chans">
            {CHANNELS.map((c) => {
              const on = channels[c.key]
              return (
                <button
                  key={c.key}
                  type="button"
                  className={`chan${on ? ' on' : ''}`}
                  aria-pressed={on}
                  disabled={!mine}
                  aria-busy={!mine && !loadFailed}
                  onClick={() => toggleChannel(c.key)}
                >
                  <span className="ms" aria-hidden="true">{c.icon}</span>
                  <b>{t(`channel_${c.key}`)}</b>
                  <small>{on ? t('on') : t('off')}</small>
                </button>
              )
            })}
          </div>

          {/* ── Commandes ── */}
          <p className="np-lbl">{t('groupOrders')}</p>
          <div className="np-group" aria-disabled={noChannel}>
            {ORDER_ROWS.map((r) => (
              <div className="np-row" key={r.key}>
                <span className="ic"><span className="ms" aria-hidden="true">{r.icon}</span></span>
                <div className="m">
                  <b>{t(`row_${r.key}`)}</b>
                  <span>{t(`row_${r.key}_sub`)}</span>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={!noChannel && rows[r.key]}
                  aria-label={t(`row_${r.key}`)}
                  className={`sw${!noChannel && rows[r.key] ? ' on' : ''}${noChannel || !mine ? ' dis' : ''}`}
                  disabled={!mine}
                  aria-busy={!mine && !loadFailed}
                  onClick={() => toggleRow(r.key)}
                >
                  <i />
                </button>
              </div>
            ))}
          </div>

          {/* ── Promotions & marketing ── */}
          <p className="np-lbl">{t('groupMarketing')}</p>
          <div className="np-group" aria-disabled={noChannel}>
            {MARKETING_ROWS.map((r) => (
              <div className="np-row" key={r.key}>
                <span className="ic"><span className="ms" aria-hidden="true">{r.icon}</span></span>
                <div className="m">
                  <b>{t(`row_${r.key}`)}</b>
                  <span>{t(`row_${r.key}_sub`)}</span>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={!noChannel && rows[r.key]}
                  aria-label={t(`row_${r.key}`)}
                  className={`sw${!noChannel && rows[r.key] ? ' on' : ''}${noChannel || !mine ? ' dis' : ''}`}
                  disabled={!mine}
                  aria-busy={!mine && !loadFailed}
                  onClick={() => toggleRow(r.key)}
                >
                  <i />
                </button>
              </div>
            ))}
          </div>

          {/* ── Résumé intelligent — INERT (bientôt), no toggle ── */}
          <div className="aibox">
            <span className="ms" aria-hidden="true">auto_awesome</span>
            <div className="m">
              <b>{t('aiTitle')}</b>
              <span>{t('aiSub')}</span>
            </div>
            <span className="soon">{t('soon')}</span>
          </div>

          {/* ── Ne pas déranger ── */}
          <p className="np-lbl">{t('groupQuiet')}</p>
          <div className="quiet">
            <span className="ms" aria-hidden="true">bedtime</span>
            <div className="m">
              <b>{t('quietTitle')}</b>
              <span>{t('quietRange')}</span>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={quiet}
              aria-label={t('quietTitle')}
              className={`sw${quiet ? ' on' : ''}${!mine ? ' dis' : ''}`}
              disabled={!mine}
              aria-busy={!mine && !loadFailed}
              onClick={toggleQuiet}
            >
              <i />
            </button>
          </div>
        </div>
      </main>
    </div>
  )
}
