import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { Calculator, Package, AlertTriangle, Send, FileDown, Mail, Plus, Minus, Check, Clock } from "lucide-react";
import { useState, useMemo } from "react";

export const Route = createFileRoute("/stocks")({
  component: StocksPage,
  head: () => ({ meta: [{ title: "Grubano — Stocks" }] }),
});

type Item = {
  name: string;
  qty: number;
  unit: string;
  min: number;
  dlc: string;
  price: number;
};

const inventory: Item[] = [
  { name: "Poulet mariné", qty: 2.1, unit: "kg", min: 5, dlc: "Demain", price: 8.5 },
  { name: "Sauce tomate", qty: 3.2, unit: "L", min: 4, dlc: "Aujourd'hui 22:00", price: 4.2 },
  { name: "Sauce butter chicken", qty: 0.4, unit: "L", min: 2, dlc: "Aujourd'hui 18:00", price: 6.1 },
  { name: "Mozzarella", qty: 1.8, unit: "kg", min: 2, dlc: "Dans 2 jours", price: 9.0 },
  { name: "Riz basmati", qty: 12, unit: "kg", min: 5, dlc: "Dans 14 jours", price: 2.3 },
  { name: "Pesto verde", qty: 2.1, unit: "L", min: 1, dlc: "Demain", price: 5.4 },
  { name: "Mayo épicée", qty: 2.3, unit: "L", min: 1, dlc: "Dans 5 jours", price: 3.1 },
  { name: "Champignons", qty: 0.6, unit: "kg", min: 1.5, dlc: "Demain", price: 6.8 },
];

function statusOf(i: Item): "ok" | "soon" | "urgent" {
  if (i.qty <= i.min * 0.4) return "urgent";
  if (i.qty < i.min) return "soon";
  return "ok";
}

const orderHistory = [
  { supplier: "Frais Direct", date: "Aujourd'hui 06:12", total: 187, status: "Confirmée" },
  { supplier: "Halal Premium", date: "Hier 07:40", total: 412, status: "Livrée" },
  { supplier: "Sushi Wholesale", date: "Lun 06:00", total: 156, status: "Livrée" },
];

function StocksPage() {
  const [tab, setTab] = useState<"inventory" | "orders">("inventory");
  const lowItems = inventory.filter((i) => statusOf(i) !== "ok");

  return (
    <AppShell operator="Mohammed">
      <h1 className="mb-1 text-2xl font-bold tracking-tight">Stocks</h1>
      <p className="mb-4 text-sm text-muted-foreground">Inventaire & commandes fournisseurs</p>

      {lowItems.length > 0 && (
        <div className="mb-4 flex items-start gap-3 rounded-2xl border border-destructive/30 bg-destructive/10 p-3.5">
          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-destructive text-destructive-foreground">
            <AlertTriangle size={15} />
          </div>
          <div className="flex-1">
            <p className="text-xs font-semibold text-foreground">{lowItems.length} ingrédients sous le seuil</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">Commande suggérée prête pour ce soir.</p>
          </div>
          <button onClick={() => setTab("orders")} className="rounded-lg bg-destructive px-2.5 py-1 text-[11px] font-semibold text-destructive-foreground">Commander</button>
        </div>
      )}

      <div className="mb-4 grid grid-cols-2 gap-1 rounded-2xl bg-muted p-1">
        {([["inventory", "Inventaire"], ["orders", "Commandes"]] as const).map(([k, l]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`rounded-xl py-2 text-xs font-semibold transition ${tab === k ? "bg-card text-foreground shadow" : "text-muted-foreground"}`}
          >
            {l}
          </button>
        ))}
      </div>

      {tab === "inventory" ? <InventoryView /> : <SupplierOrdersView items={lowItems} />}
    </AppShell>
  );
}

