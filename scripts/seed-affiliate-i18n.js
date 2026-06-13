// scripts/seed-affiliate-i18n.js — Dashboard Affiliés Slice 2a (Agent 14).
// Idempotent injector for the `creators.affiliate.*` namespace + the nav label
// `creators.nav.affiliateHub`, across the 5 locales. Same pattern as
// seed-promo-v2-i18n.js / seed-campaign-i18n.js (merge-friendly: reads current
// disk, adds only these keys, writes 2-space JSON). Run: node scripts/seed-affiliate-i18n.js
'use strict'
const fs = require('fs')
const path = require('path')

const NAV = { fr: 'Tableau affilié', en: 'Affiliate dashboard', es: 'Panel de afiliación', it: 'Cruscotto affiliazione', ar: 'لوحة الإحالة' }

const AFF = {
  fr: {
    noProfile: 'Profil créateur introuvable.', errLoad: "Impossible de charger ton affiliation.", loading: 'Chargement…', retry: 'Réessayer',
    lockedTitle: 'Affiliation non activée', lockedBody: "Active ton rôle Influenceur pour suivre tes liens et tes gains d'affiliation.",
    title: 'Mon affiliation', subtitle: 'Tes liens, tes clients référés et tes gains — en toute transparence.',
    pulseMonth: 'Ce mois-ci', pulseVsPrev: 'vs {amount} le mois dernier', pulseCustomers: 'Clients référés', pulseOrders: 'Commandes',
    linksTitle: 'Mes liens & codes', copied: 'Copié', copyCode: 'Copier le code', copyLink: 'Copier le lien', hideQr: 'Masquer le QR', showQr: 'Afficher le QR',
    qrHint: "Scanne pour ouvrir ton lien d'affiliation.", noCode: "Ton code d'affiliation arrive bientôt.",
    deepLinkTitle: 'Lien vers un restaurant précis', deepLinkPick: 'Choisir un restaurant…',
    pending: 'En attente', pendingHint: 'Maturation à 7 jours.', matured: 'Acquis', maturedHint: 'Prêt au versement.',
    transparency: 'Tu gagnes {pct} % de la marge nette de Grubano (commission − frais Stripe − royalty créateur) — V1.5.',
    gainsTitle: 'Mes commandes référées', orderTotal: 'Commande', orderGain: 'Gain',
    statusPending: 'En attente', statusMatured: 'Acquis', statusPaid: 'Versé', statusCancelled: 'Annulé',
    activityTitle: 'Activité récente', activityLine: 'Commande référée — +{amount} chez {restaurant}',
    emptyTitle: 'Pas encore de parrainage', emptyBody: "Partage ton lien ou ton QR : dès qu'un client commande, ton gain apparaît ici.",
    payoutTitle: 'Versement', payoutActivationPending: "Versements en attente d'activation (immatriculation requise).",
    soonStudioTitle: 'Studio de contenu', soonStudioBody: 'Crée des visuels et des liens prêts à publier.',
    soonTiersTitle: 'Paliers & statut', soonTiersBody: 'Débloque des récompenses selon tes performances.',
    soonPerfTitle: 'Performance', soonPerfBody: 'Suivi des clics et taux de conversion.', soonBadge: 'Bientôt',
    studioTitle: 'Studio de contenu', studioDesc: 'Choisis une cible, génère des légendes prêtes à poster + une carte partageable.',
    studioPickResto: 'Choisir un restaurant…', studioDishAll: 'Tout le restaurant',
    studioGenerate: 'Générer', studioGenerating: 'Génération…', studioErr: 'Génération indisponible, réessaie.',
    studioRateLimited: 'Limite atteinte — réessaie plus tard.', studioCaptionsTitle: 'Légendes', studioCardTitle: 'Carte partageable',
    studioCardCta: 'Commande sur Grubano 🍽️', studioDownloadCard: 'Télécharger la carte',
    toneEnthusiastic: 'Enthousiaste', tonePunchy: 'Court & punchy', toneStorytelling: 'Storytelling', copyCaption: 'Copier',
  },
  en: {
    noProfile: 'Creator profile not found.', errLoad: "Couldn't load your affiliation.", loading: 'Loading…', retry: 'Retry',
    lockedTitle: 'Affiliation not enabled', lockedBody: 'Turn on your Influencer role to track your affiliate links and earnings.',
    title: 'My affiliation', subtitle: 'Your links, your referred customers and your earnings — fully transparent.',
    pulseMonth: 'This month', pulseVsPrev: 'vs {amount} last month', pulseCustomers: 'Referred customers', pulseOrders: 'Orders',
    linksTitle: 'My links & codes', copied: 'Copied', copyCode: 'Copy code', copyLink: 'Copy link', hideQr: 'Hide QR', showQr: 'Show QR',
    qrHint: 'Scan to open your affiliate link.', noCode: 'Your affiliate code is coming soon.',
    deepLinkTitle: 'Link to a specific restaurant', deepLinkPick: 'Choose a restaurant…',
    pending: 'Pending', pendingHint: '7-day maturation.', matured: 'Earned', maturedHint: 'Ready to pay out.',
    transparency: 'You earn {pct}% of Grubano’s net margin (commission − Stripe fee − creator royalty) — V1.5.',
    gainsTitle: 'My referred orders', orderTotal: 'Order', orderGain: 'Gain',
    statusPending: 'Pending', statusMatured: 'Earned', statusPaid: 'Paid', statusCancelled: 'Cancelled',
    activityTitle: 'Recent activity', activityLine: 'Referred order — +{amount} at {restaurant}',
    emptyTitle: 'No referrals yet', emptyBody: 'Share your link or QR: as soon as a customer orders, your gain shows up here.',
    payoutTitle: 'Payout', payoutActivationPending: 'Payouts pending activation (registration required).',
    soonStudioTitle: 'Content studio', soonStudioBody: 'Create ready-to-post visuals and links.',
    soonTiersTitle: 'Tiers & status', soonTiersBody: 'Unlock rewards based on your performance.',
    soonPerfTitle: 'Performance', soonPerfBody: 'Click tracking and conversion rate.', soonBadge: 'Soon',
    studioTitle: 'Content studio', studioDesc: 'Pick a target, generate ready-to-post captions + a shareable card.',
    studioPickResto: 'Choose a restaurant…', studioDishAll: 'Whole restaurant',
    studioGenerate: 'Generate', studioGenerating: 'Generating…', studioErr: 'Generation unavailable, try again.',
    studioRateLimited: 'Limit reached — try again later.', studioCaptionsTitle: 'Captions', studioCardTitle: 'Shareable card',
    studioCardCta: 'Order on Grubano 🍽️', studioDownloadCard: 'Download card',
    toneEnthusiastic: 'Enthusiastic', tonePunchy: 'Short & punchy', toneStorytelling: 'Storytelling', copyCaption: 'Copy',
  },
  es: {
    noProfile: 'Perfil de creador no encontrado.', errLoad: 'No se pudo cargar tu afiliación.', loading: 'Cargando…', retry: 'Reintentar',
    lockedTitle: 'Afiliación no activada', lockedBody: 'Activa tu rol de Influencer para seguir tus enlaces y ganancias de afiliación.',
    title: 'Mi afiliación', subtitle: 'Tus enlaces, tus clientes referidos y tus ganancias — con total transparencia.',
    pulseMonth: 'Este mes', pulseVsPrev: 'vs {amount} el mes pasado', pulseCustomers: 'Clientes referidos', pulseOrders: 'Pedidos',
    linksTitle: 'Mis enlaces y códigos', copied: 'Copiado', copyCode: 'Copiar código', copyLink: 'Copiar enlace', hideQr: 'Ocultar QR', showQr: 'Mostrar QR',
    qrHint: 'Escanea para abrir tu enlace de afiliación.', noCode: 'Tu código de afiliación llegará pronto.',
    deepLinkTitle: 'Enlace a un restaurante concreto', deepLinkPick: 'Elegir un restaurante…',
    pending: 'Pendiente', pendingHint: 'Maduración a 7 días.', matured: 'Ganado', maturedHint: 'Listo para el pago.',
    transparency: 'Ganas el {pct}% del margen neto de Grubano (comisión − comisión Stripe − royalty del creador) — V1.5.',
    gainsTitle: 'Mis pedidos referidos', orderTotal: 'Pedido', orderGain: 'Ganancia',
    statusPending: 'Pendiente', statusMatured: 'Ganado', statusPaid: 'Pagado', statusCancelled: 'Cancelado',
    activityTitle: 'Actividad reciente', activityLine: 'Pedido referido — +{amount} en {restaurant}',
    emptyTitle: 'Aún no hay referidos', emptyBody: 'Comparte tu enlace o QR: en cuanto un cliente pida, tu ganancia aparecerá aquí.',
    payoutTitle: 'Pago', payoutActivationPending: 'Pagos pendientes de activación (registro requerido).',
    soonStudioTitle: 'Estudio de contenido', soonStudioBody: 'Crea visuales y enlaces listos para publicar.',
    soonTiersTitle: 'Niveles y estatus', soonTiersBody: 'Desbloquea recompensas según tu rendimiento.',
    soonPerfTitle: 'Rendimiento', soonPerfBody: 'Seguimiento de clics y tasa de conversión.', soonBadge: 'Pronto',
    studioTitle: 'Estudio de contenido', studioDesc: 'Elige un objetivo, genera leyendas listas para publicar + una tarjeta para compartir.',
    studioPickResto: 'Elegir un restaurante…', studioDishAll: 'Todo el restaurante',
    studioGenerate: 'Generar', studioGenerating: 'Generando…', studioErr: 'Generación no disponible, inténtalo de nuevo.',
    studioRateLimited: 'Límite alcanzado — inténtalo más tarde.', studioCaptionsTitle: 'Leyendas', studioCardTitle: 'Tarjeta para compartir',
    studioCardCta: 'Pide en Grubano 🍽️', studioDownloadCard: 'Descargar tarjeta',
    toneEnthusiastic: 'Entusiasta', tonePunchy: 'Corto y directo', toneStorytelling: 'Storytelling', copyCaption: 'Copiar',
  },
  it: {
    noProfile: 'Profilo creator non trovato.', errLoad: 'Impossibile caricare la tua affiliazione.', loading: 'Caricamento…', retry: 'Riprova',
    lockedTitle: 'Affiliazione non attivata', lockedBody: 'Attiva il tuo ruolo Influencer per seguire i tuoi link e i guadagni di affiliazione.',
    title: 'La mia affiliazione', subtitle: 'I tuoi link, i tuoi clienti referenziati e i tuoi guadagni — in piena trasparenza.',
    pulseMonth: 'Questo mese', pulseVsPrev: 'vs {amount} il mese scorso', pulseCustomers: 'Clienti referenziati', pulseOrders: 'Ordini',
    linksTitle: 'I miei link e codici', copied: 'Copiato', copyCode: 'Copia codice', copyLink: 'Copia link', hideQr: 'Nascondi QR', showQr: 'Mostra QR',
    qrHint: 'Scansiona per aprire il tuo link di affiliazione.', noCode: 'Il tuo codice di affiliazione arriva presto.',
    deepLinkTitle: 'Link a un ristorante specifico', deepLinkPick: 'Scegli un ristorante…',
    pending: 'In attesa', pendingHint: 'Maturazione a 7 giorni.', matured: 'Maturato', maturedHint: 'Pronto al versamento.',
    transparency: 'Guadagni il {pct}% del margine netto di Grubano (commissione − commissione Stripe − royalty del creator) — V1.5.',
    gainsTitle: 'I miei ordini referenziati', orderTotal: 'Ordine', orderGain: 'Guadagno',
    statusPending: 'In attesa', statusMatured: 'Maturato', statusPaid: 'Pagato', statusCancelled: 'Annullato',
    activityTitle: 'Attività recente', activityLine: 'Ordine referenziato — +{amount} da {restaurant}',
    emptyTitle: 'Ancora nessun referral', emptyBody: 'Condividi il tuo link o QR: appena un cliente ordina, il tuo guadagno appare qui.',
    payoutTitle: 'Versamento', payoutActivationPending: 'Versamenti in attesa di attivazione (registrazione richiesta).',
    soonStudioTitle: 'Studio contenuti', soonStudioBody: 'Crea visual e link pronti da pubblicare.',
    soonTiersTitle: 'Livelli e status', soonTiersBody: 'Sblocca premi in base alle tue performance.',
    soonPerfTitle: 'Performance', soonPerfBody: 'Monitoraggio clic e tasso di conversione.', soonBadge: 'Presto',
    studioTitle: 'Studio contenuti', studioDesc: 'Scegli un obiettivo, genera didascalie pronte da pubblicare + una card condivisibile.',
    studioPickResto: 'Scegli un ristorante…', studioDishAll: 'Tutto il ristorante',
    studioGenerate: 'Genera', studioGenerating: 'Generazione…', studioErr: 'Generazione non disponibile, riprova.',
    studioRateLimited: 'Limite raggiunto — riprova più tardi.', studioCaptionsTitle: 'Didascalie', studioCardTitle: 'Card condivisibile',
    studioCardCta: 'Ordina su Grubano 🍽️', studioDownloadCard: 'Scarica la card',
    toneEnthusiastic: 'Entusiasta', tonePunchy: 'Breve e diretto', toneStorytelling: 'Storytelling', copyCaption: 'Copia',
  },
  ar: {
    noProfile: 'لم يتم العثور على ملف المبدع.', errLoad: 'تعذّر تحميل إحالاتك.', loading: 'جارٍ التحميل…', retry: 'إعادة المحاولة',
    lockedTitle: 'الإحالة غير مُفعّلة', lockedBody: 'فعّل دور المؤثّر لتتبّع روابطك وأرباح الإحالة.',
    title: 'إحالاتي', subtitle: 'روابطك وعملاؤك المُحالون وأرباحك — بشفافية كاملة.',
    pulseMonth: 'هذا الشهر', pulseVsPrev: 'مقابل {amount} الشهر الماضي', pulseCustomers: 'العملاء المُحالون', pulseOrders: 'الطلبات',
    linksTitle: 'روابطي ورموزي', copied: 'تم النسخ', copyCode: 'نسخ الرمز', copyLink: 'نسخ الرابط', hideQr: 'إخفاء رمز QR', showQr: 'إظهار رمز QR',
    qrHint: 'امسح لفتح رابط الإحالة الخاص بك.', noCode: 'رمز الإحالة الخاص بك قادم قريبًا.',
    deepLinkTitle: 'رابط إلى مطعم محدّد', deepLinkPick: 'اختر مطعمًا…',
    pending: 'قيد الانتظار', pendingHint: 'نضج خلال 7 أيام.', matured: 'مكتسب', maturedHint: 'جاهز للصرف.',
    transparency: 'تكسب {pct}٪ من صافي هامش غروبانو (العمولة − رسوم Stripe − حقوق المبدع) — V1.5.',
    gainsTitle: 'طلباتي المُحالة', orderTotal: 'الطلب', orderGain: 'الربح',
    statusPending: 'قيد الانتظار', statusMatured: 'مكتسب', statusPaid: 'مدفوع', statusCancelled: 'ملغى',
    activityTitle: 'النشاط الأخير', activityLine: 'طلب مُحال — +{amount} لدى {restaurant}',
    emptyTitle: 'لا إحالات بعد', emptyBody: 'شارك رابطك أو رمز QR: بمجرد أن يطلب عميل، يظهر ربحك هنا.',
    payoutTitle: 'الصرف', payoutActivationPending: 'المدفوعات بانتظار التفعيل (التسجيل مطلوب).',
    soonStudioTitle: 'استوديو المحتوى', soonStudioBody: 'أنشئ تصاميم وروابط جاهزة للنشر.',
    soonTiersTitle: 'المستويات والحالة', soonTiersBody: 'افتح مكافآت حسب أدائك.',
    soonPerfTitle: 'الأداء', soonPerfBody: 'تتبّع النقرات ومعدّل التحويل.', soonBadge: 'قريبًا',
    studioTitle: 'استوديو المحتوى', studioDesc: 'اختر هدفًا، ولّد تسميات جاهزة للنشر + بطاقة قابلة للمشاركة.',
    studioPickResto: 'اختر مطعمًا…', studioDishAll: 'المطعم بالكامل',
    studioGenerate: 'توليد', studioGenerating: 'جارٍ التوليد…', studioErr: 'التوليد غير متاح، حاول مجددًا.',
    studioRateLimited: 'تم بلوغ الحد — حاول لاحقًا.', studioCaptionsTitle: 'التسميات', studioCardTitle: 'بطاقة للمشاركة',
    studioCardCta: 'اطلب عبر Grubano 🍽️', studioDownloadCard: 'تنزيل البطاقة',
    toneEnthusiastic: 'متحمّس', tonePunchy: 'قصير ومباشر', toneStorytelling: 'سرد قصصي', copyCaption: 'نسخ',
  },
}

let changed = 0
for (const loc of Object.keys(AFF)) {
  const file = path.join(__dirname, '..', 'messages', `${loc}.json`)
  const json = JSON.parse(fs.readFileSync(file, 'utf8'))
  json.creators = json.creators || {}
  json.creators.nav = json.creators.nav || {}
  json.creators.nav.affiliateHub = NAV[loc]
  json.creators.affiliate = AFF[loc]
  fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n', 'utf8')
  changed++
  console.log(`✓ ${loc}: creators.affiliate (${Object.keys(AFF[loc]).length} keys) + nav.affiliateHub`)
}
console.log(`Done — ${changed} locale files updated.`)
