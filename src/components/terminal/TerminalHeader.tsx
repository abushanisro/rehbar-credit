import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/features/auth/AuthProvider";
import { cn } from "@/lib/utils";

const fmt = (d: Date) =>
  d.toLocaleTimeString("en-US", { hour12: false }) + " IST";

export const TerminalHeader = () => {
  const [now, setNow] = useState(new Date());
  const { user, signOut } = useAuth();
  const loc = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const navItem = (to: string, label: string, code: string) => {
    const active = loc.pathname === to || (to !== "/" && loc.pathname.startsWith(to));
    return (
      <Link
        to={to}
        className={cn(
          "px-3 py-1 text-xs tracking-widest border-r border-border transition-colors",
          active ? "bg-primary text-primary-foreground" : "text-primary/80 hover:bg-surface-2"
        )}
      >
        <span className="text-muted-foreground mr-2">{code}</span>{label}
      </Link>
    );
  };

  return (
    <>
      <div className="border-b border-border bg-surface text-[11px] flex items-center justify-between px-3 h-7">
        <div className="flex items-center gap-4">
          <span className="text-primary font-bold tracking-widest glow">REHBAR//CAS · CREDIT TERMINAL</span>
          <span className="text-muted-foreground">v3.0.0</span>
          <span className="text-success ticker-blink">● LIVE</span>
          <span className="text-muted-foreground">GEMINI 2.5 PRO</span>
        </div>
        <div className="flex items-center gap-4 text-muted-foreground">
          <span>{user?.email}</span>
          <span className="text-primary">{fmt(now)}</span>
          <button onClick={async () => { await signOut(); navigate("/auth"); }} className="text-destructive hover:underline">
            [LOGOUT]
          </button>
        </div>
      </div>
      <nav className="border-b border-border bg-card flex items-center h-9">
        {navItem("/", "PIPELINE", "F1")}
        {navItem("/new", "NEW CASE", "F2")}
        <div className="flex-1" />
        <div className="px-3 text-[11px] text-muted-foreground tracking-widest">
          REHBAR FINANCIAL SERVICES · IC APPRAISAL <span className="text-primary">_</span>
          <span className="ticker-blink text-primary">█</span>
        </div>
      </nav>
      <div className="border-b border-border bg-surface-2 h-6 overflow-hidden relative flex items-center px-3 text-[10px] tracking-widest">
        <span className="text-warning">⚠ AI-GENERATED DRAFTS REQUIRE ANALYST REVIEW · NO AUTO CREDIT VERDICTS · DSCR FORMULA IS FINANCE-LOCKED</span>
      </div>
    </>
  );
};
