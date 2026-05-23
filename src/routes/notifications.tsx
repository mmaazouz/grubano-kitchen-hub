import { createFileRoute } from "@tanstack/react-router";
import { FeaturePage, Card, SectionTitle } from "@/components/FeaturePage";

export const Route = createFileRoute("/notifications")({
  component: NotificationsPage,
  head: () => ({ meta: [{ title: "Grubano — Notifications" }] }),
});

const feed = [
  { t: "New order #UE-8421", s: "Gnocchi Bar · €24.50", time: "2m", tone: "primary" },
  { t: "1★ review on Deliveroo", s: "Reply within 2h", time: "17m", tone: "destructive" },
  { t: "Tomato sauce low", s: "Prep 4.5 L by 11:30", time: "1h", tone: "warning" },
  { t: "Payment received", s: "UberEats · €4,820", time: "3h", tone: "success" },
  { t: "Franchisee milestone", s: "Lyon hit €10k week", time: "5h", tone: "success" },
];

const toneClass = (t: string) =>
  ({ primary: "bg-primary", destructive: "bg-destructive", warning: "bg-warning", success: "bg-success" }[t] || "bg-muted");

function NotificationsPage() {
  return (
    <FeaturePage title="Notifications" subtitle="Today · 12 events" badge="All channels">
      <SectionTitle>Alert thresholds</SectionTitle>
      <Card>
        {[
          ["New order", true],
          ["Bad review (≤2★)", true],
          ["Stock < 1 day", true],
          ["Payment received", false],
          ["Franchisee milestone", true],
        ].map(([l, on]) => (
          <div key={l as string} className="flex items-center justify-between border-b border-border py-2 last:border-0">
            <span className="text-sm">{l}</span>
            <button className={`relative h-5 w-9 rounded-full ${on ? "bg-success" : "bg-muted"}`}>
              <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow ${on ? "left-4" : "left-0.5"}`} />
            </button>
          </div>
        ))}
      </Card>

      <SectionTitle>Recent</SectionTitle>
      <div className="space-y-2">
        {feed.map((f, i) => (
          <Card key={i} className="flex items-start gap-3 !p-3">
            <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${toneClass(f.tone)}`} />
            <div className="flex-1">
              <p className="text-sm font-semibold">{f.t}</p>
              <p className="text-[11px] text-muted-foreground">{f.s}</p>
            </div>
            <span className="text-[10px] text-muted-foreground">{f.time}</span>
          </Card>
        ))}
      </div>
    </FeaturePage>
  );
}
