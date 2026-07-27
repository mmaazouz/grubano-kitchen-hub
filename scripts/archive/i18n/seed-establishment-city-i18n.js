// Fix #2: city-field validation messages under the `establishment` namespace.
// errCityInvalid = blocked (empty/short/cuisine word). cityNotVerified = soft
// warning when BAN geocoding misses (the establishment is still created).

const fs = require('fs')
const path = require('path')

const T = {
  fr: {
    errCityInvalid: 'Ville invalide — saisis le nom d’une vraie ville (pas un type de cuisine).',
    cityNotVerified: 'Établissement créé, mais l’adresse n’a pas pu être vérifiée — contrôle l’orthographe de la ville et de l’adresse.',
  },
  en: {
    errCityInvalid: 'Invalid city — enter a real city name (not a cuisine type).',
    cityNotVerified: 'Establishment created, but the address could not be verified — check the spelling of the city and address.',
  },
  es: {
    errCityInvalid: 'Ciudad no válida — escribe el nombre de una ciudad real (no un tipo de cocina).',
    cityNotVerified: 'Establecimiento creado, pero no se pudo verificar la dirección — revisa la ortografía de la ciudad y la dirección.',
  },
  it: {
    errCityInvalid: 'Città non valida — inserisci il nome di una città reale (non un tipo di cucina).',
    cityNotVerified: 'Sede creata, ma non è stato possibile verificare l’indirizzo — controlla l’ortografia della città e dell’indirizzo.',
  },
  ar: {
    errCityInvalid: 'مدينة غير صالحة — أدخل اسم مدينة حقيقية (وليس نوع مطبخ).',
    cityNotVerified: 'تم إنشاء المنشأة، لكن تعذّر التحقق من العنوان — تحقق من تهجئة المدينة والعنوان.',
  },
}

for (const [loc, kv] of Object.entries(T)) {
  const p = path.join(__dirname, '..', 'messages', `${loc}.json`)
  const m = JSON.parse(fs.readFileSync(p, 'utf8'))
  if (!m.establishment) m.establishment = {}
  Object.assign(m.establishment, kv)
  fs.writeFileSync(p, JSON.stringify(m, null, 2) + '\n', 'utf8')
  console.log(`${loc}: establishment += city keys (total ${Object.keys(m.establishment).length})`)
}
