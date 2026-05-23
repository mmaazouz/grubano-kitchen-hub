import { createFileRoute } from "@tanstack/react-router";
import { FeaturePage, Card, SectionTitle } from "@/components/FeaturePage";
import { Search, Mail } from "lucide-react";

export const Route = createFileRoute("/customers")({
  component: CustomersPage,
  head: () => ({ meta: [{ title: "Grubano — Customers" }] }),
});

const customers = [
  { name: "Sarah K.", orders: 12, spent: 184, tier: "Silver", risk: false, last: "2d" },
  { name: "Tom B.", orders: 8, spent: 122, tier: "Bronze", risk: false, last: "5d" },
  { name: "Léa M.", orders: 21, spent: 412, tier: "Gold", risk: true, last: "17d" },
  { name: "Karim Z.", orders: 4, spent: 58, tier: "Bronze", risk: false, last: "1d" },
  { name: "Inès D.", orders: 31, spent: 619, tier: "Platine", risk: true, last: "22d" },
];

function CustomersPage() {
  return (
    <FeaturePage title="Customers" subtitle="Owned profiles via QR" badge="1,247 total">
      <Card className="!p-3">
        <div className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2">
          <Search size={14} className="text-muted-foreground" />
          <input placeholder="Search by name or email" className="flex-1 bg-transparent text-sm outline-none" />
        </div>
      </Card>

      <div className="mt-3 grid grid-cols-3 gap-2">
        {[
          { l: "Active", v: "892" },
          { l: "At-risk", v: "187", tone: "warning" },
          { l: "Lost", v: "168", tone: "destructive" },
        ].map((s) => (
          <Card key={s.l} className="!p-3 text-center">
            <p className={`text-lg font-bold ${s.tone === "warning" ? "text-warning" : s.tone === "destructive" ? "text-destructive" : "text-foreground"}`}>{s.v}</p>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{s.l}</p>
          </Card>
        ))}
      </div>

      <SectionTitle hint="Cross-brand history">Recent profiles</SectionTitle>
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
                  {c.risk && <span className="rounded-full bg-destructive/15 px-1.5 py-0.5 text-[9px] font-bold uppercase text-destructive">At-risk</span>}
                </div>
                <p className="text-[11px] text-muted-foreground">{c.orders} orders · €{c.spent} · {c.tier} · last {c.last}</p>
              </div>
              {c.risk && (
                <button className="grid h-9 w-9 place-items-center rounded-lg bg-primary text-primary-foreground"><Mail size={14} /></button>
              )}
            </div>
          </Card>
        ))}
      </div>
    </FeaturePage>
  );
}
