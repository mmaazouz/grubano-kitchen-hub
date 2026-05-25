import { createFileRoute } from "@tanstack/react-router";
import { FeaturePage, Card, SectionTitle } from "@/components/FeaturePage";
import { useState, useEffect } from "react";
import {
  Sparkles, Image as ImageIcon, Plus, GripVertical, Clock, Eye, EyeOff,
  Tag, Percent, Flame, Leaf, WheatOff, Star, X, Check, RotateCcw, Wand2, ChevronRight,
  ChevronLeft, Upload, Settings2, BadgeCheck,
} from "lucide-react";

export const Route = createFileRoute("/menu")({
  component: MenuBuilder,
  head: () => ({ meta: [{ title: "Grubano — Menu" }] }),
});

// ---------- Data ----------
type Dish = {
  id: string; name: string; desc: string; price: number; cat: string;
  avail: boolean; calories?: number; tags?: string[]; isNew?: boolean; bestseller?: boolean;
};
type Category = { id: string; name: string; emoji: string; hours?: string; visible: boolean };

const initialCats: Category[] = [
  { id: "c1", name: "Entrées", emoji: "🥗", hours: "11h-23h", visible: true },
  { id: "c2", name: "Plats", emoji: "🍝", hours: "11h-23h", visible: true },
  { id: "c3", name: "Desserts", emoji: "🍰", hours: "11h-23h", visible: true },
  { id: "c4", name: "Boissons", emoji: "🥤", hours: "11h-23h", visible: true },
  { id: "c5", name: "Suggestions du jour", emoji: "⭐", hours: "18h-23h", visible: true },
];

const initialDishes: Dish[] = [
  { id: "d1", name: "Gnocchi pesto", desc: "Gnocchi maison, pesto basilic frais, parmesan affiné.", price: 10.9, cat: "c2", avail: true, calories: 520, tags: ["Veggie"], bestseller: true },
  { id: "d2", name: "Butter chicken bowl", desc: "Poulet mariné 24h, sauce crémeuse au beurre épicée, riz basmati.", price: 13.5, cat: "c2", avail: true, calories: 680, tags: ["Halal", "Épicé"] },
  { id: "d3", name: "Tiramisu maison", desc: "Mascarpone fouetté, café espresso, cacao amer.", price: 4.9, cat: "c3", avail: false, calories: 420 },
  { id: "d4", name: "Chicken roll", desc: "Wrap croustillant, poulet grillé, sauce yaourt menthe.", price: 7.9, cat: "c2", avail: true, calories: 560, tags: ["Halal"], isNew: true },
  { id: "d5", name: "Bruschetta tomate", desc: "Pain grillé, tomates fraîches, basilic, huile d'olive vierge.", price: 6.5, cat: "c1", avail: true, calories: 280, tags: ["Veggie"] },
];

const promotions = [
  { name: "Happy hour", desc: "-20% entre 14h-17h", active: true, color: "primary" },
  { name: "Bundle midi", desc: "2 plats + 2 boissons = -15%", active: true, color: "navy" },
  { name: "Première commande", desc: "-5€ nouveaux clients", active: false, color: "success" },
];

