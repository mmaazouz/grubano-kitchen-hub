import { createFileRoute } from "@tanstack/react-router";
import { FeaturePage, Card, SectionTitle } from "@/components/FeaturePage";
import { Search, Mail, Shield, EyeOff, Send } from "lucide-react";

export const Route = createFileRoute("/customers")({
  component: CustomersPage,
  head: () => ({ meta: [{ title: "Grubano — Clients" }] }),
});

const customers = [
  { name: "Sarah K.", orders: 12, favorite: "Gnocchi truffe", risk: false, last: "2j", allergy: "Gluten" },
  { name: "Tom B.", orders: 8, favorite: "Butter chicken", risk: false, last: "5j", allergy: null },
  { name: "Léa M.", orders: 21, favorite: "Pasta carbonara", risk: true, last: "17j", allergy: "Lactose" },
  { name: "Karim Z.", orders: 4, favorite: "Rollix saumon", risk: false, last: "1j", allergy: null },
  { name: "Inès D.", orders: 31, favorite: "Gnocchi truffe", risk: true, last: "22j", allergy: "Fruits à coque" },
];

function CustomersPage() {
  return (
    <FeaturePage title="Clients" subtitle="Vos clients chez vous" badge="892 actifs">
      <Card className="!p-3 border-primary/30 bg-accent">
        <div className="flex items-start gap-2.5">
          <Shield size={16} className="mt-0.5 shrink-0 text-primary" />
          <div className="text-[11px] leading-relaxed">
            <p className="font-bold text-foreground">Confidentialité Grubano</p>
            <p className="text-muted-foreground">Vous voyez vos clients chez vous. Contact & données cross-restaurants gérés par Grubano.</p>
          </div>
        </div>
      </Card>

      <Card className="!p-3 mt-3">
        <div className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2">
          <Search size={14} className="text-muted-foreground" />
          <input placeholder="Rechercher par nom" className="flex-1 bg-transparent text-sm outline-none" />
        </div>
      </Card>

      <div className="mt-3 grid grid-cols-3 gap-2">
        {[
          { l: "Actifs", v: "892" },
          { l: "À risque", v: "187", tone: "warning" },
          { l: "Perdus", v: "168", tone: "destructive" },
        ].map((s) => (
          <Card key={s.l} className="!p-3 text-center">
            <p className={`text-lg font-bold ${s.tone === "warning" ? "text-warning" : s.tone === "destructive" ? "text-destructive" : "text-foreground"}`}>{s.v}</p>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{s.l}</p>
          </Card>
        ))}
      </div>

      <SectionTitle hint="Votre restaurant uniquement">Profils</SectionTitle>
      <div className="space-y-2">
        {customers.map((c) => (
          <Card key={c.name} className="!p-3">
            <div className="flex items-center gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-full bg-navy text-sm font-bold text-navy-foreground">
                {c.name.charAt(0)}
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold">{c.name}</p>
                  {c.risk && <span className="rounded-full bg-destructive/15 px-1.5 py-0.5 text-[9px] font-bold uppercase text-destructive">À risque</span>}
                  {c.allergy && <span className="rounded-full bg-warning/15 px-1.5 py-0.5 text-[9px] font-bold uppercase text-warning">{c.allergy}</span>}
                </div>
                <p className="text-[11px] text-muted-foreground">{c.orders} commandes · Préf: {c.favorite} · vu il y a {c.last}</p>
              </div>
              {c.risk && (
                <button className="grid h-9 w-9 place-items-center rounded-lg bg-primary text-primary-foreground" title="Envoyer offre via Grubano">
                  <Send size={14} />
                </button>
              )}
            </div>
          </Card>
        ))}
      </div>

      <SectionTitle>Ce qui reste privé</SectionTitle>
      <Card className="!p-3">
        <ul className="space-y-1.5 text-[11px] text-muted-foreground">
          {[
            "Email & téléphone (gérés par Grubano)",
            "Commandes dans d'autres restaurants",
            "Score profil cross-restaurants",
            "Contact direct hors plateforme",
          ].map((t) => (
            <li key={t} className="flex items-start gap-2"><EyeOff size={11} className="mt-0.5 shrink-0" /> {t}</li>
          ))}
        </ul>
        <button className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl border border-border py-2 text-[11px] font-semibold">
          <Mail size={12} /> Envoyer une offre via Grubano
        </button>
      </Card>
    </FeaturePage>
  );
}
