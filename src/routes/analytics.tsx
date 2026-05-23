import { Fragment } from "react";
import { createFileRoute } from "@tanstack/react-router";

import { FeaturePage, Card, SectionTitle } from "@/components/FeaturePage";
import { TrendingDown, TrendingUp, Users } from "lucide-react";

export const Route = createFileRoute("/analytics")({
  component: AnalyticsPage,
  head: () => ({ meta: [{ title: "Grubano — Intelligence" }] }),
});

const hours = ["10", "11", "12", "13", "14", "15", "16", "17", "18", "19", "20", "21", "22"];
const days = ["M", "T", "W", "T", "F", "S", "S"];

function AnalyticsPage() {
  return (
    <FeaturePage title="Intelligence" subtitle="Real numbers, no fluff" badge="Live">
      <div className="grid grid-cols-2 gap-3">
        <Card>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Net margin today</p>
          <p className="mt-1 text-2xl font-bold">€1,684</p>
          <p className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-success"><TrendingUp size={11} /> +9% vs avg</p>
        </Card>
        <Card>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Customer LTV</p>
          <p className="mt-1 text-2xl font-bold">€87</p>
          <p className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-success"><Users size={11} /> 3.4 orders avg</p>
        </Card>
      </div>

      <SectionTitle hint="Per order, after commission">Margin by platform</SectionTitle>
      <div className="space-y-2">
        {[
          { p: "UberEats", gross: 18.5, com: 25, net: 7.2 },
          { p: "Deliveroo", gross: 19.1, com: 30, net: 6.4 },
          { p: "Just Eat", gross: 17.8, com: 22, net: 7.9 },
          { p: "Direct", gross: 18.5, com: 0, net: 11.1 },
        ].map((r) => (
          <Card key={r.p} className="flex items-center justify-between !p-3">
            <div>
              <p className="text-sm font-semibold">{r.p}</p>
              <p className="text-[11px] text-muted-foreground">€{r.gross.toFixed(2)} gross · −{r.com}% fee</p>
            </div>
            <p className="text-base font-bold text-success">€{r.net.toFixed(2)}</p>
          </Card>
        ))}
      </div>

      <SectionTitle hint="Last 7 days">Hour heatmap</SectionTitle>
      <Card>
        <div className="grid gap-1" style={{ gridTemplateColumns: `auto repeat(${hours.length}, 1fr)` }}>
          <div />
          {hours.map((h) => (
            <div key={h} className="text-center text-[8px] font-medium text-muted-foreground">{h}</div>
          ))}
          {days.map((d, di) => (
            <Fragment key={`row-${di}`}>
              <div className="text-[10px] font-semibold text-muted-foreground">{d}</div>
              {hours.map((_, hi) => {
                const v = Math.abs(Math.sin((di + 1) * (hi + 3)));
                return (
                  <div
                    key={`${di}-${hi}`}
                    className="aspect-square rounded-[3px]"
                    style={{ backgroundColor: `color-mix(in oklch, var(--primary) ${Math.round(v * 80) + 8}%, white)` }}
                  />
                );
              })}
            </Fragment>
          ))}

        </div>
        <p className="mt-3 text-[11px] text-muted-foreground">Peak: Friday 19h–21h · Worst: Monday 15h</p>
      </Card>

      <SectionTitle>Cancellations</SectionTitle>
      <Card>
        <div className="flex items-baseline justify-between">
          <p className="text-2xl font-bold">2.4%</p>
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-destructive"><TrendingDown size={11} /> +0.3 this week</span>
        </div>
        <div className="mt-3 space-y-2">
          {[
            { c: "Item out of stock", p: 42 },
            { c: "Long prep time", p: 28 },
            { c: "Rider unavailable", p: 18 },
            { c: "Customer request", p: 12 },
          ].map((r) => (
            <div key={r.c}>
              <div className="mb-1 flex justify-between text-[11px]"><span>{r.c}</span><span className="font-semibold">{r.p}%</span></div>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary" style={{ width: `${r.p}%` }} />
              </div>
            </div>
          ))}
        </div>
      </Card>

      <SectionTitle>Zone benchmark</SectionTitle>
      <Card>
        <p className="text-[11px] text-muted-foreground">Anonymous vs top 3 in your zone</p>
        <div className="mt-3 space-y-2">
          {[
            { n: "You (Grubano)", r: 4.8, you: true },
            { n: "Competitor A", r: 4.6 },
            { n: "Competitor B", r: 4.5 },
            { n: "Competitor C", r: 4.3 },
          ].map((c) => (
            <div key={c.n} className={`flex items-center justify-between rounded-lg px-2 py-1.5 ${c.you ? "bg-accent" : ""}`}>
              <span className={`text-sm ${c.you ? "font-bold text-primary" : "text-foreground"}`}>{c.n}</span>
              <span className="text-sm font-bold">{c.r}★</span>
            </div>
          ))}
        </div>
      </Card>

      <SectionTitle hint="Next 7 days">Revenue forecast</SectionTitle>
      <Card>
        <div className="flex h-28 items-end gap-2">
          {[2.4, 2.6, 2.5, 2.9, 3.4, 3.7, 3.1].map((v, i) => (
            <div key={i} className="flex flex-1 flex-col items-center gap-1">
              <div className="w-full rounded-t-md bg-gradient-to-t from-primary to-primary/40" style={{ height: `${(v / 3.7) * 100}%` }} />
              <span className="text-[10px] text-muted-foreground">{days[i]}</span>
            </div>
          ))}
        </div>
        <p className="mt-3 text-[11px] text-muted-foreground">Projected total: <span className="font-bold text-foreground">€20.6k</span> · +12% vs last week</p>
      </Card>
    </FeaturePage>
  );
}
