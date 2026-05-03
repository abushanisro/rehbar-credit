import { TerminalHeader } from "./TerminalHeader";

export const TerminalLayout = ({ children }: { children: React.ReactNode }) => {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <TerminalHeader />
      <main className="flex-1 p-3">{children}</main>
      <footer className="border-t border-border bg-surface text-[10px] text-muted-foreground tracking-widest px-3 py-1.5 flex justify-between">
        <span>© REHBAR FINANCIAL SERVICES · CREDIT ANALYSIS SOFTWARE · rehbar.co.in ·</span>
        <span>F1 PIPELINE · F2 NEW · ESC LOGOUT</span>
      </footer>
    </div>
  );
};
