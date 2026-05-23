import { createFileRoute } from "@tanstack/react-router";
import { FeaturePage, Card, SectionTitle } from "@/components/FeaturePage";
import { CloudRain, AlertTriangle, Check, ChefHat } from "lucide-react";

export const Route = createFileRoute("/briefing")({
  component: BriefingPage,
  head: () => ({ meta: [{ title: "Grubano — AI Briefing" }] }),
});

function BriefingPage() {
  return (
    <FeaturePage title="AI Briefing" subtitle="Tuesday, 18 November" badge="Updated 7:02 AM">
      <Card className="!bg-navy !text-navy-foreground">
        <p className="text-[11px] uppercase tracking-wider text-primary">Today's plan</p>
        <h2 className="mt-1 text-xl font-bold">Prepare 6.5 L sauces</h2>
        <ul className="mt-3 space-y-1.5 text-sm">
          <li className="flex justify-between"><span>Butter Chicken</span><span className="font-bold">3.2 L</span></li>
          <li className="flex justify-between"><span>Bolognaise</span><span className="font-bold">2.4 L</span></li>
          <li className="flex justify-between"><span>Pesto verde</span><span className="font-bold">0.9 L</span></li>
        </ul>
      </Card>

      <SectionTitle>Weather signal</SectionTitle>
      <Card>
        <div className="flex items-start gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-accent text-primary"><CloudRain size={18} /></div>
          <div className="flex-1">
            <p className="text-sm font-bold">Rain expected 19h–22h</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">Historical: +20% orders on rainy evenings in your zone.</p>
          </div>
        </div>
        <button className="mt-3 w-full rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground">
          Boost prep for dinner rush
        </button>
      </Card>

      <SectionTitle>Alerts</SectionTitle>
      <Card className="!border-destructive/30 !bg-destructive/5">
        <div className="flex items-start gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-destructive text-destructive-foreground"><AlertTriangle size={18} /></div>
          <div className="flex-1">
            <p className="text-sm font-bold">Gnocchi Bar rating dropped 0.2</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">3 recent reviews mention delivery time. Suggest pausing peak orders or reassigning riders.</p>
            <div className="mt-3 flex gap-2">
              <button className="flex-1 rounded-lg bg-destructive py-2 text-[11px] font-semibold text-destructive-foreground">Pause 30 min</button>
              <button className="flex-1 rounded-lg border border-border bg-card py-2 text-[11px] font-semibold">Dismiss</button>
            </div>
          </div>
        </div>
      </Card>

      <SectionTitle>Suggested actions</SectionTitle>
      <div className="space-y-2">
        {[
          { t: "Restock soy-ginger (200 ml left)", a: "Order now", i: ChefHat },
          { t: "Reply to 4 unanswered 1★ reviews", a: "Open feed", i: AlertTriangle },
          { t: "Apply +15% surge on Gnocchi Bar tonight", a: "Apply", i: Check },
        ].map((s) => (
          <Card key={s.t} className="flex items-center gap-3 !p-3">
            <div className="grid h-9 w-9 place-items-center rounded-lg bg-accent text-primary"><s.i size={15} /></div>
            <p className="flex-1 text-sm">{s.t}</p>
            <button className="rounded-lg bg-navy px-3 py-1.5 text-[11px] font-semibold text-navy-foreground">{s.a}</button>
          </Card>
        ))}
      </div>
    </FeaturePage>
  );
}
