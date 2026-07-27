// scripts/add-influencer-verify-i18n.js — INF-1 (Agent 66).
// Adds the audience-verification keys: affiliate.verify* / platform_* (affiliate-facing UI,
// FR vouvoiement, ES/IT informal to match the affiliate.* namespace, real Arabic) and
// admin.influencerVerif.* (admin console). Idempotent merge; 2-space JSON + newline.
// Run: node scripts/add-influencer-verify-i18n.js
'use strict'
const fs = require('fs')
const path = require('path')

const AFF = {
  fr: {
    verifyTitle: 'Devenir influenceur',
    verifyBody: 'Faites vérifier votre audience pour débloquer le statut influenceur. (Sans effet sur vos commissions pour le moment.)',
    verifyPlatform: 'Plateforme', verifyHandle: 'Identifiant / chaîne', verifyFollowers: "Nombre d'abonnés", verifyProofUrl: 'Lien de preuve (optionnel)',
    verifySubmit: 'Demander la vérification', verifyReapply: 'Renvoyer une demande',
    verifyPending: 'Votre demande est en attente de validation.',
    verifyApprovedTitle: 'Audience vérifiée', verifyApprovedBody: "Vous êtes influenceur. Vos commissions ne changent pas encore — c'est pour bientôt.",
    verifiedBadge: 'Influenceur',
    verifyRejected: 'Votre demande a été refusée. Vous pouvez la renvoyer.',
    verifyError: 'Action impossible — réessayez.', verifyAlreadyPending: 'Une demande est déjà en attente.', verifyAlreadyVerified: 'Votre audience est déjà vérifiée.',
    platform_youtube: 'YouTube', platform_instagram: 'Instagram', platform_tiktok: 'TikTok', platform_other: 'Autre',
  },
  en: {
    verifyTitle: 'Become an influencer',
    verifyBody: 'Get your audience verified to unlock the influencer status. (No effect on your commissions yet.)',
    verifyPlatform: 'Platform', verifyHandle: 'Handle / channel', verifyFollowers: 'Follower count', verifyProofUrl: 'Proof link (optional)',
    verifySubmit: 'Request verification', verifyReapply: 'Re-submit a request',
    verifyPending: 'Your request is awaiting review.',
    verifyApprovedTitle: 'Audience verified', verifyApprovedBody: "You're an influencer. Your commissions don't change yet — that's coming soon.",
    verifiedBadge: 'Influencer',
    verifyRejected: 'Your request was declined. You can re-submit it.',
    verifyError: 'Action unavailable — try again.', verifyAlreadyPending: 'A request is already pending.', verifyAlreadyVerified: 'Your audience is already verified.',
    platform_youtube: 'YouTube', platform_instagram: 'Instagram', platform_tiktok: 'TikTok', platform_other: 'Other',
  },
  es: {
    verifyTitle: 'Conviértete en influencer',
    verifyBody: 'Verifica tu audiencia para desbloquear el estatus de influencer. (Sin efecto en tus comisiones por ahora.)',
    verifyPlatform: 'Plataforma', verifyHandle: 'Usuario / canal', verifyFollowers: 'Número de seguidores', verifyProofUrl: 'Enlace de prueba (opcional)',
    verifySubmit: 'Solicitar verificación', verifyReapply: 'Reenviar una solicitud',
    verifyPending: 'Tu solicitud está pendiente de revisión.',
    verifyApprovedTitle: 'Audiencia verificada', verifyApprovedBody: 'Eres influencer. Tus comisiones aún no cambian — llegará pronto.',
    verifiedBadge: 'Influencer',
    verifyRejected: 'Tu solicitud fue rechazada. Puedes reenviarla.',
    verifyError: 'Acción no disponible — inténtalo de nuevo.', verifyAlreadyPending: 'Ya hay una solicitud pendiente.', verifyAlreadyVerified: 'Tu audiencia ya está verificada.',
    platform_youtube: 'YouTube', platform_instagram: 'Instagram', platform_tiktok: 'TikTok', platform_other: 'Otra',
  },
  it: {
    verifyTitle: 'Diventa influencer',
    verifyBody: 'Fai verificare il tuo pubblico per sbloccare lo status di influencer. (Nessun effetto sulle tue commissioni per ora.)',
    verifyPlatform: 'Piattaforma', verifyHandle: 'Handle / canale', verifyFollowers: 'Numero di follower', verifyProofUrl: 'Link di prova (opzionale)',
    verifySubmit: 'Richiedi la verifica', verifyReapply: 'Reinvia una richiesta',
    verifyPending: 'La tua richiesta è in attesa di revisione.',
    verifyApprovedTitle: 'Pubblico verificato', verifyApprovedBody: 'Sei un influencer. Le tue commissioni non cambiano ancora — arriverà presto.',
    verifiedBadge: 'Influencer',
    verifyRejected: 'La tua richiesta è stata rifiutata. Puoi reinviarla.',
    verifyError: 'Azione non disponibile — riprova.', verifyAlreadyPending: 'Una richiesta è già in attesa.', verifyAlreadyVerified: 'Il tuo pubblico è già verificato.',
    platform_youtube: 'YouTube', platform_instagram: 'Instagram', platform_tiktok: 'TikTok', platform_other: 'Altro',
  },
  ar: {
    verifyTitle: 'كن مؤثّرًا',
    verifyBody: 'تحقّق من جمهورك لفتح حالة المؤثّر. (لا تأثير على عمولاتك حاليًا.)',
    verifyPlatform: 'المنصّة', verifyHandle: 'المعرّف / القناة', verifyFollowers: 'عدد المتابعين', verifyProofUrl: 'رابط إثبات (اختياري)',
    verifySubmit: 'طلب التحقّق', verifyReapply: 'إعادة إرسال الطلب',
    verifyPending: 'طلبك قيد المراجعة.',
    verifyApprovedTitle: 'تم التحقّق من الجمهور', verifyApprovedBody: 'أنت مؤثّر الآن. عمولاتك لا تتغيّر بعد — قريبًا.',
    verifiedBadge: 'مؤثّر',
    verifyRejected: 'تم رفض طلبك. يمكنك إعادة إرساله.',
    verifyError: 'الإجراء غير متاح — حاول مجددًا.', verifyAlreadyPending: 'هناك طلب قيد الانتظار بالفعل.', verifyAlreadyVerified: 'تم التحقّق من جمهورك بالفعل.',
    platform_youtube: 'يوتيوب', platform_instagram: 'إنستغرام', platform_tiktok: 'تيك توك', platform_other: 'أخرى',
  },
}

