'use client'

/**
 * /design — Grubano Design System living documentation.
 *
 * Every component shipped in components/design-system/ is exercised here in
 * every meaningful variant. Used by Agents 2/3/4 as a visual catalogue, and
 * by Agent 6 to spot regressions while iterating.
 *
 * This page is intentionally route-bypassed in middleware via the /eat-style
 * public path policy — it is the design surface, not a real consumer route.
 */

import * as React from 'react'
import {
  Avatar,
  Badge,
  Button,
  Card,
  CategoryPill,
  DishCard,
  DocsLink,
  EmptyState,
  Input,
  Modal,
  OrderCard,
  PriceTag,
  RestaurantCard,
  Skeleton,
  SkeletonCard,
  SkeletonList,
  SkeletonRow,
  StarRating,
  ToastProvider,
  useToast,
} from '@/components/design-system'
import { colors, radii, shadows, typography } from '@/lib/design-tokens'
import { FOOD_CATALOG, getFoodImage, getRestaurantCover } from '@/lib/food-images'
import { ALL_DOCS_TOPICS } from '@/lib/docs-map'
import { Search, Heart, ShoppingBag, ArrowRight, Mail, Lock } from 'lucide-react'

export default function DesignPage() {
  return (
    <ToastProvider>
      <DesignInner />
    </ToastProvider>
  )
}

