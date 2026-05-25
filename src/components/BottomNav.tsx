import { Link, useLocation } from "@tanstack/react-router";
import { LayoutDashboard, UtensilsCrossed, ShoppingBag, CalendarDays, LayoutGrid } from "lucide-react";

const items = [
  { to: "/", label: "Accueil", icon: LayoutDashboard },
  { to: "/menu", label: "Menu", icon: UtensilsCrossed },
  { to: "/orders", label: "Commandes", icon: ShoppingBag },
  { to: "/tables", label: "Tables", icon: CalendarDays },
  { to: "/more", label: "Plus", icon: LayoutGrid },
] as const;

export function BottomNav() {
  const { pathname } = useLocation();
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-border bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80">
      <div className="mx-auto flex max-w-md items-stretch justify-between px-2 py-2">
        {items.map(({ to, label, icon: Icon }) => {
          const active = pathname === to;
          return (
            <Link
              key={to}
              to={to}
              className="group flex flex-1 flex-col items-center gap-1 rounded-xl px-1 py-1 text-[10px] font-medium transition-colors"
            >
              <div
                className={`flex h-9 w-9 items-center justify-center rounded-xl transition-all ${
                  active ? "bg-primary text-primary-foreground shadow-lg shadow-primary/30" : "text-muted-foreground group-hover:text-foreground"
                }`}
              >
                <Icon size={18} />
              </div>
              <span className={active ? "text-foreground" : "text-muted-foreground"}>{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