const ADMIN = {
  fr: { title: "Vérifications d'audience", subtitle: 'Approuvez ou refusez les demandes de statut influenceur des affiliés.', emptyTitle: 'Aucune demande', emptyBody: "Aucune demande de vérification d'audience pour le moment.", approve: 'Approuver', reject: 'Refuser', proof: 'Preuve', status_pending: 'En attente', status_approved: 'Approuvée', status_rejected: 'Refusée' },
  en: { title: 'Audience verifications', subtitle: 'Approve or decline affiliates’ influencer-status requests.', emptyTitle: 'No requests', emptyBody: 'No audience-verification requests yet.', approve: 'Approve', reject: 'Decline', proof: 'Proof', status_pending: 'Pending', status_approved: 'Approved', status_rejected: 'Declined' },
  es: { title: 'Verificaciones de audiencia', subtitle: 'Aprueba o rechaza las solicitudes de estatus de influencer de los afiliados.', emptyTitle: 'Sin solicitudes', emptyBody: 'Aún no hay solicitudes de verificación de audiencia.', approve: 'Aprobar', reject: 'Rechazar', proof: 'Prueba', status_pending: 'Pendiente', status_approved: 'Aprobada', status_rejected: 'Rechazada' },
  it: { title: 'Verifiche del pubblico', subtitle: 'Approva o rifiuta le richieste di status influencer degli affiliati.', emptyTitle: 'Nessuna richiesta', emptyBody: 'Ancora nessuna richiesta di verifica del pubblico.', approve: 'Approva', reject: 'Rifiuta', proof: 'Prova', status_pending: 'In attesa', status_approved: 'Approvata', status_rejected: 'Rifiutata' },
  ar: { title: 'عمليات التحقّق من الجمهور', subtitle: 'وافق على طلبات حالة المؤثّر للمسوّقين أو ارفضها.', emptyTitle: 'لا طلبات', emptyBody: 'لا توجد طلبات تحقّق من الجمهور بعد.', approve: 'موافقة', reject: 'رفض', proof: 'إثبات', status_pending: 'قيد الانتظار', status_approved: 'موافَق عليها', status_rejected: 'مرفوضة' },
}

let changed = 0
for (const loc of Object.keys(AFF)) {
  const file = path.join(__dirname, '..', 'messages', `${loc}.json`)
  const json = JSON.parse(fs.readFileSync(file, 'utf8'))
  json.affiliate = json.affiliate || {}
  Object.assign(json.affiliate, AFF[loc])
  json.admin = json.admin || {}
  json.admin.influencerVerif = { ...(json.admin.influencerVerif || {}), ...ADMIN[loc] }
  fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n', 'utf8')
  changed++
  console.log(`✓ ${loc}: +${Object.keys(AFF[loc]).length} affiliate.verify* + ${Object.keys(ADMIN[loc]).length} admin.influencerVerif`)
}
console.log(`Done — ${changed} locale files updated.`)
