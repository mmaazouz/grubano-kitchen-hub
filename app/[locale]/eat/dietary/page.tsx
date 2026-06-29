'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/navigation'
// gb-foundation FIRST: gb-tokens.css opens with `@import …Material+Symbols…`, valid
// only when it is the route stylesheet's first rule — keep it before page CSS so the
// `.ms` icon ligatures don't fall back to raw text.
import '@/app/gb-foundation/gb-tokens.css'
import '@/app/gb-foundation/gb-components.css'
import './dietary.css'

// /eat/dietary — « Filtre IA diététique & allergènes » (NEW epic, FULLY VISUAL/INERT).
// Verbatim reproduction of the FROZEN CD ref (Notion 38efd2c9-…-81ad, file
// eat/dietary-filter.html). CD ships an overlay (modale desktop / bottom-sheet mobile
// <560px); here it renders as page CONTENT inside the existing EatShell (like /orders
// & /rewards) — the CD `.backdrop` becomes a centred page surface, the top-bar « close »
// routes back. NO BACKEND: the consumer search API supports only cuisine+sort, and menu
// items carry no allergen/dietary labels (confirmed in this project) — so:
//   • régime switches (inclusion) + allergen chips (exclusion) toggle VISUAL state only;
//   • the AI « Filtre intelligent » block is « bientôt » (inert);
//   • the 38 compatibles / 14 masqués / 6 alternatives counters are CD PLACEHOLDERS —
//     no real filtering, no dish is hidden/suggested as if real;
//   • « Réinit. » clears the visual toggles, « Voir N plats » just returns to search.
// Real diététique filtering lands AFTER the search backend exists (Wave 5 gap).

// CD preference rows (régimes = inclusion, toggle vert) — verbatim order/icons/state.
const PREFS = [
  { key: 'vegetarian', icon: 'eco', on: true },
  { key: 'vegan', icon: 'grass', on: false },
  { key: 'glutenFree', icon: 'bakery_dining', on: true },
  { key: 'halal', icon: 'local_fire_department', on: false },
] as const

// CD allergen chips (allergènes = exclusion, chips rouges) — verbatim order/icons/state.
const ALLERGENS = [
  { key: 'nuts', icon: 'nutrition', on: true },
  { key: 'eggs', icon: 'egg', on: true },
  { key: 'lactose', icon: 'water_drop', on: false },
  { key: 'shellfish', icon: 'set_meal', on: false },
  { key: 'soy', icon: 'spa', on: false },
  { key: 'sesame', icon: 'eco', on: false },
] as const

// CD placeholder counters (INERT — no real diététique backend yet).
const COUNT_COMPATIBLE = 38
const COUNT_HIDDEN = 14
const COUNT_ALTERNATIVES = 6

export default function DietaryFilterScreen() {
  const t = useTranslations('eat.dietary')
  const router = useRouter()

  // Inert visual state — toggling changes nothing real (no filtering backend).
  const [prefs, setPrefs] = useState<Record<string, boolean>>(
    () => Object.fromEntries(PREFS.map((p) => [p.key, p.on])),
  )
  const [allergens, setAllergens] = useState<Record<string, boolean>>(
    () => Object.fromEntries(ALLERGENS.map((a) => [a.key, a.on])),
  )

  const togglePref = (key: string) => setPrefs((s) => ({ ...s, [key]: !s[key] }))
  const toggleAllergen = (key: string) => setAllergens((s) => ({ ...s, [key]: !s[key] }))

  const reset = () => {
    setPrefs(Object.fromEntries(PREFS.map((p) => [p.key, false])))
    setAllergens(Object.fromEntries(ALLERGENS.map((a) => [a.key, false])))
  }
  // INERT « apply »: no real filtering exists → just return to search (counters are placeholders).
  const apply = () => router.push('/eat/search')
  const close = () => router.back()

  return (
    <div className="gb gb-dietary dt-backdrop">
      <section className="dt-sheet" role="dialog" aria-modal="false" aria-label={t('title')}>
        <div className="dt-sheet__head">
          <h2>{t('title')}</h2>
          <button type="button" className="dt-sheet__close" onClick={close} aria-label={t('close')}>
            <span className="ms" aria-hidden="true">close</span>
          </button>
        </div>

        <div className="dt-sheet__body">
          {/* AI « Filtre intelligent » — INERT (bientôt) */}
          <div className="dt-ai">
            <div className="dt-ai__in">
              <span className="ms" aria-hidden="true">auto_awesome</span>
              <div className="t">
                <div className="h">
                  <b>{t('aiTitle')}</b>
                  <span className="soon">{t('soon')}</span>
                </div>
                <p>{t('aiBody')}</p>
              </div>
            </div>
          </div>

          {/* Préférences alimentaires (inclusion) */}
          <div className="dt-lbl">{t('prefsLabel')}</div>
          {PREFS.map((p) => (
            <div className="dt-pref" key={p.key}>
              <span className="ic"><span className="ms" aria-hidden="true">{p.icon}</span></span>
              <div className="m">
                <b>{t(`pref_${p.key}_name`)}</b>
                <span>{t(`pref_${p.key}_desc`)}</span>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={prefs[p.key]}
                aria-label={t(`pref_${p.key}_name`)}
                className={`dt-switch${prefs[p.key] ? ' on' : ''}`}
                onClick={() => togglePref(p.key)}
              >
                <i />
              </button>
            </div>
          ))}

          {/* Exclure ces allergènes (exclusion) */}
          <div className="dt-lbl mt">{t('allergensLabel')}</div>
          <div className="dt-aller">
            {ALLERGENS.map((a) => (
              <button
                type="button"
                key={a.key}
                aria-pressed={allergens[a.key]}
                className={`dt-achip${allergens[a.key] ? ' on' : ''}`}
                onClick={() => toggleAllergen(a.key)}
              >
                <span className="ms" aria-hidden="true">{a.icon}</span>
                {t(`allergen_${a.key}`)}
                {allergens[a.key] && <span className="ms x" aria-hidden="true">close</span>}
              </button>
            ))}
          </div>

          {/* Résultat (INERT placeholders — no real diététique backend yet) */}
          {/* Neutral PREVIEW block (not a live result) + « bientôt » badge — the
              counts are illustrative CD demo, the diététique filter has no backend. */}
          <div className="dt-result">
            <span className="ms" aria-hidden="true">auto_awesome</span>
            <p>
              {t.rich('resultSummary', {
                compatible: COUNT_COMPATIBLE,
                hidden: COUNT_HIDDEN,
                alternatives: COUNT_ALTERNATIVES,
                b: (chunks) => <b>{chunks}</b>,
              })}
            </p>
            <span className="soon">{t('soon')}</span>
          </div>
        </div>

        <div className="dt-sheet__foot">
          <button type="button" className="dt-btn dt-btn--ghost" onClick={reset}>{t('reset')}</button>
          <button type="button" className="dt-btn dt-btn--primary" onClick={apply}>
            {t('apply', { count: COUNT_COMPATIBLE })}
          </button>
        </div>
      </section>
    </div>
  )
}
