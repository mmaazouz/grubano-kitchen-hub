import { AppHeader } from "./AppHeader";
import { BottomNav } from "./BottomNav";

interface Props {
  children: React.ReactNode;
  operator?: string;
  subtitle?: string;
}

export function AppShell({ children, operator, subtitle }: Props) {
  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-md">
        <AppHeader operator={operator} subtitle={subtitle} />
        <main className="px-5 pb-28 pt-4">{children}</main>
      </div>
      <BottomNav />
    </div>
  );
}
