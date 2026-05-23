import { AppShell } from "./AppShell";
import { Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";

interface Props {
  title: string;
  subtitle?: string;
  badge?: string;
  children: React.ReactNode;
}

export function FeaturePage({ title, subtitle, badge, children }: Props) {
  return (
    <AppShell operator="Mohammed" subtitle="Operator">
      <div className="mb-5">
        <Link to="/more" className="mb-3 inline-flex items-center gap-1 text-[11px] font-semibold text-muted-foreground hover:text-foreground">
          <ChevronLeft size={14} /> Features
        </Link>
        <div className="flex items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
            {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
          </div>
          {badge && (
            <span className="rounded-full bg-accent px-2.5 py-1 text-[10px] font-semibold text-primary">{badge}</span>
          )}
        </div>
      </div>
      {children}
    </AppShell>
  );
}

export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-border bg-card p-4 ${className}`}>{children}</div>;
}

export function SectionTitle({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <div className="mb-3 mt-5 flex items-center justify-between">
      <h2 className="text-sm font-bold">{children}</h2>
      {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
    </div>
  );
}
