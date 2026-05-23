import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { Building2, MapPin } from "lucide-react";

export const Route = createFileRoute("/franchise")({
  component: FranchisePage,
  head: () => ({ meta: [{ title: "Grubano — Franchise" }] }),
});

function FranchisePage() {
  return (
    <AppShell operator="Mohammed">
      <h1 className="mb-1 text-2xl font-bold tracking-tight">Franchise</h1>
      <p className="mb-5 text-sm text-muted-foreground">Network at a glance</p>

      <div className="grid grid-cols-2 gap-3">
        {[
          { label: "Locations", value: "12" },
          { label: "Cities", value: "5" },
          { label: "Network revenue", value: "€84k" },
          { label: "Avg. rating", value: "4.7★" },
        ].map((k) => (
          <div key={k.label} className="rounded-2xl border border-border bg-card p-4">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{k.label}</p>
            <p className="mt-1 text-2xl font-bold">{k.value}</p>
          </div>
        ))}
      </div>

      <section className="mt-5 space-y-2">
        <h2 className="mb-2 text-sm font-bold">Top locations</h2>
        {[
          { name: "Paris 11ème", revenue: "€12.4k", status: "live" },
          { name: "Lyon Part-Dieu", revenue: "€9.8k", status: "live" },
          { name: "Marseille Vieux-Port", revenue: "€7.2k", status: "live" },
        ].map((l) => (
          <div key={l.name} className="flex items-center gap-3 rounded-xl border border-border bg-card p-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-accent text-primary">
              <Building2 size={16} />
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold">{l.name}</p>
              <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <MapPin size={10} /> Weekly revenue
              </div>
            </div>
            <p className="text-sm font-bold">{l.revenue}</p>
          </div>
        ))}
      </section>
    </AppShell>
  );
}
