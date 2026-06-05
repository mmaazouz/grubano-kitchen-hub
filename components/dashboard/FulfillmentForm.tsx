'use client'

/**
 * Fulfillment settings form — operator-facing.
 *
 * Renders the delivery / pickup / reservation toggles plus prep times and
 * pickup info for a single restaurant. Posts to
 *   POST /api/restaurants/[id]/fulfillment
 * on submit. Uses the unified design system (Button / Card / Input / Modal /
 * useToast) — see components/design-system/README.md.
 */

import { useState } from 'react'
import {
  Truck, ShoppingBag, CalendarDays, Save, RotateCcw,
} from 'lucide-react'
import {
  Button,
  Card,
  Input,
  Modal,
  ToastProvider,
  useToast,
  Badge,
} from '@/components/design-system'
import EstablishmentSwitcher, {
  type EstablishmentOption,
} from '@/components/dashboard/EstablishmentSwitcher'

// ── Types ────────────────────────────────────────────────────────────────────

export interface FulfillmentSettings {
  deliveryEnabled:    boolean
  pickupEnabled:      boolean
  reservationEnabled: boolean
  deliveryRadius:     number
  pickupPrepTime:     number
  deliveryPrepTime:   number
  pickupAddress:      string | null
  pickupInstructions: string | null
}

interface Props {
  restaurantId:   string
  restaurantName: string
  // All of the operator's establishments (oldest first) for the header switcher.
  // ≤1 entry → the switcher renders nothing (mono behaviour preserved).
  establishments: EstablishmentOption[]
  initial:        FulfillmentSettings
}

// ── Component ────────────────────────────────────────────────────────────────

export default function FulfillmentForm(props: Props) {
  // Wrap the form in a local ToastProvider so toast() works on this page
  // without us having to mount one globally (per design-system README).
  return (
    <ToastProvider>
      <FulfillmentFormInner {...props} />
    </ToastProvider>
  )
}

