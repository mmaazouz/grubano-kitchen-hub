// Seeds the brand-copy + re-adoption keys (Option B, commit 5C) under the
// existing `brands` namespace. Bespoke seeder (NOT translate-messages.js).

const fs = require('fs')
const path = require('path')

const T = {
  fr: {
    copyModeScratch: 'Repartir de zéro',
    copyModeCopy: 'Copier une marque',
    copySourceLabel: 'Marque à copier',
    copyTargetLabel: 'Établissement cible',
    copyHint: 'Le menu est dupliqué. Les plats adoptés (recettes créateurs) sont exclus — tu pourras les ré-adopter ensuite, l’exclusivité locale s’applique.',
    copyButton: 'Copier la marque',
    copyNoBrands: 'Aucune marque à copier pour le moment.',
    copyNoTarget: 'Choisis un établissement cible.',
    copyErrorFailed: 'Copie impossible. Réessaie.',
    readoptTitle: 'Ré-adopter les recettes créateurs',
    readoptIntro: 'Ces plats adoptés n’ont pas été copiés. Ré-adopte-les pour le nouvel établissement (l’exclusivité par ville s’applique).',
    readoptBtn: 'Ré-adopter',
    readoptDone: 'Adopté',
    readoptCityTaken: 'Ville déjà prise',
    readoptError: 'Échec — réessayer',
    readoptClose: 'Terminé',
  },
  en: {
    copyModeScratch: 'Start from scratch',
    copyModeCopy: 'Copy a brand',
    copySourceLabel: 'Brand to copy',
    copyTargetLabel: 'Target establishment',
    copyHint: 'The menu is duplicated. Adopted dishes (creator recipes) are excluded — you can re-adopt them afterwards, with local exclusivity applied.',
    copyButton: 'Copy brand',
    copyNoBrands: 'No brand to copy yet.',
    copyNoTarget: 'Choose a target establishment.',
    copyErrorFailed: 'Could not copy. Please retry.',
    readoptTitle: 'Re-adopt creator recipes',
    readoptIntro: 'These adopted dishes were not copied. Re-adopt them for the new establishment (city exclusivity applies).',
    readoptBtn: 'Re-adopt',
    readoptDone: 'Adopted',
    readoptCityTaken: 'City taken',
    readoptError: 'Failed — retry',
    readoptClose: 'Done',
  },
  es: {
    copyModeScratch: 'Empezar de cero',
    copyModeCopy: 'Copiar una marca',
    copySourceLabel: 'Marca a copiar',
    copyTargetLabel: 'Establecimiento de destino',
    copyHint: 'El menú se duplica. Los platos adoptados (recetas de creadores) se excluyen — podrás readoptarlos después, con la exclusividad local aplicada.',
    copyButton: 'Copiar marca',
    copyNoBrands: 'Aún no hay ninguna marca para copiar.',
    copyNoTarget: 'Elige un establecimiento de destino.',
    copyErrorFailed: 'No se pudo copiar. Vuelve a intentarlo.',
    readoptTitle: 'Readoptar recetas de creadores',
    readoptIntro: 'Estos platos adoptados no se copiaron. Readóptalos para el nuevo establecimiento (se aplica la exclusividad por ciudad).',
    readoptBtn: 'Readoptar',
    readoptDone: 'Adoptado',
    readoptCityTaken: 'Ciudad ocupada',
    readoptError: 'Error — reintentar',
    readoptClose: 'Listo',
  },
  it: {
    copyModeScratch: 'Parti da zero',
    copyModeCopy: 'Copia un marchio',
    copySourceLabel: 'Marchio da copiare',
    copyTargetLabel: 'Sede di destinazione',
    copyHint: 'Il menu viene duplicato. I piatti adottati (ricette dei creator) sono esclusi — potrai riadottarli dopo, con l’esclusiva locale applicata.',
    copyButton: 'Copia marchio',
    copyNoBrands: 'Nessun marchio da copiare per ora.',
    copyNoTarget: 'Scegli una sede di destinazione.',
    copyErrorFailed: 'Impossibile copiare. Riprova.',
    readoptTitle: 'Riadotta le ricette dei creator',
    readoptIntro: 'Questi piatti adottati non sono stati copiati. Riadottali per la nuova sede (si applica l’esclusiva per città).',
    readoptBtn: 'Riadotta',
    readoptDone: 'Adottato',
    readoptCityTaken: 'Città occupata',
    readoptError: 'Errore — riprova',
    readoptClose: 'Fatto',
  },
  ar: {
    copyModeScratch: 'ابدأ من الصفر',
    copyModeCopy: 'نسخ علامة',
    copySourceLabel: 'العلامة المراد نسخها',
    copyTargetLabel: 'المنشأة المستهدفة',
    copyHint: 'يتم نسخ القائمة. تُستثنى الأطباق المتبنّاة (وصفات المبدعين) — يمكنك إعادة تبنّيها لاحقاً مع تطبيق الحصرية المحلية.',
    copyButton: 'نسخ العلامة',
    copyNoBrands: 'لا توجد علامة لنسخها حالياً.',
    copyNoTarget: 'اختر منشأة مستهدفة.',
    copyErrorFailed: 'تعذّر النسخ. أعد المحاولة.',
    readoptTitle: 'إعادة تبنّي وصفات المبدعين',
    readoptIntro: 'هذه الأطباق المتبنّاة لم تُنسخ. أعد تبنّيها للمنشأة الجديدة (تُطبّق الحصرية حسب المدينة).',
    readoptBtn: 'إعادة التبنّي',
    readoptDone: 'تم التبنّي',
    readoptCityTaken: 'المدينة محجوزة',
    readoptError: 'فشل — أعد المحاولة',
    readoptClose: 'تم',
  },
}

for (const [loc, kv] of Object.entries(T)) {
  const p = path.join(__dirname, '..', 'messages', `${loc}.json`)
  const m = JSON.parse(fs.readFileSync(p, 'utf8'))
  if (!m.brands) m.brands = {}
  Object.assign(m.brands, kv)
  fs.writeFileSync(p, JSON.stringify(m, null, 2) + '\n', 'utf8')
  console.log(`${loc}: brands += ${Object.keys(kv).length} keys (total ${Object.keys(m.brands).length})`)
}
