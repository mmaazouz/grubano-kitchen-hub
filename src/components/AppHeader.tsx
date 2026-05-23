import logo from "@/assets/grubano-logo.png";
import { Bell } from "lucide-react";

interface Props {
  operator?: string;
  subtitle?: string;
}

export function AppHeader({ operator = "Mohammed", subtitle }: Props) {
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur">
      <div className="mx-auto flex max-w-md items-center justify-between px-5 py-3.5">
        <div className="flex items-center gap-3">
          <img src={logo} alt="Grubano" className="h-7 w-auto" />
        </div>
        <div className="flex items-center gap-3">
          <button className="relative grid h-9 w-9 place-items-center rounded-full bg-muted text-foreground transition hover:bg-accent">
            <Bell size={16} />
            <span className="absolute top-2 right-2 h-2 w-2 rounded-full bg-primary ring-2 ring-background" />
          </button>
          <div className="flex items-center gap-2.5">
            <div className="text-right">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{subtitle ?? "Operator"}</p>
              <p className="text-xs font-semibold leading-tight text-foreground">{operator}</p>
            </div>
            <div className="grid h-9 w-9 place-items-center rounded-full bg-navy text-navy-foreground text-xs font-bold">
              {operator.charAt(0)}
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
