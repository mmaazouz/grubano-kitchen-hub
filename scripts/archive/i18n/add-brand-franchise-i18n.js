/* eslint-disable */
// ── Agent 46 — brand franchise-conditions editor i18n (B4) ───────────────────────
// Adds brands.franchise.* : the page where a brand OWNER edits the franchise terms of
// their brand (open to franchise, royalty rate %, setup fee, allowed zones, status) +
// the discreet link to it from the hub brand-edit modal. x5 locales, strict parity,
// idempotent. FR vouvoiement; es/it/en natural; ar real RTL.
// Run: node scripts/add-brand-franchise-i18n.js
const fs = require('fs')
const path = require('path')
const LOCALES = ['fr', 'en', 'es', 'it', 'ar']

// brands.franchise.* — [fr, en, es, it, ar]
const F = {
  editLink: ['Conditions de franchise', 'Franchise terms', 'Condiciones de franquicia', 'Condizioni di franchising', 'شروط الامتياز'],
  title:    ['Conditions de franchise', 'Franchise terms', 'Condiciones de franquicia', 'Condizioni di franchising', 'شروط الامتياز'],
  subtitle: [
    'Définissez les conditions auxquelles votre marque est proposée en franchise.',
    'Set the terms on which your brand is offered for franchising.',
    'Define las condiciones con las que tu marca se ofrece en franquicia.',
    'Definisci le condizioni con cui il tuo marchio è offerto in franchising.',
    'حدِّد الشروط التي تُعرض بها علامتك للامتياز.',
  ],
  back:      ['Retour', 'Back', 'Volver', 'Indietro', 'رجوع'],
  loadError: ['Impossible de charger la marque.', 'Could not load the brand.', 'No se pudo cargar la marca.', 'Impossibile caricare il marchio.', 'تعذّر تحميل العلامة.'],

  openLabel: ['Ouverte à la franchise', 'Open to franchising', 'Abierta a franquicia', 'Aperta al franchising', 'مفتوحة للامتياز'],
  openHint: [
    'Rend votre marque visible aux candidats franchisés sur la page découverte.',
    'Makes your brand visible to franchise candidates on the discovery page.',
    'Hace tu marca visible para candidatos a franquicia en la página de descubrimiento.',
    'Rende il tuo marchio visibile ai candidati franchisee nella pagina di scoperta.',
    'تجعل علامتك مرئية للمرشحين للامتياز في صفحة الاكتشاف.',
  ],
  royaltyLabel: ['Taux de royalties (%)', 'Royalty rate (%)', 'Tasa de royalties (%)', 'Tasso di royalty (%)', 'نسبة الإتاوة (%)'],
  royaltyHint: [
    'Part du chiffre d’affaires reversée à l’enseigne. Laissez vide pour le taux par défaut (6 %).',
    'Share of revenue paid to the franchisor. Leave empty for the default rate (6%).',
    'Parte de los ingresos pagada al franquiciador. Déjalo vacío para la tasa por defecto (6 %).',
    'Quota del fatturato versata al franchisor. Lascia vuoto per il tasso predefinito (6%).',
    'حصة من الإيرادات تُدفع لمانح الامتياز. اتركه فارغًا للنسبة الافتراضية (6%).',
  ],
  royaltyError: [
    'Le taux doit être compris entre 0 et 50 %.',
    'The rate must be between 0 and 50%.',
    'La tasa debe estar entre 0 y 50 %.',
    'Il tasso deve essere compreso tra 0 e 50%.',
    'يجب أن تكون النسبة بين 0 و50%.',
  ],
  setupFeeLabel: ['Frais d’installation (€)', 'Setup fee (€)', 'Coste de instalación (€)', 'Costo di avvio (€)', 'رسوم الإعداد (€)'],
  setupFeeHint: [
    'Frais unique payé par le franchisé à l’ouverture (facultatif).',
    'One-off fee paid by the franchisee at opening (optional).',
    'Tarifa única que paga el franquiciado en la apertura (opcional).',
    'Costo una tantum pagato dal franchisee all’apertura (facoltativo).',
    'رسوم لمرة واحدة يدفعها صاحب الامتياز عند الافتتاح (اختياري).',
  ],
  zonesLabel: ['Zones / villes autorisées', 'Allowed zones / cities', 'Zonas / ciudades permitidas', 'Zone / città consentite', 'المناطق / المدن المسموح بها'],
  zonesHint: [
    'Une ville par ligne (ou séparées par des virgules).',
    'One city per line (or comma-separated).',
    'Una ciudad por línea (o separadas por comas).',
    'Una città per riga (o separate da virgole).',
    'مدينة واحدة في كل سطر (أو مفصولة بفواصل).',
  ],
  zonesPlaceholder: ['Paris\nLyon\nMarseille', 'Paris\nLyon\nMarseille', 'Madrid\nBarcelona\nValencia', 'Roma\nMilano\nNapoli', 'باريس\nليون\nمرسيليا'],
  statusLabel: ['Statut de la franchise', 'Franchise status', 'Estado de la franquicia', 'Stato del franchising', 'حالة الامتياز'],
  statusNone:  ['Aucun', 'None', 'Ninguno', 'Nessuno', 'لا شيء'],
  statusOpen:  ['Ouverte', 'Open', 'Abierta', 'Aperta', 'مفتوحة'],
  statusFull:  ['Complète', 'Full', 'Completa', 'Completa', 'مكتملة'],

  save:     ['Enregistrer', 'Save', 'Guardar', 'Salva', 'حفظ'],
  saving:   ['Enregistrement…', 'Saving…', 'Guardando…', 'Salvataggio…', 'جارٍ الحفظ…'],
  savedTitle: ['Conditions enregistrées', 'Terms saved', 'Condiciones guardadas', 'Condizioni salvate', 'تم حفظ الشروط'],
  savedBody: [
    'Les conditions de franchise de votre marque ont été mises à jour.',
    'Your brand’s franchise terms have been updated.',
    'Las condiciones de franquicia de tu marca se han actualizado.',
    'Le condizioni di franchising del tuo marchio sono state aggiornate.',
    'تم تحديث شروط امتياز علامتك.',
  ],
  errorGeneric: [
    'Une erreur est survenue. Veuillez réessayer.',
    'Something went wrong. Please try again.',
    'Ocurrió un error. Inténtalo de nuevo.',
    'Si è verificato un errore. Riprova.',
    'حدث خطأ. يرجى المحاولة مرة أخرى.',
  ],
}

LOCALES.forEach((loc, i) => {
  const file = path.join(__dirname, '..', 'messages', `${loc}.json`)
  const json = JSON.parse(fs.readFileSync(file, 'utf8'))
  json.brands = json.brands || {}
  json.brands.franchise = json.brands.franchise || {}
  for (const k of Object.keys(F)) json.brands.franchise[k] = F[k][i]
  fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n', 'utf8')
  console.log(`  ✓ ${loc}.json — brands.franchise (+${Object.keys(F).length})`)
})
console.log('[add-brand-franchise-i18n] done.')
