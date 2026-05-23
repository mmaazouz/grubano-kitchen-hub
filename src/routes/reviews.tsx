import { createFileRoute } from "@tanstack/react-router";
import { FeaturePage, Card, SectionTitle } from "@/components/FeaturePage";
import { Star, MessageSquare, Clock } from "lucide-react";

export const Route = createFileRoute("/reviews")({
  component: ReviewsPage,
  head: () => ({ meta: [{ title: "Grubano — Reviews" }] }),
});

const reviews = [
  { p: "UberEats", n: "Sarah K.", r: 5, t: "Best gnocchi in Paris!", h: "1h", answered: false },
  { p: "Deliveroo", n: "Anonymous", r: 1, t: "Cold when arrived, no sauce.", h: "2h", answered: false, urgent: true },
  { p: "Just Eat", n: "Tom B.", r: 4, t: "Good but slow.", h: "5h", answered: true },
];

function ReviewsPage() {
  return (
    <FeaturePage title="Reviews" subtitle="All platforms · AI drafts" badge="92% reply rate">
      <div className="mb-4 flex gap-2">
        {["All", "1★ only", "Unanswered"].map((f, i) => (
          <button key={f} className={`flex-1 rounded-xl py-2 text-[11px] font-semibold ${i === 0 ? "bg-navy text-navy-foreground" : "border border-border bg-card text-muted-foreground"}`}>
            {f}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {reviews.map((r) => (
          <Card key={r.t} className={r.urgent ? "!border-destructive/40" : ""}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold uppercase text-muted-foreground">{r.p}</span>
                <span className="text-xs font-semibold">{r.n}</span>
              </div>
              <span className="inline-flex items-center gap-0.5 text-xs font-bold">
                {Array.from({ length: r.r }).map((_, i) => <Star key={i} size={11} className="fill-warning text-warning" />)}
              </span>
            </div>
            <p className="mt-2 text-sm">{r.t}</p>
            {!r.answered && (
              <>
                <div className="mt-3 rounded-lg bg-accent p-2.5">
                  <p className="text-[10px] font-bold uppercase text-primary">AI draft</p>
                  <p className="mt-1 text-[12px] italic">
                    {r.r === 1 ? "Sorry to hear that — we'd love to make it right. Reply to claim a free dish." : "Thanks so much, see you soon!"}
                  </p>
                </div>
                <div className="mt-2 flex gap-2">
                  <button className="flex-1 rounded-lg bg-primary py-2 text-[11px] font-semibold text-primary-foreground">Send reply</button>
                  <button className="rounded-lg border border-border bg-card px-3 py-2 text-[11px] font-semibold">Edit</button>
                </div>
              </>
            )}
            {r.urgent && (
              <p className="mt-2 inline-flex items-center gap-1 text-[10px] font-bold text-destructive">
                <Clock size={10} /> Reply within 2h
              </p>
            )}
            {r.answered && (
              <p className="mt-2 inline-flex items-center gap-1 text-[10px] text-success"><MessageSquare size={10} /> Answered</p>
            )}
          </Card>
        ))}
      </div>
    </FeaturePage>
  );
}
