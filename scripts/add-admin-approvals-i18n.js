/* eslint-disable */
// ── B2.4 / SEC2 — admin approval console i18n (Agent 33) ──────────────────────
// Adds admin.approvals.* — the ADMIN-only console that approves establishments
// awaiting their first publication (the SEC1 invariant: an owner can never self-
// publish a never-approved resto) and pending franchise applications. x5 locales,
// strict parity, idempotent. FR vouvoiement; es/it natural; ar real RTL Arabic.
// Run: node scripts/add-admin-approvals-i18n.js
const fs = require('fs')
const path = require('path')
const LOCALES = ['fr', 'en', 'es', 'it', 'ar']

// admin.approvals.* — [fr, en, es, it, ar]
const A = {
  title:    ['Validations', 'Approvals', 'Validaciones', 'Approvazioni', 'الموافقات'],
  subtitle: [
    'Validez la mise en ligne des établissements et les candidatures de franchise.',
    'Approve establishment go-live and franchise applications.',
    'Aprueba la publicación de establecimientos y las solicitudes de franquicia.',
    'Approva la pubblicazione degli stabilimenti e le candidature di franchising.',
    'وافق على نشر المنشآت وعلى طلبات الامتياز.',
  ],
  restaurantsTitle: [
    'Établissements à valider',
    'Establishments to approve',
    'Establecimientos por aprobar',
    'Stabilimenti da approvare',
    'منشآت بانتظار الموافقة',
  ],
  restaurantsEmptyTitle: [
    'Aucun établissement en attente',
    'No establishment pending',
    'Ningún establecimiento pendiente',
    'Nessuno stabilimento in attesa',
    'لا توجد منشأة قيد الانتظار',
  ],
  restaurantsEmptyBody: [
    'Tous les établissements ont été traités.',
    'Every establishment has been handled.',
    'Todos los establecimientos han sido gestionados.',
    'Tutti gli stabilimenti sono stati gestiti.',
    'تمت معالجة جميع المنشآت.',
  ],
  approvePublish: [
    'Approuver & publier',
    'Approve & publish',
    'Aprobar y publicar',
    'Approva e pubblica',
    'الموافقة والنشر',
  ],
  franchiseTitle: [
    'Candidatures de franchise',
    'Franchise applications',
    'Solicitudes de franquicia',
    'Candidature di franchising',
    'طلبات الامتياز',
  ],
  franchiseEmptyTitle: [
    'Aucune candidature en attente',
    'No application pending',
    'Ninguna solicitud pendiente',
    'Nessuna candidatura in attesa',
    'لا يوجد طلب قيد الانتظار',
  ],
  franchiseEmptyBody: [
    'Toutes les candidatures ont été traitées.',
    'Every application has been handled.',
    'Todas las solicitudes han sido gestionadas.',
    'Tutte le candidature sono state gestite.',
    'تمت معالجة جميع الطلبات.',
  ],
  approveFranchise: [
    'Approuver',
    'Approve',
    'Aprobar',
    'Approva',
    'الموافقة',
  ],
  actionError: [
    'L’action a échoué. Réessayez.',
    'The action failed. Please try again.',
    'La acción falló. Inténtalo de nuevo.',
    'L’azione non è riuscita. Riprova.',
    'فشل الإجراء. حاول مرة أخرى.',
  ],
  networkError: [
    'Connexion impossible. Vérifiez votre réseau.',
    'Could not connect. Check your network.',
    'No se pudo conectar. Comprueba tu red.',
    'Impossibile connettersi. Controlla la rete.',
    'تعذّر الاتصال. تحقّق من شبكتك.',
  ],
}

LOCALES.forEach((loc, i) => {
  const file = path.join(__dirname, '..', 'messages', `${loc}.json`)
  const json = JSON.parse(fs.readFileSync(file, 'utf8'))
  json.admin = json.admin || {}
  json.admin.approvals = json.admin.approvals || {}
  for (const k of Object.keys(A)) json.admin.approvals[k] = A[k][i]
  fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n', 'utf8')
  console.log(`  ✓ ${loc}.json — admin.approvals (+${Object.keys(A).length})`)
})
console.log('[add-admin-approvals-i18n] done.')
