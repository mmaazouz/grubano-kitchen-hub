import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { Calculator, Package } from "lucide-react";
import { useState, useMemo } from "react";

export const Route = createFileRoute("/stocks")({
  component: StocksPage,
  head: () => ({ meta: [{ title: "Grubano — Stocks" }] }),
});

const journal = [
  { item: "Tomato sauce", qty: "3.2 L", dlc: "Today 22:00", status: "urgent" },
  { item: "Pesto verde", qty: "2.1 L", dlc: "Tomorrow", status: "soon" },
  { item: "Carbonara base", qty: "4.5 L", dlc: "In 3 days", status: "ok" },
  { item: "Soy-ginger", qty: "1.8 L", dlc: "In 4 days", status: "ok" },
  { item: "Mushroom cream", qty: "0.6 L", dlc: "Today 18:00", status: "urgent" },
  { item: "Spicy mayo", qty: "2.3 L", dlc: "In 5 days", status: "ok" },
];

function StocksPage() {
  const [orders, setOrders] = useState(180);
  const liters = useMemo(() => (orders * 0.045).toFixed(2), [orders]);

  return (
    <AppShell operator="Mohammed">
      <h1 className="mb-1 text-2xl font-bold tracking-tight">Stocks</h1>
      <p className="mb-5 text-sm text-muted-foreground">Sauce planning & freshness</p>

      <section className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="flex items-center gap-2 border-b border-border bg-muted/30 px-4 py-3">
          <Calculator size={15} className="text-primary" />
          <h2 className="text-sm font-bold">Daily sauce calculator</h2>
        </div>
        <div className="p-4">
          <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Expected orders
          </label>
          <div className="mt-2 flex items-center gap-3">
            <button
              onClick={() => setOrders((o) => Math.max(0, o - 10))}
              className="grid h-10 w-10 place-items-center rounded-xl border border-border bg-background text-lg font-bold hover:bg-accent"
            >−</button>
            <input
              type="number"
              value={orders}
              onChange={(e) => setOrders(Number(e.target.value) || 0)}
              className="flex-1 rounded-xl border border-border bg-background px-3 py-2.5 text-center text-lg font-bold focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
            <button
              onClick={() => setOrders((o) => o + 10)}
              className="grid h-10 w-10 place-items-center rounded-xl border border-border bg-background text-lg font-bold hover:bg-accent"
            >+</button>
          </div>

          <div className="mt-4 rounded-xl bg-navy p-4 text-navy-foreground">
            <p className="text-[10px] uppercase tracking-wider text-navy-foreground/60">Sauce to prepare</p>
            <p className="mt-1 text-3xl font-bold">{liters} <span className="text-base text-primary">L</span></p>
            <p className="mt-1 text-[11px] text-navy-foreground/70">≈ 45 ml per order · all brands</p>
          </div>
        </div>
      </section>

      <section className="mt-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-bold">Stock journal</h2>
          <span className="text-[11px] text-muted-foreground">{journal.length} items</span>
        </div>
        <div className="overflow-hidden rounded-2xl border border-border bg-card">
          <table className="w-full text-left text-xs">
            <thead className="bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 font-semibold">Item</th>
                <th className="px-2 py-2.5 font-semibold">Qty</th>
                <th className="px-2 py-2.5 font-semibold">DLC</th>
                <th className="px-3 py-2.5 font-semibold text-right">Status</th>
              </tr>
            </thead>
            <tbody>
              {journal.map((row, i) => (
                <tr key={row.item} className={i !== journal.length - 1 ? "border-b border-border" : ""}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="grid h-7 w-7 place-items-center rounded-lg bg-accent text-primary">
                        <Package size={12} />
                      </div>
                      <span className="font-semibold text-foreground">{row.item}</span>
                    </div>
                  </td>
                  <td className="px-2 py-3 font-medium text-foreground">{row.qty}</td>
                  <td className="px-2 py-3 text-muted-foreground">{row.dlc}</td>
                  <td className="px-3 py-3 text-right">
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                        row.status === "urgent"
                          ? "bg-destructive/10 text-destructive"
                          : row.status === "soon"
                          ? "bg-warning/20 text-warning-foreground"
                          : "bg-success/15 text-success"
                      }`}
                    >
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${
                          row.status === "urgent" ? "bg-destructive" : row.status === "soon" ? "bg-warning" : "bg-success"
                        }`}
                      />
                      {row.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </AppShell>
  );
}
