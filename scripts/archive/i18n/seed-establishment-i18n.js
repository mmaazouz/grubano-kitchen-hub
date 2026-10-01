// Seeds the establishment-switcher keys (Option B, commit 5A) under a new
// top-level `establishment` namespace. Bespoke seeder (NOT translate-messages.js,
// which rewrites the whole file) — Object.assign into each messages/<locale>.json.

const fs = require('fs')
const path = require('path')

const T = {
  fr: {
    label: 'Établissement',
  },
  en: {
    label: 'Establishment',
  },
  es: {
    label: 'Establecimiento',
  },
  it: {
    label: 'Sede',
  },
  ar: {
    label: 'المنشأة',
  },
}

for (const [loc, kv] of Object.entries(T)) {
  const p = path.join(__dirname, '..', 'messages', `${loc}.json`)
  const m = JSON.parse(fs.readFileSync(p, 'utf8'))
  if (!m.establishment) m.establishment = {}
  Object.assign(m.establishment, kv)
  fs.writeFileSync(p, JSON.stringify(m, null, 2) + '\n', 'utf8')
  console.log(`${loc}: establishment = ${Object.keys(m.establishment).length} keys`)
}
