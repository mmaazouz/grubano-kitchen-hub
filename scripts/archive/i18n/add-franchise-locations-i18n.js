/* eslint-disable */
// ── Agent 44 — franchise locations (points of sale) UI i18n (B3) ─────────────────
// Adds franchise.locations.* : the franchisor "Mes établissements" page — list of
// points of sale + create/edit/delete, each POS linked to ONE of the operator's own
// restaurants (1:1) + optionally a brand. x5 locales, strict parity, idempotent.
// FR vouvoiement; es/it/en natural; ar real RTL. Run: node scripts/add-franchise-locations-i18n.js
const fs = require('fs')
const path = require('path')
const LOCALES = ['fr', 'en', 'es', 'it', 'ar']

// franchise.locations.* — [fr, en, es, it, ar]
const L = {
  title:       ['Mes établissements', 'My locations', 'Mis establecimientos', 'I miei punti vendita', 'منشآتي'],
  subtitle: [
    'Gérez vos points de vente et reliez chacun à l’un de vos restaurants.',
    'Manage your points of sale and link each one to one of your restaurants.',
    'Gestiona tus puntos de venta y vincula cada uno a uno de tus restaurantes.',
    'Gestisci i tuoi punti vendita e collega ciascuno a uno dei tuoi ristoranti.',
    'أدِر نقاط البيع الخاصة بك واربط كل واحدة بأحد مطاعمك.',
  ],
  addCta:      ['Ajouter un point de vente', 'Add a point of sale', 'Añadir un punto de venta', 'Aggiungi un punto vendita', 'إضافة نقطة بيع'],
  loadError:   ['Impossible de charger vos points de vente.', 'Could not load your points of sale.', 'No se pudieron cargar tus puntos de venta.', 'Impossibile caricare i tuoi punti vendita.', 'تعذّر تحميل نقاط البيع الخاصة بك.'],
  empty:       ['Aucun point de vente', 'No point of sale yet', 'Aún no hay puntos de venta', 'Nessun punto vendita', 'لا توجد نقاط بيع بعد'],
  emptyDesc: [
    'Créez votre premier point de vente et reliez-le à l’un de vos restaurants.',
    'Create your first point of sale and link it to one of your restaurants.',
    'Crea tu primer punto de venta y vincúlalo a uno de tus restaurantes.',
    'Crea il tuo primo punto vendita e collegalo a uno dei tuoi ristoranti.',
    'أنشئ أول نقطة بيع واربطها بأحد مطاعمك.',
  ],

  // ── Card labels ──
  colRestaurant:['Restaurant lié', 'Linked restaurant', 'Restaurante vinculado', 'Ristorante collegato', 'المطعم المرتبط'],
  colBrand:     ['Marque', 'Brand', 'Marca', 'Marca', 'العلامة'],
  statusActive:   ['Actif', 'Active', 'Activo', 'Attivo', 'نشط'],
  statusInactive: ['Inactif', 'Inactive', 'Inactivo', 'Inattivo', 'غير نشط'],
  linkNone:  ['Aucun restaurant lié', 'No linked restaurant', 'Sin restaurante vinculado', 'Nessun ristorante collegato', 'لا يوجد مطعم مرتبط'],
  brandNone: ['Aucune marque', 'No brand', 'Sin marca', 'Nessuna marca', 'بدون علامة'],

  // ── Form ──
  createTitle: ['Nouveau point de vente', 'New point of sale', 'Nuevo punto de venta', 'Nuovo punto vendita', 'نقطة بيع جديدة'],
  editTitle:   ['Modifier le point de vente', 'Edit point of sale', 'Editar punto de venta', 'Modifica punto vendita', 'تعديل نقطة البيع'],
  fieldName:       ['Nom du point de vente', 'Point-of-sale name', 'Nombre del punto de venta', 'Nome del punto vendita', 'اسم نقطة البيع'],
  fieldAddress:    ['Adresse', 'Address', 'Dirección', 'Indirizzo', 'العنوان'],
  fieldCity:       ['Ville', 'City', 'Ciudad', 'Città', 'المدينة'],
  fieldRestaurant: ['Restaurant à relier', 'Restaurant to link', 'Restaurante a vincular', 'Ristorante da collegare', 'المطعم المراد ربطه'],
  fieldBrand:      ['Marque (facultatif)', 'Brand (optional)', 'Marca (opcional)', 'Marca (facoltativa)', 'العلامة (اختياري)'],
  optionNoRestaurant: ['— Aucun restaurant', '— No restaurant', '— Ningún restaurante', '— Nessun ristorante', '— لا يوجد مطعم'],
  optionNoBrand:      ['— Aucune marque', '— No brand', '— Ninguna marca', '— Nessuna marca', '— بدون علامة'],
  restaurantHint: [
    'Seuls vos restaurants non encore reliés apparaissent (un restaurant = un seul point de vente).',
    'Only your not-yet-linked restaurants appear (one restaurant = one point of sale).',
    'Solo aparecen tus restaurantes aún no vinculados (un restaurante = un solo punto de venta).',
    'Compaiono solo i tuoi ristoranti non ancora collegati (un ristorante = un solo punto vendita).',
    'تظهر فقط مطاعمك غير المرتبطة بعد (مطعم واحد = نقطة بيع واحدة).',
  ],
  noLinkable: [
    'Aucun restaurant disponible à relier. Créez d’abord un restaurant, ou déliez-en un.',
    'No restaurant available to link. Create a restaurant first, or unlink one.',
    'No hay restaurantes disponibles para vincular. Crea uno primero o desvincula otro.',
    'Nessun ristorante disponibile da collegare. Creane uno prima, o scollegane uno.',
    'لا يوجد مطعم متاح للربط. أنشئ مطعمًا أولًا أو افصل أحدها.',
  ],

  // ── Actions / states ──
  edit:     ['Modifier', 'Edit', 'Editar', 'Modifica', 'تعديل'],
  delete:   ['Supprimer', 'Delete', 'Eliminar', 'Elimina', 'حذف'],
  cancel:   ['Annuler', 'Cancel', 'Cancelar', 'Annulla', 'إلغاء'],
  save:     ['Enregistrer', 'Save', 'Guardar', 'Salva', 'حفظ'],
  saving:   ['Enregistrement…', 'Saving…', 'Guardando…', 'Salvataggio…', 'جارٍ الحفظ…'],
  create:   ['Créer', 'Create', 'Crear', 'Crea', 'إنشاء'],
  creating: ['Création…', 'Creating…', 'Creando…', 'Creazione…', 'جارٍ الإنشاء…'],
  deleteConfirm: [
    'Supprimer ce point de vente ? Le restaurant lié sera délié (le restaurant lui-même n’est pas supprimé).',
    'Delete this point of sale? The linked restaurant will be unlinked (the restaurant itself is not deleted).',
    '¿Eliminar este punto de venta? El restaurante vinculado se desvinculará (el restaurante no se elimina).',
    'Eliminare questo punto vendita? Il ristorante collegato verrà scollegato (il ristorante non viene eliminato).',
    'حذف نقطة البيع هذه؟ سيتم فصل المطعم المرتبط (لا يُحذف المطعم نفسه).',
  ],
  errorGeneric: [
    'Une erreur est survenue. Veuillez réessayer.',
    'Something went wrong. Please try again.',
    'Ocurrió un error. Inténtalo de nuevo.',
    'Si è verificato un errore. Riprova.',
    'حدث خطأ. يرجى المحاولة مرة أخرى.',
  ],
}

LOCALES.forEach((loc, i) => {
  const file = path.join(__dirname, '..', 'messages', `${loc}.json`)
  const json = JSON.parse(fs.readFileSync(file, 'utf8'))
  json.franchise = json.franchise || {}
  json.franchise.locations = json.franchise.locations || {}
  for (const k of Object.keys(L)) json.franchise.locations[k] = L[k][i]
  fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n', 'utf8')
  console.log(`  ✓ ${loc}.json — franchise.locations (+${Object.keys(L).length})`)
})
console.log('[add-franchise-locations-i18n] done.')
