/* eslint-disable */
// ── Agent 58 — affiliate top-level role (Brique A) i18n ──────────────────────────────
// Adds roleSwitcher.spaceAffiliate (the role-space label) + addActivity.affiliate{Title,Desc}
// (the "become an affiliate" hub card) + the affiliate.* namespace (instant-join flow +
// link card + dashboard shell). x5 locales, strict parity, idempotent. FR vouvoiement;
// es/it/en natural; ar real RTL.
// Run: node scripts/add-affiliate-role-i18n.js
const fs = require('fs')
const path = require('path')
const LOCALES = ['fr', 'en', 'es', 'it', 'ar']

// roleSwitcher.<key> — [fr, en, es, it, ar]
const ROLESW = {
  spaceAffiliate: ['Affiliation', 'Affiliate', 'Afiliación', 'Affiliazione', 'الإحالة'],
}

// addActivity.<key>
const ADD = {
  affiliateTitle: ['Devenir affilié', 'Become an affiliate', 'Hazte afiliado', 'Diventa affiliato', 'كن مُحيلاً'],
  affiliateDesc: [
    'Partagez votre lien de parrainage et gagnez une commission sur les commandes apportées. Lien immédiat, sans vérification.',
    'Share your referral link and earn a commission on the orders you bring. Instant link, no verification.',
    'Comparte tu enlace de referido y gana una comisión por los pedidos que traigas. Enlace inmediato, sin verificación.',
    'Condividi il tuo link di referral e guadagna una commissione sugli ordini portati. Link immediato, senza verifica.',
    'شارك رابط الإحالة الخاص بك واكسب عمولة على الطلبات التي تجلبها. رابط فوري بدون تحقق.',
  ],
}