// ---------- Component ----------
function MenuBuilder() {
  const [tab, setTab] = useState<"items" | "categories" | "promos">("items");
  const [dishes, setDishes] = useState<Dish[]>(initialDishes);
  const [cats, setCats] = useState<Category[]>(initialCats);
  const [scanner, setScanner] = useState(false);
  const [editing, setEditing] = useState<Dish | null>(null);

  return (
    <FeaturePage title="Menu" subtitle="Carte, options & promotions" badge={`${dishes.length} plats`}>
      {/* Quick actions */}
      <div className="mb-4 grid grid-cols-2 gap-2">
        <button onClick={() => setScanner(true)} className="flex items-center gap-2.5 rounded-2xl bg-navy p-3 text-left text-navy-foreground active:scale-[0.99] transition">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-primary text-primary-foreground"><Sparkles size={16} /></div>
          <div>
            <p className="text-[12px] font-bold">Scan IA</p>
            <p className="text-[10px] text-navy-foreground/60">Ajouter par photo</p>
          </div>
        </button>
        <button onClick={() => setEditing({ id: "new", name: "", desc: "", price: 0, cat: cats[0].id, avail: true })} className="flex items-center gap-2.5 rounded-2xl border border-border bg-card p-3 text-left active:scale-[0.99] transition">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-accent text-primary"><Plus size={16} /></div>
          <div>
            <p className="text-[12px] font-bold">Manuel</p>
            <p className="text-[10px] text-muted-foreground">Créer un plat</p>
          </div>
        </button>
      </div>

      {/* Tabs */}
      <div className="mb-4 flex gap-1 rounded-xl bg-muted p-1">
        {([["items", "Plats"], ["categories", "Catégories"], ["promos", "Promos"]] as const).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={`flex-1 rounded-lg py-1.5 text-[11px] font-bold transition ${tab === k ? "bg-card shadow text-foreground" : "text-muted-foreground"}`}>{l}</button>
        ))}
      </div>

      {tab === "items" && (
        <ItemsTab dishes={dishes} cats={cats} onToggle={(id) => setDishes(dishes.map(d => d.id === id ? { ...d, avail: !d.avail } : d))} onEdit={setEditing} />
      )}
      {tab === "categories" && <CategoriesTab cats={cats} setCats={setCats} />}
      {tab === "promos" && <PromosTab />}

      {scanner && <AIScannerOverlay cats={cats} onClose={() => setScanner(false)} onAdd={(d) => { setDishes([d, ...dishes]); setScanner(false); }} />}
      {editing && <DishEditor dish={editing} cats={cats} onClose={() => setEditing(null)} onSave={(d) => {
        if (d.id === "new") setDishes([{ ...d, id: `d${Date.now()}`, isNew: true }, ...dishes]);
        else setDishes(dishes.map(x => x.id === d.id ? d : x));
        setEditing(null);
      }} />}
    </FeaturePage>
  );
}