function InventoryView() {
  const [orders, setOrders] = useState(180);
  const liters = useMemo(() => (orders * 0.045).toFixed(2), [orders]);

  return (
    <>
      <section className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="flex items-center gap-2 border-b border-border bg-muted/30 px-4 py-3">
          <Calculator size={15} className="text-primary" />
          <h2 className="text-sm font-bold">Calculateur de sauce</h2>
        </div>
        <div className="p-4">
          <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Commandes prévues
          </label>
          <div className="mt-2 flex items-center gap-3">
            <button onClick={() => setOrders((o) => Math.max(0, o - 10))} className="grid h-10 w-10 place-items-center rounded-xl border border-border bg-background text-lg font-bold hover:bg-accent">−</button>
            <input
              type="number"
              value={orders}
              onChange={(e) => setOrders(Number(e.target.value) || 0)}
              className="flex-1 rounded-xl border border-border bg-background px-3 py-2.5 text-center text-lg font-bold focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
            <button onClick={() => setOrders((o) => o + 10)} className="grid h-10 w-10 place-items-center rounded-xl border border-border bg-background text-lg font-bold hover:bg-accent">+</button>
          </div>
          <div className="mt-4 rounded-xl bg-navy p-4 text-navy-foreground">
            <p className="text-[10px] uppercase tracking-wider text-navy-foreground/60">Sauce à préparer</p>
            <p className="mt-1 text-3xl font-bold">{liters} <span className="text-base text-primary">L</span></p>
            <p className="mt-1 text-[11px] text-navy-foreground/70">≈ 45 ml par commande</p>
          </div>
        </div>
      </section>

      <div className="mb-3 mt-5 flex items-center justify-between">
        <h2 className="text-sm font-bold">Inventaire</h2>
        <span className="text-[11px] text-muted-foreground">{inventory.length} ingrédients</span>
      </div>
      <div className="space-y-2">
        {inventory.map((i) => {
          const s = statusOf(i);
          return (
            <div key={i.name} className="flex items-center gap-3 rounded-xl border border-border bg-card p-3">
              <div
                className={`grid h-9 w-9 place-items-center rounded-lg ${
                  s === "urgent" ? "bg-destructive/15 text-destructive" : s === "soon" ? "bg-warning/20 text-warning" : "bg-success/15 text-success"
                }`}
              >
                <Package size={14} />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold">{i.name}</p>
                  <span className="text-[10px] text-muted-foreground">min {i.min} {i.unit}</span>
                </div>
                <p className="text-[11px] text-muted-foreground">DLC · {i.dlc}</p>
              </div>
              <div className="text-right">
                <p className="text-sm font-bold">{i.qty} <span className="text-[10px] text-muted-foreground">{i.unit}</span></p>
                <span
                  className={`text-[10px] font-semibold uppercase ${
                    s === "urgent" ? "text-destructive" : s === "soon" ? "text-warning" : "text-success"
                  }`}
                >
                  {s === "urgent" ? "Critique" : s === "soon" ? "Bas" : "OK"}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

function SupplierOrdersView({ items }: { items: Item[] }) {
  const [draft, setDraft] = useState<Record<string, number>>(() =>
    Object.fromEntries(items.map((i) => [i.name, Math.max(0, Math.ceil(i.min * 2 - i.qty))])),
  );
  const adjust = (n: string, d: number) => setDraft((s) => ({ ...s, [n]: Math.max(0, (s[n] || 0) + d) }));
  const total = items.reduce((sum, i) => sum + (draft[i.name] || 0) * i.price, 0);

  const waMessage = encodeURIComponent(
    `Bonjour, commande Grubano pour demain:\n${items
      .filter((i) => (draft[i.name] || 0) > 0)
      .map((i) => `• ${i.name} — ${draft[i.name]} ${i.unit}`)
      .join("\n")}\nTotal estimé: €${total.toFixed(2)}`,
  );

  return (
    <>
      <section className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border bg-muted/30 px-4 py-3">
          <h2 className="text-sm font-bold">Commande suggérée</h2>
          <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-semibold text-primary">{items.length} articles</span>
        </div>
        <div className="divide-y divide-border">
          {items.length === 0 && (
            <div className="p-6 text-center text-sm text-muted-foreground">
              <Check size={20} className="mx-auto mb-2 text-success" />
              Tous les stocks sont OK
            </div>
          )}
          {items.map((i) => (
            <div key={i.name} className="flex items-center gap-3 px-4 py-3">
              <div className="flex-1">
                <p className="text-sm font-semibold">{i.name}</p>
                <p className="text-[11px] text-muted-foreground">€{i.price.toFixed(2)}/{i.unit} · stock {i.qty}/{i.min}</p>
              </div>
              <div className="flex items-center gap-1.5">
                <button onClick={() => adjust(i.name, -1)} className="grid h-7 w-7 place-items-center rounded-lg border border-border"><Minus size={12} /></button>
                <span className="w-10 text-center text-sm font-bold">{draft[i.name] || 0} <span className="text-[9px] text-muted-foreground">{i.unit}</span></span>
                <button onClick={() => adjust(i.name, 1)} className="grid h-7 w-7 place-items-center rounded-lg border border-border"><Plus size={12} /></button>
              </div>
            </div>
          ))}
        </div>
        {items.length > 0 && (
          <div className="border-t border-border bg-muted/20 p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-[11px] uppercase tracking-wider text-muted-foreground">Total estimé</span>
              <span className="text-lg font-bold">€{total.toFixed(2)}</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <a
                href={`https://wa.me/?text=${waMessage}`}
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-center gap-1 rounded-xl bg-success py-2.5 text-[11px] font-semibold text-success-foreground"
              >
                <Send size={13} /> WhatsApp
              </a>
              <button className="flex items-center justify-center gap-1 rounded-xl border border-border bg-card py-2.5 text-[11px] font-semibold">
                <Mail size={13} /> Email
              </button>
              <button className="flex items-center justify-center gap-1 rounded-xl border border-border bg-card py-2.5 text-[11px] font-semibold">
                <FileDown size={13} /> PDF
              </button>
            </div>
          </div>
        )}
      </section>

      <div className="mb-3 mt-5 flex items-center justify-between">
        <h2 className="text-sm font-bold">Historique</h2>
        <span className="text-[11px] text-muted-foreground">{orderHistory.length} commandes</span>
      </div>
      <div className="space-y-2">
        {orderHistory.map((o) => (
          <div key={o.date} className="flex items-center justify-between rounded-xl border border-border bg-card p-3">
            <div className="flex items-center gap-3">
              <div className="grid h-9 w-9 place-items-center rounded-lg bg-accent text-primary"><Clock size={14} /></div>
              <div>
                <p className="text-sm font-semibold">{o.supplier}</p>
                <p className="text-[11px] text-muted-foreground">{o.date}</p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-sm font-bold">€{o.total}</p>
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-success"><Check size={10} /> {o.status}</span>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
