// Seeds dashboard.sidebar.* across the 5 locales (partner-aware identity).

const fs = require('fs')
const path = require('path')

const T = {
  fr: {
    subtitleAdmin:    'Dark Kitchen OS',
    subtitlePartner:  'Espace Partenaire',
    roleAdmin:        'Admin',
    roleRestaurateur: 'Restaurateur',
    roleFranchise:    'Franchisé',
    roleCreator:      'Créateur',
    roleConsumer:     'Client',
    roleDefault:      'Membre',
    defaultUserName:  'Utilisateur',
    connected:        'Connecté',
  },
  en: {
    subtitleAdmin:    'Dark Kitchen OS',
    subtitlePartner:  'Partner Space',
    roleAdmin:        'Admin',
    roleRestaurateur: 'Restaurant owner',
    roleFranchise:    'Franchisee',
    roleCreator:      'Creator',
    roleConsumer:     'Customer',
    roleDefault:      'Member',
    defaultUserName:  'User',
    connected:        'Connected',
  },
  es: {
    subtitleAdmin:    'Dark Kitchen OS',
    subtitlePartner:  'Espacio de Socio',
    roleAdmin:        'Admin',
    roleRestaurateur: 'Restaurador',
    roleFranchise:    'Franquiciado',
    roleCreator:      'Creador',
    roleConsumer:     'Cliente',
    roleDefault:      'Miembro',
    defaultUserName:  'Usuario',
    connected:        'Conectado',
  },
  it: {
    subtitleAdmin:    'Dark Kitchen OS',
    subtitlePartner:  'Spazio Partner',
    roleAdmin:        'Admin',
    roleRestaurateur: 'Ristoratore',
    roleFranchise:    'Affiliato',
    roleCreator:      'Creator',
    roleConsumer:     'Cliente',
    roleDefault:      'Membro',
    defaultUserName:  'Utente',
    connected:        'Connesso',
  },
  ar: {
    subtitleAdmin:    'Dark Kitchen OS',
    subtitlePartner:  'فضاء الشريك',
    roleAdmin:        'مشرف',
    roleRestaurateur: 'صاحب مطعم',
    roleFranchise:    'صاحب امتياز',
    roleCreator:      'مبدع',
    roleConsumer:     'عميل',
    roleDefault:      'عضو',
    defaultUserName:  'مستخدم',
    connected:        'متصل',
  },
}

for (const [loc, kv] of Object.entries(T)) {
  const p = path.join(__dirname, '..', 'messages', `${loc}.json`)
  const m = JSON.parse(fs.readFileSync(p, 'utf8'))
  if (!m.dashboard) m.dashboard = {}
  if (!m.dashboard.sidebar) m.dashboard.sidebar = {}
  Object.assign(m.dashboard.sidebar, kv)
  fs.writeFileSync(p, JSON.stringify(m, null, 2) + '\n', 'utf8')
  console.log(`${loc}: dashboard.sidebar = ${Object.keys(m.dashboard.sidebar).length} keys`)
}
