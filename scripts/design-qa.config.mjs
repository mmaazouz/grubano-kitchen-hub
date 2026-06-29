/**
 * design-qa.config.mjs — screens the visual-QA robot diffs.
 *
 * Each screen: { name, url (path on the local Next), reference (CD mock HTML file, relative to
 * the repo root), settle?, viewports?, states? }.
 * A state can set:
 *   - query    : appended to the real URL (for URL-addressable states)
 *   - theme    : value set on <html data-theme> before the shot (for the REF mock; the real
 *                /eat/auth decouples its colours per screen so this is harmless there)
 *   - action   : a JS expression run in the REAL page to reach a React-state (e.g. click a link)
 *   - refClass : a class added to the REF mock's root to reach that state (e.g. 'is-signup')
 *
 * Add a screen + a reference HTML under scripts/design-qa-refs/ to extend coverage.
 */
export const screens = [
  {
    name: 'eat-auth',
    url: '/fr/eat/auth',
    reference: 'scripts/design-qa-refs/eat-auth.html',
    settle: 650,
    viewports: [
      { name: 'mobile', w: 390, h: 844 },
      { name: 'desktop', w: 1280, h: 820 },
    ],
    states: [
      // CONNEXION — the real app is ALWAYS light here (fixed-per-screen colours).
      { name: 'signin', theme: 'light' },
      // INSCRIPTION — real app is ALWAYS dark. Real page: click the "S'inscrire" link to flip
      // the React tab. Ref mock follows data-theme, so force dark + add `is-signup`.
      {
        name: 'signup',
        theme: 'dark',
        refClass: 'is-signup',
        action: `(() => { const a=[...document.querySelectorAll('.auth__sub a')].find(x=>/inscrire|create/i.test(x.textContent||'')); if(a) a.click(); })()`,
      },
    ],
  },
  {
    name: 'eat-magic-sent',
    url: '/fr/eat/magic',
    reference: 'scripts/design-qa-refs/eat-magic-sent.html',
    settle: 700,
    states: [
      {
        name: 'sent',
        // Seed the email /eat/auth hands over so the page shows "Check your email" (it otherwise
        // redirects back to /eat/auth). The page fires the real magic-link API on mount
        // (anti-enumeration → generic), which is harmless for a non-existent demo address.
        before: `(function(){try{sessionStorage.setItem('gb_magic_email','sofia@email.com')}catch(e){}})()`,
      },
    ],
  },
  {
    name: 'eat-magic-verifying',
    url: '/fr/eat/magic',
    reference: 'scripts/design-qa-refs/eat-magic-verifying.html',
    settle: 700,
    states: [
      {
        name: 'verifying',
        query: '?token=demo-magic-token-for-qa',
        // Hang every /api/auth/* call so signIn never resolves → the "Signing you in…" spinner
        // stays on screen to be captured. waitUntil drops to domcontentloaded (networkidle never
        // fires while a request is intentionally pending).
        waitUntil: 'domcontentloaded',
        before: `(function(){var of=window.fetch;window.fetch=function(u,o){if(String(u).indexOf('/api/auth/')>-1){return new Promise(function(){})}return of.call(this,u,o)}})()`,
      },
    ],
  },
  {
    name: 'eat-rewards',
    url: '/fr/eat/rewards',
    reference: 'scripts/design-qa-refs/eat-rewards.html',
    settle: 800,
    // /eat/rewards renders INSIDE EatShell (nav rail + bottom-nav); the CD mock is content-only,
    // so we CLIP both to the content zone (app `.gb-rewards` ↔ ref `main`) for a fair compare.
    viewports: [
      { name: 'mobile', w: 390, h: 1000 },
      { name: 'desktop', w: 1440, h: 1150 },
    ],
    states: [
      {
        name: 'default',
        theme: 'light',
        clip: '.gb-rewards',
        refClip: 'main',
        // Stub the SESSION (the wallet needs auth) + the WALLET (250 pts → Gold/Or tier; the real
        // euro-credit scale). DISPLAY-ONLY data — the real loyalty engine is never called.
        before: `(function(){var of=window.fetch;window.fetch=function(u,o){var s=String(u);` +
          `if(s.indexOf('/api/auth/session')>-1){return Promise.resolve(new Response(JSON.stringify({user:{email:'sofia@email.com',name:'Sofia',role:'consumer'},expires:'2099-01-01T00:00:00.000Z'}),{headers:{'content-type':'application/json'}}))}` +
          `if(s.indexOf('/api/loyalty/wallet')>-1){return Promise.resolve(new Response(JSON.stringify({pointsBalance:250,balanceEuros:12.5,creditScale:[{points:100,euros:5},{points:200,euros:10},{points:400,euros:20}]}),{headers:{'content-type':'application/json'}}))}` +
          `return of.call(this,u,o)}})()`,
      },
    ],
  },

  // ── 6 sample restaurants for the search / favorites screens. Real field names from
  //    the /api/restaurants response shape (id,name,cuisine[],rating,reviewCount,
  //    deliveryTime,deliveryFee,minOrder,city,address,distanceKm). DISPLAY-ONLY data —
  //    no DB is reachable locally, so the page's real fetch is stubbed with these.
  //    Re-declared inline in each `before` (the seed runs in page context, no imports).

  {
    name: 'eat-search-mobile',
    url: '/fr/eat/search',
    reference: 'scripts/design-qa-refs/eat-search-mobile.html',
    settle: 800,
    // MOBILE typeahead screen only (the page swaps .se-mobile/.se-desktop at 900px CSS).
    viewports: [{ name: 'mobile', w: 390, h: 1200 }],
    states: [
      {
        name: 'idle',
        theme: 'light',
        clip: '.gb-search',
        refClip: '.search-screen',
        // Stub /api/restaurants* (6 real-shaped restos) + seed 3 recents so the idle
        // view (recents + popular chips) renders exactly like the CD repos state. With
        // an empty query the page is in IDLE (no fetch results shown), matching the ref.
        before:
          `(function(){` +
          `try{localStorage.setItem('grubano_search_recents',JSON.stringify(['Sushi','Pizza margherita','Mama Trattoria']))}catch(e){}` +
          `var R=[` +
          `{id:'r1',name:'Mama Trattoria',cuisine:['italian'],rating:4.8,reviewCount:248,deliveryTime:25,minOrder:15,deliveryFee:0,city:'Paris',address:'12 Rue de Rivoli',distanceKm:1.2},` +
          `{id:'r2',name:'Casa Caldo',cuisine:['italian'],rating:4.8,reviewCount:120,deliveryTime:35,minOrder:18,deliveryFee:2.5,city:'Paris',address:'8 Bd Haussmann',distanceKm:2.4},` +
          `{id:'r3',name:'Olive & Thyme',cuisine:['mediterranean'],rating:4.7,reviewCount:90,deliveryTime:20,minOrder:12,deliveryFee:0,city:'Paris',address:'5 Rue Cler',distanceKm:1.0},` +
          `{id:'r4',name:'La Mamma Verde',cuisine:['healthy'],rating:4.6,reviewCount:60,deliveryTime:30,minOrder:14,deliveryFee:0,city:'Paris',address:'3 Rue Oberkampf',distanceKm:0.9},` +
          `{id:'r5',name:'Sakura Sushi',cuisine:['japanese'],rating:4.9,reviewCount:210,deliveryTime:30,minOrder:20,deliveryFee:3,city:'Paris',address:'19 Rue Saint-Denis',distanceKm:2.0},` +
          `{id:'r6',name:'Verde Bowl',cuisine:['healthy'],rating:4.7,reviewCount:75,deliveryTime:23,minOrder:10,deliveryFee:0,city:'Paris',address:'2 Rue Lafayette',distanceKm:0.8}` +
          `];` +
          `var of=window.fetch;window.fetch=function(u,o){var s=String(u);` +
          `if(s.indexOf('/api/restaurants')>-1){return Promise.resolve(new Response(JSON.stringify({restaurants:R}),{headers:{'content-type':'application/json'}}))}` +
          `return of.call(this,u,o)}})()`,
      },
    ],
  },

  {
    name: 'eat-search-desktop',
    url: '/fr/eat/search',
    reference: 'scripts/design-qa-refs/eat-search-desktop.html',
    settle: 800,
    // DESKTOP subbar + 2-col grid + INERT map panel. The page renders inside EatShell
    // (rail + topbar) — the CD ref draws its OWN rail+header, so we CLIP the app to the
    // page content (.gb-search) and the ref to its .main column (rail excluded on both).
    viewports: [{ name: 'desktop', w: 1280, h: 1000 }],
    states: [
      {
        name: 'default',
        theme: 'light',
        clip: '.gb-search',
        refClip: '.main',
        before:
          `(function(){` +
          `var R=[` +
          `{id:'r1',name:'Mama Trattoria',cuisine:['italian'],rating:4.8,reviewCount:248,deliveryTime:25,minOrder:15,deliveryFee:0,city:'Paris',address:'12 Rue de Rivoli',distanceKm:1.2},` +
          `{id:'r2',name:'Casa Caldo',cuisine:['italian'],rating:4.8,reviewCount:120,deliveryTime:35,minOrder:18,deliveryFee:2.5,city:'Paris',address:'8 Bd Haussmann',distanceKm:2.4},` +
          `{id:'r3',name:'Olive & Thyme',cuisine:['mediterranean'],rating:4.7,reviewCount:90,deliveryTime:20,minOrder:12,deliveryFee:0,city:'Paris',address:'5 Rue Cler',distanceKm:1.0},` +
          `{id:'r4',name:'La Mamma Verde',cuisine:['healthy'],rating:4.6,reviewCount:60,deliveryTime:30,minOrder:14,deliveryFee:0,city:'Paris',address:'3 Rue Oberkampf',distanceKm:0.9},` +
          `{id:'r5',name:'Sakura Sushi',cuisine:['japanese'],rating:4.9,reviewCount:210,deliveryTime:30,minOrder:20,deliveryFee:3,city:'Paris',address:'19 Rue Saint-Denis',distanceKm:2.0},` +
          `{id:'r6',name:'Verde Bowl',cuisine:['healthy'],rating:4.7,reviewCount:75,deliveryTime:23,minOrder:10,deliveryFee:0,city:'Paris',address:'2 Rue Lafayette',distanceKm:0.8}` +
          `];` +
          `var of=window.fetch;window.fetch=function(u,o){var s=String(u);` +
          `if(s.indexOf('/api/restaurants')>-1){return Promise.resolve(new Response(JSON.stringify({restaurants:R}),{headers:{'content-type':'application/json'}}))}` +
          `return of.call(this,u,o)}})()`,
      },
    ],
  },

  {
    name: 'eat-reviews',
    url: '/fr/eat/r/demo/reviews',
    reference: 'scripts/design-qa-refs/eat-reviews.html',
    settle: 800,
    viewports: [
      { name: 'mobile', w: 390, h: 1100 },
      { name: 'desktop', w: 1280, h: 1100 },
    ],
    states: [
      {
        name: 'default',
        theme: 'light',
        clip: '.gb-reviews',
        refClip: '.reviews',
        // Stub /api/restaurants/demo → real score (4.8) + reviewCount (214). The
        // distribution + review list have NO backend (no consumer Review model) → the
        // page shows honest empty states; the CD list is sample data (residual diff).
        before:
          `(function(){var of=window.fetch;window.fetch=function(u,o){var s=String(u);` +
          `if(s.indexOf('/api/restaurants/')>-1){return Promise.resolve(new Response(JSON.stringify({restaurant:{id:'demo',name:'Mama Trattoria',cuisine:['italian'],rating:4.8,reviewCount:214}}),{headers:{'content-type':'application/json'}}))}` +
          `return of.call(this,u,o)}})()`,
      },
    ],
  },

  {
    name: 'eat-favorites',
    url: '/fr/eat/favorites',
    reference: 'scripts/design-qa-refs/eat-favorites.html',
    settle: 800,
    viewports: [
      { name: 'mobile', w: 390, h: 1100 },
      { name: 'desktop', w: 1280, h: 1100 },
    ],
    states: [
      {
        name: 'default',
        theme: 'light',
        clip: '.gb-favorites',
        refClip: '.fav',
        // Seed the REAL favourites key (lib/eat-cart FAV_KEY = grubano_favs) with 3 ids,
        // then stub /api/restaurants* so those 3 resolve → the Restaurants tab shows 3
        // saved cards (CD shows 5; residual diff). The Plats tab has no store → empty.
        before:
          `(function(){` +
          `try{localStorage.setItem('grubano_favs',JSON.stringify(['r1','r3','r5']))}catch(e){}` +
          `var R=[` +
          `{id:'r1',name:'Mama Trattoria',cuisine:['italian'],rating:4.8,reviewCount:248,deliveryTime:25,deliveryFee:0,city:'Paris',distanceKm:1.2},` +
          `{id:'r3',name:'Olive & Thyme',cuisine:['mediterranean'],rating:4.7,reviewCount:90,deliveryTime:20,deliveryFee:0,city:'Paris',distanceKm:1.0},` +
          `{id:'r5',name:'Sakura Sushi',cuisine:['japanese'],rating:4.9,reviewCount:210,deliveryTime:30,deliveryFee:3,city:'Paris',distanceKm:2.0}` +
          `];` +
          `var of=window.fetch;window.fetch=function(u,o){var s=String(u);` +
          `if(s.indexOf('/api/restaurants')>-1){return Promise.resolve(new Response(JSON.stringify({restaurants:R}),{headers:{'content-type':'application/json'}}))}` +
          `return of.call(this,u,o)}})()`,
      },
    ],
  },

  {
    name: 'eat-geoloc',
    url: '/fr/eat',
    reference: 'scripts/design-qa-refs/eat-geoloc.html',
    settle: 900,
    // Desktop only — the overlay opens from the shell `.loc` topbar button (desktop).
    viewports: [{ name: 'desktop', w: 1280, h: 900 }],
    states: [
      {
        name: 'perm',
        theme: 'light',
        clip: '.geo-sheet',
        refClip: '.sheet',
        // Seed 2 saved addresses (lib/eat-addresses key grubano_addresses) so the
        // search step's « Récents » have real data. The overlay opens on the PERMISSION
        // step. Headless Chrome has NO geolocation grant → data-geo="off"; we flip the
        // CD ref to data-geo="off" too (refAction) so the status banner aligns.
        before:
          `(function(){try{` +
          // Skip the once-per-session splash (home redirects to /eat/splash on first
          // visit when this flag is absent → would never reach the .loc button).
          `sessionStorage.setItem('grubano_splash_seen','1');` +
          `localStorage.setItem('grubano_addresses',JSON.stringify([` +
          `{id:'a1',label:'Domicile',kind:'home',street:'14 Rue des Oliviers',postalCode:'75011',city:'Paris',country:'France',isDefault:true},` +
          `{id:'a2',label:'Travail',kind:'work',street:'8 Bd Haussmann',postalCode:'75009',city:'Paris',country:'France',isDefault:false}` +
          `]))}catch(e){}})()`,
        // Open the « Livrer à » overlay (desktop topbar .loc button → setGeoOpen(true)).
        action: `document.querySelector('.loc') && document.querySelector('.loc').click()`,
        // Match the app's headless OFF geo-state on the ref.
        refAction: `(function(){var a=document.getElementById('app');if(a)a.dataset.geo='off'})()`,
      },
    ],
  },

  // ════════════════════════════════════════════════════════════════════════════
  // LOT 2 — 8 new/re-skinned consumer screens (CD refs 29/06). Each clips the app's
  // `.gb-*` content root ↔ the CD ref's content wrapper. DB is unreachable locally,
  // so every screen stubs its data via the `before` seed (fetch stub + storage seed).
  // Re-declared inline in each seed (runs in page context, no imports).
  // ════════════════════════════════════════════════════════════════════════════

  {
    name: 'eat-home',
    url: '/fr/eat',
    reference: 'scripts/design-qa-refs/eat-home.html',
    settle: 850,
    // Top-level tab (rail + topbar). The CD mock is content-only → clip app `.gb-home`
    // ↔ ref `.home` (the shell rail/topbar excluded on the app side; the ref draws none).
    viewports: [
      { name: 'mobile', w: 390, h: 1200 },
      { name: 'desktop', w: 1280, h: 1000 },
    ],
    states: [
      {
        name: 'default',
        theme: 'light',
        clip: '.gb-home',
        refClip: '.home',
        // Seed the splash flag (home client-redirects to /eat/splash on first visit unless
        // sessionStorage grubano_splash_seen==='1'). Stub /api/restaurants (6 real-shaped
        // restos → "Populaires"), /api/eat/orders (2 current → "Recommander" reorder row),
        // /api/eat/promos (→ the Sunrise promo banner). DISPLAY-ONLY data.
        before:
          `(function(){` +
          `try{sessionStorage.setItem('grubano_splash_seen','1');localStorage.setItem('grubano_favs',JSON.stringify(['r1','r5']))}catch(e){}` +
          `var R=[` +
          `{id:'r1',name:'Mama Trattoria',cuisine:['italian'],rating:4.8,reviewCount:248,deliveryTime:25,minOrder:15,deliveryFee:0,city:'Paris',address:'12 Rue de Rivoli',distanceKm:1.2},` +
          `{id:'r2',name:'Casa Caldo',cuisine:['italian'],rating:4.8,reviewCount:120,deliveryTime:35,minOrder:18,deliveryFee:2.5,city:'Paris',address:'8 Bd Haussmann',distanceKm:2.4},` +
          `{id:'r3',name:'Olive & Thyme',cuisine:['mediterranean'],rating:4.7,reviewCount:90,deliveryTime:20,minOrder:12,deliveryFee:0,city:'Paris',address:'5 Rue Cler',distanceKm:1.0},` +
          `{id:'r4',name:'Verde Bowl',cuisine:['healthy'],rating:4.7,reviewCount:75,deliveryTime:23,minOrder:10,deliveryFee:0,city:'Paris',address:'2 Rue Lafayette',distanceKm:0.8},` +
          `{id:'r5',name:'Sakura Sushi',cuisine:['japanese'],rating:4.9,reviewCount:210,deliveryTime:30,minOrder:20,deliveryFee:3,city:'Paris',address:'19 Rue Saint-Denis',distanceKm:2.0},` +
          `{id:'r6',name:'El Fuego',cuisine:['mexican'],rating:4.6,reviewCount:88,deliveryTime:25,minOrder:14,deliveryFee:0,city:'Paris',address:'7 Rue Oberkampf',distanceKm:1.6}` +
          `];` +
          `var of=window.fetch;window.fetch=function(u,o){var s=String(u);` +
          `if(s.indexOf('/api/restaurants')>-1){return Promise.resolve(new Response(JSON.stringify({restaurants:R}),{headers:{'content-type':'application/json'}}))}` +
          `if(s.indexOf('/api/eat/orders')>-1){return Promise.resolve(new Response(JSON.stringify({current:[{id:'o1',restaurantId:'r1',restaurantName:'Mama Trattoria',itemsCount:2,total:34.34},{id:'o2',restaurantId:'r5',restaurantName:'Sakura Sushi',itemsCount:4,total:41.0}],past:[]}),{headers:{'content-type':'application/json'}}))}` +
          `if(s.indexOf('/api/eat/promos')>-1){return Promise.resolve(new Response(JSON.stringify({totalPromos:3,maxPercent:20,bestFixed:5}),{headers:{'content-type':'application/json'}}))}` +
          `return of.call(this,u,o)}})()`,
      },
    ],
  },

  {
    name: 'eat-account',
    url: '/fr/eat/account',
    reference: 'scripts/design-qa-refs/eat-account.html',
    settle: 850,
    // Top-level tab. clip app `.gb-account` ↔ ref `.prof`. The page gates on an
    // authenticated session → stub /api/auth/session (consumer) so it renders the profile.
    viewports: [
      { name: 'mobile', w: 390, h: 1200 },
      { name: 'desktop', w: 1280, h: 1100 },
    ],
    states: [
      {
        name: 'default',
        theme: 'light',
        clip: '.gb-account',
        refClip: '.prof',
        // Stub SESSION (consumer Sofia) + WALLET (points) + ORDERS (delivered count for the
        // "Avis"/stats). Seed favourites (grubano_favs) so the Favoris count is real. The CD
        // sample (Gold · 1 240 pts · 42 cmd) is placeholder → real counters differ (residual).
        before:
          `(function(){` +
          `try{localStorage.setItem('grubano_favs',JSON.stringify(['r1','r3','r5']))}catch(e){}` +
          `var of=window.fetch;window.fetch=function(u,o){var s=String(u);` +
          `if(s.indexOf('/api/auth/session')>-1){return Promise.resolve(new Response(JSON.stringify({user:{email:'sofia@email.com',name:'Sofia Marchetti',role:'consumer'},expires:'2099-01-01T00:00:00.000Z'}),{headers:{'content-type':'application/json'}}))}` +
          `if(s.indexOf('/api/loyalty/wallet')>-1){return Promise.resolve(new Response(JSON.stringify({pointsBalance:1240,centsPerPoint:5,tier:'gold'}),{headers:{'content-type':'application/json'}}))}` +
          `if(s.indexOf('/api/orders')>-1){return Promise.resolve(new Response(JSON.stringify({orders:[{id:'o1',status:'delivered'},{id:'o2',status:'delivered'},{id:'o3',status:'preparing'}]}),{headers:{'content-type':'application/json'}}))}` +
          `return of.call(this,u,o)}})()`,
      },
    ],
  },

  {
    name: 'eat-track',
    url: '/fr/eat/track/demo',
    reference: 'scripts/design-qa-refs/eat-track.html',
    settle: 850,
    // Immersive (is-bare) — the page renders content-only (its own back affordance).
    // clip app `.gb-track` ↔ ref `.track` (full 2-col map+panel grid).
    viewports: [
      { name: 'mobile', w: 390, h: 1200 },
      { name: 'desktop', w: 1280, h: 1000 },
    ],
    states: [
      {
        name: 'default',
        theme: 'light',
        clip: '.gb-track',
        refClip: '.track',
        // Stub GET /api/orders/demo → data.order with status 'preparing' (CD shows the
        // "en route" step; real status drives the stepper → residual diff), real items +
        // total + fulfillmentType:'delivery'. 401 would bounce to /eat/auth — we 200.
        before:
          `(function(){var of=window.fetch;window.fetch=function(u,o){var s=String(u);` +
          `if(s.indexOf('/api/orders/')>-1){return Promise.resolve(new Response(JSON.stringify({order:{id:'GR2841DEMO',status:'preparing',fulfillmentType:'delivery',subtotal:33.0,deliveryFee:4.49,total:37.49,estimatedTime:34,createdAt:'2026-06-29T19:08:00.000Z',pointsEarned:0,deliveryAddress:'14 Rue des Oliviers, 75011 Paris',restaurant:{name:'Mama Trattoria',address:'12 Rue de Rivoli, 75001 Paris',city:'Paris'},items:[{name:'Tagliatelles à la truffe',qty:1,price:18.0},{name:'Cacio e pepe',qty:1,price:15.0}]}}),{headers:{'content-type':'application/json'}}))}` +
          `return of.call(this,u,o)}})()`,
      },
    ],
  },

  {
    name: 'eat-errors',
    url: '/fr/eat/zzz-not-a-page',
    reference: 'scripts/design-qa-refs/eat-errors.html',
    settle: 700,
    // 404 NOT-FOUND boundary (a non-existent /eat URL triggers app/[locale]/eat/not-found.tsx
    // → <EatStateScreen variant="notfound" />, root `.gb-errstate` data-err="404"). The ref
    // shows all 3 variants but CSS hides non-404 → clip the ref to the visible `.e-404` column.
    viewports: [
      { name: 'mobile', w: 390, h: 1000 },
      { name: 'desktop', w: 1280, h: 900 },
    ],
    states: [
      {
        name: 'notfound',
        theme: 'light',
        waitUntil: 'domcontentloaded',
        clip: '.gb-errstate',
        refClip: '.e-404',
      },
    ],
  },

  {
    name: 'eat-cart',
    url: '/fr/eat/cart',
    reference: 'scripts/design-qa-refs/eat-cart.html',
    settle: 850,
    // Immersive (is-bare) — content only. clip app `.gb-cart` ↔ ref `.cart` (the filled
    // 2-col layout; the ref's data-state="filled" shows the populated cart, empty hidden).
    viewports: [
      { name: 'mobile', w: 390, h: 1200 },
      { name: 'desktop', w: 1280, h: 1000 },
    ],
    states: [
      {
        name: 'filled',
        theme: 'light',
        clip: '.gb-cart',
        refClip: '.cart',
        // Seed the REAL cart store (lib/eat-cart KEY 'grubano_cart' in sessionStorage) with
        // 3 real-shaped lines (EatCartData shape) so the cart is populated; seed addresses
        // (lib/eat-addresses 'grubano_addresses'). Stub /api/restaurants/<id> (promos/menu
        // display-only). REAL totals are recomputed from these lines → match the CD layout;
        // the CD placeholder amounts (49,00/43,69) differ from real subtotal (residual diff).
        before:
          `(function(){try{` +
          `sessionStorage.setItem('grubano_cart',JSON.stringify({restaurantId:'demo',restaurant:{name:'Mama Trattoria',deliveryFee:2.99,minOrder:15,address:'12 Rue de Rivoli',city:'Paris',deliveryTime:25},items:[` +
          `{item:{id:'d1',name:'Tagliatelles à la truffe',price:18.0,photos:[]},qty:1,options:{size:'Grande',supplements:[{name:'Parmesan',price:0}],exclusions:['Sans noix']}},` +
          `{item:{id:'d2',name:'Cacio e pepe',price:15.0,photos:[]},qty:1,options:{note:'bien poivré'}},` +
          `{item:{id:'d3',name:'Tiramisu maison',price:8.0,photos:[]},qty:2,options:{}}` +
          `]}));` +
          `localStorage.setItem('grubano_addresses',JSON.stringify([` +
          `{id:'a1',label:'Domicile',kind:'home',street:'14 Rue des Oliviers',postalCode:'75011',city:'Paris',country:'France',isDefault:true},` +
          `{id:'a2',label:'Travail',kind:'work',street:'8 Bd Haussmann',postalCode:'75009',city:'Paris',country:'France',isDefault:false}` +
          `]))}catch(e){}` +
          `var of=window.fetch;window.fetch=function(u,o){var s=String(u);` +
          `if(s.indexOf('/api/restaurants/')>-1){return Promise.resolve(new Response(JSON.stringify({promotions:[],menu:[],smallOrder:null}),{headers:{'content-type':'application/json'}}))}` +
          `if(s.indexOf('/api/referral/preview')>-1){return Promise.resolve(new Response(JSON.stringify({eligible:false,discountPct:0,discountCap:0}),{headers:{'content-type':'application/json'}}))}` +
          `if(s.indexOf('/api/auth/session')>-1){return Promise.resolve(new Response(JSON.stringify({}),{headers:{'content-type':'application/json'}}))}` +
          `return of.call(this,u,o)}})()`,
      },
    ],
  },

  {
    name: 'eat-checkout',
    url: '/fr/eat/checkout/demo',
    reference: 'scripts/design-qa-refs/eat-checkout.html',
    settle: 850,
    // Immersive (is-bare) — content only. clip app `.gb-checkout` ↔ ref `.co`.
    viewports: [
      { name: 'mobile', w: 390, h: 1200 },
      { name: 'desktop', w: 1280, h: 1100 },
    ],
    states: [
      {
        name: 'review',
        theme: 'light',
        clip: '.gb-checkout',
        refClip: '.co',
        // Stub GET /api/orders/demo → data.order in the REVIEW stage (paymentStatus !== 'paid')
        // with real items/subtotal/fees/total so the pay screen renders. Stub session (the page
        // bounces to /eat/auth on 401). Seed addresses for the delivery selector. The CD pourboire
        // 15 %/7,35 € + Visa •4242 are placeholders (no saved-cards backend) → residual diff.
        before:
          `(function(){try{localStorage.setItem('grubano_addresses',JSON.stringify([` +
          `{id:'a1',label:'Domicile',kind:'home',street:'14 Rue des Oliviers',complement:'Apt 3',postalCode:'75011',city:'Paris',country:'France',isDefault:true},` +
          `{id:'a2',label:'Travail',kind:'work',street:'8 Bd Haussmann',postalCode:'75009',city:'Paris',country:'France',isDefault:false}` +
          `]))}catch(e){}` +
          `var of=window.fetch;window.fetch=function(u,o){var s=String(u);` +
          `if(s.indexOf('/api/auth/session')>-1){return Promise.resolve(new Response(JSON.stringify({user:{email:'sofia@email.com',name:'Sofia Marchetti',role:'consumer'},expires:'2099-01-01T00:00:00.000Z'}),{headers:{'content-type':'application/json'}}))}` +
          `if(s.indexOf('/api/orders/')>-1){return Promise.resolve(new Response(JSON.stringify({order:{id:'demo',status:'awaiting_payment',fulfillmentType:'delivery',paymentStatus:null,subtotal:49.0,deliveryFee:2.99,total:43.69,discount:9.8,promotion:{id:'p1',name:'Tuesday Treat'},restaurant:{id:'demo',name:'Mama Trattoria'},items:[{itemId:'d1',name:'Tagliatelles à la truffe',qty:1,price:18.0},{itemId:'d2',name:'Cacio e pepe',qty:1,price:15.0},{itemId:'d3',name:'Tiramisu maison',qty:2,price:8.0}]}}),{headers:{'content-type':'application/json'}}))}` +
          `return of.call(this,u,o)}})()`,
      },
    ],
  },

  {
    name: 'eat-resto',
    url: '/fr/eat/r/demo',
    reference: 'scripts/design-qa-refs/eat-resto.html',
    settle: 850,
    // Immersive (is-bare) — content only (hero + headcard + menu + sticky cart panel).
    // clip app `.gb-resto` ↔ ref `.r`.
    viewports: [
      { name: 'mobile', w: 390, h: 1200 },
      { name: 'desktop', w: 1280, h: 1100 },
    ],
    states: [
      {
        name: 'default',
        theme: 'light',
        clip: '.gb-resto',
        refClip: '.r',
        // Stub GET /api/restaurants/demo → {restaurant, hours(open), menu:categories[].items[],
        // promotions:[], itemPromo:{}}. Seed favs so the heart is filled. The desktop cart panel
        // is empty unless grubano_cart matches this resto → seed a 2-line cart for the panel.
        before:
          `(function(){try{` +
          `localStorage.setItem('grubano_favs',JSON.stringify(['demo']));` +
          `sessionStorage.setItem('grubano_cart',JSON.stringify({restaurantId:'demo',restaurant:{name:'Mama Trattoria',deliveryFee:0,minOrder:15},items:[` +
          `{item:{id:'d1',name:'Tagliatelles à la truffe',price:18.0,photos:[]},qty:1,options:{}},` +
          `{item:{id:'d2',name:'Cacio e pepe',price:15.0,photos:[]},qty:1,options:{}}` +
          `]}))}catch(e){}` +
          `var of=window.fetch;window.fetch=function(u,o){var s=String(u);` +
          `if(s.indexOf('/api/restaurants/')>-1){return Promise.resolve(new Response(JSON.stringify({` +
          `restaurant:{id:'demo',name:'Mama Trattoria',description:'Trattoria italienne',cuisine:['italian'],rating:4.8,reviewCount:248,deliveryTime:25,minOrder:25,deliveryFee:0,city:'Paris',address:'12 Rue de Rivoli'},` +
          `hours:{hoursConfigured:true,isOpenNow:true,weeklyHours:[],nextOpening:null,currentClosure:null},` +
          `menu:[` +
          `{category:'Populaires',items:[` +
          `{id:'d1',name:'Tagliatelles à la truffe',description:'Pâtes fraîches aux œufs, truffe noire, crème de parmesan.',price:18.0,category:'Populaires',photos:[],isPopular:true},` +
          `{id:'d2',name:'Cacio e pepe',description:'Tonnarelli, pecorino romano, poivre concassé.',price:15.0,category:'Populaires',photos:[],isPopular:true},` +
          `{id:'d3',name:'Margherita DOP',description:'San Marzano, fior di latte, basilic frais.',price:14.0,category:'Populaires',photos:[],isPopular:true},` +
          `{id:'d4',name:'Tiramisu maison',description:'Mascarpone, café, cacao, biscuits savoiardi.',price:8.0,category:'Populaires',photos:[],isPopular:true}` +
          `]},` +
          `{category:'Pâtes',items:[` +
          `{id:'d5',name:'Lasagne della Nonna',description:'Ragù mijoté, béchamel, parmesan 24 mois.',price:19.0,category:'Pâtes',photos:[],isPopular:false},` +
          `{id:'d6',name:'Gnocchi Sorrentina',description:'Gnocchi de pomme de terre, tomate, basilic, mozzarella.',price:16.0,category:'Pâtes',photos:[],isPopular:false}` +
          `]}],` +
          `promotions:[],itemPromo:{}}),{headers:{'content-type':'application/json'}}))}` +
          `return of.call(this,u,o)}})()`,
      },
    ],
  },

  {
    name: 'eat-reserver',
    url: '/fr/eat/r/demo/reserver',
    reference: 'scripts/design-qa-refs/eat-reserver.html',
    settle: 850,
    // Immersive (is-bare) — content only. Default mode = 'reserve'. clip app `.gb-reserver`
    // ↔ ref `.pg`. The app's reserve form has REAL contact fields (name/email/phone) the CD
    // mock lacks → residual diff. Date strip = real 14 days from today (CD shows 25–29 juin).
    viewports: [
      { name: 'mobile', w: 390, h: 1200 },
      { name: 'desktop', w: 1280, h: 1100 },
    ],
    states: [
      {
        name: 'reserve',
        theme: 'light',
        clip: '.gb-reserver',
        refClip: '.pg',
        // Stub GET /api/reservations/availability?... → real-shaped slots so the "Heure" row
        // populates (the page fetches on date change in reserve mode). No redirect guard here.
        before:
          `(function(){var of=window.fetch;window.fetch=function(u,o){var s=String(u);` +
          `if(s.indexOf('/api/reservations/availability')>-1){return Promise.resolve(new Response(JSON.stringify({restaurantId:'demo',date:'2026-06-29',durationMin:90,totalTables:8,slots:[` +
          `{time:'18:30',available:true,freeTables:4},{time:'19:00',available:true,freeTables:3},{time:'19:30',available:true,freeTables:2},` +
          `{time:'20:00',available:true,freeTables:2},{time:'20:30',available:true,freeTables:1},{time:'21:00',available:false,freeTables:0}` +
          `]}),{headers:{'content-type':'application/json'}}))}` +
          `return of.call(this,u,o)}})()`,
      },
    ],
  },
]
