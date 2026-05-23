import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { Award, Gift, Check, Lock, Sparkles } from "lucide-react";
import { useState } from "react";

export const Route = createFileRoute("/loyalty")({
  component: LoyaltyPage,
  head: () => ({ meta: [{ title: "Grubano — Loyalty" }] }),
});

const rewards = [
  { name: "Free side dish", cost: 200, unlocked: true },
  { name: "10% off next order", cost: 500, unlocked: true },
  { name: "Free signature dish", cost: 1000, unlocked: false },
  { name: "Chef's tasting menu", cost: 2500, unlocked: false },
];

function LoyaltyPage() {
  const [orderId, setOrderId] = useState("");
  const balance = 680;
  const nextTier = 1000;
  const progress = (balance / nextTier) * 100;

  return (
    <AppShell operator="Mohammed">
      <h1 className="mb-1 text-2xl font-bold tracking-tight">Loyalty</h1>
      <p className="mb-5 text-sm text-muted-foreground">Earn points on every order</p>

      <section className="relative overflow-hidden rounded-3xl bg-navy p-5 text-navy-foreground shadow-xl shadow-navy/20">
        <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-primary/30 blur-3xl" />
        <div className="absolute -bottom-12 -left-8 h-32 w-32 rounded-full bg-primary/20 blur-2xl" />
        <div className="relative">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="grid h-9 w-9 place-items-center rounded-xl bg-primary text-primary-foreground">
                <Award size={17} />
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-navy-foreground/60">Points wallet</p>
                <p className="text-xs font-semibold">Mohammed K.</p>
              </div>
            </div>
            <span className="rounded-full bg-primary/20 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-primary">
              Silver
            </span>
          </div>

          <p className="mt-5 text-4xl font-bold tracking-tight">
            {balance.toLocaleString()} <span className="text-base font-medium text-navy-foreground/60">pts</span>
          </p>
          <p className="mt-1 text-xs text-navy-foreground/70">{nextTier - balance} pts to Gold tier</p>

          <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${progress}%` }} />
          </div>
          <div className="mt-2 flex justify-between text-[10px] font-semibold uppercase tracking-wider text-navy-foreground/60">
            <span>Bronze</span><span className="text-primary">Silver</span><span>Gold</span><span>Platine</span>
          </div>
        </div>
      </section>

      <section className="mt-5 rounded-2xl border border-border bg-card p-4">
        <div className="mb-3 flex items-center gap-2">
          <Sparkles size={15} className="text-primary" />
          <h2 className="text-sm font-bold">Validate an order</h2>
        </div>
        <p className="mb-3 text-[11px] text-muted-foreground">
          Enter your UberEats order number to earn points instantly.
        </p>
        <div className="flex gap-2">
          <input
            value={orderId}
            onChange={(e) => setOrderId(e.target.value)}
            placeholder="#UE-58291"
            className="flex-1 rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
          <button className="rounded-xl bg-primary px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-primary-foreground transition hover:opacity-90">
            Claim
          </button>
        </div>
      </section>

      <section className="mt-5">
        <h2 className="mb-3 text-sm font-bold">Rewards</h2>
        <div className="space-y-2">
          {rewards.map((r) => (
            <div key={r.name} className="flex items-center gap-3 rounded-xl border border-border bg-card p-3">
              <div
                className={`grid h-10 w-10 place-items-center rounded-xl ${
                  r.unlocked ? "bg-accent text-primary" : "bg-muted text-muted-foreground"
                }`}
              >
                {r.unlocked ? <Gift size={16} /> : <Lock size={14} />}
              </div>
              <div className="flex-1">
                <p className="text-sm font-semibold">{r.name}</p>
                <p className="text-[11px] text-muted-foreground">{r.cost} pts</p>
              </div>
              {r.unlocked ? (
                <button className="flex items-center gap-1 rounded-full bg-primary px-3 py-1.5 text-[11px] font-bold text-primary-foreground">
                  <Check size={12} /> Redeem
                </button>
              ) : (
                <span className="text-[11px] font-semibold text-muted-foreground">Locked</span>
              )}
            </div>
          ))}
        </div>
      </section>
    </AppShell>
  );
}
