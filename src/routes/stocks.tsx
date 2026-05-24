import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import {
  Package, AlertTriangle, Check, Clock, Sparkles, Send, CloudRain, Trophy, Filter, X, Mic, ChevronRight,
} from "lucide-react";
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
  category: "Frais" | "Sec" | "Sauce" | "Packaging";
};

const inventory: Item[] = [
  { name: "Poulet mariné", qty: 2.1, unit: "kg", min: 5, dlc: "Demain", price: 8.5, category: "Frais" },
  { name: "Sauce tomate", qty: 3.2, unit: "L", min: 4, dlc: "Aujourd'hui 22h", price: 4.2, category: "Sauce" },
  { name: "Sauce butter chicken", qty: 0.4, unit: "L", min: 2, dlc: "Aujourd'hui 18h", price: 6.1, category: "Sauce" },
  { name: "Mozzarella", qty: 1.8, unit: "kg", min: 2, dlc: "Dans 2 jours", price: 9.0, category: "Frais" },
  { name: "Riz basmati", qty: 12, unit: "kg", min: 5, dlc: "Dans 14 jours", price: 2.3, category: "Sec" },
  { name: "Pesto verde", qty: 2.1, unit: "L", min: 1, dlc: "Demain", price: 5.4, category: "Sauce" },
  { name: "Boîtes kraft", qty: 220, unit: "u", min: 100, dlc: "—", price: 0.18, category: "Packaging" },
  { name: "Champignons", qty: 0.6, unit: "kg", min: 1.5, dlc: "Demain", price: 6.8, category: "Frais" },
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
  const [tab, setTab] = useState<"inventory" | "forecast" | "history">("inventory");
  const [chat, setChat] = useState(false);
  const lowItems = inventory.filter((i) => statusOf(i) !== "ok");

  return (
    <AppShell operator="Mohammed">
      <h1 className="mb-1 text-2xl font-bold tracking-tight">Stocks</h1>
      <p className="mb-4 text-sm text-muted-foreground">Inventaire, IA & historique</p>

      <button
        onClick={() => setChat(true)}
        className="mb-4 flex w-full items-center gap-3 rounded-2xl bg-navy p-4 text-navy-foreground"
      >
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground">
          <Sparkles size={18} />
        </div>
        <div className="flex-1 text-left">
          <p className="text-sm font-bold">Mettre à jour mes stocks</p>
          <p className="mt-0.5 text-[11px] text-navy-foreground/70">Parlez ou écrivez à l'IA · fin de service</p>
        </div>
        <Mic size={18} className="text-primary" />
      </button>

      {lowItems.length > 0 && (
        <div className="mb-4 flex items-start gap-3 rounded-2xl border border-destructive/30 bg-destructive/10 p-3.5">
          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-destructive text-destructive-foreground">
            <AlertTriangle size={15} />
          </div>
          <div className="flex-1">
            <p className="text-xs font-semibold">{lowItems.length} ingrédients sous le seuil</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">L'IA recommande une commande pour jeudi.</p>
          </div>
        </div>
      )}

      <div className="mb-4 grid grid-cols-3 gap-1 rounded-2xl bg-muted p-1">
        {([["inventory", "Mes stocks"], ["forecast", "IA forecast"], ["history", "Historique"]] as const).map(([k, l]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`rounded-xl py-2 text-[11px] font-semibold transition ${tab === k ? "bg-card text-foreground shadow" : "text-muted-foreground"}`}
          >
            {l}
          </button>
        ))}
      </div>

      {tab === "inventory" && <InventoryView />}
      {tab === "forecast" && <ForecastView />}
      {tab === "history" && <HistoryView />}

      {chat && <AIChatModal onClose={() => setChat(false)} />}
    </AppShell>
  );
}

