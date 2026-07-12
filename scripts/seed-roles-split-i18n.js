// Seed i18n — MISSION 2 CREATOR STUDIO : séparation chef/influenceur (Agent 13).
// Nouvelles clés : wizard (choix des rôles), toggles studio, kits de partage,
// gates de pages désactivées. RÉÉCRITURE : creators.recipes.badge devient
// paramétrique « {pct}% / vente » (le 4% en dur est mort — point dur E).
//
// Usage: node scripts/seed-roles-split-i18n.js   puis   npm run check:i18n

const fs = require('fs')
const path = require('path')

const KEYS = {
  fr: {
    creators: {
      apply: {
        rolesTitle:          'Que voulez-vous faire sur Grubano ?',
        roleChefTitle:       'Chef créateur',
        roleChefDesc:        'Vos recettes adoptées par des restaurants — royalties sur chaque vente.',
        roleInfluencerTitle: 'Influenceur',
        roleInfluencerDesc:  'Recommandez des restaurants à votre audience — commission sur les commandes.',
        rolesHint:           'Cumulables — au moins un rôle requis.',
      },
      home: {
        rolesTitle:          'Mes rôles',
        rolesHint:           'Activez ou coupez un rôle — vos données restent conservées, seuls les outils s’affichent ou se masquent.',
        roleChefLabel:       'Chef créateur',
        roleInfluencerLabel: 'Influenceur',
        rolesError:          'Changement impossible — réessayez.',
      },
      earnings: {
        kitAffiliationTitle: 'Lien d’affiliation',
        kitChefTitle:        'Ma page chef',
        kitChefQrHint:       'Faites scanner ce QR — vos fans découvrent les restaurants qui servent vos créations.',
      },
      rolesGate: {
        chefOffTitle:        'Rôle Chef créateur désactivé',
        chefOffBody:         'Vos recettes et leurs gains sont conservés — réactivez le rôle pour retrouver cet espace.',
        influencerOffTitle:  'Rôle Influenceur désactivé',
        influencerOffBody:   'Votre code et vos gains d’affiliation sont conservés — réactivez le rôle pour retrouver cet espace.',
        enableCta:           'Activer',
      },
    },
  },
  en: {
    creators: {
      apply: {
        rolesTitle:          'What do you want to do on Grubano?',
        roleChefTitle:       'Creator chef',
        roleChefDesc:        'Your recipes adopted by restaurants — royalties on every sale.',
        roleInfluencerTitle: 'Influencer',
        roleInfluencerDesc:  'Recommend restaurants to your audience — commission on orders.',
        rolesHint:           'Cumulable — at least one role required.',
      },
      home: {
        rolesTitle:          'My roles',
        rolesHint:           'Enable or disable a role — your data is kept, only the tools show or hide.',
        roleChefLabel:       'Creator chef',
        roleInfluencerLabel: 'Influencer',
        rolesError:          'Could not change — please retry.',
      },
      earnings: {
        kitAffiliationTitle: 'Affiliation link',
        kitChefTitle:        'My chef page',
        kitChefQrHint:       'Have this QR scanned — your fans discover the restaurants serving your creations.',
      },
      rolesGate: {
        chefOffTitle:        'Creator chef role disabled',
        chefOffBody:         'Your recipes and their earnings are kept — re-enable the role to get this space back.',
        influencerOffTitle:  'Influencer role disabled',
        influencerOffBody:   'Your code and affiliation earnings are kept — re-enable the role to get this space back.',
        enableCta:           'Enable',
      },
    },
  },
  es: {
    creators: {
      apply: {
        rolesTitle:          '¿Qué quieres hacer en Grubano?',
        roleChefTitle:       'Chef creador',
        roleChefDesc:        'Tus recetas adoptadas por restaurantes — regalías por cada venta.',
        roleInfluencerTitle: 'Influencer',
        roleInfluencerDesc:  'Recomienda restaurantes a tu audiencia — comisión por los pedidos.',
        rolesHint:           'Acumulables — al menos un rol obligatorio.',
      },
      home: {
        rolesTitle:          'Mis roles',
        rolesHint:           'Activa o desactiva un rol — tus datos se conservan, solo se muestran u ocultan las herramientas.',
        roleChefLabel:       'Chef creador',
        roleInfluencerLabel: 'Influencer',
        rolesError:          'No se pudo cambiar — reinténtalo.',
      },
      earnings: {
        kitAffiliationTitle: 'Enlace de afiliación',
        kitChefTitle:        'Mi página de chef',
        kitChefQrHint:       'Haz escanear este QR — tus fans descubren los restaurantes que sirven tus creaciones.',
      },
      rolesGate: {
        chefOffTitle:        'Rol Chef creador desactivado',
        chefOffBody:         'Tus recetas y sus ganancias se conservan — reactiva el rol para recuperar este espacio.',
        influencerOffTitle:  'Rol Influencer desactivado',
        influencerOffBody:   'Tu código y tus ganancias de afiliación se conservan — reactiva el rol para recuperar este espacio.',
        enableCta:           'Activar',
      },
    },
  },
  it: {
    creators: {
      apply: {
        rolesTitle:          'Cosa vuoi fare su Grubano?',
        roleChefTitle:       'Chef creator',
        roleChefDesc:        'Le tue ricette adottate dai ristoranti — royalties su ogni vendita.',
        roleInfluencerTitle: 'Influencer',
        roleInfluencerDesc:  'Consiglia ristoranti al tuo pubblico — commissione sugli ordini.',
        rolesHint:           'Cumulabili — almeno un ruolo obbligatorio.',
      },
      home: {
        rolesTitle:          'I miei ruoli',
        rolesHint:           'Attiva o disattiva un ruolo — i tuoi dati restano conservati, solo gli strumenti si mostrano o si nascondono.',
        roleChefLabel:       'Chef creator',
        roleInfluencerLabel: 'Influencer',
        rolesError:          'Modifica impossibile — riprova.',
      },
      earnings: {
        kitAffiliationTitle: 'Link di affiliazione',
        kitChefTitle:        'La mia pagina chef',
        kitChefQrHint:       'Fai scansionare questo QR — i tuoi fan scoprono i ristoranti che servono le tue creazioni.',
      },
      rolesGate: {
        chefOffTitle:        'Ruolo Chef creator disattivato',
        chefOffBody:         'Le tue ricette e i loro guadagni restano conservati — riattiva il ruolo per ritrovare questo spazio.',
        influencerOffTitle:  'Ruolo Influencer disattivato',
        influencerOffBody:   'Il tuo codice e i guadagni di affiliazione restano conservati — riattiva il ruolo per ritrovare questo spazio.',
        enableCta:           'Attiva',
      },
    },
  },
  ar: {
    creators: {
      apply: {
        rolesTitle:          'ماذا تريد أن تفعل على Grubano؟',
        roleChefTitle:       'شيف مبدع',
        roleChefDesc:        'وصفاتك تتبناها المطاعم — عوائد على كل بيع.',
        roleInfluencerTitle: 'مؤثر',
        roleInfluencerDesc:  'أوصِ جمهورك بالمطاعم — عمولة على الطلبات.',
        rolesHint:           'قابلة للجمع — دور واحد على الأقل مطلوب.',
      },
      home: {
        rolesTitle:          'أدواري',
        rolesHint:           'فعّل أو عطّل دورًا — تبقى بياناتك محفوظة، الأدوات فقط تظهر أو تُخفى.',
        roleChefLabel:       'شيف مبدع',
        roleInfluencerLabel: 'مؤثر',
        rolesError:          'تعذّر التغيير — أعد المحاولة.',
      },
      earnings: {
        kitAffiliationTitle: 'رابط الإحالة',
        kitChefTitle:        'صفحتي كشيف',
        kitChefQrHint:       'دع جمهورك يمسح هذا الرمز — يكتشفون المطاعم التي تقدّم إبداعاتك.',
      },
      rolesGate: {
        chefOffTitle:        'دور الشيف المبدع معطّل',
        chefOffBody:         'وصفاتك وأرباحها محفوظة — أعد تفعيل الدور لاستعادة هذه المساحة.',
        influencerOffTitle:  'دور المؤثر معطّل',
        influencerOffBody:   'رمزك وأرباح الإحالة محفوظة — أعد تفعيل الدور لاستعادة هذه المساحة.',
        enableCta:           'تفعيل',
      },
    },
  },
}

// RÉÉCRITURE : badge recettes paramétrique (le 4% en dur est mort).
const REWRITE_BADGE = {
  fr: '{pct}% / vente',
  en: '{pct}% / sale',
  es: '{pct}% / venta',
  it: '{pct}% / vendita',
  ar: '{pct}% / بيع',
}

function deepMerge(target, source) {
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      if (!target[key] || typeof target[key] !== 'object') target[key] = {}
      deepMerge(target[key], source[key])
    } else {
      target[key] = source[key]
    }
  }
}

for (const loc of ['fr', 'en', 'es', 'it', 'ar']) {
  const file = path.join(__dirname, '..', 'messages', `${loc}.json`)
  const m = JSON.parse(fs.readFileSync(file, 'utf8'))
  deepMerge(m, KEYS[loc])
  if (m.creators?.recipes) m.creators.recipes.badge = REWRITE_BADGE[loc]
  fs.writeFileSync(file, JSON.stringify(m, null, 2) + '\n', 'utf8')
  console.log(`[seed-roles-split-i18n] ${loc}.json OK`)
}
console.log('[seed-roles-split-i18n] Done — run: npm run check:i18n')
