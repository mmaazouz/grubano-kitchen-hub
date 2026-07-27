// Seed i18n — PROMO V2 Slice 2 : chef-moteur-de-demande (campagnes).
//   creators.campaign.* → studio chef (lancement de campagne)
//   promotions.*        → invitations + opt-in côté resto (PromotionsManager)
//   chef.*              → mise en avant campagne sur /chef/[slug]
//
// Usage: node scripts/seed-campaign-i18n.js   puis   npm run check:i18n

const fs = require('fs')
const path = require('path')

const KEYS = {
  fr: {
    campaign: {
      launchCta:    'Lancer une campagne',
      launchTitle:  'Lancer une campagne',
      launchIntro:  'Proposez une remise sur « {dish} ». Vous ne financez RIEN : les restaurants qui l’ont adoptée choisissent de participer et financent la remise.',
      fieldPct:     'Remise suggérée (%)',
      fieldMessage: 'Votre message aux clients',
      fieldMessagePh: 'Ex : Goûtez ma recette signature à prix doux cette semaine !',
      fieldStart:   'Début',
      fieldEnd:     'Fin',
      financeNote:  'Le chef propose ; chaque restaurant adopteur révise le % et finance sa propre remise.',
      launch:       'Lancer',
      cancel:       'Annuler',
      launchedOk:   'Campagne lancée ✓',
      errGeneric:   'Action impossible — réessayez.',
    },
    promotions: {
      campaignInvitesTitle:   '{count, plural, =1 {1 invitation de campagne chef} other {# invitations de campagne chef}}',
      campaignInviteHead:     '{creator} — « {dish} »',
      campaignInviteFinance:  'Vous financez la remise (votre promo resto).',
      campaignJoinCta:        'Participer',
      campaignJoinedOk:       'Vous participez à la campagne ✓',
      campaignOptInTitle:     'Participer à la campagne',
      campaignConfirmJoin:    'Confirmer',
      campaignOptInIntro:     '{creator} propose −{pct}% sur « {dish} ». Ajustez le % que VOUS financez ; ça crée une promo sur votre plat dérivé de cette recette.',
      campaignYourPct:        'Votre remise (%)',
      campaignOptInFinanceNote:'Promo resto-financée standard : commission Grubano sur le prix payé, royalties chef sur le prix carte. Fidélité désactivée sous promo.',
    },
    chef: {
      campaignBadge:        '📣 En campagne — jusqu’à −{pct}%',
      campaignParticipants: '{count, plural, =1 {1 restaurant participant} other {# restaurants participants}}',
    },
  },
  en: {
    campaign: {
      launchCta:    'Launch a campaign',
      launchTitle:  'Launch a campaign',
      launchIntro:  'Propose a discount on “{dish}”. You fund NOTHING: the restaurants that adopted it choose to take part and finance the discount.',
      fieldPct:     'Suggested discount (%)',
      fieldMessage: 'Your message to customers',
      fieldMessagePh: 'E.g. Taste my signature recipe at a sweet price this week!',
      fieldStart:   'Start',
      fieldEnd:     'End',
      financeNote:  'The chef proposes; each adopter restaurant reviews the % and finances its own discount.',
      launch:       'Launch',
      cancel:       'Cancel',
      launchedOk:   'Campaign launched ✓',
      errGeneric:   'Action failed — please retry.',
    },
    promotions: {
      campaignInvitesTitle:   '{count, plural, =1 {1 chef campaign invitation} other {# chef campaign invitations}}',
      campaignInviteHead:     '{creator} — “{dish}”',
      campaignInviteFinance:  'You finance the discount (your resto promo).',
      campaignJoinCta:        'Take part',
      campaignJoinedOk:       'You’re in the campaign ✓',
      campaignOptInTitle:     'Join the campaign',
      campaignConfirmJoin:    'Confirm',
      campaignOptInIntro:     '{creator} suggests −{pct}% on “{dish}”. Adjust the % YOU finance; it creates a promo on your dish derived from this recipe.',
      campaignYourPct:        'Your discount (%)',
      campaignOptInFinanceNote:'Standard resto-financed promo: Grubano commission on the paid price, chef royalties on the list price. Loyalty disabled under a promo.',
    },
    chef: {
      campaignBadge:        '📣 Campaign — up to −{pct}%',
      campaignParticipants: '{count, plural, =1 {1 participating restaurant} other {# participating restaurants}}',
    },
  },
  es: {
    campaign: {
      launchCta:    'Lanzar una campaña',
      launchTitle:  'Lanzar una campaña',
      launchIntro:  'Propón un descuento en «{dish}». No financias NADA: los restaurantes que la adoptaron eligen participar y financian el descuento.',
      fieldPct:     'Descuento sugerido (%)',
      fieldMessage: 'Tu mensaje a los clientes',
      fieldMessagePh: 'Ej.: ¡Prueba mi receta estrella a buen precio esta semana!',
      fieldStart:   'Inicio',
      fieldEnd:     'Fin',
      financeNote:  'El chef propone; cada restaurante adoptante revisa el % y financia su propio descuento.',
      launch:       'Lanzar',
      cancel:       'Cancelar',
      launchedOk:   'Campaña lanzada ✓',
      errGeneric:   'Acción imposible — reinténtalo.',
    },
    promotions: {
      campaignInvitesTitle:   '{count, plural, =1 {1 invitación de campaña de chef} other {# invitaciones de campaña de chef}}',
      campaignInviteHead:     '{creator} — «{dish}»',
      campaignInviteFinance:  'Tú financias el descuento (tu promo de restaurante).',
      campaignJoinCta:        'Participar',
      campaignJoinedOk:       'Participas en la campaña ✓',
      campaignOptInTitle:     'Participar en la campaña',
      campaignConfirmJoin:    'Confirmar',
      campaignOptInIntro:     '{creator} sugiere −{pct}% en «{dish}». Ajusta el % que TÚ financias; crea una promo en tu plato derivado de esta receta.',
      campaignYourPct:        'Tu descuento (%)',
      campaignOptInFinanceNote:'Promo financiada por el restaurante: comisión de Grubano sobre el precio pagado, regalías del chef sobre el precio de carta. Fidelidad desactivada con promo.',
    },
    chef: {
      campaignBadge:        '📣 En campaña — hasta −{pct}%',
      campaignParticipants: '{count, plural, =1 {1 restaurante participante} other {# restaurantes participantes}}',
    },
  },
  it: {
    campaign: {
      launchCta:    'Lancia una campagna',
      launchTitle:  'Lancia una campagna',
      launchIntro:  'Proponi uno sconto su «{dish}». Non finanzi NULLA: i ristoranti che l’hanno adottata scelgono di partecipare e finanziano lo sconto.',
      fieldPct:     'Sconto suggerito (%)',
      fieldMessage: 'Il tuo messaggio ai clienti',
      fieldMessagePh: 'Es.: Assaggia la mia ricetta firma a prezzo dolce questa settimana!',
      fieldStart:   'Inizio',
      fieldEnd:     'Fine',
      financeNote:  'Il cuoco propone; ogni ristorante adottante rivede la % e finanzia il proprio sconto.',
      launch:       'Lancia',
      cancel:       'Annulla',
      launchedOk:   'Campagna lanciata ✓',
      errGeneric:   'Azione impossibile — riprova.',
    },
    promotions: {
      campaignInvitesTitle:   '{count, plural, =1 {1 invito a campagna chef} other {# inviti a campagna chef}}',
      campaignInviteHead:     '{creator} — «{dish}»',
      campaignInviteFinance:  'Finanzi tu lo sconto (la tua promo ristorante).',
      campaignJoinCta:        'Partecipa',
      campaignJoinedOk:       'Partecipi alla campagna ✓',
      campaignOptInTitle:     'Partecipa alla campagna',
      campaignConfirmJoin:    'Conferma',
      campaignOptInIntro:     '{creator} suggerisce −{pct}% su «{dish}». Regola la % che finanzi TU; crea una promo sul tuo piatto derivato da questa ricetta.',
      campaignYourPct:        'Il tuo sconto (%)',
      campaignOptInFinanceNote:'Promo finanziata dal ristorante: commissione Grubano sul prezzo pagato, royalty del cuoco sul prezzo di listino. Fedeltà disattivata con promo.',
    },
    chef: {
      campaignBadge:        '📣 In campagna — fino a −{pct}%',
      campaignParticipants: '{count, plural, =1 {1 ristorante partecipante} other {# ristoranti partecipanti}}',
    },
  },
  ar: {
    campaign: {
      launchCta:    'إطلاق حملة',
      launchTitle:  'إطلاق حملة',
      launchIntro:  'اقترح خصمًا على «{dish}». أنت لا تموّل شيئًا: المطاعم التي تبنّت الوصفة تختار المشاركة وتموّل الخصم.',
      fieldPct:     'الخصم المقترح (%)',
      fieldMessage: 'رسالتك إلى العملاء',
      fieldMessagePh: 'مثال: تذوّق وصفتي المميزة بسعر لطيف هذا الأسبوع!',
      fieldStart:   'البداية',
      fieldEnd:     'النهاية',
      financeNote:  'المبدع يقترح؛ كل مطعم متبنٍّ يراجع النسبة ويموّل خصمه الخاص.',
      launch:       'إطلاق',
      cancel:       'إلغاء',
      launchedOk:   'تم إطلاق الحملة ✓',
      errGeneric:   'تعذّر تنفيذ الإجراء — أعد المحاولة.',
    },
    promotions: {
      campaignInvitesTitle:   '{count, plural, =1 {دعوة حملة طاهٍ واحدة} other {# دعوات حملة طاهٍ}}',
      campaignInviteHead:     '{creator} — «{dish}»',
      campaignInviteFinance:  'أنت تموّل الخصم (عرض مطعمك).',
      campaignJoinCta:        'المشاركة',
      campaignJoinedOk:       'أنت مشارك في الحملة ✓',
      campaignOptInTitle:     'المشاركة في الحملة',
      campaignConfirmJoin:    'تأكيد',
      campaignOptInIntro:     'يقترح {creator} خصم −{pct}% على «{dish}». عدّل النسبة التي تموّلها أنت؛ يُنشئ عرضًا على طبقك المشتق من هذه الوصفة.',
      campaignYourPct:        'خصمك (%)',
      campaignOptInFinanceNote:'عرض مموّل من المطعم: عمولة غروبانو على السعر المدفوع، حقوق الطاهي على سعر القائمة. الولاء معطّل أثناء العرض.',
    },
    chef: {
      campaignBadge:        '📣 ضمن حملة — حتى −{pct}%',
      campaignParticipants: '{count, plural, =1 {مطعم مشارك واحد} other {# مطاعم مشاركة}}',
    },
  },
}

for (const loc of ['fr', 'en', 'es', 'it', 'ar']) {
  const file = path.join(__dirname, '..', 'messages', `${loc}.json`)
  const m = JSON.parse(fs.readFileSync(file, 'utf8'))
  if (!m.creators) m.creators = {}
  m.creators.campaign = Object.assign(m.creators.campaign ?? {}, KEYS[loc].campaign)
  if (!m.promotions) m.promotions = {}
  Object.assign(m.promotions, KEYS[loc].promotions)
  if (!m.chef) m.chef = {}
  Object.assign(m.chef, KEYS[loc].chef)
  fs.writeFileSync(file, JSON.stringify(m, null, 2) + '\n', 'utf8')
  console.log(`[seed-campaign-i18n] ${loc}.json OK`)
}
console.log('[seed-campaign-i18n] Done — run: npm run check:i18n')
