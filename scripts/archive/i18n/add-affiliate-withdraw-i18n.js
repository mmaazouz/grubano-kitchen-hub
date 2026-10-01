// scripts/add-affiliate-withdraw-i18n.js — Brique D2 (Agent 64).
// Idempotent injector for the affiliate withdrawal UI keys (affiliate.* namespace) across
// the 5 locales. Tone matches the existing affiliate.* namespace: FR vouvoiement, ES/IT
// informal, real Arabic. Same merge pattern as add-affiliate-dashboard-i18n.js.
// Run: node scripts/add-affiliate-withdraw-i18n.js
'use strict'
const fs = require('fs')
const path = require('path')

const ADD = {
  fr: {
    withdrawTitle: 'Retrait',
    withdrawBelowThreshold: 'Il vous manque {missing} € pour atteindre le seuil de {threshold} €.',
    withdrawCta: 'Retirer mes gains',
    withdrawKycTitle: "Vérification d'identité requise",
    withdrawKycBody: 'Avant tout versement, vérifiez votre identité (particulier) via notre prestataire de paiement.',
    withdrawKycCta: 'Vérifier mon identité',
    withdrawFiscalTitle: 'Informations fiscales requises',
    withdrawFiscalBody: 'Complétez vos informations fiscales avant votre premier versement.',
    withdrawInProgress: 'Un versement est déjà en cours.',
    withdrawPaid: 'Versement effectué : {amount} €.',
    withdrawFailed: 'Le versement a échoué. Réessayez plus tard.',
    withdrawHistoryTitle: 'Historique des versements',
    payout_pending: 'En cours', payout_paid: 'Versé', payout_failed: 'Échec',
  },
  en: {
    withdrawTitle: 'Withdrawal',
    withdrawBelowThreshold: 'You need {missing} € more to reach the {threshold} € threshold.',
    withdrawCta: 'Withdraw my earnings',
    withdrawKycTitle: 'Identity verification required',
    withdrawKycBody: 'Before any payout, verify your identity (individual) via our payment provider.',
    withdrawKycCta: 'Verify my identity',
    withdrawFiscalTitle: 'Tax information required',
    withdrawFiscalBody: 'Complete your tax information before your first payout.',
    withdrawInProgress: 'A payout is already in progress.',
    withdrawPaid: 'Payout completed: {amount} €.',
    withdrawFailed: 'The payout failed. Please try again later.',
    withdrawHistoryTitle: 'Payout history',
    payout_pending: 'In progress', payout_paid: 'Paid', payout_failed: 'Failed',
  },
  es: {
    withdrawTitle: 'Retiro',
    withdrawBelowThreshold: 'Te faltan {missing} € para alcanzar el umbral de {threshold} €.',
    withdrawCta: 'Retirar mis ganancias',
    withdrawKycTitle: 'Verificación de identidad requerida',
    withdrawKycBody: 'Antes de cualquier pago, verifica tu identidad (particular) a través de nuestro proveedor de pagos.',
    withdrawKycCta: 'Verificar mi identidad',
    withdrawFiscalTitle: 'Información fiscal requerida',
    withdrawFiscalBody: 'Completa tu información fiscal antes de tu primer pago.',
    withdrawInProgress: 'Ya hay un pago en curso.',
    withdrawPaid: 'Pago realizado: {amount} €.',
    withdrawFailed: 'El pago falló. Inténtalo de nuevo más tarde.',
    withdrawHistoryTitle: 'Historial de pagos',
    payout_pending: 'En curso', payout_paid: 'Pagado', payout_failed: 'Fallido',
  },
  it: {
    withdrawTitle: 'Prelievo',
    withdrawBelowThreshold: 'Ti mancano {missing} € per raggiungere la soglia di {threshold} €.',
    withdrawCta: 'Preleva i miei guadagni',
    withdrawKycTitle: "Verifica dell'identità richiesta",
    withdrawKycBody: 'Prima di qualsiasi versamento, verifica la tua identità (privato) tramite il nostro fornitore di pagamenti.',
    withdrawKycCta: 'Verifica la mia identità',
    withdrawFiscalTitle: 'Informazioni fiscali richieste',
    withdrawFiscalBody: 'Completa le tue informazioni fiscali prima del primo versamento.',
    withdrawInProgress: 'Un versamento è già in corso.',
    withdrawPaid: 'Versamento effettuato: {amount} €.',
    withdrawFailed: 'Il versamento non è riuscito. Riprova più tardi.',
    withdrawHistoryTitle: 'Cronologia dei versamenti',
    payout_pending: 'In corso', payout_paid: 'Versato', payout_failed: 'Fallito',
  },
  ar: {
    withdrawTitle: 'السحب',
    withdrawBelowThreshold: 'ينقصك {missing} € للوصول إلى الحد الأدنى {threshold} €.',
    withdrawCta: 'اسحب أرباحي',
    withdrawKycTitle: 'التحقق من الهوية مطلوب',
    withdrawKycBody: 'قبل أي دفعة، تحقّق من هويتك (فرد) عبر مزوّد الدفع لدينا.',
    withdrawKycCta: 'تحقّق من هويتي',
    withdrawFiscalTitle: 'المعلومات الضريبية مطلوبة',
    withdrawFiscalBody: 'أكمل معلوماتك الضريبية قبل أول دفعة لك.',
    withdrawInProgress: 'هناك دفعة قيد التنفيذ بالفعل.',
    withdrawPaid: 'تمت الدفعة: {amount} €.',
    withdrawFailed: 'فشلت الدفعة. حاول مرة أخرى لاحقًا.',
    withdrawHistoryTitle: 'سجل الدفعات',
    payout_pending: 'قيد التنفيذ', payout_paid: 'مدفوع', payout_failed: 'فشل',
  },
}

let changed = 0
for (const loc of Object.keys(ADD)) {
  const file = path.join(__dirname, '..', 'messages', `${loc}.json`)
  const json = JSON.parse(fs.readFileSync(file, 'utf8'))
  json.affiliate = json.affiliate || {}
  Object.assign(json.affiliate, ADD[loc])
  fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n', 'utf8')
  changed++
  console.log(`✓ ${loc}: +${Object.keys(ADD[loc]).length} affiliate.* withdraw keys`)
}
console.log(`Done — ${changed} locale files updated.`)
