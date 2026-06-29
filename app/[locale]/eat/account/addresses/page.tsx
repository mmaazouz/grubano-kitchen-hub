'use client'

import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/navigation'
import {
  readAddresses,
  addAddress,
  updateAddress,
  removeAddress,
  setDefaultAddress,
  formatAddress,
  ADDRESS_EVENT,
  type EatAddress,
  type AddrKind,
} from '@/lib/eat-addresses'
import './addresses.css'
import '@/app/gb-foundation/gb-tokens.css'
import '@/app/gb-foundation/gb-components.css'

// /eat/account/addresses — « Mes adresses » (consumer). VERBATIM reproduction of the
// FROZEN CD ref (Notion 38cfd2c9-…-7516913, screens 1 + 2). Renders inside the EatShell
// (it has its own page header w/ a back arrow). Bound to the REAL device-stored addresses
// via lib/eat-addresses (no fictional data; empty store → the CD empty state). Material
// Symbols (not lucide). The CD `.btn`/`.field` are renamed `.ad-btn`/`.ad-field` to avoid
// colliding with the foundation; every other class name is kept verbatim.

const KIND_ICON: Record<AddrKind, string> = { home: 'home', work: 'work', other: 'location_on' }

type FormState = { mode: 'add' } | { mode: 'edit'; address: EatAddress }

export default function AddressesPage() {
  const t = useTranslations('eat.addresses')
  const router = useRouter()

  const [addresses, setAddresses] = useState<EatAddress[]>([])
  const [form, setForm] = useState<FormState | null>(null)

  const refresh = useCallback(() => setAddresses(readAddresses()), [])

  useEffect(() => {
    refresh()
    window.addEventListener(ADDRESS_EVENT, refresh)
    return () => window.removeEventListener(ADDRESS_EVENT, refresh)
  }, [refresh])

  const onDelete = (a: EatAddress) => {
    if (window.confirm(t('confirmDelete'))) removeAddress(a.id)
  }

  const state = addresses.length === 0 ? 'empty' : 'list'

  return (
    <div className="gb gb-addr-page" data-state={state}>
      <div className="page__head">
        <button type="button" className="back" onClick={() => router.back()} aria-label={t('back')}>
          <span className="ms" aria-hidden="true">arrow_back</span>
        </button>
        <h1>{t('title')}</h1>
        <button type="button" className="ad-btn ad-btn--primary" onClick={() => setForm({ mode: 'add' })}>
          <span className="ms" style={{ fontSize: 18 }} aria-hidden="true">add</span>{t('add')}
        </button>
      </div>

      <div className="page__body">
        {/* LISTE REMPLIE */}
        <div className="addr-list">
          {addresses.map((a) => (
            <div key={a.id} className={`addr-row${a.isDefault ? ' is-default' : ''}`}>
              <div className="addr-ico"><span className="ms" aria-hidden="true">{KIND_ICON[a.kind]}</span></div>
              <div className="addr-row__main">
                <div className="addr-row__title">
                  <b>{a.label}</b>
                  {a.isDefault && (
                    <span className="badge-default">
                      <span className="ms" style={{ fontSize: 12 }} aria-hidden="true">check</span>{t('defaultBadge')}
                    </span>
                  )}
                </div>
                <div className="addr-row__line">{formatAddress(a)}</div>
                {a.note && (
                  <div className="addr-row__note"><span className="ms" aria-hidden="true">info</span>{a.note}</div>
                )}
              </div>
              <div className="row-actions">
                {!a.isDefault && (
                  <button type="button" className="icon-btn" title={t('setDefault')} aria-label={t('setDefault')} onClick={() => setDefaultAddress(a.id)}>
                    <span className="ms" aria-hidden="true">star</span>
                  </button>
                )}
                <button type="button" className="icon-btn" title={t('edit')} aria-label={t('edit')} onClick={() => setForm({ mode: 'edit', address: a })}>
                  <span className="ms" aria-hidden="true">edit</span>
                </button>
                <button type="button" className="icon-btn danger" title={t('delete')} aria-label={t('delete')} onClick={() => onDelete(a)}>
                  <span className="ms" aria-hidden="true">delete</span>
                </button>
              </div>
            </div>
          ))}
        </div>
        <button type="button" className="page__add" onClick={() => setForm({ mode: 'add' })}>
          <span className="ms" aria-hidden="true">add_location_alt</span>{t('addAddress')}
        </button>

        {/* ÉTAT VIDE */}
        <div className="empty">
          <div className="empty__ico"><span className="ms" aria-hidden="true">location_off</span></div>
          <h2>{t('emptyTitle')}</h2>
          <p>{t('emptyBody')}</p>
          <button type="button" className="ad-btn ad-btn--primary" onClick={() => setForm({ mode: 'add' })}>
            <span className="ms" style={{ fontSize: 18 }} aria-hidden="true">add_location_alt</span>{t('emptyCta')}
          </button>
        </div>
      </div>

      {form && <AddressForm state={form} onClose={() => setForm(null)} />}
    </div>
  )
}

