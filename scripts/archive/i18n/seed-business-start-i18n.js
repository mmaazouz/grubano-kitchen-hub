// Seeds business.start.* + business.franchiseSoon.* across the 5 locales.

const fs = require('fs')
const path = require('path')

const T = {
  fr: {
    start: {
      title: 'Rejoins Grubano',
      subtitle: 'Choisis le profil qui te correspond.',
      restaurateurTitle: 'Restaurateur',
      restaurateurDesc: 'Vends tes plats, en livraison ou sur place',
      creatorTitle: 'Créateur de recettes',
      creatorDesc: 'Crée des recettes, gagne sur chaque vente',
      influencerTitle: 'Affilié / Influenceur',
      influencerDesc: 'Amène des clients, sois payé au résultat',
      franchisorTitle: 'Franchiseur',
      franchisorDesc: 'Déploie ton enseigne sur plusieurs villes',
      alreadyAccount: 'Tu as déjà un compte ?',
      signIn: 'Se connecter',
    },
    franchiseSoon: {
      badge: 'Bientôt disponible',
      title: 'Franchiseur',
      body: 'Le déploiement de ton enseigne sur plusieurs villes arrive très bientôt. Notre équipe t’accompagne personnellement à chaque étape.',
      dedicatedSupport: 'Accompagnement dédié — on te recontacte',
      contactCta: 'Nous contacter',
      back: 'Retour aux profils',
    },
  },
  en: {
    start: {
      title: 'Join Grubano',
      subtitle: 'Choose the profile that fits you.',
      restaurateurTitle: 'Restaurant owner',
      restaurateurDesc: 'Sell your dishes, for delivery or pickup',
      creatorTitle: 'Recipe creator',
      creatorDesc: 'Create recipes, earn on every sale',
      influencerTitle: 'Affiliate / Influencer',
      influencerDesc: 'Bring in customers, get paid on results',
      franchisorTitle: 'Franchisor',
      franchisorDesc: 'Expand your brand across several cities',
      alreadyAccount: 'Already have an account?',
      signIn: 'Sign in',
    },
    franchiseSoon: {
      badge: 'Coming soon',
      title: 'Franchisor',
      body: 'Expanding your brand across several cities is coming very soon. Our team will support you personally at every step.',
      dedicatedSupport: 'Dedicated support — we’ll get back to you',
      contactCta: 'Contact us',
      back: 'Back to profiles',
    },
  },
  es: {
    start: {
      title: 'Únete a Grubano',
      subtitle: 'Elige el perfil que te corresponde.',
      restaurateurTitle: 'Restaurador',
      restaurateurDesc: 'Vende tus platos, en entrega o recogida',
      creatorTitle: 'Creador de recetas',
      creatorDesc: 'Crea recetas, gana en cada venta',
      influencerTitle: 'Afiliado / Influencer',
      influencerDesc: 'Trae clientes, cobra por resultados',
      franchisorTitle: 'Franquiciador',
      franchisorDesc: 'Expande tu marca por varias ciudades',
      alreadyAccount: '¿Ya tienes una cuenta?',
      signIn: 'Iniciar sesión',
    },
    franchiseSoon: {
      badge: 'Próximamente',
      title: 'Franquiciador',
      body: 'La expansión de tu marca por varias ciudades llega muy pronto. Nuestro equipo te acompaña personalmente en cada paso.',
      dedicatedSupport: 'Acompañamiento dedicado — te contactaremos',
      contactCta: 'Contáctanos',
      back: 'Volver a los perfiles',
    },
  },
  it: {
    start: {
      title: 'Unisciti a Grubano',
      subtitle: 'Scegli il profilo che fa per te.',
      restaurateurTitle: 'Ristoratore',
      restaurateurDesc: 'Vendi i tuoi piatti, in consegna o ritiro',
      creatorTitle: 'Creator di ricette',
      creatorDesc: 'Crea ricette, guadagna su ogni vendita',
      influencerTitle: 'Affiliato / Influencer',
      influencerDesc: 'Porta clienti, vieni pagato sui risultati',
      franchisorTitle: 'Affiliante',
      franchisorDesc: 'Espandi il tuo marchio in più città',
      alreadyAccount: 'Hai già un account?',
      signIn: 'Accedi',
    },
    franchiseSoon: {
      badge: 'In arrivo',
      title: 'Affiliante',
      body: 'L’espansione del tuo marchio in più città arriva molto presto. Il nostro team ti accompagna personalmente in ogni fase.',
      dedicatedSupport: 'Supporto dedicato — ti ricontatteremo',
      contactCta: 'Contattaci',
      back: 'Torna ai profili',
    },
  },
  ar: {
    start: {
      title: 'انضم إلى Grubano',
      subtitle: 'اختر الملف الذي يناسبك.',
      restaurateurTitle: 'صاحب مطعم',
      restaurateurDesc: 'بِع أطباقك، توصيلاً أو استلاماً',
      creatorTitle: 'مبدع وصفات',
      creatorDesc: 'أنشئ وصفات واربح من كل عملية بيع',
      influencerTitle: 'مسوّق / مؤثّر',
      influencerDesc: 'اجلب العملاء واحصل على أجرك حسب النتائج',
      franchisorTitle: 'مانح امتياز',
      franchisorDesc: 'وسّع علامتك في عدة مدن',
      alreadyAccount: 'لديك حساب بالفعل؟',
      signIn: 'تسجيل الدخول',
    },
    franchiseSoon: {
      badge: 'قريباً',
      title: 'مانح امتياز',
      body: 'توسيع علامتك في عدة مدن قادم قريباً جداً. فريقنا يرافقك شخصياً في كل خطوة.',
      dedicatedSupport: 'مرافقة مخصّصة — سنتواصل معك',
      contactCta: 'تواصل معنا',
      back: 'العودة إلى الملفات',
    },
  },
}

for (const [loc, sections] of Object.entries(T)) {
  const p = path.join(__dirname, '..', 'messages', `${loc}.json`)
  const m = JSON.parse(fs.readFileSync(p, 'utf8'))
  if (!m.business) m.business = {}
  if (!m.business.start) m.business.start = {}
  if (!m.business.franchiseSoon) m.business.franchiseSoon = {}
  Object.assign(m.business.start, sections.start)
  Object.assign(m.business.franchiseSoon, sections.franchiseSoon)
  fs.writeFileSync(p, JSON.stringify(m, null, 2) + '\n', 'utf8')
  console.log(
    `${loc}: business.start=${Object.keys(m.business.start).length}, business.franchiseSoon=${Object.keys(m.business.franchiseSoon).length}`,
  )
}
