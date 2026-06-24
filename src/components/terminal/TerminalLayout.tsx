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
          <div className="border-b border-border bg-card px-4 lg:px-6 h-12 flex items-center justify-between gap-4">
            {topBar}
          </div>
        )}
      </div>
      <main className="flex-1 p-4 lg:p-6">{children}</main>
      <footer className="border-t border-border bg-card px-4 lg:px-6 py-3 flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          © Rehbar Financial Services · Credit Analysis Software
        </span>
        <span className="text-xs text-muted-foreground hidden md:block">
          rehbar.co.in
        </span>
      </footer>
    </div>
  );
};