// ── Screen 2 — add/edit form (desktop modal / mobile full-screen sheet) ────────
const COUNTRIES = ['France', 'Belgique', 'Suisse', 'Espagne', 'Italie'] as const

function AddressForm({ state, onClose }: { state: FormState; onClose: () => void }) {
  const t = useTranslations('eat.addresses')
  const editing = state.mode === 'edit' ? state.address : null

  const [kind, setKind] = useState<AddrKind>(editing?.kind ?? 'home')
  const [street, setStreet] = useState(editing?.street ?? '')
  const [complement, setComplement] = useState(editing?.complement ?? '')
  const [postalCode, setPostalCode] = useState(editing?.postalCode ?? '')
  const [city, setCity] = useState(editing?.city ?? '')
  const [country, setCountry] = useState(editing?.country ?? 'France')
  const [note, setNote] = useState(editing?.note ?? '')
  const [isDefault, setIsDefault] = useState(editing?.isDefault ?? true)
  const [postalErr, setPostalErr] = useState(false)
  const [err, setErr] = useState(false)

  const chips: { kind: AddrKind; icon: string; label: string }[] = [
    { kind: 'home', icon: 'home', label: t('chipHome') },
    { kind: 'work', icon: 'work', label: t('chipWork') },
    { kind: 'other', icon: 'label', label: t('chipOther') },
  ]

  const labelFor = (k: AddrKind) => (k === 'home' ? t('chipHome') : k === 'work' ? t('chipWork') : t('chipOther'))

  const onSave = () => {
    const postalOk = /^\d{5}$/.test(postalCode.trim())
    const streetOk = street.trim().length > 0
    const cityOk = city.trim().length > 0
    if (!postalOk || !streetOk || !cityOk) {
      setPostalErr(!postalOk)
      setErr(true)
      return
    }
    const payload = {
      // keep the user-chosen label if they previously had one for this kind on edit,
      // otherwise default the label to the chip's label (CD shows the chip as the label).
      label: editing?.label && editing.kind === kind ? editing.label : labelFor(kind),
      kind,
      street: street.trim(),
      complement: complement.trim() || undefined,
      postalCode: postalCode.trim(),
      city: city.trim(),
      country,
      note: note.trim() || undefined,
      isDefault,
    }
    if (editing) updateAddress(editing.id, payload)
    else addAddress(payload)
    onClose()
  }

  const onDelete = () => {
    if (editing && window.confirm(t('confirmDelete'))) {
      removeAddress(editing.id)
      onClose()
    }
  }

  return (
    <div className="gb gb-addr-form" data-mode={state.mode} data-err={err ? '1' : '0'} role="dialog" aria-modal="true" aria-label={editing ? t('formTitleEdit') : t('formTitleAdd')}>
      <div className="backdrop" onClick={onClose}>
        <section className="sheet" onClick={(e) => e.stopPropagation()}>
          <div className="sheet__head">
            <button type="button" className="iconbtn" onClick={onClose} aria-label={t('back')}>
              <span className="ms" aria-hidden="true">arrow_back</span>
            </button>
            <h1>
              <span className="show-add">{t('formTitleAdd')}</span>
              <span className="show-edit">{t('formTitleEdit')}</span>
            </h1>
            <button type="button" className="iconbtn" onClick={onClose} aria-label={t('close')}>
              <span className="ms" aria-hidden="true">close</span>
            </button>
          </div>

          <div className="sheet__body">
            <div className="map-soon">
              <span className="pin" />
              <span className="lbl soon"><span className="ms" style={{ fontSize: 14 }} aria-hidden="true">map</span>{t('mapSoon')}</span>
            </div>

            <div className="section-label">{t('labelSection')}</div>
            <div className="chips">
              {chips.map((c) => (
                <button
                  key={c.kind}
                  type="button"
                  className={`chip${kind === c.kind ? ' sel' : ''}`}
                  aria-pressed={kind === c.kind}
                  onClick={() => setKind(c.kind)}
                >
                  <span className="ms" aria-hidden="true">{c.icon}</span>{c.label}
                </button>
              ))}
            </div>

            <div className="ad-field">
              <label className="ad-field__label" htmlFor="addr-street">{t('street')}</label>
              <div className="control"><span className="ms" aria-hidden="true">home_pin</span>
                <input id="addr-street" value={street} onChange={(e) => setStreet(e.target.value)} placeholder={t('streetPh')} />
              </div>
            </div>

            <div className="ad-field">
              <label className="ad-field__label" htmlFor="addr-complement">{t('complement')} <span className="opt">{t('complementHint')}</span></label>
              <div className="control"><span className="ms" aria-hidden="true">meeting_room</span>
                <input id="addr-complement" value={complement} onChange={(e) => setComplement(e.target.value)} placeholder={t('complementPh')} />
              </div>
            </div>

            <div className="grid2">
              <div className={`ad-field${postalErr ? ' err' : ''}`}>
                <label className="ad-field__label" htmlFor="addr-postal">{t('postal')}</label>
                <div className="control"><span className="ms" aria-hidden="true">markunread_mailbox</span>
                  <input
                    id="addr-postal"
                    inputMode="numeric"
                    value={postalCode}
                    onChange={(e) => { setPostalCode(e.target.value); if (postalErr) { setPostalErr(false); setErr(false) } }}
                    placeholder={t('postalPh')}
                  />
                </div>
                <div className="ad-field__err"><span className="ms" aria-hidden="true">error</span>{t('errPostal')}</div>
              </div>
              <div className="ad-field">
                <label className="ad-field__label" htmlFor="addr-city">{t('city')}</label>
                <div className="control"><span className="ms" aria-hidden="true">location_city</span>
                  <input id="addr-city" value={city} onChange={(e) => setCity(e.target.value)} placeholder={t('cityPh')} />
                </div>
              </div>
            </div>

            <div className="ad-field">
              <label className="ad-field__label" htmlFor="addr-country">{t('country')}</label>
              <div className="control"><span className="ms" aria-hidden="true">public</span>
                <select id="addr-country" value={country} onChange={(e) => setCountry(e.target.value)}>
                  {COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <span className="ms" aria-hidden="true">expand_more</span>
              </div>
            </div>

            <div className="ad-field">
              <label className="ad-field__label" htmlFor="addr-note">{t('note')} <span className="opt">{t('noteHint')}</span></label>
              <div className="control area"><span className="ms" aria-hidden="true">tips_and_updates</span>
                <textarea id="addr-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('notePh')} />
              </div>
            </div>

            <div className="toggle-row">
              <b>{t('setAsDefault')}</b>
              <button
                type="button"
                className={`switch${isDefault ? ' on' : ''}`}
                role="switch"
                aria-checked={isDefault}
                aria-label={t('setAsDefault')}
                onClick={() => setIsDefault((v) => !v)}
              >
                <i />
              </button>
            </div>

            {editing && (
              <button type="button" className="form-del show-edit" onClick={onDelete}>
                <span className="ms" aria-hidden="true">delete</span>{t('deleteThis')}
              </button>
            )}
          </div>

          <div className="sheet__foot">
            <button type="button" className="ad-btn ad-btn--primary" onClick={onSave}>
              <span className="show-add">{t('save')}</span>
              <span className="show-edit">{t('saveEdit')}</span>
            </button>
          </div>
        </section>
      </div>
    </div>
  )
}
