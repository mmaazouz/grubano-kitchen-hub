// Fix #1/#4: the establishments-page action now navigates to that establishment's
// dashboard with a clear label (was the unclear "Basculer"). Adds
// establishment.openDashboard and removes the obsolete establishment.switchBtn.

const fs = require('fs')
const path = require('path')

const OPEN_DASHBOARD = {
  fr: 'Voir ce tableau de bord',
  en: 'Open this dashboard',
  es: 'Ver este panel',
  it: 'Apri questa dashboard',
  ar: 'افتح لوحة التحكم هذه',
}

for (const [loc, label] of Object.entries(OPEN_DASHBOARD)) {
  const p = path.join(__dirname, '..', 'messages', `${loc}.json`)
  const m = JSON.parse(fs.readFileSync(p, 'utf8'))
  if (!m.establishment) m.establishment = {}
  m.establishment.openDashboard = label
  delete m.establishment.switchBtn
  fs.writeFileSync(p, JSON.stringify(m, null, 2) + '\n', 'utf8')
  console.log(`${loc}: establishment.openDashboard set, switchBtn removed`)
}
