'use strict'

// scripts/seed-become-creator-i18n.js — Mission 14 Phase 3 (Agent 14), idempotent.
// Adds eat.account.menuBecomeCreator (the "become also a creator" account entry)
// across all five locales. Re-running is a no-op. Then `npm run check:i18n` stays green.
//   node scripts/seed-become-creator-i18n.js

const fs   = require('fs')
const path = require('path')

const LOCALES = ['fr', 'en', 'es', 'it', 'ar']
const VALUES = {
  fr: 'Devenir aussi créateur',
  en: 'Also become a creator',
  es: 'Conviértete también en creador',
  it: 'Diventa anche creator',
  ar: 'كن منشئًا أيضًا',
}

let added = 0
for (const loc of LOCALES) {
  const file = path.join(__dirname, '..', 'messages', `${loc}.json`)
  const json = JSON.parse(fs.readFileSync(file, 'utf8'))
  if (typeof json.eat !== 'object' || json.eat === null) json.eat = {}
  if (typeof json.eat.account !== 'object' || json.eat.account === null) json.eat.account = {}
  if (!('menuBecomeCreator' in json.eat.account)) added++
  json.eat.account.menuBecomeCreator = VALUES[loc]
  fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n', 'utf8')
  console.log(`✓ ${loc}.json updated`)
}
console.log(`Done — ${added} key(s) added (idempotent; 0 on re-run).`)
