// scripts/seed-delete-etab-ui-i18n.js
// Hub établissement — bouton « Supprimer cet établissement » + modale de
// confirmation (Agent 13). Consomme DELETE /api/restaurants/[id] livré par
// Agent 2 (commit e94ca18), qui renvoie { mode: "archived" | "deleted" }.
// Additive ONLY: Object.assign's the keys below into each locale, never
// removes anything. Source of truth = fr.json; all locales must stay complete
// (npm run check:i18n). Dedicated seed — NOT translate-messages.js.
//
// Adds (per locale) under dashboard.hub.danger.*:
//   title          → "Zone de danger" section title
//   intro          → dual soft/hard explanation paragraph
//   button         → "Supprimer cet établissement"
//   buttonAria     → aria-label (incl. {name})
//   lastBlocker    → "C'est votre dernier établissement — créez-en un autre…"
//   modalTitle     → confirmation modal title
//   modalBody      → confirmation paragraph (dual outcome, depends on data)
//   modalIntroSoft → "L'historique de commandes sera conservé"
//   modalIntroHard → "Cette action est irréversible"
//   typeNameLabel  → "Tapez {name} pour confirmer."
//   typeNameInput  → input placeholder
//   confirmBtn     → "Supprimer"
//   cancel         → "Annuler"
//   resultArchived → toast "Établissement archivé"
//   resultDeleted  → toast "Établissement supprimé"
//   errorTitle     → "Suppression impossible"
//   errorForbidden → 403 message
//   errorNotFound  → 404 message
//   errorGeneric   → fallback failure message
//
// Run:  node scripts/seed-delete-etab-ui-i18n.js   then   npm run check:i18n

const fs = require('fs')
const path = require('path')

