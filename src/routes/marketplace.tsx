import { createFileRoute } from "@tanstack/react-router";
import { FeaturePage, Card, SectionTitle } from "@/components/FeaturePage";
import { Sparkles } from "lucide-react";

export const Route = createFileRoute("/marketplace")({
  component: MarketplacePage,
  head: () => ({ meta: [{ title: "Grubano — Ghostos Market" }] }),
});

const brands = [
  { n: "Smashr", c: "Smash burgers", aov: 18, fee: 6, lic: "€199/mo" },
  { n: "Bowlistic", c: "Healthy bowls", aov: 14, fee: 7, lic: "€149/mo" },
  { n: "Sushi Express", c: "Premium sushi", aov: 32, fee: 8, lic: "€299/mo" },
];

function MarketplacePage() {
  return (
    <FeaturePage title="Ghostos Market" subtitle="Phase 2 preview" badge="Beta">
      <Card className="!bg-navy !text-navy-foreground">
        <div className="flex items-start gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-primary text-primary-foreground"><Sparkles size={18} /></div>
          <div className="flex-1">
            <p className="text-sm font-bold">List your brand for licensing</p>
            <p className="mt-1 text-[11px] text-navy-foreground/70">Earn royalties from other kitchens running your concept.</p>
          </div>
        </div>
        <button className="mt-3 w-full rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground">List Gnocchi Bar</button>
      </Card>

      <SectionTitle hint="Available to license">Browse brands</SectionTitle>
      <div className="space-y-3">
        {brands.map((b) => (
          <Card key={b.n} className="!p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-base font-bold">{b.n}</p>
                <p className="text-[11px] text-muted-foreground">{b.c}</p>
              </div>
              <span className="rounded-full bg-accent px-2.5 py-1 text-[10px] font-bold text-primary">{b.lic}</span>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
              <div className="rounded-lg bg-muted p-2">
                <p className="text-muted-foreground">Avg order</p>
                <p className="text-sm font-bold">€{b.aov}</p>
              </div>
              <div className="rounded-lg bg-muted p-2">
                <p className="text-muted-foreground">Royalty</p>
                <p className="text-sm font-bold">{b.fee}%</p>
              </div>
            </div>
            <button className="mt-3 w-full rounded-xl bg-primary py-2 text-xs font-semibold text-primary-foreground">Sign in 3 clicks</button>
          </Card>
        ))}
      </div>
    </FeaturePage>
  );
}