// affiliate.* — the new namespace (join flow + link card + dashboard shell)
const AFF = {
  joinTitle:    ['Devenez affilié Grubano', 'Become a Grubano affiliate', 'Conviértete en afiliado de Grubano', 'Diventa affiliato Grubano', 'كن مُحيلاً في غروبانو'],
  joinSubtitle: [
    'Partagez votre lien, faites découvrir Grubano et gagnez une commission sur les commandes que vous apportez.',
    'Share your link, get Grubano discovered and earn a commission on the orders you bring.',
    'Comparte tu enlace, da a conocer Grubano y gana una comisión por los pedidos que traigas.',
    'Condividi il tuo link, fai scoprire Grubano e guadagna una commissione sugli ordini che porti.',
    'شارك رابطك، عرِّف الناس بغروبانو واكسب عمولة على الطلبات التي تجلبها.',
  ],
  joinPoint1: [
    'Lien de parrainage immédiat, sans aucune vérification.',
    'Instant referral link, with no verification.',
    'Enlace de referido inmediato, sin ninguna verificación.',
    'Link di referral immediato, senza alcuna verifica.',
    'رابط إحالة فوري دون أي تحقق.',
  ],
  joinPoint2: [
    'Une commission sur chaque commande que vous apportez.',
    'A commission on every order you bring.',
    'Una comisión por cada pedido que traigas.',
    'Una commissione su ogni ordine che porti.',
    'عمولة على كل طلب تجلبه.',
  ],
  joinPoint3: [
    'Identité et coordonnées bancaires uniquement au premier retrait.',
    'Identity and bank details only at your first withdrawal.',
    'Identidad y datos bancarios solo en tu primer retiro.',
    'Identità e dati bancari solo al primo prelievo.',
    'الهوية والبيانات المصرفية فقط عند أول سحب.',
  ],
  joinCta:    ['Devenir affilié', 'Become an affiliate', 'Hazte afiliado', 'Diventa affiliato', 'كن مُحيلاً'],
  joining:    ['Activation…', 'Activating…', 'Activando…', 'Attivazione…', 'جارٍ التفعيل…'],
  joinNoVerif: [
    'Aucune vérification requise — votre lien est créé instantanément.',
    'No verification required — your link is created instantly.',
    'No se requiere verificación — tu enlace se crea al instante.',
    'Nessuna verifica richiesta — il tuo link viene creato istantaneamente.',
    'لا حاجة لأي تحقق — يُنشأ رابطك على الفور.',
  ],
  joinedTitle: ['Vous êtes affilié 🎉', "You're an affiliate 🎉", 'Ya eres afiliado 🎉', 'Sei affiliato 🎉', 'أنت الآن مُحيل 🎉'],
  joinedBody: [
    'Votre lien de parrainage est prêt. Partagez-le pour commencer.',
    'Your referral link is ready. Share it to get started.',
    'Tu enlace de referido está listo. Compártelo para empezar.',
    'Il tuo link di referral è pronto. Condividilo per iniziare.',
    'رابط الإحالة الخاص بك جاهز. شاركه للبدء.',
  ],
  goToDashboard: ['Aller à mon espace affilié', 'Go to my affiliate space', 'Ir a mi espacio de afiliado', 'Vai al mio spazio affiliato', 'الذهاب إلى مساحة الإحالة'],
  errorGeneric: [
    'Une erreur est survenue. Veuillez réessayer.',
    'Something went wrong. Please try again.',
    'Ocurrió un error. Inténtelo de nuevo.',
    'Si è verificato un errore. Riprovi.',
    'حدث خطأ. يرجى المحاولة مرة أخرى.',
  ],
  yourLinkTitle: ['Votre lien de parrainage', 'Your referral link', 'Tu enlace de referido', 'Il tuo link di referral', 'رابط الإحالة الخاص بك'],
  yourLinkHint: [
    'Partagez ce lien. Les commandes passées via votre lien vous rapporteront une commission.',
    'Share this link. Orders placed through it will earn you a commission.',
    'Comparte este enlace. Los pedidos realizados a través de él te darán una comisión.',
    'Condividi questo link. Gli ordini effettuati tramite esso ti faranno guadagnare una commissione.',
    'شارك هذا الرابط. الطلبات التي تُجرى عبره ستمنحك عمولة.',
  ],
  copy:   ['Copier', 'Copy', 'Copiar', 'Copia', 'نسخ'],
  copied: ['Copié', 'Copied', 'Copiado', 'Copiato', 'تم النسخ'],
  yourCode: ['Votre code :', 'Your code:', 'Tu código:', 'Il tuo codice:', 'الرمز الخاص بك:'],
  dashTitle:    ['Espace affilié', 'Affiliate space', 'Espacio de afiliado', 'Spazio affiliato', 'مساحة الإحالة'],
  dashSubtitle: [
    'Votre lien de parrainage et bientôt vos gains.',
    'Your referral link and soon your earnings.',
    'Tu enlace de referido y pronto tus ganancias.',
    'Il tuo link di referral e presto i tuoi guadagni.',
    'رابط الإحالة الخاص بك وقريبًا أرباحك.',
  ],
  earningsSoonTitle: ['Vos gains arrivent bientôt', 'Your earnings are coming soon', 'Tus ganancias llegan pronto', 'I tuoi guadagni arrivano presto', 'أرباحك قادمة قريبًا'],
  earningsSoonBody: [
    'Le suivi des commandes parrainées et de vos commissions sera disponible prochainement.',
    'Tracking of referred orders and your commissions will be available soon.',
    'El seguimiento de los pedidos referidos y tus comisiones estará disponible pronto.',
    'Il monitoraggio degli ordini segnalati e delle tue commissioni sarà presto disponibile.',
    'سيتوفر قريبًا تتبُّع الطلبات المُحالة وعمولاتك.',
  ],
  notYetAffiliate: [
    "Vous n'êtes pas encore affilié.",
    "You're not an affiliate yet.",
    'Todavía no eres afiliado.',
    'Non sei ancora affiliato.',
    'لست مُحيلاً بعد.',
  ],
}

LOCALES.forEach((loc, i) => {
  const file = path.join(__dirname, '..', 'messages', `${loc}.json`)
  const json = JSON.parse(fs.readFileSync(file, 'utf8'))
  json.roleSwitcher = json.roleSwitcher || {}
  json.addActivity  = json.addActivity || {}
  json.affiliate    = json.affiliate || {}
  for (const k of Object.keys(ROLESW)) json.roleSwitcher[k] = ROLESW[k][i]
  for (const k of Object.keys(ADD))    json.addActivity[k]  = ADD[k][i]
  for (const k of Object.keys(AFF))    json.affiliate[k]    = AFF[k][i]
  fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n', 'utf8')
  const n = Object.keys(ROLESW).length + Object.keys(ADD).length + Object.keys(AFF).length
  console.log(`  ✓ ${loc}.json — affiliate role A (+${n})`)
})
console.log('[add-affiliate-role-i18n] done.')
