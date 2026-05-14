import { TerminalHeader } from "./TerminalHeader";
import { ReactNode } from "react";

interface TerminalLayoutProps {
  children: ReactNode;
  topBar?: ReactNode;
}

export const TerminalLayout = ({ children, topBar }: TerminalLayoutProps) => {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <div className="sticky top-0 z-40">
        <TerminalHeader />
        {topBar && (
          <div className="border-b border-border bg-card px-3 h-9 flex items-center justify-between gap-3">
            {topBar}
          </div>
        )}
      </div>
      <main className="flex-1 p-3">{children}</main>
      <footer className="border-t border-border bg-surface text-[10px] text-muted-foreground tracking-widest px-3 py-1.5 flex justify-between">
        <span className="truncate">© REHBAR FINANCIAL SERVICES · CREDIT ANALYSIS SOFTWARE · rehbar.co.in</span>
        <span className="hidden md:block shrink-0 ml-3">F1 PIPELINE · F2 NEW · F4 ANALYST · ESC LOGOUT</span>
      </footer>
    </div>
  );
};
