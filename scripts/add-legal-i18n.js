/* eslint-disable */
// ── Agent 34 — legal pages i18n (mentions légales + confidentialité placeholder) ─
// Adds legal.* : shell + draft banner + mentions-légales sections (titles +
// neutral boilerplate, FR authoritative) + a minimal privacy-policy placeholder +
// sibling nav labels. FACTS (raison sociale, SIREN, hébergeur…) live in
// lib/legal-info.ts, NOT here. x5 locales, strict parity, idempotent.
// FR vouvoiement; es/it/en natural; ar genuine RTL Arabic.
// Run: node scripts/add-legal-i18n.js
const fs = require('fs')
const path = require('path')
const LOCALES = ['fr', 'en', 'es', 'it', 'ar']

// legal.* — flat keys, value arrays [fr, en, es, it, ar]
const L = {
  // — shared shell —
  'shell.skipToContent': ['Aller au contenu', 'Skip to content', 'Ir al contenido', 'Vai al contenuto', 'انتقل إلى المحتوى'],
  'shell.backHome':      ['Retour à l’accueil', 'Back to home', 'Volver al inicio', 'Torna alla home', 'العودة إلى الرئيسية'],
  'shell.otherPages':    ['Autres pages légales', 'Other legal pages', 'Otras páginas legales', 'Altre pagine legali', 'صفحات قانونية أخرى'],

  // — finalisation guard banner (shown while lib/legal-info.ts has placeholders) —
  'draftBanner': [
    '⚠️ Mentions légales en cours de finalisation — les informations relatives à la société et à l’hébergeur ne sont pas encore définitives.',
    '⚠️ Legal notice being finalised — the company and hosting details are not final yet.',
    '⚠️ Aviso legal en proceso de finalización: los datos de la empresa y del alojamiento aún no son definitivos.',
    '⚠️ Note legali in fase di finalizzazione — i dati della società e dell’hosting non sono ancora definitivi.',
    '⚠️ يجري استكمال الإشعار القانوني — لم تُحدَّد بعد بيانات الشركة والاستضافة بشكل نهائي.',
  ],

  // — sibling nav labels —
  'nav.mentions':        ['Mentions légales', 'Legal notice', 'Aviso legal', 'Note legali', 'الإشعار القانوني'],
  'nav.confidentialite': ['Politique de confidentialité', 'Privacy policy', 'Política de privacidad', 'Informativa sulla privacy', 'سياسة الخصوصية'],

  // ── Mentions légales ──────────────────────────────────────────────────────
  'mentions.title':   ['Mentions légales', 'Legal notice', 'Aviso legal', 'Note legali', 'الإشعار القانوني'],
  'mentions.intro':   [
    'Les informations ci-dessous présentent l’éditeur du site, le directeur de la publication et l’hébergeur, ainsi que les conditions d’utilisation du site.',
    'The information below identifies the site’s publisher, the publication director and the host, together with the site’s terms of use.',
    'La información siguiente identifica al editor del sitio, al director de la publicación y al alojamiento, así como las condiciones de uso del sitio.',
    'Le informazioni seguenti identificano l’editore del sito, il direttore della pubblicazione e l’hosting, nonché le condizioni d’uso del sito.',
    'تُعرّف المعلومات أدناه ناشر الموقع ومدير النشر والمستضيف، إضافةً إلى شروط استخدام الموقع.',
  ],

  'mentions.editorTitle': ['Éditeur du site', 'Site publisher', 'Editor del sitio', 'Editore del sito', 'ناشر الموقع'],
  'mentions.labelRaisonSociale': ['Raison sociale', 'Company name', 'Razón social', 'Ragione sociale', 'الاسم التجاري'],
  'mentions.labelFormeJuridique': ['Forme juridique', 'Legal form', 'Forma jurídica', 'Forma giuridica', 'الشكل القانوني'],
  'mentions.labelCapital': ['Capital social', 'Share capital', 'Capital social', 'Capitale sociale', 'رأس المال'],
  'mentions.labelSiren': ['SIREN', 'SIREN', 'SIREN', 'SIREN', 'رقم SIREN'],
  'mentions.labelSiret': ['SIRET', 'SIRET', 'SIRET', 'SIRET', 'رقم SIRET'],
  'mentions.labelRcs': ['RCS', 'Trade register (RCS)', 'Registro mercantil (RCS)', 'Registro imprese (RCS)', 'السجل التجاري (RCS)'],
  'mentions.labelTva': ['TVA intracommunautaire', 'Intra-EU VAT', 'IVA intracomunitaria', 'IVA intracomunitaria', 'رقم ضريبة القيمة المضافة'],
  'mentions.labelSiege': ['Siège social', 'Registered office', 'Domicilio social', 'Sede legale', 'المقر الاجتماعي'],
  'mentions.labelEmail': ['E-mail', 'Email', 'Correo electrónico', 'E-mail', 'البريد الإلكتروني'],
  'mentions.labelTelephone': ['Téléphone', 'Phone', 'Teléfono', 'Telefono', 'الهاتف'],

  'mentions.directorTitle': ['Directeur de la publication', 'Publication director', 'Director de la publicación', 'Direttore della pubblicazione', 'مدير النشر'],

  'mentions.hostTitle': ['Hébergeur', 'Hosting provider', 'Alojamiento', 'Hosting', 'المستضيف'],
  'mentions.labelHostNom': ['Hébergeur', 'Host', 'Proveedor', 'Provider', 'المستضيف'],
  'mentions.labelHostAdresse': ['Adresse', 'Address', 'Dirección', 'Indirizzo', 'العنوان'],
  'mentions.labelHostContact': ['Contact', 'Contact', 'Contacto', 'Contatto', 'جهة الاتصال'],

  'mentions.ipTitle': ['Propriété intellectuelle', 'Intellectual property', 'Propiedad intelectual', 'Proprietà intellettuale', 'الملكية الفكرية'],
  'mentions.ipBody': [
    'L’ensemble des contenus du site (textes, visuels, logos, marques, mise en page) est protégé par le droit de la propriété intellectuelle. Toute reproduction ou représentation, totale ou partielle, sans autorisation préalable est interdite.',
    'All content on the site (text, images, logos, trademarks, layout) is protected by intellectual property law. Any reproduction or representation, in whole or in part, without prior authorisation is prohibited.',
    'Todos los contenidos del sitio (textos, imágenes, logotipos, marcas, diseño) están protegidos por la propiedad intelectual. Queda prohibida toda reproducción o representación, total o parcial, sin autorización previa.',
    'Tutti i contenuti del sito (testi, immagini, loghi, marchi, impaginazione) sono protetti dal diritto di proprietà intellettuale. È vietata qualsiasi riproduzione o rappresentazione, totale o parziale, senza previa autorizzazione.',
    'جميع محتويات الموقع (نصوص وصور وشعارات وعلامات تجارية وتصميم) محمية بموجب قانون الملكية الفكرية. يُمنع أي نسخ أو عرض، كليًّا أو جزئيًّا، دون إذن مسبق.',
  ],

  'mentions.dataTitle': ['Données personnelles (RGPD)', 'Personal data (GDPR)', 'Datos personales (RGPD)', 'Dati personali (GDPR)', 'البيانات الشخصية (GDPR)'],
  'mentions.dataBody': [
    'Conformément au Règlement général sur la protection des données (RGPD), vous disposez d’un droit d’accès, de rectification, d’effacement, de limitation, de portabilité et d’opposition concernant vos données personnelles. Vous pouvez exercer ces droits en contactant l’éditeur à l’adresse e-mail indiquée ci-dessus.',
    'In accordance with the General Data Protection Regulation (GDPR), you have the right to access, rectify, erase, restrict, port and object to the processing of your personal data. You can exercise these rights by contacting the publisher at the email address shown above.',
    'De conformidad con el Reglamento General de Protección de Datos (RGPD), usted tiene derecho de acceso, rectificación, supresión, limitación, portabilidad y oposición sobre sus datos personales. Puede ejercer estos derechos contactando con el editor en el correo indicado más arriba.',
    'In conformità al Regolamento generale sulla protezione dei dati (GDPR), hai diritto di accesso, rettifica, cancellazione, limitazione, portabilità e opposizione sui tuoi dati personali. Puoi esercitare questi diritti contattando l’editore all’indirizzo e-mail indicato sopra.',
    'وفقًا للائحة العامة لحماية البيانات (GDPR)، يحق لك الوصول إلى بياناتك الشخصية وتصحيحها ومحوها وتقييدها ونقلها والاعتراض على معالجتها. يمكنك ممارسة هذه الحقوق بالتواصل مع الناشر عبر البريد الإلكتروني المذكور أعلاه.',
  ],
  'mentions.dataPrivacyLink': ['Consulter notre politique de confidentialité', 'Read our privacy policy', 'Consultar nuestra política de privacidad', 'Leggi la nostra informativa sulla privacy', 'اطّلع على سياسة الخصوصية الخاصة بنا'],

  'mentions.cookiesTitle': ['Cookies', 'Cookies', 'Cookies', 'Cookie', 'ملفات تعريف الارتباط'],
  'mentions.cookiesBody': [
    'Le site peut déposer des cookies nécessaires à son fonctionnement et, le cas échéant, des cookies de mesure d’audience. Vous pouvez configurer votre navigateur pour les refuser. Le détail figure dans la politique de confidentialité.',
    'The site may set cookies required for its operation and, where applicable, audience-measurement cookies. You can configure your browser to refuse them. Details are provided in the privacy policy.',
    'El sitio puede usar cookies necesarias para su funcionamiento y, en su caso, cookies de medición de audiencia. Puede configurar su navegador para rechazarlas. El detalle figura en la política de privacidad.',
    'Il sito può utilizzare cookie necessari al suo funzionamento e, se del caso, cookie di misurazione del pubblico. Puoi configurare il browser per rifiutarli. I dettagli sono nell’informativa sulla privacy.',
    'قد يستخدم الموقع ملفات تعريف ارتباط ضرورية لعمله، وعند الاقتضاء ملفات لقياس الجمهور. يمكنك ضبط متصفحك لرفضها. التفاصيل في سياسة الخصوصية.',
  ],

  'mentions.mediationTitle': ['Médiation de la consommation', 'Consumer mediation', 'Mediación de consumo', 'Mediazione del consumo', 'الوساطة الاستهلاكية'],
  'mentions.mediationBody': [
    'Conformément au Code de la consommation, le consommateur peut recourir gratuitement à un médiateur de la consommation en vue de la résolution amiable d’un litige. Les coordonnées du médiateur compétent sont indiquées ci-dessous.',
    'In accordance with consumer law, a consumer may use a consumer mediator free of charge to settle a dispute amicably. The relevant mediator’s contact details are shown below.',
    'De acuerdo con el derecho de consumo, el consumidor puede recurrir gratuitamente a un mediador de consumo para resolver un litigio de forma amistosa. Los datos del mediador competente figuran a continuación.',
    'In conformità al diritto dei consumatori, il consumatore può ricorrere gratuitamente a un mediatore del consumo per la risoluzione amichevole di una controversia. I recapiti del mediatore competente sono indicati di seguito.',
    'وفقًا لقانون الاستهلاك، يجوز للمستهلك اللجوء مجانًا إلى وسيط استهلاكي لتسوية النزاع وديًّا. تَرِد بيانات الوسيط المختصّ أدناه.',
  ],
  'mentions.labelMediatorNom': ['Médiateur', 'Mediator', 'Mediador', 'Mediatore', 'الوسيط'],
  'mentions.labelMediatorUrl': ['Site de saisine', 'Referral website', 'Sitio de solicitud', 'Sito per il ricorso', 'موقع تقديم الطلب'],
  'mentions.labelMediatorAdresse': ['Adresse', 'Address', 'Dirección', 'Indirizzo', 'العنوان'],

  'mentions.lawTitle': ['Loi applicable et juridiction', 'Governing law and jurisdiction', 'Ley aplicable y jurisdicción', 'Legge applicabile e foro competente', 'القانون المُطبَّق والاختصاص القضائي'],
  'mentions.lawBody': [
    'Le présent site et les présentes mentions sont soumis au droit français. En cas de litige et à défaut de résolution amiable, les tribunaux français sont compétents.',
    'This site and these notices are governed by French law. In the event of a dispute and failing an amicable settlement, the French courts have jurisdiction.',
    'Este sitio y el presente aviso se rigen por el derecho francés. En caso de litigio y a falta de acuerdo amistoso, los tribunales franceses son competentes.',
    'Il presente sito e le presenti note sono soggetti al diritto francese. In caso di controversia e in mancanza di accordo amichevole, sono competenti i tribunali francesi.',
    'يخضع هذا الموقع وهذه الإشعارات للقانون الفرنسي. في حال نشوء نزاع وتعذُّر التسوية الودية، تختصّ المحاكم الفرنسية بالنظر فيه.',
  ],

  // ── Politique de confidentialité (placeholder minimal) ─────────────────────
  'confidentialite.title': ['Politique de confidentialité', 'Privacy policy', 'Política de privacidad', 'Informativa sulla privacy', 'سياسة الخصوصية'],
  'confidentialite.draftNote': [
    'Cette page est en cours de préparation. Une version détaillée sera publiée prochainement. Les principes essentiels figurent ci-dessous.',
    'This page is being prepared. A detailed version will be published soon. The key principles are set out below.',
    'Esta página está en preparación. Próximamente se publicará una versión detallada. A continuación se indican los principios esenciales.',
    'Questa pagina è in preparazione. A breve sarà pubblicata una versione dettagliata. Di seguito i principi essenziali.',
    'هذه الصفحة قيد الإعداد. ستُنشر نسخة مفصّلة قريبًا. ترِد المبادئ الأساسية أدناه.',
  ],
  'confidentialite.collectTitle': ['Données collectées', 'Data collected', 'Datos recopilados', 'Dati raccolti', 'البيانات المجمَّعة'],
  'confidentialite.collectBody': [
    'Nous collectons uniquement les données nécessaires à la création de votre compte, au traitement de vos commandes et au bon fonctionnement du service.',
    'We collect only the data needed to create your account, process your orders and operate the service properly.',
    'Solo recopilamos los datos necesarios para crear su cuenta, tramitar sus pedidos y prestar correctamente el servicio.',
    'Raccogliamo solo i dati necessari per creare il tuo account, gestire i tuoi ordini e far funzionare correttamente il servizio.',
    'نجمع فقط البيانات اللازمة لإنشاء حسابك ومعالجة طلباتك وتشغيل الخدمة بشكل سليم.',
  ],
  'confidentialite.rightsTitle': ['Vos droits', 'Your rights', 'Sus derechos', 'I tuoi diritti', 'حقوقك'],
  'confidentialite.rightsBody': [
    'Vous disposez d’un droit d’accès, de rectification, d’effacement, de limitation, de portabilité et d’opposition sur vos données, que vous pouvez exercer auprès de l’éditeur.',
    'You have the right to access, rectify, erase, restrict, port and object to the processing of your data, which you can exercise with the publisher.',
    'Tiene derecho de acceso, rectificación, supresión, limitación, portabilidad y oposición sobre sus datos, que puede ejercer ante el editor.',
    'Hai diritto di accesso, rettifica, cancellazione, limitazione, portabilità e opposizione sui tuoi dati, che puoi esercitare presso l’editore.',
    'يحق لك الوصول إلى بياناتك وتصحيحها ومحوها وتقييدها ونقلها والاعتراض على معالجتها، ويمكنك ممارسة ذلك لدى الناشر.',
  ],
  'confidentialite.contactTitle': ['Contact', 'Contact', 'Contacto', 'Contatto', 'التواصل'],
  'confidentialite.contactBody': [
    'Pour toute question relative à vos données, contactez l’éditeur à l’adresse e-mail indiquée dans les mentions légales.',
    'For any question about your data, contact the publisher at the email address shown in the legal notice.',
    'Para cualquier pregunta sobre sus datos, contacte con el editor en el correo indicado en el aviso legal.',
    'Per qualsiasi domanda sui tuoi dati, contatta l’editore all’indirizzo e-mail indicato nelle note legali.',
    'لأي استفسار بخصوص بياناتك، تواصل مع الناشر عبر البريد الإلكتروني المذكور في الإشعار القانوني.',
  ],
}

LOCALES.forEach((loc, i) => {
  const file = path.join(__dirname, '..', 'messages', `${loc}.json`)
  const json = JSON.parse(fs.readFileSync(file, 'utf8'))
  json.legal = json.legal || {}
  // expand dot-keys into nested objects
  for (const dotKey of Object.keys(L)) {
    const parts = dotKey.split('.')
    let node = json.legal
    for (let p = 0; p < parts.length - 1; p++) {
      node[parts[p]] = node[parts[p]] || {}
      node = node[parts[p]]
    }
    node[parts[parts.length - 1]] = L[dotKey][i]
  }
  fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n', 'utf8')
  console.log(`  ✓ ${loc}.json — legal.* (+${Object.keys(L).length})`)
})
console.log('[add-legal-i18n] done.')
