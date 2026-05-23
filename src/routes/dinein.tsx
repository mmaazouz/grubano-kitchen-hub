import { createFileRoute } from "@tanstack/react-router";
import { FeaturePage, Card, SectionTitle } from "@/components/FeaturePage";
import { QrCode, Flame, Languages, Receipt, Split, Apple, CreditCard, Check } from "lucide-react";
import { useState } from "react";

export const Route = createFileRoute("/dinein")({
  component: DineInPage,
  head: () => ({ meta: [{ title: "Grubano — Sur place" }] }),
});

const dishes = [
  { name: "Gnocchi truffe", price: 14.5, popular: true, allergens: "Gluten, Lactose", sold: false },
  { name: "Butter chicken bowl", price: 12.0, popular: true, allergens: "Lactose", sold: false },
  { name: "Pasta carbonara", price: 11.5, popular: false, allergens: "Gluten, Œuf", sold: true },
  { name: "Rollix saumon", price: 13.0, popular: false, allergens: "Poisson, Sésame", sold: false },
];

const languages = ["FR", "EN", "AR", "ES"];

function DineInPage() {
  const [lang, setLang] = useState("FR");
  const [splitMode, setSplitMode] = useState<"full" | "share" | "equal">("full");
  const subtotal = 38.5;

  return (
    <FeaturePage title="Sur place" subtitle="QR menu & paiement à table" badge="Table 4">
      <Card className="!p-3">
        <div className="flex items-center gap-3">
          <div className="grid h-14 w-14 place-items-center rounded-xl bg-navy text-navy-foreground"><QrCode size={28} /></div>
          <div className="flex-1">
            <p className="text-sm font-bold">QR table générés</p>
            <p className="text-[11px] text-muted-foreground">6 tables · scan pour menu & paiement</p>
          </div>
          <button className="rounded-lg border border-border px-2.5 py-1.5 text-[11px] font-semibold">Imprimer</button>
        </div>
      </Card>

      <SectionTitle hint="Sync temps réel">Menu digital</SectionTitle>
      <Card className="!p-3">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-1 rounded-lg bg-muted p-1">
            <Languages size={12} className="ml-1 text-muted-foreground" />
            {languages.map((l) => (
              <button
                key={l}
                onClick={() => setLang(l)}
                className={`rounded-md px-2 py-0.5 text-[10px] font-bold ${lang === l ? "bg-card shadow" : "text-muted-foreground"}`}
              >
                {l}
              </button>
            ))}
          </div>
          <span className="text-[10px] text-muted-foreground">{dishes.filter((d) => !d.sold).length} dispo</span>
        </div>
        <div className="space-y-2">
          {dishes.map((d) => (
            <div key={d.name} className={`flex items-center gap-3 rounded-xl border border-border p-2.5 ${d.sold ? "opacity-50" : ""}`}>
              <div className="grid h-10 w-10 place-items-center rounded-lg bg-accent text-primary">
                <span className="text-[10px] font-bold">€{d.price}</span>
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-1.5">
                  <p className="text-sm font-semibold">{d.name}</p>
                  {d.popular && <span className="inline-flex items-center gap-0.5 rounded-full bg-primary/15 px-1.5 py-0.5 text-[9px] font-bold text-primary"><Flame size={9} /> Top</span>}
                </div>
                <p className="text-[10px] text-muted-foreground">{d.allergens}</p>
              </div>
              <label className="flex cursor-pointer items-center gap-1.5 text-[10px] font-semibold text-muted-foreground">
                <input type="checkbox" defaultChecked={d.sold} className="accent-destructive" />
                Épuisé
              </label>
            </div>
          ))}
        </div>
      </Card>

      <SectionTitle hint="Aperçu client">Paiement à table</SectionTitle>
      <Card>
        <div className="flex items-center gap-2">
          <Receipt size={14} className="text-primary" />
          <p className="text-sm font-bold">Addition · Table 4</p>
        </div>
        <div className="mt-3 space-y-1 text-sm">
          <div className="flex justify-between"><span>Gnocchi truffe ×1</span><span>€14.50</span></div>
          <div className="flex justify-between"><span>Butter chicken ×2</span><span>€24.00</span></div>
          <div className="mt-2 flex justify-between border-t border-border pt-2 font-bold"><span>Total</span><span>€{subtotal}</span></div>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-1.5">
          {([
            ["full", "Tout payer"],
            ["share", "Ma part"],
            ["equal", <><Split size={11} /> Diviser</>],
          ] as const).map(([k, l]) => (
            <button
              key={k as string}
              onClick={() => setSplitMode(k as typeof splitMode)}
              className={`flex items-center justify-center gap-1 rounded-xl py-2 text-[11px] font-semibold transition ${
                splitMode === k ? "bg-navy text-navy-foreground" : "border border-border text-muted-foreground"
              }`}
            >
              {l}
            </button>
          ))}
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <button className="flex items-center justify-center gap-1.5 rounded-xl bg-foreground py-3 text-sm font-semibold text-background">
            <Apple size={15} /> Pay
          </button>
          <button className="flex items-center justify-center gap-1.5 rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground">
            <CreditCard size={15} /> Carte
          </button>
        </div>

        <p className="mt-3 inline-flex items-center gap-1 text-[10px] text-success">
          <Check size={11} /> Reçu auto envoyé par email
        </p>
      </Card>
    </FeaturePage>
  );
}
