import Link from 'next/link'
import {
  BarChart3, Building2, ShoppingBag, Receipt, Globe, Bell,
  HelpCircle, LogOut, ChevronRight, User,
} from 'lucide-react'
import VatNumberForm from '@/components/fiscal/VatNumberForm'
import Dac7FiscalForm from '@/components/fiscal/Dac7FiscalForm'

const sections = [
  {
    title: 'Business',
    items: [
      { icon: BarChart3,   label: 'Finance & trésorerie', href: '/finance'    },
      { icon: Building2,   label: 'Franchise multi-sites', href: '/franchise'  },
      { icon: ShoppingBag, label: 'Marketplace',           href: '/marketplace'},
      { icon: Receipt,     label: 'Tarification IA',       href: '/pricing'    },
    ],
  },
  {
    title: 'Compte',
    items: [
      { icon: User,        label: 'Profil opérateur',  href: '#'             },
      { icon: Bell,        label: 'Notifications',     href: '/notifications' },
      { icon: Globe,       label: 'Langue & région',   href: '#'             },
    ],
  },
  {
    title: 'Aide',
    items: [
      { icon: HelpCircle,  label: 'Centre d\'aide',   href: '#' },
      { icon: LogOut,      label: 'Se déconnecter',   href: '#' },
    ],
  },
]

export default function MorePage() {
  return (
    <div className="px-5 pb-8 pt-4 max-w-lg mx-auto md:max-w-3xl">
      <h1 className="mb-1 text-2xl font-display font-bold tracking-tight">Plus</h1>
      <p className="mb-5 text-sm text-muted-foreground">Mohammed · Opérateur Grubano</p>

      {sections.map((section) => (
        <div key={section.title} className="mb-5">
          <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            {section.title}
          </p>
          <div className="overflow-hidden rounded-2xl border border-border bg-card divide-y divide-border">
            {section.items.map((item) => (
              <Link key={item.label} href={item.href}
                className="flex items-center gap-3 px-4 py-3 transition hover:bg-muted/30">
                <div className="grid h-8 w-8 place-items-center rounded-lg bg-muted">
                  <item.icon size={14} className="text-foreground" />
                </div>
                <span className="flex-1 text-sm font-medium">{item.label}</span>
                <ChevronRight size={14} className="text-muted-foreground" />
              </Link>
            ))}
          </div>
        </div>
      ))}

      {/* P4.4-A — partner VAT number for Grubano commission invoices (owner-scoped). */}
      <VatNumberForm />

      {/* P4.4-C — partner DAC7 self-declaration (owner-scoped, money-neutral). */}
      <Dac7FiscalForm />
    </div>
  )
}