const T = {
  fr: {
    title:          'Zone de danger',
    intro:          'Si cet établissement a des commandes, il sera archivé (son historique sera conservé). Sinon, il sera définitivement supprimé.',
    button:         'Supprimer cet établissement',
    buttonAria:     'Supprimer l’établissement {name}',
    lastBlocker:    'C’est votre dernier établissement — créez-en un autre avant de pouvoir supprimer celui-ci.',
    modalTitle:     'Supprimer cet établissement ?',
    modalBody:      'Pour confirmer, tapez exactement le nom de l’établissement ci-dessous. Cette action ne peut pas être annulée par l’interface.',
    modalIntroSoft: 'Si cet établissement a des commandes, son historique sera archivé (conservé en base).',
    modalIntroHard: 'S’il est vide, il sera définitivement supprimé avec ses marques et menus vides.',
    typeNameLabel:  'Tapez « {name} » pour confirmer.',
    typeNameInput:  'Nom de l’établissement',
    confirmBtn:     'Supprimer définitivement',
    cancel:         'Annuler',
    resultArchived: 'Établissement archivé (historique préservé).',
    resultDeleted:  'Établissement supprimé.',
    errorTitle:     'Suppression impossible',
    errorForbidden: 'Vous n’avez pas le droit de supprimer cet établissement.',
    errorNotFound:  'Cet établissement n’existe plus.',
    errorGeneric:   'La suppression a échoué — réessayez dans un instant.',
  },
  en: {
    title:          'Danger zone',
    intro:          'If this establishment has orders, it will be archived (its history is preserved). Otherwise, it will be permanently deleted.',
    button:         'Delete this establishment',
    buttonAria:     'Delete establishment {name}',
    lastBlocker:    'This is your last establishment — create another one before you can delete this.',
    modalTitle:     'Delete this establishment?',
    modalBody:      'To confirm, type the establishment name exactly below. This action cannot be undone from the interface.',
    modalIntroSoft: 'If the establishment has orders, its history will be archived (kept in the database).',
    modalIntroHard: 'If it is empty, it will be permanently deleted along with its brands and empty menus.',
    typeNameLabel:  'Type "{name}" to confirm.',
    typeNameInput:  'Establishment name',
    confirmBtn:     'Permanently delete',
    cancel:         'Cancel',
    resultArchived: 'Establishment archived (history preserved).',
    resultDeleted:  'Establishment deleted.',
    errorTitle:     'Could not delete',
    errorForbidden: 'You are not allowed to delete this establishment.',
    errorNotFound:  'This establishment no longer exists.',
    errorGeneric:   'Delete failed — please try again.',
  },
  es: {
    title:          'Zona de peligro',
    intro:          'Si este establecimiento tiene pedidos, se archivará (se conservará su historial). De lo contrario, se eliminará definitivamente.',
    button:         'Eliminar este establecimiento',
    buttonAria:     'Eliminar el establecimiento {name}',
    lastBlocker:    'Es tu último establecimiento — crea otro antes de poder eliminar este.',
    modalTitle:     '¿Eliminar este establecimiento?',
    modalBody:      'Para confirmar, escribe exactamente el nombre del establecimiento abajo. Esta acción no se puede deshacer desde la interfaz.',
    modalIntroSoft: 'Si el establecimiento tiene pedidos, su historial se archivará (se mantiene en la base de datos).',
    modalIntroHard: 'Si está vacío, se eliminará definitivamente junto con sus marcas y menús vacíos.',
    typeNameLabel:  'Escribe «{name}» para confirmar.',
    typeNameInput:  'Nombre del establecimiento',
    confirmBtn:     'Eliminar definitivamente',
    cancel:         'Cancelar',
    resultArchived: 'Establecimiento archivado (historial conservado).',
    resultDeleted:  'Establecimiento eliminado.',
    errorTitle:     'No se pudo eliminar',
    errorForbidden: 'No tienes permiso para eliminar este establecimiento.',
    errorNotFound:  'Este establecimiento ya no existe.',
    errorGeneric:   'Error al eliminar — inténtalo de nuevo.',
  },
  it: {
    title:          'Zona pericolosa',
    intro:          'Se questa struttura ha ordini, verrà archiviata (la sua cronologia sarà conservata). In caso contrario, verrà eliminata definitivamente.',
    button:         'Elimina questa struttura',
    buttonAria:     'Elimina la struttura {name}',
    lastBlocker:    'È la tua ultima struttura — creane un’altra prima di poter eliminare questa.',
    modalTitle:     'Eliminare questa struttura?',
    modalBody:      'Per confermare, digita esattamente il nome della struttura qui sotto. Questa azione non può essere annullata dall’interfaccia.',
    modalIntroSoft: 'Se la struttura ha ordini, la sua cronologia sarà archiviata (conservata nel database).',
    modalIntroHard: 'Se è vuota, sarà eliminata definitivamente insieme ai suoi marchi e menù vuoti.',
    typeNameLabel:  'Digita «{name}» per confermare.',
    typeNameInput:  'Nome della struttura',
    confirmBtn:     'Elimina definitivamente',
    cancel:         'Annulla',
    resultArchived: 'Struttura archiviata (cronologia preservata).',
    resultDeleted:  'Struttura eliminata.',
    errorTitle:     'Impossibile eliminare',
    errorForbidden: 'Non hai il permesso di eliminare questa struttura.',
    errorNotFound:  'Questa struttura non esiste più.',
    errorGeneric:   'Eliminazione non riuscita — riprova.',
  },
  ar: {
    title:          'منطقة الخطر',
    intro:          'إذا كانت هذه المنشأة تحتوي على طلبات، فسيتم أرشفتها (مع الاحتفاظ بسجلها). وإلا، فسيتم حذفها نهائيًا.',
    button:         'حذف هذه المنشأة',
    buttonAria:     'حذف المنشأة {name}',
    lastBlocker:    'هذه آخر منشأة لديك — أنشئ منشأة أخرى قبل أن تتمكن من حذف هذه.',
    modalTitle:     'حذف هذه المنشأة؟',
    modalBody:      'للتأكيد، اكتب اسم المنشأة بالضبط أدناه. لا يمكن التراجع عن هذا الإجراء من الواجهة.',
    modalIntroSoft: 'إذا كانت المنشأة تحتوي على طلبات، فسيتم أرشفة سجلها (يبقى في قاعدة البيانات).',
    modalIntroHard: 'إذا كانت فارغة، فسيتم حذفها نهائيًا مع علاماتها التجارية وقوائمها الفارغة.',
    typeNameLabel:  'اكتب «{name}» للتأكيد.',
    typeNameInput:  'اسم المنشأة',
    confirmBtn:     'حذف نهائي',
    cancel:         'إلغاء',
    resultArchived: 'تمت أرشفة المنشأة (مع الاحتفاظ بالسجل).',
    resultDeleted:  'تم حذف المنشأة.',
    errorTitle:     'تعذر الحذف',
    errorForbidden: 'لا يحق لك حذف هذه المنشأة.',
    errorNotFound:  'لم تعد هذه المنشأة موجودة.',
    errorGeneric:   'فشل الحذف — حاول مرة أخرى.',
  },
}

for (const [loc, kv] of Object.entries(T)) {
  const p = path.join(__dirname, '..', 'messages', `${loc}.json`)
  const m = JSON.parse(fs.readFileSync(p, 'utf8'))

  if (!m.dashboard) m.dashboard = {}
  if (!m.dashboard.hub) m.dashboard.hub = {}
  if (!m.dashboard.hub.danger) m.dashboard.hub.danger = {}
  Object.assign(m.dashboard.hub.danger, kv)

  fs.writeFileSync(p, JSON.stringify(m, null, 2) + '\n', 'utf8')
  console.log(`${loc}: +dashboard.hub.danger.* (${Object.keys(kv).length} keys)`)
}
