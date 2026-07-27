// scripts/add-admin-suppliers-i18n.js — Admin supplier console (Agent 85).
// Adds admin.suppliers.* (list + status/verdict labels + activate/suspend).
// FR vouvoiement, real Arabic (RTL). Idempotent; 2-space JSON. NON-MONEY admin tool.
// Run: node scripts/add-admin-suppliers-i18n.js
'use strict'
const fs = require('fs')
const path = require('path')

const ADD = {
  fr: {
    title: "Fournisseurs", subtitle: "Gérez les fournisseurs du réseau : consultez leur statut et leur vérification, activez ou suspendez un compte.",
    emptyTitle: "Aucun fournisseur", emptyBody: "Aucun fournisseur n’est encore inscrit.",
    siren: "SIREN", sirenNone: "non renseigné",
    status_pending: "En attente", status_active: "Actif", status_suspended: "Suspendu", status_rejected: "Refusé",
    verdict_legit: "Vetting : fiable", verdict_doubt: "Vetting : à vérifier", verdict_bad: "Vetting : douteux", verdict_unknown: "Vetting : non évalué",
    verif_verified: "SIREN vérifié", verif_review: "SIREN à vérifier", verif_rejected: "SIREN introuvable", verif_unknown: "SIREN non vérifié",
    activate: "Activer", suspend: "Suspendre", actionError: "L’action a échoué. Réessayez.",
  },
  en: {
    title: "Suppliers", subtitle: "Manage network suppliers: review their status and verification, activate or suspend an account.",
    emptyTitle: "No suppliers", emptyBody: "No supplier has registered yet.",
    siren: "SIREN", sirenNone: "not provided",
    status_pending: "Pending", status_active: "Active", status_suspended: "Suspended", status_rejected: "Rejected",
    verdict_legit: "Vetting: trusted", verdict_doubt: "Vetting: to review", verdict_bad: "Vetting: doubtful", verdict_unknown: "Vetting: not assessed",
    verif_verified: "SIREN verified", verif_review: "SIREN to review", verif_rejected: "SIREN not found", verif_unknown: "SIREN unverified",
    activate: "Activate", suspend: "Suspend", actionError: "The action failed. Please try again.",
  },
  es: {
    title: "Proveedores", subtitle: "Gestione los proveedores de la red: consulte su estado y verificación, active o suspenda una cuenta.",
    emptyTitle: "Sin proveedores", emptyBody: "Aún no se ha registrado ningún proveedor.",
    siren: "SIREN", sirenNone: "no indicado",
    status_pending: "Pendiente", status_active: "Activo", status_suspended: "Suspendido", status_rejected: "Rechazado",
    verdict_legit: "Verificación: fiable", verdict_doubt: "Verificación: por revisar", verdict_bad: "Verificación: dudoso", verdict_unknown: "Verificación: sin evaluar",
    verif_verified: "SIREN verificado", verif_review: "SIREN por revisar", verif_rejected: "SIREN no encontrado", verif_unknown: "SIREN sin verificar",
    activate: "Activar", suspend: "Suspender", actionError: "La acción ha fallado. Inténtelo de nuevo.",
  },
  it: {
    title: "Fornitori", subtitle: "Gestite i fornitori della rete: consultate stato e verifica, attivate o sospendete un account.",
    emptyTitle: "Nessun fornitore", emptyBody: "Nessun fornitore si è ancora registrato.",
    siren: "SIREN", sirenNone: "non indicato",
    status_pending: "In attesa", status_active: "Attivo", status_suspended: "Sospeso", status_rejected: "Rifiutato",
    verdict_legit: "Verifica: affidabile", verdict_doubt: "Verifica: da controllare", verdict_bad: "Verifica: dubbio", verdict_unknown: "Verifica: non valutato",
    verif_verified: "SIREN verificato", verif_review: "SIREN da controllare", verif_rejected: "SIREN non trovato", verif_unknown: "SIREN non verificato",
    activate: "Attivare", suspend: "Sospendere", actionError: "L’azione non è riuscita. Riprovate.",
  },
  ar: {
    title: "الموردون", subtitle: "أدِر موردي الشبكة: اطّلِع على حالتهم والتحقق منهم، وفعِّل حسابًا أو علِّقه.",
    emptyTitle: "لا يوجد موردون", emptyBody: "لم يُسجَّل أي مورد بعد.",
    siren: "SIREN", sirenNone: "غير محدَّد",
    status_pending: "قيد الانتظار", status_active: "نشط", status_suspended: "موقوف", status_rejected: "مرفوض",
    verdict_legit: "التحقق: موثوق", verdict_doubt: "التحقق: للمراجعة", verdict_bad: "التحقق: مشكوك فيه", verdict_unknown: "التحقق: غير مُقيَّم",
    verif_verified: "تم التحقق من SIREN", verif_review: "SIREN للمراجعة", verif_rejected: "تعذّر العثور على SIREN", verif_unknown: "SIREN غير مُتحقَّق منه",
    activate: "تفعيل", suspend: "تعليق", actionError: "فشل الإجراء. حاول مجدّدًا.",
  },
}

let changed = 0
for (const loc of Object.keys(ADD)) {
  const file = path.join(__dirname, '..', 'messages', `${loc}.json`)
  const json = JSON.parse(fs.readFileSync(file, 'utf8'))
  json.admin = json.admin || {}
  json.admin.suppliers = Object.assign({}, json.admin.suppliers, ADD[loc])
  fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n', 'utf8')
  changed++
  console.log(`✓ ${loc}: admin.suppliers.*`)
}
console.log(`Done — ${changed} locale files updated.`)
