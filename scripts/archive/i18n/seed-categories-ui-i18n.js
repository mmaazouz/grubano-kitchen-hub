// scripts/seed-categories-ui-i18n.js
// /menu — gestion des catégories par marque (Agent 13).
// Additive ONLY: Object.assign's the keys below into each locale, never
// removes anything. Source of truth = fr.json; all locales must stay complete
// (npm run check:i18n). Dedicated seed — NOT translate-messages.js.
//
// Adds (per locale) under menu.categories.*:
//   tabTitle              → CategoriesTab header
//   tabSubtitle           → sober helper
//   defaultBadge          → "Défaut" badge on the 4 built-ins
//   customBadge           → "Perso" badge on the operator's categories
//   countItems            → ICU plural "{count, plural, =0 {Aucun plat} ...}"
//   newButton             → "+ Nouvelle catégorie"
//   newPlaceholder        → input placeholder in create modal
//   newTitle              → create modal title
//   editTitle             → rename modal title
//   editButton            → rename action aria + tooltip
//   deleteButton          → delete action aria + tooltip
//   confirmCreate         → primary button (modal)
//   confirmRename         → primary button (modal)
//   confirmDelete         → primary button (modal)
//   cancel                → secondary button
//   deleteTitle           → delete confirm modal title
//   deleteBody            → confirm body (uses {name})
//   deleteNote            → "Les plats associés repasseront en Non classé."
//   defaultsNotEditable   → tooltip on the 4 built-ins explaining read-only
//   unclassifiedLabel     → "Non classé" (read-only group, server-reserved)
//   err400                → 400 reserved name / invalid
//   err409                → 409 duplicate
//   errGeneric            → fallback
//   errNetwork            → fetch failed
//   savedToast            → "Catégorie enregistrée"
//
// Run:  node scripts/seed-categories-ui-i18n.js   then   npm run check:i18n

const fs = require('fs')
const path = require('path')

