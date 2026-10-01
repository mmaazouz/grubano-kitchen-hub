/* eslint-disable */
// ── Agent 35 — GDPR privacy policy + cookies page i18n ────────────────────────
// Extends legal.confidentialite.* into a full RGPD policy and adds legal.cookies.*
// + legal.nav.cookies, anchored on the REAL processing (Stripe, Anthropic, French
// business registry, OAuth, email provider TBD; cookies NEXT_LOCALE / session /
// estab / ref). FACTS (raison sociale, durées, DPO, sous-traitant e-mail…) come
// from lib/legal-info.ts — here only titles + boilerplate. Also makes the partner
// register consent (business.auth.consentText) link to the privacy page via a
// <privacy> rich-text tag. x5 locales, strict parity. FR vouvoiement; real Arabic.
// Run: node scripts/add-legal-privacy-cookies-i18n.js
const fs = require('fs')
const path = require('path')
const LOCALES = ['fr', 'en', 'es', 'it', 'ar']

// dot-keys under json.legal — value arrays [fr, en, es, it, ar]
const L = {
  'nav.cookies': ['Cookies', 'Cookies', 'Cookies', 'Cookie', 'ملفات الارتباط'],

  // ── Politique de confidentialité (full RGPD policy) ────────────────────────
  'confidentialite.title': ['Politique de confidentialité', 'Privacy policy', 'Política de privacidad', 'Informativa sulla privacy', 'سياسة الخصوصية'],
  'confidentialite.intro': [
    'La présente politique décrit comment vos données personnelles sont collectées et traitées lorsque vous utilisez Grubano, ainsi que les droits dont vous disposez. C’est un modèle standard, à faire valider juridiquement.',
    'This policy describes how your personal data is collected and processed when you use Grubano, and the rights you have. It is a standard model, to be validated by a lawyer.',
    'Esta política describe cómo se recopilan y tratan sus datos personales al usar Grubano, así como los derechos que le asisten. Es un modelo estándar, a validar por un jurista.',
    'La presente informativa descrive come i tuoi dati personali sono raccolti e trattati quando usi Grubano e i diritti di cui disponi. È un modello standard, da validare legalmente.',
    'توضّح هذه السياسة كيفية جمع بياناتك الشخصية ومعالجتها عند استخدام Grubano، والحقوق المتاحة لك. وهي نموذج قياسي يخضع للمراجعة القانونية.',
  ],

  'confidentialite.controllerTitle': ['Responsable du traitement', 'Data controller', 'Responsable del tratamiento', 'Titolare del trattamento', 'المسؤول عن المعالجة'],
  'confidentialite.controllerBody': [
    'Le responsable du traitement est l’éditeur du site, identifié dans les mentions légales. Vous pouvez le contacter pour toute question relative à vos données.',
    'The data controller is the site’s publisher, identified in the legal notice. You can contact them for any question about your data.',
    'El responsable del tratamiento es el editor del sitio, identificado en el aviso legal. Puede contactarlo para cualquier consulta sobre sus datos.',
    'Il titolare del trattamento è l’editore del sito, indicato nelle note legali. Puoi contattarlo per qualsiasi domanda sui tuoi dati.',
    'المسؤول عن المعالجة هو ناشر الموقع المُحدَّد في الإشعار القانوني. يمكنك التواصل معه بشأن أي استفسار عن بياناتك.',
  ],

  'confidentialite.dataTitle': ['Données collectées et finalités', 'Data collected and purposes', 'Datos recopilados y finalidades', 'Dati raccolti e finalità', 'البيانات المجمَّعة والأغراض'],
  'confidentialite.dataIntro': [
    'Nous collectons uniquement les données nécessaires aux finalités suivantes :',
    'We collect only the data necessary for the following purposes:',
    'Solo recopilamos los datos necesarios para las siguientes finalidades:',
    'Raccogliamo solo i dati necessari per le seguenti finalità:',
    'نجمع فقط البيانات اللازمة للأغراض التالية:',
  ],
  'confidentialite.catAccountTitle': ['Compte & identité', 'Account & identity', 'Cuenta e identidad', 'Account e identità', 'الحساب والهوية'],
  'confidentialite.catAccountBody': [
    'E-mail, nom, téléphone éventuel et rôles — pour créer et gérer votre compte et permettre la connexion par lien magique ou par fournisseur d’identité (Google, Apple) le cas échéant.',
    'Email, name, any phone number and roles — to create and manage your account and enable sign-in by magic link or identity provider (Google, Apple) where applicable.',
    'Correo, nombre, teléfono si procede y roles — para crear y gestionar su cuenta y permitir el inicio de sesión por enlace mágico o proveedor de identidad (Google, Apple) cuando proceda.',
    'E-mail, nome, eventuale telefono e ruoli — per creare e gestire il tuo account e consentire l’accesso tramite link magico o provider d’identità (Google, Apple) ove applicabile.',
    'البريد الإلكتروني والاسم والهاتف إن وُجد والأدوار — لإنشاء حسابك وإدارته وتمكين تسجيل الدخول عبر الرابط السحري أو موفّر هوية (Google أو Apple) عند الاقتضاء.',
  ],
  'confidentialite.catBusinessTitle': ['Identité professionnelle (KYB)', 'Business identity (KYB)', 'Identidad profesional (KYB)', 'Identità aziendale (KYB)', 'الهوية التجارية (KYB)'],
  'confidentialite.catBusinessBody': [
    'Pour les partenaires (restaurateurs, fournisseurs, franchises), votre n° SIREN et la dénomination déclarée sont vérifiés auprès du registre officiel des entreprises afin de confirmer l’existence de votre activité.',
    'For partners (restaurateurs, suppliers, franchises), your SIREN number and declared name are checked against the official business registry to confirm your activity exists.',
    'Para los socios (restauradores, proveedores, franquicias), su número SIREN y la denominación declarada se verifican en el registro oficial de empresas para confirmar la existencia de su actividad.',
    'Per i partner (ristoratori, fornitori, franchising), il tuo numero SIREN e la denominazione dichiarata sono verificati presso il registro ufficiale delle imprese per confermare l’esistenza dell’attività.',
    'بالنسبة للشركاء (المطاعم والموردين والامتيازات)، يُتحقَّق من رقم SIREN والاسم المُصرَّح به لدى السجل الرسمي للشركات لتأكيد وجود نشاطك.',
  ],
  'confidentialite.catOrdersTitle': ['Commandes, réservations & paiements', 'Orders, reservations & payments', 'Pedidos, reservas y pagos', 'Ordini, prenotazioni e pagamenti', 'الطلبات والحجوزات والمدفوعات'],
  'confidentialite.catOrdersBody': [
    'Détail des commandes et réservations, adresse de livraison et données de paiement traitées par notre prestataire de paiement, afin d’exécuter et de suivre vos commandes et, le cas échéant, l’empreinte de garantie d’une réservation.',
    'Order and reservation details, delivery address and payment data processed by our payment provider, to fulfil and track your orders and, where applicable, a reservation guarantee hold.',
    'Detalle de pedidos y reservas, dirección de entrega y datos de pago tratados por nuestro proveedor de pago, para ejecutar y seguir sus pedidos y, si procede, la retención de garantía de una reserva.',
    'Dettaglio di ordini e prenotazioni, indirizzo di consegna e dati di pagamento trattati dal nostro fornitore di pagamento, per eseguire e tracciare i tuoi ordini e, se del caso, la pre-autorizzazione di garanzia di una prenotazione.',
    'تفاصيل الطلبات والحجوزات وعنوان التوصيل وبيانات الدفع التي يعالجها مزوّد الدفع لدينا، لتنفيذ طلباتك وتتبّعها، وعند الاقتضاء حجز ضمان الحجز.',
  ],
  'confidentialite.catPartnersTitle': ['Profils partenaires & assistance IA', 'Partner profiles & AI assistance', 'Perfiles de socios y asistencia IA', 'Profili partner e assistenza IA', 'ملفات الشركاء والمساعدة بالذكاء الاصطناعي'],
  'confidentialite.catPartnersBody': [
    'Données de profil des fournisseurs et créateurs (entreprise, zones, contenus déclarés). Lors de l’inscription, certaines de ces informations peuvent être analysées par un prestataire d’intelligence artificielle pour vérifier la cohérence et la légitimité de la candidature ; aucune donnée bancaire n’est envoyée à ce prestataire.',
    'Profile data of suppliers and creators (company, zones, declared content). At registration, some of this information may be analysed by an artificial-intelligence provider to check the consistency and legitimacy of the application; no banking data is sent to that provider.',
    'Datos de perfil de proveedores y creadores (empresa, zonas, contenidos declarados). Al registrarse, parte de esta información puede ser analizada por un proveedor de inteligencia artificial para comprobar la coherencia y legitimidad de la solicitud; no se envían datos bancarios a dicho proveedor.',
    'Dati di profilo di fornitori e creator (azienda, zone, contenuti dichiarati). In fase di registrazione, alcune di queste informazioni possono essere analizzate da un fornitore di intelligenza artificiale per verificare la coerenza e la legittimità della candidatura; nessun dato bancario è inviato a tale fornitore.',
    'بيانات ملفات الموردين والمبدعين (الشركة والمناطق والمحتويات المُصرَّح بها). عند التسجيل، قد يُحلِّل مزوّد ذكاء اصطناعي بعض هذه المعلومات للتحقق من اتساق الطلب ومشروعيته؛ ولا تُرسَل أي بيانات مصرفية إلى هذا المزوّد.',
  ],
  'confidentialite.catTechnicalTitle': ['Journaux techniques', 'Technical logs', 'Registros técnicos', 'Log tecnici', 'السجلات التقنية'],
  'confidentialite.catTechnicalBody': [
    'Journaux d’envoi des e-mails transactionnels et mesure d’usage interne des fonctionnalités d’IA (à des fins de coût et de sécurité). Ces journaux servent au bon fonctionnement et à la sécurité du service.',
    'Logs of transactional email delivery and internal usage metering of the AI features (for cost and security). These logs serve the proper operation and security of the service.',
    'Registros de envío de correos transaccionales y medición interna de uso de las funciones de IA (por coste y seguridad). Sirven para el buen funcionamiento y la seguridad del servicio.',
    'Log di invio delle e-mail transazionali e misurazione interna dell’uso delle funzioni di IA (per costi e sicurezza). Servono al corretto funzionamento e alla sicurezza del servizio.',
    'سجلات إرسال رسائل البريد المعامِلاتي والقياس الداخلي لاستخدام ميزات الذكاء الاصطناعي (لأغراض التكلفة والأمان). تخدم هذه السجلات حُسن تشغيل الخدمة وأمانها.',
  ],

  'confidentialite.legalBasisTitle': ['Bases légales', 'Legal bases', 'Bases jurídicas', 'Basi giuridiche', 'الأسس القانونية'],
  'confidentialite.legalBasisBody': [
    'Les traitements reposent, selon les cas, sur l’exécution du contrat (compte, commandes), le respect d’une obligation légale (facturation, comptabilité), notre intérêt légitime (sécurité, prévention de la fraude, vérification des partenaires) ou votre consentement lorsqu’il est requis.',
    'Processing relies, depending on the case, on performance of the contract (account, orders), compliance with a legal obligation (invoicing, accounting), our legitimate interest (security, fraud prevention, partner verification) or your consent where required.',
    'Los tratamientos se basan, según el caso, en la ejecución del contrato (cuenta, pedidos), el cumplimiento de una obligación legal (facturación, contabilidad), nuestro interés legítimo (seguridad, prevención del fraude, verificación de socios) o su consentimiento cuando se requiere.',
    'I trattamenti si basano, a seconda dei casi, sull’esecuzione del contratto (account, ordini), sull’adempimento di un obbligo legale (fatturazione, contabilità), sul nostro legittimo interesse (sicurezza, prevenzione frodi, verifica dei partner) o sul tuo consenso quando richiesto.',
    'تستند المعالجات، بحسب الحالة، إلى تنفيذ العقد (الحساب والطلبات)، أو الامتثال لالتزام قانوني (الفوترة والمحاسبة)، أو مصلحتنا المشروعة (الأمان ومنع الاحتيال والتحقق من الشركاء)، أو موافقتك عند الاقتضاء.',
  ],

  'confidentialite.recipientsTitle': ['Destinataires & sous-traitants', 'Recipients & subprocessors', 'Destinatarios y subencargados', 'Destinatari e responsabili esterni', 'المستلمون والمعالِجون من الباطن'],
  'confidentialite.recipientsIntro': [
    'Vos données sont accessibles à nos équipes habilitées et transmises aux sous-traitants suivants, strictement pour les finalités décrites :',
    'Your data is accessible to our authorised teams and shared with the following subprocessors, strictly for the purposes described:',
    'Sus datos son accesibles para nuestros equipos autorizados y se transmiten a los siguientes subencargados, estrictamente para las finalidades descritas:',
    'I tuoi dati sono accessibili ai nostri team autorizzati e trasmessi ai seguenti responsabili esterni, esclusivamente per le finalità descritte:',
    'تتاح بياناتك لفِرَقنا المُخوَّلة وتُنقَل إلى المعالِجين من الباطن التاليين، حصريًّا للأغراض الموضّحة:',
  ],
  'confidentialite.subPayment':  ['prestataire de paiement', 'payment processor', 'proveedor de pago', 'fornitore di pagamento', 'مزوّد الدفع'],
  'confidentialite.subLlm':      ['prestataire d’intelligence artificielle (vérification des candidatures)', 'artificial-intelligence provider (application checks)', 'proveedor de inteligencia artificial (verificación de solicitudes)', 'fornitore di intelligenza artificiale (verifica candidature)', 'مزوّد ذكاء اصطناعي (التحقق من الطلبات)'],
  'confidentialite.subRegistry': ['registre officiel des entreprises (vérification SIREN)', 'official business registry (SIREN check)', 'registro oficial de empresas (verificación SIREN)', 'registro ufficiale delle imprese (verifica SIREN)', 'السجل الرسمي للشركات (التحقق من SIREN)'],
  'confidentialite.subOauth':    ['fournisseurs d’identité, le cas échéant (Google, Apple)', 'identity providers, where applicable (Google, Apple)', 'proveedores de identidad, en su caso (Google, Apple)', 'provider d’identità, ove applicabile (Google, Apple)', 'موفّرو الهوية عند الاقتضاء (Google وApple)'],
  'confidentialite.subEmail':    ['prestataire d’envoi d’e-mails', 'email delivery provider', 'proveedor de envío de correos', 'fornitore di invio e-mail', 'مزوّد إرسال البريد الإلكتروني'],
  'confidentialite.subHosting':  ['hébergeur du site', 'site hosting provider', 'proveedor de alojamiento', 'fornitore di hosting', 'مستضيف الموقع'],

  'confidentialite.transferTitle': ['Transferts hors UE', 'Transfers outside the EU', 'Transferencias fuera de la UE', 'Trasferimenti fuori dall’UE', 'النقل خارج الاتحاد الأوروبي'],
  'confidentialite.transferBody': [
    'Certains sous-traitants peuvent traiter des données en dehors de l’Union européenne. Le cas échéant, ces transferts sont encadrés par des garanties appropriées (par exemple des clauses contractuelles types). Les modalités précises sont indiquées ci-dessous.',
    'Some subprocessors may process data outside the European Union. Where applicable, such transfers are governed by appropriate safeguards (for example standard contractual clauses). The precise terms are indicated below.',
    'Algunos subencargados pueden tratar datos fuera de la Unión Europea. En su caso, estas transferencias se rigen por garantías adecuadas (por ejemplo, cláusulas contractuales tipo). Las condiciones precisas se indican a continuación.',
    'Alcuni responsabili esterni possono trattare dati fuori dall’Unione europea. Ove applicabile, tali trasferimenti sono regolati da garanzie adeguate (ad esempio clausole contrattuali standard). Le modalità precise sono indicate di seguito.',
    'قد يعالج بعض المعالِجين من الباطن البيانات خارج الاتحاد الأوروبي. وعند الاقتضاء، تخضع هذه التحويلات لضمانات مناسبة (مثل الشروط التعاقدية النموذجية). وتَرِد التفاصيل الدقيقة أدناه.',
  ],

  'confidentialite.retentionTitle': ['Durées de conservation', 'Retention periods', 'Plazos de conservación', 'Periodi di conservazione', 'مدد الاحتفاظ'],
  'confidentialite.retentionBody': [
    'Vos données sont conservées le temps nécessaire aux finalités décrites, puis archivées ou supprimées selon les obligations légales applicables :',
    'Your data is kept for as long as necessary for the purposes described, then archived or deleted according to applicable legal obligations:',
    'Sus datos se conservan el tiempo necesario para las finalidades descritas y luego se archivan o suprimen según las obligaciones legales aplicables:',
    'I tuoi dati sono conservati per il tempo necessario alle finalità descritte, poi archiviati o eliminati secondo gli obblighi di legge applicabili:',
    'تُحفَظ بياناتك للمدة اللازمة للأغراض الموضّحة، ثم تُؤرشَف أو تُحذَف وفقًا للالتزامات القانونية السارية:',
  ],
  'confidentialite.retentionAccountLabel': ['Comptes', 'Accounts', 'Cuentas', 'Account', 'الحسابات'],
  'confidentialite.retentionOrdersLabel':  ['Commandes & factures', 'Orders & invoices', 'Pedidos y facturas', 'Ordini e fatture', 'الطلبات والفواتير'],

  'confidentialite.rightsTitle': ['Vos droits', 'Your rights', 'Sus derechos', 'I tuoi diritti', 'حقوقك'],
  'confidentialite.rightsBody': [
    'Vous disposez d’un droit d’accès, de rectification, d’effacement, de limitation, de portabilité et d’opposition sur vos données. Vous pouvez les exercer en contactant le responsable du traitement (voir ci-dessous).',
    'You have the right to access, rectify, erase, restrict, port and object to the processing of your data. You can exercise them by contacting the data controller (see below).',
    'Tiene derecho de acceso, rectificación, supresión, limitación, portabilidad y oposición sobre sus datos. Puede ejercerlos contactando con el responsable del tratamiento (ver abajo).',
    'Hai diritto di accesso, rettifica, cancellazione, limitazione, portabilità e opposizione sui tuoi dati. Puoi esercitarli contattando il titolare del trattamento (vedi sotto).',
    'يحق لك الوصول إلى بياناتك وتصحيحها ومحوها وتقييدها ونقلها والاعتراض على معالجتها. يمكنك ممارستها بالتواصل مع المسؤول عن المعالجة (انظر أدناه).',
  ],
  'confidentialite.cnilNote': [
    'Vous pouvez également introduire une réclamation auprès de la CNIL (autorité française de protection des données).',
    'You may also lodge a complaint with the CNIL (the French data-protection authority).',
    'También puede presentar una reclamación ante la CNIL (autoridad francesa de protección de datos).',
    'Puoi inoltre presentare un reclamo alla CNIL (l’autorità francese per la protezione dei dati).',
    'يمكنك أيضًا تقديم شكوى إلى CNIL (الهيئة الفرنسية لحماية البيانات).',
  ],

  'confidentialite.contactTitle': ['Contact / DPO', 'Contact / DPO', 'Contacto / DPO', 'Contatto / DPO', 'التواصل / مسؤول حماية البيانات'],
  'confidentialite.contactBody': [
    'Pour toute question ou pour exercer vos droits, contactez le responsable du traitement ou son délégué à la protection des données :',
    'For any question or to exercise your rights, contact the data controller or its data-protection officer:',
    'Para cualquier consulta o para ejercer sus derechos, contacte con el responsable del tratamiento o su delegado de protección de datos:',
    'Per qualsiasi domanda o per esercitare i tuoi diritti, contatta il titolare del trattamento o il suo responsabile della protezione dei dati:',
    'لأي استفسار أو لممارسة حقوقك، تواصل مع المسؤول عن المعالجة أو مسؤول حماية البيانات لديه:',
  ],

  'confidentialite.cookiesTitle': ['Cookies', 'Cookies', 'Cookies', 'Cookie', 'ملفات الارتباط'],
  'confidentialite.cookiesBody': [
    'Le site utilise des cookies strictement nécessaires à son fonctionnement. Le détail figure sur la page dédiée.',
    'The site uses cookies strictly necessary for its operation. Details are on the dedicated page.',
    'El sitio utiliza cookies estrictamente necesarias para su funcionamiento. El detalle está en la página dedicada.',
    'Il sito utilizza cookie strettamente necessari al suo funzionamento. Il dettaglio è nella pagina dedicata.',
    'يستخدم الموقع ملفات ارتباط ضرورية تمامًا لعمله. التفاصيل في الصفحة المخصّصة.',
  ],
  'confidentialite.cookiesLink': ['Voir la page Cookies', 'See the Cookies page', 'Ver la página de Cookies', 'Vai alla pagina Cookie', 'انظر صفحة ملفات الارتباط'],

  'confidentialite.securityTitle': ['Sécurité', 'Security', 'Seguridad', 'Sicurezza', 'الأمان'],
  'confidentialite.securityBody': [
    'Nous mettons en œuvre des mesures techniques et organisationnelles appropriées pour protéger vos données (mots de passe chiffrés, accès restreints, connexions sécurisées).',
    'We implement appropriate technical and organisational measures to protect your data (encrypted passwords, restricted access, secure connections).',
    'Aplicamos medidas técnicas y organizativas adecuadas para proteger sus datos (contraseñas cifradas, accesos restringidos, conexiones seguras).',
    'Adottiamo misure tecniche e organizzative adeguate per proteggere i tuoi dati (password cifrate, accessi limitati, connessioni sicure).',
    'نطبّق تدابير تقنية وتنظيمية مناسبة لحماية بياناتك (كلمات مرور مشفّرة، وصول مقيّد، اتصالات آمنة).',
  ],

  // ── Page Cookies ───────────────────────────────────────────────────────────
  'cookies.title': ['Cookies', 'Cookies', 'Cookies', 'Cookie', 'ملفات الارتباط'],
  'cookies.intro': [
    'Cette page liste les cookies réellement utilisés par Grubano. Nous n’utilisons à ce jour que des cookies strictement nécessaires au fonctionnement du site.',
    'This page lists the cookies actually used by Grubano. To date we use only cookies strictly necessary for the site to work.',
    'Esta página enumera las cookies realmente utilizadas por Grubano. A día de hoy solo usamos cookies estrictamente necesarias para el funcionamiento del sitio.',
    'Questa pagina elenca i cookie realmente utilizzati da Grubano. Ad oggi usiamo solo cookie strettamente necessari al funzionamento del sito.',
    'تسرد هذه الصفحة ملفات الارتباط التي يستخدمها Grubano فعليًّا. حتى الآن لا نستخدم سوى ملفات ضرورية تمامًا لعمل الموقع.',
  ],
  'cookies.noTrackingNote': [
    'Nous n’utilisons aucun cookie publicitaire ni de traçage tiers (pas de régie publicitaire, pas d’outil d’analyse externe).',
    'We use no advertising or third-party tracking cookies (no ad network, no external analytics tool).',
    'No utilizamos cookies publicitarias ni de rastreo de terceros (sin red publicitaria, sin herramienta de análisis externa).',
    'Non utilizziamo cookie pubblicitari né di tracciamento di terzi (nessun circuito pubblicitario, nessuno strumento di analisi esterno).',
    'لا نستخدم أي ملفات ارتباط إعلانية أو تتبُّع من جهات خارجية (لا شبكة إعلانات ولا أداة تحليلات خارجية).',
  ],
  'cookies.colName': ['Cookie', 'Cookie', 'Cookie', 'Cookie', 'الملف'],
  'cookies.colPurpose': ['Finalité', 'Purpose', 'Finalidad', 'Finalità', 'الغرض'],
  'cookies.colDuration': ['Durée', 'Duration', 'Duración', 'Durata', 'المدة'],
  'cookies.colCategory': ['Catégorie', 'Category', 'Categoría', 'Categoria', 'الفئة'],
  'cookies.catNecessary': ['Strictement nécessaire', 'Strictly necessary', 'Estrictamente necesaria', 'Strettamente necessario', 'ضروري تمامًا'],
  'cookies.durOneYear': ['1 an', '1 year', '1 año', '1 anno', 'سنة واحدة'],
  'cookies.durThirtyDays': ['30 jours', '30 days', '30 días', '30 giorni', '30 يومًا'],
  'cookies.durNinetyDays': ['90 jours', '90 days', '90 días', '90 giorni', '90 يومًا'],
  'cookies.purposeLocale': ['Mémorise la langue d’affichage choisie.', 'Remembers the chosen display language.', 'Recuerda el idioma de visualización elegido.', 'Memorizza la lingua di visualizzazione scelta.', 'يتذكّر لغة العرض المختارة.'],
  'cookies.purposeSession': ['Maintient votre session de connexion.', 'Keeps you signed in.', 'Mantiene su sesión de inicio de sesión.', 'Mantiene la tua sessione di accesso.', 'يُبقي جلسة دخولك نشطة.'],
  'cookies.purposeEstab': ['Mémorise l’établissement sélectionné dans le tableau de bord.', 'Remembers the selected establishment in the dashboard.', 'Recuerda el establecimiento seleccionado en el panel.', 'Memorizza lo stabilimento selezionato nella dashboard.', 'يتذكّر المنشأة المختارة في لوحة التحكم.'],
  'cookies.purposeRef': ['Attribue une visite au créateur qui vous a recommandé (parrainage).', 'Attributes a visit to the creator who referred you (referral).', 'Atribuye una visita al creador que le recomendó (referido).', 'Attribuisce una visita al creator che ti ha segnalato (referral).', 'يَنسُب الزيارة إلى المُبدِع الذي أحالك (الإحالة).'],
  'cookies.manageTitle': ['Gérer les cookies', 'Managing cookies', 'Gestionar las cookies', 'Gestire i cookie', 'إدارة ملفات الارتباط'],
  'cookies.manageBody': [
    'Les cookies strictement nécessaires ne peuvent pas être désactivés sans empêcher le site de fonctionner. Vous pouvez toutefois configurer votre navigateur pour les bloquer ou les supprimer.',
    'Strictly necessary cookies cannot be disabled without preventing the site from working. You can, however, configure your browser to block or delete them.',
    'Las cookies estrictamente necesarias no pueden desactivarse sin impedir el funcionamiento del sitio. No obstante, puede configurar su navegador para bloquearlas o eliminarlas.',
    'I cookie strettamente necessari non possono essere disattivati senza impedire il funzionamento del sito. Puoi comunque configurare il browser per bloccarli o eliminarli.',
    'لا يمكن تعطيل الملفات الضرورية تمامًا دون تعطيل عمل الموقع. ومع ذلك يمكنك ضبط متصفحك لحظرها أو حذفها.',
  ],
}

