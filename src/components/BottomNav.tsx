import { Link, useLocation } from "@tanstack/react-router";
import { LayoutDashboard, Store, Award, Package, Building2 } from "lucide-react";

const items = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/brands", label: "Brands", icon: Store },
  { to: "/loyalty", label: "Loyalty", icon: Award },
  { to: "/stocks", label: "Stocks", icon: Package },
  { to: "/franchise", label: "Franchise", icon: Building2 },
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
              className="group flex flex-1 flex-col items-center gap-1 rounded-xl px-2 py-1.5 text-[10px] font-medium transition-colors"
            >
              <div
                className={`flex h-9 w-9 items-center justify-center rounded-xl transition-all ${
                  active ? "bg-primary text-primary-foreground shadow-lg shadow-primary/30" : "text-muted-foreground group-hover:text-foreground"
                }`}
              >
                <Icon className="h-4.5 w-4.5" size={18} />
              </div>
              <span className={active ? "text-foreground" : "text-muted-foreground"}>{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
