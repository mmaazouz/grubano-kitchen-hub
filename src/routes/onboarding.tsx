import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import {
  Utensils, Truck, Croissant, Caravan, ChefHat, Store, Camera, MapPin, ShoppingBasket,
  Link2, Sparkles, Check, ChevronRight, ChevronLeft, Crown,
} from "lucide-react";

export const Route = createFileRoute("/onboarding")({
  component: OnboardingPage,
  head: () => ({ meta: [{ title: "Grubano — Configuration" }] }),
});

const businessTypes = [
  { id: "restaurant", label: "Restaurant + salle", icon: Utensils },
  { id: "darkkitchen", label: "Dark kitchen / livraison", icon: Truck },
  { id: "bakery", label: "Boulangerie / pâtisserie", icon: Croissant },
  { id: "foodtruck", label: "Food truck", icon: Caravan },
  { id: "caterer", label: "Traiteur", icon: ChefHat },
  { id: "other", label: "Autre", icon: Store },
];

function OnboardingPage() {
  const [step, setStep] = useState(1);
  const [types, setTypes] = useState<string[]>([]);
  const [reservations, setReservations] = useState(true);
  const [delivery, setDelivery] = useState(true);
  const [radius, setRadius] = useState(5);
  const [supplier, setSupplier] = useState<"partner" | "self" | "both" | null>(null);
  const [premium, setPremium] = useState(false);
  const [menuMode, setMenuMode] = useState<"import" | "manual" | "ai" | null>(null);

  const hasDining = types.includes("restaurant");
  const totalSteps = 8;

  const next = () => setStep((s) => Math.min(totalSteps, s + 1));
  const prev = () => setStep((s) => Math.max(1, s - 1));

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-md px-5 pb-24 pt-6">
        <div className="mb-6 flex items-center justify-between">
          <button onClick={prev} disabled={step === 1} className="grid h-9 w-9 place-items-center rounded-xl border border-border bg-card disabled:opacity-30">
            <ChevronLeft size={16} />
          </button>
          <p className="text-[11px] font-semibold text-muted-foreground">Étape {step} / {totalSteps}</p>
          <div className="w-9" />
        </div>

        <div className="mb-6 flex gap-1">
          {Array.from({ length: totalSteps }).map((_, i) => (
            <div key={i} className={`h-1 flex-1 rounded-full ${i < step ? "bg-primary" : "bg-muted"}`} />
          ))}
        </div>

        {step === 1 && (
          <>
            <h2 className="text-2xl font-bold tracking-tight">Quel type d'établissement ?</h2>
            <p className="mt-1 text-sm text-muted-foreground">Sélection multiple possible.</p>
            <div className="mt-5 grid grid-cols-2 gap-3">
              {businessTypes.map((b) => {
                const active = types.includes(b.id);
                return (
                  <button
                    key={b.id}
                    onClick={() => setTypes((t) => active ? t.filter((x) => x !== b.id) : [...t, b.id])}
                    className={`flex flex-col items-center gap-2 rounded-2xl border p-4 text-center transition ${
                      active ? "border-primary bg-accent" : "border-border bg-card"
                    }`}
                  >
                    <div className={`grid h-10 w-10 place-items-center rounded-xl ${active ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"}`}>
                      <b.icon size={18} />
                    </div>
                    <span className="text-xs font-semibold">{b.label}</span>
                  </button>
                );
              })}
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <h2 className="text-2xl font-bold tracking-tight">Fonctionnalités activées</h2>
            <p className="mt-1 text-sm text-muted-foreground">Selon votre type d'établissement.</p>
            <div className="mt-5 space-y-2">
              {[
                { on: hasDining, label: "Réservations & plan de salle", icon: Utensils },
                { on: true, label: "Commandes & livraisons", icon: Truck },
                { on: types.includes("foodtruck"), label: "Géolocalisation en direct", icon: MapPin },
                { on: types.includes("bakery"), label: "Pré-commande à emporter", icon: ShoppingBasket },
                { on: true, label: "IA stocks & prévisions", icon: Sparkles },
              ].map((f) => (
                <div key={f.label} className={`flex items-center gap-3 rounded-2xl border p-3 ${f.on ? "border-success/30 bg-success/5" : "border-border bg-muted/30 opacity-60"}`}>
                  <div className={`grid h-9 w-9 place-items-center rounded-xl ${f.on ? "bg-success text-success-foreground" : "bg-muted text-muted-foreground"}`}>
                    {f.on ? <Check size={14} /> : <f.icon size={14} />}
                  </div>
                  <span className="flex-1 text-sm font-semibold">{f.label}</span>
                </div>
              ))}
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <h2 className="text-2xl font-bold tracking-tight">Salle & réservations</h2>
            <p className="mt-1 text-sm text-muted-foreground">{hasDining ? "Configurez l'accueil en salle." : "Non applicable — étape suivante."}</p>
            {hasDining ? (
              <div className="mt-5 space-y-3">
                <Toggle label="Activer les réservations" value={reservations} onChange={setReservations} />
                {reservations && (
                  <button className="flex w-full items-center gap-3 rounded-2xl border-2 border-dashed border-border bg-card p-4">
                    <div className="grid h-10 w-10 place-items-center rounded-xl bg-accent text-primary"><Camera size={16} /></div>
                    <div className="text-left">
                      <p className="text-sm font-bold">Photo de votre salle</p>
                      <p className="text-[11px] text-muted-foreground">L'IA détecte les tables automatiquement</p>
                    </div>
                  </button>
                )}
              </div>
            ) : (
              <button onClick={next} className="mt-5 w-full rounded-2xl bg-muted py-4 text-sm font-semibold">Passer</button>
            )}
          </>
        )}

        {step === 4 && (
          <>
            <h2 className="text-2xl font-bold tracking-tight">Livraison Grubano</h2>
            <p className="mt-1 text-sm text-muted-foreground">Powered by Uber Direct.</p>
            <div className="mt-5 space-y-3">
              <Toggle label="Activer la livraison Grubano" value={delivery} onChange={setDelivery} />
              {delivery && (
                <div className="rounded-2xl border border-border bg-card p-4">
                  <div className="flex items-center justify-between">
                    <label className="text-[11px] font-semibold">Rayon de livraison</label>
                    <span className="text-sm font-bold text-primary">{radius} km</span>
                  </div>
                  <input type="range" min="1" max="10" value={radius} onChange={(e) => setRadius(Number(e.target.value))} className="mt-2 w-full accent-primary" />
                  <p className="mt-3 text-[11px] text-muted-foreground">Frais de livraison par défaut : 1,99€</p>
                </div>
              )}
            </div>
          </>
        )}

        {step === 5 && (
          <>
            <h2 className="text-2xl font-bold tracking-tight">Approvisionnement</h2>
            <p className="mt-1 text-sm text-muted-foreground">Comment vous restockez d'habitude ?</p>
            <div className="mt-5 space-y-2">
              {([
                ["partner", "Fournisseurs partenaires Grubano"],
                ["self", "Je fais les courses moi-même"],
                ["both", "Les deux"],
              ] as const).map(([k, l]) => (
                <button
                  key={k}
                  onClick={() => setSupplier(k)}
                  className={`flex w-full items-center gap-3 rounded-2xl border p-4 text-left ${
                    supplier === k ? "border-primary bg-accent" : "border-border bg-card"
                  }`}
                >
                  <div className={`grid h-5 w-5 place-items-center rounded-full border-2 ${supplier === k ? "border-primary bg-primary" : "border-border"}`}>
                    {supplier === k && <Check size={12} className="text-primary-foreground" />}
                  </div>
                  <span className="text-sm font-semibold">{l}</span>
                </button>
              ))}
            </div>
          </>
        )}

        {step === 6 && (
          <>
            <h2 className="text-2xl font-bold tracking-tight">Multi-plateforme</h2>
            <p className="mt-1 text-sm text-muted-foreground">Vous vendez aussi sur UberEats / Deliveroo ?</p>
            <div className="mt-5 space-y-2">
              <button onClick={() => setPremium(true)} className={`flex w-full items-start gap-3 rounded-2xl border p-4 text-left ${premium ? "border-primary bg-accent" : "border-border bg-card"}`}>
                <Crown size={18} className="mt-0.5 text-primary" />
                <div className="flex-1">
                  <p className="text-sm font-bold">Oui — Activer Grubano Pro</p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">Feed unifié, alertes son, pause unique · 29€/mois</p>
                </div>
              </button>
              <button onClick={() => setPremium(false)} className={`flex w-full items-center gap-3 rounded-2xl border p-4 text-left ${!premium ? "border-primary bg-accent" : "border-border bg-card"}`}>
                <div className={`grid h-5 w-5 place-items-center rounded-full border-2 ${!premium ? "border-primary bg-primary" : "border-border"}`}>
                  {!premium && <Check size={12} className="text-primary-foreground" />}
                </div>
                <span className="text-sm font-semibold">Non — Grubano uniquement</span>
              </button>
            </div>
          </>
        )}

        {step === 7 && (
          <>
            <h2 className="text-2xl font-bold tracking-tight">Votre menu</h2>
            <p className="mt-1 text-sm text-muted-foreground">Comment l'importer rapidement ?</p>
            <div className="mt-5 space-y-2">
              {([
                ["import", "Importer depuis UberEats", Link2, "1-clic via URL"],
                ["manual", "Ajouter manuellement", ChevronRight, "Étape par étape"],
                ["ai", "Générer avec l'IA", Sparkles, "Nouveau restaurant"],
              ] as const).map(([k, l, Icon, sub]) => (
                <button key={k} onClick={() => setMenuMode(k)} className={`flex w-full items-center gap-3 rounded-2xl border p-4 text-left ${menuMode === k ? "border-primary bg-accent" : "border-border bg-card"}`}>
                  <div className={`grid h-10 w-10 place-items-center rounded-xl ${menuMode === k ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"}`}>
                    <Icon size={16} />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-bold">{l}</p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">{sub}</p>
                  </div>
                </button>
              ))}
            </div>
          </>
        )}

        {step === 8 && (
          <>
            <div className="text-center">
              <div className="mx-auto grid h-20 w-20 place-items-center rounded-3xl bg-primary text-primary-foreground">
                <Check size={32} />
              </div>
              <h2 className="mt-4 text-2xl font-bold tracking-tight">Vous êtes en ligne !</h2>
              <p className="mt-1 text-sm text-muted-foreground">Votre restaurant accepte des commandes sur Grubano.</p>
            </div>
            <div className="mt-6 space-y-2">
              {[
                { ok: true, l: "Menu importé" },
                { ok: true, l: "Photos validées" },
                { ok: true, l: "Horaires définis" },
                { ok: true, l: "Paiement configuré" },
                { ok: hasDining, l: "Plan de salle (IA)" },
              ].filter((c) => c.ok).map((c) => (
                <div key={c.l} className="flex items-center gap-3 rounded-xl border border-success/30 bg-success/5 p-3">
                  <Check size={14} className="text-success" />
                  <span className="text-sm font-semibold">{c.l}</span>
                </div>
              ))}
            </div>
            <Link to="/" className="mt-6 block w-full rounded-2xl bg-primary py-4 text-center text-sm font-bold text-primary-foreground">
              Ouvrir mon tableau de bord
            </Link>
          </>
        )}

        {step < 8 && (
          <button
            onClick={next}
            disabled={(step === 1 && types.length === 0) || (step === 5 && !supplier) || (step === 7 && !menuMode)}
            className="mt-8 flex w-full items-center justify-center gap-2 rounded-2xl bg-primary py-4 text-sm font-bold text-primary-foreground disabled:opacity-40"
          >
            Continuer <ChevronRight size={16} />
          </button>
        )}
      </div>
    </div>
  );
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!value)} className="flex w-full items-center justify-between rounded-2xl border border-border bg-card p-4">
      <span className="text-sm font-semibold">{label}</span>
      <span className={`relative h-6 w-11 rounded-full transition ${value ? "bg-primary" : "bg-muted"}`}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition ${value ? "left-5" : "left-0.5"}`} />
      </span>
    </button>
  );
}