// ---------- Items Tab ----------
function ItemsTab({ dishes, cats, onToggle, onEdit }: { dishes: Dish[]; cats: Category[]; onToggle: (id: string) => void; onEdit: (d: Dish) => void }) {
  return (
    <div className="space-y-4">
      {cats.map((c) => {
        const list = dishes.filter(d => d.cat === c.id);
        if (!list.length) return null;
        return (
          <div key={c.id}>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{c.emoji} {c.name}</p>
              <span className="text-[10px] text-muted-foreground">{list.length} plats</span>
            </div>
            <div className="space-y-2">
              {list.map((d) => (
                <button key={d.id} onClick={() => onEdit(d)} className="w-full rounded-2xl border border-border bg-card p-3 text-left active:scale-[0.99] transition">
                  <div className="flex items-start gap-3">
                    <div className="grid h-14 w-14 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-accent to-primary/10 text-2xl">{c.emoji}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-bold leading-tight">{d.name}</p>
                        <p className="text-sm font-bold text-primary shrink-0">€{d.price.toFixed(2)}</p>
                      </div>
                      <p className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground">{d.desc}</p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1">
                        {d.bestseller && <span className="rounded-full bg-warning/20 px-1.5 py-0.5 text-[9px] font-bold text-warning-foreground">★ Best</span>}
                        {d.isNew && <span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-[9px] font-bold text-primary">Nouveau</span>}
                        {d.tags?.map(t => <span key={t} className="rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-semibold text-muted-foreground">{t}</span>)}
                        {d.calories && <span className="text-[10px] text-muted-foreground">· {d.calories} kcal</span>}
                      </div>
                    </div>
                    <div onClick={(e) => { e.stopPropagation(); onToggle(d.id); }} className={`relative h-6 w-11 shrink-0 cursor-pointer rounded-full transition ${d.avail ? "bg-success" : "bg-muted"}`}>
                      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition ${d.avail ? "left-5" : "left-0.5"}`} />
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------- Categories Tab ----------
function CategoriesTab({ cats, setCats }: { cats: Category[]; setCats: (c: Category[]) => void }) {
  return (
    <div>
      <div className="space-y-2">
        {cats.map((c) => (
          <Card key={c.id} className="!p-3">
            <div className="flex items-center gap-3">
              <GripVertical size={14} className="text-muted-foreground" />
              <span className="text-xl">{c.emoji}</span>
              <div className="flex-1">
                <p className="text-sm font-bold">{c.name}</p>
                <p className="text-[10px] text-muted-foreground inline-flex items-center gap-1"><Clock size={9} /> {c.hours}</p>
              </div>
              <button onClick={() => setCats(cats.map(x => x.id === c.id ? { ...x, visible: !x.visible } : x))} className={`grid h-8 w-8 place-items-center rounded-lg ${c.visible ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"}`}>
                {c.visible ? <Eye size={14} /> : <EyeOff size={14} />}
              </button>
            </div>
          </Card>
        ))}
      </div>
      <button className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-border bg-card/50 py-3 text-sm font-bold text-muted-foreground hover:border-primary hover:text-primary transition">
        <Plus size={14} /> Nouvelle catégorie
      </button>
    </div>
  );
}

// ---------- Promos Tab ----------
function PromosTab() {
  return (
    <div>
      <SectionTitle hint="Actives & planifiées">Promotions</SectionTitle>
      <div className="space-y-2">
        {promotions.map((p) => (
          <Card key={p.name} className="!p-3">
            <div className="flex items-center gap-3">
              <div className={`grid h-10 w-10 place-items-center rounded-xl ${p.color === "primary" ? "bg-primary text-primary-foreground" : p.color === "navy" ? "bg-navy text-navy-foreground" : "bg-success text-success-foreground"}`}>
                <Percent size={16} />
              </div>
              <div className="flex-1">
                <p className="text-sm font-bold">{p.name}</p>
                <p className="text-[11px] text-muted-foreground">{p.desc}</p>
              </div>
              <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold ${p.active ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"}`}>
                {p.active ? "Actif" : "Inactif"}
              </span>
            </div>
          </Card>
        ))}
      </div>

      <SectionTitle>Créer une promo</SectionTitle>
      <div className="grid grid-cols-2 gap-2">
        {[
          { i: Percent, l: "Remise %" }, { i: Tag, l: "Montant fixe" },
          { i: Flame, l: "Flash deal" }, { i: Star, l: "Plat du chef" },
        ].map((x) => (
          <button key={x.l} className="flex flex-col items-center gap-1.5 rounded-2xl border border-border bg-card p-3 active:scale-[0.99] transition">
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-accent text-primary"><x.i size={14} /></div>
            <span className="text-[11px] font-bold">{x.l}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------- AI Scanner Overlay ----------
function AIScannerOverlay({ cats, onClose, onAdd }: { cats: Category[]; onClose: () => void; onAdd: (d: Dish) => void }) {
  const [step, setStep] = useState<"camera" | "analyzing" | "result">("camera");
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (step !== "analyzing") return;
    setProgress(0);
    const id = setInterval(() => {
      setProgress(p => {
        if (p >= 100) { clearInterval(id); setStep("result"); return 100; }
        return p + 8;
      });
    }, 120);
    return () => clearInterval(id);
  }, [step]);

  return (
    <div className="fixed inset-0 z-50 bg-navy">
      <div className="mx-auto h-full max-w-md">
        {step === "camera" && <CameraStep onClose={onClose} onShoot={() => setStep("analyzing")} />}
        {step === "analyzing" && <AnalyzingStep progress={progress} />}
        {step === "result" && <ResultStep cats={cats} onClose={onClose} onConfirm={onAdd} onRetake={() => setStep("camera")} />}
      </div>
    </div>
  );
}

function CameraStep({ onClose, onShoot }: { onClose: () => void; onShoot: () => void }) {
  return (
    <div className="relative flex h-full flex-col">
      {/* Top bar */}
      <div className="absolute left-0 right-0 top-0 z-10 flex items-center justify-between p-4">
        <button onClick={onClose} className="grid h-10 w-10 place-items-center rounded-full bg-black/40 text-white backdrop-blur"><X size={18} /></button>
        <div className="rounded-full bg-black/40 px-3 py-1.5 text-[11px] font-bold text-white backdrop-blur">Scan IA</div>
        <button className="grid h-10 w-10 place-items-center rounded-full bg-black/40 text-white backdrop-blur"><Settings2 size={16} /></button>
      </div>

      {/* Viewfinder */}
      <div className="relative flex-1 overflow-hidden bg-gradient-to-br from-navy-elevated via-navy to-black">
        {/* Mock dish silhouette */}
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-[120px] opacity-30">🍝</div>

        {/* Guide frame */}
        <div className="absolute inset-0 flex items-center justify-center p-8">
          <div className="relative aspect-square w-full max-w-xs">
            {/* Corner brackets */}
            {[["top-0 left-0", "border-l-4 border-t-4 rounded-tl-2xl"], ["top-0 right-0", "border-r-4 border-t-4 rounded-tr-2xl"], ["bottom-0 left-0", "border-l-4 border-b-4 rounded-bl-2xl"], ["bottom-0 right-0", "border-r-4 border-b-4 rounded-br-2xl"]].map(([pos, b]) => (
              <div key={pos} className={`absolute h-12 w-12 ${pos} ${b} border-primary`} />
            ))}
            {/* Scan line */}
            <div className="absolute inset-x-4 top-1/2 h-px bg-primary shadow-[0_0_12px_2px_oklch(0.66_0.18_35)]" />
          </div>
        </div>

        <p className="absolute bottom-32 left-0 right-0 text-center text-sm font-semibold text-white">
          Placez le plat dans le cadre
        </p>
      </div>

      {/* Bottom controls */}
      <div className="bg-navy p-6">
        <div className="flex items-center justify-around">
          <button className="grid h-12 w-12 place-items-center rounded-2xl bg-navy-elevated text-white">
            <ImageIcon size={20} />
          </button>
          <button onClick={onShoot} className="group relative grid h-20 w-20 place-items-center rounded-full bg-white active:scale-95 transition">
            <div className="absolute inset-1.5 rounded-full border-4 border-navy" />
            <div className="h-14 w-14 rounded-full bg-primary" />
          </button>
          <button className="grid h-12 w-12 place-items-center rounded-2xl bg-navy-elevated text-white">
            <Upload size={20} />
          </button>
        </div>
        <p className="mt-4 text-center text-[10px] text-navy-foreground/60">
          L'IA détecte automatiquement plat, allergènes & calories
        </p>
      </div>
    </div>
  );
}

function AnalyzingStep({ progress }: { progress: number }) {
  const stages = [
    { p: 20, l: "Détection du plat..." },
    { p: 45, l: "Identification des ingrédients..." },
    { p: 70, l: "Calcul nutritionnel..." },
    { p: 90, l: "Recherche prix concurrents..." },
    { p: 100, l: "Génération de la fiche..." },
  ];
  const current = stages.find(s => progress <= s.p) || stages[stages.length - 1];
  return (
    <div className="flex h-full flex-col items-center justify-center px-8 text-center">
      <div className="relative">
        <div className="grid h-28 w-28 place-items-center rounded-full bg-primary/20">
          <div className="grid h-20 w-20 place-items-center rounded-full bg-primary text-primary-foreground animate-pulse">
            <Sparkles size={32} />
          </div>
        </div>
        <div className="absolute -inset-2 rounded-full border-2 border-primary/40 border-t-primary animate-spin" />
      </div>
      <h2 className="mt-8 text-2xl font-bold text-white">L'IA analyse...</h2>
      <p className="mt-2 text-sm text-navy-foreground/70">{current.l}</p>
      <div className="mt-6 w-full max-w-xs">
        <div className="h-1.5 overflow-hidden rounded-full bg-navy-elevated">
          <div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} />
        </div>
        <p className="mt-2 text-[11px] font-bold text-navy-foreground/60">{progress}%</p>
      </div>
    </div>
  );
}

function ResultStep({ cats, onClose, onConfirm, onRetake }: { cats: Category[]; onClose: () => void; onConfirm: (d: Dish) => void; onRetake: () => void }) {
  // AI-generated suggestions
  const [name, setName] = useState("Pasta cremosa truffe");
  const [desc, setDesc] = useState("Tagliatelles fraîches nappées d'une crème onctueuse à la truffe noire et copeaux de parmesan affiné 24 mois.");
  const [cat, setCat] = useState(cats[1]?.id || cats[0].id);
  const [price, setPrice] = useState(13.9);
  const [allergens, setAllergens] = useState<string[]>(["Gluten", "Lactose", "Œuf"]);

  const allEU = ["Gluten", "Lactose", "Œuf", "Soja", "Arachide", "Fruits à coque", "Poisson", "Crustacés", "Mollusques", "Céleri", "Moutarde", "Sésame", "Sulfites", "Lupin"];
  const labels = [
    { name: "Veggie", icon: Leaf, on: true },
    { name: "Halal", icon: BadgeCheck, on: false },
    { name: "Sans gluten", icon: WheatOff, on: false },
    { name: "Épicé", icon: Flame, on: false },
  ];

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border bg-card px-4 py-3">
        <button onClick={onClose} className="grid h-9 w-9 place-items-center rounded-xl bg-muted"><X size={16} /></button>
        <div className="text-center">
          <p className="text-[10px] uppercase tracking-wider text-primary font-bold">Généré par IA</p>
          <p className="text-sm font-bold">Vérifier la fiche</p>
        </div>
        <button onClick={onRetake} className="grid h-9 w-9 place-items-center rounded-xl bg-muted"><RotateCcw size={14} /></button>
      </div>

      {/* Scrollable form */}
      <div className="flex-1 space-y-4 overflow-y-auto p-4 pb-32">
        {/* AI photo */}
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-primary/20 to-accent">
          <div className="flex aspect-video items-center justify-center text-7xl">🍝</div>
          <div className="absolute left-3 top-3 rounded-full bg-black/60 px-2 py-1 text-[9px] font-bold text-white backdrop-blur inline-flex items-center gap-1">
            <Wand2 size={10} /> Photo améliorée
          </div>
          <div className="absolute bottom-3 right-3 flex gap-1.5">
            <button className="rounded-lg bg-white/90 px-2 py-1 text-[10px] font-bold">Reprendre</button>
            <button className="rounded-lg bg-primary px-2 py-1 text-[10px] font-bold text-primary-foreground">Générer IA</button>
          </div>
        </div>

        {/* Name */}
        <div>
          <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Nom du plat</label>
          <input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm font-semibold focus:border-primary focus:outline-none" />
        </div>

        {/* Description */}
        <div>
          <div className="flex items-center justify-between">
            <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Description (SEO)</label>
            <button className="inline-flex items-center gap-1 text-[10px] font-bold text-primary"><Sparkles size={10} /> Régénérer</button>
          </div>
          <textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={3} className="mt-1 w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm focus:border-primary focus:outline-none" />
        </div>

        {/* Category */}
        <div>
          <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Catégorie</label>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {cats.map((c) => (
              <button key={c.id} onClick={() => setCat(c.id)} className={`rounded-full px-3 py-1.5 text-[11px] font-bold transition ${cat === c.id ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                {c.emoji} {c.name}
              </button>
            ))}
          </div>
        </div>

        {/* Smart Pricing */}
        <Card className="!p-3.5 !bg-navy !text-navy-foreground border-transparent">
          <div className="mb-2 flex items-center gap-2">
            <Sparkles size={14} className="text-primary" />
            <p className="text-[11px] font-bold uppercase tracking-wider">Prix intelligent</p>
          </div>
          <p className="text-[11px] text-navy-foreground/70">Basé sur 12 plats similaires à Paris 75011 · Restaurant standard</p>

          {/* Range slider visual */}
          <div className="mt-4">
            <div className="relative h-2 rounded-full bg-navy-elevated">
              <div className="absolute inset-y-0 left-[20%] right-[15%] rounded-full bg-gradient-to-r from-success via-primary to-destructive opacity-50" />
              <div
                className="absolute top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-4 border-primary bg-white shadow-lg"
                style={{ left: `${((price - 9) / (18 - 9)) * 100}%` }}
              />
            </div>
            <input
              type="range" min={9} max={18} step={0.1} value={price}
              onChange={(e) => setPrice(Number(e.target.value))}
              className="absolute h-2 w-full -mt-2 opacity-0 cursor-pointer"
            />
            <div className="mt-2 flex justify-between text-[10px] text-navy-foreground/60">
              <span>Min €9</span>
              <span className="font-bold text-primary">Suggéré €13.90</span>
              <span>Max €18</span>
            </div>
          </div>

          <div className="mt-3 flex items-center justify-between rounded-xl bg-navy-elevated p-3">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-navy-foreground/60">Votre prix</p>
              <p className="text-2xl font-bold">€{price.toFixed(2)}</p>
            </div>
            <div className="text-right">
              <p className="text-[10px] text-navy-foreground/60">Moyenne zone</p>
              <p className="text-sm font-bold">€12.50 - €15.00</p>
            </div>
          </div>

          <p className="mt-2 text-[10px] text-navy-foreground/60">
            <span className="font-bold text-primary">Best-sellers à ce prix :</span> La Crémosa (€14.90), Gnocchi Teriyaki (€13.50)
          </p>
        </Card>

        {/* Nutrition */}
        <Card className="!p-3">
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Nutrition (estimée)</p>
          <div className="mt-2 grid grid-cols-4 gap-2 text-center">
            {[["Calories", "520 kcal"], ["Protéines", "18g"], ["Glucides", "62g"], ["Lipides", "22g"]].map(([k, v]) => (
              <div key={k}>
                <p className="text-sm font-bold">{v}</p>
                <p className="text-[9px] text-muted-foreground">{k}</p>
              </div>
            ))}
          </div>
        </Card>

        {/* Allergens */}
        <div>
          <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Allergènes (UE 14)</label>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {allEU.map((a) => {
              const on = allergens.includes(a);
              return (
                <button key={a} onClick={() => setAllergens(on ? allergens.filter(x => x !== a) : [...allergens, a])} className={`rounded-full px-2.5 py-1 text-[10px] font-bold transition ${on ? "bg-destructive/15 text-destructive border border-destructive/30" : "bg-muted text-muted-foreground border border-transparent"}`}>
                  {on && "✓ "}{a}
                </button>
              );
            })}
          </div>
        </div>

        {/* Labels */}
        <div>
          <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Labels</label>
          <div className="mt-1.5 grid grid-cols-4 gap-1.5">
            {labels.map((l) => (
              <button key={l.name} className={`flex flex-col items-center gap-1 rounded-xl border p-2 transition ${l.on ? "border-primary bg-accent text-primary" : "border-border bg-card text-muted-foreground"}`}>
                <l.icon size={14} />
                <span className="text-[9px] font-bold">{l.name}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Sticky footer */}
      <div className="absolute bottom-0 left-0 right-0 border-t border-border bg-card p-4">
        <button onClick={() => onConfirm({ id: "new", name, desc, price, cat, avail: true, calories: 520, tags: ["Veggie"] })} className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3.5 text-sm font-bold text-primary-foreground active:scale-[0.99] transition">
          <Check size={16} /> Ajouter au menu · Toutes plateformes
        </button>
      </div>
    </div>
  );
}

// ---------- Dish Editor (lightweight manual) ----------
function DishEditor({ dish, cats, onClose, onSave }: { dish: Dish; cats: Category[]; onClose: () => void; onSave: (d: Dish) => void }) {
  const [d, setD] = useState<Dish>(dish);
  const isNew = dish.id === "new";

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md max-h-[92vh] overflow-y-auto rounded-t-3xl bg-background p-5">
        <div className="mb-4 flex items-center justify-between">
          <button onClick={onClose} className="grid h-9 w-9 place-items-center rounded-xl bg-muted"><ChevronLeft size={16} /></button>
          <p className="text-base font-bold">{isNew ? "Nouveau plat" : "Modifier"}</p>
          <button onClick={() => onSave(d)} className="rounded-xl bg-primary px-4 py-2 text-[12px] font-bold text-primary-foreground">Enregistrer</button>
        </div>

        <div className="space-y-3">
          <input value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} placeholder="Nom du plat" className="w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm font-semibold focus:border-primary focus:outline-none" />
          <textarea value={d.desc} onChange={(e) => setD({ ...d, desc: e.target.value })} placeholder="Description" rows={3} className="w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm focus:border-primary focus:outline-none" />

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Prix €</label>
              <input type="number" step="0.1" value={d.price} onChange={(e) => setD({ ...d, price: Number(e.target.value) })} className="mt-1 w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm font-bold focus:border-primary focus:outline-none" />
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Calories</label>
              <input type="number" value={d.calories ?? ""} onChange={(e) => setD({ ...d, calories: Number(e.target.value) })} className="mt-1 w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm focus:border-primary focus:outline-none" />
            </div>
          </div>

          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Catégorie</label>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {cats.map((c) => (
                <button key={c.id} onClick={() => setD({ ...d, cat: c.id })} className={`rounded-full px-3 py-1.5 text-[11px] font-bold transition ${d.cat === c.id ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                  {c.emoji} {c.name}
                </button>
              ))}
            </div>
          </div>

          {/* Options groups preview */}
          <Card className="!p-3">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-bold">Options & suppléments</p>
              <button className="text-[10px] font-bold text-primary inline-flex items-center gap-1"><Plus size={10} /> Ajouter</button>
            </div>
            <div className="mt-2 space-y-1.5 text-[11px]">
              <div className="flex items-center justify-between rounded-lg bg-muted px-2.5 py-1.5">
                <span><span className="font-bold">Choix de sauce</span> · Obligatoire · choisir 1</span>
                <ChevronRight size={12} className="text-muted-foreground" />
              </div>
              <div className="flex items-center justify-between rounded-lg bg-muted px-2.5 py-1.5">
                <span><span className="font-bold">Extras</span> · Facultatif · multi</span>
                <ChevronRight size={12} className="text-muted-foreground" />
              </div>
              <div className="flex items-center justify-between rounded-lg bg-muted px-2.5 py-1.5">
                <span><span className="font-bold">Taille</span> · S/M/L</span>
                <ChevronRight size={12} className="text-muted-foreground" />
              </div>
            </div>
          </Card>

          {!isNew && (
            <button className="w-full rounded-xl border border-destructive/30 py-2.5 text-[12px] font-bold text-destructive">
              Supprimer ce plat
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
