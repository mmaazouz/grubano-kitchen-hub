'use client'

import { useState, useEffect } from 'react'
import { useRouter } from '@/navigation'
import { useSession, signOut } from 'next-auth/react'
import { useTranslations, useLocale } from 'next-intl'
import {
  User, MapPin, CreditCard, Tag, Bell, Settings, LogOut, ChevronRight,
  Star, Package, Heart, MessageCircle, Shield, CircleHelp, Globe, ChefHat,
} from 'lucide-react'
import { showToast } from '@/lib/eat-cart'
import { LanguageSwitcher } from '@/components/design-system'
import LastReservationCard from '@/components/eat/LastReservationCard'
import RoleSwitcher from '@/components/RoleSwitcher'

// Loyalty tiers per CLAUDE.md: Bronze 50 → Silver 100 → Gold 200 → Platine 400
function tierFor(points: number) {
  if (points >= 400) return { label: 'Platine', next: 400, floor: 400 }
  if (points >= 200) return { label: 'Or', next: 400, floor: 200 }
  if (points >= 100) return { label: 'Argent', next: 200, floor: 100 }
  if (points >= 50) return { label: 'Bronze', next: 100, floor: 50 }
  return { label: 'Membre', next: 50, floor: 0 }
}

interface Order {
  id: string
  status: string
  total: number
  createdAt?: string
  restaurant?: { id: string; name: string } | null
}

// Chantier fidélité L2 — a points-ledger movement (read from /api/loyalty/history).
interface LoyaltyTxn {
  id: string
  type: string          // earn | redeem | refund
  points: number        // signed: +earned / −spent / +re-credited
  euros: number         // |points| × centsPerPoint / 100 (server rate)
  orderRef: string | null
  date: string
}

