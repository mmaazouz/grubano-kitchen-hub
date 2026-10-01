// Seed i18n — FIX passe 2/2 horaires (Agent 13).
// Une seule clé nouvelle : hours.ongoingInfo — ligne informative de la modale
// de conflits pour les sessions EN COURS (conflicts.ongoing, contrat Agent 2
// 6a6e6a3) : elles ne sont JAMAIS annulées, ton calme, aucune action.
//
// Usage: node scripts/seed-fix-horaires-ui-i18n.js   puis   npm run check:i18n

const fs = require('fs')
const path = require('path')

const KEYS = {
  fr: '{count, plural, =1 {1 session en cours — le client à table terminera normalement (commande et paiement restent possibles).} other {# sessions en cours — les clients à table termineront normalement (commande et paiement restent possibles).}}',
  en: '{count, plural, =1 {1 ongoing session — the seated guest will finish normally (ordering and payment stay available).} other {# ongoing sessions — the seated guests will finish normally (ordering and payment stay available).}}',
  es: '{count, plural, =1 {1 sesión en curso — el cliente en mesa terminará con normalidad (pedido y pago siguen disponibles).} other {# sesiones en curso — los clientes en mesa terminarán con normalidad (pedido y pago siguen disponibles).}}',
  it: '{count, plural, =1 {1 sessione in corso — il cliente al tavolo terminerà normalmente (ordine e pagamento restano possibili).} other {# sessioni in corso — i clienti al tavolo termineranno normalmente (ordine e pagamento restano possibili).}}',
  ar: '{count, plural, =1 {جلسة واحدة جارية — سيُنهي الضيف الجالس وجبته بشكل طبيعي (يبقى الطلب والدفع متاحين).} other {# جلسات جارية — سيُنهي الضيوف الجالسون وجباتهم بشكل طبيعي (يبقى الطلب والدفع متاحين).}}',
}

for (const loc of ['fr', 'en', 'es', 'it', 'ar']) {
  const file = path.join(__dirname, '..', 'messages', `${loc}.json`)
  const m = JSON.parse(fs.readFileSync(file, 'utf8'))
  if (!m.hours || typeof m.hours !== 'object') m.hours = {}
  m.hours.ongoingInfo = KEYS[loc]
  fs.writeFileSync(file, JSON.stringify(m, null, 2) + '\n', 'utf8')
  console.log(`[seed-fix-horaires-ui-i18n] ${loc}.json OK`)
}
console.log('[seed-fix-horaires-ui-i18n] Done — run: npm run check:i18n')
