import { createFileRoute } from "@tanstack/react-router";
import { FeaturePage, Card, SectionTitle } from "@/components/FeaturePage";
import { TrendingUp, Zap } from "lucide-react";

export const Route = createFileRoute("/pricing")({
  component: PricingPage,
  head: () => ({ meta: [{ title: "Grubano — Smart Pricing" }] }),
});

const items = [
  { n: "Gnocchi pesto", c: 9.5, r: 10.9 },
  { n: "Butter chicken bowl", c: 12.0, r: 13.5 },
  { n: "Chicken roll", c: 7.5, r: 7.9 },
  { n: "Tiramisu", c: 4.5, r: 4.9 },
];

function PricingPage() {
  return (
    <FeaturePage title="Smart Pricing" subtitle="Match-based surge" badge="+€312 today">
      <Card className="!bg-navy !text-navy-foreground">
        <div className="flex items-start gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-primary text-primary-foreground"><Zap size={18} /></div>
          <div className="flex-1">
            <p className="text-sm font-bold">Surge opportunity</p>
            <p className="mt-1 text-[12px] text-navy-foreground/70">Football match 21h + rain. Raise Gnocchi Bar prices by +15% across all platforms?</p>
          </div>
        </div>
        <button className="mt-3 w-full rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground">
          Apply surge (auto-revert at 23h)
        </button>
      </Card>

      <SectionTitle hint="Per item">Current vs recommended</SectionTitle>
      <div className="space-y-2">
        {items.map((i) => (
          <Card key={i.n} className="!p-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold">{i.n}</p>
                <p className="text-[11px] text-muted-foreground">Current €{i.c.toFixed(2)}</p>
              </div>
              <div className="text-right">
                <p className="inline-flex items-center gap-1 text-sm font-bold text-success">
                  <TrendingUp size={12} /> €{i.r.toFixed(2)}
                </p>
                <p className="text-[10px] text-muted-foreground">+€{(i.r - i.c).toFixed(2)} /unit</p>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </FeaturePage>
  );
}