export default function ProfileScreen() {
  const t = useTranslations('eat.account')
  const tt = useTranslations('eat.track') // status labels reused (hygiène)
  const locale = useLocale()
  const { data: session, status } = useSession()
  const router = useRouter()
  const [points, setPoints] = useState(0)
  // L2 — the points balance converted to a euro credit (server rate, never client).
  const [balanceEuros, setBalanceEuros] = useState(0)
  const [history, setHistory] = useState<LoyaltyTxn[]>([])
  const [historyShown, setHistoryShown] = useState(5)
  const [orders, setOrders] = useState<Order[]>([])
  const [notif, setNotif] = useState(true)

  const loggedIn = status === 'authenticated'

  useEffect(() => {
    if (status !== 'authenticated') return
    Promise.all([
      fetch('/api/loyalty/wallet').then((r) => r.json()).catch(() => ({ pointsBalance: 0 })),
      fetch('/api/orders?take=50').then((r) => r.json()).catch(() => ({ orders: [] })),
      fetch('/api/loyalty/history').then((r) => r.json()).catch(() => ({ transactions: [] })),
    ]).then(([wallet, ord, hist]) => {
      setPoints(wallet.pointsBalance ?? 0)
      // Euro equivalent comes straight from the wallet (server rate) — never a
      // client-side conversion (no hardcoded points→€ rate on this surface).
      setBalanceEuros(typeof wallet.balanceEuros === 'number' ? wallet.balanceEuros : 0)
      setOrders(ord.orders ?? [])
      setHistory(Array.isArray(hist.transactions) ? hist.transactions : [])
    })
  }, [status])

  const MENU_ITEMS = [
    // Phase 3 — multi-role cumul: a logged-in consumer can ALSO become a creator/
    // influencer. Carries their email to pre-fill /creators/apply; the creator role
    // is ADDED to this same account on approval (primary role + password untouched).
    { icon: ChefHat, key: 'menuBecomeCreator', label: t('menuBecomeCreator'),
      route: session?.user?.email
        ? `/creators/apply?email=${encodeURIComponent(session.user.email)}`
        : '/creators/apply',
      color: '#F97316' },
    { icon: Package, key: 'menuOrders', label: t('menuOrders'), route: '/eat/account', color: '#F97316' },
    { icon: Heart, key: 'menuFavorites', label: t('menuFavorites'), route: '/eat/favorites', color: '#EF4444' },
    { icon: MapPin, key: 'menuAddresses', label: t('menuAddresses'), route: null, color: '#3B82F6' },
    { icon: CreditCard, key: 'menuPayment', label: t('menuPayment'), route: null, color: '#22C55E' },
    { icon: Tag, key: 'menuPromotions', label: t('menuPromotions'), route: '/eat/promos', color: '#F59E0B' },
    { icon: Bell, key: 'menuNotifications', label: t('menuNotifications'), route: null, color: '#8B5CF6' },
    { icon: MessageCircle, key: 'menuSupport', label: t('menuSupport'), route: null, color: '#06B6D4' },
    { icon: Shield, key: 'menuPrivacy', label: t('menuPrivacy'), route: null, color: '#64748B' },
    { icon: CircleHelp, key: 'menuHelp', label: t('menuHelp'), route: null, color: '#94A3B8' },
    { icon: Settings, key: 'menuSettings', label: t('menuSettings'), route: null, color: '#6B7280' },
  ]

  // Guest
  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-[#f5f5f5]">
        <div className="border-b border-[#f0f0f0] bg-white px-4 pb-4 pt-3"><div className="h-6 w-1/3 animate-pulse rounded bg-gray-200" /></div>
        <div className="space-y-3 p-4"><div className="h-24 animate-pulse rounded-2xl bg-white" /><div className="h-24 animate-pulse rounded-2xl bg-white" /></div>
      </div>
    )
  }

  if (!loggedIn) {
    return (
      <div className="min-h-screen bg-[#f5f5f5]">
        <div className="border-b border-[#f0f0f0] bg-white px-4 pb-4 pt-3">
          <h1 className="font-sans text-[22px] font-extrabold text-[#1a1a1a]">{t('title')}</h1>
        </div>
        <div className="flex flex-col items-center px-10 pt-20 text-center">
          <div className="flex h-24 w-24 items-center justify-center rounded-full bg-[#FFF3ED]"><User size={48} className="text-[#F97316]" /></div>
          <p className="mt-5 text-[22px] font-extrabold text-[#1a1a1a]">{t('signInPrompt')}</p>
          <p className="mt-2 text-sm leading-relaxed text-[#888]">{t('signInSubtitle')}</p>
          <button onClick={() => router.push('/eat/auth')} className="mt-8 w-full rounded-[30px] bg-[#F97316] py-4 text-base font-bold text-white active:scale-95">{t('signIn')}</button>
          <button onClick={() => router.push('/eat/auth')} className="mt-3 w-full rounded-[30px] border-2 border-[#F97316] py-3.5 text-base font-bold text-[#F97316] active:scale-95">{t('createAccount')}</button>
        </div>
      </div>
    )
  }

  const tier = tierFor(points)
  const span = tier.next - tier.floor
  const progress = tier.label === 'Platine' ? 100 : Math.min(100, ((points - tier.floor) / span) * 100)
  const nextLabel = tierFor(tier.next).label
  const tierLabel = (label: string) => {
    const map: Record<string, string> = {
      Platine: t('tierPlatinum'),
      Or: t('tierGold'),
      Argent: t('tierSilver'),
      Bronze: t('tierBronze'),
      Membre: t('tierMember'),
    }
    return map[label] ?? label
  }
  const name = session?.user?.name ?? t('defaultName')
  const email = session?.user?.email ?? ''

  return (
    <div className="min-h-screen bg-[#f5f5f5]">
      <div className="border-b border-[#f0f0f0] bg-white px-4 pb-4 pt-3">
        <h1 className="font-sans text-[22px] font-extrabold text-[#1a1a1a]">{t('title')}</h1>
      </div>

      <div className="px-4 pb-6">
        {/* User card */}
        <div className="mt-3 flex items-center gap-3.5 rounded-[20px] bg-white p-4 shadow-bolt-card">
          <div className="relative">
            <div className="flex h-16 w-16 items-center justify-center rounded-full border-2 border-[#F97316] bg-[#FFF3ED] text-2xl">🧑</div>
            <span className="absolute bottom-0.5 right-0.5 h-3 w-3 rounded-full border-2 border-white bg-[#22C55E]" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[17px] font-extrabold text-[#1a1a1a]">{name}</p>
            <p className="truncate text-[13px] text-[#888]">{email}</p>
            <div className="mt-0.5 flex items-center gap-1">
              <Star size={13} className="fill-[#F97316] text-[#F97316]" />
              <span className="text-xs text-[#888]">{t('loyalCustomer')}</span>
            </div>
          </div>
          <button onClick={() => showToast(t('editProfileSoon'))} className="rounded-[20px] bg-[#FFF3ED] px-3.5 py-[7px] text-[13px] font-bold text-[#F97316] active:scale-95">{t('edit')}</button>
        </div>

        {/* Phase 4 — multi-role space selector (renders only for a multi-role
            account, e.g. consumer + creator → switch to /creators/dashboard). */}
        <div className="mt-3 overflow-hidden rounded-[20px] bg-white shadow-bolt-card empty:hidden">
          <RoleSwitcher tone="light" />
        </div>

        {/* Last reservation — Pay-my-bill shortcut (Brique 2). Hidden when
            localStorage has no stored reservation pointer; the card hands
            off to a modal that walks through the ticket fetch + Stripe
            Elements via the same factored component as /t/[tableId]. */}
        <LastReservationCard />

        {/* Loyalty card — balance in big + its euro-credit equivalent (L2). */}
        <div className="mt-3 flex items-center gap-4 rounded-[20px] bg-[#F97316] p-5">
          <div className="flex-1">
            <p className="text-xs font-semibold text-white/80">{t('loyaltyPoints')}</p>
            <p className="mt-1 text-[28px] font-extrabold leading-none text-white">{t('pts', { count: points.toLocaleString('fr-FR') })}</p>
            {balanceEuros > 0 && (
              <p className="mt-1 text-[13px] font-bold text-white">{t('creditEquivalent', { amount: balanceEuros.toFixed(2) })}</p>
            )}
            <p className="mt-1 text-[11px] text-white/80">
              {tier.label === 'Platine' ? t('maxLevel') : t('pointsToNextLevel', { count: tier.next - points, level: tierLabel(nextLabel) })}
            </p>
          </div>
          <div className="flex flex-1 flex-col items-end gap-2">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/30">
              <div className="h-full rounded-full bg-white transition-all duration-700" style={{ width: `${progress}%` }} />
            </div>
            <span className="text-[11px] font-semibold text-white/90">{tierLabel(tier.label)} → {tierLabel(nextLabel)}</span>
          </div>
        </div>

        {/* Mes points — the loyalty ledger (L2). earn green / redeem neutral /
            refund amber. Read-only from /api/loyalty/history (the L1 ledger). */}
        {history.length > 0 && (
          <div className="mt-3 overflow-hidden rounded-[20px] bg-white shadow-bolt-card">
            <p className="px-4 pb-1 pt-4 text-[15px] font-extrabold text-[#1a1a1a]">{t('pointsHistoryTitle')}</p>
            {history.slice(0, historyShown).map((txn) => {
              const earn   = txn.type === 'earn'
              const refund = txn.type === 'refund'
              const sign   = txn.points > 0 ? '+' : ''
              const color  = earn ? 'text-[#16A34A]' : refund ? 'text-[#B45309]' : 'text-[#6B7280]'
              const label  = earn
                ? (txn.orderRef ? t('histEarnOrder', { ref: txn.orderRef }) : t('histEarn'))
                : refund
                  ? (txn.orderRef ? t('histRefundOrder', { ref: txn.orderRef }) : t('histRefund'))
                  : (txn.orderRef ? t('histRedeemOrder', { ref: txn.orderRef }) : t('histRedeem'))
              return (
                <div key={txn.id} className="flex items-center gap-3 border-b border-[#f8f8f8] px-4 py-3 last:border-0">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-semibold text-[#1a1a1a]">{label}</p>
                    <p className="mt-0.5 text-[11px] text-[#888]">
                      {txn.date ? new Date(txn.date).toLocaleDateString(locale, { day: 'numeric', month: 'short' }) : ''}
                      {txn.euros > 0 ? ` · ${txn.euros.toFixed(2)} €` : ''}
                    </p>
                  </div>
                  <span className={`shrink-0 text-[14px] font-extrabold ${color}`}>
                    {sign}{txn.points.toLocaleString('fr-FR')} {t('ptsShort')}
                  </span>
                </div>
              )
            })}
            {history.length > historyShown && (
              <button
                onClick={() => setHistoryShown((n) => n + 10)}
                className="w-full py-3 text-center text-[13px] font-bold text-[#F97316] active:opacity-70"
              >
                {t('seeMore')}
              </button>
            )}
          </div>
        )}

        {/* Stats */}
        <div className="mt-3 flex rounded-[20px] bg-white py-5 shadow-bolt-card">
          <div className="flex flex-1 flex-col items-center gap-1"><span className="text-[22px] font-extrabold text-[#1a1a1a]">{orders.length}</span><span className="text-xs text-[#888]">{t('statOrders')}</span></div>
          <div className="w-px bg-[#f0f0f0]" />
          <div className="flex flex-1 flex-col items-center gap-1"><span className="text-[22px] font-extrabold text-[#1a1a1a]">{orders.filter((o) => o.status === 'delivered').length}</span><span className="text-xs text-[#888]">{t('statDelivered')}</span></div>
          <div className="w-px bg-[#f0f0f0]" />
          <div className="flex flex-1 flex-col items-center gap-1"><span className="text-[22px] font-extrabold text-[#1a1a1a]">{points >= 50 ? tierLabel(tier.label) : '–'}</span><span className="text-xs text-[#888]">{t('statLevel')}</span></div>
        </div>

        {/* Order history — hygiène pré-live : NO exclusion, the client sees
            ALL their orders, just correctly labelled. awaiting_payment gets
            « En attente de paiement » + Finaliser → checkout ; expired gets a
            greyed « Commande expirée » (eat.track keys reused, coherent with
            the tracking page). Other states reuse the track status labels. */}
        {orders.length > 0 && (
          <div className="mt-3 overflow-hidden rounded-[20px] bg-white shadow-bolt-card">
            <p className="px-4 pb-1 pt-4 text-[15px] font-extrabold text-[#1a1a1a]">{t('ordersTitle')}</p>
            {orders.slice(0, 10).map((o) => {
              const badge = (() => {
                if (o.status === 'awaiting_payment')
                  return { label: tt('awaitingTitle'), cls: 'bg-[#FEF3C7] text-[#B45309]' }
                if (o.status === 'expired')
                  return { label: tt('expiredTitle'), cls: 'bg-[#F3F4F6] text-[#6B7280]' }
                if (o.status === 'delivered')
                  return { label: tt('statusDelivered'), cls: 'bg-[#DCFCE7] text-[#16A34A]' }
                if (o.status === 'cancelled')
                  return { label: tt('statusCancelled'), cls: 'bg-[#FEE2E2] text-[#DC2626]' }
                const key = o.status === 'preparing' ? 'statusPreparing'
                  : o.status === 'ready' ? 'statusReady'
                  : o.status === 'picked_up' ? 'statusPickedUp'
                  : 'statusReceived'
                return { label: tt(key), cls: 'bg-[#FFF3ED] text-[#F97316]' }
              })()
              const isExpired = o.status === 'expired'
              return (
                <div key={o.id} className={`flex items-center gap-3 border-b border-[#f8f8f8] px-4 py-3 last:border-0 ${isExpired ? 'opacity-60' : ''}`}>
                  <button
                    onClick={() => router.push(o.status === 'awaiting_payment' ? `/eat/checkout/${o.id}` : `/eat/track/${o.id}`)}
                    className="min-w-0 flex-1 text-left active:opacity-70"
                  >
                    <p className="truncate text-[14px] font-bold text-[#1a1a1a]">{o.restaurant?.name ?? '—'}</p>
                    <p className="mt-0.5 text-[11px] text-[#888]">
                      {o.createdAt ? new Date(o.createdAt).toLocaleDateString(locale, { day: 'numeric', month: 'short' }) : ''}
                      {' · '}{o.total.toFixed(2)} €
                    </p>
                    <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-bold ${badge.cls}`}>
                      {badge.label}
                    </span>
                  </button>
                  {o.status === 'awaiting_payment' ? (
                    <button
                      onClick={() => router.push(`/eat/checkout/${o.id}`)}
                      className="shrink-0 rounded-[20px] bg-[#F97316] px-3 py-1.5 text-[12px] font-bold text-white active:scale-95"
                    >
                      {tt('awaitingCta')}
                    </button>
                  ) : (
                    <ChevronRight size={16} className="shrink-0 text-[#ccc]" />
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* Notif toggle */}
        <div className="mt-3 flex items-center gap-3 rounded-2xl bg-white p-4 shadow-bolt-soft">
          <Bell size={20} className="text-[#F97316]" />
          <span className="text-[15px] font-semibold text-[#1a1a1a]">{t('pushNotifications')}</span>
          <button
            onClick={() => setNotif((v) => !v)}
            className={`ml-auto flex h-7 w-12 items-center rounded-full px-0.5 transition-colors ${notif ? 'justify-end bg-[#F97316]' : 'justify-start bg-[#ddd]'}`}
          >
            <span className="h-6 w-6 rounded-full bg-white shadow" />
          </button>
        </div>

        {/* Menu */}
        <div className="mt-3 overflow-hidden rounded-[20px] bg-white shadow-bolt-card">
          {MENU_ITEMS.map((item, idx) => {
            const Icon = item.icon
            return (
              <button
                key={item.key}
                onClick={() => (item.route ? router.push(item.route) : showToast(t('comingSoon')))}
                className={`flex w-full items-center gap-3.5 px-4 py-3.5 active:bg-[#fafafa] ${idx === MENU_ITEMS.length - 1 ? '' : 'border-b border-[#f8f8f8]'}`}
              >
                <span className="flex h-[38px] w-[38px] items-center justify-center rounded-xl" style={{ backgroundColor: item.color + '18' }}>
                  <Icon size={18} style={{ color: item.color }} />
                </span>
                <span className="text-[15px] font-semibold text-[#1a1a1a]">{item.label}</span>
                <ChevronRight size={16} className="ml-auto text-[#ccc]" />
              </button>
            )
          })}
        </div>

        {/* Language */}
        <div className="mt-3 overflow-hidden rounded-[20px] bg-white shadow-bolt-card">
          <div className="flex items-center gap-3.5 px-4 py-3.5">
            <span
              className="flex h-[38px] w-[38px] items-center justify-center rounded-xl"
              style={{ backgroundColor: '#3B82F618' }}
            >
              <Globe size={18} style={{ color: '#3B82F6' }} />
            </span>
            <span className="text-[15px] font-semibold text-[#1a1a1a]">Langue</span>
            <div className="ml-auto">
              <LanguageSwitcher variant="full" />
            </div>
          </div>
        </div>

        {/* Logout */}
        <button
          onClick={() => signOut({ callbackUrl: '/eat/auth' })}
          className="mt-3 flex w-full items-center justify-center gap-2.5 rounded-2xl border-[1.5px] border-[#FEE2E2] bg-white py-4 active:scale-[0.99]"
        >
          <LogOut size={18} className="text-[#EF4444]" />
          <span className="text-[15px] font-bold text-[#EF4444]">{t('logout')}</span>
        </button>

        <p className="mt-5 text-center text-xs text-[#ccc]">Grubano v1.0.0</p>
      </div>
    </div>
  )
}
