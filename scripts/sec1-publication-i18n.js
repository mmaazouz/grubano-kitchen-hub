/**
 * SEC1 i18n seeder (Agent 26) — admin-only publication.
 *
 * Adds two keys to the `orders` namespace, used by the operator Orders screen
 * when an establishment is offline AND the caller cannot publish it (a non-admin
 * owner). The "Réactiver" action is then replaced by a clear awaiting-validation
 * state, because publication (isActive:true) is reserved to admins.
 *
 * Idempotent: re-running only fills missing keys, never overwrites existing ones.
 * Inserted right after the existing `orders.reactivate` key so the diff is local.
 * Tone: FR vouvoiement; es/it informal; ar RTL. Run: node scripts/sec1-publication-i18n.js
 */
const fs = require('fs')
const path = require('path')

const MESSAGES = {
  fr: {
    awaitingApproval:     'En attente de validation',
    awaitingApprovalDesc: "La mise en ligne de votre établissement est validée par un administrateur. Vous pouvez tout préparer en attendant.",
  },
  en: {
    awaitingApproval:     'Pending approval',
    awaitingApprovalDesc: 'Your establishment goes live once an administrator approves it. You can set everything up in the meantime.',
  },
  es: {
    awaitingApproval:     'Pendiente de validación',
    awaitingApprovalDesc: 'Tu establecimiento se publica cuando un administrador lo aprueba. Mientras tanto, puedes prepararlo todo.',
  },
  it: {
    awaitingApproval:     'In attesa di convalida',
    awaitingApprovalDesc: 'Il tuo locale va online dopo l’approvazione di un amministratore. Nel frattempo puoi preparare tutto.',
  },
  ar: {
    awaitingApproval:     'في انتظار الموافقة',
    awaitingApprovalDesc: 'يتم نشر منشأتك بعد موافقة المسؤول. يمكنك إعداد كل شيء في هذه الأثناء.',
  },
}

/** Rebuild `orders` with the two new keys placed right after `reactivate`. */
function withKeysAfterReactivate(orders, additions) {
  const out = {}
  for (const [k, v] of Object.entries(orders)) {
    out[k] = v
    if (k === 'reactivate') {
      for (const [nk, nv] of Object.entries(additions)) {
        if (!(nk in orders)) out[nk] = nv
      }
    }
  }
  // If `reactivate` was absent for some reason, append at the end (still parity-safe).
  for (const [nk, nv] of Object.entries(additions)) {
    if (!(nk in out)) out[nk] = nv
  }
  return out
}

for (const [locale, additions] of Object.entries(MESSAGES)) {
  const file = path.join(__dirname, '..', 'messages', `${locale}.json`)
  const json = JSON.parse(fs.readFileSync(file, 'utf8'))
  json.orders = json.orders || {}
  const before = Object.keys(json.orders).length
  json.orders = withKeysAfterReactivate(json.orders, additions)
  const added = Object.keys(json.orders).length - before
  fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n', 'utf8')
  console.log(`[sec1-i18n] ${locale}.json — orders: +${added} key(s)`)
}
console.log('[sec1-i18n] done.')
