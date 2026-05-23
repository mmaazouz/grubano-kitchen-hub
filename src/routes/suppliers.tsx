import { createFileRoute } from "@tanstack/react-router";
import { FeaturePage, Card, SectionTitle } from "@/components/FeaturePage";
import { Send, Check } from "lucide-react";

export const Route = createFileRoute("/suppliers")({
  component: SuppliersPage,
  head: () => ({ meta: [{ title: "Grubano — Suppliers" }] }),
});

function SuppliersPage() {
  return (
    <FeaturePage title="Suppliers" subtitle="Order via WhatsApp" badge="€2.1k this month">
      <SectionTitle hint="Pre-filled from forecast">Tomorrow's order</SectionTitle>
      <Card>
        <p className="text-[11px] text-muted-foreground">Frais Direct · Marc</p>
        <ul className="mt-2 space-y-1.5 text-sm">
          {[
            ["Tomato sauce base", "4 × 5 L"],
            ["Mozzarella di bufala", "3 kg"],
            ["Basil fresh", "500 g"],
            ["Penne rigate", "10 kg"],
          ].map(([n, q]) => (
            <li key={n} className="flex justify-between"><span>{n}</span><span className="font-semibold">{q}</span></li>
          ))}
        </ul>
        <button className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-success py-2.5 text-sm font-semibold text-success-foreground">
          <Send size={15} /> Send to WhatsApp
        </button>
      </Card>

      <SectionTitle>Recent deliveries</SectionTitle>
      <div className="space-y-2">
        {[
          { s: "Frais Direct", d: "Today 06:12", amt: 187, ok: true },
          { s: "Halal Premium", d: "Yesterday 07:40", amt: 412, ok: true },
          { s: "Sushi Wholesale", d: "Mon 06:00", amt: 156, ok: true },
        ].map((d) => (
          <Card key={d.s} className="flex items-center justify-between !p-3">
            <div>
              <p className="text-sm font-semibold">{d.s}</p>
              <p className="text-[11px] text-muted-foreground">{d.d}</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold">€{d.amt}</span>
              {d.ok && <Check size={16} className="text-success" />}
            </div>
          </Card>
        ))}
      </div>

      <SectionTitle>Monthly spend</SectionTitle>
      <Card>
        <p className="text-2xl font-bold">€2,148</p>
        <p className="text-[11px] text-muted-foreground">vs €1,920 last month · +12%</p>
      </Card>
    </FeaturePage>
  );
}