function DesignInner() {
  const { success, error, warning, info } = useToast()
  const [modalOpen, setModalOpen] = React.useState(false)
  const [rating, setRating] = React.useState(4)
  const [cat, setCat] = React.useState<'pizza' | 'asian' | 'healthy'>('pizza')

  return (
    <div className="min-h-screen bg-grubano-bg pb-24">
      {/* Header */}
      <header className="border-b border-grubano-border bg-grubano-surface">
        <div className="mx-auto max-w-5xl px-5 py-6 flex items-center justify-between">
          <div>
            <h1 className="font-display font-bold text-grubano-3xl text-grubano-ink leading-tight">
              Grubano Design System
            </h1>
            <p className="text-grubano-sm text-grubano-ink-muted mt-1">
              v1 — Agent 6 · single source of truth for visual components
            </p>
          </div>
          <Badge tone="primary" dot>
            Live
          </Badge>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-5 py-10 space-y-16">
        <Tokens />
        <Section title="Buttons" caption="4 variants × 4 sizes + loading & icon slots">
          <div className="space-y-4">
            <div className="flex flex-wrap gap-3">
              <Button variant="primary">Commander</Button>
              <Button variant="secondary">Voir le menu</Button>
              <Button variant="ghost">Annuler</Button>
              <Button variant="danger">Supprimer</Button>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button size="sm">Small</Button>
              <Button size="md">Medium</Button>
              <Button size="lg">Large</Button>
              <Button size="pill">Pill</Button>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button leftIcon={<Heart size={16} />}>Favoris</Button>
              <Button rightIcon={<ArrowRight size={16} />}>Continuer</Button>
              <Button loading>Envoi…</Button>
              <Button disabled>Désactivé</Button>
            </div>
            <Button fullWidth size="lg" leftIcon={<ShoppingBag size={18} />}>
              Passer la commande · 24,90 €
            </Button>
          </div>
        </Section>

        <Section title="Badges" caption="Status pills + tonal variants">
          <div className="flex flex-wrap gap-2">
            <Badge>Default</Badge>
            <Badge tone="primary">Nouveau</Badge>
            <Badge tone="success" dot>En route</Badge>
            <Badge tone="danger">Annulé</Badge>
            <Badge tone="warning">Promo</Badge>
            <Badge tone="info">Info</Badge>
            <Badge tone="dark">Premium</Badge>
            <Badge tone="primary" size="sm">SM</Badge>
          </div>
        </Section>

        <Section title="Avatar" caption="Initials fallback + image + square (logos)">
          <div className="flex items-end gap-4">
            <Avatar name="Mohammed Maazouz" size="xs" />
            <Avatar name="Gnocchi Bar" size="sm" />
            <Avatar name="Pasta Fresca" size="md" />
            <Avatar name="Rollix" size="lg" />
            <Avatar name="Bowl Healthy" size="xl" square />
            <Avatar name="Photo" src={getFoodImage('pizza', 1)} size="xl" />
          </div>
        </Section>

        <Section title="Input" caption="Label + hint + error + icons">
          <div className="grid sm:grid-cols-2 gap-4 max-w-2xl">
            <Input label="Email" placeholder="vous@grubano.com" leftIcon={<Mail size={16} />} />
            <Input label="Mot de passe" type="password" leftIcon={<Lock size={16} />} hint="8 caractères minimum" />
            <Input label="Rechercher" placeholder="Pizza, burger…" leftIcon={<Search size={16} />} />
            <Input label="Adresse" error="Adresse incomplète" defaultValue="123 rue" />
          </div>
        </Section>

        <Section title="Star Rating" caption="Display (decimal + reviews) + interactive">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-4">
              <StarRating value={4.7} reviewCount={1247} />
              <StarRating value={4.2} reviewCount="1.2k" size="lg" />
              <StarRating value={5} showValue={false} reviewCount={32} size="sm" />
            </div>
            <div className="flex items-center gap-3">
              <span className="text-grubano-sm text-grubano-ink-muted">Interactif :</span>
              <StarRating value={rating} onChange={setRating} size="lg" />
              <span className="text-grubano-sm text-grubano-ink">{rating}/5</span>
            </div>
          </div>
        </Section>

        <Section title="Price Tag" caption="Strikethrough for promos">
          <div className="flex flex-wrap items-baseline gap-6">
            <PriceTag amount={12.5} />
            <PriceTag amount={9.9} originalAmount={14.5} />
            <PriceTag amount={9.9} originalAmount={14.5} size="xl" />
            <PriceTag amount={2490} originalAmount={3200} cents size="lg" />
          </div>
        </Section>

        <Section title="Category Pills" caption="Used in /eat homepage filter rail">
          <div className="flex flex-wrap gap-2">
            <CategoryPill emoji="🍕" active>Pizza</CategoryPill>
            <CategoryPill emoji="🍔">Burgers</CategoryPill>
            <CategoryPill emoji="🍣">Sushi</CategoryPill>
            <CategoryPill emoji="🥗">Healthy</CategoryPill>
            <CategoryPill emoji="🍰" size="sm">Desserts</CategoryPill>
            <CategoryPill emoji="🥙" size="lg">Wraps</CategoryPill>
          </div>
        </Section>

        <Section title="Card" caption="Elevation + padding scale">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Card elevation="flat" padding="md">
              <p className="font-semibold">Flat</p>
              <p className="text-grubano-sm text-grubano-ink-muted mt-1">No shadow.</p>
            </Card>
            <Card elevation="md" padding="md">
              <p className="font-semibold">Default (md)</p>
              <p className="text-grubano-sm text-grubano-ink-muted mt-1">Standard surface.</p>
            </Card>
            <Card elevation="premium" padding="lg" interactive>
              <p className="font-semibold">Premium · interactive</p>
              <p className="text-grubano-sm text-grubano-ink-muted mt-1">Hover & tap me.</p>
            </Card>
          </div>
        </Section>

        <Section title="Restaurant Card" caption="3 layouts · real cover photos">
          <div className="space-y-6">
            <div>
              <p className="text-grubano-xs uppercase tracking-wide text-grubano-ink-muted mb-2">grid (default)</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <RestaurantCard
                  name="Gnocchi Bar"
                  cuisine="Italien · Pâtes fraîches"
                  cover={getRestaurantCover('gnocchi-bar')}
                  rating={4.8}
                  reviewCount={1247}
                  deliveryTime={25}
                  deliveryFee={1.99}
                  ribbon={{ label: 'Populaire', tone: 'primary' }}
                  onClick={() => info('Click Gnocchi Bar')}
                />
                <RestaurantCard
                  name="Pasta Fresca"
                  cuisine="Italien · Lasagnes"
                  cover={getRestaurantCover('pasta-fresca')}
                  rating={4.6}
                  reviewCount={842}
                  deliveryTime={30}
                  deliveryFee={0}
                  ribbon={{ label: '-20%', tone: 'danger' }}
                />
              </div>
            </div>

            <div>
              <p className="text-grubano-xs uppercase tracking-wide text-grubano-ink-muted mb-2">list</p>
              <div className="space-y-3">
                <RestaurantCard
                  layout="list"
                  name="Rollix"
                  cuisine="Wraps · Street food"
                  cover={getRestaurantCover('rollix')}
                  rating={4.5}
                  reviewCount={312}
                  deliveryTime={20}
                  deliveryFee={2.5}
                  onClick={() => {}}
                />
                <RestaurantCard
                  layout="list"
                  name="Bowl Healthy"
                  cuisine="Healthy · Vegan"
                  cover={getRestaurantCover('bowl-healthy')}
                  rating={4.3}
                  reviewCount={89}
                  deliveryTime={35}
                  deliveryFee={1.5}
                  unavailable
                />
              </div>
            </div>

            <div>
              <p className="text-grubano-xs uppercase tracking-wide text-grubano-ink-muted mb-2">hero</p>
              <RestaurantCard
                layout="hero"
                name="Le Riz Gourmand"
                cuisine="Asiatique · Bowls signature · Authentique"
                cover={getRestaurantCover('le-riz-gourmand')}
                rating={4.9}
                reviewCount={2034}
                deliveryTime={30}
                deliveryFee={1.99}
                minOrder={15}
                ribbon={{ label: 'Nouveau', tone: 'success' }}
              />
            </div>
          </div>
        </Section>

        <Section title="Dish Card" caption="Horizontal (menu) + vertical (carousel)">
          <div className="space-y-6">
            <div>
              <p className="text-grubano-xs uppercase tracking-wide text-grubano-ink-muted mb-2">horizontal</p>
              <div className="space-y-3 max-w-xl">
                <DishCard
                  name="Gnocchi al pesto"
                  description="Gnocchis maison, pesto basilic frais, pignons, parmesan AOP"
                  price={12.5}
                  photo={getFoodImage('pasta', 'gnocchi')}
                  popular
                  labels={[{ label: 'Veggie', tone: 'success' }, { label: 'Best-seller', tone: 'warning' }]}
                  meta="520 kcal"
                  onAdd={() => success('Ajouté au panier')}
                />
                <DishCard
                  name="Burger Smash Truffe"
                  description="Bœuf Black Angus 180g, cheddar affiné, mayo truffe, pain brioché"
                  price={14.9}
                  originalPrice={17.5}
                  photo={getFoodImage('burgers', 'smash')}
                  quantityInCart={2}
                  onAdd={() => {}}
                />
                <DishCard
                  name="Tiramisu maison"
                  description="Mascarpone, café espresso, biscuit savoiardi, cacao"
                  price={6.5}
                  photo={getFoodImage('desserts', 'tiramisu')}
                  unavailable
                />
              </div>
            </div>

            <div>
              <p className="text-grubano-xs uppercase tracking-wide text-grubano-ink-muted mb-2">vertical (4-col carousel)</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {FOOD_CATALOG.pizza.slice(0, 4).map((p, i) => (
                  <DishCard
                    key={p.slug}
                    layout="vertical"
                    name={p.alt}
                    description="Pâte à la levure naturelle, tomates San Marzano, mozzarella fior di latte"
                    price={11.5 + i}
                    photo={getFoodImage('pizza', i)}
                    onAdd={() => {}}
                  />
                ))}
              </div>
            </div>
          </div>
        </Section>

        <Section title="Order Card" caption="Operator + consumer views">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <OrderCard
              orderId="cl1234567abc"
              status="preparing"
              counterparty="Camille D."
              total={29.4}
              time={new Date()}
              items={[
                { name: 'Pizza Margherita', qty: 1, price: 11.5 },
                { name: 'Gnocchi pesto',    qty: 2, price: 12.5 },
                { name: 'Coca Zero 33cl',   qty: 2, price: 2.5  },
              ]}
              address="14 rue de la Paix, 75002 Paris"
              actionLabel="Marquer prête"
              onAction={() => warning('Ordre marqué prête')}
            />
            <OrderCard
              orderId="cl9876543xyz"
              status="picked_up"
              counterparty="Gnocchi Bar"
              total={24.9}
              etaMinutes={12}
              items={[
                { name: 'Lasagne classique', qty: 1, price: 14.9 },
                { name: 'Tiramisu', qty: 1, price: 6.5 },
              ]}
              onClick={() => info('Open order detail')}
            />
            <OrderCard orderId="abc" status="delivered" counterparty="Pasta Fresca" total={18.5} />
            <OrderCard orderId="def" status="cancelled" counterparty="Rollix" total={9.9} />
          </div>
        </Section>

        <Section title="Modal" caption="Bottom-sheet on mobile, dialog on desktop">
          <Button onClick={() => setModalOpen(true)}>Open modal</Button>
          <Modal
            open={modalOpen}
            onClose={() => setModalOpen(false)}
            title="Confirmer la commande"
            description="Vous êtes sur le point de passer commande chez Gnocchi Bar."
            footer={
              <>
                <Button variant="ghost" onClick={() => setModalOpen(false)}>Annuler</Button>
                <Button onClick={() => { setModalOpen(false); success('Commande confirmée') }}>
                  Confirmer
                </Button>
              </>
            }
          >
            <div className="space-y-3">
              <p className="text-grubano-sm text-grubano-ink-muted">
                Récapitulatif de votre commande :
              </p>
              <div className="space-y-1.5 text-grubano-sm">
                <div className="flex justify-between"><span>Gnocchi al pesto × 2</span><span className="font-semibold">25,00 €</span></div>
                <div className="flex justify-between"><span>Tiramisu × 1</span><span className="font-semibold">6,50 €</span></div>
                <div className="flex justify-between"><span>Livraison</span><span className="font-semibold">1,99 €</span></div>
              </div>
              <div className="flex justify-between pt-2 border-t border-grubano-border font-bold">
                <span>Total</span>
                <PriceTag amount={33.49} size="lg" />
              </div>
            </div>
          </Modal>
        </Section>

        <Section title="Empty State" caption="With and without CTA, compact variant">
          <div className="grid sm:grid-cols-2 gap-4">
            <Card elevation="sm">
              <EmptyState
                emoji="🛒"
                title="Votre panier est vide"
                description="Ajoutez des plats depuis la carte pour commencer."
                action={<Button leftIcon={<Search size={16} />}>Découvrir</Button>}
              />
            </Card>
            <Card elevation="sm">
              <EmptyState compact emoji="⭐" title="Aucune note" description="Soyez le premier à noter." />
            </Card>
          </div>
        </Section>

        <Section title="Skeleton" caption="Shimmer placeholders">
          <div className="space-y-4">
            <div className="grid sm:grid-cols-3 gap-3">
              <SkeletonCard />
              <SkeletonCard />
              <SkeletonCard />
            </div>
            <SkeletonList count={3} variant="row" />
            <div className="flex flex-col gap-2">
              <Skeleton className="h-8 w-1/3" rounded="md" />
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-4 w-full" />
            </div>
          </div>
        </Section>

        <Section title="Toast" caption="useToast() — global, portal-rendered, auto-dismiss">
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={() => success('Commande passée', { description: 'Estimation 25 min' })}>Success</Button>
            <Button variant="danger"  onClick={() => error('Paiement refusé',  { description: 'Vérifiez votre carte' })}>Error</Button>
            <Button variant="secondary" onClick={() => warning('Stock bas',     { description: '3 portions restantes' })}>Warning</Button>
            <Button variant="ghost" onClick={() => info('Nouveau plat ajouté')}>Info</Button>
          </div>
        </Section>

        <Section
          title="Docs Link"
          caption="Brique B2 — contextual help linking app surfaces to docs.grubano.com. Locale-aware (snapshot in lib/docs-map.ts). Always opens in a new tab."
        >
          <div className="space-y-6">
            {/* "link" variant — typical use under a section header or empty state */}
            <Card padding="lg" elevation="sm" className="space-y-3">
              <div className="flex items-baseline justify-between gap-3">
                <h4 className="font-display font-bold text-grubano-base text-grubano-ink">
                  Gérer mes stocks
                </h4>
                <DocsLink topic="restaurant.stocks" />
              </div>
              <p className="text-grubano-sm text-grubano-ink-muted">
                Variante <code className="font-mono text-grubano-xs bg-grubano-surface-muted px-1 rounded">link</code> —
                default. Texte i18n + flèche externe.
              </p>
            </Card>

            {/* "icon" variant — discreet "?" next to inline titles */}
            <Card padding="lg" elevation="sm" className="space-y-3">
              <div className="flex items-center gap-1">
                <h4 className="font-display font-bold text-grubano-base text-grubano-ink">
                  Programme de fidélité
                </h4>
                <DocsLink topic="restaurant.loyalty" variant="icon" />
              </div>
              <p className="text-grubano-sm text-grubano-ink-muted">
                Variante <code className="font-mono text-grubano-xs bg-grubano-surface-muted px-1 rounded">icon</code> —
                petit <code className="font-mono text-grubano-xs">?</code> discret, idéal à côté d&apos;un titre de section.
              </p>
            </Card>

            {/* Custom label override */}
            <Card padding="lg" elevation="sm" className="space-y-3">
              <DocsLink topic="creators" label="Tout savoir sur le programme Créateurs" />
              <p className="text-grubano-sm text-grubano-ink-muted">
                Prop <code className="font-mono text-grubano-xs bg-grubano-surface-muted px-1 rounded">label</code> pour
                surcharger le texte par défaut.
              </p>
            </Card>

            {/* Unknown topic — graceful fallback to docs home */}
            <Card padding="lg" elevation="sm" className="space-y-3">
              <DocsLink topic="not-a-real-topic" label="Sujet inconnu (fallback gracieux)" />
              <p className="text-grubano-sm text-grubano-ink-muted">
                Topic inconnu → lien vers la home doc (jamais de lien cassé). Console warning en dev seulement.
              </p>
            </Card>

            {/* Catalogue of every known topic — proof the contract is wired */}
            <div>
              <p className="text-grubano-xs uppercase tracking-wide text-grubano-ink-muted mb-2">
                Catalogue ({ALL_DOCS_TOPICS.length} topics connus)
              </p>
              <Card padding="lg" elevation="flat" className="bg-grubano-surface-muted">
                <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-grubano-sm">
                  {ALL_DOCS_TOPICS.map((t) => (
                    <li key={t} className="flex items-baseline justify-between gap-3">
                      <code className="font-mono text-grubano-xs text-grubano-ink">{t}</code>
                      <DocsLink topic={t} />
                    </li>
                  ))}
                </ul>
              </Card>
            </div>
          </div>
        </Section>

        <Section title="Category filter (live)" caption="CategoryPill + getFoodImage in action">
          <div className="space-y-4">
            <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-1 px-1 pb-1">
              {(['pizza', 'asian', 'healthy'] as const).map((c) => (
                <CategoryPill
                  key={c}
                  emoji={c === 'pizza' ? '🍕' : c === 'asian' ? '🍣' : '🥗'}
                  active={cat === c}
                  onClick={() => setCat(c)}
                >
                  {c}
                </CategoryPill>
              ))}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {FOOD_CATALOG[cat].slice(0, 4).map((p, i) => (
                <DishCard
                  key={p.slug}
                  layout="vertical"
                  name={p.alt}
                  price={9.5 + i * 1.2}
                  photo={getFoodImage(cat, i)}
                  onAdd={() => success(`${p.alt} ajouté`)}
                />
              ))}
            </div>
          </div>
        </Section>

        <Section title="Food photo catalogue" caption="85 curated photos · /lib/food-images.ts">
          <div className="space-y-6">
            {(Object.keys(FOOD_CATALOG) as Array<keyof typeof FOOD_CATALOG>).map((c) => (
              <div key={c}>
                <p className="text-grubano-xs uppercase tracking-wide text-grubano-ink-muted mb-2">{c}</p>
                <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                  {FOOD_CATALOG[c].map((p) => (
                    <div key={p.slug} className="rounded-grubano-md overflow-hidden border border-grubano-border bg-grubano-surface-muted aspect-[4/3]">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={getFoodImage(c, p.slug)} alt={p.alt} className="h-full w-full object-cover" loading="lazy" />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Section>
      </main>
    </div>
  )
}

// ── helpers ─────────────────────────────────────────────────────────────────

function Section({
  title,
  caption,
  children,
}: {
  title: string
  caption?: string
  children: React.ReactNode
}) {
  return (
    <section>
      <div className="mb-4">
        <h2 className="font-display font-bold text-grubano-xl text-grubano-ink">{title}</h2>
        {caption && <p className="text-grubano-sm text-grubano-ink-muted">{caption}</p>}
      </div>
      {children}
    </section>
  )
}

function Tokens() {
  const swatches: Array<[string, string]> = [
    ['primary',     colors.primary],
    ['primaryHover',colors.primaryHover],
    ['tint',        colors.primaryTint],
    ['dark',        colors.dark],
    ['ink',         colors.ink],
    ['ink-muted',   colors.inkMuted],
    ['bg',          colors.background],
    ['border',      colors.border],
    ['success',     colors.success],
    ['danger',      colors.danger],
    ['warning',     colors.warning],
    ['info',        colors.info],
  ]

  return (
    <section>
      <div className="mb-4">
        <h2 className="font-display font-bold text-grubano-xl text-grubano-ink">Tokens</h2>
        <p className="text-grubano-sm text-grubano-ink-muted">
          Source: <code className="font-mono text-grubano-xs bg-grubano-surface-muted px-1.5 py-0.5 rounded">lib/design-tokens.ts</code>
        </p>
      </div>

      <Card padding="lg" elevation="sm" className="space-y-6">
        <div>
          <p className="text-grubano-xs uppercase tracking-wide text-grubano-ink-muted mb-2">Colours</p>
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
            {swatches.map(([name, hex]) => (
              <div key={name} className="rounded-grubano-md overflow-hidden border border-grubano-border">
                <div className="h-12 w-full" style={{ background: hex }} />
                <div className="p-2 bg-grubano-surface">
                  <p className="text-[10px] font-semibold text-grubano-ink truncate">{name}</p>
                  <p className="text-[10px] font-mono text-grubano-ink-muted">{hex}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div>
          <p className="text-grubano-xs uppercase tracking-wide text-grubano-ink-muted mb-2">Radius</p>
          <div className="flex flex-wrap items-end gap-3">
            {(Object.entries(radii) as [string, string][]).map(([k, v]) => (
              <div key={k} className="text-center">
                <div
                  className="h-14 w-14 bg-grubano-primary"
                  style={{ borderRadius: v }}
                />
                <p className="mt-1 text-[10px] font-semibold text-grubano-ink">{k}</p>
                <p className="text-[10px] font-mono text-grubano-ink-muted">{v}</p>
              </div>
            ))}
          </div>
        </div>

        <div>
          <p className="text-grubano-xs uppercase tracking-wide text-grubano-ink-muted mb-2">Shadows</p>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {(Object.entries(shadows) as [string, string][]).map(([k, v]) => (
              <div key={k} className="text-center">
                <div
                  className="h-16 w-full bg-grubano-surface rounded-grubano-lg"
                  style={{ boxShadow: v }}
                />
                <p className="mt-2 text-[10px] font-semibold text-grubano-ink">{k}</p>
              </div>
            ))}
          </div>
        </div>

        <div>
          <p className="text-grubano-xs uppercase tracking-wide text-grubano-ink-muted mb-2">Typography</p>
          <div className="space-y-1">
            <p style={{ fontFamily: typography.fontDisplay, fontSize: typography.sizes['4xl'], fontWeight: typography.weights.bold }}>
              Space Grotesk — Display
            </p>
            <p style={{ fontFamily: typography.fontBody, fontSize: typography.sizes.base }}>
              Inter — Le corps de texte. Lisible, neutre, propre.
            </p>
            <p className="text-grubano-xs text-grubano-ink-muted font-mono">
              fontDisplay / fontBody — 8 sizes (xs → 5xl) · 4 weights · 4 line-heights
            </p>
          </div>
        </div>
      </Card>
    </section>
  )
}
