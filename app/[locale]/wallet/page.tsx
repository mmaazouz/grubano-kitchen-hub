import { QrCode, MessageCircle, Share2, MapPin } from 'lucide-react'
import { Card } from '@/components/grubano/Card'
import { SectionTitle } from '@/components/grubano/SectionTitle'

export default function WalletPage() {
  return (
    <div className="px-5 pb-8 pt-4 max-w-lg mx-auto md:max-w-3xl">
      <h1 className="mb-1 text-2xl font-display font-bold tracking-tight">Wallet Client</h1>
      <p className="mb-5 text-sm text-muted-foreground">
        Aperçu PWA · ce que voit le client
        <span className="ml-2 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-bold text-primary">QR-based</span>
      </p>

      {/* Loyalty wallet card */}
      <Card className="!bg-navy !text-navy-foreground">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[11px] uppercase tracking-wider text-primary">Loyalty wallet</p>
            <p className="mt-1 text-2xl font-bold">487 pts</p>
            <p className="text-[11px] text-navy-foreground/60">Tier Silver · 113 pts jusqu&apos;à Gold</p>
          </div>
          <div className="grid h-16 w-16 place-items-center rounded-xl bg-white text-navy">
            <QrCode size={36} />
          </div>
        </div>
      </Card>

      <SectionTitle>Suivi commande en direct</SectionTitle>
      <Card>
        <div className="flex items-center gap-3">
          <MapPin size={16} className="text-primary" />
          <p className="text-sm font-semibold">Livreur à 4 min</p>
        </div>
        <div className="mt-3 flex gap-1.5">
          {['Reçue', 'En cuisine', 'En route', 'Livrée'].map((s, i) => (
            <div key={s} className="flex-1">
              <div className={`h-1.5 rounded-full ${i <= 2 ? 'bg-primary' : 'bg-muted'}`} />
              <p className="mt-1 text-center text-[9px] font-semibold text-muted-foreground">{s}</p>
            </div>
          ))}
        </div>
      </Card>

      <SectionTitle>Chat avec la cuisine</SectionTitle>
      <Card>
        <div className="space-y-2">
          <div className="ml-auto max-w-[80%] rounded-2xl rounded-tr-sm bg-primary px-3 py-2 text-[12px] text-primary-foreground">
            Plus de sauce s&apos;il vous plaît 🙏
          </div>
          <div className="max-w-[80%] rounded-2xl rounded-tl-sm bg-muted px-3 py-2 text-[12px]">
            C&apos;est noté ! On ajoute du pesto en plus.
          </div>
        </div>
        <div className="mt-3 flex gap-2">
          <input
            className="flex-1 rounded-lg bg-muted px-3 py-2 text-sm outline-none"
            placeholder="Message…"
            readOnly
          />
          <button className="grid h-9 w-9 place-items-center rounded-lg bg-primary text-primary-foreground">
            <MessageCircle size={15} />
          </button>
        </div>
      </Card>

      <SectionTitle>Parrainer un ami</SectionTitle>
      <Card className="flex items-center justify-between !p-3">
        <div>
          <p className="text-sm font-semibold">grubano.app/r/sarah</p>
          <p className="text-[11px] text-muted-foreground">+100 pts par inscription</p>
        </div>
        <button className="grid h-9 w-9 place-items-center rounded-lg bg-primary text-primary-foreground">
          <Share2 size={15} />
        </button>
      </Card>
    </div>
  )
}