const T = {
  fr: {
    tabTitle:             'Vos catégories',
    tabSubtitle:          'Organisez vos plats. Les 4 catégories par défaut sont toujours disponibles ; vos catégories perso peuvent être renommées ou supprimées.',
    defaultBadge:         'Défaut',
    customBadge:          'Perso',
    countItems:           '{count, plural, =0 {Aucun plat} =1 {# plat} other {# plats}}',
    newButton:            'Nouvelle catégorie',
    newPlaceholder:       'Ex. Pizzas, Vins, Brunch…',
    newTitle:             'Nouvelle catégorie',
    editTitle:            'Renommer la catégorie',
    editButton:           'Renommer',
    deleteButton:         'Supprimer',
    confirmCreate:        'Créer',
    confirmRename:        'Renommer',
    confirmDelete:        'Supprimer',
    cancel:               'Annuler',
    deleteTitle:          'Supprimer cette catégorie ?',
    deleteBody:           'La catégorie « {name} » sera supprimée.',
    deleteNote:           'Les plats associés repasseront en « Non classé ».',
    defaultsNotEditable:  'Catégorie par défaut — non modifiable',
    unclassifiedLabel:    'Non classé',
    err400:               'Nom invalide ou réservé.',
    err409:               'Cette catégorie existe déjà.',
    errGeneric:           'Action impossible — réessayez.',
    errNetwork:           'Impossible de joindre le serveur.',
    savedToast:           'Catégorie enregistrée',
  },
  en: {
    tabTitle:             'Your categories',
    tabSubtitle:          'Organise your dishes. The 4 default categories are always available; your custom ones can be renamed or deleted.',
    defaultBadge:         'Default',
    customBadge:          'Custom',
    countItems:           '{count, plural, =0 {No dish} =1 {# dish} other {# dishes}}',
    newButton:            'New category',
    newPlaceholder:       'e.g. Pizzas, Wines, Brunch…',
    newTitle:             'New category',
    editTitle:            'Rename the category',
    editButton:           'Rename',
    deleteButton:         'Delete',
    confirmCreate:        'Create',
    confirmRename:        'Rename',
    confirmDelete:        'Delete',
    cancel:               'Cancel',
    deleteTitle:          'Delete this category?',
    deleteBody:           'The category "{name}" will be removed.',
    deleteNote:           'Linked dishes will move back to "Unclassified".',
    defaultsNotEditable:  'Default category — not editable',
    unclassifiedLabel:    'Unclassified',
    err400:               'Invalid or reserved name.',
    err409:               'This category already exists.',
    errGeneric:           'Action failed — please retry.',
    errNetwork:           'Could not reach the server.',
    savedToast:           'Category saved',
  },
  es: {
    tabTitle:             'Tus categorías',
    tabSubtitle:          'Organiza tus platos. Las 4 categorías por defecto siempre están disponibles; las tuyas pueden renombrarse o eliminarse.',
    defaultBadge:         'Por defecto',
    customBadge:          'Personal',
    countItems:           '{count, plural, =0 {Ningún plato} =1 {# plato} other {# platos}}',
    newButton:            'Nueva categoría',
    newPlaceholder:       'Ej. Pizzas, Vinos, Brunch…',
    newTitle:             'Nueva categoría',
    editTitle:            'Renombrar la categoría',
    editButton:           'Renombrar',
    deleteButton:         'Eliminar',
    confirmCreate:        'Crear',
    confirmRename:        'Renombrar',
    confirmDelete:        'Eliminar',
    cancel:               'Cancelar',
    deleteTitle:          '¿Eliminar esta categoría?',
    deleteBody:           'La categoría «{name}» será eliminada.',
    deleteNote:           'Los platos asociados pasarán a «Sin clasificar».',
    defaultsNotEditable:  'Categoría por defecto — no editable',
    unclassifiedLabel:    'Sin clasificar',
    err400:               'Nombre inválido o reservado.',
    err409:               'Esta categoría ya existe.',
    errGeneric:           'Acción fallida — inténtalo de nuevo.',
    errNetwork:           'No se pudo contactar al servidor.',
    savedToast:           'Categoría guardada',
  },
  it: {
    tabTitle:             'Le tue categorie',
    tabSubtitle:          'Organizza i tuoi piatti. Le 4 categorie predefinite sono sempre disponibili; quelle personalizzate possono essere rinominate o eliminate.',
    defaultBadge:         'Predefinita',
    customBadge:          'Personale',
    countItems:           '{count, plural, =0 {Nessun piatto} =1 {# piatto} other {# piatti}}',
    newButton:            'Nuova categoria',
    newPlaceholder:       'Es. Pizze, Vini, Brunch…',
    newTitle:             'Nuova categoria',
    editTitle:            'Rinomina la categoria',
    editButton:           'Rinomina',
    deleteButton:         'Elimina',
    confirmCreate:        'Crea',
    confirmRename:        'Rinomina',
    confirmDelete:        'Elimina',
    cancel:               'Annulla',
    deleteTitle:          'Eliminare questa categoria?',
    deleteBody:           'La categoria «{name}» verrà eliminata.',
    deleteNote:           'I piatti associati torneranno a «Non classificato».',
    defaultsNotEditable:  'Categoria predefinita — non modificabile',
    unclassifiedLabel:    'Non classificato',
    err400:               'Nome non valido o riservato.',
    err409:               'Questa categoria esiste già.',
    errGeneric:           'Azione non riuscita — riprova.',
    errNetwork:           'Impossibile contattare il server.',
    savedToast:           'Categoria salvata',
  },
  ar: {
    tabTitle:             'فئاتك',
    tabSubtitle:          'نظّم أطباقك. تبقى الفئات الافتراضية الأربع متاحة دائمًا؛ يمكن إعادة تسمية فئاتك المخصصة أو حذفها.',
    defaultBadge:         'افتراضية',
    customBadge:          'مخصصة',
    countItems:           '{count, plural, =0 {لا أطباق} =1 {طبق واحد} other {# أطباق}}',
    newButton:            'فئة جديدة',
    newPlaceholder:       'مثال: بيتزا، نبيذ، فطور…',
    newTitle:             'فئة جديدة',
    editTitle:            'إعادة تسمية الفئة',
    editButton:           'إعادة تسمية',
    deleteButton:         'حذف',
    confirmCreate:        'إنشاء',
    confirmRename:        'إعادة تسمية',
    confirmDelete:        'حذف',
    cancel:               'إلغاء',
    deleteTitle:          'حذف هذه الفئة؟',
    deleteBody:           'سيتم حذف الفئة «{name}».',
    deleteNote:           'ستعود الأطباق المرتبطة إلى «غير مصنّف».',
    defaultsNotEditable:  'فئة افتراضية — غير قابلة للتعديل',
    unclassifiedLabel:    'غير مصنّف',
    err400:               'الاسم غير صالح أو محجوز.',
    err409:               'هذه الفئة موجودة بالفعل.',
    errGeneric:           'فشل الإجراء — حاول مجددًا.',
    errNetwork:           'تعذر الاتصال بالخادم.',
    savedToast:           'تم حفظ الفئة',
  },
}

for (const [loc, kv] of Object.entries(T)) {
  const p = path.join(__dirname, '..', 'messages', `${loc}.json`)
  const m = JSON.parse(fs.readFileSync(p, 'utf8'))

  if (!m.menu) m.menu = {}
  if (!m.menu.categories) m.menu.categories = {}
  Object.assign(m.menu.categories, kv)

  fs.writeFileSync(p, JSON.stringify(m, null, 2) + '\n', 'utf8')
  console.log(`${loc}: +menu.categories.* (${Object.keys(kv).length} keys)`)
}
