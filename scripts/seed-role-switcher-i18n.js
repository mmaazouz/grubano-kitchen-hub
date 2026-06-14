'use strict'

// scripts/seed-role-switcher-i18n.js — Mission 14 Phase 4 (Agent 14), idempotent.
// Adds the `roleSwitcher` namespace (the multi-role space selector) across the 5
// locales. Re-running is a no-op. Then `npm run check:i18n` stays green.
//   node scripts/seed-role-switcher-i18n.js

const fs   = require('fs')
const path = require('path')

const LOCALES = ['fr', 'en', 'es', 'it', 'ar']
const T = {
  fr: { title: 'Mes espaces',     spaceConsumer: 'Espace client',    spaceRestaurant: 'Mon restaurant', spaceCreator: 'Espace créateur', spaceFranchise: 'Franchise',  spaceAdmin: 'Administration' },
  en: { title: 'My spaces',       spaceConsumer: 'Customer space',   spaceRestaurant: 'My restaurant',  spaceCreator: 'Creator space',   spaceFranchise: 'Franchise',  spaceAdmin: 'Administration' },
  es: { title: 'Mis espacios',    spaceConsumer: 'Espacio cliente',  spaceRestaurant: 'Mi restaurante', spaceCreator: 'Espacio creador', spaceFranchise: 'Franquicia', spaceAdmin: 'Administración' },
  it: { title: 'I miei spazi',    spaceConsumer: 'Area cliente',     spaceRestaurant: 'Il mio ristorante', spaceCreator: 'Area creator', spaceFranchise: 'Franchising', spaceAdmin: 'Amministrazione' },
  ar: { title: 'مساحاتي',          spaceConsumer: 'مساحة العميل',      spaceRestaurant: 'مطعمي',          spaceCreator: 'مساحة المنشئ',    spaceFranchise: 'الامتياز',   spaceAdmin: 'الإدارة' },
}

let added = 0
for (const loc of LOCALES) {
  const file = path.join(__dirname, '..', 'messages', `${loc}.json`)
  const json = JSON.parse(fs.readFileSync(file, 'utf8'))
  if (typeof json.roleSwitcher !== 'object' || json.roleSwitcher === null) json.roleSwitcher = {}
  for (const [k, v] of Object.entries(T[loc])) {
    if (!(k in json.roleSwitcher)) added++
    json.roleSwitcher[k] = v
  }
  fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n', 'utf8')
  console.log(`✓ ${loc}.json updated`)
}
console.log(`Done — ${added} key(s) added (idempotent; 0 on re-run).`)
