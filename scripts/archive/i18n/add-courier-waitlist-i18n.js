// scripts/add-courier-waitlist-i18n.js — LA (Agent 72).
// Courier registration is now a non-activating WAITLIST (LOGISTICS_COURIER_ACTIVATION_
// ENABLED OFF). Adds the waitlist copy: register success (business.logistics.success*Waitlist)
// + dashboard banner (business.logistics.dashboard.waitlist*). FR vouvoiement, real Arabic,
// B2B hook ("meals AND supplier orders"). Idempotent; 2-space JSON + trailing newline.
// Run: node scripts/add-courier-waitlist-i18n.js
'use strict'
const fs = require('fs')
const path = require('path')

// Flat keys under business.logistics (register success copy).
const SUCCESS = {
  fr: {
    successTitleWaitlist: 'Vous êtes sur la liste 🚀',
    successBodyWaitlist: 'Merci ! Nous construisons le réseau de livreurs Grubano — repas ET commandes fournisseurs. Nous vous recontacterons dès l’ouverture des missions dans votre zone.',
  },
  en: {
    successTitleWaitlist: 'You’re on the list 🚀',
    successBodyWaitlist: 'Thank you! We’re building the Grubano courier network — meals AND supplier orders. We’ll reach out as soon as missions open in your area.',
  },
  es: {
    successTitleWaitlist: 'Estás en la lista 🚀',
    successBodyWaitlist: '¡Gracias! Estamos construyendo la red de repartidores de Grubano — comidas Y pedidos de proveedores. Te contactaremos en cuanto se abran las misiones en tu zona.',
  },
  it: {
    successTitleWaitlist: 'Sei in lista 🚀',
    successBodyWaitlist: 'Grazie! Stiamo costruendo la rete di rider Grubano — pasti E ordini fornitori. Ti ricontatteremo non appena le missioni saranno disponibili nella tua zona.',
  },
  ar: {
    successTitleWaitlist: 'أنت على القائمة 🚀',
    successBodyWaitlist: 'شكرًا لك! نحن نبني شبكة موصّلي Grubano — وجبات وطلبات المورّدين معًا. سنتواصل معك فور فتح المهام في منطقتك.',
  },
}

// Keys under business.logistics.dashboard (dashboard waitlist banner).
const DASH = {
  fr: {
    waitlistTitle: 'Livreur fondateur — sur la liste d’attente',
    waitlistBody: 'Votre candidature est bien enregistrée. Le réseau de livraison Grubano (repas + fournisseurs) se construit ; nous vous préviendrons dès l’ouverture des missions près de chez vous.',
  },
  en: {
    waitlistTitle: 'Founding courier — on the waitlist',
    waitlistBody: 'Your application is saved. The Grubano delivery network (meals + suppliers) is being built; we’ll notify you as soon as missions open near you.',
  },
  es: {
    waitlistTitle: 'Repartidor fundador — en lista de espera',
    waitlistBody: 'Tu solicitud está guardada. La red de reparto de Grubano (comidas + proveedores) se está construyendo; te avisaremos en cuanto se abran misiones cerca de ti.',
  },
  it: {
    waitlistTitle: 'Rider fondatore — in lista d’attesa',
    waitlistBody: 'La tua candidatura è salvata. La rete di consegna Grubano (pasti + fornitori) è in costruzione; ti avviseremo appena le missioni apriranno vicino a te.',
  },
  ar: {
    waitlistTitle: 'موصّل مؤسّس — على قائمة الانتظار',
    waitlistBody: 'تم حفظ طلبك. شبكة التوصيل في Grubano (وجبات + مورّدون) قيد الإنشاء؛ سنُعلِمك فور فتح المهام بالقرب منك.',
  },
}

let changed = 0
for (const loc of Object.keys(SUCCESS)) {
  const file = path.join(__dirname, '..', 'messages', `${loc}.json`)
  const json = JSON.parse(fs.readFileSync(file, 'utf8'))
  json.business = json.business || {}
  json.business.logistics = json.business.logistics || {}
  Object.assign(json.business.logistics, SUCCESS[loc])
  json.business.logistics.dashboard = json.business.logistics.dashboard || {}
  Object.assign(json.business.logistics.dashboard, DASH[loc])
  fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n', 'utf8')
  changed++
  console.log(`✓ ${loc}: +${Object.keys(SUCCESS[loc]).length} success + ${Object.keys(DASH[loc]).length} dashboard waitlist keys`)
}
console.log(`Done — ${changed} locale files updated.`)