function FulfillmentFormInner({ restaurantId, restaurantName, establishments, initial }: Props) {
  const toast = useToast()
  const [form,    setForm]    = useState<FulfillmentSettings>(initial)
  const [saving,  setSaving]  = useState(false)
  const [confirm, setConfirm] = useState(false)

  // Detect if the user has made any change since the initial snapshot.
  const dirty =
    form.deliveryEnabled    !== initial.deliveryEnabled    ||
    form.pickupEnabled      !== initial.pickupEnabled      ||
    form.reservationEnabled !== initial.reservationEnabled ||
    form.deliveryRadius     !== initial.deliveryRadius     ||
    form.pickupPrepTime     !== initial.pickupPrepTime     ||
    form.deliveryPrepTime   !== initial.deliveryPrepTime   ||
    (form.pickupAddress      ?? '') !== (initial.pickupAddress      ?? '') ||
    (form.pickupInstructions ?? '') !== (initial.pickupInstructions ?? '')

  const activeChannels =
    Number(form.deliveryEnabled) +
    Number(form.pickupEnabled) +
    Number(form.reservationEnabled)

  function set<K extends keyof FulfillmentSettings>(key: K, value: FulfillmentSettings[K]) {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  function reset() {
    setForm(initial)
    toast.info('Modifications annulées')
  }

  async function submit() {
    if (activeChannels === 0) {
      toast.error('Au moins un mode doit rester actif', {
        description: 'Activez la livraison, le retrait ou la réservation.',
      })
      return
    }
    setSaving(true)
    try {
      const res = await fetch(`/api/restaurants/${restaurantId}/fulfillment`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(form),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error('Échec de l’enregistrement', {
          description: data?.error ?? `HTTP ${res.status}`,
        })
        return
      }
      toast.success('Paramètres enregistrés', {
        description: 'Les changements sont en ligne immédiatement.',
      })
      // Snap baseline so dirty becomes false until next edit.
      Object.assign(initial, form)
    } catch (err) {
      toast.error('Erreur réseau', {
        description: err instanceof Error ? err.message : 'Réessayez dans un instant.',
      })
    } finally {
      setSaving(false)
      setConfirm(false)
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="mx-auto max-w-3xl px-5 pt-4 pb-24">
      <header className="mb-6 flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">Modes de service</h1>
          <p className="mt-1 text-sm text-grubano-ink-muted">
            Choisissez comment <span className="font-medium text-grubano-ink">{restaurantName}</span> sert ses clients.
          </p>
        </div>
        {/* Switcher renders nothing at ≤1 establishment → mono header unchanged. */}
        <EstablishmentSwitcher establishments={establishments} currentId={restaurantId} />
      </header>

      {/* Channel toggles ------------------------------------------------------ */}
      <div className="grid gap-3 md:grid-cols-3">
        <ChannelToggle
          icon={<Truck size={20} />}
          title="Livraison"
          description="Vos plats livrés à domicile."
          active={form.deliveryEnabled}
          onToggle={v => set('deliveryEnabled', v)}
        />
        <ChannelToggle
          icon={<ShoppingBag size={20} />}
          title="À emporter"
          description="Le client passe récupérer sa commande."
          active={form.pickupEnabled}
          onToggle={v => set('pickupEnabled', v)}
        />
        <ChannelToggle
          icon={<CalendarDays size={20} />}
          title="Réservation"
          description="Les clients réservent une table sur place."
          active={form.reservationEnabled}
          onToggle={v => set('reservationEnabled', v)}
        />
      </div>

      {/* Delivery section ----------------------------------------------------- */}
      {form.deliveryEnabled && (
        <Card className="mt-6" elevation="sm" padding="lg">
          <SectionTitle icon={<Truck size={16} />}>Livraison</SectionTitle>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <Input
              type="number"
              label="Rayon de livraison (km)"
              hint="Distance maximale autour du restaurant."
              min={0}
              max={50}
              value={form.deliveryRadius}
              onChange={e => set('deliveryRadius', Number(e.target.value) || 0)}
            />
            <Input
              type="number"
              label="Temps de préparation (min)"
              hint="Affiché au client comme délai estimé."
              min={0}
              max={180}
              value={form.deliveryPrepTime}
              onChange={e => set('deliveryPrepTime', Number(e.target.value) || 0)}
            />
          </div>
        </Card>
      )}

      {/* Pickup section ------------------------------------------------------- */}
      {form.pickupEnabled && (
        <Card className="mt-4" elevation="sm" padding="lg">
          <SectionTitle icon={<ShoppingBag size={16} />}>À emporter</SectionTitle>
          <div className="mt-4 grid gap-4">
            <Input
              type="number"
              label="Temps de préparation (min)"
              hint="Délai avant que la commande soit prête à être récupérée."
              min={0}
              max={180}
              value={form.pickupPrepTime}
              onChange={e => set('pickupPrepTime', Number(e.target.value) || 0)}
            />
            <Input
              label="Adresse de retrait"
              hint="Si différente de l’adresse principale du restaurant."
              placeholder="12 rue de la Paix, 75002 Paris"
              value={form.pickupAddress ?? ''}
              onChange={e => set('pickupAddress', e.target.value || null)}
            />
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-grubano-ink">
                Instructions de retrait
              </span>
              <textarea
                rows={3}
                placeholder="Sonnez à l’interphone « Cuisine », entrez par la cour…"
                value={form.pickupInstructions ?? ''}
                onChange={e => set('pickupInstructions', e.target.value || null)}
                className="w-full rounded-grubano-lg border border-grubano-border bg-grubano-surface px-3 py-2 text-sm text-grubano-ink placeholder:text-grubano-ink-faint focus:border-grubano-primary focus:outline-none focus:ring-2 focus:ring-grubano-primary/20"
              />
              <span className="mt-1 block text-xs text-grubano-ink-muted">
                Visibles dans la confirmation de commande.
              </span>
            </label>
          </div>
        </Card>
      )}

      {/* Reservation note ----------------------------------------------------- */}
      {form.reservationEnabled && (
        <Card className="mt-4" elevation="sm" padding="lg">
          <SectionTitle icon={<CalendarDays size={16} />}>Réservation</SectionTitle>
          <p className="mt-2 text-sm text-grubano-ink-muted">
            La gestion des tables et créneaux se fait depuis{' '}
            <a href="/tables" className="font-medium text-grubano-primary hover:underline">
              /tables
            </a>
            . Activer ce mode rend cette option visible côté client.
          </p>
        </Card>
      )}

      {/* Sticky action bar ---------------------------------------------------- */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-grubano-border bg-grubano-surface/95 px-5 py-3 backdrop-blur md:left-64">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs">
            <Badge tone={activeChannels > 0 ? 'success' : 'danger'} size="sm" dot>
              {activeChannels} mode{activeChannels > 1 ? 's' : ''} actif{activeChannels > 1 ? 's' : ''}
            </Badge>
            {dirty && (
              <span className="text-grubano-ink-muted">Modifications non enregistrées</span>
            )}
          </div>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="md"
              leftIcon={<RotateCcw size={14} />}
              onClick={reset}
              disabled={!dirty || saving}
            >
              Annuler
            </Button>
            <Button
              variant="primary"
              size="md"
              leftIcon={<Save size={14} />}
              loading={saving}
              disabled={!dirty || activeChannels === 0}
              onClick={() => setConfirm(true)}
            >
              Enregistrer
            </Button>
          </div>
        </div>
      </div>

      {/* Confirm modal -------------------------------------------------------- */}
      <Modal
        open={confirm}
        onClose={() => !saving && setConfirm(false)}
        title="Confirmer les changements"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirm(false)} disabled={saving}>
              Retour
            </Button>
            <Button variant="primary" onClick={submit} loading={saving}>
              Appliquer
            </Button>
          </div>
        }
      >
        <p className="text-sm text-grubano-ink-muted">
          Les nouveaux paramètres seront visibles immédiatement par vos clients sur l’app et dans le tunnel de commande.
        </p>
      </Modal>
    </div>
  )
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function SectionTitle({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <h2 className="flex items-center gap-2 font-display text-base font-semibold text-grubano-ink">
      <span className="text-grubano-primary">{icon}</span>
      {children}
    </h2>
  )
}

function ChannelToggle({
  icon, title, description, active, onToggle,
}: {
  icon: React.ReactNode
  title: string
  description: string
  active: boolean
  onToggle: (v: boolean) => void
}) {
  return (
    <Card
      elevation={active ? 'md' : 'sm'}
      padding="lg"
      interactive
      onClick={() => onToggle(!active)}
      className={
        active
          ? 'border border-grubano-primary/50 bg-grubano-tint/40'
          : 'border border-grubano-border'
      }
    >
      <div className="flex items-start justify-between gap-3">
        <div
          className={
            'grid h-10 w-10 shrink-0 place-items-center rounded-grubano-lg ' +
            (active
              ? 'bg-grubano-primary text-white'
              : 'bg-grubano-border/40 text-grubano-ink-muted')
          }
          aria-hidden
        >
          {icon}
        </div>
        <Switch active={active} onClick={() => onToggle(!active)} />
      </div>
      <h3 className="mt-3 font-display text-base font-semibold text-grubano-ink">{title}</h3>
      <p className="mt-1 text-xs text-grubano-ink-muted">{description}</p>
    </Card>
  )
}

function Switch({ active, onClick }: { active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={active}
      onClick={e => { e.stopPropagation(); onClick() }}
      className={
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ' +
        (active ? 'bg-grubano-primary' : 'bg-grubano-border')
      }
    >
      <span
        className={
          'inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ' +
          (active ? 'translate-x-5' : 'translate-x-0.5')
        }
      />
    </button>
  )
}
