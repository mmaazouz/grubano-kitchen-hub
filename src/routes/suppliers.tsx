import { createFileRoute, Link } from "@tanstack/react-router";
import { FeaturePage, Card, SectionTitle } from "@/components/FeaturePage";
import { Truck, Check, Clock, ShoppingBasket, FileDown, Star, ChevronRight, Minus, Plus, Share2 } from "lucide-react";
import { useState } from "react";

export const Route = createFileRoute("/suppliers")({
  component: SuppliersPage,
  head: () => ({ meta: [{ title: "Grubano — Fournisseurs" }] }),
});

const partners = [
  { name: "Frais Direct", specialty: "Légumes & viandes", zone: "Paris 75011", lead: "24h", min: 80, rating: 4.8, api: true },
  { name: "Halal Premium", specialty: "Volaille halal", zone: "Île-de-France", lead: "48h", min: 150, rating: 4.9, api: false },
  { name: "Sushi Wholesale", specialty: "Poissons & riz", zone: "Paris 75002", lead: "24h", min: 100, rating: 4.7, api: true },
  { name: "Pasta & Co", specialty: "Pâtes fraîches", zone: "Paris 75010", lead: "48h", min: 60, rating: 4.6, api: false },
];

const suggested = [
  { name: "Poulet mariné", qty: 4, unit: "kg", price: 8.5 },
  { name: "Sauce butter chicken", qty: 3, unit: "L", price: 6.1 },
  { name: "Champignons", qty: 2, unit: "kg", price: 6.8 },
];

function SuppliersPage() {
  const [mode, setMode] = useState<"choice" | "partner" | "self">("choice");
  const [supplier, setSupplier] = useState<typeof partners[number] | null>(null);

  if (mode === "choice") {
    return (
      <FeaturePage title="Commander" subtitle="Comment souhaitez-vous restocker ?">
        <button onClick={() => setMode("partner")} className="mb-3 w-full overflow-hidden rounded-2xl border border-border bg-card p-4 text-left active:scale-[0.99] transition">
          <div className="flex items-center gap-3">
            <div className="grid h-12 w-12 place-items-center rounded-xl bg-primary text-primary-foreground"><Truck size={20} /></div>
            <div className="flex-1">
              <p className="text-base font-bold">Fournisseurs partenaires</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">4 fournisseurs vérifiés près de chez vous</p>
            </div>
            <ChevronRight size={16} className="text-muted-foreground" />
          </div>
        </button>

        <button onClick={() => setMode("self")} className="w-full overflow-hidden rounded-2xl border border-border bg-card p-4 text-left active:scale-[0.99] transition">
          <div className="flex items-center gap-3">
            <div className="grid h-12 w-12 place-items-center rounded-xl bg-navy text-navy-foreground"><ShoppingBasket size={20} /></div>
            <div className="flex-1">
              <p className="text-base font-bold">Je m'en occupe</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">Liste de courses imprimable / WhatsApp</p>
            </div>
            <ChevronRight size={16} className="text-muted-foreground" />
          </div>
        </button>

        <SectionTitle hint="Suggéré par l'IA">À commander</SectionTitle>
        <Card className="!p-3">
          <ul className="space-y-2">
            {suggested.map((s) => (
              <li key={s.name} className="flex items-center justify-between text-[12px]">
                <span className="font-semibold">{s.name}</span>
                <span className="text-muted-foreground">{s.qty} {s.unit}</span>
              </li>
            ))}
          </ul>
        </Card>
      </FeaturePage>
    );
  }

  if (mode === "partner" && !supplier) {
    return (
      <FeaturePage title="Fournisseurs" subtitle="Sélectionnez un partenaire" badge="4 vérifiés">
        <button onClick={() => setMode("choice")} className="mb-3 text-[11px] font-semibold text-muted-foreground">← Changer de méthode</button>
        <div className="space-y-2">
          {partners.map((p) => (
            <button key={p.name} onClick={() => setSupplier(p)} className="w-full rounded-2xl border border-border bg-card p-3.5 text-left active:scale-[0.99] transition">
              <div className="flex items-start gap-3">
                <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-accent text-primary font-bold">
                  {p.name[0]}
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-bold">{p.name}</p>
                    {p.api && <span className="rounded-full bg-success/15 px-1.5 py-0.5 text-[9px] font-bold text-success">API</span>}
                  </div>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">{p.specialty} · {p.zone}</p>
                  <div className="mt-2 flex items-center gap-3 text-[10px] text-muted-foreground">
                    <span className="inline-flex items-center gap-1"><Clock size={10} /> {p.lead}</span>
                    <span>Min €{p.min}</span>
                    <span className="inline-flex items-center gap-1"><Star size={10} className="text-warning" /> {p.rating}</span>
                  </div>
                </div>
                <ChevronRight size={14} className="text-muted-foreground" />
              </div>
            </button>
          ))}
        </div>
      </FeaturePage>
    );
  }

  if (mode === "partner" && supplier) {
    return <PartnerOrderForm supplier={supplier} onBack={() => setSupplier(null)} />;
  }

  return <SelfShoppingList onBack={() => setMode("choice")} />;
}

