import { createFileRoute } from "@tanstack/react-router";
import { FeaturePage, Card, SectionTitle } from "@/components/FeaturePage";
import { Sun, Moon, FlaskConical } from "lucide-react";

export const Route = createFileRoute("/menu")({
  component: MenuPage,
  head: () => ({ meta: [{ title: "Grubano — Menu Sync" }] }),
});

const items = [
  { n: "Gnocchi pesto", p: 10.9, avail: true },
  { n: "Butter chicken", p: 13.5, avail: true },
  { n: "Tiramisu", p: 4.9, avail: false },
  { n: "Chicken roll", p: 7.9, avail: true },
];

function MenuPage() {
  return (
    <FeaturePage title="Menu Sync" subtitle="Push to all platforms" badge="4 platforms">
      <div className="grid grid-cols-2 gap-2">
        <Card className="flex items-center gap-2 !p-3">
          <Sun size={16} className="text-warning" /> <span className="text-xs font-semibold">Lunch menu</span>
        </Card>
        <Card className="flex items-center gap-2 !p-3">
          <Moon size={16} className="text-primary" /> <span className="text-xs font-semibold">Dinner menu</span>
        </Card>
      </div>

      <SectionTitle hint="Edit once, sync everywhere">Items</SectionTitle>
      <div className="space-y-2">
        {items.map((i) => (
          <Card key={i.n} className="flex items-center justify-between !p-3">
            <div>
              <p className="text-sm font-semibold">{i.n}</p>
              <p className="text-[11px] text-muted-foreground">€{i.p.toFixed(2)} · UberEats · Deliveroo · Just Eat</p>
            </div>
            <button className={`relative h-6 w-11 rounded-full transition ${i.avail ? "bg-success" : "bg-muted"}`}>
              <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition ${i.avail ? "left-5" : "left-0.5"}`} />
            </button>
          </Card>
        ))}
      </div>

      <SectionTitle>A/B test running</SectionTitle>
      <Card>
        <div className="flex items-start gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-accent text-primary"><FlaskConical size={16} /></div>
          <div className="flex-1">
            <p className="text-sm font-bold">Gnocchi pesto · description test</p>
            <p className="mt-1 text-[11px] text-muted-foreground">Variant B (+18% conversion) — "Hand-rolled gnocchi, fresh basil pesto"</p>
            <button className="mt-3 rounded-lg bg-primary px-3 py-1.5 text-[11px] font-semibold text-primary-foreground">Adopt variant B</button>
          </div>
        </div>
      </Card>
    </FeaturePage>
  );
}