// business.auth.consentText — make the privacy mention a rich-text <privacy> link.
const CONSENT = [
  'J’accepte la <privacy>politique de confidentialité</privacy> et le traitement de mes données pour la création de mon compte partenaire.',
  'I accept the <privacy>privacy policy</privacy> and the processing of my data to create my partner account.',
  'Acepto la <privacy>política de privacidad</privacy> y el tratamiento de mis datos para crear mi cuenta de socio.',
  'Accetto l’<privacy>informativa sulla privacy</privacy> e il trattamento dei miei dati per creare il mio account partner.',
  'أوافق على <privacy>سياسة الخصوصية</privacy> وعلى معالجة بياناتي لإنشاء حساب الشريك الخاص بي.',
]

LOCALES.forEach((loc, i) => {
  const file = path.join(__dirname, '..', 'messages', `${loc}.json`)
  const json = JSON.parse(fs.readFileSync(file, 'utf8'))
  json.legal = json.legal || {}
  for (const dotKey of Object.keys(L)) {
    const parts = dotKey.split('.')
    let node = json.legal
    for (let p = 0; p < parts.length - 1; p++) {
      node[parts[p]] = node[parts[p]] || {}
      node = node[parts[p]]
    }
    node[parts[parts.length - 1]] = L[dotKey][i]
  }
  // consent rich-text mention → privacy link
  json.business = json.business || {}
  json.business.auth = json.business.auth || {}
  json.business.auth.consentText = CONSENT[i]

  fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n', 'utf8')
  console.log(`  ✓ ${loc}.json — legal.* (+${Object.keys(L).length}) + business.auth.consentText`)
})
console.log('[add-legal-privacy-cookies-i18n] done.')