function PartnerOrderForm({ supplier, onBack }: { supplier: typeof partners[number]; onBack: () => void }) {
  const [draft, setDraft] = useState<Record<string, number>>(
    Object.fromEntries(suggested.map((s) => [s.name, s.qty])),
  );
  const [sent, setSent] = useState(false);
  const total = suggested.reduce((s, i) => s + (draft[i.name] || 0) * i.price, 0);

  if (sent) {
    return (
      <FeaturePage title="Commande envoyée" subtitle={supplier.name}>
        <Card className="text-center !p-6">
          <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-success/15 text-success"><Check size={28} /></div>
          <h3 className="mt-3 text-base font-bold">Commande confirmée</h3>
          <p className="mt-1 text-[12px] text-muted-foreground">Livraison estimée jeudi 8h-12h</p>
          <p className="mt-3 text-2xl font-bold">€{total.toFixed(2)}</p>
          <Link to="/stocks" className="mt-4 inline-block w-full rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground">
            Retour aux stocks
          </Link>
        </Card>
      </FeaturePage>
    );
  }

  return (
    <FeaturePage title={supplier.name} subtitle={`${supplier.specialty} · livraison ${supplier.lead}`}>
      <button onClick={onBack} className="mb-3 text-[11px] font-semibold text-muted-foreground">← Autre fournisseur</button>
      <Card className="!p-0 overflow-hidden">
        <div className="border-b border-border bg-muted/30 px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          Bon de commande
        </div>
        <div className="divide-y divide-border">
          {suggested.map((i) => (
            <div key={i.name} className="flex items-center gap-3 px-4 py-3">
              <div className="flex-1">
                <p className="text-sm font-semibold">{i.name}</p>
                <p className="text-[11px] text-muted-foreground">€{i.price.toFixed(2)}/{i.unit}</p>
              </div>
              <div className="flex items-center gap-1.5">
                <button onClick={() => setDraft((s) => ({ ...s, [i.name]: Math.max(0, (s[i.name] || 0) - 1) }))} className="grid h-7 w-7 place-items-center rounded-lg border border-border"><Minus size={12} /></button>
                <span className="w-12 text-center text-sm font-bold">{draft[i.name] || 0} <span className="text-[9px] text-muted-foreground">{i.unit}</span></span>
                <button onClick={() => setDraft((s) => ({ ...s, [i.name]: (s[i.name] || 0) + 1 }))} className="grid h-7 w-7 place-items-center rounded-lg border border-border"><Plus size={12} /></button>
              </div>
            </div>
          ))}
        </div>
        <div className="border-t border-border bg-muted/20 p-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-[11px] uppercase tracking-wider text-muted-foreground">Total estimé</span>
            <span className="text-lg font-bold">€{total.toFixed(2)}</span>
          </div>
          <button onClick={() => setSent(true)} className="w-full rounded-xl bg-primary py-3 text-sm font-bold text-primary-foreground">
            Envoyer via {supplier.api ? "API" : "WhatsApp Business"}
          </button>
        </div>
      </Card>
    </FeaturePage>
  );
}

function SelfShoppingList({ onBack }: { onBack: () => void }) {
  const categories = {
    "Frais": ["Poulet mariné · 4 kg", "Champignons · 2 kg"],
    "Sauce": ["Sauce butter chicken · 3 L"],
    "Sec": ["Riz basmati · 5 kg"],
    "Packaging": ["Boîtes kraft · 100 u"],
  };
  return (
    <FeaturePage title="Liste de courses" subtitle="Triée par catégorie">
      <button onClick={onBack} className="mb-3 text-[11px] font-semibold text-muted-foreground">← Changer de méthode</button>
      <div className="space-y-3">
        {Object.entries(categories).map(([cat, items]) => (
          <Card key={cat} className="!p-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-primary">{cat}</p>
            <ul className="mt-2 space-y-1.5 text-[13px]">
              {items.map((i) => (
                <li key={i} className="flex items-center gap-2">
                  <div className="h-4 w-4 rounded border border-border" />
                  <span>{i}</span>
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <button className="flex items-center justify-center gap-2 rounded-xl bg-success py-3 text-sm font-bold text-success-foreground">
          <Share2 size={14} /> WhatsApp
        </button>
        <button className="flex items-center justify-center gap-2 rounded-xl border border-border bg-card py-3 text-sm font-bold">
          <FileDown size={14} /> Imprimer
        </button>
      </div>
      <Link to="/stocks" className="mt-3 block w-full rounded-xl bg-navy py-3 text-center text-sm font-bold text-navy-foreground">
        Après les courses : mettre à jour
      </Link>
    </FeaturePage>
  );
}
