import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { useState } from "react";
import {
  Camera, Sparkles, Check, Users, Clock, AlertTriangle, ChevronRight, QrCode, Plus, CalendarDays, Euro,
} from "lucide-react";

export const Route = createFileRoute("/tables")({
  component: TablesPage,
  head: () => ({ meta: [{ title: "Grubano — Tables" }] }),
});

type Table = { id: string; name: string; seats: number; x: number; y: number; booked?: boolean };

const defaultTables: Table[] = [
  { id: "T1", name: "Table 1", seats: 2, x: 18, y: 22 },
  { id: "T2", name: "Table 2", seats: 4, x: 55, y: 20, booked: true },
  { id: "T3", name: "Table 3", seats: 4, x: 80, y: 45 },
  { id: "T4", name: "Terrasse", seats: 6, x: 22, y: 60, booked: true },
  { id: "T5", name: "Bar", seats: 3, x: 55, y: 70 },
  { id: "T6", name: "Salon", seats: 4, x: 85, y: 80 },
];

const reservations = [
  { name: "Sarah K.", table: "Table 2", time: "19:30", guests: 2, allergy: "Gluten", arrived: false, paid: 10 },
  { name: "Marc D.", table: "Terrasse", time: "20:00", guests: 4, allergy: null, arrived: false, paid: 0 },
  { name: "Léa M.", table: "Salon", time: "20:30", guests: 3, allergy: "Lactose, Fruits à coque", arrived: false, paid: 25 },
  { name: "Karim Z.", table: "Bar", time: "21:00", guests: 2, allergy: null, arrived: true, paid: 0 },
];

function TablesPage() {
  const [tab, setTab] = useState<"plan" | "reservations" | "setup">("reservations");
  return (
    <AppShell operator="Mohammed">
      <h1 className="mb-1 text-2xl font-bold tracking-tight">Tables</h1>
      <p className="mb-4 text-sm text-muted-foreground">Réservations & plan de salle</p>

      <div className="mb-4 grid grid-cols-3 gap-1 rounded-2xl bg-muted p-1">
        {([
          ["reservations", "Réservations"],
          ["plan", "Plan"],
          ["setup", "Configurer"],
        ] as const).map(([k, l]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`rounded-xl py-2 text-[11px] font-semibold transition ${tab === k ? "bg-card text-foreground shadow" : "text-muted-foreground"}`}
          >
            {l}
          </button>
        ))}
      </div>

      {tab === "reservations" && <ReservationsView />}
      {tab === "plan" && <FloorPlanView tables={defaultTables} />}
      {tab === "setup" && <SetupView />}
    </AppShell>
  );
}

