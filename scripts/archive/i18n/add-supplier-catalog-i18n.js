/* eslint-disable */
// ── Supplier CATALOGUE i18n seeder (B2B Slice 1, Agent 14) ────────────────────
// Idempotent: merges the catalogue keys into the existing `supplier` namespace in
// all 5 locale files so `npm run check:i18n` stays green. Run: node scripts/add-supplier-catalog-i18n.js
const fs = require('fs')
const path = require('path')

const LOCALES = ['fr', 'en', 'es', 'it', 'ar']

// key → [fr, en, es, it, ar]
const T = {
  catalogTitle:        ['Mon catalogue', 'My catalogue', 'Mi catálogo', 'Il mio catalogo', 'كتالوجي'],
  catalogSubtitle:     ['Gérez vos produits, prix et disponibilités.', 'Manage your products, prices and availability.', 'Gestiona tus productos, precios y disponibilidad.', 'Gestisci i tuoi prodotti, prezzi e disponibilità.', 'أدِر منتجاتك وأسعارك وتوافرها.'],
  catalogCardSubtitle: ['Produits, prix, disponibilités', 'Products, prices, availability', 'Productos, precios, disponibilidad', 'Prodotti, prezzi, disponibilità', 'المنتجات والأسعار والتوافر'],
  catalogBack:         ['Mon espace', 'My space', 'Mi espacio', 'Il mio spazio', 'مساحتي'],
  catalogEmpty:        ['Aucun produit pour l’instant. Ajoutez-en un ou importez un CSV.', 'No products yet. Add one or import a CSV.', 'Aún no hay productos. Añade uno o importa un CSV.', 'Ancora nessun prodotto. Aggiungine uno o importa un CSV.', 'لا توجد منتجات بعد. أضف منتجًا أو استورد ملف CSV.'],
  addProduct:          ['Ajouter un produit', 'Add a product', 'Añadir un producto', 'Aggiungi un prodotto', 'إضافة منتج'],
  importCsv:           ['Importer un CSV', 'Import a CSV', 'Importar un CSV', 'Importa un CSV', 'استيراد CSV'],
  outStock:            ['Rupture', 'Out of stock', 'Agotado', 'Esaurito', 'نفد'],
  edit:                ['Modifier', 'Edit', 'Editar', 'Modifica', 'تعديل'],
  delete:              ['Supprimer', 'Delete', 'Eliminar', 'Elimina', 'حذف'],
  confirmDelete:       ['Supprimer « {name} » ?', 'Delete “{name}”?', '¿Eliminar «{name}»?', 'Eliminare «{name}»?', 'حذف «{name}»؟'],
  errLoad:             ['Impossible de charger le catalogue.', 'Could not load the catalogue.', 'No se pudo cargar el catálogo.', 'Impossibile caricare il catalogo.', 'تعذّر تحميل الكتالوج.'],
  errSave:             ['Une erreur est survenue. Réessayez.', 'Something went wrong. Please try again.', 'Algo salió mal. Inténtalo de nuevo.', 'Qualcosa è andato storto. Riprova.', 'حدث خطأ ما. حاول مرة أخرى.'],
  addTitle:            ['Nouveau produit', 'New product', 'Nuevo producto', 'Nuovo prodotto', 'منتج جديد'],
  editTitle:           ['Modifier le produit', 'Edit product', 'Editar producto', 'Modifica prodotto', 'تعديل المنتج'],
  cancel:              ['Annuler', 'Cancel', 'Cancelar', 'Annulla', 'إلغاء'],
  save:                ['Enregistrer', 'Save', 'Guardar', 'Salva', 'حفظ'],
  saving:              ['Enregistrement…', 'Saving…', 'Guardando…', 'Salvataggio…', 'جارٍ الحفظ…'],
  fName:               ['Nom du produit', 'Product name', 'Nombre del producto', 'Nome del prodotto', 'اسم المنتج'],
  fCategory:           ['Catégorie', 'Category', 'Categoría', 'Categoria', 'الفئة'],
  fPackSize:           ['Conditionnement', 'Pack size', 'Formato', 'Confezione', 'التعبئة'],
  fPrice:              ['Prix (€)', 'Price (€)', 'Precio (€)', 'Prezzo (€)', 'السعر (€)'],
  fUnit:               ['Unité', 'Unit', 'Unidad', 'Unità', 'الوحدة'],
  fDescription:        ['Description', 'Description', 'Descripción', 'Descrizione', 'الوصف'],
  fAllergens:          ['Allergènes', 'Allergens', 'Alérgenos', 'Allergeni', 'مسببات الحساسية'],
  fAllergensHint:      ['Optionnel — sélectionnez les allergènes présents.', 'Optional — select any allergens present.', 'Opcional — selecciona los alérgenos presentes.', 'Facoltativo — seleziona gli allergeni presenti.', 'اختياري — حدّد مسببات الحساسية الموجودة.'],
  fAvailable:          ['En stock', 'In stock', 'En stock', 'Disponibile', 'متوفر'],
  uKg:                 ['kg', 'kg', 'kg', 'kg', 'كغ'],
  uG:                  ['g', 'g', 'g', 'g', 'غ'],
  uL:                  ['L', 'L', 'L', 'L', 'ل'],
  uCl:                 ['cl', 'cl', 'cl', 'cl', 'سل'],
  uPiece:              ['pièce', 'piece', 'pieza', 'pezzo', 'قطعة'],
  uBox:                ['caisse', 'box', 'caja', 'cassa', 'صندوق'],
  uPack:               ['lot', 'pack', 'paquete', 'confezione', 'حزمة'],
  importTitle:         ['Importer un catalogue CSV', 'Import a CSV catalogue', 'Importar un catálogo CSV', 'Importa un catalogo CSV', 'استيراد كتالوج CSV'],
  importHint:          ['Téléversez un fichier .csv. Les lignes valides sont créées ; les invalides sont rapportées.', 'Upload a .csv file. Valid rows are created; invalid ones are reported.', 'Sube un archivo .csv. Las filas válidas se crean; las inválidas se informan.', 'Carica un file .csv. Le righe valide vengono create; quelle non valide vengono segnalate.', 'ارفع ملف ‎.csv‎. تُنشأ الصفوف الصحيحة ويُبلَّغ عن غير الصحيحة.'],
  importColumns:       ['Colonnes : name, price, unit, category, packSize, description, available, allergens', 'Columns: name, price, unit, category, packSize, description, available, allergens', 'Columnas: name, price, unit, category, packSize, description, available, allergens', 'Colonne: name, price, unit, category, packSize, description, available, allergens', 'الأعمدة: name, price, unit, category, packSize, description, available, allergens'],
  importPick:          ['Choisir un fichier CSV', 'Choose a CSV file', 'Elegir un archivo CSV', 'Scegli un file CSV', 'اختر ملف CSV'],
  importing:           ['Import en cours…', 'Importing…', 'Importando…', 'Importazione…', 'جارٍ الاستيراد…'],
  importDone:          ['{created} créés · {skipped} ignorés · {invalid} invalides', '{created} created · {skipped} skipped · {invalid} invalid', '{created} creados · {skipped} omitidos · {invalid} inválidos', '{created} creati · {skipped} saltati · {invalid} non validi', '{created} مُنشأ · {skipped} متجاوَز · {invalid} غير صالح'],
  importErrors:        ['Lignes ignorées', 'Skipped rows', 'Filas omitidas', 'Righe saltate', 'الصفوف المتجاوَزة'],
  close:               ['Fermer', 'Close', 'Cerrar', 'Chiudi', 'إغلاق'],
}

const KEYS = Object.keys(T)
let changed = 0
LOCALES.forEach((loc, i) => {
  const file = path.join(__dirname, '..', 'messages', `${loc}.json`)
  const json = JSON.parse(fs.readFileSync(file, 'utf8'))
  json.supplier = json.supplier || {}
  for (const key of KEYS) json.supplier[key] = T[key][i]
  fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n', 'utf8')
  changed++
  console.log(`  ✓ ${loc}.json — supplier catalogue (${KEYS.length} keys)`)
})
console.log(`[add-supplier-catalog-i18n] done — ${changed} locale files updated.`)
