import { createFileRoute } from "@tanstack/react-router";
import { FeaturePage, Card, SectionTitle } from "@/components/FeaturePage";
import { Download } from "lucide-react";

export const Route = createFileRoute("/finance")({
  component: FinancePage,
  head: () => ({ meta: [{ title: "Grubano — Revenue Split" }] }),
});

const rows = [
  { l: "Gross revenue", v: 2847, tone: "" },
  { l: "Platform commission", v: -682, tone: "destructive" },
  { l: "Packaging", v: -84, tone: "destructive" },
  { l: "Ingredient cost (28%)", v: -797, tone: "destructive" },
];

function FinancePage() {
  const net = rows.reduce((a, r) => a + r.v, 0);
  return (
    <FeaturePage title="Revenue Split" subtitle="Today · all brands" badge="Net €1,284">
      <Card>
        <div className="space-y-3">
          {rows.map((r) => (
            <div key={r.l} className="flex items-center justify-between border-b border-border pb-2 last:border-0 last:pb-0">
              <span className="text-sm text-muted-foreground">{r.l}</span>
              <span className={`text-base font-bold ${r.tone === "destructive" ? "text-destructive" : "text-foreground"}`}>
                {r.v < 0 ? "−" : ""}€{Math.abs(r.v).toLocaleString()}
              </span>
            </div>
          ))}
        </div>
        <div className="mt-4 flex items-center justify-between rounded-xl bg-navy px-4 py-3 text-navy-foreground">
          <span className="text-sm font-semibold">Net margin</span>
          <span className="text-xl font-bold text-primary">€{net.toLocaleString()}</span>
        </div>
      </Card>

      <SectionTitle>By brand</SectionTitle>
      <div className="space-y-2">
        {[
          { n: "Gnocchi Bar", m: 412 },
          { n: "Pasta Fresca", m: 348 },
          { n: "Riz Gourmand", m: 287 },
          { n: "Rollix", m: 237 },
        ].map((b) => (
          <Card key={b.n} className="flex items-center justify-between !p-3">
            <span className="text-sm font-semibold">{b.n}</span>
            <span className="text-base font-bold text-success">€{b.m}</span>
          </Card>
        ))}
      </div>

      <button className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground">
        <Download size={15} /> Export PDF for accountant
      </button>
    </FeaturePage>
  );
}
