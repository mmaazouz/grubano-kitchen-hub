import { createFileRoute } from "@tanstack/react-router";
import { FeaturePage, Card } from "@/components/FeaturePage";

export const Route = createFileRoute("/prep")({
  component: PrepPage,
  head: () => ({ meta: [{ title: "Grubano — Prep Station" }] }),
});

const tickets = [
  { id: "#UE-8421", items: ["2× Gnocchi pesto", "1× Tiramisu"], sauce: "Pesto 250 ml", elapsed: 4, status: "prep" },
  { id: "#DR-9183", items: ["3× Chicken roll", "1× Fries"], sauce: "Soy-ginger 150 ml", elapsed: 9, status: "prep" },
  { id: "#JE-4421", items: ["1× Carbonara", "1× Bolognaise"], sauce: "Carbo 300 ml", elapsed: 14, status: "ready" },
];

function PrepPage() {
  return (
    <FeaturePage title="Prep Station" subtitle="Kitchen view · no distractions" badge="3 tickets">
      <div className="space-y-3">
        {tickets.map((t) => {
          const tone = t.elapsed < 6 ? "success" : t.elapsed < 12 ? "warning" : "destructive";
          return (
            <Card key={t.id} className={`!p-4 !border-2 ${tone === "success" ? "!border-success/40" : tone === "warning" ? "!border-warning/50" : "!border-destructive/40"}`}>
              <div className="flex items-center justify-between">
                <p className="text-lg font-bold">{t.id}</p>
                <span className={`rounded-lg px-2.5 py-1 text-sm font-bold ${tone === "success" ? "bg-success/15 text-success" : tone === "warning" ? "bg-warning/20 text-warning" : "bg-destructive/15 text-destructive"}`}>
                  {t.elapsed} min
                </span>
              </div>
              <ul className="mt-2 space-y-1">
                {t.items.map((i) => (
                  <li key={i} className="text-base">{i}</li>
                ))}
              </ul>
              <p className="mt-2 inline-block rounded-md bg-accent px-2 py-1 text-[11px] font-semibold text-primary">Sauce: {t.sauce}</p>
              <div className="mt-3 grid grid-cols-3 gap-2">
                <button className={`rounded-lg py-2.5 text-xs font-bold ${t.status === "prep" ? "bg-navy text-navy-foreground" : "bg-muted text-muted-foreground"}`}>Start</button>
                <button className={`rounded-lg py-2.5 text-xs font-bold ${t.status === "ready" ? "bg-success text-success-foreground" : "bg-muted text-muted-foreground"}`}>Ready</button>
                <button className="rounded-lg bg-primary py-2.5 text-xs font-bold text-primary-foreground">Handed</button>
              </div>
            </Card>
          );
        })}
      </div>
    </FeaturePage>
  );
}
