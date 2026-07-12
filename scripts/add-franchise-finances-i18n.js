/* eslint-disable */
// ── Agent 47 — franchisor dashboard reconciliation + Finances page i18n (B6) ─────────
// Adds franchise.finances.* (the real settlement-history page) + a few franchise.dashboard.*
// keys (distinguishing the live ESTIMATE from the AUTHORITATIVE accrued/settled/pending
// royalties read from FranchiseRoyalty/Payout). x5 locales, strict parity, idempotent.
// FR vouvoiement; es/it/en natural; ar real RTL.
// Run: node scripts/add-franchise-finances-i18n.js
const fs = require('fs')
const path = require('path')
const LOCALES = ['fr', 'en', 'es', 'it', 'ar']

// franchise.dashboard.* additions — [fr, en, es, it, ar]
const DASH = {
  kpiRoyaltiesEstimate: ['Royalties (estimation)', 'Royalties (estimate)', 'Royalties (estimación)', 'Royalty (stima)', 'الإتاوات (تقدير)'],
  estimateBadge: ['estimation', 'estimate', 'estimación', 'stima', 'تقدير'],
  royaltyInactiveHint: [
    'Prélèvement non activé — projection indicative.',
    'Collection not enabled — indicative projection.',
    'Cobro no activado — proyección indicativa.',
    'Prelievo non attivato — proiezione indicativa.',
    'الاستقطاع غير مُفعّل — تقدير إرشادي.',
  ],
  realRoyaltiesTitle: ['Royalties réelles', 'Actual royalties', 'Royalties reales', 'Royalty effettive', 'الإتاوات الفعلية'],
  realRoyaltiesHint: [
    'Montants réellement retenus pour le franchiseur.',
    'Amounts actually held back for the franchisor.',
    'Importes realmente retenidos para el franquiciador.',
    'Importi effettivamente trattenuti per il franchisor.',
    'المبالغ المُحتجزة فعليًا لمانح الامتياز.',
  ],
  realAccrued: ['Accumulées', 'Accrued', 'Acumuladas', 'Maturate', 'متراكمة'],
  realSettled: ['Réglées', 'Settled', 'Liquidadas', 'Liquidate', 'مُسوّاة'],
  realPending: ['En attente', 'Pending', 'Pendientes', 'In attesa', 'قيد الانتظار'],
  realInactiveNote: [
    'Le prélèvement réel des royalties n’est pas encore activé — ces montants restent à 0.',
    'Real royalty collection is not enabled yet — these amounts stay at 0.',
    'El cobro real de royalties aún no está activado — estos importes permanecen en 0.',
    'Il prelievo reale delle royalty non è ancora attivo — questi importi restano a 0.',
    'استقطاع الإتاوات الفعلي غير مُفعّل بعد — تبقى هذه المبالغ على 0.',
  ],
  financesLink: ['Voir les règlements', 'View settlements', 'Ver liquidaciones', 'Vedi liquidazioni', 'عرض التسويات'],
}

// franchise.finances.* — the real Finances page — [fr, en, es, it, ar]
const FIN = {
  title: ['Finances', 'Finances', 'Finanzas', 'Finanze', 'المالية'],
  subtitle: [
    'Royalties accumulées et historique des règlements.',
    'Accrued royalties and settlement history.',
    'Royalties acumuladas e historial de liquidaciones.',
    'Royalty maturate e storico delle liquidazioni.',
    'الإتاوات المتراكمة وسجل التسويات.',
  ],
  accruedLabel: ['Accumulées', 'Accrued', 'Acumuladas', 'Maturate', 'متراكمة'],
  settledLabel: ['Réglées', 'Settled', 'Liquidadas', 'Liquidate', 'مُسوّاة'],
  pendingLabel: ['En attente', 'Pending', 'Pendientes', 'In attesa', 'قيد الانتظار'],
  pendingHint: [
    'Royalties retenues, en attente de règlement au franchiseur.',
    'Royalties held back, awaiting settlement to the franchisor.',
    'Royalties retenidas, pendientes de liquidación al franquiciador.',
    'Royalty trattenute, in attesa di liquidazione al franchisor.',
    'إتاوات مُحتجزة بانتظار تسويتها لمانح الامتياز.',
  ],
  inactiveNote: [
    'Le prélèvement réel des royalties n’est pas encore activé. Les montants ci-dessous restent à 0 tant qu’aucun prélèvement n’a eu lieu.',
    'Real royalty collection is not enabled yet. The amounts below stay at 0 until a collection has occurred.',
    'El cobro real de royalties aún no está activado. Los importes siguientes permanecen en 0 mientras no se realice ningún cobro.',
    'Il prelievo reale delle royalty non è ancora attivo. Gli importi sottostanti restano a 0 finché non avviene alcun prelievo.',
    'استقطاع الإتاوات الفعلي غير مُفعّل بعد. تبقى المبالغ أدناه على 0 إلى أن يتم أي استقطاع.',
  ],
  historyTitle: ['Historique des règlements', 'Settlement history', 'Historial de liquidaciones', 'Storico delle liquidazioni', 'سجل التسويات'],
  emptyTitle: ['Aucun règlement', 'No settlements', 'Sin liquidaciones', 'Nessuna liquidazione', 'لا توجد تسويات'],
  emptyDesc: [
    'Vos règlements apparaîtront ici une fois effectués.',
    'Your settlements will appear here once executed.',
    'Tus liquidaciones aparecerán aquí una vez realizadas.',
    'Le tue liquidazioni appariranno qui una volta effettuate.',
    'ستظهر تسوياتك هنا بمجرد تنفيذها.',
  ],
  colAmount: ['Montant', 'Amount', 'Importe', 'Importo', 'المبلغ'],
  colDate: ['Date', 'Date', 'Fecha', 'Data', 'التاريخ'],
  colStatus: ['Statut', 'Status', 'Estado', 'Stato', 'الحالة'],
  colRef: ['Référence', 'Reference', 'Referencia', 'Riferimento', 'المرجع'],
  statusPending: ['En attente', 'Pending', 'Pendiente', 'In attesa', 'قيد الانتظار'],
  statusPaid: ['Réglé', 'Paid', 'Pagado', 'Pagato', 'مدفوع'],
  statusFailed: ['Échoué', 'Failed', 'Fallido', 'Fallito', 'فشل'],
  loadError: ['Impossible de charger les finances.', 'Could not load finances.', 'No se pudieron cargar las finanzas.', 'Impossibile caricare le finanze.', 'تعذّر تحميل البيانات المالية.'],
  errorNetwork: ['Erreur réseau.', 'Network error.', 'Error de red.', 'Errore di rete.', 'خطأ في الشبكة.'],
  backToDashboard: ['Tableau de bord', 'Dashboard', 'Panel', 'Dashboard', 'لوحة التحكم'],
}

LOCALES.forEach((loc, i) => {
  const file = path.join(__dirname, '..', 'messages', `${loc}.json`)
  const json = JSON.parse(fs.readFileSync(file, 'utf8'))
  json.franchise = json.franchise || {}
  json.franchise.dashboard = json.franchise.dashboard || {}
  json.franchise.finances = json.franchise.finances || {}
  for (const k of Object.keys(DASH)) json.franchise.dashboard[k] = DASH[k][i]
  for (const k of Object.keys(FIN))  json.franchise.finances[k]  = FIN[k][i]
  fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n', 'utf8')
  console.log(`  ✓ ${loc}.json — franchise.dashboard (+${Object.keys(DASH).length}) franchise.finances (+${Object.keys(FIN).length})`)
})
console.log('[add-franchise-finances-i18n] done.')