function ReservationsView() {
  const totalRevenue = reservations.reduce((s, r) => s + r.paid, 0);
  return (
    <>
      <div className="mb-4 grid grid-cols-3 gap-2">
        {[
          { l: "Aujourd'hui", v: reservations.length.toString(), icon: CalendarDays },
          { l: "Couverts", v: reservations.reduce((s, r) => s + r.guests, 0).toString(), icon: Users },
          { l: "Acomptes", v: `€${totalRevenue}`, icon: Euro },
        ].map((s) => (
          <div key={s.l} className="rounded-2xl border border-border bg-card p-3 text-center">
            <s.icon size={14} className="mx-auto text-primary" />
            <p className="mt-1 text-base font-bold">{s.v}</p>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{s.l}</p>
          </div>
        ))}
      </div>

      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-bold">Ce soir</h2>
        <div className="flex gap-1">
          {["Jour", "Semaine"].map((d, i) => (
            <button key={d} className={`rounded-lg px-2.5 py-1 text-[10px] font-semibold ${i === 0 ? "bg-navy text-navy-foreground" : "border border-border text-muted-foreground"}`}>{d}</button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        {reservations.map((r) => (
          <div key={r.name + r.time} className="rounded-2xl border border-border bg-card p-3">
            <div className="flex items-start gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-xl bg-navy text-sm font-bold text-navy-foreground">{r.time.split(":")[0]}<span className="text-[8px]">:{r.time.split(":")[1]}</span></div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold">{r.name}</p>
                  {r.arrived && <span className="rounded-full bg-success/15 px-1.5 py-0.5 text-[9px] font-bold uppercase text-success">Arrivé</span>}
                  {r.paid > 0 && <span className="rounded-full bg-accent px-1.5 py-0.5 text-[9px] font-bold text-primary">€{r.paid}</span>}
                </div>
                <p className="text-[11px] text-muted-foreground">{r.table} · {r.guests} couverts</p>
                {r.allergy && (
                  <div className="mt-2 flex items-center gap-1.5 rounded-lg bg-destructive/10 px-2 py-1 text-[10px] font-semibold text-destructive">
                    <AlertTriangle size={11} /> {r.allergy}
                  </div>
                )}
              </div>
              {!r.arrived && (
                <button className="rounded-lg bg-primary px-2.5 py-1.5 text-[10px] font-semibold text-primary-foreground">Marquer arrivé</button>
              )}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function FloorPlanView({ tables }: { tables: Table[] }) {
  const [selected, setSelected] = useState<string | null>(null);
  const sel = tables.find((t) => t.id === selected);
  return (
    <>
      <div className="mb-3 flex items-center gap-3 text-[11px]">
        <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-success" /> Libre</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-muted-foreground" /> Réservée</span>
      </div>

      <div className="relative h-64 overflow-hidden rounded-2xl border-2 border-dashed border-border bg-muted/30">
        <div className="absolute left-2 top-2 rounded-lg bg-card/80 px-2 py-1 text-[9px] font-semibold uppercase text-muted-foreground">Salle principale</div>
        {tables.map((t) => (
          <button
            key={t.id}
            onClick={() => setSelected(t.id)}
            style={{ left: `${t.x}%`, top: `${t.y}%` }}
            className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-xl border-2 px-2 py-1.5 text-[10px] font-bold shadow-sm transition ${
              t.booked
                ? "border-muted-foreground/40 bg-muted text-muted-foreground"
                : "border-success bg-success/15 text-success"
            } ${selected === t.id ? "ring-2 ring-primary" : ""}`}
          >
            {t.name}
            <span className="block text-[8px] font-normal opacity-70">{t.seats} pl.</span>
          </button>
        ))}
      </div>

      {sel && (
        <div className="mt-4 rounded-2xl border border-border bg-card p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-bold">{sel.name}</p>
              <p className="text-[11px] text-muted-foreground">{sel.seats} places · {sel.booked ? "Réservée" : "Disponible"}</p>
            </div>
            <button className="grid h-10 w-10 place-items-center rounded-xl bg-navy text-navy-foreground"><QrCode size={16} /></button>
          </div>
          {!sel.booked && (
            <button className="mt-3 w-full rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground">
              Réserver cette table
            </button>
          )}
        </div>
      )}
    </>
  );
}

function SetupView() {
  const [step, setStep] = useState(1);
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        {[1, 2, 3, 4].map((n) => (
          <div key={n} className={`h-1 flex-1 rounded-full ${n <= step ? "bg-primary" : "bg-muted"}`} />
        ))}
      </div>

      {step === 1 && (
        <div className="rounded-2xl border border-border bg-card p-5 text-center">
          <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-accent text-primary"><Camera size={28} /></div>
          <h3 className="mt-3 text-base font-bold">Photo de votre salle</h3>
          <p className="mt-1 text-[12px] text-muted-foreground">Prenez une photo grand-angle pour que l'IA détecte vos tables.</p>
          <button onClick={() => setStep(2)} className="mt-4 w-full rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground">
            Ouvrir l'appareil photo
          </button>
        </div>
      )}

      {step === 2 && (
        <div className="rounded-2xl border border-border bg-card p-5 text-center">
          <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-navy text-primary"><Sparkles size={28} /></div>
          <h3 className="mt-3 text-base font-bold">Analyse IA en cours…</h3>
          <p className="mt-1 text-[12px] text-muted-foreground">6 tables détectées · 23 places au total</p>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
            <div className="h-full w-3/4 animate-pulse bg-primary" />
          </div>
          <button onClick={() => setStep(3)} className="mt-4 w-full rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground">
            Voir le plan
          </button>
        </div>
      )}

      {step === 3 && (
        <div className="rounded-2xl border border-border bg-card p-4">
          <h3 className="text-base font-bold">Valider les tables détectées</h3>
          <p className="mt-0.5 text-[12px] text-muted-foreground">Glissez pour repositionner si besoin.</p>
          <FloorPlanView tables={defaultTables} />
          <button onClick={() => setStep(4)} className="mt-3 w-full rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground">Continuer</button>
        </div>
      )}

      {step === 4 && (
        <div className="rounded-2xl border border-border bg-card p-5 text-center">
          <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-success/20 text-success"><Check size={28} /></div>
          <h3 className="mt-3 text-base font-bold">Plan de salle enregistré</h3>
          <p className="mt-1 text-[12px] text-muted-foreground">QR codes générés pour chaque table.</p>
          <button onClick={() => setStep(1)} className="mt-4 w-full rounded-xl bg-navy py-3 text-sm font-semibold text-navy-foreground">
            Terminé
          </button>
        </div>
      )}

      <button className="flex w-full items-center justify-between rounded-2xl border border-border bg-card p-3 text-sm">
        <span className="flex items-center gap-2 font-semibold"><Plus size={14} className="text-primary" /> Ajouter une table manuellement</span>
        <ChevronRight size={14} className="text-muted-foreground" />
      </button>
    </div>
  );
}