function InventoryView() {
  const [filter, setFilter] = useState<"all" | "low" | "ok">("all");
  const [cat, setCat] = useState<string>("Tout");
  const cats = ["Tout", "Frais", "Sec", "Sauce", "Packaging"];

  const filtered = useMemo(() => inventory.filter((i) => {
    const s = statusOf(i);
    if (filter === "low" && s === "ok") return false;
    if (filter === "ok" && s !== "ok") return false;
    if (cat !== "Tout" && i.category !== cat) return false;
    return true;
  }), [filter, cat]);

  return (
    <>
      <div className="mb-3 flex items-center gap-2 overflow-x-auto pb-1">
        <Filter size={13} className="shrink-0 text-muted-foreground" />
        {([["all", "Tous"], ["low", "Bas/Critique"], ["ok", "OK"]] as const).map(([k, l]) => (
          <button
            key={k}
            onClick={() => setFilter(k)}
            className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold transition ${
              filter === k ? "bg-navy text-navy-foreground" : "border border-border bg-card text-muted-foreground"
            }`}
          >
            {l}
          </button>
        ))}
        <span className="mx-1 h-3 w-px bg-border" />
        {cats.map((c) => (
          <button
            key={c}
            onClick={() => setCat(c)}
            className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold transition ${
              cat === c ? "bg-primary text-primary-foreground" : "border border-border bg-card text-muted-foreground"
            }`}
          >
            {c}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        {filtered.map((i) => {
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
                <span className={`text-[10px] font-semibold uppercase ${
                  s === "urgent" ? "text-destructive" : s === "soon" ? "text-warning" : "text-success"
                }`}>
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

function ForecastView() {
  const days = [
    { d: "Mer", w: "☀️", evt: null, pct: 0, sauce: 3.2 },
    { d: "Jeu", w: "☀️", evt: null, pct: 5, sauce: 3.4 },
    { d: "Ven", w: "🌧️", evt: "Match PSG 21h", pct: 35, sauce: 4.6 },
    { d: "Sam", w: "🌧️", evt: "Match PSG 21h", pct: 42, sauce: 5.1 },
    { d: "Dim", w: "⛅", evt: null, pct: 18, sauce: 4.0 },
    { d: "Lun", w: "☀️", evt: null, pct: -5, sauce: 2.9 },
    { d: "Mar", w: "☀️", evt: null, pct: 0, sauce: 3.1 },
  ];

  return (
    <>
      <div className="mb-4 rounded-2xl bg-navy p-4 text-navy-foreground">
        <div className="flex items-center gap-2">
          <CloudRain size={14} className="text-primary" />
          <p className="text-[10px] font-bold uppercase tracking-wider text-primary">Recommandation IA</p>
        </div>
        <p className="mt-2 text-sm font-semibold leading-snug">
          Ce week-end : <span className="text-primary">+35% de demande</span> attendue (pluie + match PSG).
        </p>
        <p className="mt-1 text-[11px] text-navy-foreground/70">
          Commandez 4 kg poulet + 3 L bolognaise <span className="text-primary">avant jeudi 12h</span> pour livraison vendredi matin.
        </p>
        <button className="mt-3 w-full rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground">
          Préparer la commande
        </button>
      </div>

      <h2 className="mb-3 text-sm font-bold">Prévision 7 jours</h2>
      <div className="space-y-2">
        {days.map((d) => (
          <div key={d.d} className="rounded-xl border border-border bg-card p-3">
            <div className="flex items-center gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-lg bg-muted text-lg">{d.w}</div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-bold">{d.d}</p>
                  {d.evt && <span className="inline-flex items-center gap-1 rounded-full bg-accent px-1.5 py-0.5 text-[9px] font-semibold text-primary"><Trophy size={9} /> {d.evt}</span>}
                </div>
                <p className="mt-0.5 text-[11px] text-muted-foreground">Sauce à prévoir · {d.sauce} L</p>
              </div>
              <span className={`text-sm font-bold ${d.pct > 20 ? "text-destructive" : d.pct > 0 ? "text-warning" : d.pct < 0 ? "text-muted-foreground" : "text-success"}`}>
                {d.pct > 0 ? "+" : ""}{d.pct}%
              </span>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function HistoryView() {
  return (
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
  );
}

function AIChatModal({ onClose }: { onClose: () => void }) {
  const [messages, setMessages] = useState<{ role: "user" | "ai"; text: string }[]>([
    { role: "ai", text: "Bonsoir Mohammed 👋 Comment se sont passés les stocks ce soir ?" },
  ]);
  const [input, setInput] = useState("");
  const [step, setStep] = useState<"chat" | "confirm">("chat");

  const send = () => {
    if (!input.trim()) return;
    setMessages((m) => [...m, { role: "user", text: input }]);
    setInput("");
    setTimeout(() => {
      setMessages((m) => [...m, {
        role: "ai",
        text: "Compris. J'ai mis à jour : poulet 2 kg, bolognaise 0,3 L, riz plein, base carbonara à 0. D'après les prévisions de samedi (pluie + match), il vous faut 4 kg de poulet et 3 L de bolognaise en plus. Commande à passer avant jeudi.",
      }]);
      setStep("confirm");
    }, 700);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 px-4 pb-4 pt-16">
      <div className="flex h-full max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-3xl bg-card shadow-2xl">
        <div className="flex items-center gap-3 border-b border-border bg-navy px-4 py-3 text-navy-foreground">
          <div className="grid h-9 w-9 place-items-center rounded-xl bg-primary text-primary-foreground">
            <Sparkles size={15} />
          </div>
          <div className="flex-1">
            <p className="text-sm font-bold">Assistant Stocks</p>
            <p className="text-[10px] text-navy-foreground/70">Décrivez vos stocks en langage naturel</p>
          </div>
          <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg bg-navy-foreground/10"><X size={14} /></button>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-[13px] leading-snug ${
                m.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"
              }`}>
                {m.text}
              </div>
            </div>
          ))}
          {step === "confirm" && (
            <div className="rounded-2xl border border-primary/30 bg-accent p-3">
              <p className="text-[11px] font-bold text-foreground">Stocks mis à jour automatiquement</p>
              <ul className="mt-2 space-y-1 text-[11px] text-muted-foreground">
                <li>• Poulet mariné : 2,0 kg</li>
                <li>• Sauce bolognaise : 0,3 L</li>
                <li>• Base carbonara : 0 L</li>
              </ul>
              <button onClick={onClose} className="mt-3 w-full rounded-xl bg-primary py-2.5 text-xs font-bold text-primary-foreground">
                Valider et préparer la commande
              </button>
            </div>
          )}
        </div>

        <div className="border-t border-border bg-card p-3">
          <div className="flex items-center gap-2">
            <button className="grid h-10 w-10 place-items-center rounded-xl bg-muted text-foreground"><Mic size={16} /></button>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && send()}
              placeholder="Ex : 2 kg de poulet, plus de carbonara…"
              className="flex-1 rounded-xl border border-border bg-background px-3 py-2.5 text-[13px] focus:border-primary focus:outline-none"
            />
            <button onClick={send} className="grid h-10 w-10 place-items-center rounded-xl bg-primary text-primary-foreground"><Send size={16} /></button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Re-export for potential future use
export { ChevronRight };
