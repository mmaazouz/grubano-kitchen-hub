import { createFileRoute } from "@tanstack/react-router";
import { FeaturePage, Card, SectionTitle } from "@/components/FeaturePage";
import { AlertTriangle } from "lucide-react";

export const Route = createFileRoute("/cashflow")({
  component: CashflowPage,
  head: () => ({ meta: [{ title: "Grubano — Cash Flow" }] }),
});

const payouts = [
  { p: "UberEats", d: "Mon 24 Nov", a: 4820, in: "5d" },
  { p: "Deliveroo", d: "Wed 26 Nov", a: 3210, in: "7d" },
  { p: "Just Eat", d: "Fri 28 Nov", a: 1840, in: "9d" },
  { p: "UberEats", d: "Mon 1 Dec", a: 5120, in: "12d" },
];

function CashflowPage() {
  return (
    <FeaturePage title="Cash Flow" subtitle="Payout calendar" badge="€14.9k incoming">
      <Card className="!border-destructive/30 !bg-destructive/5">
        <div className="flex items-start gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-destructive text-destructive-foreground"><AlertTriangle size={15} /></div>
          <div className="flex-1">
            <p className="text-sm font-bold">Low cash period in 5 days</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">Suppliers due €2.1k Thursday, next payout Monday. Consider invoice advance.</p>
          </div>
        </div>
      </Card>

      <SectionTitle>Upcoming payouts</SectionTitle>
      <div className="space-y-2">
        {payouts.map((p, i) => (
          <Card key={i} className="flex items-center justify-between !p-3">
            <div>
              <p className="text-sm font-semibold">{p.p}</p>
              <p className="text-[11px] text-muted-foreground">{p.d} · in {p.in}</p>
            </div>
            <p className="text-base font-bold text-success">€{p.a.toLocaleString()}</p>
          </Card>
        ))}
      </div>

      <SectionTitle>This week vs next</SectionTitle>
      <div className="grid grid-cols-2 gap-2">
        <Card className="!p-3">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">This week</p>
          <p className="mt-1 text-xl font-bold">€8,030</p>
        </Card>
        <Card className="!p-3">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Next week</p>
          <p className="mt-1 text-xl font-bold">€6,960</p>
        </Card>
      </div>
    </FeaturePage>
  );
}
